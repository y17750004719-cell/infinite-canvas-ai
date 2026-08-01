import test from 'node:test';
import assert from 'node:assert/strict';

import {
  preloadGeneratedAsset,
  preloadGeneratedAssets,
} from './preload-generated-assets.mjs';

test('times out each attempt and retries once with a cache-busted URL', async () => {
  const requested = [];
  const loadImage = (src) => {
    requested.push(src);
    return new Promise(() => {});
  };

  await assert.rejects(
    preloadGeneratedAsset({ src: '/asset.png' }, { loadImage, timeoutMs: 5 }),
    /timed out after 5ms/,
  );
  assert.equal(requested.length, 2);
  assert.equal(requested[0], '/asset.png');
  assert.match(requested[1], /[?&]agent_retry=1/);
});

test('returns the retry result when the first image load fails', async () => {
  let attempts = 0;
  const result = await preloadGeneratedAsset(
    { src: '/asset.png', naturalWidth: 120 },
    {
      timeoutMs: 20,
      loadImage: async (src) => {
        attempts += 1;
        if (attempts === 1) throw new Error('temporary failure');
        assert.match(src, /agent_retry=1/);
        return { naturalWidth: 640, naturalHeight: 480 };
      },
    },
  );

  assert.equal(attempts, 2);
  assert.deepEqual(result, {
    asset: { src: '/asset.png', naturalWidth: 120 },
    naturalWidth: 120,
    naturalHeight: 480,
  });
});

test('rejects after the initial load and one retry both fail', async () => {
  let attempts = 0;
  await assert.rejects(
    preloadGeneratedAsset(
      { src: '/broken.png' },
      {
        timeoutMs: 20,
        loadImage: async () => {
          attempts += 1;
          throw new Error(`failure ${attempts}`);
        },
      },
    ),
    /failure 2/,
  );
  assert.equal(attempts, 2);
});

test('batch preloading returns successful assets and isolated final failures', async () => {
  const result = await preloadGeneratedAssets(
    [{ src: '/ok.png' }, { src: '/broken.png' }],
    {
      timeoutMs: 20,
      loadImage: async (src) => {
        if (src.includes('broken')) throw new Error('broken');
        return { naturalWidth: 800, naturalHeight: 600 };
      },
    },
  );

  assert.equal(result.fulfilled.length, 1);
  assert.equal(result.fulfilled[0].asset.src, '/ok.png');
  assert.equal(result.failed.length, 1);
  assert.equal(result.failed[0].asset.src, '/broken.png');
});

test('aborting a preload rejects immediately without starting a retry', async () => {
  const controller = new AbortController();
  let attempts = 0;
  const pending = preloadGeneratedAsset(
    { src: '/slow.png' },
    {
      timeoutMs: 20_000,
      signal: controller.signal,
      loadImage: () => {
        attempts += 1;
        return new Promise(() => {});
      },
    },
  );

  controller.abort();
  await assert.rejects(pending, { name: 'AbortError' });
  assert.equal(attempts, 1);
});
