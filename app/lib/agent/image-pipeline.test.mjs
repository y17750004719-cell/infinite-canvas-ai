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

test('series optimization retries invalid plans and returns distinct issue prompts', async () => {
  let calls = 0;
  const result = await optimizeImagePrompt({
    userPrompt: 'Vogue 动物杂志系列，共 2 期',
    optimizerModel: 'fast-model',
    outputCount: 2,
    batchMode: 'series',
    chatFn: async () => {
      calls += 1;
      return { choices: [{ message: { content: calls === 1 ? 'not json' : JSON.stringify({
        version: 1,
        intent: 'image_generation',
        subject: 'Vogue animal series',
        style: ['editorial'],
        composition: 'consistent masthead',
        lighting: 'studio',
        materials: [],
        colorPalette: ['red'],
        constraints: ['preserve Vogue'],
        finalPrompt: 'Cohesive Vogue animal cover series',
        items: [
          { index: 1, label: 'Rabbit issue', subject: 'rabbit', prompt: 'Vogue rabbit cover in red' },
          { index: 2, label: 'Cat issue', subject: 'cat', prompt: 'Vogue cat cover in yellow' },
        ],
      }) } }] };
    },
  });
  assert.equal(calls, 2);
  assert.deepEqual(result.items?.map((item) => item.subject), ['rabbit', 'cat']);
});

test('series optimization never falls back to repeated original prompts', async () => {
  await assert.rejects(() => optimizeImagePrompt({
    userPrompt: 'Vogue 动物杂志系列，共 5 期',
    optimizerModel: 'fast-model',
    outputCount: 5,
    batchMode: 'series',
    chatFn: async () => ({ choices: [{ message: { content: 'invalid' } }] }),
  }), /未能形成完整的 5 期系列生成计划/);
});
