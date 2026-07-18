import test from 'node:test';
import assert from 'node:assert/strict';

import { optimizeImagePrompt } from './image-pipeline.mjs';

const magazineJsonPrompt = (subjectKey = 'perfume-bottle') => JSON.stringify({
  deliverable: 'magazine_cover',
  issue: {},
  editorial_direction: {},
  subject: { subject_key: subjectKey },
  styling: {},
  composition: {},
  environment: {},
  typography: {},
  lighting: {},
  color_system: {},
  rendering: {},
  series_consistency: {},
  constraints: {},
});

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

test('JSON text skills retry malformed prompt strings and preserve valid JSON text', async () => {
  let calls = 0;
  const result = await optimizeImagePrompt({
    userPrompt: '设计一张高级香水杂志封面',
    skillLabel: '杂志封面与编辑海报',
    skillContent: '最终生图提示词必须使用 JSON 文本。',
    promptStyle: 'json-text',
    optimizerModel: 'fast-model',
    chatFn: async () => {
      calls += 1;
      return { choices: [{ message: { content: JSON.stringify({
        version: 1,
        intent: 'image_generation',
        subject: 'perfume bottle editorial',
        style: ['editorial'],
        composition: 'controlled negative space',
        lighting: 'soft studio light',
        materials: ['glass'],
        colorPalette: ['ivory'],
        constraints: [],
        finalPrompt: calls === 1
          ? 'not json text'
          : magazineJsonPrompt(),
      }) } }] };
    },
  });

  assert.equal(calls, 2);
  assert.equal(JSON.parse(result.prompt).deliverable, 'magazine_cover');
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
          { index: 1, label: 'Rabbit issue', subjectKey: 'rabbit', subject: 'rabbit', prompt: 'Vogue rabbit cover in red' },
          { index: 2, label: 'Cat issue', subjectKey: 'cat', subject: 'cat', prompt: 'Vogue cat cover in yellow' },
        ],
      }) } }] };
    },
  });
  assert.equal(calls, 2);
  assert.deepEqual(result.items?.map((item) => item.subject), ['rabbit', 'cat']);
});

test('series optimization preserves authoritative planner item directions', async () => {
  const plannerItems = [
    { index: 1, label: 'Asymmetric layout', subject: 'Greek statue', variation: 'asymmetric paper layers' },
    { index: 2, label: 'Centered layout', subject: 'Greek statue', variation: 'centered typographic frame' },
  ];
  const result = await optimizeImagePrompt({
    userPrompt: 'Two posters using the same Greek statue with different layouts',
    optimizerModel: 'fast-model',
    outputCount: 2,
    batchMode: 'series',
    plannerItems,
    chatFn: async () => ({ choices: [{ message: { content: JSON.stringify({
      version: 1,
      intent: 'image_generation',
      subject: 'Greek statue poster series',
      style: ['collage'],
      composition: 'editorial',
      lighting: 'flat print light',
      materials: ['paper'],
      colorPalette: ['black', 'red'],
      constraints: [],
      finalPrompt: 'Greek statue editorial poster',
      items: [
        { index: 1, label: 'Generated label A', subjectKey: 'greek-statue', subject: 'generated subject A', prompt: 'First poster prompt' },
        { index: 2, label: 'Generated label B', subjectKey: 'greek-statue', subject: 'generated subject B', prompt: 'Second poster prompt' },
      ],
    }) } }] }),
  });
  assert.deepEqual(result.items?.map((item) => item.label), ['Asymmetric layout', 'Centered layout']);
  assert.deepEqual(result.items?.map((item) => item.subject), ['Greek statue', 'Greek statue']);
  assert.match(result.items?.[0].prompt || '', /asymmetric paper layers/);
});

test('series optimization retries a repeated-subject plan when the brief describes a candidate pool', async () => {
  let calls = 0;
  const base = {
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
  };
  const result = await optimizeImagePrompt({
    userPrompt: '设计一套类似的杂志，共 2 期。动物可以是狗、兔子、猫、老虎等等。',
    optimizerModel: 'fast-model',
    outputCount: 2,
    batchMode: 'series',
    chatFn: async () => {
      calls += 1;
      return { choices: [{ message: { content: JSON.stringify({
        ...base,
        items: calls === 1
          ? [
              { index: 1, label: 'Rabbit one', subjectKey: 'rabbit', subject: 'rabbit in Paris', prompt: 'Rabbit cover one' },
              { index: 2, label: 'Rabbit two', subjectKey: 'rabbit', subject: 'rabbit in Milan', prompt: 'Rabbit cover two' },
            ]
          : [
              { index: 1, label: 'Dog issue', subjectKey: 'dog', subject: 'dog', prompt: 'Vogue dog cover' },
              { index: 2, label: 'Rabbit issue', subjectKey: 'rabbit', subject: 'rabbit', prompt: 'Vogue rabbit cover' },
            ],
      }) } }] };
    },
  });

  assert.equal(calls, 2);
  assert.deepEqual(result.items?.map((item) => item.subject), ['dog', 'rabbit']);
});

test('series optimization permits repeated subjects only when the user explicitly requests them', async () => {
  const result = await optimizeImagePrompt({
    userPrompt: '同一只猫的 2 期杂志系列',
    optimizerModel: 'fast-model',
    outputCount: 2,
    batchMode: 'series',
    chatFn: async () => ({ choices: [{ message: { content: JSON.stringify({
      version: 1,
      intent: 'image_generation',
      subject: 'same cat editorial series',
      style: ['editorial'],
      composition: 'consistent masthead',
      lighting: 'studio',
      materials: [],
      colorPalette: ['red'],
      constraints: [],
      finalPrompt: 'Same cat editorial series',
      items: [
        { index: 1, label: 'Paris issue', subjectKey: 'same cat', subject: 'same cat in Paris couture', prompt: 'Same cat in Paris couture' },
        { index: 2, label: 'Milan issue', subjectKey: 'same cat', subject: 'same cat in Milan tailoring', prompt: 'Same cat in Milan tailoring' },
      ],
    }) } }] }),
  });

  assert.deepEqual(result.items?.map((item) => item.subjectKey), ['same cat', 'same cat']);
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
