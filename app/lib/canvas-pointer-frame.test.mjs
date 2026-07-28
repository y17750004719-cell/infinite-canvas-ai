import test from 'node:test';
import assert from 'node:assert/strict';

import { createLatestFrameBatcher } from './canvas-pointer-frame.mjs';

const createFrameHarness = () => {
  let nextFrameId = 1;
  let latestValue = null;
  const queuedFrames = new Map();
  const cancelledFrames = new Set();
  const deliveries = [];
  const batcher = createLatestFrameBatcher({
    requestFrame: (callback) => {
      const frameId = nextFrameId++;
      queuedFrames.set(frameId, callback);
      return frameId;
    },
    cancelFrame: (frameId) => {
      cancelledFrames.add(frameId);
      queuedFrames.delete(frameId);
    },
    flush: () => {
      deliveries.push(latestValue);
    },
  });

  return {
    batcher,
    cancelledFrames,
    deliveries,
    push(value) {
      latestValue = value;
      batcher.schedule();
    },
    runNextFrame() {
      const next = queuedFrames.entries().next().value;
      if (!next) return false;
      const [frameId, callback] = next;
      queuedFrames.delete(frameId);
      callback(frameId * 16);
      return true;
    },
    queuedFrameCount() {
      return queuedFrames.size;
    },
  };
};

test('pointer input bursts deliver only the latest value once per animation frame', () => {
  const harness = createFrameHarness();

  harness.push({ x: 10, y: 20 });
  harness.push({ x: 30, y: 40 });
  harness.push({ x: 50, y: 60 });

  assert.equal(harness.queuedFrameCount(), 1);
  assert.deepEqual(harness.deliveries, []);
  assert.equal(harness.runNextFrame(), true);
  assert.deepEqual(harness.deliveries, [{ x: 50, y: 60 }]);
});

test('new input after a delivered frame schedules the next frame', () => {
  const harness = createFrameHarness();

  harness.push(1);
  harness.runNextFrame();
  harness.push(2);

  assert.equal(harness.queuedFrameCount(), 1);
  harness.runNextFrame();
  assert.deepEqual(harness.deliveries, [1, 2]);
});

test('flushNow cancels a queued frame and delivers the latest value exactly once', () => {
  const harness = createFrameHarness();

  harness.push({ x: 12, y: 18 });
  harness.push({ x: 70, y: 90 });
  harness.batcher.flushNow();

  assert.equal(harness.queuedFrameCount(), 0);
  assert.equal(harness.cancelledFrames.size, 1);
  assert.deepEqual(harness.deliveries, [{ x: 70, y: 90 }]);
  assert.equal(harness.runNextFrame(), false);
});

test('cancel removes a queued frame without delivering it', () => {
  const harness = createFrameHarness();

  harness.push({ x: 4, y: 8 });
  harness.batcher.cancel();

  assert.equal(harness.queuedFrameCount(), 0);
  assert.equal(harness.cancelledFrames.size, 1);
  assert.deepEqual(harness.deliveries, []);
});
