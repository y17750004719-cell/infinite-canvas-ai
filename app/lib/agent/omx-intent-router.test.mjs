import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveOmxIntent } from './omx-intent-router.mjs';

test('explicit OMX directives win over automatic routing', () => {
  assert.deepEqual(resolveOmxIntent({ prompt: '$plan-omx 设计登录系统' }), { mode: 'explicit', workflowId: 'plan', confidence: 'high', reason: 'explicit_omx_directive' });
  assert.deepEqual(resolveOmxIntent({ prompt: '按 OMX 代码审查检查当前改动' }).workflowId, 'code_review');
});

test('simple requests remain ordinary and disable wins', () => {
  assert.equal(resolveOmxIntent({ prompt: '把这个标题改成蓝色' }).mode, 'ordinary');
  assert.equal(resolveOmxIntent({ prompt: '不要使用 OMX，直接修复这个拼写错误' }).reason, 'user_disabled_omx');
});

test('only high-confidence complex requests auto-enter', () => {
  const decision = resolveOmxIntent({ prompt: '请分析这个 agent runtime 问题，制定方案，重构多个文件，补齐回归测试并验证' });
  assert.deepEqual(decision, { mode: 'automatic', workflowId: 'verify', confidence: 'high', reason: 'multi_stage_complex_request' });
  assert.equal(resolveOmxIntent({ prompt: '分析问题并实现一个方案' }).mode, 'suggest');
});

test('active workflow continues without reclassification', () => {
  assert.deepEqual(resolveOmxIntent({ prompt: '继续', activeWorkflow: { status: 'running', workflowId: 'code_review' } }), { mode: 'automatic', workflowId: 'code_review', confidence: 'high', reason: 'active_workflow_continuation' });
});
