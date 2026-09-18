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
      retryable: true,
      retryAttempt: 2,
      outcomeUnknown: false,
      failureStage: 'provider_execution',
    }
  );

  assert.deepEqual(buildGenerateRouteErrorMeta(new Error('plain'), TestImageGenerationError), {
    isImageGenerationError: false,
    statusCode: 500,
    failureClass: 'unknown',
    isRetryable: false,
    retryable: false,
    retryAttempt: null,
    outcomeUnknown: false,
    failureStage: 'generate_route',
  });
});

test('buildGenerateRouteErrorMeta exposes structured provider availability failures', () => {
  class TestImageGenerationError extends Error {
    statusCode = 503;
    failureClass = 'upstream_http';
    failureCode = 'provider_unavailable';
    isRetryable = false;
    retryAttempt = 1;
  }

  assert.deepEqual(
    buildGenerateRouteErrorMeta(new TestImageGenerationError('No available compatible accounts'), TestImageGenerationError),
    {
      isImageGenerationError: true,
      statusCode: 503,
      failureClass: 'upstream_http',
      failureCode: 'provider_unavailable',
      isRetryable: false,
      retryable: false,
      retryAttempt: 1,
      outcomeUnknown: false,
      failureStage: 'provider_execution',
    },
  );
});

test('buildGenerateRouteErrorMeta preserves unknown provider result metadata', () => {
  class TestImageGenerationError extends Error {
    statusCode = 502;
    failureClass = 'payload';
    failureCode = 'provider_result_unknown';
    isRetryable = false;
    retryAttempt = 1;
    outcomeUnknown = true;
  }

  assert.deepEqual(
    buildGenerateRouteErrorMeta(new TestImageGenerationError('no image payload'), TestImageGenerationError),
    {
      isImageGenerationError: true,
      statusCode: 502,
      failureClass: 'payload',
      failureCode: 'provider_result_unknown',
      isRetryable: false,
      retryable: false,
      retryAttempt: 1,
      outcomeUnknown: true,
      failureStage: 'provider_result_parse',
    },
  );
});

test('buildGenerateRouteErrorMeta preserves local delivery metadata on plain save errors', () => {
  const error = Object.assign(new Error('failed to save generated asset'), {
    failureStage: 'local_delivery',
    providerRequestStarted: true,
  });
  assert.equal(buildGenerateRouteErrorMeta(error, class TestImageGenerationError extends Error {} ).failureStage, 'local_delivery');
});
