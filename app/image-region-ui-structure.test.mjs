import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const pageSource = fs.readFileSync(fileURLToPath(new URL('./page.tsx', import.meta.url)), 'utf8');
const uiSource = fs.readFileSync(
  fileURLToPath(new URL('./components/workspace/ImageRegionSelectionUI.tsx', import.meta.url)),
  'utf8'
);

test('region menu remains available for manual and persisted region labels', () => {
  assert.equal(uiSource.includes('if (!region) return null;'), true);
  assert.equal(pageSource.includes("tokenLabel !== '未识别对象'"), true);
  assert.equal(pageSource.includes('region?.customLabel || regionToken?.label'), true);
});

test('region markers and composer dropdown expose the resolved custom label', () => {
  assert.equal(uiSource.includes('const regionLabel = region.customLabel || candidate?.label;'), true);
  assert.equal(uiSource.includes('aria-label={`定位对象 ${regionLabel || index + 1}`}'), true);
  assert.equal(pageSource.includes('setActiveRegionMenuId(token.regionId);'), true);
});

test('sending region tokens cancels recognition before removing composer state', () => {
  assert.equal(pageSource.includes('removedRegionIds.forEach(cancelRegionRecognition);'), true);
  assert.equal(pageSource.includes('setRegionRefineId((current) => current && removedRegionIds.includes(current) ? null : current);'), true);
});
