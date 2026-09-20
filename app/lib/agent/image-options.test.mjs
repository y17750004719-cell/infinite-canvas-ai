import test from 'node:test';
import assert from 'node:assert/strict';

import { buildProviderImageOptionProfiles } from '../image-provider-option-profiles.mjs';
import {
  AGENT_DEFAULT_IMAGE_OPTIONS,
  AGENT_MAX_IMAGE_BATCH_COUNT,
  buildAgentImageGenerationRequests,
  extractAgentImageCount,
  extractAgentImageFileCounts,
  extractExplicitImageAspectRatio,
  parseAgentImageCountNumber,
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
  assert.equal(AGENT_MAX_IMAGE_BATCH_COUNT, 9);
});

test('agent image count parser supports Chinese, English, and compound deliverable counts', () => {
  assert.deepEqual(extractAgentImageCount('请设计一套杂志封面，共5期'), {
    status: 'resolved',
    count: 5,
    source: 'prompt',
    candidates: [5],
    matchedText: '5期',
  });
  assert.equal(extractAgentImageCount('生成六张封面').count, 6);
  assert.equal(extractAgentImageCount('做4个版本').count, 4);
  assert.equal(extractAgentImageCount('生成4个不同版本').count, 4);
  assert.equal(extractAgentImageCount('Create six covers').count, 6);
  assert.equal(extractAgentImageCount('Generate four main visual posters').count, 4);
  assert.equal(extractAgentImageCount('生成 4\u200B張图片').count, 4);
  assert.deepEqual(extractAgentImageCount('3套，每套4张'), {
    status: 'overflow',
    count: 12,
    source: 'prompt',
    candidates: [12],
    matchedText: '3套,每套4张',
  });
  assert.equal(extractAgentImageCount('5期，每期2版').count, 10);
});

test('agent image file counts exclude inner concepts while preserving outer image counts', () => {
  assert.deepEqual(extractAgentImageFileCounts('把4个设计方向放在一张图里').map((item) => item.count), [1]);
  assert.deepEqual(extractAgentImageFileCounts('生成4张四宫格海报').map((item) => item.count), [4]);
  assert.deepEqual(extractAgentImageFileCounts('create four images as a grid').map((item) => item.count), [4]);
});

test('agent image count parser rejects subject counts and technical numbers', () => {
  assert.equal(extractAgentImageCount('画面里有5只兔子').status, 'none');
  assert.deepEqual(extractAgentImageCount('两只兔子的一张封面'), {
    status: 'resolved',
    count: 1,
    source: 'prompt',
    candidates: [1],
    matchedText: '一张',
  });
  assert.equal(extractAgentImageCount('16:9, 2K, 2048x2048, 2026').status, 'none');
  assert.equal(extractAgentImageCount('生成5个').status, 'ambiguous');
});

test('agent image count parser surfaces conflicting deliverable counts', () => {
  const result = extractAgentImageCount('生成3张封面，但最终要5个版本');
  assert.equal(result.status, 'ambiguous');
  assert.deepEqual(result.candidates, [3, 5]);
  assert.equal(parseAgentImageCountNumber('二十一'), 21);
  assert.equal(parseAgentImageCountNumber('twenty-one'), 21);
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

test('image contract ratio takes precedence over prompt and shared canvas ratio', () => {
  const profiles = buildProviderImageOptionProfiles([
    { id: 'custom', imageModels: ['gemini-3.1-flash-image-preview'] },
  ]);

  const resolved = resolveAgentImageOptions({
    prompt: '生成一个 16:9 海报',
    contractAspectRatio: '2:3',
    selectedAspectRatio: '1:1',
    providerId: 'custom',
    modelId: 'gemini-3.1-flash-image-preview',
    providerImageOptionProfiles: profiles,
  });

  assert.equal(resolved.requestedAspectRatio, '2:3');
  assert.equal(resolved.aspectRatio, '2:3');
  assert.equal(resolved.ratioSource, 'contract');
});

test('unsupported prompt ratios remain explicit for protocol adapters to handle', () => {
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
  assert.equal(resolved.aspectRatio, '5:4');
  assert.equal(resolved.ratioFallback, false);
});

test('agent generation requests are the canvas image-card builder output', () => {
  const profiles = buildProviderImageOptionProfiles([
    { id: 'comfly', imageModels: ['gpt-image-2'] },
  ]);
  const input = {
    prompt: 'professional poster prompt',
    contractAspectRatio: '4:3',
    referenceImages: ['/reference.png'],
    providerId: 'comfly',
    modelId: 'gpt-image-2',
    allowedModelIds: ['gpt-image-2'],
    providerImageOptionProfiles: profiles,
  };

  const resolved = buildAgentImageGenerationRequests(input);
  const canvasRequests = buildAsyncImageTaskRequests({
    input: input.prompt,
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
    aspect_ratio: '4:3',
    executionMode: 'async',
    reference_images: ['/reference.png'],
    reference_labels: ['image1'],
  });
  assert.equal(resolved.options.requestSize, '2048x1536');
  assert.deepEqual(resolved.options.requestSizes, ['2048x1536']);
});

test('agent generation ignores the retired generationPrompt fallback', () => {
  const resolved = buildAgentImageGenerationRequests({
    prompt: 'Main Agent final prompt',
    // A persisted legacy field must not replace the current tool argument.
    generationPrompt: 'legacy planner prompt',
    providerId: 'comfly',
    modelId: 'gpt-image-2',
    allowedModelIds: ['gpt-image-2'],
  });

  assert.equal(resolved.requests[0]?.messages?.[0]?.content, 'Main Agent final prompt');
});

test('agent generation requests preserve the model-selected linked image order with canvas request parity', () => {
  const profiles = buildProviderImageOptionProfiles([
    { id: 'comfly', imageModels: ['gpt-image-2'] },
  ]);
  const linkedImagePreviews = [
    { id: 'supporting-reference', src: '/style.png', label: 'Style reference' },
    { id: 'edit-target', src: '/target.png', label: 'Vogue cover' },
    { id: 'unused-reference', src: '/unused.png', label: 'Unused reference' },
  ];
  const sharedInput = {
    input: 'replace the subjects with fashionable dogs',
    linkedImagePreviews: [linkedImagePreviews[1], linkedImagePreviews[0]],
    modelId: 'gpt-image-2',
    allowedModelIds: ['gpt-image-2'],
    fallbackModel: 'gpt-image-2',
    imageProviderId: 'comfly',
    providerImageOptionProfiles: profiles,
    size: '2048x2048',
    quality: 'auto',
    count: 1,
    aspectRatio: '3:4',
  };

  const agentResult = buildAgentImageGenerationRequests({
    prompt: sharedInput.input,
    linkedImagePreviews,
    referenceIds: ['edit-target', 'supporting-reference'],
    providerId: sharedInput.imageProviderId,
    modelId: sharedInput.modelId,
    allowedModelIds: sharedInput.allowedModelIds,
    providerImageOptionProfiles: profiles,
    selectedAspectRatio: sharedInput.aspectRatio,
    requestedSize: sharedInput.size,
    requestedQuality: sharedInput.quality,
    requestedCount: sharedInput.count,
  });

  assert.deepEqual(agentResult.requests, buildAsyncImageTaskRequests(sharedInput));
  assert.deepEqual(agentResult.requests[0].reference_images, ['/target.png', '/style.png']);
  assert.deepEqual(agentResult.requests[0].reference_labels, ['Vogue cover', 'Style reference']);
});

test('agent series generation creates one request per distinct issue prompt', () => {
  const profiles = buildProviderImageOptionProfiles([
    { id: 'comfly', imageModels: ['gpt-image-2'] },
  ]);
  const resolved = buildAgentImageGenerationRequests({
    prompt: 'Vogue 动物杂志系列，共 3 期',
    generationPrompts: [
      'Vogue rabbit issue with red background',
      'Vogue cat issue with yellow background',
      'Vogue dog issue with green background',
    ],
    providerId: 'comfly',
    modelId: 'gpt-image-2',
    allowedModelIds: ['gpt-image-2'],
    providerImageOptionProfiles: profiles,
    requestedCount: 3,
  });
  assert.equal(resolved.options.count, 3);
  assert.deepEqual(resolved.requests.map((request) => request.messages?.[0]?.content), [
    'Vogue rabbit issue with red background',
    'Vogue cat issue with yellow background',
    'Vogue dog issue with green background',
  ]);
  assert.ok(resolved.requests.every((request) => request.n === 1));
});

test('agent Gemini requests preserve the 2K tier and native aspect ratio', () => {
  const profiles = buildProviderImageOptionProfiles([
    { id: 'custom', imageModels: ['gemini-3.1-flash-image-preview'] },
  ]);
  const resolved = buildAgentImageGenerationRequests({
    prompt: 'professional widescreen poster',
    contractAspectRatio: '16:9',
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
    size: '2048x1152',
    quality: 'auto',
    n: 1,
    aspect_ratio: '16:9',
    executionMode: 'async',
  });
  assert.equal(resolved.options.requestSize, '2048x1152');
  assert.deepEqual(resolved.options.requestSizes, ['2048x1152']);
});
