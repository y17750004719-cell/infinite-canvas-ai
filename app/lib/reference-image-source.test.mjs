import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  materializeChatMessageImages,
  readLocalReferenceImage,
  ReferenceImageUnavailableError,
} from './reference-image-source.mjs';

test('readLocalReferenceImage resolves canonical runtime asset URLs without server-side fetch', async () => {
  const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zo-reference-runtime-'));
  const generatedDir = path.join(runtimeDir, 'uploads', 'generated');
  fs.mkdirSync(generatedDir, { recursive: true });
  fs.writeFileSync(path.join(generatedDir, 'sample.png'), Buffer.from([137, 80, 78, 71]));

  const result = await readLocalReferenceImage('/api/local-assets/uploads/generated/sample.png?cache=1', {
    runtimeDir,
    publicDir: path.join(runtimeDir, 'public'),
  });

  assert.equal(result.mimeType, 'image/png');
  assert.deepEqual([...result.bytes], [137, 80, 78, 71]);
});

test('readLocalReferenceImage rejects missing and unsafe local references as non-retryable', async () => {
  const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zo-reference-missing-'));
  await assert.rejects(
    () => readLocalReferenceImage('/api/local-assets/uploads/generated/missing.png', { runtimeDir }),
    (error) => {
      assert.ok(error instanceof ReferenceImageUnavailableError);
      assert.equal(error.code, 'REFERENCE_IMAGE_UNAVAILABLE');
      assert.equal(error.isRetryable, false);
      assert.equal(error.statusCode, 404);
      return true;
    },
  );
  await assert.rejects(
    () => readLocalReferenceImage('/api/local-assets/../secret.png', { runtimeDir }),
    ReferenceImageUnavailableError,
  );
});

test('materializeChatMessageImages converts local references once and preserves remote URLs', async () => {
  let reads = 0;
  const result = await materializeChatMessageImages([{
    role: 'user',
    content: [
      { type: 'text', text: '分析图片' },
      { type: 'image_url', image_url: { url: '/api/local-assets/uploads/generated/sample.png' } },
      { type: 'image_url', image_url: { url: '/api/local-assets/uploads/generated/sample.png' } },
      { type: 'image_url', image_url: { url: 'https://example.test/reference.png' } },
    ],
  }], {
    readLocalReferenceImageImpl: async () => {
      reads += 1;
      return { bytes: Buffer.from([1, 2, 3]), mimeType: 'image/png' };
    },
  });

  assert.equal(reads, 1);
  assert.equal(result.localImageCount, 1);
  assert.equal(result.totalImageBytes, 3);
  assert.match(result.messages[0].content[1].image_url.url, /^data:image\/png;base64,/);
  assert.equal(result.messages[0].content[1].image_url.url, result.messages[0].content[2].image_url.url);
  assert.equal(result.messages[0].content[3].image_url.url, 'https://example.test/reference.png');
});

test('materializeChatMessageImages rejects invalid and oversized references before transport', async () => {
  await assert.rejects(
    () => materializeChatMessageImages([{
      role: 'user',
      content: [{ type: 'image_url', image_url: { url: 'relative.png' } }],
    }]),
    ReferenceImageUnavailableError,
  );
  await assert.rejects(
    () => materializeChatMessageImages([{
      role: 'user',
      content: [{ type: 'image_url', image_url: { url: '/api/local-assets/uploads/generated/large.png' } }],
    }], {
      maxImageBytes: 2,
      maxTotalBytes: 4,
      readLocalReferenceImageImpl: async () => ({ bytes: Buffer.from([1, 2, 3]), mimeType: 'image/png' }),
    }),
    (error) => error instanceof ReferenceImageUnavailableError && error.statusCode === 413,
  );
});
