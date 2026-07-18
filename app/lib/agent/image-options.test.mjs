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
  resolveAgentImageBatchContinuation,
  resolveAgentImageCountDecision,
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

test('agent image count decisions prefer clarification, prompt, explicit interface, then default', () => {
  assert.deepEqual(resolveAgentImageCountDecision({ prompt: '共5期', interfaceCount: 1 }), {
    status: 'resolved',
    count: 5,
    totalCount: 5,
    source: 'prompt',
    candidates: [5],
    matchedText: '5期',
  });
  assert.equal(resolveAgentImageCountDecision({ prompt: '生成封面', interfaceCount: 4 }).count, 4);
  assert.equal(resolveAgentImageCountDecision({ prompt: '生成封面', interfaceCount: 1 }).count, 1);
  assert.equal(resolveAgentImageCountDecision({ prompt: '共5期', clarifiedCount: 3 }).count, 3);
  assert.deepEqual(resolveAgentImageCountDecision({ prompt: '共5期', interfaceCount: 2 }).candidates, [5, 2]);
  assert.equal(resolveAgentImageCountDecision({
    rawPrompt: '请生成4张',
    prompt: '杂志封面',
    interfaceCount: 1,
  }).count, 4);
  assert.equal(resolveAgentImageCountDecision({
    rawPrompt: '把4个方案放在一张图里',
    plannedCount: 1,
    interfaceCount: 1,
  }).count, 1);
});

test('agent image count decisions restore per-batch counts from remaining successful outputs', () => {
  const plan = { totalCount: 20, completedCount: 9, remainingCount: 11, batchSize: 9 };
  assert.deepEqual(resolveAgentImageCountDecision({ prompt: '生成20张', batchPlan: plan }), {
    status: 'resolved',
    count: 9,
    totalCount: 20,
    source: 'batch',
    batchPlan: plan,
    candidates: [20],
  });
  assert.equal(resolveAgentImageCountDecision({
    batchPlan: { ...plan, completedCount: 18, remainingCount: 2 },
  }).count, 2);
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

test('agent series generation creates one request per distinct issue prompt', () => {
  const profiles = buildProviderImageOptionProfiles([
    { id: 'comfly', imageModels: ['gpt-image-2'] },
  ]);
  const resolved = buildAgentImageGenerationRequests({
    prompt: 'Vogue 动物杂志系列，共 3 期',
    generationPrompt: 'shared series prompt',
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

test('series batch continuation retries failed issues before later untouched issues', () => {
  const currentItems = Array.from({ length: 9 }, (_, index) => ({ id: `issue-${index + 1}` }));
  const remainingItems = Array.from({ length: 11 }, (_, index) => ({ id: `issue-${index + 10}` }));
  const continuation = resolveAgentImageBatchContinuation({
    currentItems,
    remainingItems,
    failedItemIds: ['issue-2', 'issue-8'],
  });
  assert.equal(continuation.pendingCount, 13);
  assert.deepEqual(continuation.nextItems.map((item) => item.id), [
    'issue-2',
    'issue-8',
    'issue-10',
    'issue-11',
    'issue-12',
    'issue-13',
    'issue-14',
    'issue-15',
    'issue-16',
  ]);
  assert.deepEqual(continuation.remainingItems.map((item) => item.id), [
    'issue-17',
    'issue-18',
    'issue-19',
    'issue-20',
  ]);
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
