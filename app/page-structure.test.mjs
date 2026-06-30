import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pageSource = fs.readFileSync(path.join(__dirname, 'page.tsx'), 'utf8');
const appSourceFilesWithoutShadows = [
  'globals.css',
  'page.tsx',
  'components/workspace/GalleryView.tsx',
  'workspaces/page.tsx',
  'workspaces/[id]/page.tsx',
  'debug/logs/page.tsx',
];

test('image card floating menus are not rendered inside the pending connection menu block', () => {
  const pendingMenuStart = pageSource.indexOf('{pendingConnectionMenu && (');
  const pendingMenuEnd = pageSource.indexOf('{portaledSelectedTextCardPanel}');

  assert.notEqual(pendingMenuStart, -1);
  assert.notEqual(pendingMenuEnd, -1);
  assert.ok(pendingMenuEnd > pendingMenuStart);

  const pendingMenuBlock = pageSource.slice(pendingMenuStart, pendingMenuEnd);

  assert.equal(
    pendingMenuBlock.includes('{showImageCardSettingsMenu && selectedImageCardSettingsPopoverOffset && ('),
    false
  );
  assert.equal(pendingMenuBlock.includes('{showImageCardCountMenu && selectedImageCardCountPopoverOffset && ('), false);
});

test('image card model menu uses a dedicated fixed popover that drops below the panel footer', () => {
  assert.equal(pageSource.includes('const [selectedImageCardModelPopoverOffset, setSelectedImageCardModelPopoverOffset] = useState<{ left: number; top: number } | null>(null);'), true);
  assert.equal(pageSource.includes('imageCardModelPopoverRef: React.RefObject<HTMLDivElement | null>;'), true);
  assert.equal(pageSource.includes('{showImageCardModelMenu && selectedImageCardModelPopoverOffset && ('), true);
  assert.equal(pageSource.includes('ref={imageCardModelPopoverRef}'), true);
  assert.equal(pageSource.includes('className="workspace-menu-panel pointer-events-auto fixed z-[116] min-w-[248px] overflow-hidden rounded-[18px] p-1.5"'), true);
  assert.equal(pageSource.includes("transform: `translateY(-100%) scale(${viewport.scale})`"), false);
  assert.equal(pageSource.includes("transform: `scale(${viewport.scale})`"), true);
  assert.equal(pageSource.includes("placement: 'below-panel',"), true);
});

test('image card count control uses an inline stepper instead of a floating dropdown menu', () => {
  assert.equal(pageSource.includes('const IMAGE_CARD_COUNT_MIN = 1;'), true);
  assert.equal(pageSource.includes('const IMAGE_CARD_COUNT_MAX = 9;'), true);
  assert.equal(pageSource.includes('const clampImageCardCount = (value: number) => {'), true);
  assert.equal(pageSource.includes('const [selectedImageCardCountPopoverOffset, setSelectedImageCardCountPopoverOffset] = useState<{ left: number; top: number } | null>(null);'), false);
  assert.equal(pageSource.includes('imageCardCountPopoverRef: React.RefObject<HTMLDivElement | null>;'), false);
  assert.equal(pageSource.includes('{showImageCardCountMenu && selectedImageCardCountPopoverOffset && ('), false);
  assert.equal(pageSource.includes('aria-label="减少张数"'), true);
  assert.equal(pageSource.includes('aria-label="增加张数"'), true);
  assert.equal(pageSource.includes('inputMode="numeric"'), true);
  assert.equal(pageSource.includes('pattern="[0-9]*"'), true);
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

test('canvas text and image cards render a compact generation duration badge in the title row', () => {
  assert.equal(pageSource.includes('const cardGenerationDurationLabel = getGenerationDurationDisplay('), true);
  assert.equal(pageSource.includes("{cardGenerationDurationLabel && ("), true);
  assert.equal(pageSource.includes('<Clock3 size={12} strokeWidth={2} />'), true);
});

test('image card header renders image dimensions to the left of the generation duration chip', () => {
  const imageCardBlockStart = pageSource.indexOf('{isImageCard && (');
  const imageCardBlockEnd = pageSource.indexOf('{item.type === \'shape\' &&', imageCardBlockStart);
  const imageCardContentStart = pageSource.indexOf("{imageCardVisualState === 'content' && item.src && (", imageCardBlockStart);
  const imageCardContentEnd = pageSource.indexOf('{item.type === \'shape\' &&', imageCardContentStart);

  assert.notEqual(imageCardBlockStart, -1);
  assert.notEqual(imageCardBlockEnd, -1);
  assert.ok(imageCardBlockEnd > imageCardBlockStart);
  assert.notEqual(imageCardContentStart, -1);
  assert.notEqual(imageCardContentEnd, -1);
  assert.ok(imageCardContentEnd > imageCardContentStart);

  const imageCardBlock = pageSource.slice(imageCardBlockStart, imageCardBlockEnd);
  const imageCardContentBlock = pageSource.slice(imageCardContentStart, imageCardContentEnd);

  assert.equal(pageSource.includes('const currentImageDimensionsLabel = isImageCard && currentImageOutput'), true);
  assert.equal(imageCardBlock.includes('{(currentImageDimensionsLabel || cardGenerationDurationLabel) && ('), true);
  assert.equal(imageCardBlock.includes('className="inline-flex items-center gap-2"'), true);
  assert.equal(imageCardBlock.includes('<span>{currentImageDimensionsLabel}</span>'), true);
  assert.equal(imageCardBlock.includes('<Clock3 size={12} strokeWidth={2} />'), true);
  assert.equal(imageCardBlock.includes('workspace-control-chip inline-flex h-6 items-center gap-1 rounded-lg px-2 text-[11px]'), true);
  assert.equal(imageCardContentBlock.includes('absolute right-3 top-3'), false);
  assert.equal(pageSource.includes('`${currentImageOutput.naturalWidth}×${currentImageOutput.naturalHeight}`'), true);
});

test('canvas card surfaces and selected outlines use fixed 5px corner radii', () => {
  assert.equal(pageSource.includes('getScaledNodeCornerRadius('), false);
  assert.equal(pageSource.includes('const itemCornerRadius = CANVAS_NODE_CORNER_RADIUS;'), true);
  assert.equal(pageSource.includes('const frameCornerRadius = CANVAS_NODE_CORNER_RADIUS;'), true);
  assert.equal(pageSource.includes('const selectedOutlineCornerRadius = CANVAS_NODE_CORNER_RADIUS;'), true);
  assert.equal(pageSource.includes('const CANVAS_NODE_CORNER_RADIUS = 5;'), true);
  assert.equal(pageSource.includes('const HANDLE_ARC_RADIUS = NODE_CORNER_RADIUS + CORNER_HANDLE_GAP;'), false);
  assert.equal(pageSource.includes('const HANDLE_ARC_RADIUS = CANVAS_NODE_CORNER_RADIUS + CORNER_HANDLE_GAP;'), true);
  assert.equal(pageSource.includes('const NODE_CORNER_RADIUS = 24;'), false);
  assert.equal(pageSource.includes('A ${HANDLE_ARC_RADIUS} ${HANDLE_ARC_RADIUS}'), false);
  assert.equal(
    pageSource.includes(
      'd={`M ${CORNER_HANDLE_CENTER + HANDLE_ARC_RADIUS} ${CORNER_HANDLE_CENTER} L ${CORNER_HANDLE_CENTER + HANDLE_ARC_RADIUS} ${CORNER_HANDLE_CENTER + HANDLE_ARC_RADIUS} L ${CORNER_HANDLE_CENTER} ${CORNER_HANDLE_CENTER + HANDLE_ARC_RADIUS}`}'
    ),
    true
  );
  assert.equal(pageSource.includes('right: isTextCard\n                    ?'), false);
  assert.equal(pageSource.includes('bottom: isTextCard\n                    ?'), false);
  assert.equal(pageSource.includes('right: isTextCard || isImageCard'), true);
  assert.equal(pageSource.includes('bottom: isTextCard || isImageCard'), true);
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

test('workspace theme defaults to light and syncs root theme state', () => {
  assert.equal(pageSource.includes("type WorkspaceTheme = 'light' | 'dark';"), true);
  assert.equal(pageSource.includes("const WORKSPACE_THEME_STORAGE_KEY = 'zo-design-workspace-theme';"), true);
  assert.equal(pageSource.includes("const DEFAULT_WORKSPACE_THEME: WorkspaceTheme = 'light';"), true);
  assert.equal(pageSource.includes('function useWorkspaceTheme()'), true);
  assert.equal(pageSource.includes("document.documentElement.dataset.workspaceTheme = theme;"), true);
  assert.equal(pageSource.includes("document.documentElement.classList.toggle('dark', theme === 'dark');"), true);
  assert.equal(pageSource.includes('window.localStorage.setItem(WORKSPACE_THEME_STORAGE_KEY, theme);'), true);
});

test('left rail places the theme toggle between history and settings', () => {
  const railStart = pageSource.indexOf('const LEFT_RAIL_ITEMS = [');
  const railEnd = pageSource.indexOf('] as const;', railStart);

  assert.notEqual(railStart, -1);
  assert.notEqual(railEnd, -1);

  const railBlock = pageSource.slice(railStart, railEnd);
  const historyIndex = railBlock.indexOf("{ id: 'history', label: '历史', icon: Clock3 }");
  const themeIndex = railBlock.indexOf("{ id: 'theme', label: '黑夜', icon: Moon }");
  const settingsIndex = railBlock.indexOf("{ id: 'settings', label: '设置', icon: Settings }");

  assert.ok(historyIndex > -1);
  assert.ok(themeIndex > historyIndex);
  assert.ok(settingsIndex > themeIndex);
  assert.equal(pageSource.includes('<WorkspaceThemeToggle'), true);
  assert.equal(pageSource.includes("aria-label={theme === 'dark' ? '切换到白天模式' : '切换到黑夜模式'}"), true);
});

test('workspace menus and chips use shared theme classes instead of hardcoded dark colors', () => {
  assert.equal(pageSource.includes('workspace-menu-panel'), true);
  assert.equal(pageSource.includes('workspace-menu-item'), true);
  assert.equal(pageSource.includes('workspace-control-chip'), true);
  assert.equal(pageSource.includes('workspace-panel-surface'), true);
  assert.equal(pageSource.includes('workspace-panel-input'), true);
  assert.equal(pageSource.includes('workspace-panel-footer'), true);
  assert.equal(pageSource.includes('workspace-status-pill'), true);
  assert.equal(pageSource.includes("isActive ? 'is-active' : ''"), true);
  assert.equal(pageSource.includes("isSelected ? 'is-selected' : ''"), true);
  assert.equal(pageSource.includes("disabled ? 'is-disabled' : ''"), true);
});

test('workspace controls no longer keep the legacy dark-only menu palette', () => {
  const forbiddenDarkSnippets = [
    'bg-[#171b21]',
    'bg-[#181d24]',
    'bg-[#1f242c]',
    'border-[#2a3038]',
    'bg-[rgba(26,26,28,0.985)]',
    'bg-[rgba(28,28,31,0.98)]',
    'bg-[rgba(24,24,27,0.985)]',
    'bg-[rgba(14,15,18,0.92)]',
  ];

  for (const snippet of forbiddenDarkSnippets) {
    assert.equal(pageSource.includes(snippet), false, `${snippet} should be replaced with theme tokens`);
  }
});

test('workspace app sources do not use component shadow styles', () => {
  const forbiddenShadowPatterns = [
    /\bshadow-/,
    /shadow-\[/,
    /box-shadow/,
    /drop-shadow/,
    /boxShadow/,
    /--workspace-shadow/,
  ];

  for (const sourceFile of appSourceFilesWithoutShadows) {
    const source = fs.readFileSync(path.join(__dirname, sourceFile), 'utf8');
    for (const pattern of forbiddenShadowPatterns) {
      assert.equal(pattern.test(source), false, `${sourceFile} should not include ${pattern}`);
    }
  }
});

test('workspace model menus read provider-saved model lists instead of static constants only', () => {
  assert.equal(pageSource.includes('workspaceImageModelOptions'), true);
  assert.equal(pageSource.includes('workspaceTextModelOptions'), true);
  assert.equal(pageSource.includes('imageCardProviderById'), true);
  assert.equal(pageSource.includes('textCardProviderById'), true);
  assert.equal(pageSource.includes('textCardModelById'), true);
  assert.equal(pageSource.includes('providerSettingsProviders.filter((provider) => provider.enabled !== false)'), true);
  assert.equal(pageSource.includes('const selectedImageCardProviderModelOptions = React.useMemo('), true);
  assert.equal(pageSource.includes('workspaceImageModelOptions.filter((option) => option.providerId === selectedImageCardProviderId)'), true);
  assert.equal(pageSource.includes('imageCardModelOptions={selectedImageCardProviderModelOptions}'), true);
  assert.equal(pageSource.includes('imageCardModelOptions={workspaceImageModelOptions}'), false);
  assert.equal(pageSource.includes('const selectableTextProviders = React.useMemo('), true);
  assert.equal(pageSource.includes('enabledProviderSettingsProviders.filter((provider) => provider.chatModels.length > 0)'), true);
  assert.equal(pageSource.includes('const selectedTextCardProviderModelOptions = React.useMemo('), true);
  assert.equal(pageSource.includes('workspaceTextModelOptions.filter((option) => option.providerId === selectedTextCardProviderId)'), true);
  assert.equal(pageSource.includes('textPanelModelOptions={selectedTextCardProviderModelOptions}'), true);
  assert.equal(pageSource.includes('textPanelModelOptions={workspaceTextModelOptions}'), false);
  assert.equal(pageSource.includes('imageProviderId:'), true);
  assert.equal(pageSource.includes('chatProviderId:'), true);
  assert.equal(pageSource.includes('IMAGE_CARD_MODEL_OPTIONS.find((option)'), false);
  assert.equal(pageSource.includes('TEXT_PANEL_MODEL_OPTIONS.find((option)'), false);
});

test('text card panel has provider picker and switches model to selected provider first chat model', () => {
  assert.equal(pageSource.includes('selectedTextCardProviderLabel'), true);
  assert.equal(pageSource.includes('selectableTextProviders={selectableTextProviders}'), true);
  assert.equal(pageSource.includes('showTextPanelProviderMenu'), true);
  assert.equal(pageSource.includes('onSelectTextPanelProvider={(providerId) => {'), true);
  assert.equal(pageSource.includes('const nextModel = findWorkspaceModelOption(workspaceTextModelOptions, \'\', providerId);'), true);
  assert.equal(pageSource.includes('[selectedTextCardPanelItem.id]: providerId'), true);
  assert.equal(pageSource.includes('[selectedTextCardPanelItem.id]: nextModel?.id || defaultWorkspaceTextModelOption.id'), true);
});

test('text card panel uses bottom large provider and model controls with fixed popovers', () => {
  const textPanelStart = pageSource.indexOf('const portaledSelectedTextCardPanel =');
  const textPanelEnd = pageSource.indexOf('\n  return (\n', textPanelStart);

  assert.notEqual(textPanelStart, -1);
  assert.notEqual(textPanelEnd, -1);
  assert.ok(textPanelEnd > textPanelStart);

  const textPanelBlock = pageSource.slice(textPanelStart, textPanelEnd);

  assert.equal(textPanelBlock.includes('className="workspace-panel-footer flex items-end justify-between gap-4 px-5 py-3"'), true);
  assert.equal(textPanelBlock.includes('grid min-w-0 flex-1 grid-cols-[minmax(0,1.1fr)_minmax(0,1.2fr)] gap-2'), true);
  assert.equal(textPanelBlock.includes('workspace-control-chip flex min-h-[52px] w-full items-center justify-between gap-3 rounded-[14px] px-3 py-2 text-left'), true);
  assert.equal(textPanelBlock.includes('workspace-control-chip inline-flex items-center gap-2 rounded-full px-2.5 py-1.5 text-[13px] font-semibold tracking-[-0.02em]'), false);
  assert.equal(textPanelBlock.includes('className="workspace-menu-panel absolute bottom-full left-0 mb-2'), false);
  assert.equal(pageSource.includes('const [selectedTextCardProviderPopoverOffset, setSelectedTextCardProviderPopoverOffset] = useState<{ left: number; top: number } | null>(null);'), true);
  assert.equal(pageSource.includes('const [selectedTextCardModelPopoverOffset, setSelectedTextCardModelPopoverOffset] = useState<{ left: number; top: number } | null>(null);'), true);
  assert.equal(pageSource.includes('textPanelProviderPopoverRef = useRef<HTMLDivElement | null>(null);'), true);
  assert.equal(pageSource.includes('textPanelModelPopoverRef = useRef<HTMLDivElement | null>(null);'), true);
  assert.equal(pageSource.includes('{showTextPanelProviderMenu && selectedTextCardProviderPopoverOffset && ('), true);
  assert.equal(pageSource.includes('{showTextPanelModelMenu && selectedTextCardModelPopoverOffset && ('), true);
  assert.equal(pageSource.includes('left: selectedTextCardPanelViewportOrigin.left + selectedTextCardProviderPopoverOffset.left * viewport.scale,'), true);
  assert.equal(pageSource.includes('left: selectedTextCardPanelViewportOrigin.left + selectedTextCardModelPopoverOffset.left * viewport.scale,'), true);
});

test('provider settings sidebar keeps Comfly and adds a create-provider action for user-managed entries', () => {
  assert.equal(pageSource.includes('增加供应商'), true);
  assert.equal(pageSource.includes('providerSettingsEditableProviderIds'), true);
  assert.equal(pageSource.includes('const createProviderSettingsDraftId = (providers: ProviderSettingsItem[]) => {'), true);
  assert.equal(pageSource.includes('const nextDraftProvider = createProviderSettingsDraftProvider(providerSettingsProviders);'), true);
  assert.equal(pageSource.includes('setProviderSettingsSelectedProviderId(nextDraftProvider.id);'), true);
  assert.equal(pageSource.includes('provider.name || provider.id || getProviderSettingsProviderLabel(provider.id)'), true);
  assert.equal(pageSource.includes("{ id: 'gpt-best', name: 'GPT-Best'"), true);
  assert.equal(pageSource.includes("{ id: 'custom', name: '自定义'"), true);
});

test('newly added providers keep an editable ID field while existing providers stay read-only', () => {
  assert.equal(pageSource.includes('const isSelectedProviderSettingsIdEditable = selectedProviderSettings'), true);
  assert.equal(pageSource.includes('providerSettingsEditableProviderIds.includes(selectedProviderSettings.id)'), true);
  assert.equal(pageSource.includes('disabled={!isSelectedProviderSettingsIdEditable}'), true);
  assert.equal(pageSource.includes("placeholder={isSelectedProviderSettingsIdEditable ? 'provider-id' : ''}"), true);
  assert.equal(pageSource.includes('setProviderSettingsEditableProviderIds((prev) => prev.map((providerId) => providerId === selectedProviderSettings.id ? nextId : providerId))'), true);
  assert.equal(pageSource.includes("const nextId = e.target.value.trim().toLowerCase().replace(/\\s+/g, '-');"), true);
});

test('provider settings sidebar shows a delete action for non-Comfly providers and removes them locally', () => {
  assert.equal(pageSource.includes('const handleProviderSettingsDeleteProvider = useCallback((providerId: ProviderSettingsProviderId) => {'), true);
  assert.equal(pageSource.includes("const isDeletable = provider.id !== 'comfly';"), true);
  assert.equal(pageSource.includes('{isDeletable && ('), true);
  assert.equal(pageSource.includes('aria-label={`删除供应商 ${provider.name || provider.id}`}' ), true);
  assert.equal(pageSource.includes("if (providerId === 'comfly') return;"), true);
  assert.equal(pageSource.includes('setProviderSettingsProviders((prev) => prev.filter((provider) => provider.id !== providerId));'), true);
  assert.equal(pageSource.includes('setProviderSettingsEditableProviderIds((prev) => prev.filter((id) => id !== providerId));'), true);
});

test('provider delete fallback resets selected provider state and clears provider picker transient state', () => {
  const deleteStart = pageSource.indexOf('const handleProviderSettingsDeleteProvider = useCallback((providerId: ProviderSettingsProviderId) => {');
  const deleteEnd = pageSource.indexOf('  const handleProviderSettingsSave = useCallback(async () => {', deleteStart);

  assert.notEqual(deleteStart, -1);
  assert.notEqual(deleteEnd, -1);
  assert.ok(deleteEnd > deleteStart);

  const deleteBlock = pageSource.slice(deleteStart, deleteEnd);

  assert.equal(deleteBlock.includes('setProviderSettingsSelectedProviderId(nextSelectedProvider?.id || \'comfly\');'), true);
  assert.equal(deleteBlock.includes('setProviderSettingsApiKey(nextSelectedProvider?.apiKey || \'\');'), true);
  assert.equal(deleteBlock.includes('setProviderSettingsError(null);'), true);
  assert.equal(deleteBlock.includes('setProviderSettingsTestResult(null);'), true);
  assert.equal(deleteBlock.includes('setProviderSettingsFetchedModels(null);'), true);
  assert.equal(deleteBlock.includes('setProviderSettingsModelPickerOpen(false);'), true);
  assert.equal(deleteBlock.includes('setProviderSettingsModelPickerCategory(\'all\');'), true);
  assert.equal(deleteBlock.includes('setProviderSettingsModelPickerSearch(\'\');'), true);
  assert.equal(deleteBlock.includes('setProviderSettingsSelectedFetchedModels({});'), true);
  assert.equal(deleteBlock.includes('setProviderSettingsFetchedModelCategoryById({});'), true);
});

test('provider delete rewrites image card provider model and size through existing fallback helpers', () => {
  const deleteStart = pageSource.indexOf('const handleProviderSettingsDeleteProvider = useCallback((providerId: ProviderSettingsProviderId) => {');
  const deleteEnd = pageSource.indexOf('  const handleProviderSettingsSave = useCallback(async () => {', deleteStart);

  assert.notEqual(deleteStart, -1);
  assert.notEqual(deleteEnd, -1);
  assert.ok(deleteEnd > deleteStart);

  const deleteBlock = pageSource.slice(deleteStart, deleteEnd);

  assert.equal(deleteBlock.includes('const remainingProviders = providerSettingsProviders.filter((provider) => provider.id !== providerId);'), true);
  assert.equal(deleteBlock.includes('const fallbackImageProviders = remainingProviders.filter((provider) => provider.enabled !== false && provider.imageModels.length > 0);'), true);
  assert.equal(deleteBlock.includes('const fallbackImageProvider = fallbackImageProviders[0] || null;'), true);
  assert.equal(deleteBlock.includes('const fallbackModel = fallbackImageProvider'), true);
  assert.equal(deleteBlock.includes('findWorkspaceModelOption(fallbackWorkspaceImageOptions, \'\', fallbackImageProvider.id)'), true);
  assert.equal(deleteBlock.includes('const fallbackModelId = resolveWorkspaceImageCardModel('), true);
  assert.equal(deleteBlock.includes('syncImageCardOptionsForProviderModel('), true);
  assert.equal(deleteBlock.includes('setImageCardProviderById((prev) => {'), true);
  assert.equal(deleteBlock.includes('setImageCardModelById((prev) => {'), true);
  assert.equal(deleteBlock.includes('setImageCardSizeById((prev) => {'), true);
  assert.equal(deleteBlock.includes('setImageCardAspectRatioById((prev) => {'), true);
  assert.equal(deleteBlock.includes('setImageCardQualityById((prev) => {'), true);
});

test('image card submit keeps resolution-tier UI state and lets request builders resolve the final exact size once', () => {
  assert.equal(pageSource.includes('size: selectedImageCardPanelSize,'), true);
  assert.equal(pageSource.includes('size: selectedImageCardPanelResolvedSize,'), false);
  assert.equal(pageSource.includes('const selectedImageCardPanelResolvedSize = selectedImageCardPanelItem'), false);
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

test('canvas paste centers the pasted clipboard items and preserves paste accounting', () => {
  const pasteStart = pageSource.indexOf('const handleCanvasPaste = useCallback(');
  const pasteEnd = pageSource.indexOf('  const handleChatImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {', pasteStart);

  assert.notEqual(pasteStart, -1);
  assert.notEqual(pasteEnd, -1);
  assert.ok(pasteEnd > pasteStart);

  const pasteBlock = pageSource.slice(pasteStart, pasteEnd);

  assert.equal(pasteBlock.includes('if (imageFiles.length > 0) {'), true);
  assert.equal(pasteBlock.includes('await uploadImageFilesToCanvas(imageFiles, \'pasted\');'), true);
  assert.equal(pasteBlock.includes('const pastedCanvasClipboard = materializeCanvasClipboardPaste({'), true);
  assert.equal(pasteBlock.includes('animateViewportTo(centerViewportOnPastedCanvasItems(viewportRef.current, pastedCanvasClipboard.items));'), true);
  assert.equal(pasteBlock.includes('canvasClipboardRef.current = {'), true);
  assert.equal(pasteBlock.includes('pasteCount: pastedCanvasClipboard.nextPasteCount,'), true);
});

test('canvas paste viewport centering uses requestAnimationFrame smoothing', () => {
  assert.equal(pageSource.includes('const CANVAS_VIEWPORT_PASTE_ANIMATION_MS = 240;'), true);
  assert.equal(pageSource.includes('const viewportAnimationFrameRef = useRef<number | null>(null);'), true);
  assert.equal(pageSource.includes('function animateViewportTo(nextViewport: { x: number; y: number; scale: number }) {'), true);
  assert.equal(pageSource.includes('viewportAnimationFrameRef.current = requestAnimationFrame(flushViewportAnimation);'), true);
  assert.equal(pageSource.includes('if (reducedMotionRef.current || hasNoMovement) {'), true);
  assert.equal(pageSource.includes('const cancelViewportAnimation = useCallback('), true);
});

test('left rail generated image history panel uses a wider layout than the original 320px menu', () => {
  assert.equal(pageSource.includes('w-[320px]'), false);
  assert.equal(pageSource.includes('w-[384px]'), true);
  assert.equal(pageSource.includes('className="min-w-0 flex-1"'), true);
});

test('image card generation controls render model parameter and count menus with a unified parameter popover', () => {
  assert.equal(pageSource.includes('const selectedImageCardSizeOptions = React.useMemo('), true);
  assert.equal(pageSource.includes('getSupportedImageCardSizeOptions('), true);
  assert.equal(pageSource.includes('selectedImageCardProviderId,'), true);
  assert.equal(pageSource.includes('providerImageOptionProfiles'), true);
  assert.equal(pageSource.includes('const selectableImageProviders = React.useMemo('), true);
  assert.equal(pageSource.includes("provider.imageModels.length > 0"), true);
  assert.equal(pageSource.includes('const IMAGE_CARD_QUALITY_OPTIONS = DEFAULT_IMAGE_CARD_QUALITY_OPTIONS;'), true);
  assert.equal(pageSource.includes('const selectedImageCardQualityOptions = React.useMemo(() => {'), true);
  assert.equal(pageSource.includes('getProviderModelQualityOptions('), true);
  assert.equal(pageSource.includes('const selectedImageCardAspectRatioOptions = React.useMemo('), true);
  assert.equal(pageSource.includes('const selectedImageCardEnabledAspectRatios = React.useMemo('), true);
  assert.equal(pageSource.includes('className="grid min-w-0 flex-1 grid-cols-[minmax(0,1.1fr)_minmax(0,1.2fr)_minmax(0,1.6fr)_minmax(0,1fr)] gap-2"'), true);
  assert.equal(pageSource.includes('<span className="workspace-text-muted text-[11px] font-medium">模型</span>'), false);
  assert.equal(pageSource.includes('<span className="workspace-text-muted text-[11px] font-medium">参数</span>'), false);
  assert.equal(pageSource.includes('<span className="workspace-text-muted text-[11px] font-medium">张数</span>'), false);
  assert.equal(pageSource.includes('{showImageCardProviderMenu && selectedImageCardProviderPopoverOffset && ('), true);
  assert.equal(pageSource.includes('ref={imageCardProviderMenuRef}'), true);
  assert.equal(pageSource.includes('ref={imageCardProviderPopoverRef}'), true);
  assert.equal(pageSource.includes('onToggleImageCardProviderMenu();'), true);
  assert.equal(pageSource.includes('{imageCardModelOptions.map((option) => {'), true);
  assert.equal(pageSource.includes('{showImageCardSettingsMenu && selectedImageCardSettingsPopoverOffset && ('), true);
  assert.equal(pageSource.includes('{showImageCardCountMenu && selectedImageCardCountPopoverOffset && ('), false);
  assert.equal(pageSource.includes('ref={imageCardSettingsMenuRef}'), true);
  assert.equal(pageSource.includes('ref={imageCardSettingsPopoverRef}'), true);
  assert.equal(pageSource.includes('onToggleImageCardSettingsMenu();'), true);
  assert.equal(pageSource.includes('width: 292,'), true);
  assert.equal(pageSource.includes('className="workspace-panel-input inline-flex w-full items-center rounded-[14px] p-1"'), true);
  assert.equal(pageSource.includes('className="grid grid-cols-4 gap-1.5"'), true);
  assert.equal(pageSource.includes("workspace-control-chip flex min-h-[58px] flex-col items-center justify-center gap-1.5 rounded-[14px] px-1.5 py-2 text-center"), true);
  assert.equal(pageSource.includes("isSelected ? 'is-active' : ''"), true);
  assert.equal(
    pageSource.includes('{`${getImageCardAspectRatioShortLabel(selectedImageCardPanelAspectRatio)} · ${selectedImageCardSizeOptions.find((item) => item.id === selectedImageCardPanelSize)?.label || selectedImageCardPanelSize} · ${getImageCardQualityLabel(selectedImageCardPanelQuality)}`}'),
    true
  );
  assert.equal(pageSource.includes('value={selectedImageCardCountInput}'), true);
  assert.equal(pageSource.includes('IMAGE_CARD_COUNT_OPTIONS.find((item) => item.id === selectedImageCardPanelCount)?.label || `X${selectedImageCardPanelCount}`'), false);
  assert.equal(pageSource.includes('const getAspectRatioFromImageSize = (sizeId: string): string =>'), false);
  assert.equal(pageSource.includes('const selectedImageCardResolutionStatus = React.useMemo('), false);
  assert.equal(pageSource.includes('实际尺寸'), false);
  assert.equal(pageSource.includes('selectedImageCardResolutionStatus.warning'), false);
  assert.equal(pageSource.includes('selectedImageCardAspectRatioOptions.map((aspectRatioId) => {'), true);
  assert.equal(pageSource.includes('selectedImageCardQualityOptions.map((option) => {'), true);
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
  assert.equal(pageSource.includes('getItemVisualBounds(selectedImageToolbarItem)'), false);
  assert.equal(pageSource.includes('left: selectedImageToolbarItem.x,'), true);
  assert.equal(pageSource.includes('y: itemBounds.top - canvasGap,'), true);
  assert.equal(pageSource.includes('width: selectedImageToolbarItem.width,'), true);
  assert.equal(pageSource.includes('height: selectedImageToolbarItem.height,'), true);
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

test('image toolbar scales with the current viewport zoom', () => {
  assert.equal(pageSource.includes('top: selectedImageToolbarTop,'), true);
  assert.equal(pageSource.includes("transform: 'translate(-50%, -100%)'"), true);
  assert.equal(pageSource.includes('transform: `scale(${viewport.scale})`'), true);
  assert.equal(pageSource.includes("transformOrigin: 'bottom center'"), true);
  assert.equal(pageSource.includes('top: selectedImageToolbarTop - 12,'), false);
  assert.equal(pageSource.includes('canvasGap: 12,'), true);
  assert.equal(pageSource.includes('transform: `translate(-50%, -100%) scale(${viewport.scale})`'), false);
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

test('selected image card panel keeps a fixed 720px canvas width', () => {
  assert.equal(
    pageSource.includes('const IMAGE_CARD_GENERATION_PANEL_DEFAULT_WIDTH = 720;'),
    true
  );
  assert.equal(
    pageSource.includes('const selectedImageCardPanelCanvasWidth = IMAGE_CARD_GENERATION_PANEL_DEFAULT_WIDTH;'),
    true
  );
  assert.equal(
    pageSource.includes('? Math.max(IMAGE_CARD_GENERATION_PANEL_DEFAULT_WIDTH, selectedImageCardPanelFrameBounds.width)'),
    false
  );
});

test('selected text card panel keeps a 720px minimum canvas width so bottom controls stay on one row', () => {
  assert.equal(
    pageSource.includes('const TEXT_CARD_GENERATION_PANEL_DEFAULT_WIDTH = 720;'),
    true
  );
  assert.equal(
    pageSource.includes('? Math.max(TEXT_CARD_GENERATION_PANEL_DEFAULT_WIDTH, selectedTextCardPanelFrameBounds.width)'),
    true
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

test('pending connection create menu scales with viewport zoom instead of staying at a fixed screen size', () => {
  assert.equal(pageSource.includes('const scaledConnectionMenuWidth = connectionMenuWidth * viewport.scale;'), true);
  assert.equal(pageSource.includes('const scaledConnectionMenuHeight = connectionMenuHeight * viewport.scale;'), true);
  assert.equal(pageSource.includes('left: pendingMenuLeft,'), true);
  assert.equal(pageSource.includes('top: pendingMenuTop,'), true);
  assert.equal(pageSource.includes('transform: `scale(${viewport.scale})`,'), true);
  assert.equal(pageSource.includes("transformOrigin: 'top left',"), true);
});

test('image nodes are not excluded from corner-resize handles or resize interaction logic', () => {
  assert.equal(pageSource.includes("const showCornerResizeHandle = isHoveredItem && item.type !== 'image';"), false);
  assert.equal(pageSource.includes("if (item.type === 'image') return;"), false);
  assert.equal(pageSource.includes("if (!resizingItem || resizingItem.type === 'image') {"), false);
  assert.equal(pageSource.includes('const showCornerResizeHandle = isHoveredItem;'), true);
});

test('image card aspect ratio selection still routes through resizeImageCardItemToAspectRatio', () => {
  assert.equal(pageSource.includes('? resizeImageCardItemToAspectRatio(item, normalizedAspectRatio)'), true);
});

test('image card resolution selection re-syncs aspect ratio and quality without closing the grouped menu', () => {
  const sizeSelectStart = pageSource.indexOf('onSelectImageCardSize={(sizeId) => {');
  const sizeSelectEnd = pageSource.indexOf('        onSelectImageCardQuality={(qualityId) => {', sizeSelectStart);

  assert.notEqual(sizeSelectStart, -1);
  assert.notEqual(sizeSelectEnd, -1);
  assert.ok(sizeSelectEnd > sizeSelectStart);

  const sizeSelectBlock = pageSource.slice(sizeSelectStart, sizeSelectEnd);

  assert.equal(sizeSelectBlock.includes('const syncedOptions = syncImageCardOptionsForProviderModel('), true);
  assert.equal(pageSource.includes('[selectedImageCardPanelItem.id]: resolvedSizeId,'), true);
  assert.equal(sizeSelectBlock.includes('setImageCardAspectRatioById((prev) => ({'), true);
  assert.equal(sizeSelectBlock.includes('setImageCardQualityById((prev) => ({'), true);
  assert.equal(sizeSelectBlock.includes('setShowImageCardSettingsMenu(false);'), false);
  assert.equal(pageSource.includes('setShowImageCardResolutionMenu(false);'), false);
});

test('image card count updates are clamped to the 1 through 9 stepper range', () => {
  const countSelectStart = pageSource.indexOf('onSelectImageCardCount={(count) => {');
  const countSelectEnd = pageSource.indexOf('        onSelectImageCardAspectRatio={(aspectRatioId) => {', countSelectStart);

  assert.notEqual(countSelectStart, -1);
  assert.notEqual(countSelectEnd, -1);
  assert.ok(countSelectEnd > countSelectStart);

  const countSelectBlock = pageSource.slice(countSelectStart, countSelectEnd);

  assert.equal(countSelectBlock.includes('const nextCount = clampImageCardCount(count);'), true);
  assert.equal(countSelectBlock.includes('[selectedImageCardPanelItem.id]: nextCount,'), true);
  assert.equal(countSelectBlock.includes('setShowImageCardCountMenu(false);'), false);
});

test('image card unified parameter menu stays open for grouped selections and closes on outside click', () => {
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

  assert.equal(sizeSelectBlock.includes('setShowImageCardSettingsMenu(false);'), false);
  assert.equal(aspectSelectBlock.includes('setShowImageCardSettingsMenu(false);'), false);
  assert.equal(pageSource.includes('const isInsideImageCardSettingsMenu ='), true);
  assert.equal(pageSource.includes('if (!isInsideImageCardSettingsMenu) {\n        setShowImageCardSettingsMenu(false);\n      }'), true);
});

test('image card provider menu closes on outside click and stays separate from model and parameter menus', () => {
  assert.equal(pageSource.includes('const isInsideImageCardProviderMenu ='), true);
  assert.equal(pageSource.includes('if (!isInsideImageCardProviderMenu) {\n        setShowImageCardProviderMenu(false);\n      }'), true);
  assert.equal(pageSource.includes('setShowImageCardProviderMenu(false);'), true);
});

test('image card provider selection updates provider and re-syncs model size aspect ratio and quality through provider rules', () => {
  const providerSelectStart = pageSource.indexOf('onSelectImageCardProvider={(providerId) => {');
  const providerSelectEnd = pageSource.indexOf('        onToggleImageCardModelMenu={() => {', providerSelectStart);

  assert.notEqual(providerSelectStart, -1);
  assert.notEqual(providerSelectEnd, -1);
  assert.ok(providerSelectEnd > providerSelectStart);

  const providerSelectBlock = pageSource.slice(providerSelectStart, providerSelectEnd);

  assert.equal(providerSelectBlock.includes('const nextProvider = selectableImageProviders.find((provider) => provider.id === providerId);'), true);
  assert.equal(providerSelectBlock.includes('const nextModel = findWorkspaceModelOption(workspaceImageModelOptions, \'\', providerId);'), true);
  assert.equal(providerSelectBlock.includes('const resolvedModelId = resolveWorkspaceImageCardModel('), true);
  assert.equal(providerSelectBlock.includes('const syncedOptions = syncImageCardOptionsForProviderModel('), true);
  assert.equal(providerSelectBlock.includes('[selectedImageCardPanelItem.id]: providerId,'), true);
  assert.equal(providerSelectBlock.includes('[selectedImageCardPanelItem.id]: resolvedModelId,'), true);
  assert.equal(providerSelectBlock.includes('[selectedImageCardPanelItem.id]: resolvedSizeId,'), true);
  assert.equal(providerSelectBlock.includes('setImageCardAspectRatioById((prev) => ({'), true);
  assert.equal(providerSelectBlock.includes('setImageCardQualityById((prev) => ({'), true);
});

test('image card model selection stays scoped to the current provider model list', () => {
  const modelSelectStart = pageSource.indexOf('onSelectImageCardModel={(modelId) => {');
  const modelSelectEnd = pageSource.indexOf('        onToggleImageCardSettingsMenu={() => {', modelSelectStart);

  assert.notEqual(modelSelectStart, -1);
  assert.notEqual(modelSelectEnd, -1);
  assert.ok(modelSelectEnd > modelSelectStart);

  const modelSelectBlock = pageSource.slice(modelSelectStart, modelSelectEnd);

  assert.equal(modelSelectBlock.includes('const nextModel = findWorkspaceModelOption(selectedImageCardProviderModelOptions, modelId, selectedImageCardProviderId);'), true);
  assert.equal(modelSelectBlock.includes('selectedImageCardProviderModelOptions.map((option) => option.id)'), true);
  assert.equal(modelSelectBlock.includes('findWorkspaceModelOption(workspaceImageModelOptions, modelId, selectedImageCardProviderId);'), false);
});

test('image card generation always uses async task requests instead of keeping a single-image sync branch', () => {
  assert.equal(pageSource.includes('if (count <= 1) {'), false);
  assert.equal(pageSource.includes('buildCanvasImageGenerationRequest({'), false);
  assert.equal(pageSource.includes('const asyncRequests = buildAsyncImageTaskRequests({'), true);
  assert.equal(pageSource.includes('const taskExecutionMode = resolveCanvasImageTaskExecutionMode({'), true);
  assert.equal(pageSource.includes('settleCanvasImageGenerationRequests({'), true);
});

test('image card generation no longer treats accepted outputs as validation failures', () => {
  const generateStart = pageSource.indexOf('const handleCanvasImageGenerate = useCallback(');
  const generateEnd = pageSource.indexOf('const handleCancelCanvasImageGenerate = useCallback(', generateStart);

  assert.notEqual(generateStart, -1);
  assert.notEqual(generateEnd, -1);
  assert.ok(generateEnd > generateStart);

  const generateBlock = pageSource.slice(generateStart, generateEnd);

  assert.equal(generateBlock.includes('getImageCardResolutionStatus({'), false);
  assert.equal(generateBlock.includes('acceptedOutputs: outputMetas'), true);
  assert.equal(generateBlock.includes('appendImageCardOutput({'), true);
  assert.equal(generateBlock.includes('const validationFailureCount ='), false);
  assert.equal(generateBlock.includes('const firstValidationFailureReason ='), false);
  assert.equal(generateBlock.includes('failedCount = requestFailureCount + validationFailureCount'), false);
  assert.equal(generateBlock.includes('warningCount: 0'), true);
  assert.equal(generateBlock.includes('未达标已丢弃'), false);
  assert.equal(generateBlock.includes('返回图未达到'), false);
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
  assert.equal(pageSource.includes('validationFailureCount,'), false);
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
  assert.equal(pageSource.includes("className=\"workspace-floating-control fixed right-4 top-4 isolate"), true);
  assert.equal(pageSource.includes("className=\"workspace-chat-panel fixed inset-y-4 left-4 right-4 isolate"), true);
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
