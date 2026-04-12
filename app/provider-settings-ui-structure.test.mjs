import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pageSource = fs.readFileSync(path.join(__dirname, 'page.tsx'), 'utf8');

test('page adds a dedicated left rail settings item and modal state for provider settings', () => {
  assert.equal(pageSource.includes("{ id: 'settings', label: '设置', icon: Settings }"), true);
  assert.equal(
    pageSource.includes("const [showProviderSettingsModal, setShowProviderSettingsModal] = useState(false);"),
    true
  );
  assert.equal(pageSource.includes('const openProviderSettingsModal = useCallback(() => {'), true);
});

test('page routes both left rail settings and top bar settings to the same provider settings modal', () => {
  assert.equal(pageSource.includes("if (itemId === 'settings') {"), true);
  assert.equal(pageSource.includes('openProviderSettingsModal();'), true);
  assert.equal(pageSource.includes('title="设置"'), true);
  assert.equal(pageSource.includes('onClick={openProviderSettingsModal}'), true);
});

test('provider settings modal loads and saves runtime config through the settings api', () => {
  assert.equal(pageSource.includes("fetch('/api/settings/provider'"), true);
  assert.equal(pageSource.includes('供应商配置'), true);
  assert.equal(pageSource.includes('当前供应商'), true);
  assert.equal(pageSource.includes('切换供应商'), true);
  assert.equal(pageSource.includes('Base URL'), true);
  assert.equal(pageSource.includes('API Key'), true);
  assert.equal(pageSource.includes("type={isProviderSettingsApiKeyVisible ? 'text' : 'password'}"), true);
  assert.equal(pageSource.includes('显示 API Key'), true);
  assert.equal(pageSource.includes('Comfly'), true);
  assert.equal(pageSource.includes('GPT-Best'), true);
  assert.equal(pageSource.includes('自定义'), true);
});

test('provider settings modal replaces the preset cards with a summary card and select control', () => {
  assert.equal(pageSource.includes("grid grid-cols-3 gap-2"), false);
  assert.equal(pageSource.includes('getProviderSettingsProviderLabel(providerSettingsCurrentProviderId)'), true);
  assert.equal(pageSource.includes('<select'), true);
  assert.equal(pageSource.includes('handleProviderSettingsProviderChange(e.target.value as ProviderSettingsProviderId)'), true);
});
