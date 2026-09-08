import test from 'node:test';
import assert from 'node:assert/strict';

import {
  VisualReferenceResolutionError,
  resolveExecutableVisualReferences,
  selectRecentSessionImage,
} from './executable-visual-references.mjs';

test('selects only the current session recent image', () => {
  const reference = selectRecentSessionImage({
    sessionId: 'canvas-a',
    generatedImageHistory: [
      { id: 'other-canvas', src: '/other.png', sessionId: 'canvas-b', createdAt: 30 },
      { id: 'current-canvas', src: '/current.png', sessionId: 'canvas-a', createdAt: 20 },
    ],
  });

  assert.equal(reference.id, 'history-image:current-canvas');
});

test('selects the latest upload or canvas asset from the session timeline', () => {
  const reference = selectRecentSessionImage({
    sessionId: 'session-a',
    sessionVisualAssets: [
      { id: 'asset-old', sessionId: 'session-a', durableSrc: '/old.png', source: 'generated', createdAt: 10 },
      { id: 'asset-upload', sessionId: 'session-a', durableSrc: '/upload.png', source: 'upload', createdAt: 30 },
      { id: 'asset-other', sessionId: 'session-b', durableSrc: '/other.png', source: 'canvas', createdAt: 100 },
    ],
  });

  assert.equal(reference.id, 'asset-upload');
  assert.equal(reference.assetId, 'asset-upload');
  assert.equal(reference.src, '/upload.png');
  assert.equal(reference.source, 'upload');
});

test('uses event ordering and resolves event asset ids through stable assets', () => {
  const reference = selectRecentSessionImage({
    sessionId: 'session-a',
    sessionVisualAssets: [
      { id: 'asset-canvas', sessionId: 'session-a', durableSrc: '/canvas.png', source: 'canvas', createdAt: 1 },
    ],
    contextEvents: [
      { eventId: 'input-1', sessionId: 'session-a', sequence: 4, type: 'image_input', assetId: 'asset-canvas' },
    ],
  });

  assert.equal(reference.id, 'asset-canvas');
  assert.equal(reference.src, '/canvas.png');
  assert.equal(reference.source, 'canvas');
});

test('keeps a multi-image generated batch ambiguous across timeline sources', () => {
  assert.throws(
    () => selectRecentSessionImage({
      sessionId: 'session-a',
      sessionVisualAssets: [
        { id: 'asset-a', sessionId: 'session-a', durableSrc: '/a.png', source: 'generated', batchId: 'batch-1', taskId: 'task-1', createdAt: 20 },
        { id: 'asset-b', sessionId: 'session-a', durableSrc: '/b.png', source: 'generated', batchId: 'batch-1', taskId: 'task-1', createdAt: 21 },
      ],
    }),
    (error) => error instanceof VisualReferenceResolutionError
      && error.reason === 'recent_image_ambiguous'
      && error.candidates.length === 2
      && error.candidates.every((candidate) => candidate.assetId),
  );
});

test('does not fall back to legacy topic history for a session request', () => {
  assert.throws(
    () => selectRecentSessionImage({
      sessionId: 'canvas-a',
      generatedImageHistory: [{ id: 'legacy', src: '/legacy.png', topicId: 'canvas-a', createdAt: 10 }],
    }),
    (error) => error instanceof VisualReferenceResolutionError && error.reason === 'recent_image_not_found',
  );
});

test('resolves a canvas entity that is absent from the runtime map', async () => {
  const result = await resolveExecutableVisualReferences({
    referenceIds: ['canvas:item-1'],
    contextEntityById: new Map([['canvas:item-1', {
      id: 'canvas:item-1',
      kind: 'canvas_item',
      label: '主图',
      assetUrl: '/api/local-assets/uploads/a.png',
    }]]),
    sessionId: 'topic-1',
  });

  assert.deepEqual(result.references[0], {
    id: 'canvas:item-1',
    src: '/api/local-assets/uploads/a.png',
    originalSrc: '/api/local-assets/uploads/a.png',
    label: '主图',
    source: 'canvas',
    role: 'reference',
  });
});

test('uses only exact-topic generated history for the recent image selector', () => {
  const reference = selectRecentSessionImage({
    sessionId: 'topic-1',
    generatedImageHistory: [
      { id: 'other', src: '/other.png', sessionId: 'topic-2', createdAt: 30 },
      { id: 'current', src: '/current.png', sessionId: 'topic-1', createdAt: 20, versionId: 'v1' },
    ],
  });

  assert.equal(reference.id, 'history-image:current');
  assert.equal(reference.src, '/current.png');
  assert.equal(reference.sourceVersionId, 'v1');
});

test('does not treat unscoped legacy history as the current topic recent image', () => {
  assert.throws(
    () => selectRecentSessionImage({
      sessionId: 'topic-a',
      generatedImageHistory: [{ id: 'legacy', src: '/legacy.png', createdAt: 10 }],
    }),
    (error) => error instanceof VisualReferenceResolutionError && error.reason === 'recent_image_not_found',
  );
});

test('requires selection when the latest generated batch contains multiple images', () => {
  assert.throws(
    () => selectRecentSessionImage({
      sessionId: 'topic-1',
      generatedImageHistory: [
        { id: 'a', src: '/a.png', sessionId: 'topic-1', taskId: 'task-1', batchId: 'batch-1', createdAt: 20 },
        { id: 'b', src: '/b.png', sessionId: 'topic-1', taskId: 'task-1', batchId: 'batch-1', createdAt: 21 },
      ],
    }),
    (error) => error instanceof VisualReferenceResolutionError
      && error.reason === 'recent_image_ambiguous'
      && error.candidates.length === 2,
  );
});

test('does not silently replace an unavailable locked target', async () => {
  await assert.rejects(
    resolveExecutableVisualReferences({
      referenceIds: ['locked'],
      runtimeReferenceById: new Map([['locked', { id: 'locked', src: '/missing.png', label: '目标图' }]]),
      sessionId: 'topic-1',
      generatedImageHistory: [{ id: 'other', src: '/other.png', sessionId: 'topic-1', createdAt: 30 }],
      materialize: async () => {
        const error = new Error('missing');
        error.code = 'SESSION_ASSET_UNAVAILABLE';
        throw error;
      },
    }),
    (error) => error.reason === 'asset_unavailable' && error.referenceId === 'locked',
  );
});
