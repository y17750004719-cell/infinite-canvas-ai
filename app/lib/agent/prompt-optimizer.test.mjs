import test from 'node:test';
import assert from 'node:assert/strict';

import {
  resolveAgentConversationIntent,
  resolveAgentIntent,
  resolveImageBatchMode,
  resolveImageDeliveryPlan,
} from './prompt-optimizer.mjs';

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
