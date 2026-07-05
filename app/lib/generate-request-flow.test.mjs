import test from 'node:test';
import assert from 'node:assert/strict';

import {
  aspectRatioFromSize,
  buildGenerateRouteErrorMeta,
  normalizeAspectRatio,
  resolveGenerateImageModelFromAllowedModels,
  resolveIntent,
} from './generate-request-flow.mjs';

test('resolveIntent honors explicit slash commands before auto detection', () => {
  assert.deepEqual(resolveIntent('auto', '/img 画一个 logo', false), {
    intent: 'image',
    ambiguous: false,
    prompt: '画一个 logo',
  });
  assert.deepEqual(resolveIntent('auto', '/chat 画一个 logo 的策略', false), {
    intent: 'chat',
    ambiguous: false,
    prompt: '画一个 logo 的策略',
  });
});

test('resolveIntent routes reference image auto requests to image flow', () => {
  assert.deepEqual(resolveIntent('auto', '继续这个方向', true), {
    intent: 'image',
    ambiguous: false,
    prompt: '继续这个方向',
  });
});

test('resolveIntent keeps conflicting auto hints on ambiguous chat default', () => {
  assert.deepEqual(resolveIntent('auto', '解释这个 logo 并生成图片', false), {
    intent: 'chat',
    ambiguous: true,
    prompt: '解释这个 logo 并生成图片',
  });
});

test('resolveGenerateImageModelFromAllowedModels preserves provider-saved image model ids', () => {
  const allowedProviderModelIds = new Set([
    'gemini-3.1-flash-image-preview',
    'vendor/gpt-image-2-custom',
  ]);

  assert.equal(
    resolveGenerateImageModelFromAllowedModels('gemini-3.1-flash-image-preview', allowedProviderModelIds),
    'gemini-3.1-flash-image-preview'
  );
  assert.equal(
    resolveGenerateImageModelFromAllowedModels('vendor/gpt-image-2-custom', allowedProviderModelIds),
    'vendor/gpt-image-2-custom'
  );
});

test('aspect ratio helpers keep current route normalization behavior', () => {
  assert.equal(normalizeAspectRatio('16:9'), '16:9');
  assert.equal(normalizeAspectRatio(' 4:5 '), '4:5');
  assert.equal(normalizeAspectRatio('10:7'), '');
  assert.equal(aspectRatioFromSize('2048x1152'), '16:9');
  assert.equal(aspectRatioFromSize('1024x1536'), '2:3');
  assert.equal(aspectRatioFromSize('bad-size'), '1:1');
});

test('buildGenerateRouteErrorMeta mirrors route ImageGenerationError handling', () => {
  class TestImageGenerationError extends Error {
    constructor(message) {
      super(message);
      this.statusCode = 429;
      this.failureClass = 'transport';
      this.isRetryable = true;
      this.retryAttempt = 2;
    }
  }

  assert.deepEqual(
    buildGenerateRouteErrorMeta(new TestImageGenerationError('retry me'), TestImageGenerationError),
    {
      isImageGenerationError: true,
      statusCode: 429,
      failureClass: 'transport',
      isRetryable: true,
      retryAttempt: 2,
    }
  );

  assert.deepEqual(buildGenerateRouteErrorMeta(new Error('plain'), TestImageGenerationError), {
    isImageGenerationError: false,
    statusCode: 500,
    failureClass: 'unknown',
    isRetryable: false,
    retryAttempt: null,
  });
});
