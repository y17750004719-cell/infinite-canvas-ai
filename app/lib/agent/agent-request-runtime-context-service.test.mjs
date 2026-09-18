import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSucceededImageTaskIdentities } from './agent-request-runtime-context-service.mjs';
import { createAgentImageExecutionFlow } from './agent-image-execution-flow.mjs';

const reservation = {
  taskId: 'task-partial',
  identities: [
    { taskId: 'task-partial', slotId: 'slot-first', versionId: 'version-first' },
    { taskId: 'task-partial', slotId: 'slot-second', versionId: 'version-second' },
  ],
};
const items = [{ id: 'first', label: '第一张' }, { id: 'second', label: '第二张' }];
const selection = { selection: { providerId: 'mock', model: 'mock-image' } };

test('partial image success preserves the delivered slot, version and asset in its task snapshot', async () => {
  const events = [];
  let completed = [];
  let calls = 0;
  const flow = createAgentImageExecutionFlow({
    runId: 'run-partial', taskId: reservation.taskId, sessionId: 'session-partial',
    resolveSelection: async () => selection,
    resolveReferences: async () => ({}),
    buildRequests: async () => ({ requests: [{ index: 0 }, { index: 1 }] }),
    reserveTask: async () => reservation,
    executeBusinessOperation: null,
    requestProvider: async ({ body }) => {
      calls += 1;
      if (body.index === 0) throw new Error('first image provider failed');
      return { status: 'completed', result: { outputs: [{ assetId: 'asset-second', src: '/api/local-assets/second.png' }] } };
    },
    materializeAsset: async (asset) => ({ ...asset, durableSrc: asset.src }),
    recordSucceeded: (assets, reserved, selected, generatedItems) => {
      completed = buildSucceededImageTaskIdentities(assets, reserved, selected, generatedItems);
    },
    emit: (event) => events.push(event),
  });
  const result = await flow.execute({ finalPromptSource: 'two images', countMetadata: { totalCount: 2 }, generationItems: items });
  const delivered = events.find((event) => event.action?.type === 'add_generated_assets').action.assets[0];
  assert.equal(calls, 2);
  assert.deepEqual(result.requestStats, { requested: 2, succeeded: 1, failed: 1 });
  assert.equal(completed.length, 1);
  assert.equal(completed[0].slotId, delivered.slotId);
  assert.equal(completed[0].versionId, delivered.versionId);
  assert.equal(completed[0].assetId, delivered.assetId);
  assert.equal(completed[0].slotId, 'slot-second');
  assert.equal(completed[0].itemId, 'second');
  assert.equal(completed[0].label, '第二张');
  assert.equal(completed[0].index, 1);
});

test('successful image identities match versions or slots and retain positional fallback only for legacy assets', () => {
  const [version] = buildSucceededImageTaskIdentities([{ versionId: 'version-second', assetId: 'asset-version', src: '/version.png' }], reservation, selection, items);
  assert.equal(version.slotId, 'slot-second');
  assert.equal(version.index, 1);
  const [slot] = buildSucceededImageTaskIdentities([{ slotId: 'slot-second', assetId: 'asset-slot', src: '/slot.png' }], reservation, selection, items);
  assert.equal(slot.versionId, 'version-second');
  assert.equal(slot.index, 1);
  const [legacy] = buildSucceededImageTaskIdentities([{ id: 'legacy-asset', src: '/legacy.png' }], reservation, selection, items);
  assert.equal(legacy.slotId, 'slot-first');
  assert.equal(legacy.assetId, 'legacy-asset');
  const [unknown] = buildSucceededImageTaskIdentities([{ slotId: 'another-slot', versionId: 'another-version', assetId: 'another-asset', src: '/other.png' }], reservation, selection, items);
  assert.equal(unknown.slotId, 'another-slot');
  assert.equal(unknown.versionId, 'another-version');
  assert.equal(unknown.itemId, undefined);
});
