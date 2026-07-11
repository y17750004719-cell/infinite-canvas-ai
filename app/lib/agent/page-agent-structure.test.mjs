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

test('right chat exposes adaptive chat and image provider model selectors', () => {
  assert.match(source, /对话 ·/);
  assert.match(source, /生图 ·/);
  assert.match(source, /generationMode === 'agent' \|\| generationMode === 'chat'/);
  assert.match(source, /generationMode === 'agent' \|\| generationMode === 'image'/);
  assert.match(source, /chatProviderId/);
  assert.match(source, /chatModelId/);
  assert.match(source, /imageProviderId/);
  assert.match(source, /imageModelId/);
  assert.match(source, /aria-expanded=/);
  assert.match(source, /未配置聊天模型/);
  assert.match(source, /未配置生图模型/);
});

test('chat panel sends selected providers and models to agent and direct routes', () => {
  assert.match(source, /chatOptions:\s*\{/);
  assert.match(source, /chatOptions:\s*\{[\s\S]{0,140}providerId:\s*selectedChatProviderId/);
  assert.match(source, /chatOptions:\s*\{[\s\S]{0,180}model:\s*selectedChatModelId/);
  assert.match(source, /imageOptions:\s*\{[\s\S]{0,140}providerId:\s*selectedImageProviderId/);
  assert.match(source, /imageOptions:\s*\{[\s\S]{0,180}model:\s*selectedImageModelId/);
  assert.match(source, /requestBody\.chatProviderId/);
  assert.match(source, /requestBody\.imageProviderId/);
});

test('chat panel keeps persisted model selections available while provider settings are unavailable', () => {
  assert.match(source, /resolvedChatSelection\.providerId\s*\|\|\s*chatProviderId\s*\|\|\s*undefined/);
  assert.match(source, /resolvedChatSelection\.model\s*\|\|\s*chatModelId\s*\|\|\s*undefined/);
  assert.match(source, /resolvedImageSelection\.providerId\s*\|\|\s*imageProviderId\s*\|\|\s*undefined/);
  assert.match(source, /resolvedImageSelection\.model\s*\|\|\s*imageModelId\s*\|\|\s*undefined/);
});

test('brand bootstrap logo generation follows the selected image provider and model', () => {
  assert.match(source, /const logoResponse = await fetch\('\/api\/generate'[\s\S]{0,420}imageProviderId:\s*selectedImageProviderId/);
  assert.match(source, /const logoResponse = await fetch\('\/api\/generate'[\s\S]{0,460}model:\s*selectedImageModelId/);
  assert.match(source, /const bootstrapMessageId[\s\S]{0,420}model:\s*selectedImageModelId/);
});

test('provider selection stays open until a model is chosen', () => {
  assert.match(source, /onClick=\{\(\) => setDraftProviderId\(provider\.id\)\}/);
  assert.doesNotMatch(source, /onClick=\{\(\) => onSelect\(provider\.id, provider\[modelsKey\]\[0\]\)\}/);
  assert.match(source, /onClick=\{\(\) => activeProvider && onSelect\(activeProvider\.id, modelId\)\}/);
});

test('chat panel model selections participate in project snapshots and hydration', () => {
  assert.match(source, /chatProviderId:\s*liveState\.chatProviderId/);
  assert.match(source, /chatModelId:\s*liveState\.chatModelId/);
  assert.match(source, /imageProviderId:\s*liveState\.imageProviderId/);
  assert.match(source, /imageModelId:\s*liveState\.imageModelId/);
  assert.match(source, /resolvedState\.normalizedSession\?\.chatProviderId/);
  assert.match(source, /resolvedState\.normalizedSession\?\.imageProviderId/);
});

test('chat panel model selectors expose provider-load failure recovery', () => {
  assert.match(source, /供应商加载失败/);
  assert.match(source, /重新加载/);
  assert.match(source, /onRetry=/);
  assert.match(source, /loadProviderSettings/);
});

test('switching generation mode closes both model selector popovers', () => {
  assert.match(source, /setGenerationMode\(option\.id\)[\s\S]{0,240}setShowChatModelSelector\(false\)/);
  assert.match(source, /setGenerationMode\(option\.id\)[\s\S]{0,300}setShowImageModelSelector\(false\)/);
});
