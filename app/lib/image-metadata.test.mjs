import test from 'node:test';
import assert from 'node:assert/strict';

import { getImageDimensionsFromBuffer } from './image-metadata.mjs';

const PNG_1X1 = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c6360000002000154a24f5d0000000049454e44ae426082',
  'hex'
);

const GIF_2X3 = Buffer.from(
  '47494638396102000300800000000000ffffff21f90401000000002c00000000020003000002024401003b',
  'hex'
);

test('getImageDimensionsFromBuffer reads PNG dimensions', () => {
  assert.deepEqual(getImageDimensionsFromBuffer(PNG_1X1), {
    naturalWidth: 1,
    naturalHeight: 1,
  });
});

test('getImageDimensionsFromBuffer reads GIF dimensions', () => {
  assert.deepEqual(getImageDimensionsFromBuffer(GIF_2X3), {
    naturalWidth: 2,
    naturalHeight: 3,
  });
});

test('getImageDimensionsFromBuffer returns null for unsupported buffers', () => {
  assert.equal(getImageDimensionsFromBuffer(Buffer.from('hello')), null);
});
