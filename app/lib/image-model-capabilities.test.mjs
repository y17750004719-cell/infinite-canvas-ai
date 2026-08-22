import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getImageModelCapability,
  resolveImageRequestModel,
  getSupportedImageSizeOptions,
  resolveSupportedImageSize,
  getGptImage2SizeValidationError,
  isValidGptImage2Size,
  normalizeImageModelCapabilityId,
  resolveImageModelAlias,
  imageSizeForResolution,
  supportsImageModelRequestedSize,
  supportsImageModelImageSizeConfig,
} from './image-model-capabilities.mjs';

test('resolves Nano Banana aliases to current Gemini model IDs for every supplier', () => {
  assert.deepEqual(resolveImageModelAlias('nano-banana'), {
    requestedModel: 'nano-banana',
    model: 'gemini-2.5-flash-image',
    resolution: '',
  });
  assert.equal(resolveImageModelAlias('NANO_BANANA_2').model, 'gemini-3.1-flash-image');
  assert.equal(resolveImageModelAlias('nano-banana-2-lite').model, 'gemini-3.1-flash-lite-image');
  assert.equal(resolveImageModelAlias('nano-banana-pro').model, 'gemini-3-pro-image');
  assert.equal(normalizeImageModelCapabilityId('nano-banana-2'), 'gemini-3.1-flash-image');
});

test('keeps Nano Banana resolution suffixes as request hints instead of model IDs', () => {
  assert.deepEqual(resolveImageModelAlias('nano-banana-2-2k'), {
    requestedModel: 'nano-banana-2-2k',
    model: 'gemini-3.1-flash-image',
    resolution: '2K',
  });
  assert.equal(resolveImageModelAlias('nano-banana-2-4k').resolution, '4K');
  assert.equal(imageSizeForResolution('4k'), '4096x4096');
  assert.equal(resolveImageRequestModel('nano-banana-2-4k', '4096x4096'), 'gemini-3.1-flash-image');
});

test('preserves canonical and legacy preview Gemini IDs', () => {
  assert.equal(resolveImageModelAlias('gemini-3.1-flash-image').model, 'gemini-3.1-flash-image');
  assert.equal(resolveImageModelAlias('gemini-3.1-flash-image-preview').model, 'gemini-3.1-flash-image-preview');
  assert.equal(resolveImageModelAlias('gemini-3-pro-image-preview').model, 'gemini-3-pro-image-preview');
});

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
    ['1024x1024', '2048x2048', '4096x4096']
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

test('gemini provider variants normalize to the base capability model while preserving the selected request model', () => {
  assert.equal(
    normalizeImageModelCapabilityId('gemini-3.1-flash-image-preview-2k'),
    'gemini-3.1-flash-image-preview'
  );
  assert.equal(
    normalizeImageModelCapabilityId('gemini-3.1-flash-image-preview-4k'),
    'gemini-3.1-flash-image-preview'
  );
  assert.equal(
    resolveImageRequestModel('gemini-3.1-flash-image-preview-2k', '2048x2048'),
    'gemini-3.1-flash-image-preview-2k'
  );
  assert.equal(
    resolveImageRequestModel('gemini-3.1-flash-image-preview-4k', '4096x4096'),
    'gemini-3.1-flash-image-preview-4k'
  );
  assert.equal(getImageModelCapability('gemini-3.1-flash-image-preview-2k').supportsAspectRatio, true);
  assert.deepEqual(
    getImageModelCapability('gemini-3.1-flash-image-preview-2k').supportedSizes,
    ['1024x1024', '2048x2048', '4096x4096']
  );
});

test('resolveSupportedImageSize keeps gpt-image-2 on tiered presets when legacy explicit sizes are provided', () => {
  assert.equal(resolveSupportedImageSize('gpt-image-2', '4096x4096'), '4096x4096');
  assert.equal(resolveSupportedImageSize('gpt-image-2', '1536x1024'), '2048x2048');
  assert.equal(resolveSupportedImageSize('gpt-image-2', '3840x2160'), '2048x2048');
});

test('supportsImageModelRequestedSize accepts resolved non-square exact sizes for gpt-image-2 variants', () => {
  assert.equal(supportsImageModelRequestedSize('gpt-image-2', '2048x1152'), true);
  assert.equal(supportsImageModelRequestedSize('gpt-image-2', '1152x2048'), true);
  assert.equal(supportsImageModelRequestedSize('gpt-image-2-2k', '2048x1360'), true);
});

test('gpt-image-2 size validation accepts legal exact sizes and rejects invalid ones', () => {
  assert.equal(isValidGptImage2Size('2048x1152'), true);
  assert.equal(isValidGptImage2Size('1152x2048'), true);
  assert.equal(isValidGptImage2Size('2048x1360'), true);
  assert.equal(getGptImage2SizeValidationError('1254x1254'), '尺寸宽高必须都是 16 的倍数');
  assert.equal(getGptImage2SizeValidationError('4096x4096'), '尺寸最大边不能超过 3840px');
  assert.equal(getGptImage2SizeValidationError('3840x1200'), '尺寸长短边比例不能超过 3:1');
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
