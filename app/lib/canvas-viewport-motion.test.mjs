import test from 'node:test';
import assert from 'node:assert/strict';

import {
  applyCanvasWheelDelta,
  clampCanvasAnchor,
  dampCanvasPanViewport,
  dampCanvasViewport,
  getCanvasPanTargetViewport,
  getCanvasSceneTransform,
  getCanvasViewportAtAnchor,
  isCanvasPanSettled,
  isCanvasViewportSettled,
  normalizeCanvasWheelDelta,
} from './canvas-viewport-motion.mjs';

const getWorldPoint = (viewport, anchor) => ({
  x: (anchor.x - viewport.x) / viewport.scale,
  y: (anchor.y - viewport.y) / viewport.scale,
});

const assertPointAlmostEqual = (actual, expected, epsilon = 0.001) => {
  assert.ok(Math.abs(actual.x - expected.x) < epsilon, `${actual.x} != ${expected.x}`);
  assert.ok(Math.abs(actual.y - expected.y) < epsilon, `${actual.y} != ${expected.y}`);
};

const projectWorldPointThroughSceneTransform = (worldPoint, renderedViewport, visualViewport) => {
  const sceneTransform = getCanvasSceneTransform(renderedViewport, visualViewport);
  const renderedPoint = {
    x: worldPoint.x * renderedViewport.scale + renderedViewport.x,
    y: worldPoint.y * renderedViewport.scale + renderedViewport.y,
  };
  return {
    x: renderedPoint.x * sceneTransform.scale + sceneTransform.x,
    y: renderedPoint.y * sceneTransform.scale + sceneTransform.y,
  };
};

test('anchor zoom preserves the world point under the pointer', () => {
  const cases = [
    [{ x: 0, y: 0, scale: 1 }, { x: 0, y: 0 }, 2],
    [{ x: 180, y: -95, scale: 0.75 }, { x: 640, y: 360 }, 1.8],
    [{ x: -420, y: 260, scale: 2.4 }, { x: 1280, y: 720 }, 0.35],
  ];

  for (const [viewport, anchor, nextScale] of cases) {
    const before = getWorldPoint(viewport, anchor);
    const nextViewport = getCanvasViewportAtAnchor(viewport, nextScale, anchor);
    assertPointAlmostEqual(getWorldPoint(nextViewport, anchor), before);
  }
});

test('ten wheel events equal one accumulated wheel update', () => {
  const anchor = { x: 412, y: 287 };
  const initial = { x: -140, y: 62, scale: 1.25 };
  let sequential = initial;
  for (let index = 0; index < 10; index += 1) {
    sequential = applyCanvasWheelDelta(sequential, -8, anchor);
  }
  const accumulated = applyCanvasWheelDelta(initial, -80, anchor);

  assert.ok(Math.abs(sequential.scale - accumulated.scale) < 1e-12);
  assertPointAlmostEqual(sequential, accumulated, 1e-9);
});

test('wheel scale is clamped between 0.1 and 10', () => {
  const anchor = { x: 100, y: 100 };
  assert.equal(applyCanvasWheelDelta({ x: 0, y: 0, scale: 1 }, 100000, anchor).scale, 0.1);
  assert.equal(applyCanvasWheelDelta({ x: 0, y: 0, scale: 1 }, -100000, anchor).scale, 10);
});

test('wheel delta normalization and anchor clamping are bounded', () => {
  assert.equal(normalizeCanvasWheelDelta(10, 1, 800), 120);
  assert.equal(normalizeCanvasWheelDelta(-2, 2, 800), -120);
  assert.deepEqual(clampCanvasAnchor({ x: -20, y: 900 }, { width: 1200, height: 700 }), {
    x: 0,
    y: 700,
  });
});

test('relative scene transform maps rendered viewport to visual viewport', () => {
  const rendered = { x: 120, y: -40, scale: 0.8 };
  const visual = { x: -210, y: 95, scale: 1.6 };
  assert.deepEqual(getCanvasSceneTransform(rendered, visual), {
    scale: 2,
    x: -450,
    y: 175,
  });
});

test('layout rebase preserves visual screen coordinates during an active viewport handoff', () => {
  const worldPoint = { x: 384, y: -126 };
  const visualViewport = { x: -210, y: 95, scale: 1.6 };
  const beforeReactLayout = { x: 120, y: -40, scale: 0.8 };
  const afterReactLayout = { x: -60, y: 180, scale: 1.25 };
  const expectedScreenPoint = {
    x: worldPoint.x * visualViewport.scale + visualViewport.x,
    y: worldPoint.y * visualViewport.scale + visualViewport.y,
  };

  const before = projectWorldPointThroughSceneTransform(
    worldPoint,
    beforeReactLayout,
    visualViewport
  );
  const after = projectWorldPointThroughSceneTransform(
    worldPoint,
    afterReactLayout,
    visualViewport
  );

  assertPointAlmostEqual(before, expectedScreenPoint, 1e-9);
  assertPointAlmostEqual(after, expectedScreenPoint, 1e-9);
  assertPointAlmostEqual(after, before, 1e-9);
});

test('damped viewport converges without changing the target anchor world point', () => {
  const anchor = { x: 480, y: 320 };
  const current = { x: 0, y: 0, scale: 1 };
  const target = getCanvasViewportAtAnchor(current, 2, anchor);
  const next = dampCanvasViewport(current, target, 16, anchor);
  const targetWorld = {
    x: (anchor.x - target.x) / target.scale,
    y: (anchor.y - target.y) / target.scale,
  };

  assert.ok(next.scale > current.scale);
  assert.ok(next.scale < target.scale);
  assert.ok(Math.abs((anchor.x - next.x) / next.scale - targetWorld.x) < 1e-9);
  assert.ok(Math.abs((anchor.y - next.y) / next.scale - targetWorld.y) < 1e-9);
});

test('changing the wheel anchor does not move the viewport at zero elapsed time', () => {
  const current = { x: -180, y: 95, scale: 1.35 };
  const target = { x: 420, y: -260, scale: 2.4 };
  assert.deepEqual(
    dampCanvasViewport(current, target, 0, { x: 900, y: 640 }),
    current
  );
});

test('damped viewport uses elapsed time rather than frame count', () => {
  const current = { x: 0, y: 0, scale: 1 };
  const target = { x: 100, y: -50, scale: 2 };
  const oneLongFrame = dampCanvasViewport(current, target, 32);
  const twoShortFrames = dampCanvasViewport(
    dampCanvasViewport(current, target, 16),
    target,
    16
  );

  assert.ok(Math.abs(oneLongFrame.x - twoShortFrames.x) < 0.01);
  assert.ok(Math.abs(oneLongFrame.y - twoShortFrames.y) < 0.01);
  assert.ok(Math.abs(oneLongFrame.scale - twoShortFrames.scale) < 0.0001);
});

test('90ms damping produces the same result at 60Hz and 120Hz', () => {
  const current = { x: -120, y: 80, scale: 0.75 };
  const target = { x: 360, y: -240, scale: 2.25 };
  const runFrames = (frameCount, deltaMs) => {
    let viewport = current;
    for (let frame = 0; frame < frameCount; frame += 1) {
      viewport = dampCanvasViewport(viewport, target, deltaMs);
    }
    return viewport;
  };
  const at60Hz = runFrames(18, 1000 / 60);
  const at120Hz = runFrames(36, 1000 / 120);

  assertPointAlmostEqual(at60Hz, at120Hz, 1e-9);
  assert.ok(Math.abs(at60Hz.scale - at120Hz.scale) < 1e-12);
});

test('sequential wheel inputs preserve each event anchor while advancing one target', () => {
  const initial = { x: 20, y: -30, scale: 1.1 };
  const firstAnchor = { x: 200, y: 160 };
  const secondAnchor = { x: 720, y: 420 };
  const firstTarget = applyCanvasWheelDelta(initial, -48, firstAnchor);
  const worldUnderSecondAnchor = getWorldPoint(firstTarget, secondAnchor);
  const secondTarget = applyCanvasWheelDelta(firstTarget, 36, secondAnchor);

  assertPointAlmostEqual(getWorldPoint(secondTarget, secondAnchor), worldUnderSecondAnchor, 1e-9);
});

test('viewport settle predicate ignores sub-pixel floating point noise', () => {
  assert.equal(
    isCanvasViewportSettled(
      { x: 10, y: 20, scale: 1.5 },
      { x: 10.0002, y: 19.9998, scale: 1.5002 }
    ),
    true
  );
  assert.equal(
    isCanvasViewportSettled(
      { x: 10, y: 20, scale: 1.5 },
      { x: 10.01, y: 20, scale: 1.5 }
    ),
    false
  );
});

test('pan target follows pointer displacement and can reuse a caller-owned viewport', () => {
  const output = { x: 0, y: 0, scale: 0 };
  const target = getCanvasPanTargetViewport(
    { x: -120, y: 80, scale: 1.5 },
    { x: 300, y: 240 },
    { x: 355, y: 190 },
    output
  );

  assert.equal(target, output);
  assert.deepEqual(target, { x: -65, y: 30, scale: 1.5 });
});

test('24ms pan damping is frame-rate independent at 60Hz and 120Hz', () => {
  const initial = { x: 0, y: 0, scale: 1.25 };
  const target = { x: 4, y: -3, scale: 1.25 };
  const runFrames = (frameCount, deltaMs) => {
    let viewport = initial;
    for (let frame = 0; frame < frameCount; frame += 1) {
      viewport = dampCanvasPanViewport(viewport, target, deltaMs);
    }
    return viewport;
  };

  const at60Hz = runFrames(12, 1000 / 60);
  const at120Hz = runFrames(24, 1000 / 120);
  assertPointAlmostEqual(at60Hz, at120Hz, 1e-9);
  assert.equal(at60Hz.scale, initial.scale);
  assert.equal(at120Hz.scale, initial.scale);
});

test('adaptive pan damping caps high-speed visual lag at six pixels', () => {
  const target = { x: 480, y: -320, scale: 1.25 };
  const viewport = dampCanvasPanViewport(
    { x: -240, y: 160, scale: 1.25 },
    target,
    1000 / 60
  );
  assert.ok(Math.hypot(target.x - viewport.x, target.y - viewport.y) <= 6 + 1e-9);
});

test('pan damping clamps long frames to 32ms and reuses its output object', () => {
  const current = { x: 0, y: 0, scale: 2 };
  const target = { x: 300, y: -180, scale: 2 };
  const output = { x: 0, y: 0, scale: 0 };
  const clamped = dampCanvasPanViewport(current, target, 32);
  const longFrame = dampCanvasPanViewport(current, target, 250, undefined, output);

  assert.equal(longFrame, output);
  assertPointAlmostEqual(longFrame, clamped, 1e-12);
  assert.equal(longFrame.scale, 2);
});

test('pan damping follows sequential target updates without changing scale', () => {
  const visual = { x: 0, y: 0, scale: 0.8 };
  dampCanvasPanViewport(visual, { x: 120, y: 40, scale: 0.8 }, 16, undefined, visual);
  const afterFirstTarget = { ...visual };
  dampCanvasPanViewport(visual, { x: -80, y: 160, scale: 0.8 }, 16, undefined, visual);

  assert.ok(afterFirstTarget.x > 0);
  assert.ok(visual.x < afterFirstTarget.x);
  assert.ok(visual.y > afterFirstTarget.y);
  assert.equal(visual.scale, 0.8);
});

test('pan settle predicate uses the configured half-pixel threshold', () => {
  assert.equal(
    isCanvasPanSettled(
      { x: 10, y: 20, scale: 1 },
      { x: 10.5, y: 19.5, scale: 1 }
    ),
    true
  );
  assert.equal(
    isCanvasPanSettled(
      { x: 10, y: 20, scale: 1 },
      { x: 10.51, y: 20, scale: 1 }
    ),
    false
  );
});
