import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildPromptOptimizerMessages,
  parseOptimizedImagePrompt,
  resolveAgentIntent,
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

test('optimizer messages demand JSON and preserve literal user text', () => {
  const messages = buildPromptOptimizerMessages('为 ZO DESIGN 做一个简约包装盒', 'Logo 与品牌');
  assert.equal(messages[0].role, 'system');
  assert.match(messages[0].content, /JSON/);
  assert.match(messages[1].content, /ZO DESIGN/);
  assert.match(messages[1].content, /Logo 与品牌/);
});

test('agent intent distinguishes image requests from visual analysis with references', () => {
  assert.equal(resolveAgentIntent('生成一个简约包装盒', false), 'image');
  assert.equal(resolveAgentIntent('分析一下这张图的构图', true), 'chat');
  assert.equal(resolveAgentIntent('参考这张图生成新的海报', true), 'image');
  assert.equal(resolveAgentIntent('请按 Logo 与品牌流程开始信息收集，先询问我品牌名称和行业。', false), 'chat');
  assert.equal(resolveAgentIntent('请按品牌识别系统流程开始信息收集，先询问我行业和品牌名称。', false), 'chat');
  assert.equal(resolveAgentIntent('开始批量生成全部品牌物料', false), 'skill_action');
});
