import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';

import {
  isSessionVisualAssetAvailable,
  materializeSessionVisualAsset,
  normalizeSessionVisualAssets,
  SessionVisualAssetError,
  readSessionVisualAsset,
  removeSessionVisualAssets,
} from './session-visual-assets.mjs';

const PNG_1X1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
const JPEG_1X1 = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);

const fixtureDirectories = [];
after(async () => {
  for (const directory of fixtureDirectories) await rm(directory, { recursive: true, force: true });
});

async function runtimeFixture() {
  const directory = await mkdtemp(path.join(tmpdir(), 'zo-session-assets-'));
  fixtureDirectories.push(directory);
  return directory;
}

test('materializes data URL into session-isolated durable asset and deduplicates content', async () => {
  const runtimeDir = await runtimeFixture();
  const src = `data:image/png;base64,${PNG_1X1.toString('base64')}`;
  const first = await materializeSessionVisualAsset({ sessionId: 'session-a', source: { src, source: 'generated' }, runtimeDir });
  const second = await materializeSessionVisualAsset({ sessionId: 'session-a', source: src, runtimeDir });
  assert.equal(first.contentHash, second.contentHash);
  assert.equal(first.durableSrc, second.durableSrc);
  assert.equal(first.source, 'generated');
  assert.equal(first.originalSrc, undefined);
  assert.equal(await isSessionVisualAssetAvailable(first, { runtimeDir }), true);
  assert.deepEqual(await readSessionVisualAsset(first, { runtimeDir }), PNG_1X1);
});

test('reads and snapshots a local API asset with declared extension/signature validation', async () => {
  const runtimeDir = await runtimeFixture();
  const inputPath = path.join(runtimeDir, 'uploads/input.png');
  await mkdir(path.dirname(inputPath), { recursive: true });
  await writeFile(inputPath, PNG_1X1);
  const asset = await materializeSessionVisualAsset({
    sessionId: 'session-local',
    source: { src: '/api/local-assets/uploads/input.png', source: 'canvas', sourceReferenceId: 'canvas:1' },
    runtimeDir,
  });
  assert.equal(asset.mimeType, 'image/png');
  assert.equal(asset.sourceReferenceId, 'canvas:1');
  assert.deepEqual(await readSessionVisualAsset(asset, { runtimeDir }), PNG_1X1);
});

test('fetches remote image and rejects unsupported or mismatched payloads', async () => {
  const runtimeDir = await runtimeFixture();
  const fetchImpl = async () => new Response(PNG_1X1, { status: 200, headers: { 'content-type': 'image/png' } });
  const asset = await materializeSessionVisualAsset({ sessionId: 'session-remote', source: 'https://example.test/image.png', runtimeDir, fetchImpl });
  assert.equal(asset.mimeType, 'image/png');
  await assert.rejects(
    materializeSessionVisualAsset({
      sessionId: 'session-bad',
      source: 'https://example.test/image.jpg',
      runtimeDir,
      fetchImpl: async () => new Response(PNG_1X1, { status: 200, headers: { 'content-type': 'image/jpeg' } }),
    }),
    (error) => error instanceof SessionVisualAssetError
      && error.code === 'SESSION_ASSET_SNAPSHOT_FAILED'
      && /does not match the declared image type/.test(String(error.cause?.message || '')),
  );
  await assert.rejects(
    materializeSessionVisualAsset({
      sessionId: 'session-type',
      source: 'https://example.test/image.svg',
      runtimeDir,
      fetchImpl: async () => new Response('<svg/>', { status: 200, headers: { 'content-type': 'image/svg+xml' } }),
    }),
    (error) => error instanceof SessionVisualAssetError
      && error.code === 'SESSION_ASSET_SNAPSHOT_FAILED'
      && /Unsupported image type/.test(String(error.cause?.message || '')),
  );
});

test('enforces twelve MiB limit and removes only the requested session directory', async () => {
  const runtimeDir = await runtimeFixture();
  const one = await materializeSessionVisualAsset({ sessionId: 'session-one', source: `data:image/png;base64,${PNG_1X1.toString('base64')}`, runtimeDir });
  const two = await materializeSessionVisualAsset({ sessionId: 'session-two', source: `data:image/png;base64,${PNG_1X1.toString('base64')}`, runtimeDir });
  await removeSessionVisualAssets('session-one', { runtimeDir });
  assert.equal(await isSessionVisualAssetAvailable(one, { runtimeDir }), false);
  assert.equal(await isSessionVisualAssetAvailable(two, { runtimeDir }), true);
  const oversized = Buffer.alloc(12 * 1024 * 1024 + 1, 0);
  await assert.rejects(
    materializeSessionVisualAsset({ sessionId: 'session-large', source: { src: `data:image/jpeg;base64,${Buffer.concat([JPEG_1X1, oversized]).toString('base64')}` }, runtimeDir }),
    (error) => error instanceof SessionVisualAssetError
      && error.code === 'SESSION_ASSET_SNAPSHOT_FAILED'
      && /too large/.test(String(error.cause?.message || '')),
  );
});

test('normalizes bounded session metadata and drops malformed or duplicate entries', () => {
  const valid = {
    id: 'asset-1', sessionId: 'session', durableSrc: '/api/local-assets/uploads/session-assets/x/hash.png',
    contentHash: 'a'.repeat(64), mimeType: 'image/png', source: 'generated', byteSize: 4, createdAt: 7,
  };
  const result = normalizeSessionVisualAssets([valid, valid, { ...valid, id: '' }, { ...valid, id: 'asset-2', mimeType: 'image/svg+xml' }], { sessionId: 'session', maxItems: 3 });
  assert.equal(result.length, 1);
  assert.equal(result[0].sessionId, 'session');
});

test('metadata rejects foreign and ownerless assets rather than rebinding them', () => {
  const base = {
    id: 'asset-1', durableSrc: '/api/local-assets/uploads/session-assets/x/hash.png',
    contentHash: 'a'.repeat(64), mimeType: 'image/png', source: 'generated',
  };
  assert.deepEqual(normalizeSessionVisualAssets([base, { ...base, sessionId: 'other' }], { sessionId: 'session' }), []);
});

test('existing asset is reused when durable content exists and rejects changed original content', async () => {
  const runtimeDir = await runtimeFixture();
  const src = `data:image/png;base64,${PNG_1X1.toString('base64')}`;
  const asset = await materializeSessionVisualAsset({ sessionId: 'session-existing', source: src, runtimeDir });
  const reused = await materializeSessionVisualAsset({ sessionId: 'session-existing', existingAsset: asset, source: src, runtimeDir });
  assert.equal(reused.id, asset.id);
  await assert.rejects(
    materializeSessionVisualAsset({
      sessionId: 'session-existing',
      existingAsset: { ...asset, durableSrc: '/api/local-assets/uploads/session-assets/missing.png' },
      source: `data:image/jpeg;base64,${JPEG_1X1.toString('base64')}`,
      runtimeDir,
    }),
    (error) => error instanceof SessionVisualAssetError && error.code === 'SESSION_ASSET_UNAVAILABLE'
  );
});

test('rejects missing and path-traversing local asset sources', async () => {
  const runtimeDir = await runtimeFixture();
  for (const source of [
    '/api/local-assets/uploads/missing.png',
    '/api/local-assets/../../etc/passwd.png',
  ]) {
    await assert.rejects(
      materializeSessionVisualAsset({ sessionId: 'session-path', source, runtimeDir }),
      (error) => error instanceof SessionVisualAssetError
        && error.code === 'SESSION_ASSET_SNAPSHOT_FAILED',
    );
  }
});

test('rejects image payloads that have a valid signature but cannot be decoded', async () => {
  const runtimeDir = await runtimeFixture();
  // Keep the valid PNG signature while truncating the payload so signature
  // validation passes but the decoder rejects it.
  const corruptPng = PNG_1X1.subarray(0, 20);
  await assert.rejects(
    materializeSessionVisualAsset({
      sessionId: 'session-corrupt',
      source: `data:image/png;base64,${corruptPng.toString('base64')}`,
      runtimeDir,
    }),
    (error) => error instanceof SessionVisualAssetError
      && error.code === 'image_decode_failed'
      && error.cause?.code === 'image_decode_failed',
  );
});

test('rejects images whose dimensions exceed the execution limit', async () => {
  const runtimeDir = await runtimeFixture();
  const oversized = await sharp({ create: { width: 16385, height: 1, channels: 3, background: '#fff' } })
    .png()
    .toBuffer();
  await assert.rejects(
    materializeSessionVisualAsset({
      sessionId: 'session-dimensions',
      source: `data:image/png;base64,${oversized.toString('base64')}`,
      runtimeDir,
    }),
    (error) => error instanceof SessionVisualAssetError
      && error.code === 'image_dimension_invalid'
      && error.cause?.code === 'image_dimension_invalid',
  );
});
