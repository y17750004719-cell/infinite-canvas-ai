import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const source = fs.readFileSync(path.resolve(import.meta.dirname, '../../page.tsx'), 'utf8');
const skillsIconPath = path.resolve(import.meta.dirname, '../../../public/icons/lovart-skills.svg');

function controlIndex(id) {
  return source.indexOf(`data-chat-composer-control="${id}"`);
}

test('right chat defaults to agent and loads skills from the registry api', () => {
  assert.match(source, /type GenerationMode = 'agent' \| 'image' \| 'chat'/);
  assert.match(source, /PROMPT_PIPELINE_AGENT_ENABLED \? 'agent' : 'chat'/);
  assert.match(source, /fetch\('\/api\/skills'/);
});

test('agent mode posts to the agent route and handles agent events', () => {
  assert.match(source, /generationMode === 'agent' \? '\/api\/agent' : '\/api\/generate'/);
  assert.match(source, /routing_start/);
  assert.match(source, /clarification_required/);
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

test('chat composer uses the taller reference layout and ordered single-row controls', () => {
  assert.match(source, /workspace-chat-input[^\n]*min-h-\[148px\]/);
  assert.match(source, /minHeight:\s*'72px'/);
  const orderedControls = ['more', 'skills', 'mode', 'reasoning', 'models', 'send'];
  const indexes = orderedControls.map(controlIndex);
  assert.ok(indexes.every((index) => index >= 0));
  assert.deepEqual([...indexes].sort((a, b) => a - b), indexes);
});

test('chat composer uses the supplied Lovart skills icon as a theme-aware mask', () => {
  assert.equal(fs.existsSync(skillsIconPath), true);
  assert.match(source, /lovart-skills\.svg/);
  assert.match(source, /maskImage/);
});

test('chat composer more menu exposes uploads, history selection, and disabled search', () => {
  assert.match(source, /上传文件/);
  assert.match(source, /从素材库选取/);
  assert.match(source, /联网搜索/);
  assert.match(source, /即将支持/);
  assert.match(source, /showChatAssetPicker/);
  assert.match(source, /selectedChatHistoryAssetIds/);
});

test('chat composer exposes disabled reasoning and one adaptive model preference popover', () => {
  assert.match(source, /aria-label="深度思考 · 即将支持"/);
  assert.match(source, /data-chat-composer-control="reasoning"[\s\S]{0,240}disabled/);
  assert.match(source, /aria-label="模型偏好"/);
  assert.match(source, /showModelPreferencePopover/);
  assert.match(source, /generationMode === 'agent' \|\| generationMode === 'chat'/);
  assert.match(source, /generationMode === 'agent' \|\| generationMode === 'image'/);
  assert.match(source, /ASPECT_RATIOS\.map/);
  assert.doesNotMatch(source, /aria-label="聊天框供应商与模型"/);
});

test('chat composer closes transient menus when a generation starts', () => {
  assert.match(
    source,
    /useEffect\(\(\) => \{\s*if \(!isGenerating\) return;\s*closeChatComposerPopovers\(\);\s*setSelectedChatHistoryAssetIds\(\[\]\);\s*\}, \[closeChatComposerPopovers, isGenerating\]\)/
  );
});

test('chat image uploads revalidate generation state and the shared reference limit after async reads', () => {
  assert.match(source, /const isGeneratingRef = useRef\(false\)/);
  assert.match(source, /if \(isGeneratingRef\.current\) return;/);
  assert.match(
    source,
    /setChatReferenceImages\(\(currentReferences\) =>\s*mergeGeneratedHistoryReferences\(currentReferences, uploadedImages, 14\)\s*\)/
  );
});

test('composer dialogs expose semantics, unique asset labels, and focus restoration', () => {
  assert.match(source, /role="dialog"/);
  assert.match(source, /aria-modal="false"/);
  assert.match(source, /tabIndex=\{-1\}/);
  assert.match(source, /aria-label=\{`选择历史生成素材 \$\{index \+ 1\}`\}/);
  assert.match(source, /chatAssetPickerRef\.current\?\.focus\(\)/);
  assert.match(source, /modelPreferencePopoverRef\.current\?\.focus\(\)/);
  assert.match(source, /chatComposerMoreButtonRef\.current\?\.focus\(\)/);
  assert.match(source, /modelPreferenceButtonRef\.current\?\.focus\(\)/);
});

test('chat composer keeps utility icons borderless and hides the Skills label', () => {
  assert.doesNotMatch(source, /<span>Skills<\/span>/);
  for (const control of ['more', 'skills', 'mode', 'reasoning', 'models']) {
    const start = controlIndex(control);
    assert.ok(start >= 0, `missing ${control} composer control`);
    assert.match(source.slice(start, start + 10_000), /workspace-chat-icon-control/);
  }
  assert.match(
    source,
    /data-chat-composer-control="mode"[\s\S]{0,700}className=\{`workspace-chat-icon-control/
  );

  const styles = fs.readFileSync(path.resolve(import.meta.dirname, '../../globals.css'), 'utf8');
  assert.match(styles, /\.workspace-chat-icon-control\s*\{[\s\S]*?border:\s*0;/);
  assert.match(styles, /\.workspace-chat-icon-control:hover:not\(:disabled\)[\s\S]*?background:\s*var\(--workspace-control-hover\)/);
});
