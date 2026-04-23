import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getImageModelCapability,
  resolveImageRequestModel,
  getSupportedImageSizeOptions,
  resolveSupportedImageSize,
  supportsImageModelImageSizeConfig,
} from './image-model-capabilities.mjs';

test('image model capabilities expose fixed size support for current image models including gpt-image-2', () => {
  assert.equal(supportsImageModelImageSizeConfig('gemini-3.1-flash-image-preview'), true);
  assert.equal(supportsImageModelImageSizeConfig('gemini-2.5-flash-image'), true);
  assert.equal(supportsImageModelImageSizeConfig('gemini-3-pro-image-preview'), true);
  assert.equal(supportsImageModelImageSizeConfig('gpt-image-2'), true);
  assert.equal(getImageModelCapability('gpt-image-2').supportsAspectRatio, false);
});

test('getSupportedImageSizeOptions returns the fixed 1K 2K 4K options for supported models', () => {
  assert.deepEqual(
    getSupportedImageSizeOptions('gemini-2.5-flash-image').map((option) => option.id),
    ['1024x1024', '2048x2048', '4096x4096']
  );
  assert.deepEqual(
    getSupportedImageSizeOptions('gpt-image-2').map((option) => option.id),
    ['1024x1024', '1536x1024', '1024x1536', '2048x2048', '2048x1152', '3840x2160', '2160x3840']
  );
});

test('resolveSupportedImageSize keeps a supported 2K request intact for Gemini image models', () => {
  assert.equal(resolveSupportedImageSize('gemini-2.5-flash-image', '2048x2048'), '2048x2048');
});

test('resolveImageRequestModel upgrades gemini 3.1 flash image preview to the 4k variant for 4096 output requests', () => {
  assert.equal(
    resolveImageRequestModel('gemini-3.1-flash-image-preview', '4096x4096'),
    'gemini-3.1-flash-image-preview-4k'
  );
});

test('resolveImageRequestModel keeps the base gemini 3.1 flash image preview model for 2k requests', () => {
  assert.equal(
    resolveImageRequestModel('gemini-3.1-flash-image-preview', '2048x2048'),
    'gemini-3.1-flash-image-preview'
  );
});

test('resolveSupportedImageSize falls back to the nearest supported square preset when gpt-image-2 receives an unsupported old size', () => {
  assert.equal(resolveSupportedImageSize('gpt-image-2', '4096x4096'), '2048x2048');
  assert.equal(resolveSupportedImageSize('gpt-image-2', '1536x1024'), '1536x1024');
  assert.equal(resolveSupportedImageSize('gpt-image-2', '3840x2160'), '3840x2160');
});

test('resolveImageRequestModel keeps gpt-image-2 unchanged for exact-size requests', () => {
  assert.equal(
    resolveImageRequestModel('gpt-image-2', '1536x1024'),
    'gpt-image-2'
  );
  assert.equal(
    resolveImageRequestModel('gpt-image-2', '2048x1152'),
    'gpt-image-2'
  );
});

test('unknown models fall back to the default Gemini image capability envelope', () => {
  const capability = getImageModelCapability('unknown-model');

  assert.equal(capability.supportsAspectRatio, true);
  assert.deepEqual(capability.supportedSizes, ['1024x1024', '2048x2048', '4096x4096']);
});
