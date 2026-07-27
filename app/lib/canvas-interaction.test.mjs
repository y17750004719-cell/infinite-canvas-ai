import test from 'node:test';
import assert from 'node:assert/strict';

import {
  applyCanvasItemDragPositions,
  areCanvasPointsFullyContained,
  getCanvasDragDelta,
  getCanvasDragActivationDistance,
  getCanvasMarqueePath,
  getRotatedRectAabb,
  hasCanvasDragIntent,
  isRectIntersecting,
  matchesCanvasItemDragTransaction,
  normalizeCanvasMarqueeRect,
  ownsCanvasItemVisualHandoff,
  projectCanvasPointToViewport,
  projectScreenRectToCanvas,
  resolveCanvasFixedOverlayAnchors,
  resolveCanvasItemDragReleasePositions,
  resolveCanvasMarqueeSelection,
  resolveCanvasPointerGesture,
  shouldCancelCanvasPointerSessionOnLostCapture,
} from './canvas-interaction.mjs';

test('select tool routes pointer gestures by modifier, button, and target', () => {
  for (const target of ['canvas', 'item']) {
    assert.equal(resolveCanvasPointerGesture({
      tool: 'select', button: 0, ctrlKey: true, target,
    }), 'marquee');
  }

  assert.equal(resolveCanvasPointerGesture({
    tool: 'select', button: 0, target: 'canvas',
  }), 'pan');
  assert.equal(resolveCanvasPointerGesture({
    tool: 'select', button: 0, target: 'item',
  }), 'item');
  assert.equal(resolveCanvasPointerGesture({
    tool: 'select', button: 1, target: 'item',
  }), 'pan');
  assert.equal(resolveCanvasPointerGesture({
    tool: 'select', button: 0, isSpacePressed: true, target: 'item',
  }), 'pan');
});

test('controls retain pointer ownership and non-select tools retain their left-button behavior', () => {
  for (const options of [
    { tool: 'select', button: 0, ctrlKey: true, target: 'control' },
    { tool: 'select', button: 0, isSpacePressed: true, target: 'control' },
    { tool: 'select', button: 1, target: 'control' },
    { tool: 'draw', button: 0, target: 'canvas' },
    { tool: 'target', button: 0, target: 'item' },
    { tool: 'annotation-text', button: 0, ctrlKey: true, target: 'canvas' },
  ]) {
    assert.equal(resolveCanvasPointerGesture(options), 'none');
  }

  assert.equal(resolveCanvasPointerGesture({
    tool: 'draw', button: 1, target: 'canvas',
  }), 'pan');
  assert.equal(resolveCanvasPointerGesture({
    tool: 'annotation-text', button: 0, isSpacePressed: true, target: 'canvas',
  }), 'pan');
  assert.equal(resolveCanvasPointerGesture({
    tool: 'select', button: 2, target: 'canvas',
  }), 'none');
});

test('mouse and pen activate on the first actual pointer movement', () => {
  assert.equal(getCanvasDragActivationDistance('mouse'), 0);
  assert.equal(getCanvasDragActivationDistance('pen'), 0);
  assert.equal(hasCanvasDragIntent({ x: 10, y: 10 }, { x: 11, y: 10 }, 'mouse'), true);
  assert.equal(hasCanvasDragIntent({ x: 10, y: 10 }, { x: 10, y: 10 }, 'mouse'), false);
});

test('touch keeps a six CSS pixel click tolerance', () => {
  assert.equal(getCanvasDragActivationDistance('touch'), 6);
  assert.equal(hasCanvasDragIntent({ x: 0, y: 0 }, { x: 6, y: 0 }, 'touch'), true);
  assert.equal(hasCanvasDragIntent({ x: 0, y: 0 }, { x: 5, y: 0 }, 'touch'), false);
});

test('implicit pointer capture loss after pointerup does not cancel the pending release commit', () => {
  assert.equal(shouldCancelCanvasPointerSessionOnLostCapture({
    eventPointerId: 7,
    sessionPointerId: 7,
    releasePending: true,
  }), false);
  assert.equal(shouldCancelCanvasPointerSessionOnLostCapture({
    eventPointerId: 7,
    sessionPointerId: 7,
    releasePending: false,
  }), true);
  assert.equal(shouldCancelCanvasPointerSessionOnLostCapture({
    eventPointerId: 8,
    sessionPointerId: 7,
    releasePending: false,
  }), false);
});

test('canvas points project through the live viewport at every supported scale', () => {
  for (const scale of [0.1, 0.5, 1, 2, 10]) {
    assert.deepEqual(
      projectCanvasPointToViewport({ x: 40, y: -12 }, { x: 100, y: 60, scale }),
      { x: 40 * scale + 100, y: -12 * scale + 60 }
    );
  }
});

test('fixed image overlays keep a ten CSS pixel gap at every supported scale', () => {
  const bounds = { left: 40, top: 30, width: 320, height: 180 };
  const canvasOrigin = { x: 12, y: 24 };

  for (const scale of [0.1, 0.5, 1, 2, 10]) {
    const viewport = { x: 100, y: 60, scale };
    const anchors = resolveCanvasFixedOverlayAnchors({
      bounds,
      viewport,
      canvasOrigin,
      gap: 10,
    });
    const projectedTop = canvasOrigin.y + bounds.top * scale + viewport.y;
    const projectedBottom = canvasOrigin.y + (bounds.top + bounds.height) * scale + viewport.y;
    const projectedCenter = canvasOrigin.x + (bounds.left + bounds.width / 2) * scale + viewport.x;

    assert.equal(anchors.centerX, projectedCenter);
    assert.equal(projectedTop - anchors.topToolbarY, 10);
    assert.equal(anchors.bottomPanelY - projectedBottom, 10);
  }
});

test('marquee rectangles keep the press point as a corner in every drag direction', () => {
  const start = { x: 100, y: 80 };
  assert.deepEqual(normalizeCanvasMarqueeRect(start, { x: 160, y: 140 }), {
    x: 100, y: 80, width: 60, height: 60,
  });
  assert.deepEqual(normalizeCanvasMarqueeRect(start, { x: 40, y: 140 }), {
    x: 40, y: 80, width: 60, height: 60,
  });
  assert.deepEqual(normalizeCanvasMarqueeRect(start, { x: 160, y: 20 }), {
    x: 100, y: 20, width: 60, height: 60,
  });
  assert.deepEqual(normalizeCanvasMarqueeRect(start, { x: 40, y: 20 }), {
    x: 40, y: 20, width: 60, height: 60,
  });
  assert.deepEqual(normalizeCanvasMarqueeRect(start, start), {
    x: 100, y: 80, width: 0, height: 0,
  });
});

test('marquee paths use fixed screen coordinates without transform scaling', () => {
  assert.equal(
    getCanvasMarqueePath({ x: 40, y: 20, width: 60, height: 80 }),
    'M 40 20 H 100 V 100 H 40 Z'
  );
});

test('screen marquee coordinates project through the captured viewport', () => {
  assert.deepEqual(
    projectScreenRectToCanvas(
      { x: 140, y: 10, width: 240, height: 120 },
      { x: -100, y: -50, scale: 2 }
    ),
    { left: 120, right: 240, top: 30, bottom: 90 }
  );
});

test('marquee item hit testing includes partial overlap and touching edges', () => {
  const marquee = { left: 10, right: 110, top: 20, bottom: 120 };
  assert.equal(
    isRectIntersecting(marquee, { left: 20, right: 100, top: 30, bottom: 110 }),
    true
  );
  assert.equal(
    isRectIntersecting(marquee, { left: 100, right: 160, top: 110, bottom: 150 }),
    true
  );
  assert.equal(
    isRectIntersecting(marquee, { left: 110, right: 160, top: 40, bottom: 80 }),
    true
  );
  assert.equal(
    isRectIntersecting(marquee, { left: 110.001, right: 160, top: 40, bottom: 80 }),
    false
  );
  assert.equal(
    isRectIntersecting(marquee, { left: -60, right: 9.999, top: 40, bottom: 80 }),
    false
  );
});

test('rotated rectangle AABB follows its center or an explicit transform origin', () => {
  const centered = getRotatedRectAabb(
    { left: 100, top: 50, width: 80, height: 40 },
    90
  );
  assert.ok(Math.abs(centered.left - 120) < 1e-9);
  assert.ok(Math.abs(centered.right - 160) < 1e-9);
  assert.ok(Math.abs(centered.top - 30) < 1e-9);
  assert.ok(Math.abs(centered.bottom - 110) < 1e-9);

  const aroundItemCenter = getRotatedRectAabb(
    { left: 110, top: 60, width: 60, height: 20 },
    180,
    { x: 140, y: 90 }
  );
  assert.ok(Math.abs(aroundItemCenter.left - 110) < 1e-9);
  assert.ok(Math.abs(aroundItemCenter.right - 170) < 1e-9);
  assert.ok(Math.abs(aroundItemCenter.top - 100) < 1e-9);
  assert.ok(Math.abs(aroundItemCenter.bottom - 120) < 1e-9);
});

test('rotated marquee hit testing is consistent at every supported scale', () => {
  const viewportPosition = { x: 137, y: -53 };
  const itemAabb = getRotatedRectAabb(
    { left: 40, top: 30, width: 120, height: 60 },
    45
  );
  const canvasMarquee = {
    left: itemAabb.right,
    right: itemAabb.right + 25,
    top: itemAabb.top + 10,
    bottom: itemAabb.bottom - 10,
  };

  for (const scale of [0.1, 0.5, 1, 2, 10]) {
    const screenMarquee = {
      x: canvasMarquee.left * scale + viewportPosition.x,
      y: canvasMarquee.top * scale + viewportPosition.y,
      width: (canvasMarquee.right - canvasMarquee.left) * scale,
      height: (canvasMarquee.bottom - canvasMarquee.top) * scale,
    };
    const projectedMarquee = projectScreenRectToCanvas(screenMarquee, {
      ...viewportPosition,
      scale,
    });

    assert.equal(isRectIntersecting(projectedMarquee, itemAabb), true);
    assert.ok(Math.abs(projectedMarquee.left - itemAabb.right) < 1e-9);
  }
});

test('connection marquee hit testing requires every sampled point inside', () => {
  const marquee = { x: 10, y: 20, width: 100, height: 100 };
  assert.equal(
    areCanvasPointsFullyContained(marquee, [
      { x: 10, y: 20 },
      { x: 60, y: 70 },
      { x: 110, y: 120 },
    ]),
    true
  );
  assert.equal(
    areCanvasPointsFullyContained(marquee, [
      { x: 60, y: 70 },
      { x: 111, y: 70 },
    ]),
    false
  );
});

test('shift marquee toggles hits while regular marquee replaces selection', () => {
  assert.deepEqual(
    resolveCanvasMarqueeSelection(['a', 'b'], ['b', 'c'], true),
    ['a', 'c']
  );
  assert.deepEqual(
    resolveCanvasMarqueeSelection(['a', 'b'], ['c'], false),
    ['c']
  );
});

test('drag deltas stay in canvas coordinates at every supported scale', () => {
  for (const scale of [0.1, 0.5, 1, 2, 10]) {
    assert.deepEqual(
      getCanvasDragDelta({ x: 20, y: 30 }, { x: 70, y: 5 }, scale),
      { x: 50 / scale, y: -25 / scale }
    );
  }
});

test('single and multi-item drag commits positions once and moves the selection to front', () => {
  const items = [
    { id: 'a', x: 0, y: 0 },
    { id: 'b', x: 10, y: 10 },
    { id: 'c', x: 20, y: 20 },
  ];
  const single = applyCanvasItemDragPositions({
    items,
    itemIds: ['a'],
    positions: new Map([['a', { x: 50, y: 60 }]]),
  });
  assert.deepEqual(single.items.map(({ id, x, y }) => ({ id, x, y })), [
    { id: 'b', x: 10, y: 10 },
    { id: 'c', x: 20, y: 20 },
    { id: 'a', x: 50, y: 60 },
  ]);
  assert.deepEqual(single.orderBefore, ['a', 'b', 'c']);
  assert.deepEqual(single.orderAfter, ['b', 'c', 'a']);

  const multi = applyCanvasItemDragPositions({
    items,
    itemIds: ['a', 'b'],
    positions: new Map([
      ['a', { x: 100, y: 110 }],
      ['b', { x: 120, y: 130 }],
    ]),
  });
  assert.deepEqual(multi.items.map(({ id, x, y }) => ({ id, x, y })), [
    { id: 'c', x: 20, y: 20 },
    { id: 'a', x: 100, y: 110 },
    { id: 'b', x: 120, y: 130 },
  ]);
});

test('only the active drag token in the active session can commit', () => {
  const transaction = { token: 12, sessionId: 'session-a' };
  assert.equal(matchesCanvasItemDragTransaction(transaction, 12, 'session-a'), true);
  assert.equal(matchesCanvasItemDragTransaction(transaction, 11, 'session-a'), false);
  assert.equal(matchesCanvasItemDragTransaction(transaction, 12, 'session-b'), false);
  assert.equal(matchesCanvasItemDragTransaction(null, 12, 'session-a'), false);
});

test('pointer release positions are authoritative even when the last preview draft is stale', () => {
  const startPositions = {
    a: { x: 10, y: 20 },
    b: { x: -5, y: 40 },
  };
  const staleDraftPositions = new Map([
    ['a', { ...startPositions.a }],
    ['b', { ...startPositions.b }],
  ]);
  const positions = resolveCanvasItemDragReleasePositions({
    itemIds: ['a', 'b'],
    startPositions,
    delta: { x: 35, y: -12 },
  });

  assert.deepEqual([...staleDraftPositions.entries()], [
    ['a', { x: 10, y: 20 }],
    ['b', { x: -5, y: 40 }],
  ]);
  assert.deepEqual([...positions.entries()], [
    ['a', { x: 45, y: 8 }],
    ['b', { x: 30, y: 28 }],
  ]);
});

test('rapid pointer release hands the same coordinates from preview to live state and layout', () => {
  for (const scale of [0.1, 0.5, 1, 2, 10]) {
    const startPositions = {
      a: { x: 10, y: 20 },
      b: { x: 50, y: -30 },
    };
    const delta = getCanvasDragDelta(
      { x: 100, y: 80 },
      { x: 145, y: 62 },
      scale
    );
    const releasePositions = resolveCanvasItemDragReleasePositions({
      itemIds: ['a', 'b'],
      startPositions,
      delta,
    });
    const visualPositions = new Map(releasePositions);
    const committed = applyCanvasItemDragPositions({
      items: [
        { id: 'a', x: 10, y: 20 },
        { id: 'b', x: 50, y: -30 },
      ],
      itemIds: ['a', 'b'],
      positions: releasePositions,
    });
    const renderedPositions = new Map(
      committed.items.map((item) => [item.id, { x: item.x, y: item.y }])
    );

    for (const itemId of ['a', 'b']) {
      assert.deepEqual(visualPositions.get(itemId), releasePositions.get(itemId));
      assert.deepEqual(renderedPositions.get(itemId), releasePositions.get(itemId));
      assert.deepEqual({
        x: visualPositions.get(itemId).x - renderedPositions.get(itemId).x,
        y: visualPositions.get(itemId).y - renderedPositions.get(itemId).y,
      }, { x: 0, y: 0 });
    }
  }
});

test('visual handoff cleanup requires every item to still belong to its token', () => {
  const visualTokens = new Map([
    ['a', 7],
    ['b', 7],
  ]);
  assert.equal(ownsCanvasItemVisualHandoff({ token: 7, itemIds: ['a', 'b'], visualTokens }), true);
  visualTokens.set('b', 8);
  assert.equal(ownsCanvasItemVisualHandoff({ token: 7, itemIds: ['a', 'b'], visualTokens }), false);
  assert.equal(ownsCanvasItemVisualHandoff({ token: 8, itemIds: ['b'], visualTokens }), true);
});
