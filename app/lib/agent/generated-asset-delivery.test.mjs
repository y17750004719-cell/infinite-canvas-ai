import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildGeneratedAssetDeliveryId,
  enrichGeneratedAssetDeliveryAction,
  collectPendingGeneratedAssetDeliveries,
  getGeneratedAssetDeliveryPresence,
} from './generated-asset-delivery.mjs';

test('delivery identity is stable across replay and URL changes when version identity exists', () => {
  const first = buildGeneratedAssetDeliveryId({
    runId: 'run-1', taskId: 'task-1',
    asset: { versionId: 'version-1', src: '/runtime/first.png' },
  });
  const replay = buildGeneratedAssetDeliveryId({
    runId: 'run-2', taskId: 'task-1',
    asset: { versionId: 'version-1', src: '/runtime/cache-busted.png' },
  });
  assert.equal(first, replay);
});

test('delivery action adds one stable id and additive event timestamp per asset', () => {
  const action = {
    type: 'add_generated_assets', runId: 'run-1', taskId: 'task-1',
    assets: [{ assetId: 'asset-1', src: '/runtime/asset-1.png', providerReturnedAt: 10, locallyStoredAt: 20 }],
  };
  const first = enrichGeneratedAssetDeliveryAction(action, { now: () => 30 });
  const replay = enrichGeneratedAssetDeliveryAction(first, { now: () => 40 });
  assert.equal(first.assets[0].deliveryId, replay.assets[0].deliveryId);
  assert.equal(replay.deliveryEventAt, 30);
  assert.equal(replay.assets[0].providerReturnedAt, 10);
  assert.equal(replay.assets[0].locallyStoredAt, 20);
});

test('legacy delivery identity remains stable for one run when durable ids are absent', () => {
  const first = buildGeneratedAssetDeliveryId({ runId: 'run-legacy', asset: { src: '/runtime/legacy.png' } });
  const duplicate = buildGeneratedAssetDeliveryId({ runId: 'run-legacy', asset: { src: '/runtime/legacy.png' } });
  assert.equal(first, duplicate);
});

test('delivery checks chat and canvas independently, including legacy source identities', () => {
  const asset = { deliveryId: 'delivery-1', assetId: 'asset-1', src: '/api/local-assets/a.png' };
  assert.deepEqual(getGeneratedAssetDeliveryPresence(asset, [{ imageUrl: asset.src }], []), { chat: true, canvas: false });
  assert.deepEqual(getGeneratedAssetDeliveryPresence(asset, [], [{ deliveryId: asset.deliveryId }]), { chat: false, canvas: true });
  assert.deepEqual(getGeneratedAssetDeliveryPresence(asset, [{ assetId: asset.assetId }], [{ src: asset.src }]), { chat: true, canvas: true });
});

test('restores persisted generated assets when the model fails before its delivery event', () => {
  const session = {
    id: 'session-1',
    messages: [{ taskSnapshot: { sessionId: 'session-1', taskId: 'task-1', activeVersions: [{ versionId: 'v1', assetUrl: '/api/local-assets/a.png' }] } }],
    visualAssets: [{ sessionId: 'session-1', source: 'generated', taskId: 'task-1', versionId: 'v1', id: 'asset-1', durableSrc: '/api/local-assets/a.png' }],
  };
  const assets = collectPendingGeneratedAssetDeliveries(session);
  assert.equal(assets.length, 1);
  assert.equal(assets[0].deliveryId, 'generated-delivery:v1');
  assert.equal(assets[0].assetId, 'asset-1');
  assert.equal(assets[0].src, '/api/local-assets/a.png');
});

test('journal recovery unwraps canonical events and excludes a different session', () => {
  const event = (sequence, payload, threadId = 'session-1') => ({ type: 'item.updated', threadId, taskId: 'task-1', operationId: 'op-1', runId: 'run-1', sequence, item: { type: 'public_event', payload } });
  const events = [
    event(1, { type: 'client_action', action: { type: 'register_session_visual_assets', sessionId: 'session-1', assets: [{ id: 'asset-1', sessionId: 'session-1', source: 'generated', taskId: 'task-1', versionId: 'v1', durableSrc: '/api/local-assets/a.png' }] } }),
    event(2, { type: 'agent_task_checkpoint', taskSnapshot: { sessionId: 'session-1', taskId: 'task-1', activeVersions: [{ versionId: 'v1', assetUrl: '/api/local-assets/a.png', naturalWidth: 2048 }] } }),
    event(3, { type: 'client_action', action: { type: 'add_generated_assets', assets: [{ versionId: 'foreign', src: '/api/local-assets/foreign.png' }] } }, 'other-session'),
  ];
  const assets = collectPendingGeneratedAssetDeliveries({ id: 'session-1' }, events);
  assert.equal(assets.length, 1);
  assert.equal(assets[0].naturalWidth, 2048);
  assert.equal(assets[0].assetId, 'asset-1');
});

test('settled history prevents deleted chat or canvas images from reappearing on reload', () => {
  const session = {
    id: 'session-1',
    messages: [{ taskSnapshot: { taskId: 'task-1', activeVersions: [{ versionId: 'v1', assetUrl: '/api/local-assets/a.png' }] } }],
    generatedImageHistory: [{ deliveryId: 'generated-delivery:v1', src: '/api/local-assets/a.png', source: 'chat', messageId: 'chat-1' }],
  };
  assert.deepEqual(collectPendingGeneratedAssetDeliveries(session), []);
});

test('recovery excludes uploads, unowned registrations, and invalid image sources', () => {
  const session = {
    id: 'session-1',
    visualAssets: [
      { id: 'upload', source: 'upload', sessionId: 'session-1', durableSrc: '/api/local-assets/upload.png' },
      { id: 'foreign', source: 'generated', sessionId: 'other-session', taskId: 'task-1', durableSrc: '/api/local-assets/foreign.png' },
      { id: 'orphan', source: 'generated', sessionId: 'session-1', durableSrc: '/api/local-assets/orphan.png' },
    ],
    messages: [{ taskSnapshot: { taskId: 'task-1', activeVersions: [
      { versionId: 'missing' }, { versionId: 'data', assetUrl: 'data:image/png;base64,AA' },
      { versionId: 'unsafe', assetUrl: 'javascript:alert(1)' },
    ] } }],
  };
  assert.deepEqual(collectPendingGeneratedAssetDeliveries(session), []);
});
