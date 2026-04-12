import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, mkdir, rm, writeFile, utimes } from 'node:fs/promises';

import { listGeneratedImageArchiveEntries } from './generated-image-history-archive.mjs';

const PNG_1X1 = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c6360000002000154a24f5d0000000049454e44ae426082',
  'hex'
);

test('listGeneratedImageArchiveEntries scans local generated files and sorts newest first', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'generated-history-archive-'));
  const generatedDir = path.join(tempDir, 'runtime', 'uploads', 'generated');

  try {
    await mkdir(generatedDir, { recursive: true });
    await writeFile(path.join(generatedDir, 'img-1700000001000-old.png'), PNG_1X1);
    await writeFile(path.join(generatedDir, 'img-1700000003000-new.png'), PNG_1X1);
    await writeFile(path.join(generatedDir, 'notes.txt'), 'ignore me');

    const mtime = new Date('2022-01-01T00:00:02.000Z');
    await writeFile(path.join(generatedDir, 'poster-no-timestamp.png'), PNG_1X1);
    await utimes(path.join(generatedDir, 'poster-no-timestamp.png'), mtime, mtime);

    const result = await listGeneratedImageArchiveEntries({ directoryPath: generatedDir });

    assert.deepEqual(
      result.map((entry) => ({ src: entry.src, source: entry.source })),
      [
        { src: '/api/local-assets/uploads/generated/img-1700000003000-new.png', source: 'archive' },
        { src: '/api/local-assets/uploads/generated/img-1700000001000-old.png', source: 'archive' },
        { src: '/api/local-assets/uploads/generated/poster-no-timestamp.png', source: 'archive' },
      ]
    );
    assert.equal(result[0].createdAt, 1700000003000);
    assert.equal(result[0].naturalWidth, 1);
    assert.equal(result[0].naturalHeight, 1);
    assert.equal(result[2].createdAt, mtime.getTime());
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
