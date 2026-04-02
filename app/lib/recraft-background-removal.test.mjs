import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';

import {
  createRecraftBackgroundRemovalRequest,
  extractRecraftBackgroundRemovalUrl,
  resolveBackgroundRemovalSource,
  resolveBackgroundRemovalEndpoints,
} from './recraft-background-removal.mjs';

const PNG_1X1 = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c6360000002000154a24f5d0000000049454e44ae426082',
  'hex'
);

test('resolveBackgroundRemovalSource resolves public relative paths into local files', () => {
  const publicDir = path.join(process.cwd(), 'public');

  assert.deepEqual(
    resolveBackgroundRemovalSource('/uploads/example.png', {
      publicDir,
      requestOrigin: 'http://localhost:3000',
    }),
    {
      kind: 'local',
      value: path.join(publicDir, 'uploads', 'example.png'),
    }
  );
});

test('resolveBackgroundRemovalSource treats same-origin asset urls as local files and remote https urls as remote', () => {
  const publicDir = path.join(process.cwd(), 'public');

  assert.deepEqual(
    resolveBackgroundRemovalSource('http://localhost:3000/uploads/generated/sample.png?cache=1', {
      publicDir,
      requestOrigin: 'http://localhost:3000',
    }),
    {
      kind: 'local',
      value: path.join(publicDir, 'uploads', 'generated', 'sample.png'),
    }
  );

  assert.deepEqual(
    resolveBackgroundRemovalSource('https://example.com/remote.png', {
      publicDir,
      requestOrigin: 'http://localhost:3000',
    }),
    {
      kind: 'remote',
      value: 'https://example.com/remote.png',
    }
  );
});

test('createRecraftBackgroundRemovalRequest sends file uploads with fixed response_format=url', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'recraft-bg-remove-'));
  const publicDir = path.join(tempDir, 'public');
  const uploadsDir = path.join(publicDir, 'uploads');

  try {
    await mkdir(uploadsDir, { recursive: true });
    await writeFile(path.join(uploadsDir, 'sample.png'), PNG_1X1);

    const request = await createRecraftBackgroundRemovalRequest({
      imageUrl: '/uploads/sample.png',
      publicDir,
      requestOrigin: 'http://localhost:3000',
      apiKey: 'test-key',
      baseUrl: 'https://gpt-best.cn/',
    });

    assert.equal(request.endpoint, 'https://gpt-best.cn/recraft/v1/images/removeBackground');
    assert.equal(request.headers.Authorization, 'Bearer test-key');
    assert.equal(request.body.get('response_format'), 'url');
    assert.ok(request.body.get('file') instanceof Blob);
    assert.deepEqual(request.sourceMeta, {
      sourceKind: 'local',
      sourceFileName: 'sample.png',
      sourceMimeType: 'image/png',
      sourceSizeBytes: PNG_1X1.length,
      sourceRefPreview: '/uploads/sample.png',
      responseFormat: 'url',
    });
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('resolveBackgroundRemovalEndpoints keeps the documented runtime path and exposes a versioned COMFLY candidate', () => {
  assert.deepEqual(
    resolveBackgroundRemovalEndpoints('https://ai.comfly.chat/v1'),
    {
      runtimeEndpoint: 'https://ai.comfly.chat/recraft/v1/images/removeBackground',
      candidateEndpoints: [
        'https://ai.comfly.chat/recraft/v1/images/removeBackground',
        'https://ai.comfly.chat/v1/recraft/v1/images/removeBackground',
      ],
    }
  );
});

test('createRecraftBackgroundRemovalRequest marks remote uploads with source metadata', async () => {
  const request = await createRecraftBackgroundRemovalRequest({
    imageUrl: 'https://example.com/assets/remote-input.png?token=secret',
    publicDir: path.join(process.cwd(), 'public'),
    requestOrigin: 'http://localhost:3000',
    apiKey: 'test-key',
    baseUrl: 'https://ai.comfly.chat/v1',
    fetchImpl: async () =>
      new Response(PNG_1X1, {
        status: 200,
        headers: {
          'content-type': 'image/png',
          'content-length': String(PNG_1X1.length),
        },
      }),
  });

  assert.equal(request.endpoint, 'https://ai.comfly.chat/recraft/v1/images/removeBackground');
  assert.deepEqual(request.sourceMeta, {
    sourceKind: 'remote',
    sourceFileName: 'remote-input.png',
    sourceMimeType: 'image/png',
    sourceSizeBytes: PNG_1X1.length,
    sourceRefPreview: 'https://example.com/assets/remote-input.png',
    responseFormat: 'url',
  });
});

test('extractRecraftBackgroundRemovalUrl reads the supplier image url and rejects missing results', () => {
  assert.equal(
    extractRecraftBackgroundRemovalUrl({
      image: {
        url: 'https://example.com/output.png',
      },
    }),
    'https://example.com/output.png'
  );

  assert.throws(
    () => extractRecraftBackgroundRemovalUrl({ image: {} }),
    /No background removal image URL returned/
  );
});
