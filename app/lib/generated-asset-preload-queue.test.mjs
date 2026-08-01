import test from 'node:test';
import assert from 'node:assert/strict';

import { runGeneratedAssetPreloadQueue } from './generated-asset-preload-queue.mjs';

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

test('preloads two jobs concurrently and returns results in enqueue order', async () => {
  const loads = [deferred(), deferred(), deferred()];
  const started = [];
  const resultPromise = runGeneratedAssetPreloadQueue(
    ['first', 'second', 'third'],
    (job, index) => {
      started.push(job);
      return loads[index].promise;
    },
  );

  await Promise.resolve();
  assert.deepEqual(started, ['first', 'second']);

  loads[1].resolve('loaded second');
  await Promise.resolve();
  assert.deepEqual(started, ['first', 'second', 'third']);

  loads[2].resolve('loaded third');
  loads[0].resolve('loaded first');

  assert.deepEqual(await resultPromise, [
    { status: 'fulfilled', value: 'loaded first' },
    { status: 'fulfilled', value: 'loaded second' },
    { status: 'fulfilled', value: 'loaded third' },
  ]);
});

test('aborting stops new jobs and excludes results that were not committed yet', async () => {
  const controller = new AbortController();
  const loads = [deferred(), deferred(), deferred(), deferred()];
  const started = [];
  const resultPromise = runGeneratedAssetPreloadQueue(
    ['first', 'second', 'third', 'fourth'],
    (job, index) => {
      started.push(job);
      return loads[index].promise;
    },
    { signal: controller.signal },
  );

  loads[0].resolve('loaded first');
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(started, ['first', 'second', 'third']);

  controller.abort();
  loads[1].resolve('loaded second');
  loads[2].resolve('loaded third');

  assert.deepEqual(await resultPromise, [
    { status: 'fulfilled', value: 'loaded first' },
  ]);
  assert.deepEqual(started, ['first', 'second', 'third']);
});

test('isolates a failed job and continues with later jobs', async () => {
  const result = await runGeneratedAssetPreloadQueue(
    ['first', 'broken', 'third'],
    async (job) => {
      if (job === 'broken') throw new Error('broken preload');
      return `loaded ${job}`;
    },
    { concurrency: 1 },
  );

  assert.equal(result.length, 3);
  assert.deepEqual(result[0], { status: 'fulfilled', value: 'loaded first' });
  assert.equal(result[1].status, 'rejected');
  assert.match(result[1].reason.message, /broken preload/);
  assert.deepEqual(result[2], { status: 'fulfilled', value: 'loaded third' });
});

test('does not start jobs when already aborted', async () => {
  const controller = new AbortController();
  controller.abort();
  let calls = 0;

  assert.deepEqual(
    await runGeneratedAssetPreloadQueue(['first'], async () => {
      calls += 1;
      return 'unexpected';
    }, { signal: controller.signal }),
    [],
  );
  assert.equal(calls, 0);
});
