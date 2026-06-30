import test from 'node:test';
import assert from 'node:assert/strict';

import { classifyModel, parseProviderModels } from './provider-models.ts';

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
});
