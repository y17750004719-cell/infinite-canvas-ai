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

test('region markers share the image transform and imperative drag target', () => {
  assert.match(uiSource, /ref=\{getItemTargetRef\(item\.id, `region-\$\{region\.id\}`\)\}/);
  assert.match(uiSource, /left: item\.x/);
  assert.match(uiSource, /top: item\.y/);
  assert.match(uiSource, /transform: `rotate\(\$\{item\.rotation\}deg\)`/);
  assert.match(pageSource, /role\.startsWith\('region-'\)/);
  assert.match(pageSource, /const dragTargets = getItemTargets\(itemIds, itemIds\.length > 1\)\.filter\(isCanvasItemDragTarget\)/);
  assert.doesNotMatch(pageSource, /cachedPlan\?\.targets/);
  assert.match(pageSource, /if \(finalPosition && target\.role\.startsWith\('region-'\)\) \{/);
  assert.match(pageSource, /target\.element\.style\.left = `\$\{finalPosition\.x\}px`/);
  assert.match(pageSource, /target\.element\.style\.top = `\$\{finalPosition\.y\}px`/);
});

test('region candidates stay pending until an explicit accessible confirmation', () => {
  assert.match(uiSource, /onClick=\{\(\) => onSelectCandidate\(region\.id, candidate\.id\)\}/);
  assert.match(uiSource, /region\.confirmationStatus === 'confirmed'/);
  assert.match(uiSource, /data-candidate-state=\{isConfirmed \? 'confirmed' : isSelected \? 'selected' : 'idle'\}/);
  assert.match(uiSource, /aria-label=\{`\$\{candidate\.label\}，置信度/);
  assert.doesNotMatch(uiSource, /role="listbox"/);
  assert.doesNotMatch(uiSource, /role="option"/);
});

test('region candidates expose descriptions, localized confidence, and recommendation state', () => {
  assert.match(uiSource, /high: '高'/);
  assert.match(uiSource, /medium: '中'/);
  assert.match(uiSource, /low: '低'/);
  assert.match(uiSource, /candidate\.description \|\| '暂无补充说明'/);
  assert.match(uiSource, /index === 0 && <span[^>]*>推荐<\/span>/);
});

test('custom labels require non-empty confirmation and recognition states have clear copy', () => {
  assert.match(uiSource, /const customLabel = customLabelDraft\.trim\(\);/);
  assert.match(uiSource, /disabled=\{!customLabel\}/);
  assert.match(uiSource, /正在识别对象…/);
  assert.match(uiSource, /识别失败，请选择候选或输入名称/);
  assert.match(pageSource, /label: '识别失败'/);
  assert.match(pageSource, /setRegionCustomLabelDraft\(''\)/);
});

test('sending clears region tokens while preserving reusable canvas markers', () => {
  assert.match(pageSource, /tokens\.filter\(\(token\) => !token\.regionId && token\.pinned\)/);
  assert.doesNotMatch(pageSource, /removedRegionIds\.forEach\(cancelRegionRecognition\)/);
  assert.match(pageSource, /buildRegionReferenceToken\(region, regionEvidenceByIdRef\.current\.get\(regionId\)\)/);
});

test('new regions insert a pending token before asynchronous recognition starts', () => {
  const tokenIndex = pageSource.indexOf('const token = buildRegionReferenceToken(region);');
  const recognitionIndex = pageSource.indexOf('void startRegionRecognition(region);', tokenIndex);
  assert.ok(tokenIndex >= 0 && recognitionIndex > tokenIndex);
  assert.match(pageSource, /confirmationStatus: 'pending'/);
  assert.match(pageSource, /badge\.textContent = '待确认'/);
});

test('unconfirmed regions block send and confirmed regions attach crop evidence', () => {
  assert.match(pageSource, /token\.role === 'region_target' && token\.confirmationStatus !== 'confirmed'/);
  assert.match(pageSource, /setActiveRegionMenuId\(unresolvedRegionToken\.regionId\)/);
  assert.match(pageSource, /kind: 'region_crop' as const/);
  assert.match(pageSource, /token\.previewSrc && token\.previewSrc !== token\.src/);
});

test('removing a region token does not delete its persistent marker', () => {
  const removeStart = pageSource.indexOf('const removeChatReferenceToken =');
  const pinStart = pageSource.indexOf('const toggleChatReferenceTokenPin =', removeStart);
  const removeSource = pageSource.slice(removeStart, pinStart);
  assert.doesNotMatch(removeSource, /setRegionSelections/);
  assert.doesNotMatch(removeSource, /cancelRegionRecognition/);
});

test('recognition and lazy crops never resurrect removed or stale region tokens', () => {
  assert.match(pageSource, /previous\.some\(\(candidate\) => \(\s*candidate\.regionId === previousRegionId \|\| candidate\.regionId === nextRegion\.id/);
  assert.match(pageSource, /if \(hasToken\) setActiveRegionMenuId\(nextRegion\.id\)/);
  assert.match(pageSource, /if \(hasToken\) setActiveRegionMenuId\(regionId\)/);
  assert.match(pageSource, /const requestedGeometry = JSON\.stringify/);
  assert.match(pageSource, /const currentRegion = regionSelectionsRef\.current\.find/);
  assert.match(pageSource, /buildRegionReferenceToken\(currentRegion, evidence\)/);
});

test('inline insertion anchor distinguishes positions around adjacent reference tokens', () => {
  assert.match(pageSource, /chatEditorCaretAnchorRef = useRef\(\{ textOffset: 0, referenceCount: 0 \}\)/);
  assert.match(pageSource, /referenceCount: prefixSegments\.filter\(\(segment\) => segment\.type === 'reference'\)\.length/);
  assert.match(pageSource, /consumedText === offset && consumedReferences === referenceCount/);
});
