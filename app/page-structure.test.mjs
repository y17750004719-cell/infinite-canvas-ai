import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pageSource = fs.readFileSync(path.join(__dirname, 'page.tsx'), 'utf8');

test('image card floating menus are not rendered inside the pending connection menu block', () => {
  const pendingMenuStart = pageSource.indexOf('{pendingConnectionMenu && (');
  const pendingMenuEnd = pageSource.indexOf('{portaledSelectedTextCardPanel}');

  assert.notEqual(pendingMenuStart, -1);
  assert.notEqual(pendingMenuEnd, -1);
  assert.ok(pendingMenuEnd > pendingMenuStart);

  const pendingMenuBlock = pageSource.slice(pendingMenuStart, pendingMenuEnd);

  assert.equal(
    pendingMenuBlock.includes('{showImageCardQualityMenu && selectedImageCardQualityPopoverOffset && ('),
    false
  );
  assert.equal(
    pendingMenuBlock.includes('{showImageCardCountMenu && selectedImageCardCountPopoverOffset && ('),
    false
  );
});

test('image card content images fill the card content area with object-cover', () => {
  const imageCardContentStart = pageSource.indexOf("{imageCardVisualState === 'content' && item.src && (");
  const imageCardContentEnd = pageSource.indexOf('{item.type === \'shape\' &&', imageCardContentStart);

  assert.notEqual(imageCardContentStart, -1);
  assert.notEqual(imageCardContentEnd, -1);
  assert.ok(imageCardContentEnd > imageCardContentStart);

  const imageCardContentBlock = pageSource.slice(imageCardContentStart, imageCardContentEnd);

  assert.equal(imageCardContentBlock.includes('object-cover'), true);
  assert.equal(imageCardContentBlock.includes('object-contain'), false);
});

test('left rail history uses a dedicated generated image history panel state', () => {
  assert.equal(
    pageSource.includes('const [showGeneratedImageHistoryPanel, setShowGeneratedImageHistoryPanel] = useState(false);'),
    true
  );
  assert.equal(pageSource.includes("if (item.id === 'history') {"), true);
  assert.equal(pageSource.includes('setShowGeneratedImageHistoryPanel((prev) => !prev);'), true);
  assert.equal(pageSource.includes('{showGeneratedImageHistoryPanel && ('), true);
});

test('left rail generated image history panel uses a wider layout than the original 320px menu', () => {
  assert.equal(pageSource.includes('w-[320px]'), false);
  assert.equal(pageSource.includes('w-[384px]'), true);
  assert.equal(pageSource.includes('className="min-w-0 flex-1"'), true);
});

test('generated image history merges persisted sessions with live session history and archive backfill entries', () => {
  assert.equal(pageSource.includes('const currentSessionHistorySnapshot = React.useMemo('), true);
  assert.equal(pageSource.includes('buildCurrentSessionSnapshot(currentSession)'), true);
  assert.equal(pageSource.includes('const [generatedImageHistoryBySession, setGeneratedImageHistoryBySession] = useState<Record<string, GeneratedImageHistoryEntry[]>>({});'), true);
  assert.equal(pageSource.includes('const [archiveGeneratedImageHistoryEntries, setArchiveGeneratedImageHistoryEntries] = useState<GeneratedImageHistoryEntry[]>([]);'), true);
  assert.equal(pageSource.includes('const sessionsWithGeneratedImageHistory = React.useMemo('), true);
  assert.equal(pageSource.includes("fetch('/api/generated-images/history'"), true);
  assert.equal(
    pageSource.includes('() => getGeneratedImageHistoryEntries({'),
    true
  );
  assert.equal(pageSource.includes('sessions: sessionsWithGeneratedImageHistory,'), true);
  assert.equal(pageSource.includes('archiveEntries: archiveGeneratedImageHistoryEntries,'), true);
});

test('image generation materializes the current image-card outputs into history before clearing the card outputs', () => {
  assert.equal(pageSource.includes('buildGeneratedHistoryEntriesFromImageCard({'), true);
  assert.equal(pageSource.includes('appendMissingGeneratedHistoryEntries('), true);
  assert.equal(pageSource.includes('const existingImageCardHistoryEntries = buildGeneratedHistoryEntriesFromImageCard({'), true);
});

test('image nodes expose a shared toolbar target and render an above-node image toolbar overlay', () => {
  assert.equal(pageSource.includes('const selectedImageToolbarTarget = React.useMemo<'), true);
  assert.equal(pageSource.includes('getSelectedImageToolbarSource({'), true);
  assert.equal(pageSource.includes("typeof document !== 'undefined' &&"), true);
  assert.equal(pageSource.includes('data-image-node-toolbar="true"'), true);
  assert.equal(pageSource.includes('抠图'), true);
});

test('image toolbar actions keep cutout enabled while leaving other actions disabled in the first version', () => {
  assert.equal(pageSource.includes('const IMAGE_NODE_TOOLBAR_ACTIONS = ['), true);
  assert.equal(pageSource.includes("id: 'cutout'"), true);
  assert.equal(pageSource.includes('enabled: true'), true);
  assert.equal(pageSource.includes('enabled: false'), true);
});

test('image toolbar cutout uses the dedicated remove-background route instead of the placeholder notice', () => {
  assert.equal(pageSource.includes("/api/image-tools/remove-background"), true);
  assert.equal(pageSource.includes('抠图能力下一步接入'), false);
});

test('image toolbar positioning no longer clamps against canvas width and uses a fixed floating overlay', () => {
  assert.equal(pageSource.includes('imageToolbarApproxWidth'), false);
  assert.equal(pageSource.includes('canvasSize.width - imageToolbarSidePadding'), false);
  assert.equal(pageSource.includes('className="pointer-events-none fixed inset-0 z-[114]"'), true);
});

test('image toolbar keeps its natural width and does not clamp back into the viewport shell', () => {
  assert.equal(pageSource.includes('max-w-[calc(100vw-40px)]'), false);
  assert.equal(pageSource.includes('clampFloatingToolbarToViewport({'), false);
  assert.equal(pageSource.includes('Math.max(selectedImageToolbarAnchor.y, 84)'), false);
  assert.equal(pageSource.includes('<span className="whitespace-nowrap">{action.label}</span>'), true);
});

test('image toolbar and selected card panels render through a portal so they are not clipped by the canvas container', () => {
  assert.equal(pageSource.includes("import { createPortal } from 'react-dom';"), true);
  assert.equal(pageSource.includes('createPortal('), true);
  assert.equal(pageSource.includes('document.body'), true);
  assert.equal(pageSource.includes('className="pointer-events-none fixed inset-0 z-[115]"'), true);
});

test('image card floating panel positioning no longer clamps against canvasSize bounds', () => {
  assert.equal(pageSource.includes('canvasSize.width - selectedImageCardPanelDisplayedWidth - selectedTextCardPanelPadding'), false);
  assert.equal(pageSource.includes('canvasSize.height - selectedImageCardPanelDisplayedHeight - selectedTextCardPanelPadding'), false);
  assert.equal(pageSource.includes('selectedImageCardPanelViewportLeft = (canvasRect?.left ?? 0) + selectedImageCardPanelLeft;'), false);
  assert.equal(pageSource.includes('selectedImageCardPanelViewportTop = (canvasRect?.top ?? 0) + selectedImageCardPanelTop;'), false);
  assert.equal(pageSource.includes('clampFloatingPanelToViewport({'), false);
});

test('text card floating panel renders through a portal instead of the legacy in-canvas branch', () => {
  assert.equal(pageSource.includes('const selectedTextCardPanelViewportOrigin ='), true);
  assert.equal(pageSource.includes('const portaledSelectedTextCardPanel ='), true);
  assert.equal(pageSource.includes('{portaledSelectedTextCardPanel}'), true);
  assert.equal(pageSource.includes('{selectedTextCardPanelItem && selectedTextCardPanelFrameBounds && selectedTextCardPanelCanvasRect && ('), false);
  assert.equal(pageSource.includes('left: selectedTextCardPanelLeft,'), false);
  assert.equal(pageSource.includes('top: selectedTextCardPanelTop,'), false);
  assert.equal(pageSource.includes('canvasSize.width - selectedTextCardPanelDisplayedWidth - selectedTextCardPanelPadding'), false);
  assert.equal(pageSource.includes('canvasSize.height - selectedTextCardPanelDisplayedHeight - selectedTextCardPanelPadding'), false);
});

test('canvas viewport no longer keeps a legacy in-canvas image card floating panel branch', () => {
  assert.equal(pageSource.includes('{false && selectedImageCardPanelItem && selectedImageCardPanelFrameBounds && selectedImageCardPanelCanvasRect && ('), false);
  assert.equal(pageSource.includes('left: selectedImageCardPanelLeft + selectedImageCardQualityPopoverOffset.left * viewport.scale,'), false);
  assert.equal(pageSource.includes('left: selectedImageCardPanelLeft + selectedImageCardCountPopoverOffset.left * viewport.scale,'), false);
});

test('image card generation always uses async task requests instead of keeping a single-image sync branch', () => {
  assert.equal(pageSource.includes('if (count <= 1) {'), false);
  assert.equal(pageSource.includes('buildCanvasImageGenerationRequest({'), false);
  assert.equal(pageSource.includes('const asyncRequests = buildAsyncImageTaskRequests({'), true);
  assert.equal(pageSource.includes('Promise.allSettled('), true);
});

test('image card generation validates actual output resolution before appending image outputs', () => {
  const generateStart = pageSource.indexOf('const handleCanvasImageGenerate = useCallback(');
  const generateEnd = pageSource.indexOf('const handleCancelCanvasImageGenerate = useCallback(', generateStart);

  assert.notEqual(generateStart, -1);
  assert.notEqual(generateEnd, -1);
  assert.ok(generateEnd > generateStart);

  const generateBlock = pageSource.slice(generateStart, generateEnd);

  assert.equal(generateBlock.includes('isOutputResolutionSufficient({'), true);
  assert.equal(generateBlock.includes('getResolutionFailureReason({'), true);
  assert.equal(generateBlock.includes('appendImageCardOutput({'), true);
  assert.ok(
    generateBlock.indexOf('isOutputResolutionSufficient({') < generateBlock.indexOf('appendImageCardOutput({')
  );
});

test('image card generation surfaces partial success when undersized results are discarded', () => {
  assert.equal(
    pageSource.includes('未达标结果已丢弃'),
    true
  );
  assert.equal(
    pageSource.includes('请求 ${asyncRequests.length} 张，成功 ${completedCount} 张，未达标结果已丢弃'),
    true
  );
});

test('image card panel shows a validation hint when references exist without any text prompt', () => {
  assert.equal(pageSource.includes('参考图生成需要输入文字描述'), true);
  assert.equal(pageSource.includes('selectedImageCardPanelValidationError'), true);
});

test('node selection flows move selected canvas items to the front of the persisted item order', () => {
  assert.equal(pageSource.includes('moveCanvasItemsToFront('), true);
  assert.equal(pageSource.includes('setItems((prev) => moveCanvasItemsToFront(prev, itemIds));'), true);
  assert.equal(pageSource.includes('setItems((prev) => moveCanvasItemsToFront(prev, [itemId]));'), true);
  assert.equal(pageSource.includes('setItems((prev) => moveCanvasItemsToFront(prev, next));'), true);
  assert.equal(pageSource.includes('setItems((prev) => moveCanvasItemsToFront(prev, hitIds));'), true);
});

test('right chat panel renders through a page-level portal above canvas overlays', () => {
  assert.equal(pageSource.includes('const CANVAS_OVERLAY_Z = '), true);
  assert.equal(pageSource.includes('const CHAT_PANEL_Z = '), true);
  assert.equal(pageSource.includes('const GLOBAL_NOTICE_Z = '), true);
  assert.equal(pageSource.includes('createPortal('), true);
  assert.equal(pageSource.includes('document.body'), true);
  assert.equal(pageSource.includes('style={{ zIndex: CHAT_PANEL_Z }}'), true);
  assert.equal(pageSource.includes("className=\"fixed right-4 top-4 isolate"), true);
  assert.equal(pageSource.includes("className=\"fixed inset-y-4 left-4 right-4 isolate"), true);
  assert.equal(pageSource.includes('style={{ zIndex: GLOBAL_NOTICE_Z }}'), true);
});
