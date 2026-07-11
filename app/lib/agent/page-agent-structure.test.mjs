import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const source = fs.readFileSync(path.resolve(import.meta.dirname, '../../page.tsx'), 'utf8');

test('right chat defaults to agent and loads skills from the registry api', () => {
  assert.match(source, /type GenerationMode = 'agent' \| 'image' \| 'chat'/);
  assert.match(source, /PROMPT_PIPELINE_AGENT_ENABLED \? 'agent' : 'chat'/);
  assert.match(source, /fetch\('\/api\/skills'/);
});

test('agent mode posts to the agent route and handles agent events', () => {
  assert.match(source, /generationMode === 'agent' \? '\/api\/agent' : '\/api\/generate'/);
  assert.match(source, /prompt_optimization_start/);
  assert.match(source, /prompt_optimization_done/);
  assert.match(source, /client_action/);
  assert.match(source, /agent_error/);
});

test('agent progress displays all emoji breadcrumb labels', () => {
  assert.match(source, /🧠 AI 正在理解你的设计意图/);
  assert.match(source, /🎨 正在优化构图、材质与光影语言/);
  assert.match(source, /🚀 正在渲染高分辨率画面/);
  assert.match(source, /✨ 已完成设计生成/);
});
