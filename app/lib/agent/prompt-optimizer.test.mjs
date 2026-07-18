import test from 'node:test';
import assert from 'node:assert/strict';

import {
  applyImagePromptDeliveryContract,
  allowsRepeatedSeriesSubjects,
  buildPromptOptimizerMessages,
  parseOptimizedImagePrompt,
  resolveAgentConversationIntent,
  resolveAgentIntent,
  resolveImageBatchMode,
  resolveImageDeliveryPlan,
} from './prompt-optimizer.mjs';

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

test('parseOptimizedImagePrompt accepts the required structured payload', () => {
  const result = parseOptimizedImagePrompt(JSON.stringify({
    version: 1,
    intent: 'image_generation',
    subject: 'minimal packaging box',
    style: ['modern minimalism'],
    composition: 'centered product shot',
    lighting: 'soft studio lighting',
    materials: ['matte paper'],
    colorPalette: ['warm white', 'black'],
    constraints: ['preserve ZO DESIGN text'],
    finalPrompt: 'Minimal packaging box, centered studio product photography',
  }));
  assert.equal(result.finalPrompt, 'Minimal packaging box, centered studio product photography');
});

test('parseOptimizedImagePrompt rejects markdown and incomplete payloads', () => {
  assert.equal(parseOptimizedImagePrompt('```json\n{"finalPrompt":"x"}\n```'), null);
  assert.equal(parseOptimizedImagePrompt('{"version":1,"intent":"image_generation"}'), null);
});

test('series prompt parsing requires the exact count and distinct item prompts', () => {
  const base = {
    version: 1,
    intent: 'image_generation',
    subject: 'Vogue animal magazine series',
    style: ['editorial'],
    composition: 'consistent masthead',
    lighting: 'studio',
    materials: [],
    colorPalette: ['red'],
    constraints: ['preserve Vogue'],
    finalPrompt: 'Cohesive Vogue animal magazine cover series',
  };
  const valid = parseOptimizedImagePrompt(JSON.stringify({
    ...base,
    items: [
      { index: 1, label: 'Rabbit issue', subjectKey: 'rabbit', subject: 'rabbit', prompt: 'Vogue rabbit cover, red background' },
      { index: 2, label: 'Cat issue', subjectKey: 'cat', subject: 'cat', prompt: 'Vogue cat cover, yellow background' },
    ],
  }), { outputCount: 2, batchMode: 'series' });
  assert.deepEqual(valid?.items?.map((item) => item.subject), ['rabbit', 'cat']);
  assert.equal(parseOptimizedImagePrompt(JSON.stringify({
    ...base,
    items: [
      { index: 1, label: 'Rabbit issue', subjectKey: 'rabbit', subject: 'rabbit', prompt: 'same prompt' },
      { index: 2, label: 'Cat issue', subjectKey: 'cat', subject: 'cat', prompt: 'same prompt' },
    ],
  }), { outputCount: 2, batchMode: 'series' }), null);

  const repeatedSubject = JSON.stringify({
    ...base,
    items: [
      { index: 1, label: 'Rabbit in Paris', subjectKey: 'rabbit', subject: 'rabbit in Paris couture', prompt: 'Vogue rabbit cover in Paris' },
      { index: 2, label: 'Rabbit in Milan', subjectKey: 'rabbit', subject: 'rabbit in Milan tailoring', prompt: 'Vogue rabbit cover in Milan' },
    ],
  });
  assert.equal(parseOptimizedImagePrompt(repeatedSubject, { outputCount: 2, batchMode: 'series' }), null);
  assert.ok(parseOptimizedImagePrompt(repeatedSubject, {
    outputCount: 2,
    batchMode: 'series',
    allowRepeatedSubjects: true,
  }));
});

test('batch mode distinguishes cohesive series from ordinary prompt variants', () => {
  assert.equal(resolveImageBatchMode('Vogue 动物杂志封面系列，共 5 期', 5), 'series');
  assert.equal(resolveImageBatchMode('生成 5 个不同版本的封面', 5), 'series');
  assert.equal(resolveImageBatchMode('Please produce a magazine series for 5 issues', 5), 'series');
  assert.equal(resolveImageBatchMode('生成 5 张猫咪封面', 5), 'variants');
  assert.equal(resolveImageBatchMode('做一张四宫格，每格一种动物', 1), 'composite');
});

test('delivery planning separates variants, series, and composite image scopes', () => {
  assert.deepEqual(resolveImageDeliveryPlan('同一个提示词生成4张供我挑选'), {
    mode: 'variants',
    outputCount: 4,
    promptCount: 1,
    panelCount: undefined,
    variationAxes: [],
    evidence: ['same_prompt_variants', '4张'],
    confidence: 'high',
    requiresClarification: false,
  });
  const series = resolveImageDeliveryPlan('设计一套4期动物杂志，分别使用狗、兔子、猫、老虎');
  assert.equal(series.mode, 'series');
  assert.equal(series.outputCount, 4);
  assert.equal(series.promptCount, 4);
  assert.deepEqual(series.variationAxes, ['subject']);
  assert.deepEqual(resolveImageDeliveryPlan('做一张四宫格，每格一种动物'), {
    mode: 'composite',
    outputCount: 1,
    promptCount: 1,
    panelCount: 4,
    variationAxes: [],
    evidence: ['composite_layout', '一张'],
    confidence: 'high',
    requiresClarification: false,
  });
  const fourGrids = resolveImageDeliveryPlan('生成4张四宫格海报');
  assert.equal(fourGrids.mode, 'composite');
  assert.equal(fourGrids.outputCount, 4);
  assert.equal(fourGrids.panelCount, 4);
  const oneGrid = resolveImageDeliveryPlan('把4个设计方向放在一张图里');
  assert.equal(oneGrid.outputCount, 1);
  assert.equal(oneGrid.panelCount, 4);
  assert.equal(resolveImageDeliveryPlan('生成4张，但全部放在一张图里').requiresClarification, true);
  const ordered = resolveImageDeliveryPlan('狗、猫、兔、虎各一张');
  assert.equal(ordered.mode, 'series');
  assert.equal(ordered.outputCount, 4);
  assert.deepEqual(ordered.variationAxes, ['subject']);
  assert.equal(resolveImageDeliveryPlan('每张换一个主题', 4).mode, 'series');
  assert.equal(resolveImageDeliveryPlan('生成4个不同版本').mode, 'series');
  assert.equal(resolveImageDeliveryPlan('生成4张猫咪封面').mode, 'variants');
  const collageStylePosters = resolveImageDeliveryPlan('Generate four main visual posters with different layouts in a surreal hand-cut collage style');
  assert.equal(collageStylePosters.mode, 'series');
  assert.equal(collageStylePosters.outputCount, 4);
  assert.deepEqual(collageStylePosters.variationAxes, ['composition']);
});

test('delivery prompt contracts forbid accidental grids except for composite requests', () => {
  const standalone = applyImagePromptDeliveryContract('生成4张猫咪封面', { mode: 'variants' });
  assert.doesNotMatch(standalone, /4张/);
  assert.match(standalone, /exactly one standalone image/);
  assert.match(standalone, /No collage/);

  const composite = applyImagePromptDeliveryContract('把4个方向放在一张图里', { mode: 'composite', panelCount: 4 });
  assert.match(composite, /4个方向/);
  assert.match(composite, /4-panel grid/);
  assert.doesNotMatch(composite, /No collage/);

  const jsonSource = JSON.parse(magazineJsonPrompt('rabbit'));
  jsonSource.agent_requirements = {
    must_change: ['Replace person with dogs'],
    must_preserve: ['Keep the red background'],
    literal_copy: ['VOGUE'],
  };
  const jsonPrompt = applyImagePromptDeliveryContract(JSON.stringify(jsonSource), { mode: 'series', outputCount: 4 });
  const parsed = JSON.parse(jsonPrompt);
  assert.match(parsed.constraints.must_preserve.join(' '), /one standalone image/);
  assert.ok(parsed.constraints.avoid.includes('multi-panel layout'));
  assert.deepEqual(parsed.agent_requirements, jsonSource.agent_requirements);
});

test('optimizer messages demand JSON and preserve literal user text', () => {
  const messages = buildPromptOptimizerMessages('为 ZO DESIGN 做一个简约包装盒', 'Logo 与品牌');
  assert.equal(messages[0].role, 'system');
  assert.match(messages[0].content, /JSON/);
  assert.match(messages[1].content, /ZO DESIGN/);
  assert.match(messages[1].content, /Logo 与品牌/);
});

test('JSON text prompt mode keeps the generation prompt as a parseable string', () => {
  const prompt = magazineJsonPrompt();
  const payload = {
    version: 1,
    intent: 'image_generation',
    subject: 'perfume bottle editorial',
    style: ['editorial'],
    composition: 'controlled negative space',
    lighting: 'soft directional studio light',
    materials: ['glass'],
    colorPalette: ['ivory'],
    constraints: [],
    finalPrompt: prompt,
  };
  const parsed = parseOptimizedImagePrompt(JSON.stringify(payload), { promptStyle: 'json-text' });
  assert.deepEqual(JSON.parse(parsed.finalPrompt), JSON.parse(prompt));
  assert.equal(parseOptimizedImagePrompt(JSON.stringify({ ...payload, finalPrompt: 'plain prose' }), {
    promptStyle: 'json-text',
  }), null);
});

test('JSON text series require complete prompts whose nested subject keys match the series plan', () => {
  const base = {
    version: 1,
    intent: 'image_generation',
    subject: 'animal editorial series',
    style: ['editorial'],
    composition: 'consistent masthead',
    lighting: 'studio',
    materials: [],
    colorPalette: ['red'],
    constraints: [],
    finalPrompt: magazineJsonPrompt('animal-series'),
  };
  const valid = parseOptimizedImagePrompt(JSON.stringify({
    ...base,
    items: [
      { index: 1, label: 'Rabbit issue', subjectKey: 'rabbit', subject: 'two rabbits', prompt: magazineJsonPrompt('rabbit') },
      { index: 2, label: 'Dog issue', subjectKey: 'dog', subject: 'two dogs', prompt: magazineJsonPrompt('dog') },
    ],
  }), { outputCount: 2, batchMode: 'series', promptStyle: 'json-text' });
  assert.deepEqual(valid?.items?.map((item) => JSON.parse(item.prompt).subject.subject_key), ['rabbit', 'dog']);

  assert.equal(parseOptimizedImagePrompt(JSON.stringify({
    ...base,
    items: [
      { index: 1, label: 'Rabbit issue', subjectKey: 'rabbit', subject: 'two rabbits', prompt: magazineJsonPrompt('rabbit') },
      { index: 2, label: 'Dog issue', subjectKey: 'dog', subject: 'two dogs', prompt: magazineJsonPrompt('rabbit') },
    ],
  }), { outputCount: 2, batchMode: 'series', promptStyle: 'json-text' }), null);
});

test('JSON text series normalize an outer prose summary to the first validated issue prompt', () => {
  const rabbitPrompt = magazineJsonPrompt('rabbit');
  const dogPrompt = magazineJsonPrompt('dog');
  const parsed = parseOptimizedImagePrompt(JSON.stringify({
    version: 1,
    intent: 'image_generation',
    subject: 'animal editorial series',
    style: ['editorial'],
    composition: 'consistent masthead',
    lighting: 'studio',
    materials: [],
    colorPalette: ['red'],
    constraints: [],
    finalPrompt: 'Five coordinated animal magazine covers',
    items: [
      { index: 1, label: 'Rabbit issue', subjectKey: 'rabbit', subject: 'two rabbits', prompt: rabbitPrompt },
      { index: 2, label: 'Dog issue', subjectKey: 'dog', subject: 'two dogs', prompt: dogPrompt },
    ],
  }), { outputCount: 2, batchMode: 'series', promptStyle: 'json-text' });

  assert.equal(parsed?.finalPrompt, rabbitPrompt);
  assert.deepEqual(parsed?.items?.map((item) => JSON.parse(item.prompt).subject.subject_key), ['rabbit', 'dog']);
});

test('animal candidate pools treat breeds of the same species as duplicate subjects', () => {
  const animalPrompt = (subjectKey, type) => JSON.stringify({
    ...JSON.parse(magazineJsonPrompt(subjectKey)),
    subject: { subject_key: subjectKey, type },
  });
  const payload = {
    version: 1,
    intent: 'image_generation',
    subject: 'animal editorial series',
    style: ['editorial'],
    composition: 'consistent masthead',
    lighting: 'studio',
    materials: [],
    colorPalette: ['red'],
    constraints: [],
    finalPrompt: animalPrompt('rabbit', 'rabbit'),
    items: [
      { index: 1, label: 'Doberman issue', subjectKey: 'doberman', subject: 'Doberman dog', prompt: animalPrompt('doberman', 'Doberman dog') },
      { index: 2, label: 'Greyhound issue', subjectKey: 'greyhound', subject: 'Greyhound dog', prompt: animalPrompt('greyhound', 'Greyhound dog') },
    ],
  };

  assert.equal(parseOptimizedImagePrompt(JSON.stringify(payload), {
    outputCount: 2,
    batchMode: 'series',
    promptStyle: 'json-text',
    userPrompt: '动物可以是狗、兔子、猫、老虎等等，共 2 期',
  }), null);
  assert.ok(parseOptimizedImagePrompt(JSON.stringify(payload), {
    outputCount: 2,
    batchMode: 'series',
    promptStyle: 'json-text',
    userPrompt: '设计不同犬种系列：杜宾和灵缇，共 2 期',
  }));
});

test('optimizer messages load magazine skill instructions without changing the outer response schema', () => {
  const messages = buildPromptOptimizerMessages('设计一张香水杂志封面', '杂志封面与编辑海报', {
    promptStyle: 'json-text',
    skillContent: '# 杂志封面与编辑海报\n最终提示词使用 JSON 文本。',
  });
  assert.match(messages[0].content, /each string must contain one complete valid JSON object/);
  assert.match(messages[0].content, /Active skill instructions/);
  assert.match(messages[0].content, /杂志封面与编辑海报/);
  assert.match(messages[0].content, /"finalPrompt":""/);
});

test('series optimizer instructions preserve listed subjects and auto-fill missing issues', () => {
  const messages = buildPromptOptimizerMessages('请设计一套类似的 Vogue 动物杂志，共 5 期。动物可以是狗、兔子、猫、老虎等等。', undefined, {
    outputCount: 5,
    batchMode: 'series',
  });
  assert.match(messages[0].content, /exactly 5 items/);
  assert.match(messages[0].content, /internal delivery contract/);
  assert.match(messages[0].content, /expandable candidate pool/);
  assert.match(messages[0].content, /original order/);
  assert.match(messages[0].content, /automatically add suitable non-repeating subjects/);
  assert.match(messages[0].content, /Using two dog breeds for two issues does not satisfy the fifth species/);
  assert.match(messages[0].content, /Every item\.subjectKey must name a distinct subject/);
});

test('same-subject series are detected explicitly instead of weakening all series validation', () => {
  assert.equal(allowsRepeatedSeriesSubjects('同一只猫的 5 期杂志系列'), true);
  assert.equal(allowsRepeatedSeriesSubjects('keep the same robot across three posters'), true);
  assert.equal(allowsRepeatedSeriesSubjects('动物可以是狗、兔子、猫、老虎等等'), false);

  const messages = buildPromptOptimizerMessages('同一只猫的 5 期杂志系列', undefined, {
    outputCount: 5,
    batchMode: 'series',
  });
  assert.match(messages[0].content, /explicitly requires the same subject/);
});

test('model-authored edit tasks constrain prompt optimization without local intent inference', () => {
  const messages = buildPromptOptimizerMessages('换成狗', undefined, {
    imageTask: {
      operation: 'edit',
      instruction: '将人物替换为两只狗',
      mustChange: ['人物主体'],
      mustPreserve: ['杂志版式', '原有文字'],
    },
  });
  assert.match(messages[0].content, /authoritatively classified this as an edit/);
  assert.match(messages[0].content, /将人物替换为两只狗/);
  assert.match(messages[0].content, /杂志版式/);
  assert.match(messages[0].content, /Preserve every unspecified visual element/);
});

test('agent intent distinguishes image requests from visual analysis with references', () => {
  assert.equal(resolveAgentIntent('生成一个简约包装盒', false), 'image');
  assert.equal(resolveAgentIntent('分析一下这张图的构图', true), 'chat');
  assert.equal(resolveAgentIntent('参考这张图生成新的海报', true), 'image');
  assert.equal(resolveAgentIntent('Please design a similar Vogue animal magazine cover series for 5 issues.', false), 'image');
  assert.equal(resolveAgentIntent('分析这本 magazine cover', true), 'chat');
  assert.equal(resolveAgentIntent('分析这张杂志封面的排版', true), 'chat');
  assert.equal(resolveAgentIntent('分析后生成一张新的杂志封面', true), 'image');
  assert.equal(resolveAgentIntent('请按 Logo 与品牌流程开始信息收集，先询问我品牌名称和行业。', false), 'chat');
  assert.equal(resolveAgentIntent('请按品牌识别系统流程开始信息收集，先询问我行业和品牌名称。', false), 'chat');
  assert.equal(resolveAgentIntent('开始批量生成全部品牌物料', false), 'skill_action');
  assert.equal(resolveAgentIntent('狗、猫、兔、虎各一张', false), 'image');
  assert.equal(resolveAgentIntent('做一张四宫格，每格一种动物', false), 'image');
});

test('agent conversation intent inherits an immediate execution confirmation', () => {
  const result = resolveAgentConversationIntent([
    { role: 'user', content: '生成一组英国短毛猫封面' },
    { role: 'assistant', content: '首张方向已经确定，请问是否继续生成其余封面？' },
    { role: 'assistant', content: '[Generated image: agent-generated-image omitted from chat history]' },
    { role: 'user', content: '按这个来' },
  ]);

  assert.equal(result.intent, 'image');
  assert.equal(result.inherited, true);
  assert.equal(result.needsDirectionConfirmation, false);
  assert.match(result.brief, /英国短毛猫封面/);
  assert.match(result.brief, /用户确认：按这个来/);
});

test('agent conversation intent does not turn ordinary acknowledgements into execution', () => {
  const ordinary = resolveAgentConversationIntent([
    { role: 'user', content: '解释一下极简主义' },
    { role: 'assistant', content: '极简主义强调减少干扰并突出核心信息。' },
    { role: 'user', content: '好的' },
  ]);
  const explicitChat = resolveAgentConversationIntent([
    { role: 'user', content: '生成一张海报' },
    { role: 'assistant', content: '是否继续生成？' },
    { role: 'user', content: '/chat 先讨论一下' },
  ]);

  assert.deepEqual(ordinary, {
    intent: 'chat',
    brief: '好的',
    inherited: false,
    needsDirectionConfirmation: false,
  });
  assert.deepEqual(explicitChat, {
    intent: 'chat',
    brief: '/chat 先讨论一下',
    inherited: false,
    needsDirectionConfirmation: false,
  });
});

test('agent conversation intent asks for a new asset direction only when it is missing', () => {
  const missing = resolveAgentConversationIntent([
    { role: 'user', content: '生成第二张封面' },
  ]);
  const specified = resolveAgentConversationIntent([
    { role: 'user', content: '生成第二张时尚猫咪封面' },
  ]);

  assert.equal(missing.intent, 'image');
  assert.equal(missing.needsDirectionConfirmation, true);
  assert.equal(specified.intent, 'image');
  assert.equal(specified.needsDirectionConfirmation, false);
});

test('agent conversation intent inherits a confirmed image brief across a transient failure', () => {
  const result = resolveAgentConversationIntent([
    { role: 'user', content: '生成第三张封面' },
    { role: 'assistant', content: '是否按这套时尚犬类方向继续生成？' },
    { role: 'assistant', content: '生成失败: fetch failed' },
    { role: 'user', content: '同意，给我生成图片' },
  ]);

  assert.equal(result.intent, 'image');
  assert.equal(result.inherited, true);
  assert.equal(result.needsDirectionConfirmation, false);
  assert.match(result.brief, /生成第三张封面/);
});
