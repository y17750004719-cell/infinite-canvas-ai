import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  ensureCanvasImageLodFile,
  writeImageFileWithCanvasLods,
} from './canvas-image-lod-server.mjs';

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64'
);

test('local image writes create reusable WebP canvas LOD files', async () => {
  const runtimeDir = await mkdtemp(path.join(os.tmpdir(), 'canvas-lod-write-'));
  const filePath = path.join(runtimeDir, 'uploads', 'generated', 'sample.png');

  try {
    await writeImageFileWithCanvasLods({
      filePath,
      relativeAssetPath: 'uploads/generated/sample.png',
      buffer: PNG_1X1,
      runtimeDir,
    });

    const lod = await readFile(
      path.join(runtimeDir, 'uploads', '.canvas-lod', 'generated', 'sample.png', 'w256.webp')
    );
    assert.equal(lod.subarray(0, 4).toString('ascii'), 'RIFF');
    assert.equal(lod.subarray(8, 12).toString('ascii'), 'WEBP');
  } finally {
    await rm(runtimeDir, { recursive: true, force: true });
  }
});

test('legacy local images generate a requested LOD on first access', async () => {
  const runtimeDir = await mkdtemp(path.join(os.tmpdir(), 'canvas-lod-ensure-'));
  const originalDir = path.join(runtimeDir, 'uploads', 'generated');

  try {
    await mkdir(originalDir, { recursive: true });
    await writeFile(path.join(originalDir, 'legacy.png'), PNG_1X1);

    const result = await ensureCanvasImageLodFile({
      relativeLodPath: 'uploads/.canvas-lod/generated/legacy.png/w640.webp',
      runtimeDir,
    });

    assert.equal(
      result?.filePath,
      path.join(runtimeDir, 'uploads', '.canvas-lod', 'generated', 'legacy.png', 'w640.webp')
    );
    assert.equal(result?.fallbackFilePath, null);
  } finally {
    await rm(runtimeDir, { recursive: true, force: true });
  }
});

test('failed LOD conversion falls back to the original image file', async () => {
  const runtimeDir = await mkdtemp(path.join(os.tmpdir(), 'canvas-lod-fallback-'));
  const originalDir = path.join(runtimeDir, 'uploads', 'generated');
  const originalPath = path.join(originalDir, 'broken.png');

  try {
    await mkdir(originalDir, { recursive: true });
    await writeFile(originalPath, Buffer.from('not an image'));

    const result = await ensureCanvasImageLodFile({
      relativeLodPath: 'uploads/.canvas-lod/generated/broken.png/w640.webp',
      runtimeDir,
    });

    assert.deepEqual(result, {
      filePath: originalPath,
      fallbackFilePath: originalPath,
    });
  } finally {
    await rm(runtimeDir, { recursive: true, force: true });
  }
});

test('every runtime image writer pre-generates canvas LODs', async () => {
  const writerSources = await Promise.all([
    readFile(new URL('../api/upload/route.ts', import.meta.url), 'utf8'),
    readFile(new URL('../api/generate/route.ts', import.meta.url), 'utf8'),
    readFile(new URL('../api/image-tools/remove-background/route.ts', import.meta.url), 'utf8'),
    readFile(new URL('./skill-jobs.ts', import.meta.url), 'utf8'),
  ]);

  writerSources.forEach((source) => {
    assert.equal(source.includes('writeImageFileWithCanvasLods'), true);
  });
});
