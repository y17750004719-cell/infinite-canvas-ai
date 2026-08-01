import test from 'node:test';
import assert from 'node:assert/strict';
import { invokeWithOriginalAsset } from './original-asset.mjs';

test('missing pinned original stops before provider invocation without preview or latest fallback', async () => {
  let providerCalls = 0;
  await assert.rejects(() => invokeWithOriginalAsset({
    targetReferenceId: 'task-slot:slot-1',
    pinnedVersionId: 'version-old',
    editBaseAsset: { versionId: 'version-old', src: '', plannerPreviewSrc: '/preview.webp' },
    activeVersions: [{ referenceId: 'task-slot:slot-1', versionId: 'version-new', src: '/new-original.png' }],
    references: [{ id: 'task-slot:slot-1', src: '/new-original.png' }],
  }, async () => {
    providerCalls += 1;
  }), /missing_original_asset/);
  assert.equal(providerCalls, 0);
});
