import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildPromptOptimizerMessages,
  parseOptimizedImagePrompt,
  resolveAgentConversationIntent,
  resolveAgentIntent,
  resolveImageBatchMode,
} from './prompt-optimizer.mjs';

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
      { index: 1, label: 'Rabbit issue', subject: 'rabbit', prompt: 'Vogue rabbit cover, red background' },
      { index: 2, label: 'Cat issue', subject: 'cat', prompt: 'Vogue cat cover, yellow background' },
    ],
  }), { outputCount: 2, batchMode: 'series' });
  assert.deepEqual(valid?.items?.map((item) => item.subject), ['rabbit', 'cat']);
  assert.equal(parseOptimizedImagePrompt(JSON.stringify({
    ...base,
    items: [
      { index: 1, label: 'Rabbit issue', subject: 'rabbit', prompt: 'same prompt' },
      { index: 2, label: 'Cat issue', subject: 'cat', prompt: 'same prompt' },
    ],
  }), { outputCount: 2, batchMode: 'series' }), null);
});

test('batch mode distinguishes cohesive series from ordinary prompt variants', () => {
  assert.equal(resolveImageBatchMode('Vogue 动物杂志封面系列，共 5 期', 5), 'series');
  assert.equal(resolveImageBatchMode('生成 5 个不同版本的封面', 5), 'series');
  assert.equal(resolveImageBatchMode('Please produce a magazine series for 5 issues', 5), 'series');
  assert.equal(resolveImageBatchMode('生成 5 张猫咪封面', 5), 'variants');
});

test('optimizer messages demand JSON and preserve literal user text', () => {
  const messages = buildPromptOptimizerMessages('为 ZO DESIGN 做一个简约包装盒', 'Logo 与品牌');
  assert.equal(messages[0].role, 'system');
  assert.match(messages[0].content, /JSON/);
  assert.match(messages[1].content, /ZO DESIGN/);
  assert.match(messages[1].content, /Logo 与品牌/);
});

test('series optimizer instructions preserve listed subjects and auto-fill missing issues', () => {
  const messages = buildPromptOptimizerMessages('兔子主题的动物杂志系列，共 5 期', undefined, {
    outputCount: 5,
    batchMode: 'series',
  });
  assert.match(messages[0].content, /exactly 5 items/);
  assert.match(messages[0].content, /original order/);
  assert.match(messages[0].content, /automatically add suitable non-repeating subjects/);
});

test('agent intent distinguishes image requests from visual analysis with references', () => {
  assert.equal(resolveAgentIntent('生成一个简约包装盒', false), 'image');
  assert.equal(resolveAgentIntent('分析一下这张图的构图', true), 'chat');
  assert.equal(resolveAgentIntent('参考这张图生成新的海报', true), 'image');
  assert.equal(resolveAgentIntent('Please design a similar Vogue animal magazine cover series for 5 issues.', false), 'image');
  assert.equal(resolveAgentIntent('分析这本 magazine cover', true), 'chat');
  assert.equal(resolveAgentIntent('请按 Logo 与品牌流程开始信息收集，先询问我品牌名称和行业。', false), 'chat');
  assert.equal(resolveAgentIntent('请按品牌识别系统流程开始信息收集，先询问我行业和品牌名称。', false), 'chat');
  assert.equal(resolveAgentIntent('开始批量生成全部品牌物料', false), 'skill_action');
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
