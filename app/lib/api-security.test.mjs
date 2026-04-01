import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import * as apiSecurity from './api-security.mjs';
import {
  createStoredImageName,
  parseImageDataUrl,
  resolvePublicAssetPath,
} from './api-security.mjs';

const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
const JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xdb, 0x00]);

test('parseImageDataUrl accepts a supported image payload and rewrites extension from mime', () => {
  const parsed = parseImageDataUrl(`data:image/png;base64,${PNG_BYTES.toString('base64')}`, {
    maxBytes: 1024,
  });

  assert.equal(parsed.mimeType, 'image/png');
  assert.equal(parsed.extension, 'png');
  assert.deepEqual(parsed.buffer, PNG_BYTES);
});

test('parseImageDataUrl rejects unsupported image types', () => {
  assert.throws(
    () =>
      parseImageDataUrl('data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=', {
        maxBytes: 1024,
      }),
    /Unsupported image type/
  );
});

test('parseImageDataUrl rejects payloads whose binary signature mismatches the declared mime', () => {
  assert.throws(
    () =>
      parseImageDataUrl(`data:image/jpeg;base64,${PNG_BYTES.toString('base64')}`, {
        maxBytes: 1024,
      }),
    /does not match the declared image type/
  );
});

test('parseImageDataUrl rejects payloads larger than the configured limit', () => {
  assert.throws(
    () =>
      parseImageDataUrl(`data:image/jpeg;base64,${JPEG_BYTES.toString('base64')}`, {
        maxBytes: 4,
      }),
    /Image payload is too large/
  );
});

test('createStoredImageName ignores user input and only keeps the safe extension', () => {
  const generated = createStoredImageName('webp', { now: 42, randomSuffix: 'safeid' });
  assert.equal(generated, 'img-42-safeid.webp');
});

test('resolvePublicAssetPath accepts files that stay inside the public directory', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zo-public-'));
  const publicDir = path.join(tempRoot, 'public');
  const assetPath = path.join(publicDir, 'uploads', 'sample.png');
  fs.mkdirSync(path.dirname(assetPath), { recursive: true });
  fs.writeFileSync(assetPath, PNG_BYTES);

  const resolved = resolvePublicAssetPath('/uploads/sample.png?cache=1', { publicDir });
  assert.equal(resolved, assetPath);
});

test('resolvePublicAssetPath rejects traversal attempts that escape the public directory', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zo-public-'));
  const publicDir = path.join(tempRoot, 'public');
  fs.mkdirSync(publicDir, { recursive: true });

  const resolved = resolvePublicAssetPath('/%2e%2e/secrets.txt', { publicDir });
  assert.equal(resolved, null);
});

test('resolvePublicAssetDataUrl only reads image files that stay inside the public directory', () => {
  assert.equal(typeof apiSecurity.resolvePublicAssetDataUrl, 'function');

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zo-public-'));
  const publicDir = path.join(tempRoot, 'public');
  const assetPath = path.join(publicDir, 'uploads', 'sample.png');
  fs.mkdirSync(path.dirname(assetPath), { recursive: true });
  fs.writeFileSync(assetPath, PNG_BYTES);

  const resolved = apiSecurity.resolvePublicAssetDataUrl('/uploads/sample.png?cache=1', {
    publicDir,
    allowedExtensions: ['.png', '.jpg', '.jpeg', '.webp', '.gif'],
  });

  assert.equal(resolved, `data:image/png;base64,${PNG_BYTES.toString('base64')}`);
  assert.equal(
    apiSecurity.resolvePublicAssetDataUrl('/%2e%2e/secrets.png', {
      publicDir,
      allowedExtensions: ['.png', '.jpg', '.jpeg', '.webp', '.gif'],
    }),
    null
  );
});
