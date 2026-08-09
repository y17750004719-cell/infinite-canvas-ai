import test from 'node:test';
import assert from 'node:assert/strict';

import { classifyModel, mergeProviderModelProbeResults, parseProviderModels } from './provider-models.ts';

test('classifyModel treats known image model families as image models', () => {
  assert.equal(classifyModel('flux/schnell'), 'image');
  assert.equal(classifyModel('flux/dev'), 'image');
  assert.equal(classifyModel('flux-pro'), 'image');
  assert.equal(classifyModel('stable-diffusion-v3-medium'), 'image');
  assert.equal(classifyModel('sd3-medium'), 'image');
  assert.equal(classifyModel('recraft-v3'), 'image');
  assert.equal(classifyModel('seedream-4.0-8k'), 'image');
  assert.equal(classifyModel('wanx2.1-t2i-plus'), 'image');
  assert.equal(classifyModel('gpt-4.1'), 'chat');
});

test('classifyModel prefers upstream capability fields over model id keywords', () => {
  assert.equal(
    classifyModel('custom-renderer-v1', {
      modalities: ['text', 'image'],
    }),
    'image'
  );
  assert.equal(
    classifyModel('custom-chat-v1', {
      capabilities: {
        image_generation: false,
        text_generation: true,
      },
    }),
    'chat'
  );
  assert.equal(classifyModel('custom-audio-model', { output_modalities: ['audio'] }), 'voice');
  assert.equal(classifyModel('custom-chat-v2', { capabilities: { audio: false, text_generation: true } }), 'chat');
  assert.equal(classifyModel('mimo-tts-v1'), 'voice');
});

test('parseProviderModels classifies provider objects with capability metadata as image models', () => {
  const result = parseProviderModels(
    {
      data: [
        { id: 'flux/schnell' },
        { id: 'custom-renderer-v1', output_modalities: ['image'] },
        { id: 'gpt-4.1-mini', modalities: ['text'] },
      ],
    },
    'openai'
  );

  assert.deepEqual(result.allModels, ['custom-renderer-v1', 'flux/schnell', 'gpt-4.1-mini']);
  assert.deepEqual(result.imageModels, ['custom-renderer-v1', 'flux/schnell']);
  assert.deepEqual(result.chatModels, ['gpt-4.1-mini']);
  assert.deepEqual(result.voiceModels, []);
});

test('parseProviderModels keeps TTS models out of chat models', () => {
  const result = parseProviderModels({
    data: [
      { id: 'mimo-v2.5-pro', modalities: ['text'] },
      { id: 'mimo-tts-v1', capabilities: { text_to_speech: true } },
    ],
  }, 'openai');

  assert.deepEqual(result.chatModels, ['mimo-v2.5-pro']);
  assert.deepEqual(result.voiceModels, ['mimo-tts-v1']);
});

test('mergeProviderModelProbeResults combines successful model sources', () => {
  const result = mergeProviderModelProbeResults([
    {
      label: '主 API',
      result: {
        ok: true,
        status: 200,
        message: 'ok',
        modelCount: 1,
        allModels: ['gpt-4.1-mini'],
        imageModels: [],
        chatModels: ['gpt-4.1-mini'],
        imageRequestMode: 'openai',
      },
    },
    {
      label: '生图 API（Gemini）',
      result: {
        ok: true,
        status: 200,
        message: 'ok',
        modelCount: 2,
        allModels: ['gemini-2.5-flash-image', 'gpt-4.1-mini'],
        imageModels: ['gemini-2.5-flash-image', 'gpt-4.1-mini'],
        chatModels: [],
        imageRequestMode: 'openai',
      },
    },
  ]);

  assert.equal(result.ok, true);
  assert.deepEqual(result.allModels, ['gemini-2.5-flash-image', 'gpt-4.1-mini']);
  assert.deepEqual(result.imageModels, ['gemini-2.5-flash-image', 'gpt-4.1-mini']);
  assert.deepEqual(result.chatModels, []);
  assert.deepEqual(result.modelSources, {
    'gemini-2.5-flash-image': ['生图 API（Gemini）'],
    'gpt-4.1-mini': ['主 API', '生图 API（Gemini）'],
  });
});

test('mergeProviderModelProbeResults succeeds when at least one source works', () => {
  const result = mergeProviderModelProbeResults([
    {
      label: '主 API',
      result: {
        ok: false,
        status: 401,
        message: 'unauthorized',
        modelCount: 0,
        allModels: [],
        imageModels: [],
        chatModels: [],
        imageRequestMode: 'openai',
      },
    },
    {
      label: '生图 API',
      result: {
        ok: true,
        status: 200,
        message: 'ok',
        modelCount: 1,
        allModels: ['flux/dev'],
        imageModels: ['flux/dev'],
        chatModels: [],
        imageRequestMode: 'openai-json',
      },
    },
  ]);

  assert.equal(result.ok, true);
  assert.equal(result.modelCount, 1);
  assert.equal(result.message, '连接可用，找到 1 个模型；1 个来源失败：主 API');
  assert.deepEqual(result.failedSources, ['主 API']);
  assert.deepEqual(result.modelSources, {
    'flux/dev': ['生图 API'],
  });
});

test('mergeProviderModelProbeResults assigns conflicting models to one category', () => {
  const result = mergeProviderModelProbeResults([
    { label: 'image', result: { ok: true, status: 200, message: 'ok', modelCount: 1, allModels: ['same'], imageModels: ['same'], chatModels: [], voiceModels: [], imageRequestMode: 'openai' } },
    { label: 'voice', result: { ok: true, status: 200, message: 'ok', modelCount: 1, allModels: ['same'], imageModels: [], chatModels: [], voiceModels: ['same'], imageRequestMode: 'openai' } },
  ]);
  assert.deepEqual(result.imageModels, []);
  assert.deepEqual(result.voiceModels, ['same']);
  assert.deepEqual(result.chatModels, []);
});
