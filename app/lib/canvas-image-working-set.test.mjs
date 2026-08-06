import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getCanvasImageLodRelativePath,
  getCanvasImageLodUrl,
  getCanvasImageDisplayResource,
  getCanvasImageWorkingSetIds,
  parseCanvasImageLodRelativePath,
} from './canvas-image-working-set.mjs';

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

test('canvas image display resources follow committed zoom levels', () => {
  assert.deepEqual(
    getCanvasImageDisplayResource({ width: 512, scale: 0.17 }),
    { displayWidth: 87, resourceWidth: 96 }
  );
  assert.deepEqual(
    getCanvasImageDisplayResource({ width: 512, scale: 0.5 }),
    { displayWidth: 256, resourceWidth: 256 }
  );
  assert.deepEqual(
    getCanvasImageDisplayResource({ width: 512, scale: 1 }),
    { displayWidth: 512, resourceWidth: 640 }
  );
  assert.deepEqual(
    getCanvasImageDisplayResource({ width: 512, scale: 2 }),
    { displayWidth: 1024, resourceWidth: 1080 }
  );
});

test('canvas image display resources clamp invalid and oversized inputs', () => {
  assert.deepEqual(
    getCanvasImageDisplayResource({ width: Number.NaN, scale: 0 }),
    { displayWidth: 1, resourceWidth: 96 }
  );
  assert.deepEqual(
    getCanvasImageDisplayResource({ width: 2048, scale: 2 }),
    { displayWidth: 4096, resourceWidth: 1600 }
  );
});

test('canvas image LOD paths preserve the original asset identity', () => {
  const src = '/api/local-assets/uploads/generated/example.png?cache=1';
  const relativePath = 'uploads/.canvas-lod/generated/example.png/w640.webp';

  assert.equal(getCanvasImageLodRelativePath(src, 640), relativePath);
  assert.equal(getCanvasImageLodUrl(src, 640), `/api/local-assets/${relativePath}`);
  assert.deepEqual(parseCanvasImageLodRelativePath(relativePath), {
    originalRelativePath: 'uploads/generated/example.png',
    resourceWidth: 640,
  });
  assert.equal(getCanvasImageLodRelativePath('/remote/example.png', 640), null);
  assert.equal(getCanvasImageLodRelativePath(src, 384), null);
});
