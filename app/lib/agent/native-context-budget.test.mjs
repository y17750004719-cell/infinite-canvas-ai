import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildNativeContinuationCapsule,
  buildRecentImageTaskFacts,
  prepareBoundedNativeContext,
} from './native-context-budget.mjs';

const base = {
  sameScope: true,
  scopeId: 'scope-1',
  providerFingerprint: 'provider-1',
  model: 'model-1',
  userText: 'Generate a poster.',
  skills: [{ id: 'imagegen', hash: 'skill-hash', content: 'private skill content' }],
  tools: [{ name: 'generate_image', description: 'Generate an image.' }],
  baseInstructions: 'base',
  developerInstructions: 'developer',
  threadState: { turns: [] },
};

test('legacy Native threads rotate instead of resuming unbounded history', () => {
  const result = prepareBoundedNativeContext({
    ...base,
    persistedNative: { threadId: 'legacy-thread' },
    images: [],
  });
  assert.equal(result.resumeThreadId, '');
  assert.equal(result.rotationReason, 'legacy_thread');
  assert.equal(result.generation, 1);
});

test('resident images are represented by stable hashes without repeating base64', () => {
  const image = 'data:image/png;base64,aW1hZ2UtYnl0ZXM=';
  const first = prepareBoundedNativeContext({ ...base, persistedNative: null, images: [image] });
  const persistedNative = {
    threadId: 'thread-1',
    contextLedger: { ...first.ledger, nativeThreadId: 'thread-1', lastTurnStatus: 'completed' },
  };
  const second = prepareBoundedNativeContext({ ...base, persistedNative, images: [image, image] });
  assert.equal(second.resumeThreadId, 'thread-1');
  assert.deepEqual(second.images, []);
  assert.equal(second.diagnostics.duplicateImagesOmitted, 2);
  assert.match(second.userText, /already resident/);
  assert.doesNotMatch(second.userText, /data:image/);
});

test('eight repeated occurrences become one visual input with complete diagnostics', () => {
  const image = 'data:image/png;base64,c2FtZS1waXhlbHM=';
  const result = prepareBoundedNativeContext({ ...base, persistedNative: null, images: Array(8).fill(image) });
  assert.deepEqual(result.images, [image]);
  assert.equal(result.diagnostics.imageOccurrences, 8);
  assert.equal(result.diagnostics.uniqueImageCount, 1);
  assert.equal(result.diagnostics.duplicateImagesOmitted, 7);
});

test('optional asset identity is persisted alongside the verified content hash', () => {
  const image = 'data:image/png;base64,aW1hZ2UtYnl0ZXM=';
  const result = prepareBoundedNativeContext({
    ...base,
    persistedNative: null,
    images: [image],
    imageIdentities: [{ assetId: 'asset-42', referenceId: 'reference-42' }],
  });
  assert.deepEqual(result.ledger.residentAssetIds, ['asset-42']);
  assert.deepEqual(result.ledger.residentImages, [{
    assetId: 'asset-42', referenceId: 'reference-42', contentHash: result.ledger.uniqueImageHashes[0],
  }]);
});

test('a fifth explicit image rotates a full resident generation and sends the current image', () => {
  const residentHashes = Array.from({ length: 4 }, (_, index) => String(index).repeat(64));
  const current = 'data:image/png;base64,bmV3LWltYWdl';
  const result = prepareBoundedNativeContext({
    ...base,
    persistedNative: { threadId: 'thread-full', contextLedger: {
      version: 1, generation: 3, nativeThreadId: 'thread-full', turnCount: 4,
      estimatedInputTokens: 4000, serializedInputBytes: 4000, imageOccurrences: 4,
      uniqueImageHashes: residentHashes, residentAssetIds: ['a', 'b', 'c', 'd'], summaryVersion: 0,
      lastTurnStatus: 'completed', model: 'model-1',
    } },
    images: [current],
  });
  assert.equal(result.rotationReason, 'visual_reference_budget');
  assert.equal(result.resumeThreadId, '');
  assert.deepEqual(result.images, [current]);
  assert.equal(result.ledger.uniqueImageHashes.length, 1);
  assert.equal(result.generation, 4);
});

test('a later text-only request rotates away from image-bearing provider history', () => {
  const result = prepareBoundedNativeContext({
    ...base,
    persistedNative: { threadId: 'thread-with-image', contextLedger: {
      version: 1, generation: 1, nativeThreadId: 'thread-with-image', turnCount: 1,
      estimatedInputTokens: 1200, serializedInputBytes: 2_000_000, imageOccurrences: 1,
      uniqueImageHashes: ['a'.repeat(64)], residentAssetIds: ['asset-1'],
      residentImages: [{ assetId: 'asset-1', contentHash: 'a'.repeat(64) }],
      summaryVersion: 0, lastTurnStatus: 'completed', model: 'model-1',
    } },
    images: [],
  });
  assert.equal(result.rotationReason, 'drop_stale_visual_history');
  assert.equal(result.resumeThreadId, '');
  assert.deepEqual(result.images, []);
  assert.doesNotMatch(result.userText, /data:image/);
});

test('mismatched supplied image identity rotates instead of trusting an unverified hash', () => {
  const image = 'data:image/png;base64,aW1hZ2U=';
  const result = prepareBoundedNativeContext({
    ...base,
    persistedNative: { threadId: 'thread-identity', contextLedger: {
      version: 1, generation: 1, nativeThreadId: 'thread-identity', turnCount: 1,
      estimatedInputTokens: 100, serializedInputBytes: 100, imageOccurrences: 0,
      uniqueImageHashes: [], residentAssetIds: [], summaryVersion: 0,
      lastTurnStatus: 'completed', model: 'model-1',
    } },
    images: [image], imageIdentities: [{ assetId: 'asset-1', contentHash: 'not-the-content-hash' }],
  });
  assert.equal(result.rotationReason, 'image_identity_unknown');
  assert.equal(result.diagnostics.imageIdentityUnknown, true);
  assert.deepEqual(result.images, [image]);
});

test('continuation capsule is bounded and excludes image and Skill payloads', () => {
  const capsule = buildNativeContinuationCapsule({
    ledger: {
      version: 1, generation: 2, nativeThreadId: 'thread-2', turnCount: 8,
      estimatedInputTokens: 100, serializedInputBytes: 100, imageOccurrences: 8,
      uniqueImageHashes: ['a'.repeat(64)], residentAssetIds: ['asset-1'], summaryVersion: 1,
      recentConversation: [{ role: 'user', content: `Use this ${'data:image/png;base64,'.concat('a'.repeat(20_000))}` }],
    },
    threadState: {
      threadId: 'session-1',
      transcriptSummary: 'Keep the requested minimal style.',
      modelEvents: Array.from({ length: 12 }, (_, index) => ({
        eventId: `event-${index}`, sessionId: 'session-1', sequence: index + 1,
        type: index % 2 ? 'assistant_text' : 'user_text', source: 'test',
        content: index === 2 ? 'data:image/png;base64,cHJpdmF0ZS1waXhlbHM=' : `semantic event ${index}`,
      })),
      agentMemory: {
        rollingSummary: 'The user wants a minimal poster.',
        facts: ['Use one focal object.'], preferences: ['Avoid clutter.'],
        activeTask: { status: 'executing', summary: 'Generate poster', taskId: 'task-1' },
      },
      turns: [],
    },
    skills: [{ id: 'poster', hash: 'hash-1', content: 'do not persist this private content' }],
  });
  assert.ok(Buffer.byteLength(capsule, 'utf8') <= 12 * 1024);
  assert.doesNotMatch(capsule, /data:image/);
  assert.doesNotMatch(capsule, /private content/);
  assert.match(capsule, /asset-1/);
  assert.match(capsule, /hash-1/);
  assert.match(capsule, /semantic event 11/);
  assert.doesNotMatch(capsule, /semantic event 0/);
  assert.match(capsule, /Avoid clutter/);
});

test('five current visual references are bounded to four', () => {
  const images = Array.from({ length: 5 }, (_, index) => `data:image/png;base64,aW1hZ2Ut${index}`);
  const result = prepareBoundedNativeContext({ ...base, persistedNative: null, images });
  assert.equal(result.images.length, 4);
  assert.equal(result.diagnostics.uniqueImageCount, 4);
  assert.equal(result.diagnostics.imageLimitOmitted, 1);
  assert.equal(result.rotationReason, 'current_visual_reference_budget');
});

test('recent image facts are bounded metadata and do not become a Skill lock', () => {
  const facts = buildRecentImageTaskFacts({
    generatedImageHistory: [
      { taskId: 'task-2', createdAt: 20, assetId: 'asset-2', sourceReferenceId: 'ref-2', operation: 'edit', providerId: 'p', model: 'm', promptTrace: { skillId: 'poster' } },
      { taskId: 'task-1', createdAt: 10, assetId: 'asset-1', operation: 'generate', promptTrace: { sourcePrompt: 'rendered supplier prompt' } },
    ],
    contextEvents: [{ taskId: 'task-2', type: 'skill_selected', skillId: 'poster', skillContentHash: 'hash-2' }],
    messages: [{ role: 'assistant', taskSnapshot: { taskId: 'task-2', status: 'completed', contract: { intent: 'image' }, activeVersions: [{ assetId: 'asset-3', referenceId: 'ref-3' }] } }],
  });
  assert.equal(facts.length, 2);
  assert.deepEqual(facts[0], {
    taskId: 'task-2', status: 'completed', originalRequest: 'unknown',
    skill: { id: 'poster', hash: 'hash-2' }, referenceIds: ['ref-2', 'ref-3'],
    outputAssetIds: ['asset-2', 'asset-3'], options: { operation: 'edit', providerId: 'p', model: 'm' },
  });
  assert.equal(facts[1].skill, 'unknown');
  assert.equal(facts[1].status, 'unknown');
  assert.equal(facts[1].originalRequest, 'unknown');
});
