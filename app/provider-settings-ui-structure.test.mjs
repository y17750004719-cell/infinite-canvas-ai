import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pageSource = fs.readFileSync(path.join(__dirname, 'page.tsx'), 'utf8');
const motionControllerSource = fs.readFileSync(
  path.join(__dirname, 'components/GsapMotionController.tsx'),
  'utf8'
);
const globalStylesSource = fs.readFileSync(path.join(__dirname, 'globals.css'), 'utf8');

test('page adds a dedicated left rail settings item and isolated modal gate for provider settings', () => {
  assert.equal(pageSource.includes("{ id: 'settings', label: '设置', icon: Settings }"), true);
  assert.equal(pageSource.includes('const ProviderSettingsModalGate = memo(React.forwardRef<'), true);
  assert.equal(
    pageSource.includes('const providerSettingsModalGateRef = useRef<ProviderSettingsModalGateHandle | null>(null);'),
    true
  );
  assert.equal(pageSource.includes('const openProviderSettingsModal = useCallback(() => {'), true);
});

test('page routes both left rail settings and top bar settings to the same provider settings modal', () => {
  assert.equal(pageSource.includes("if (itemId === 'settings') {"), true);
  assert.equal(pageSource.includes('openProviderSettingsModal();'), true);
  assert.equal(pageSource.includes('title="设置"'), true);
  assert.equal(pageSource.includes('onClick={openProviderSettingsModal}'), true);
  assert.equal(
    pageSource.includes("data-provider-settings-trigger={item.id === 'settings' ? 'true' : undefined}"),
    true
  );
});

test('provider settings opens without changing root modal state or refetching loaded settings', () => {
  const openStart = pageSource.indexOf('const openProviderSettingsModal = useCallback(() => {');
  const openEnd = pageSource.indexOf('\n  }, []);', openStart);
  const openSource = pageSource.slice(openStart, openEnd);

  assert.equal(openSource.includes('providerSettingsModalGateRef.current?.open();'), true);
  assert.equal(openSource.includes('setShowProviderSettingsModal'), false);
  assert.equal(openSource.includes('loadProviderSettings'), false);
  assert.equal(pageSource.includes('<ProviderSettingsModalGate'), true);
  assert.equal(pageSource.includes('setShowProviderSettingsModal'), false);
  assert.equal(pageSource.includes('window.requestIdleCallback(prepare, { timeout: 2000 })'), true);
  assert.equal(pageSource.includes('const cachedContentRef = useRef<React.ReactNode>(null);'), true);
  assert.equal(pageSource.includes("const cachedRenderRevisionRef = useRef('');"), true);
  assert.equal(pageSource.includes('const providerSettingsModalOpenRef = useRef(false);'), true);
  assert.equal(pageSource.includes('openRef={providerSettingsModalOpenRef}'), true);
  assert.match(pageSource, /cachedContentRef\.current === null\s*\|\| openRef\.current/);
  assert.equal(pageSource.includes('cachedRenderRevisionRef.current !== renderRevision'), true);
  assert.match(
    pageSource,
    /\}\), \(previous, next\) => \(\s*!next\.openRef\.current\s*&& previous\.renderRevision === next\.renderRevision/
  );
  assert.equal(pageSource.includes('const providerSettingsRenderRevision = ['), true);
  assert.equal(pageSource.includes('providerSettingsSaving,'), true);
  assert.equal(pageSource.includes('providerSettingsTesting,'), true);
  assert.equal(pageSource.includes('providerSettingsFetchingModels,'), true);
  assert.equal(pageSource.includes('renderRevision={providerSettingsRenderRevision}'), true);
  assert.equal(pageSource.includes('data-provider-settings-modal="true"'), true);
  assert.equal(pageSource.includes("classList.toggle('is-open', open)"), true);
  assert.equal(pageSource.includes("modal.toggleAttribute('inert', true)"), true);
  assert.equal(pageSource.includes("modal.setAttribute('aria-hidden', 'true')"), true);
  assert.equal(pageSource.includes("modal.removeAttribute('inert')"), true);
  assert.equal(pageSource.includes("modal.setAttribute('aria-hidden', 'false')"), true);
  const visualToggleIndex = pageSource.indexOf("openingShell?.classList.toggle('is-open', open)");
  const accessibilityFrameIndex = pageSource.indexOf('accessibilityFrameRef.current = requestAnimationFrame(', visualToggleIndex);
  const accessibilityTimerIndex = pageSource.indexOf('accessibilityTimerRef.current = setTimeout(', accessibilityFrameIndex);
  assert.equal(visualToggleIndex < accessibilityFrameIndex, true);
  assert.equal(accessibilityFrameIndex < accessibilityTimerIndex, true);
  assert.equal(pageSource.includes('data-provider-settings-opening-shell="true"'), true);
  assert.equal(pageSource.includes("modal.classList.add('is-open')"), true);
  assert.equal(pageSource.includes("console.info('[provider-settings-perf]', JSON.stringify({"), true);
  assert.equal(pageSource.includes('data-gsap-motion-exclude="true"'), true);
  assert.equal(motionControllerSource.includes('[data-gsap-motion-exclude="true"]'), true);
  assert.match(
    globalStylesSource,
    /\[data-provider-settings-modal="true"\] \{[\s\S]{0,240}clip-path: inset\(50%\);[\s\S]{0,240}pointer-events: auto;/
  );
  assert.match(
    globalStylesSource,
    /\[data-provider-settings-modal="true"\]\.is-open \{[\s\S]{0,120}clip-path: inset\(0\);/
  );
  assert.doesNotMatch(
    globalStylesSource,
    /\[data-provider-settings-modal="true"\]\.is-open \{[^}]*pointer-events:/
  );
  assert.equal(pageSource.includes('document.documentElement.dataset.providerSettingsOpen'), false);
});

test('provider settings modal loads and saves provider registry through the settings api', () => {
  assert.equal(pageSource.includes("fetch('/api/settings/providers'"), true);
  assert.equal(pageSource.includes('const providerSettingsLoadRequestIdRef = useRef(0);'), true);
  assert.equal(pageSource.includes("fetch('/api/settings/providers/test-connection'"), true);
  assert.equal(pageSource.includes('供应商配置'), true);
  assert.equal(pageSource.includes('Providers'), true);
  assert.equal(pageSource.includes('Base URL'), true);
  assert.equal(pageSource.includes('协议'), true);
  assert.equal(pageSource.includes('图片请求模式'), true);
  assert.equal(pageSource.includes('文生图端点'), true);
  assert.equal(pageSource.includes('图生图/编辑端点'), true);
  assert.equal(pageSource.includes('图片模型'), true);
  assert.equal(pageSource.includes('聊天模型'), true);
  assert.equal(pageSource.includes('拉取模型'), true);
  assert.equal(pageSource.includes('模型选择'), true);
  assert.equal(pageSource.includes('应用选择'), true);
  assert.equal(pageSource.includes('API Key'), true);
  assert.equal(pageSource.includes('测试连接'), true);
  assert.equal(pageSource.includes('name="primary-provider"'), true);
  assert.equal(pageSource.includes('checked={provider.primary}'), true);
  assert.equal(pageSource.includes('disabled={provider.enabled === false}'), true);
  assert.equal(pageSource.includes('连接成功'), true);
  assert.equal(pageSource.includes('连接失败'), true);
  assert.equal(pageSource.includes("type=\"text\""), true);
  assert.equal(pageSource.includes("type={isProviderSettingsApiKeyVisible ? 'text' : 'password'}"), false);
  assert.equal(pageSource.includes('显示 API Key'), true);
  assert.equal(pageSource.includes('Comfly'), true);
  assert.equal(pageSource.includes('GPT-Best'), true);
  assert.equal(pageSource.includes('自定义'), true);
});

test('provider settings loading only lets the latest fetch update error and loading state', () => {
  assert.equal(pageSource.includes('const requestId = providerSettingsLoadRequestIdRef.current + 1;'), true);
  assert.equal(pageSource.includes('providerSettingsLoadRequestIdRef.current = requestId;'), true);
  assert.equal(pageSource.includes('if (providerSettingsLoadRequestIdRef.current !== requestId) {'), true);
  assert.equal(pageSource.includes('if (providerSettingsLoadRequestIdRef.current === requestId) {'), true);
  assert.equal(pageSource.includes('setProviderSettingsError(null);'), true);
});

test('provider settings modal keeps api keys in the field with controlled masking and anti autofill names', () => {
  assert.equal(pageSource.includes('maskProviderSettingsApiKeyForDisplay'), true);
  assert.equal(pageSource.includes('providerSettingsApiKeyInputValue'), true);
  assert.equal(pageSource.includes('providerSettingsImageApiKeys'), true);
  assert.equal(pageSource.includes('selectedProviderSettings.apiKey'), true);
  assert.equal(pageSource.includes('imageApiKeys: ProviderSettingsImageApiKey[];'), true);
  assert.equal(pageSource.includes('setProviderSettingsApiKey(nextApiKey)'), true);
  assert.equal(pageSource.includes('setProviderSettingsImageApiKeys'), true);
  assert.equal(pageSource.includes('handleProviderSettingsAddImageApiKey'), true);
  assert.equal(pageSource.includes('handleProviderSettingsRemoveImageApiKey'), true);
  assert.equal(
    pageSource.includes("apiKey: provider.id === providerSettingsSelectedProviderId ? providerSettingsApiKey : provider.apiKey,"),
    true
  );
  assert.equal(
    pageSource.includes('persistProviderSettingsImageApiKeys(providerSettingsImageApiKeys)'),
    true
  );
  assert.equal(pageSource.includes('autoComplete="off"'), true);
  assert.equal(pageSource.includes('autoComplete="new-password"'), true);
  assert.equal(pageSource.includes('name="provider-image-edit-endpoint"'), true);
  assert.equal(pageSource.includes('name="provider-api-secret-input"'), true);
  assert.equal(pageSource.includes('name="provider-image-api-secret-input"'), true);
  assert.equal(pageSource.includes('id="provider-api-secret-input"'), true);
  assert.equal(pageSource.includes('`provider-image-api-secret-input-${imageApiKeyRow.id}`'), true);
  assert.equal(pageSource.includes('value={providerSettingsApiKeyInputValue}'), true);
  assert.equal(pageSource.includes('value={imageApiKeyRow.isVisible ? imageApiKeyRow.apiKey : maskProviderSettingsApiKeyForDisplay(imageApiKeyRow.apiKey)}'), true);
  assert.equal(pageSource.includes('主 API Key'), true);
  assert.equal(pageSource.includes('生图 API Key'), true);
  assert.equal(pageSource.includes('添加生图 API'), true);
  assert.equal(pageSource.includes('删除生图 API'), true);
  assert.equal(pageSource.includes('默认使用主 API Key'), true);
  assert.equal(pageSource.includes('PROVIDER_IMAGE_API_KEY_SCOPE_OPTIONS.map'), true);
  assert.equal(pageSource.includes("{ id: 'gpt', label: 'OpenAI' }"), true);
  assert.equal(pageSource.includes("{ id: 'gpt', label: 'GPT' }"), false);
  assert.equal(pageSource.includes('providerSettingsImageApiKeyInputValue'), false);
  assert.equal(pageSource.includes('selectedProviderSettings.imageApiKey'), false);
});

test('provider settings modal uses categorized fetched model selection instead of textarea-only model editing', () => {
  assert.equal(pageSource.includes("fetch('/api/settings/providers/fetch-models'"), true);
  assert.equal(pageSource.includes('providerSettingsFetchedModels'), true);
  assert.equal(pageSource.includes('providerSettingsModelPickerCategory'), true);
  assert.equal(pageSource.includes('providerSettingsSelectedFetchedModels'), true);
  assert.equal(pageSource.includes('providerSettingsSelectedModelRows'), true);
  assert.equal(pageSource.includes('handleProviderSettingsRemoveModel'), true);
  assert.equal(pageSource.includes('handleProviderSettingsFetchModels'), true);
  assert.equal(pageSource.includes('handleProviderSettingsApplyFetchedModels'), true);
  assert.equal(pageSource.includes("['all', 'image', 'chat']"), true);
  assert.equal(pageSource.includes('全部'), true);
  assert.equal(pageSource.includes('图片'), true);
  assert.equal(pageSource.includes('聊天'), true);
  assert.equal(pageSource.includes('placeholder="搜索模型"'), true);
  assert.equal(pageSource.includes('provider-model-chip'), false);
  assert.equal(pageSource.includes('移除图片模型'), true);
  assert.equal(pageSource.includes('移除聊天模型'), true);
  assert.equal(pageSource.includes('panel-scrollbar h-[86px] overflow-y-auto rounded-[16px] border border-[var(--workspace-border)]'), false);
  assert.equal(pageSource.includes('panel-scrollbar h-[156px] overflow-y-auto rounded-[16px] border border-[var(--workspace-border)]'), true);
  assert.equal(pageSource.includes('providerModelsFromText'), false);
  assert.equal(pageSource.includes('value={providerModelsToText(selectedProviderSettings.imageModels)}'), false);
  assert.equal(pageSource.includes('value={providerModelsToText(selectedProviderSettings.chatModels)}'), false);
});

test('provider settings model rows expose per-model protocol overrides', () => {
  assert.equal(pageSource.includes('modelProtocols: Record<string, ProviderProtocol>;'), true);
  assert.equal(pageSource.includes('modelProtocols: {},'), true);
  assert.equal(pageSource.includes('modelProtocols: provider.modelProtocols,'), true);
  assert.equal(pageSource.includes('handleProviderSettingsModelProtocolChange'), true);
  assert.equal(pageSource.includes("selectedProviderSettings.modelProtocols?.[model.id] || ''"), true);
  assert.equal(pageSource.includes('<option value="">默认</option>'), true);
  assert.equal(pageSource.includes('PROVIDER_PROTOCOL_OPTIONS.map'), true);
  assert.equal(pageSource.includes('modelProtocols: nextModelProtocols,'), true);
});

test('provider settings opens fetched model selection in a centered overlay instead of expanding the card', () => {
  assert.equal(
    pageSource.includes('providerSettingsModelPickerOpen && providerSettingsFetchedModels && selectedProviderSettings && ('),
    true
  );
  assert.equal(
    pageSource.includes('className="absolute inset-0 z-[2]"'),
    true
  );
  assert.equal(
    pageSource.includes('className="absolute inset-0 bg-black/30"'),
    true
  );
  assert.equal(
    pageSource.includes('className="relative z-[1] flex h-full items-center justify-center p-6"'),
    true
  );
  assert.equal(pageSource.includes('className="absolute inset-0 -z-10"'), false);
  assert.equal(pageSource.includes('className="mt-4 flex h-[420px] max-h-[52vh] min-h-[320px] flex-col'), false);
});

test('provider settings keeps the right detail column scrollable while footer actions stay fixed', () => {
  assert.equal(
    pageSource.includes('className="workspace-popover-panel relative z-[1] flex max-h-[min(88vh,760px)] w-full max-w-[920px] flex-col overflow-hidden rounded-[28px]"'),
    true
  );
  assert.equal(
    pageSource.includes('className="flex min-h-0 flex-1 flex-col px-6 py-5"'),
    true
  );
  assert.equal(
    pageSource.includes('className="grid min-h-0 flex-1 gap-5 md:grid-cols-[220px_minmax(0,1fr)]"'),
    true
  );
  assert.equal(
    pageSource.includes('className="panel-scrollbar min-h-0 space-y-4 overflow-y-auto pr-1"'),
    true
  );
  assert.equal(
    pageSource.includes('className="workspace-subtle-divider flex items-center justify-end gap-3 border-t px-6 py-4"'),
    true
  );
});

test('provider settings test connection validates api key locally and uses readable error colors', () => {
  assert.equal(pageSource.includes("if (!selectedProviderSettings.hasApiKey && providerSettingsApiKey.trim().length === 0) {"), true);
  assert.equal(pageSource.includes("setProviderSettingsError('请先填写或保存 API Key');"), true);
  assert.equal(pageSource.includes("message: '连接失败：请先填写或保存 API Key',"), true);
  assert.equal(pageSource.includes('text-red-100'), false);
  assert.equal(pageSource.includes('text-red-700 dark:text-red-300'), true);
  assert.equal(pageSource.includes('text-emerald-700 dark:text-emerald-300'), true);
});

test('provider settings modal uses the new Comfly preset base url', () => {
  assert.equal(pageSource.includes("{ id: 'comfly', name: 'Comfly', baseUrl: 'https://ai.comfly.org/v1', protocol: 'openai', imageRequestMode: 'openai' }"), true);
});

test('provider settings modal uses a provider list instead of the legacy single-provider select', () => {
  assert.equal(pageSource.includes("grid grid-cols-3 gap-2"), false);
  assert.equal(pageSource.includes('providerSettingsProviders.map((provider)'), true);
  assert.equal(pageSource.includes('selectedProviderSettings'), true);
  assert.equal(pageSource.includes('handleProviderSettingsProviderChange(provider.id)'), true);
  assert.equal(pageSource.includes('<select'), true);
  assert.equal(pageSource.includes('PROVIDER_PROTOCOL_OPTIONS.map'), true);
  assert.equal(pageSource.includes('PROVIDER_IMAGE_REQUEST_MODE_OPTIONS.map'), true);
  assert.equal(pageSource.includes('handleProviderSettingsProviderChange(e.target.value as ProviderSettingsProviderId)'), false);
});

test('canvas defaults reuse the resolved session provider and model selections', () => {
  assert.equal(
    pageSource.includes("findWorkspaceModelOption(\n      workspaceImageModelOptions,\n      resolvedImageSelection.model || '',"),
    true
  );
  assert.equal(
    pageSource.includes("findWorkspaceModelOption(\n      workspaceTextModelOptions,\n      resolvedChatSelection.model || '',"),
    true
  );
  assert.match(
    pageSource,
    /selectableTextProviders\.find[\s\S]{0,180}defaultWorkspaceTextModelOption\.providerId/
  );
  assert.match(
    pageSource,
    /selectableImageProviders\.find[\s\S]{0,180}defaultWorkspaceImageModelOption\.providerId/
  );
});
