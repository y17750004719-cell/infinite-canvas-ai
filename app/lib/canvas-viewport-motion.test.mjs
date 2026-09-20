import test from 'node:test';
import assert from 'node:assert/strict';

import {
  clampCanvasAnchor,
  clampCanvasScale,
  getCanvasViewportAtAnchor,
  normalizeCanvasWheelDelta,
} from './canvas-viewport-motion.mjs';

const getWorldPoint = (viewport, anchor) => ({
  x: (anchor.x - viewport.x) / viewport.scale,
  y: (anchor.y - viewport.y) / viewport.scale,
});

test('anchor zoom preserves the world point under the pointer', () => {
  const viewport = { x: 180, y: -95, scale: 0.75 };
  const anchor = { x: 640, y: 360 };
  const before = getWorldPoint(viewport, anchor);
  const nextViewport = getCanvasViewportAtAnchor(viewport, 1.8, anchor);
  assert.deepEqual(getWorldPoint(nextViewport, anchor), before);
});

test('canvas scale and wheel delta normalization remain bounded', () => {
  assert.equal(clampCanvasScale(-1), 0.1);
  assert.equal(clampCanvasScale(100), 10);
  assert.equal(normalizeCanvasWheelDelta(10, 1, 800), 120);
  assert.equal(normalizeCanvasWheelDelta(-2, 2, 800), -120);
});

test('canvas anchors are clamped to canvas metrics', () => {
  assert.deepEqual(clampCanvasAnchor({ x: -20, y: 900 }, { width: 1200, height: 700 }), {
    x: 0,
    y: 700,
  });
});
