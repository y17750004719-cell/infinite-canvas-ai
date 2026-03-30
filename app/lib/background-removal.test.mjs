import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';

import {
  extractBackgroundRemovalFileResult,
  resolveBackgroundRemovalSource,
} from './background-removal.mjs';

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

test('resolveBackgroundRemovalSource rejects traversal attempts and unsupported schemes', () => {
  const publicDir = path.join(process.cwd(), 'public');

  assert.throws(
    () =>
      resolveBackgroundRemovalSource('/%2e%2e/secrets.png', {
        publicDir,
        requestOrigin: 'http://localhost:3000',
      }),
    /Invalid image URL/
  );

  assert.throws(
    () =>
      resolveBackgroundRemovalSource('ftp://example.com/file.png', {
        publicDir,
        requestOrigin: 'http://localhost:3000',
      }),
    /Invalid image URL/
  );
});

test('extractBackgroundRemovalFileResult accepts gradio file outputs from strings, objects, and data tuples', () => {
  assert.equal(
    extractBackgroundRemovalFileResult('https://example.com/output.png'),
    'https://example.com/output.png'
  );

  assert.equal(
    extractBackgroundRemovalFileResult({ path: '/tmp/gradio/output.png' }),
    '/tmp/gradio/output.png'
  );

  assert.equal(
    extractBackgroundRemovalFileResult({
      data: [{ url: 'https://example.com/download/output.png' }],
    }),
    'https://example.com/download/output.png'
  );
});

test('extractBackgroundRemovalFileResult throws when gradio does not return a usable file reference', () => {
  assert.throws(() => extractBackgroundRemovalFileResult({ data: [null] }), /No background removal file returned/);
});
