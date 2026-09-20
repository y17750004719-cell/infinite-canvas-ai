import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getImageModelCapability,
  getSupportedImageSizeOptions,
  resolveOpenAiImageSizeForAspectRatio,
} from './image-model-capabilities.mjs';

test('image size conversion is protocol driven and independent of model names', () => {
  assert.equal(resolveOpenAiImageSizeForAspectRatio('2048x2048', '3:4'), '1536x2048');
  assert.equal(resolveOpenAiImageSizeForAspectRatio('2K', '16:9'), '2048x1152');
  assert.equal(resolveOpenAiImageSizeForAspectRatio('2048x2048', '1:1'), '2048x2048');
});

test('model capability lookup preserves supplier ids and exposes descriptive metadata', () => {
  const capability = getImageModelCapability('custom-image-model');
  assert.equal(typeof capability.supportsAspectRatio, 'boolean');
  assert.ok(Array.isArray(capability.supportedSizes));
  assert.ok(getSupportedImageSizeOptions('custom-image-model').length > 0);
});

test('unknown models use a neutral capability envelope without protocol routing', () => {
  const capability = getImageModelCapability('future-provider-image-model');
  assert.equal(capability.supportsAspectRatio, true);
  assert.deepEqual(capability.supportedSizes, ['1024x1024', '2048x2048', '4096x4096']);
});
