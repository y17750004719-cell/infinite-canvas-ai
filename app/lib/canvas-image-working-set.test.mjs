import test from 'node:test';
import assert from 'node:assert/strict';

import { getCanvasImageWorkingSetIds } from './canvas-image-working-set.mjs';

const createImageGrid = (count) => Array.from({ length: count }, (_, index) => ({
  id: `image-${index}`,
  type: 'image',
  x: (index % 10) * 420,
  y: Math.floor(index / 10) * 420,
  width: 384,
  height: 384,
}));

test('image working set stays bounded for 30, 60, and 100 image canvases', () => {
  for (const count of [30, 60, 100]) {
    const ids = getCanvasImageWorkingSetIds({
      items: createImageGrid(count),
      viewport: { x: 0, y: 0, scale: 1 },
      canvasSize: { width: 1280, height: 800 },
      overscanScreens: 1,
    });
    assert.ok(ids.length > 0);
    assert.ok(ids.length < count);
    assert.ok(ids.length <= 40);
  }
});

test('image working set follows the committed viewport and ignores non-image items', () => {
  const items = [
    ...createImageGrid(60),
    { id: 'text-nearby', type: 'text', x: 4200, y: 0, width: 384, height: 384 },
  ];
  const ids = getCanvasImageWorkingSetIds({
    items,
    viewport: { x: -4200, y: 0, scale: 1 },
    canvasSize: { width: 1280, height: 800 },
    overscanScreens: 1,
  });

  assert.ok(ids.includes('image-9'));
  assert.equal(ids.includes('image-0'), false);
  assert.equal(ids.includes('text-nearby'), false);
});

test('image working set keeps all images active until canvas metrics are available', () => {
  const items = createImageGrid(30);
  const ids = getCanvasImageWorkingSetIds({
    items,
    viewport: { x: 0, y: 0, scale: 1 },
    canvasSize: { width: 0, height: 0 },
  });
  assert.equal(ids.length, items.length);
});
