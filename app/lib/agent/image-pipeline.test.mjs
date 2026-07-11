import test from 'node:test';
import assert from 'node:assert/strict';

import { optimizeImagePrompt } from './image-pipeline.mjs';

test('optimizeImagePrompt returns the validated final prompt', async () => {
  const result = await optimizeImagePrompt({
    userPrompt: '简约包装盒',
    optimizerModel: 'fast-model',
    chatFn: async () => ({ choices: [{ message: { content: JSON.stringify({
      version: 1,
      intent: 'image_generation',
      subject: 'packaging box',
      style: ['minimal'],
      composition: 'centered',
      lighting: 'studio',
      materials: ['paper'],
      colorPalette: ['white'],
      constraints: [],
      finalPrompt: 'Minimal packaging box in a studio product shot',
    }) } }] }),
  });
  assert.equal(result.prompt, 'Minimal packaging box in a studio product shot');
  assert.equal(result.optimized, true);
});

test('optimizeImagePrompt falls back to the original prompt on invalid JSON or transport failure', async () => {
  const invalid = await optimizeImagePrompt({
    userPrompt: '原始提示词',
    optimizerModel: 'fast-model',
    chatFn: async () => ({ choices: [{ message: { content: 'not json' } }] }),
  });
  assert.deepEqual(invalid, { prompt: '原始提示词', optimized: false, summary: '已保留你的原始设计要求' });

  const failed = await optimizeImagePrompt({
    userPrompt: '原始提示词',
    optimizerModel: 'fast-model',
    chatFn: async () => { throw new Error('offline'); },
  });
  assert.equal(failed.prompt, '原始提示词');
  assert.equal(failed.optimized, false);
});
