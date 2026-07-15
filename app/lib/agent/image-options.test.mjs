import test from 'node:test';
import assert from 'node:assert/strict';

import { buildProviderImageOptionProfiles } from '../image-provider-option-profiles.mjs';
import {
  AGENT_DEFAULT_IMAGE_OPTIONS,
  buildAgentImageGenerationRequests,
  extractExplicitImageAspectRatio,
  resolveAgentImageOptions,
} from './image-options.mjs';
import { buildAsyncImageTaskRequests } from '../workspace-session-view.mjs';

test('agent image defaults use 2K, portrait 3:4, auto quality, and one output', () => {
  assert.deepEqual(AGENT_DEFAULT_IMAGE_OPTIONS, {
    size: '2048x2048',
    aspectRatio: '3:4',
    quality: 'auto',
    count: 1,
  });
});

test('explicit image ratio parsing supports colon variants and uses the last ratio', () => {
  assert.equal(extractExplicitImageAspectRatio('做成 16:9 横版'), '16:9');
  assert.equal(extractExplicitImageAspectRatio('改成 3：4 竖版'), '3:4');
  assert.equal(extractExplicitImageAspectRatio('先看 1:1，最终使用 4比3'), '4:3');
  assert.equal(extractExplicitImageAspectRatio('做成横版海报'), null);
});

test('agent image options reuse provider image-card normalization rules', () => {
  const profiles = buildProviderImageOptionProfiles([
    { id: 'comfly', imageModels: ['gpt-image-2'] },
  ]);

  assert.deepEqual(
    resolveAgentImageOptions({
      prompt: '生成一个 16:9 海报',
      providerId: 'comfly',
      modelId: 'gpt-image-2',
      providerImageOptionProfiles: profiles,
    }),
    {
      size: '2048x2048',
      aspectRatio: '16:9',
      quality: 'auto',
      count: 1,
      requestedSize: '2048x2048',
      sizeFallback: false,
      requestedAspectRatio: '16:9',
      ratioSource: 'prompt',
      ratioFallback: false,
      requestedQuality: 'auto',
      qualityFallback: false,
    }
  );
});

test('agent image options prefer prompt ratio, then selected ratio, then portrait 3:4 default', () => {
  const profiles = buildProviderImageOptionProfiles([
    { id: 'custom', imageModels: ['gemini-3.1-flash-image-preview'] },
  ]);

  assert.equal(resolveAgentImageOptions({
    prompt: '生成海报',
    selectedAspectRatio: '3:4',
    providerId: 'custom',
    modelId: 'gemini-3.1-flash-image-preview',
    providerImageOptionProfiles: profiles,
  }).aspectRatio, '3:4');

  assert.equal(resolveAgentImageOptions({
    prompt: '生成海报',
    providerId: 'custom',
    modelId: 'gemini-3.1-flash-image-preview',
    providerImageOptionProfiles: profiles,
  }).aspectRatio, '3:4');
});

test('unsupported prompt ratios fall back through the image-card provider profile', () => {
  const profiles = buildProviderImageOptionProfiles([
    { id: 'comfly', imageModels: ['gpt-image-2'] },
  ]);

  const resolved = resolveAgentImageOptions({
    prompt: '生成一个 5:4 海报',
    providerId: 'comfly',
    modelId: 'gpt-image-2',
    providerImageOptionProfiles: profiles,
  });

  assert.equal(resolved.requestedAspectRatio, '5:4');
  assert.equal(resolved.aspectRatio, '3:4');
  assert.equal(resolved.ratioFallback, true);
});

test('agent generation requests are the canvas image-card builder output', () => {
  const profiles = buildProviderImageOptionProfiles([
    { id: 'comfly', imageModels: ['gpt-image-2'] },
  ]);
  const input = {
    prompt: '生成一个 4:3 海报',
    generationPrompt: 'professional poster prompt',
    referenceImages: ['/reference.png'],
    providerId: 'comfly',
    modelId: 'gpt-image-2',
    allowedModelIds: ['gpt-image-2'],
    providerImageOptionProfiles: profiles,
  };

  const resolved = buildAgentImageGenerationRequests(input);
  const canvasRequests = buildAsyncImageTaskRequests({
    input: input.generationPrompt,
    linkedImagePreviews: [{ id: 'agent-reference-1', src: '/reference.png', label: 'image1' }],
    modelId: 'gpt-image-2',
    allowedModelIds: ['gpt-image-2'],
    fallbackModel: 'gpt-image-2',
    imageProviderId: 'comfly',
    providerImageOptionProfiles: profiles,
    size: '2048x2048',
    quality: 'auto',
    count: 1,
    aspectRatio: '4:3',
  });

  assert.deepEqual(resolved.requests, canvasRequests);
  assert.deepEqual(resolved.requests[0], {
    messages: [{ role: 'user', content: 'professional poster prompt' }],
    intent: 'image',
    model: 'gpt-image-2',
    imageProviderId: 'comfly',
    size: '2048x1536',
    n: 1,
    quality: 'auto',
    executionMode: 'async',
    reference_images: ['/reference.png'],
    reference_labels: ['image1'],
  });
  assert.equal(resolved.options.requestSize, '2048x1536');
  assert.deepEqual(resolved.options.requestSizes, ['2048x1536']);
});

test('agent Gemini requests preserve the 2K tier and native aspect ratio', () => {
  const profiles = buildProviderImageOptionProfiles([
    { id: 'custom', imageModels: ['gemini-3.1-flash-image-preview'] },
  ]);
  const resolved = buildAgentImageGenerationRequests({
    prompt: '生成一个 16:9 海报',
    generationPrompt: 'professional widescreen poster',
    providerId: 'custom',
    modelId: 'gemini-3.1-flash-image-preview',
    allowedModelIds: ['gemini-3.1-flash-image-preview'],
    providerImageOptionProfiles: profiles,
  });

  assert.deepEqual(resolved.requests[0], {
    messages: [{ role: 'user', content: 'professional widescreen poster' }],
    intent: 'image',
    model: 'gemini-3.1-flash-image-preview',
    imageProviderId: 'custom',
    size: '2048x2048',
    quality: 'auto',
    n: 1,
    aspect_ratio: '16:9',
    executionMode: 'async',
  });
  assert.equal(resolved.options.requestSize, '2048x2048');
  assert.deepEqual(resolved.options.requestSizes, ['2048x2048']);
});
