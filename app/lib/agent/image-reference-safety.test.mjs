import test from 'node:test';
import assert from 'node:assert/strict';
import { createAgentRuntimeImageToolHandler } from './agent-runtime-tool-registry-service.mjs';
import { resolveExecutableVisualReferences } from './executable-visual-references.mjs';
import { buildCanonicalAgentReferenceContext, normalizeAgentRuntimeReferenceContext } from './agent-reference-context-service.mjs';

test('live reference normalization retains confirmed regions and filters dangling evidence and composer IDs', async () => {
  const reference = { id: 'region', src: '/original.png', label: 'Target', source: 'canvas', role: 'region_target' };
  const context = normalizeAgentRuntimeReferenceContext({
    references: [
      { ...reference, id: 'pending' },
      { ...reference, confirmationStatus: 'confirmed', aliases: ['left'], targetPoint: { x: 0.2, y: 0.3 } },
      { ...reference, id: 'plain', role: 'reference' },
    ],
    composerSegments: [
      { type: 'text', text: 'Edit ' }, { type: 'reference', referenceId: 'pending' },
      { type: 'reference', referenceId: 'region' }, { type: 'reference', referenceId: 'crop' },
    ],
    evidenceImages: [
      { id: 'crop', referenceId: 'region', src: '/crop.png', kind: 'region_crop' },
      { id: 'annotation', referenceId: 'plain', src: '/annotation.png', kind: 'annotation_composite' },
      { id: 'invalid-crop', referenceId: 'plain', src: '/crop.png', kind: 'region_crop' },
      { id: 'dangling', referenceId: 'pending', src: '/pending.png', kind: 'region_crop' },
    ],
  });
  assert.deepEqual(context.references.map((entry) => entry.id), ['region', 'plain']);
  assert.deepEqual(context.references[0].targetPoint, { x: 0.2, y: 0.3 });
  assert.deepEqual(context.references[0].aliases, ['left']);
  assert.deepEqual(context.composerSegments, [{ type: 'text', text: 'Edit ' }, { type: 'reference', referenceId: 'region' }]);
  assert.deepEqual(context.evidenceImages.map((entry) => entry.id), ['crop', 'annotation']);
  await assert.rejects(() => resolveExecutableVisualReferences({
    referenceIds: ['crop'], referenceContext: context,
  }), (error) => error.reason === 'unknown_reference');
});

test('live canonical context deduplicates raw images and never promotes evidence to an executable reference', () => {
  const context = buildCanonicalAgentReferenceContext({
    referenceContext: {
      references: [{ id: 'original', src: '/original.png', label: 'Original', source: 'canvas', role: 'annotation_bundle' }],
      composerSegments: [{ type: 'reference', referenceId: 'original' }],
      evidenceImages: [{ id: 'annotation', referenceId: 'original', src: '/annotation.png', kind: 'annotation_composite' }],
    },
    referenceImages: ['/original.png', '/original.png', '/annotation.png', '/style.png', '/style.png'],
  });
  assert.deepEqual(context.references.map((entry) => entry.src), ['/original.png', '/style.png']);
  assert.equal(context.references[0].id, 'original');
  assert.equal(context.evidenceImages.length, 1);
});

for (const scenario of [
  { name: 'unavailable original', src: '/missing-original.png', reason: 'asset_unavailable' },
  { name: 'preview-only reference', src: '', reason: 'unknown_reference' },
]) {
  test(`live image handler rejects ${scenario.name} before provider dispatch without using preview or latest image`, async () => {
    const requested = [];
    let providerCalls = 0;
    const noop = () => {};
    const runtimeReferenceById = new Map([['locked', {
      id: 'locked', src: scenario.src, previewSrc: '/preview.webp', label: 'Explicit target',
    }]]);
    const generatedImageHistory = [{
      id: 'latest', src: '/latest.png', sessionId: 'session-1', createdAt: 99,
    }];
    const handler = createAgentRuntimeImageToolHandler({
      runId: 'run-1', sessionId: 'session-1', body: {}, selectedSkill: null,
      rootTaskId: () => 'task-1', toolCallRecords: [], mainAgentLoopState: {},
      runtimeReferenceById, generatedImageHistory,
      hashPrompt: () => 'hash', contextLogger: { info: noop },
      setDirectGenerateImageCallId: noop, setDirectGenerateImageCall: noop,
      setExecutionReferenceImages: noop,
      resolveVisualReferences: (referenceIds) => resolveExecutableVisualReferences({
        referenceIds, runtimeReferenceById, generatedImageHistory, sessionId: 'session-1',
        materialize: async ({ source }) => {
          requested.push(source);
          throw Object.assign(new Error('missing original'), { code: 'SESSION_ASSET_UNAVAILABLE' });
        },
      }),
      executeImagePayload: async () => { providerCalls += 1; },
    });
    await assert.rejects(() => handler({
      operation: 'edit', prompt: 'Change the background', referenceIds: ['locked'], targetReferenceId: 'locked',
    }, { toolCallId: 'call-1' }), (error) => error.code === 'invalid_reference'
      && error.reason === scenario.reason && error.referenceId === 'locked');
    assert.equal(providerCalls, 0);
    assert.deepEqual(requested, scenario.src ? [scenario.src] : []);
  });
}
