import test from 'node:test';
import assert from 'node:assert/strict';

import {
  applyDirectItemDrag,
  applyDirectItemResize,
  applyDirectPan,
  applyDirectZoom,
  resolveDirectMarqueeSelection,
} from './canvas-direct-interaction.mjs';

test('direct pan follows the pointer without interpolation', () => {
  assert.deepEqual(
    applyDirectPan({ x: 10, y: 20, scale: 2 }, { x: 100, y: 80 }, { x: 145, y: 50 }),
    { x: 55, y: -10, scale: 2 }
  );
});

test('direct zoom uses Infinite-Canvas wheel steps and preserves the anchor', () => {
  const viewport = { x: 20, y: 30, scale: 1 };
  const anchor = { x: 120, y: 130 };
  const zoomed = applyDirectZoom(viewport, -1, anchor);
  assert.equal(zoomed.scale, 1.08);
  assert.equal((anchor.x - zoomed.x) / zoomed.scale, 100);
  assert.equal((anchor.y - zoomed.y) / zoomed.scale, 100);
  assert.ok(Math.abs(applyDirectZoom(zoomed, 1, anchor).scale - 0.9936) < 1e-12);
});

test('direct item drag preserves references for untouched items', () => {
  const fixed = { id: 'fixed', x: 1, y: 2 };
  const moved = { id: 'moved', x: 10, y: 20 };
  const items = [fixed, moved];
  const next = applyDirectItemDrag({
    items,
    itemIds: ['moved'],
    startPositions: { moved: { x: 10, y: 20 } },
    delta: { x: 5, y: -4 },
  });
  assert.equal(next[0], fixed);
  assert.deepEqual(next[1], { id: 'moved', x: 15, y: 16 });
});

test('direct resize supports free and aspect-ratio-preserving sizes', () => {
  assert.deepEqual(applyDirectItemResize({ startWidth: 100, startHeight: 80, deltaX: 20, deltaY: 5 }), {
    width: 120,
    height: 85,
  });
  assert.deepEqual(applyDirectItemResize({
    startWidth: 100,
    startHeight: 50,
    deltaX: 20,
    deltaY: 1,
    preserveAspectRatio: true,
  }), { width: 120, height: 60 });
});

test('direct marquee resolves overlap once and preserves additive selection', () => {
  const boundsById = new Map([
    ['a', { left: 0, top: 0, right: 20, bottom: 20 }],
    ['b', { left: 80, top: 80, right: 100, bottom: 100 }],
  ]);
  assert.deepEqual(resolveDirectMarqueeSelection({
    rect: { left: 10, top: 10, right: 40, bottom: 40 },
    boundsById,
  }), ['a']);
  assert.deepEqual(resolveDirectMarqueeSelection({
    rect: { left: 10, top: 10, right: 40, bottom: 40 },
    boundsById,
    baseIds: ['b'],
    additive: true,
  }), ['b', 'a']);
});
