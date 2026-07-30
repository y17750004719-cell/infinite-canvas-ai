import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const hookPath = fileURLToPath(new URL('./hooks/useImageRegionSelectionController.ts', import.meta.url));
const source = fs.readFileSync(hookPath, 'utf8');

test('region recognition controller cancels superseded requests and rejects stale revisions', () => {
  assert.equal(source.includes('controllersRef.current.get(regionId)?.abort()'), true);
  assert.equal(source.includes('revisionsRef.current.get(region.id) === revision'), true);
  assert.equal(source.includes('signal: controller.signal'), true);
  assert.equal(source.includes("fetch('/api/generate'"), true);
  assert.equal(source.includes("intent: 'chat'"), true);
  assert.equal(source.includes('stream: false'), true);
  assert.equal(source.includes('chatProviderId: recognitionProviderId'), true);
  assert.equal(source.includes('model: recognitionModel'), true);
  assert.equal(source.includes("referenceLabels = ['original-image']"), true);
  assert.equal(source.includes("referenceLabels.push('marked-location')"), true);
  assert.equal(source.includes("referenceLabels.push('clean-region-crop')"), true);
  assert.equal(source.includes("fetch('/api/image-tools/locate'"), false);
});

test('region recognition controller preserves manual fallback state on non-abort failures', () => {
  assert.equal(source.includes("status: 'failed'"), true);
  assert.equal(source.includes('onFailed(region.id, evidence)'), true);
  assert.equal(source.includes("error.name === 'AbortError'"), true);
  assert.equal(source.includes('请先选择支持图片理解的对话模型'), true);
  assert.equal(source.includes('当前对话模型不支持图片理解，请切换模型'), true);
});
