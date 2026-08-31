import test from 'node:test';
import assert from 'node:assert/strict';

import {
  resolveImageBatchMode,
  resolveImageDeliveryPlan,
} from './image-delivery-utils.mjs';

test('delivery planning distinguishes cohesive series from ordinary prompt variants', () => {
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
  assert.equal(resolveImageDeliveryPlan('生成4张，但全部放在一张图里').requiresClarification, true);
  const ordered = resolveImageDeliveryPlan('狗、猫、兔、虎各一张');
  assert.equal(ordered.mode, 'series');
  assert.equal(ordered.outputCount, 4);
  assert.deepEqual(ordered.variationAxes, ['subject']);
});
