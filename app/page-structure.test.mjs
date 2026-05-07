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

test('image card model menu uses a dedicated fixed popover that drops below the panel footer', () => {
  assert.equal(pageSource.includes('const [selectedImageCardModelPopoverOffset, setSelectedImageCardModelPopoverOffset] = useState<{ left: number; top: number } | null>(null);'), true);
  assert.equal(pageSource.includes('imageCardModelPopoverRef: React.RefObject<HTMLDivElement | null>;'), true);
  assert.equal(pageSource.includes('{showImageCardModelMenu && selectedImageCardModelPopoverOffset && ('), true);
  assert.equal(pageSource.includes('ref={imageCardModelPopoverRef}'), true);
  assert.equal(pageSource.includes('className="pointer-events-auto fixed z-[116] min-w-[248px] overflow-hidden rounded-[18px] border border-white/[0.1] bg-[rgba(24,24,27,0.985)] p-1.5 shadow-[0_24px_64px_rgba(0,0,0,0.42)] backdrop-blur-xl"'), true);
  assert.equal(pageSource.includes("transform: `translateY(-100%) scale(${viewport.scale})`"), false);
  assert.equal(pageSource.includes("transform: `scale(${viewport.scale})`"), true);
  assert.equal(pageSource.includes("placement: 'below-panel',"), true);
});

test('image card count menu also uses a fixed below-panel dropdown instead of the legacy upward popover', () => {
  assert.equal(pageSource.includes('const [selectedImageCardCountPopoverOffset, setSelectedImageCardCountPopoverOffset] = useState<{ left: number; top: number } | null>(null);'), true);
  assert.equal(pageSource.includes('imageCardCountPopoverRef: React.RefObject<HTMLDivElement | null>;'), true);
  assert.equal(pageSource.includes('{showImageCardCountMenu && selectedImageCardCountPopoverOffset && ('), true);
  assert.equal(pageSource.includes('ref={imageCardCountPopoverRef}'), true);
  assert.equal(pageSource.includes('className="pointer-events-auto fixed z-[116] min-w-[124px] overflow-hidden rounded-[18px] border border-white/[0.1] bg-[rgba(24,24,27,0.985)] p-1.5 shadow-[0_24px_64px_rgba(0,0,0,0.42)] backdrop-blur-xl"'), true);
  assert.equal(pageSource.includes('top: selectedImageCardPanelViewportOrigin.top + selectedImageCardCountPopoverOffset.top * viewport.scale,'), true);
  assert.equal(pageSource.includes('top: selectedImageCardPanelViewportOrigin.top + selectedImageCardCountPopoverOffset.top * viewport.scale - 8,'), false);
});

test('canvas image preview metadata retries local asset loading before falling back to default dimensions', () => {
  assert.equal(pageSource.includes('const waitForCanvasImagePreview = (delayMs: number) =>'), true);
  assert.equal(pageSource.includes('const maxAttempts = 3;'), true);
  assert.equal(pageSource.includes("img.src = attempt === 1 ? localUrl : `${localUrl}${localUrl.includes('?') ? '&' : '?'}previewRetry=${attempt}`;"), true);
  assert.equal(pageSource.includes("console.warn('Canvas generated image preview fallback:'"), true);
  assert.equal(pageSource.includes('naturalWidth: IMAGE_CARD_DEFAULT_FRAME_WIDTH,'), true);
  assert.equal(pageSource.includes('naturalHeight: IMAGE_CARD_DEFAULT_FRAME_WIDTH,'), true);
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
  assert.equal(pageSource.includes("if (itemId === 'history') {"), true);
  assert.equal(pageSource.includes('setShowGeneratedImageHistoryPanel((prev) => !prev);'), true);
  assert.equal(pageSource.includes('{showGeneratedImageHistoryPanel && ('), true);
});

test('canvas clipboard wiring adds app-level copy helpers and keyboard shortcuts', () => {
  assert.equal(pageSource.includes('createCanvasClipboardSnapshot,'), true);
  assert.equal(pageSource.includes('materializeCanvasClipboardPaste,'), true);
  assert.equal(pageSource.includes('const canvasClipboardRef = useRef<{'), true);
  assert.equal(pageSource.includes("if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'c') {"), true);
  assert.equal(pageSource.includes("if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'v') {"), true);
});

test('alt-drag copy wiring materializes a temporary copy without mutating the regular clipboard ref', () => {
  const refStart = pageSource.indexOf('const suppressNextItemClickRef = useRef<string | null>(null);');
  const helperStart = pageSource.indexOf('const beginAltDragCopiedItems = React.useCallback(');
  const helperEnd = pageSource.indexOf('  const handleCanvasPointerDown =', helperStart);
  const selectionGroupStart = pageSource.indexOf('const handleSelectionGroupPointerDown = useCallback(');
  const selectionGroupEnd = pageSource.indexOf('  const handleItemMouseEnter = useCallback(', selectionGroupStart);
  const itemClickStart = pageSource.indexOf('const handleItemClick = useCallback(');
  const itemClickEnd = pageSource.indexOf('  const handleItemPointerDown = useCallback(', itemClickStart);
  const itemPointerStart = pageSource.indexOf('const handleItemPointerDown = useCallback(');
  const itemPointerEnd = pageSource.indexOf('  const handleCornerResizePointerDown = useCallback(', itemPointerStart);

  assert.notEqual(refStart, -1);
  assert.notEqual(helperStart, -1);
  assert.notEqual(helperEnd, -1);
  assert.ok(helperEnd > helperStart);
  assert.notEqual(selectionGroupStart, -1);
  assert.notEqual(selectionGroupEnd, -1);
  assert.ok(selectionGroupEnd > selectionGroupStart);
  assert.notEqual(itemClickStart, -1);
  assert.notEqual(itemClickEnd, -1);
  assert.ok(itemClickEnd > itemClickStart);
  assert.notEqual(itemPointerStart, -1);
  assert.notEqual(itemPointerEnd, -1);
  assert.ok(itemPointerEnd > itemPointerStart);

  const helperBlock = pageSource.slice(helperStart, helperEnd);
  const selectionGroupBlock = pageSource.slice(selectionGroupStart, selectionGroupEnd);
  const itemClickBlock = pageSource.slice(itemClickStart, itemClickEnd);
  const itemPointerBlock = pageSource.slice(itemPointerStart, itemPointerEnd);

  assert.equal(helperBlock.includes('createCanvasClipboardSnapshot({'), true);
  assert.equal(helperBlock.includes('materializeCanvasClipboardPaste({'), true);
  assert.equal(helperBlock.includes('offsetStep: { x: 0, y: 0 },'), true);
  assert.equal(helperBlock.includes('canvasClipboardRef.current'), false);
  assert.equal(helperBlock.includes('draggingItemIdsRef.current = copiedItems.selectedIds;'), true);
  assert.equal(helperBlock.includes('suppressNextItemClickRef.current = primaryId;'), true);
  assert.equal(itemClickBlock.includes('const suppressedItemClickId = suppressNextItemClickRef.current;'), true);
  assert.equal(itemClickBlock.includes('suppressNextItemClickRef.current = null;'), true);
  assert.equal(itemClickBlock.includes('if (suppressedItemClickId === itemId) {'), true);
  assert.equal(selectionGroupBlock.includes('if (e.altKey) {'), true);
  assert.equal(selectionGroupBlock.includes('beginAltDragCopiedItems('), true);
  assert.equal(itemPointerBlock.includes('if (e.altKey) {'), true);
  assert.equal(itemPointerBlock.includes('beginAltDragCopiedItems('), true);
});

test('canvas copy shortcuts avoid hijacking text selection and paste falls back after image clipboard handling', () => {
  const panelPasteStopPropagationSnippet =
    'onPaste={(e) => {\n                      e.stopPropagation();\n                    }}\n                    onWheel={stopCanvasWheelFromScrollableRegion}';

  assert.equal(pageSource.includes('const hasActiveNonEditableTextSelection = useCallback(() => {'), true);
  assert.equal(pageSource.includes('if (hasActiveNonEditableTextSelection()) {'), true);
  assert.equal(pageSource.includes('if (!shouldHandleCanvasImagePaste(e.target)) {'), true);
  assert.equal(pageSource.includes('const pastedCanvasClipboard = materializeCanvasClipboardPaste({'), true);
  assert.equal(pageSource.includes('if (imageFiles.length > 0) {'), true);
  assert.equal(pageSource.split(panelPasteStopPropagationSnippet).length - 1, 2);
  assert.equal(pageSource.includes('canvasClipboardRef.current?.snapshot'), true);
});

test('left rail generated image history panel uses a wider layout than the original 320px menu', () => {
  assert.equal(pageSource.includes('w-[320px]'), false);
  assert.equal(pageSource.includes('w-[384px]'), true);
  assert.equal(pageSource.includes('className="min-w-0 flex-1"'), true);
});

test('image card quality controls use model-driven size options without rendering actual resolution helper text', () => {
  assert.equal(pageSource.includes('const selectedImageCardSizeOptions = React.useMemo('), true);
  assert.equal(pageSource.includes('getSupportedImageCardSizeOptions(selectedImageCardPanelModelId)'), true);
  assert.equal(pageSource.includes('const selectedImageCardSupportsAspectRatio = React.useMemo('), true);
  assert.equal(pageSource.includes('() => getImageModelCapability(selectedImageCardPanelModelId).supportsAspectRatio,'), true);
  assert.equal(pageSource.includes('const IMAGE_CARD_QUALITY_OPTIONS = ['), true);
  assert.equal(pageSource.includes("label: 'Auto'"), true);
  assert.equal(pageSource.includes("label: 'High'"), true);
  assert.equal(pageSource.includes("label: 'Medium'"), true);
  assert.equal(pageSource.includes("label: 'Low'"), true);
  assert.equal(pageSource.includes('selectedImageCardPanelQuality={selectedImageCardPanelQuality}'), true);
  assert.equal(pageSource.includes('onSelectImageCardQuality={(qualityId) => {'), true);
  assert.equal(pageSource.includes('{selectedImageCardSupportsAspectRatio && ('), true);
  assert.equal(pageSource.includes("getImageCardQualitySummary({\n                          modelId: selectedImageCardModel.id,"), true);
  assert.equal(pageSource.includes('const getImageCardSizePresetLabel = (sizeId: string) =>'), true);
  assert.equal(pageSource.includes('const divisor = gcd(width, height);'), true);
  assert.equal(pageSource.includes('const ratioLabel = `${width / divisor}:${height / divisor}`;'), true);
  assert.equal(pageSource.includes("else if (longestEdge >= 1536) resolutionLabel = '1.5K';"), true);
  assert.equal(pageSource.includes("if (longestEdge >= 3840) resolutionLabel = '4K';"), true);
  assert.equal(pageSource.includes("const getImageCardSizePresetLabelLines = (sizeId: string) =>"), true);
  assert.equal(pageSource.includes("const getAspectRatioFromImageSize = (sizeId: string): string =>"), true);
  assert.equal(pageSource.includes('const getImageCardSizePreviewSize = (sizeId: string) =>'), true);
  assert.equal(pageSource.includes('height: Math.max(7, (height / width) * maxPreviewEdge),'), true);
  assert.equal(pageSource.includes('width: Math.max(7, (width / height) * maxPreviewEdge),'), true);
  assert.equal(pageSource.includes('width: 292,'), true);
  assert.equal(pageSource.includes('className="inline-flex w-full items-center rounded-[14px] border border-white/[0.06] bg-[rgba(255,255,255,0.03)] p-1"'), true);
  assert.equal(pageSource.includes('className="grid grid-cols-4 gap-1.5"'), true);
  assert.equal(pageSource.includes("flex min-h-[58px] flex-col items-center justify-center gap-1.5 rounded-[14px] border px-1.5 py-2 text-center text-[12px]"), true);
  assert.equal(pageSource.includes("border-white/[0.14] bg-white/[0.09] text-zinc-50 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]"), true);
  assert.equal(pageSource.includes("className=\"flex flex-col items-center leading-[1.05]\""), true);
  assert.equal(pageSource.includes("!selectedImageCardSupportsAspectRatio && ("), true);
  assert.equal(pageSource.includes(">{getImageCardQualityLabel(selectedImageCardPanelQuality)}<"), false);
  assert.equal(pageSource.includes('const selectedImageCardResolutionStatus = React.useMemo('), false);
  assert.equal(pageSource.includes('实际尺寸'), false);
  assert.equal(pageSource.includes('selectedImageCardResolutionStatus.warning'), false);
});

test('generated image history merges persisted sessions with live session history and archive backfill entries', () => {
  assert.equal(pageSource.includes('const currentSessionHistorySnapshot = React.useMemo('), true);
  assert.equal(pageSource.includes('buildCurrentSessionSnapshot(currentSession)'), true);
  assert.equal(
    pageSource.includes(
      'const [generatedImageHistoryBySession, setGeneratedImageHistoryBySessionState] = useState<Record<string, GeneratedImageHistoryEntry[]>>({});'
    ),
    true
  );
  assert.equal(pageSource.includes('const setGeneratedImageHistoryBySession = useCallback('), true);
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

test('realtime generated image history entries normalize createdAt with the shared sort key helper', () => {
  assert.equal(pageSource.includes('buildGeneratedImageHistorySortKey,'), true);
  assert.equal(pageSource.includes('const normalizedCreatedAt = buildGeneratedImageHistorySortKey(timestamp, sequence);'), true);
  assert.equal(pageSource.includes('createdAt: normalizedCreatedAt,'), true);
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

test('image toolbar actions enable cutout and export while keeping the other actions disabled', () => {
  assert.equal(pageSource.includes('const IMAGE_NODE_TOOLBAR_ACTIONS = ['), true);
  assert.equal(pageSource.includes("id: 'cutout'"), true);
  assert.equal(pageSource.includes("id: 'export'"), true);
  assert.equal(pageSource.includes("disabledReason: '暂不可用'"), false);
  assert.equal(pageSource.includes("id: 'cutout', label: '抠图', icon: ImageIcon, enabled: true"), true);
  assert.equal(pageSource.includes("id: 'export', label: '导出', icon: Send, enabled: true"), true);
  assert.equal(pageSource.includes('enabled: false'), true);
});

test('image toolbar cutout restores the remove-background route and status notices', () => {
  assert.equal(pageSource.includes("/api/image-tools/remove-background"), true);
  assert.equal(pageSource.includes('抠图能力下一步接入'), false);
  assert.equal(pageSource.includes('暂不可用'), false);
  assert.equal(pageSource.includes('抠图中…'), true);
  assert.equal(pageSource.includes('抠图完成'), true);
  assert.equal(pageSource.includes('抠图失败'), true);
});

test('image toolbar export downloads the current image source through the export route with notices', () => {
  assert.equal(pageSource.includes("/api/image-tools/export?src="), true);
  assert.equal(pageSource.includes("showImageToolbarNoticeWithTimeout('导出中…');"), true);
  assert.equal(pageSource.includes("showImageToolbarNoticeWithTimeout('导出完成', 2200);"), true);
  assert.equal(pageSource.includes("showImageToolbarNoticeWithTimeout('导出失败', 2800);"), true);
  assert.equal(pageSource.includes("const downloadUrl = URL.createObjectURL(blob);"), true);
  assert.equal(pageSource.includes("link.download = fileName;"), true);
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

test('image cards use image-specific default dimensions instead of aliasing text card dimensions', () => {
  assert.equal(pageSource.includes('const IMAGE_CARD_DIMENSIONS = TEXT_CARD_DIMENSIONS;'), false);
  assert.equal(pageSource.includes('const IMAGE_CARD_DIMENSIONS = {'), true);
});

test('selected image card panel keeps a fixed 480px canvas width', () => {
  assert.equal(
    pageSource.includes('const selectedImageCardPanelCanvasWidth = TEXT_CARD_GENERATION_PANEL_DEFAULT_WIDTH;'),
    true
  );
  assert.equal(
    pageSource.includes('? Math.max(TEXT_CARD_GENERATION_PANEL_DEFAULT_WIDTH, selectedImageCardPanelFrameBounds.width)'),
    false
  );
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

test('text card shell keeps padding inside idle and waiting states instead of the shared frame wrapper', () => {
  const textCardBranchStart = pageSource.indexOf("{item.type === 'text' && item.textVariant === 'card' && (");
  const textCardBranchEnd = pageSource.indexOf('{isItemSelected &&', textCardBranchStart);

  assert.notEqual(textCardBranchStart, -1);
  assert.notEqual(textCardBranchEnd, -1);
  assert.ok(textCardBranchEnd > textCardBranchStart);

  const textCardBranch = pageSource.slice(textCardBranchStart, textCardBranchEnd);

  assert.equal(textCardBranch.includes('className="absolute rounded-[22px] bg-[#1f1f22] px-9 py-12"'), false);
  assert.equal(textCardBranch.includes('className="w-full max-w-[560px] px-8 py-10 text-left"'), true);
  assert.equal(textCardBranch.includes('className="flex h-full w-full items-center justify-center px-8 text-center"'), true);
});

test('text card content and manual states use edge-to-edge full-frame layouts without inner padding', () => {
  const textCardBranchStart = pageSource.indexOf("{item.type === 'text' && item.textVariant === 'card' && (");
  const textCardBranchEnd = pageSource.indexOf('{isItemSelected &&', textCardBranchStart);

  assert.notEqual(textCardBranchStart, -1);
  assert.notEqual(textCardBranchEnd, -1);
  assert.ok(textCardBranchEnd > textCardBranchStart);

  const textCardBranch = pageSource.slice(textCardBranchStart, textCardBranchEnd);
  const fullFrameScrollMatches = textCardBranch.match(/className="panel-scrollbar h-full min-w-0 w-full overflow-y-auto"/g) ?? [];

  assert.equal(textCardBranch.includes('className="panel-scrollbar h-full w-full overflow-y-auto px-2 py-1"'), false);
  assert.equal(fullFrameScrollMatches.length, 2);
  assert.equal(textCardBranch.includes('className={`panel-scrollbar h-full w-full resize-none bg-transparent px-2 py-1'), false);
  assert.equal(
    textCardBranch.includes(
      'className="assistant-selectable-node pointer-events-auto min-h-full w-full min-w-0 break-words px-6 py-5"'
    ),
    true
  );
  assert.equal(textCardBranch.includes('className="h-full w-full px-6 py-5"'), true);
  assert.equal(
    textCardBranch.includes(
      'className={`assistant-selectable-node pointer-events-auto min-h-full w-full min-w-0 whitespace-pre-wrap break-words px-6 py-5 ${TEXT_CARD_BODY_TEXT_CLASSNAME}`}'
    ),
    true
  );
});

test('text card generated and manual content bodies stay selectable without triggering drag or edit shortcuts', () => {
  const textCardBranchStart = pageSource.indexOf("{item.type === 'text' && item.textVariant === 'card' && (");
  const textCardBranchEnd = pageSource.indexOf('{isItemSelected &&', textCardBranchStart);

  assert.notEqual(textCardBranchStart, -1);
  assert.notEqual(textCardBranchEnd, -1);
  assert.ok(textCardBranchEnd > textCardBranchStart);

  const textCardBranch = pageSource.slice(textCardBranchStart, textCardBranchEnd);
  const textSelectionGestureIsolationSnippet =
    'onPointerDown={(e) => {\n                            e.stopPropagation();\n                          }}\n                          onDoubleClick={(e) => {\n                            e.stopPropagation();\n                          }}';
  const manualContentReeditSnippet =
    'onPointerDown={(e) => {\n                            e.stopPropagation();\n                          }}\n                          onDoubleClick={(e) => {\n                            e.stopPropagation();\n                            onItemDoubleClick(item.id);\n                          }}';

  assert.equal(textCardBranch.split('data-assistant-selectable="true"').length - 1, 2);
  assert.equal(
    textCardBranch.includes(
      'className="assistant-selectable-node pointer-events-auto min-h-full w-full min-w-0 break-words px-6 py-5"'
    ),
    true
  );
  assert.equal(
    textCardBranch.includes(
      'className={`assistant-selectable-node pointer-events-auto min-h-full w-full min-w-0 whitespace-pre-wrap break-words px-6 py-5 ${TEXT_CARD_BODY_TEXT_CLASSNAME}`}'
    ),
    true
  );
  assert.equal(textCardBranch.split(textSelectionGestureIsolationSnippet).length - 1, 2);
  assert.equal(textCardBranch.includes(manualContentReeditSnippet), true);
});

test('text card markdown root explicitly fills the current frame width without a max-width cap', () => {
  assert.equal(
    pageSource.includes(
      'className="workspace-text-card-markdown w-full min-w-0 max-w-none break-words text-[15px] leading-7 tracking-[-0.02em] text-zinc-200"'
    ),
    true
  );
  assert.equal(
    pageSource.includes('className="workspace-text-card-markdown text-[15px] leading-7 tracking-[-0.02em] text-zinc-200"'),
    false
  );
});

test('text card markdown code blocks soft-wrap to the current frame width while tables keep horizontal scrolling', () => {
  const markdownStart = pageSource.indexOf('const TextCardMarkdown = memo(function TextCardMarkdown({');
  const markdownEnd = pageSource.indexOf('function ConnectionPortIcon({', markdownStart);

  assert.notEqual(markdownStart, -1);
  assert.notEqual(markdownEnd, -1);
  assert.ok(markdownEnd > markdownStart);

  const markdownBlock = pageSource.slice(markdownStart, markdownEnd);

  assert.equal(markdownBlock.includes('overflow-x-auto rounded-[14px] border border-white/[0.08] bg-black/20 px-3 py-2 text-[13px] leading-6 text-zinc-200 first:mt-0'), false);
  assert.equal(markdownBlock.includes('whitespace-pre-wrap'), true);
  assert.equal(markdownBlock.includes('[overflow-wrap:anywhere]'), true);
  assert.equal(markdownBlock.includes('block w-full min-w-0'), true);
  assert.equal(markdownBlock.includes('className="mt-4 overflow-x-auto first:mt-0"'), true);
});

test('canvas viewport no longer keeps a legacy in-canvas image card floating panel branch', () => {
  assert.equal(pageSource.includes('{false && selectedImageCardPanelItem && selectedImageCardPanelFrameBounds && selectedImageCardPanelCanvasRect && ('), false);
  assert.equal(pageSource.includes('left: selectedImageCardPanelLeft + selectedImageCardQualityPopoverOffset.left * viewport.scale,'), false);
  assert.equal(pageSource.includes('left: selectedImageCardPanelLeft + selectedImageCardCountPopoverOffset.left * viewport.scale,'), false);
});

test('image card aspect ratio selection still routes through resizeImageCardItemToAspectRatio', () => {
  assert.equal(pageSource.includes('? resizeImageCardItemToAspectRatio(item, normalizedAspectRatio)'), true);
});

test('fixed-size image card size selection also routes through resizeImageCardItemToAspectRatio using the derived ratio', () => {
  assert.equal(pageSource.includes('const resolvedSizeId = resolveImageCardSize(selectedImageCardPanelModelId, sizeId);'), true);
  assert.equal(pageSource.includes('const normalizedAspectRatio = getAspectRatioFromImageSize(resolvedSizeId);'), true);
  assert.equal(pageSource.includes('[selectedImageCardPanelItem.id]: normalizedAspectRatio,'), true);
});

test('image card quality menu stays open after size and ratio picks until an outside click closes it', () => {
  const sizeSelectStart = pageSource.indexOf('onSelectImageCardSize={(sizeId) => {');
  const sizeSelectEnd = pageSource.indexOf('        onSelectImageCardQuality={(qualityId) => {', sizeSelectStart);
  const aspectSelectStart = pageSource.indexOf('onSelectImageCardAspectRatio={(aspectRatioId) => {');
  const aspectSelectEnd = pageSource.indexOf('        onSelectedImageCardPanelInputChange={handleSelectedImageCardPanelInputChange}', aspectSelectStart);

  assert.notEqual(sizeSelectStart, -1);
  assert.notEqual(sizeSelectEnd, -1);
  assert.ok(sizeSelectEnd > sizeSelectStart);
  assert.notEqual(aspectSelectStart, -1);
  assert.notEqual(aspectSelectEnd, -1);
  assert.ok(aspectSelectEnd > aspectSelectStart);

  const sizeSelectBlock = pageSource.slice(sizeSelectStart, sizeSelectEnd);
  const aspectSelectBlock = pageSource.slice(aspectSelectStart, aspectSelectEnd);

  assert.equal(sizeSelectBlock.includes('setShowImageCardQualityMenu(false);'), false);
  assert.equal(aspectSelectBlock.includes('setShowImageCardQualityMenu(false);'), false);
  assert.equal(pageSource.includes('const isInsideImageCardQualityMenu ='), true);
  assert.equal(pageSource.includes('if (!isInsideImageCardQualityMenu) {\n        setShowImageCardQualityMenu(false);\n      }'), true);
});

test('image card generation always uses async task requests instead of keeping a single-image sync branch', () => {
  assert.equal(pageSource.includes('if (count <= 1) {'), false);
  assert.equal(pageSource.includes('buildCanvasImageGenerationRequest({'), false);
  assert.equal(pageSource.includes('const asyncRequests = buildAsyncImageTaskRequests({'), true);
  assert.equal(pageSource.includes('const taskExecutionMode = resolveCanvasImageTaskExecutionMode({'), true);
  assert.equal(pageSource.includes('settleCanvasImageGenerationRequests({'), true);
});

test('image card generation validates actual output resolution before appending image outputs', () => {
  const generateStart = pageSource.indexOf('const handleCanvasImageGenerate = useCallback(');
  const generateEnd = pageSource.indexOf('const handleCancelCanvasImageGenerate = useCallback(', generateStart);

  assert.notEqual(generateStart, -1);
  assert.notEqual(generateEnd, -1);
  assert.ok(generateEnd > generateStart);

  const generateBlock = pageSource.slice(generateStart, generateEnd);

  assert.equal(generateBlock.includes('getImageCardResolutionStatus({'), false);
  assert.equal(generateBlock.includes('acceptedOutputs: outputMetas'), true);
  assert.equal(generateBlock.includes('appendImageCardOutput({'), true);
  assert.equal(generateBlock.includes('warningCount: 0'), true);
});

test('image card generation uses the shared failure message helper for partial success states', () => {
  assert.equal(
    pageSource.includes('buildCanvasImageGenerationFailureMessage('),
    true
  );
  assert.equal(
    pageSource.includes('[itemId]: failureMessage,'),
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
  assert.equal(pageSource.includes('createPortal('), true);
  assert.equal(pageSource.includes('document.body'), true);
  assert.equal(pageSource.includes('style={{ zIndex: CHAT_PANEL_Z }}'), true);
  assert.equal(pageSource.includes("className=\"fixed right-4 top-4 isolate"), true);
  assert.equal(pageSource.includes("className=\"fixed inset-y-4 left-4 right-4 isolate"), true);
});

test('page wires session-scoped canvas undo history through a dedicated snapshot helper module', () => {
  assert.equal(pageSource.includes("from './lib/canvas-history.mjs'"), true);
  assert.equal(pageSource.includes('const canvasHistoryBySessionRef = useRef<Record<string, SessionCanvasHistoryState>>({});'), true);
  assert.equal(pageSource.includes('const createCurrentCanvasUndoSnapshot = useCallback(() =>'), true);
  assert.equal(pageSource.includes('const commitCanvasUndoSnapshot = useCallback(() =>'), true);
  assert.equal(pageSource.includes('const undoCanvasEdit = useCallback(() =>'), true);
  assert.equal(pageSource.includes('const redoCanvasEdit = useCallback(() =>'), true);
});

test('page routes the top-left return action through leaveEditor so the current canvas is committed before leaving', () => {
  const backButtonStart = pageSource.indexOf('aria-label="返回画廊"');
  assert.notEqual(backButtonStart, -1);

  const backButtonBlockStart = pageSource.lastIndexOf('<button', backButtonStart);
  const backButtonBlockEnd = pageSource.indexOf('</button>', backButtonStart);

  assert.notEqual(backButtonBlockStart, -1);
  assert.notEqual(backButtonBlockEnd, -1);
  assert.ok(backButtonBlockEnd > backButtonBlockStart);

  const backButtonBlock = pageSource.slice(backButtonBlockStart, backButtonBlockEnd);

  assert.equal(pageSource.includes('leaveEditor,'), true);
  assert.equal(backButtonBlock.includes('leaveEditor();'), true);
  assert.equal(backButtonBlock.includes("setViewMode('gallery');"), false);
  assert.equal(backButtonBlock.includes("window.history.pushState({}, '', '/');"), false);
});

test('page snapshots and transition persistence read from a live session state ref instead of stale render closures', () => {
  assert.equal(pageSource.includes('const sessionLiveStateRef = useRef<'), true);
  assert.equal(pageSource.includes('const applySessionLiveStateUpdate = useCallback('), true);
  assert.equal(pageSource.includes('const liveState = sessionLiveStateRef.current;'), true);
  assert.equal(pageSource.includes('items: liveState.items'), true);
  assert.equal(pageSource.includes('connections: liveState.connections'), true);
  assert.equal(pageSource.includes('messages: liveState.chatMessages'), true);
  assert.equal(pageSource.includes('viewport: liveState.viewport'), true);
  assert.equal(pageSource.includes('sessionLiveStateRef.current = {'), true);
});

test('page guards connection cleanup while a switched canvas session is hydrating', () => {
  const applyResolvedStateStart = pageSource.indexOf('const applyResolvedSessionState = useCallback((resolvedState: any) => {');
  const applyResolvedStateEnd = pageSource.indexOf('  }, [syncSessionLiveState]);', applyResolvedStateStart);

  assert.notEqual(applyResolvedStateStart, -1);
  assert.notEqual(applyResolvedStateEnd, -1);
  assert.ok(applyResolvedStateEnd > applyResolvedStateStart);

  const applyResolvedStateBlock = pageSource.slice(applyResolvedStateStart, applyResolvedStateEnd);

  assert.equal(pageSource.includes('const isHydratingSessionRef = useRef(false);'), true);
  assert.equal(applyResolvedStateBlock.includes('isHydratingSessionRef.current = true;'), true);
  assert.equal(applyResolvedStateBlock.includes('setSelectedConnectionIds([]);'), true);
  assert.equal(applyResolvedStateBlock.includes('setConnectionSnapTargetId(null);'), true);
  assert.equal(applyResolvedStateBlock.includes('setPendingConnectionMenu(null);'), true);
  assert.equal(applyResolvedStateBlock.includes('setFrozenPreviewConnection(null);'), true);
  assert.equal(applyResolvedStateBlock.includes('connectionSessionRef.current = null;'), true);
  assert.equal(pageSource.includes('if (isHydratingSessionRef.current) {'), true);
  assert.equal(pageSource.includes('isHydratingSessionRef.current = false;'), true);
});

test('page keyboard handling supports canvas undo redo shortcuts while skipping editable targets', () => {
  assert.equal(pageSource.includes('const isEditableUndoRedoTarget = (target: EventTarget | null) => {'), true);
  assert.equal(pageSource.includes("if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {"), true);
  assert.equal(pageSource.includes('const isRedoShortcut = e.shiftKey || (!e.metaKey && e.ctrlKey && e.key.toLowerCase() === \'y\');'), true);
  assert.equal(pageSource.includes('if (isEditableUndoRedoTarget(e.target)) return;'), true);
  assert.equal(pageSource.includes('undoCanvasEdit();'), true);
  assert.equal(pageSource.includes('redoCanvasEdit();'), true);
});

test('page captures drag resize and manual-text baselines before committing undo history once per completed edit', () => {
  assert.equal(pageSource.includes('const pendingCanvasHistorySnapshotRef = useRef<CanvasUndoSnapshot | null>(null);'), true);
  assert.equal(pageSource.includes('pendingCanvasHistorySnapshotRef.current = createCurrentCanvasUndoSnapshot();'), true);
  assert.equal(pageSource.includes('commitCanvasUndoSnapshot(pendingCanvasHistorySnapshotRef.current);'), true);
  assert.equal(pageSource.includes('pendingCanvasHistorySnapshotRef.current = null;'), true);
});
