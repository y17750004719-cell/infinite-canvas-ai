import {
  extractGeneratedImageTimestampFromFilename,
  mergeGeneratedImageHistoryEntries,
  normalizeGeneratedImageHistory,
} from './generated-image-history.mjs';
import {
  getImageModelCapability,
  getImageSizeLabel,
  getSupportedImageSizeOptions,
  resolveSupportedImageSize,
} from './image-model-capabilities.mjs';

const DEFAULT_VIEWPORT = { x: 0, y: 0, scale: 1 };
export const CANVAS_TEXT_GENERATION_CONCURRENCY_LIMIT = 5;

export const TEXT_PANEL_MODEL_OPTIONS = [
  {
    id: 'gemini-3.1-flash-lite-preview-thinking-medium',
    label: 'Gemini 3.1 Flash Lite',
  },
];

export const IMAGE_CARD_MODEL_OPTIONS = [
  {
    id: 'gemini-3.1-flash-image-preview',
    label: 'Gemini 3.1 Flash Image',
  },
  {
    id: 'gpt-image-2',
    label: 'GPT Image 2',
  },
  {
    id: 'gemini-2.5-flash-image',
    label: 'Gemini 2.5 Flash Image',
  },
  {
    id: 'gemini-3-pro-image-preview',
    label: 'Gemini 3 Pro Image',
  },
];

export const IMAGE_CARD_SIZE_OPTIONS = getSupportedImageSizeOptions(IMAGE_CARD_MODEL_OPTIONS[0]?.id);
const CANVAS_BACKGROUND_BASE_DOT_GAP = 20;
const CANVAS_BACKGROUND_MIN_DOT_GAP = 14;

export function getDefaultTextPanelModelOption() {
  return TEXT_PANEL_MODEL_OPTIONS[0];
}

export function getDefaultImageCardModelOption() {
  return IMAGE_CARD_MODEL_OPTIONS[0];
}

export function getSessionConversationCount(session) {
  const topics = Array.isArray(session?.topics) ? session.topics : [];
  if (topics.length > 0) {
    return topics.reduce(
      (total, topic) => total + (Array.isArray(topic?.messages) ? topic.messages.length : 0),
      0
    );
  }

  return Array.isArray(session?.messages) ? session.messages.length : 0;
}

export function resolveTextPanelChatModel(requestedModel, fallbackModel = getDefaultTextPanelModelOption()?.id) {
  const normalizedRequestedModel = typeof requestedModel === 'string' ? requestedModel.trim() : '';
  const allowedModelIds = new Set(TEXT_PANEL_MODEL_OPTIONS.map((option) => option.id));

  if (normalizedRequestedModel && allowedModelIds.has(normalizedRequestedModel)) {
    return normalizedRequestedModel;
  }

  return fallbackModel;
}

export function resolveImageCardModel(requestedModel, fallbackModel = getDefaultImageCardModelOption()?.id) {
  const normalizedRequestedModel = typeof requestedModel === 'string' ? requestedModel.trim() : '';
  const allowedModelIds = new Set(IMAGE_CARD_MODEL_OPTIONS.map((option) => option.id));

  if (normalizedRequestedModel && allowedModelIds.has(normalizedRequestedModel)) {
    return normalizedRequestedModel;
  }

  return fallbackModel;
}

export function getSupportedImageCardSizeOptions(modelId, fallbackModel = getDefaultImageCardModelOption()?.id) {
  return getSupportedImageSizeOptions(resolveImageCardModel(modelId, fallbackModel));
}

export function resolveImageCardSize(modelId, requestedSize, fallbackSize = IMAGE_CARD_SIZE_OPTIONS[0]?.id) {
  return resolveSupportedImageSize(resolveImageCardModel(modelId), requestedSize, fallbackSize);
}

export function normalizeImageCardAspectRatio(value, fallbackValue = '1:1') {
  const normalizedValue = typeof value === 'string' ? value.trim() : '';

  if (!normalizedValue || normalizedValue === 'auto') {
    return fallbackValue;
  }

  return normalizedValue;
}

function parseAspectRatioParts(value) {
  const normalizedAspectRatio = normalizeImageCardAspectRatio(value);
  const match = normalizedAspectRatio.match(/^(\d+):(\d+)$/);
  if (!match) {
    return null;
  }

  const widthRatio = Number(match[1]);
  const heightRatio = Number(match[2]);
  if (!Number.isFinite(widthRatio) || !Number.isFinite(heightRatio) || widthRatio <= 0 || heightRatio <= 0) {
    return null;
  }

  return {
    widthRatio,
    heightRatio,
  };
}

const RESOLUTION_TIER_MIN_EDGE = {
  '1K': 1024,
  '2K': 2048,
  '4K': 4096,
};
const IMAGE_CARD_ASPECT_RATIO_TOLERANCE = 0.03;
const IMAGE_CARD_FRAME_MIN_EDGE = 384;

export function getImageCardFrameSizeForAspectRatio(aspectRatio, minEdge = IMAGE_CARD_FRAME_MIN_EDGE) {
  const safeMinEdge = Number.isFinite(minEdge) && minEdge > 0 ? minEdge : IMAGE_CARD_FRAME_MIN_EDGE;
  const parts = parseAspectRatioParts(aspectRatio);

  if (!parts) {
    return {
      width: safeMinEdge,
      height: safeMinEdge,
    };
  }

  if (parts.widthRatio >= parts.heightRatio) {
    return {
      width: safeMinEdge * (parts.widthRatio / parts.heightRatio),
      height: safeMinEdge,
    };
  }

  return {
    width: safeMinEdge,
    height: safeMinEdge * (parts.heightRatio / parts.widthRatio),
  };
}

export function getImageCardItemSizeForFrameSize(
  frameWidth,
  frameHeight,
  {
    frameInsetX = 16,
    frameTopInset = 24,
    frameBottomInset = 12,
  } = {}
) {
  const safeFrameWidth = Number.isFinite(frameWidth) && frameWidth > 0 ? frameWidth : IMAGE_CARD_FRAME_MIN_EDGE;
  const safeFrameHeight = Number.isFinite(frameHeight) && frameHeight > 0 ? frameHeight : safeFrameWidth;
  const safeInsetX = Number.isFinite(frameInsetX) ? frameInsetX : 16;
  const safeFrameTopInset = Number.isFinite(frameTopInset) ? frameTopInset : 24;
  const safeFrameBottomInset = Number.isFinite(frameBottomInset) ? frameBottomInset : 12;

  return {
    width: safeFrameWidth + safeInsetX * 2,
    height: safeFrameHeight + safeFrameTopInset + safeFrameBottomInset,
  };
}

export function getImageCardItemSizeForNaturalImage(
  naturalWidth,
  naturalHeight,
  minEdge = IMAGE_CARD_FRAME_MIN_EDGE,
  insets
) {
  const safeMinEdge = Number.isFinite(minEdge) && minEdge > 0 ? minEdge : IMAGE_CARD_FRAME_MIN_EDGE;
  const safeNaturalWidth = Number.isFinite(naturalWidth) && naturalWidth > 0 ? naturalWidth : safeMinEdge;
  const safeNaturalHeight = Number.isFinite(naturalHeight) && naturalHeight > 0 ? naturalHeight : safeMinEdge;
  const shortestEdge = Math.min(safeNaturalWidth, safeNaturalHeight);
  const scale = shortestEdge > 0 ? safeMinEdge / shortestEdge : 1;

  return getImageCardItemSizeForFrameSize(
    safeNaturalWidth * scale,
    safeNaturalHeight * scale,
    insets
  );
}

export function getImageCardQualitySummary({ modelId, aspectRatio, size, quality }) {
  const capability = getImageModelCapability(modelId);
  const normalizedAspectRatio = normalizeImageCardAspectRatio(aspectRatio);
  const normalizedSize = typeof size === 'string' ? size.trim() : '';
  const sizeLabel = getImageSizeLabel(modelId, normalizedSize);
  const normalizedQuality = typeof quality === 'string' ? quality.trim() : '';

  if (!capability.supportsAspectRatio) {
    let presetLabel = sizeLabel;
    if (normalizedSize === '1024x1024') presetLabel = '方图';
    if (normalizedSize === '1536x1024') presetLabel = '横图';
    if (normalizedSize === '1024x1536') presetLabel = '竖图';
    if (normalizedQuality) {
      return `${presetLabel} · ${normalizedQuality}`;
    }
    return presetLabel;
  }
  return `${normalizedAspectRatio} · ${sizeLabel}`;
}

export function resolveRequestedResolutionTier(size) {
  const normalizedSize = typeof size === 'string' ? size.trim() : '';
  const match = normalizedSize.match(/^(\d+)x(\d+)$/i);
  if (!match) {
    return '1K';
  }

  const width = Number(match[1]);
  const height = Number(match[2]);
  const longestEdge = Math.max(width, height);

  if (longestEdge >= RESOLUTION_TIER_MIN_EDGE['4K']) {
    return '4K';
  }
  if (longestEdge >= RESOLUTION_TIER_MIN_EDGE['2K']) {
    return '2K';
  }
  return '1K';
}

function doesOutputMatchRequestedAspectRatio(aspectRatio, naturalWidth, naturalHeight) {
  const safeNaturalWidth = Number.isFinite(naturalWidth) ? naturalWidth : 0;
  const safeNaturalHeight = Number.isFinite(naturalHeight) ? naturalHeight : 0;
  if (safeNaturalWidth <= 0 || safeNaturalHeight <= 0) {
    return false;
  }

  const normalizedAspectRatio = normalizeImageCardAspectRatio(aspectRatio);
  if (normalizedAspectRatio === '1:1') {
    return true;
  }

  const parts = parseAspectRatioParts(normalizedAspectRatio);
  if (!parts) {
    return true;
  }

  const requestedRatio = parts.widthRatio / parts.heightRatio;
  const actualRatio = safeNaturalWidth / safeNaturalHeight;
  return Math.abs(actualRatio - requestedRatio) / requestedRatio <= IMAGE_CARD_ASPECT_RATIO_TOLERANCE;
}

export function isOutputResolutionSufficient({
  requestedSize,
  aspectRatio,
  naturalWidth,
  naturalHeight,
}) {
  const safeNaturalWidth = Number.isFinite(naturalWidth) ? naturalWidth : 0;
  const safeNaturalHeight = Number.isFinite(naturalHeight) ? naturalHeight : 0;
  if (safeNaturalWidth <= 0 || safeNaturalHeight <= 0) {
    return false;
  }

  const resolutionTier = resolveRequestedResolutionTier(requestedSize);
  const minimumEdge = RESOLUTION_TIER_MIN_EDGE[resolutionTier] || RESOLUTION_TIER_MIN_EDGE['1K'];
  const normalizedAspectRatio = normalizeImageCardAspectRatio(aspectRatio);

  if (normalizedAspectRatio === '1:1') {
    return safeNaturalWidth >= minimumEdge && safeNaturalHeight >= minimumEdge;
  }

  return (
    Math.max(safeNaturalWidth, safeNaturalHeight) >= minimumEdge &&
    doesOutputMatchRequestedAspectRatio(normalizedAspectRatio, safeNaturalWidth, safeNaturalHeight)
  );
}

export function getResolutionFailureReason({
  requestedSize,
  aspectRatio,
  naturalWidth,
  naturalHeight,
}) {
  const resolutionTier = resolveRequestedResolutionTier(requestedSize);
  const minimumEdge = RESOLUTION_TIER_MIN_EDGE[resolutionTier] || RESOLUTION_TIER_MIN_EDGE['1K'];
  const safeNaturalWidth = Number.isFinite(naturalWidth) ? naturalWidth : 0;
  const safeNaturalHeight = Number.isFinite(naturalHeight) ? naturalHeight : 0;
  const normalizedAspectRatio = normalizeImageCardAspectRatio(aspectRatio);

  if (safeNaturalWidth <= 0 || safeNaturalHeight <= 0) {
    return `返回图未达到 ${resolutionTier} 分辨率要求`;
  }

  if (normalizedAspectRatio === '1:1') {
    if (safeNaturalWidth < minimumEdge || safeNaturalHeight < minimumEdge) {
      return `返回图未达到 ${resolutionTier} 分辨率要求`;
    }
    return null;
  }

  if (Math.max(safeNaturalWidth, safeNaturalHeight) < minimumEdge) {
    return `返回图未达到 ${resolutionTier} 分辨率要求`;
  }

  if (!doesOutputMatchRequestedAspectRatio(normalizedAspectRatio, safeNaturalWidth, safeNaturalHeight)) {
    return `返回图宽高比与请求的 ${normalizedAspectRatio} 不匹配`;
  }

  return null;
}

export function getImageCardResolutionStatus({
  requestedSize,
  aspectRatio,
  naturalWidth,
  naturalHeight,
}) {
  const safeNaturalWidth = Number.isFinite(naturalWidth) ? Math.floor(naturalWidth) : 0;
  const safeNaturalHeight = Number.isFinite(naturalHeight) ? Math.floor(naturalHeight) : 0;
  if (safeNaturalWidth <= 0 || safeNaturalHeight <= 0) {
    return null;
  }

  const actualLabel = `${safeNaturalWidth}×${safeNaturalHeight}`;
  const meetsRequestedResolution = isOutputResolutionSufficient({
    requestedSize,
    aspectRatio,
    naturalWidth: safeNaturalWidth,
    naturalHeight: safeNaturalHeight,
  });

  if (meetsRequestedResolution) {
    return {
      actualLabel,
      warning: null,
      meetsRequestedResolution: true,
    };
  }

  const resolutionTier = resolveRequestedResolutionTier(requestedSize);
  const failureReason = getResolutionFailureReason({
    requestedSize,
    aspectRatio,
    naturalWidth: safeNaturalWidth,
    naturalHeight: safeNaturalHeight,
  });

  return {
    actualLabel,
    warning:
      failureReason && failureReason.includes('宽高比')
        ? `实际返回 ${actualLabel}，${failureReason}`
        : `实际返回 ${actualLabel}，未达到目标 ${resolutionTier}`,
    meetsRequestedResolution: false,
  };
}

export function resolveImageGenerationFallbackSizes(requestedSize) {
  const normalizedSize = typeof requestedSize === 'string' ? requestedSize.trim() : '';

  if (normalizedSize === '4096x4096') {
    return ['4096x4096', '2048x2048', '1024x1024'];
  }

  if (normalizedSize === '2048x2048') {
    return ['2048x2048', '1024x1024'];
  }

  if (normalizedSize) {
    return [normalizedSize];
  }

  return ['2048x2048', '1024x1024'];
}

export function finalizeManualTextCardItem(item) {
  if (!item || item.type !== 'text' || item.textVariant !== 'card' || item.textMode !== 'manual') {
    return item;
  }

  const trimmedText = typeof item.text === 'string' ? item.text.trim() : '';
  if (trimmedText.length === 0) {
    return {
      ...item,
      text: '',
      textMode: 'ai',
    };
  }

  return {
    ...item,
    textMode: 'manual',
  };
}

export function resolveCanvasBackgroundDotGap(
  scale,
  {
    baseGap = CANVAS_BACKGROUND_BASE_DOT_GAP,
    minimumGap = CANVAS_BACKGROUND_MIN_DOT_GAP,
  } = {}
) {
  const safeScale = Number.isFinite(scale) && scale > 0 ? scale : 1;
  const safeBaseGap = Number.isFinite(baseGap) && baseGap > 0 ? baseGap : CANVAS_BACKGROUND_BASE_DOT_GAP;
  const safeMinimumGap = Number.isFinite(minimumGap) && minimumGap > 0
    ? Math.min(minimumGap, safeBaseGap)
    : Math.min(CANVAS_BACKGROUND_MIN_DOT_GAP, safeBaseGap);

  return Math.max(safeMinimumGap, safeBaseGap * safeScale);
}

export function isImageCardItem(item) {
  return !!item && item.type === 'image' && item.imageVariant === 'card';
}

export function isImageAssetItem(item) {
  return !!item && item.type === 'image' && !isImageCardItem(item) && typeof item.src === 'string' && item.src.length > 0;
}

export function moveCanvasItemsToFront(items, selectedIds) {
  if (!Array.isArray(items) || items.length === 0) {
    return Array.isArray(items) ? items : [];
  }

  const normalizedSelectedIds = Array.isArray(selectedIds)
    ? selectedIds.filter((id) => typeof id === 'string' && id.length > 0)
    : [];
  if (normalizedSelectedIds.length === 0) {
    return items;
  }

  const selectedIdSet = new Set(normalizedSelectedIds);
  const remainingItems = [];
  const selectedItems = [];

  for (const item of items) {
    if (selectedIdSet.has(item?.id)) {
      selectedItems.push(item);
    } else {
      remainingItems.push(item);
    }
  }

  if (selectedItems.length === 0) {
    return items;
  }

  return [...remainingItems, ...selectedItems];
}

export function getSelectedImageToolbarSource({
  selectedId,
  selectedIds,
  itemById,
}) {
  if (!selectedId || !Array.isArray(selectedIds) || selectedIds.length !== 1) {
    return null;
  }

  const item = itemById?.[selectedId];
  if (isImageAssetItem(item)) {
    return {
      itemId: item.id,
      src: item.src,
      kind: 'asset',
    };
  }

  const currentOutput = getCurrentImageCardOutput(item);
  if (isImageCardItem(item) && currentOutput?.src) {
    return {
      itemId: item.id,
      src: currentOutput.src,
      kind: 'card',
    };
  }

  return null;
}

export function getImageToolResultSpawnPosition({
  sourceItem,
  nextSize,
  gap = 48,
  verticalOffset = 24,
}) {
  const safeSourceX = Number.isFinite(sourceItem?.x) ? sourceItem.x : 0;
  const safeSourceY = Number.isFinite(sourceItem?.y) ? sourceItem.y : 0;
  const safeSourceWidth = Number.isFinite(sourceItem?.width) ? sourceItem.width : 0;
  const safeSourceHeight = Number.isFinite(sourceItem?.height) ? sourceItem.height : 0;
  const safeNextWidth = Number.isFinite(nextSize?.width) ? nextSize.width : 0;
  const safeNextHeight = Number.isFinite(nextSize?.height) ? nextSize.height : 0;

  return {
    x: safeSourceX + safeSourceWidth + gap,
    y: safeSourceY + (safeSourceHeight - safeNextHeight) / 2 + verticalOffset,
  };
}

export function extractImageFilesFromClipboardItems(items) {
  return Array.from(items || [])
    .filter((item) => item && typeof item.type === 'string' && item.type.startsWith('image/'))
    .map((item) => (typeof item.getAsFile === 'function' ? item.getAsFile() : null))
    .filter((file) => file !== null);
}

function cloneClipboardValue(value) {
  if (typeof globalThis.structuredClone === 'function') {
    return globalThis.structuredClone(value);
  }

  return JSON.parse(JSON.stringify(value));
}

function pickClipboardStateByIds(source, idMap) {
  if (!source || typeof source !== 'object' || idMap.size === 0) {
    return {};
  }

  const next = {};
  for (const [sourceId, nextId] of idMap.entries()) {
    if (!Object.prototype.hasOwnProperty.call(source, sourceId)) continue;
    next[nextId] = cloneClipboardValue(source[sourceId]);
  }
  return next;
}

export function createCanvasClipboardSnapshot({
  items,
  selectedIds,
  textCardPanelDrafts = {},
  imageCardPanelDrafts = {},
  imageCardModelById = {},
  imageCardSizeById = {},
  imageCardQualityById = {},
  imageCardCountById = {},
  imageCardAspectRatioById = {},
}) {
  const normalizedSelectedIds = Array.isArray(selectedIds)
    ? selectedIds.filter((id) => typeof id === 'string' && id.length > 0)
    : [];
  if (!Array.isArray(items) || items.length === 0 || normalizedSelectedIds.length === 0) {
    return null;
  }

  const selectedIdSet = new Set(normalizedSelectedIds);
  const selectedItems = items.filter((item) => selectedIdSet.has(item?.id));
  if (selectedItems.length === 0) {
    return null;
  }

  const idMap = new Map(selectedItems.map((item) => [item.id, item.id]));

  const bounds = selectedItems.reduce(
    (acc, item) => {
      const left = Number.isFinite(item?.x) ? item.x : 0;
      const top = Number.isFinite(item?.y) ? item.y : 0;
      const width = Number.isFinite(item?.width) ? item.width : 0;
      const height = Number.isFinite(item?.height) ? item.height : 0;

      return {
        left: Math.min(acc.left, left),
        top: Math.min(acc.top, top),
        right: Math.max(acc.right, left + width),
        bottom: Math.max(acc.bottom, top + height),
      };
    },
    {
      left: Number.POSITIVE_INFINITY,
      top: Number.POSITIVE_INFINITY,
      right: Number.NEGATIVE_INFINITY,
      bottom: Number.NEGATIVE_INFINITY,
    }
  );

  return {
    items: cloneClipboardValue(selectedItems),
    bounds,
    textCardPanelDrafts: pickClipboardStateByIds(textCardPanelDrafts, idMap),
    imageCardPanelDrafts: pickClipboardStateByIds(imageCardPanelDrafts, idMap),
    imageCardModelById: pickClipboardStateByIds(imageCardModelById, idMap),
    imageCardSizeById: pickClipboardStateByIds(imageCardSizeById, idMap),
    imageCardQualityById: pickClipboardStateByIds(imageCardQualityById, idMap),
    imageCardCountById: pickClipboardStateByIds(imageCardCountById, idMap),
    imageCardAspectRatioById: pickClipboardStateByIds(imageCardAspectRatioById, idMap),
  };
}

export function materializeCanvasClipboardPaste({
  clipboard,
  pasteCount = 0,
  offsetStep = { x: 32, y: 32 },
  createId = (sourceId, index) => `${sourceId}-copy-${index + 1}`,
}) {
  const sourceItems = Array.isArray(clipboard?.items) ? clipboard.items : [];
  if (sourceItems.length === 0) {
    return null;
  }

  const safePasteCount = Number.isFinite(pasteCount) && pasteCount >= 0 ? Math.floor(pasteCount) : 0;
  const offsetX = (Number.isFinite(offsetStep?.x) ? offsetStep.x : 0) * (safePasteCount + 1);
  const offsetY = (Number.isFinite(offsetStep?.y) ? offsetStep.y : 0) * (safePasteCount + 1);

  const remappedIds = new Map();
  const nextItems = sourceItems.map((item, index) => {
    const sourceId = typeof item?.id === 'string' && item.id.length > 0 ? item.id : `clipboard-item-${index + 1}`;
    const proposedId = createId(sourceId, index);
    const nextId =
      typeof proposedId === 'string' && proposedId.length > 0 ? proposedId : `${sourceId}-copy-${index + 1}`;
    remappedIds.set(sourceId, nextId);

    const nextItem = cloneClipboardValue(item);
    nextItem.id = nextId;
    nextItem.x = (Number.isFinite(nextItem.x) ? nextItem.x : 0) + offsetX;
    nextItem.y = (Number.isFinite(nextItem.y) ? nextItem.y : 0) + offsetY;
    return nextItem;
  });

  return {
    items: nextItems,
    selectedIds: nextItems.map((item) => item.id),
    textCardPanelDrafts: pickClipboardStateByIds(clipboard?.textCardPanelDrafts, remappedIds),
    imageCardPanelDrafts: pickClipboardStateByIds(clipboard?.imageCardPanelDrafts, remappedIds),
    imageCardModelById: pickClipboardStateByIds(clipboard?.imageCardModelById, remappedIds),
    imageCardSizeById: pickClipboardStateByIds(clipboard?.imageCardSizeById, remappedIds),
    imageCardQualityById: pickClipboardStateByIds(clipboard?.imageCardQualityById, remappedIds),
    imageCardCountById: pickClipboardStateByIds(clipboard?.imageCardCountById, remappedIds),
    imageCardAspectRatioById: pickClipboardStateByIds(clipboard?.imageCardAspectRatioById, remappedIds),
    nextPasteCount: safePasteCount + 1,
  };
}

export function shouldHandleCanvasImagePaste(target) {
  if (!target || typeof target !== 'object') {
    return true;
  }

  const resolvedTarget =
    target && typeof target === 'object' && 'nodeType' in target && target.nodeType === 3 && 'parentElement' in target
      ? target.parentElement
      : target;

  if (!resolvedTarget || typeof resolvedTarget !== 'object') {
    return true;
  }

  const tagName =
    'tagName' in resolvedTarget && typeof resolvedTarget.tagName === 'string'
      ? resolvedTarget.tagName.toLowerCase()
      : '';

  if (tagName === 'input' || tagName === 'textarea' || tagName === 'select') {
    return false;
  }

  if ('isContentEditable' in resolvedTarget && resolvedTarget.isContentEditable) {
    return false;
  }

  if (typeof resolvedTarget.closest === 'function') {
    const editableAncestor = resolvedTarget.closest(
      'input, textarea, select, [contenteditable]:not([contenteditable="false"])'
    );
    if (editableAncestor) {
      return false;
    }
  }

  return true;
}

export function resolveCanvasImagePasteTarget({
  selectedId,
  selectedIds,
  itemById,
}) {
  if (!selectedId || !Array.isArray(selectedIds) || selectedIds.length !== 1) {
    return { mode: 'create' };
  }

  const item = itemById?.[selectedId];
  if (isImageAssetItem(item)) {
    return {
      mode: 'replace',
      itemId: selectedId,
    };
  }

  return { mode: 'create' };
}

function getConstrainedImageAssetSize(naturalWidth, naturalHeight, minSide = 512) {
  if (!Number.isFinite(naturalWidth) || !Number.isFinite(naturalHeight) || naturalWidth <= 0 || naturalHeight <= 0) {
    return { width: minSide, height: minSide };
  }

  if (naturalWidth >= naturalHeight) {
    return {
      width: (naturalWidth / naturalHeight) * minSide,
      height: minSide,
    };
  }

  return {
    width: minSide,
    height: (naturalHeight / naturalWidth) * minSide,
  };
}

export function getReplacedImageAssetItem(item, nextImageMeta) {
  if (!isImageAssetItem(item) || !nextImageMeta || typeof nextImageMeta.src !== 'string' || nextImageMeta.src.length === 0) {
    return item;
  }

  const { width, height } = getConstrainedImageAssetSize(
    nextImageMeta.naturalWidth,
    nextImageMeta.naturalHeight
  );
  const centerX = item.x + item.width / 2;
  const centerY = item.y + item.height / 2;

  return {
    ...item,
    src: nextImageMeta.src,
    naturalWidth: nextImageMeta.naturalWidth,
    naturalHeight: nextImageMeta.naturalHeight,
    width,
    height,
    x: centerX - width / 2,
    y: centerY - height / 2,
  };
}

export function canItemAcceptIncomingConnection(item) {
  if (!item) {
    return false;
  }

  if (item.type === 'image') {
    return isImageCardItem(item);
  }

  if (item.type === 'text' && item.textVariant === 'card' && item.textMode === 'manual') {
    return false;
  }

  return true;
}

export function createCanvasCardItemAtCanvasPoint({
  kind,
  id,
  canvasPoint,
  width,
  height,
}) {
  const baseItem = {
    id,
    x: canvasPoint.x - width / 2,
    y: canvasPoint.y - height / 2,
    width,
    height,
    rotation: 0,
    visible: true,
    locked: false,
  };

  if (kind === 'image') {
    return {
      ...baseItem,
      type: 'image',
      imageVariant: 'card',
    };
  }

  return {
    ...baseItem,
    type: 'text',
    textVariant: 'card',
    textMode: 'ai',
  };
}

export function resolveFloatingPopoverOffset({
  panelRect,
  anchorRect,
  scale,
  placement = 'anchor',
  gap = 0,
}) {
  if (!panelRect || !anchorRect || !Number.isFinite(scale) || scale <= 0) {
    return null;
  }

  const normalizedGap = Number.isFinite(gap) ? gap : 0;

  if (placement === 'below-panel') {
    const panelHeight = typeof panelRect.bottom === 'number'
      ? panelRect.bottom - panelRect.top
      : 0;

    return {
      left: (anchorRect.left - panelRect.left) / scale,
      top: (panelHeight + normalizedGap) / scale,
    };
  }

  return {
    left: (anchorRect.left - panelRect.left) / scale,
    top: (anchorRect.top - panelRect.top) / scale,
  };
}

export function getTextCardVisualState({
  item,
  items,
  connections,
  generatingItemIds = null,
  generatingItemId = null,
  editingItemId = null,
}) {
  if (!item || item.type !== 'text' || item.textVariant !== 'card') {
    return 'idle';
  }

  const activeGeneratingItemIds =
    generatingItemIds instanceof Set
      ? generatingItemIds
      : typeof generatingItemId === 'string' && generatingItemId
        ? new Set([generatingItemId])
        : null;

  if (item.textMode === 'manual') {
    if (editingItemId === item.id) {
      return 'manual-editing';
    }

    if (typeof item.text === 'string' && item.text.trim().length > 0) {
      return 'manual-content';
    }

    return 'idle';
  }

  if (activeGeneratingItemIds?.has(item.id)) {
    return 'waiting';
  }

  if (typeof item.text === 'string' && item.text.trim().length > 0) {
    return 'content';
  }

  return 'idle';
}

export function canEnterManualTextMode({
  item,
  items,
  connections,
  generatingItemIds = null,
  generatingItemId = null,
}) {
  if (!item || item.type !== 'text' || item.textVariant !== 'card') {
    return false;
  }

  if (item.textMode === 'manual') {
    return false;
  }

  if (typeof item.text === 'string' && item.text.trim().length > 0) {
    return false;
  }

  const activeGeneratingItemIds =
    generatingItemIds instanceof Set
      ? generatingItemIds
      : typeof generatingItemId === 'string' && generatingItemId
        ? new Set([generatingItemId])
        : null;

  if (activeGeneratingItemIds?.has(item.id)) {
    return false;
  }

  if (!Array.isArray(connections)) {
    return true;
  }

  return !connections.some((connection) => connection?.toItemId === item.id);
}

export function canStartCanvasTextGeneration({
  itemId,
  activeGenerations,
  limit = CANVAS_TEXT_GENERATION_CONCURRENCY_LIMIT,
}) {
  if (!itemId || !activeGenerations || typeof activeGenerations !== 'object') {
    return false;
  }

  if (activeGenerations[itemId]) {
    return false;
  }

  return Object.keys(activeGenerations).length < limit;
}

export function removeCanvasTextGenerationEntry({
  activeGenerations,
  itemId,
}) {
  if (!activeGenerations || typeof activeGenerations !== 'object' || !itemId || !activeGenerations[itemId]) {
    return activeGenerations || {};
  }

  const next = { ...activeGenerations };
  delete next[itemId];
  return next;
}

export function shouldPreventScrollableRegionWheelDefault({
  deltaX = 0,
  deltaY = 0,
  scrollTop = 0,
  scrollHeight = 0,
  clientHeight = 0,
  scrollLeft = 0,
  scrollWidth = 0,
  clientWidth = 0,
}) {
  const hasVerticalOverflow = scrollHeight > clientHeight;
  const hasHorizontalOverflow = scrollWidth > clientWidth;
  const verticalMaxScroll = Math.max(0, scrollHeight - clientHeight);
  const horizontalMaxScroll = Math.max(0, scrollWidth - clientWidth);

  const isAtTop = scrollTop <= 0;
  const isAtBottom = scrollTop >= verticalMaxScroll - 1;
  const isAtLeft = scrollLeft <= 0;
  const isAtRight = scrollLeft >= horizontalMaxScroll - 1;

  if (hasVerticalOverflow) {
    if (deltaY < 0 && isAtTop) return true;
    if (deltaY > 0 && isAtBottom) return true;
  }

  if (hasHorizontalOverflow) {
    if (deltaX < 0 && isAtLeft) return true;
    if (deltaX > 0 && isAtRight) return true;
  }

  return false;
}

export function getAutoResizedTextareaMetrics({
  scrollHeight = 0,
  minHeight = 0,
  maxHeight = Number.POSITIVE_INFINITY,
}) {
  const safeMinHeight = Math.max(0, minHeight);
  const safeMaxHeight = Math.max(safeMinHeight, maxHeight);
  const resolvedHeight = Math.min(Math.max(scrollHeight, safeMinHeight), safeMaxHeight);

  return {
    height: resolvedHeight,
    isOverflowing: scrollHeight > safeMaxHeight,
  };
}

export function syncAutoResizedTextareaLayout(
  textarea,
  {
    minHeight = 0,
    maxHeight = Number.POSITIVE_INFINITY,
  } = {}
) {
  if (!textarea?.style) {
    return getAutoResizedTextareaMetrics({
      scrollHeight: 0,
      minHeight,
      maxHeight,
    });
  }

  textarea.style.height = 'auto';

  const metrics = getAutoResizedTextareaMetrics({
    scrollHeight: textarea.scrollHeight,
    minHeight,
    maxHeight,
  });

  textarea.style.height = `${metrics.height}px`;
  textarea.style.overflowY = metrics.isOverflowing ? 'auto' : 'hidden';

  return metrics;
}

export function getTextCardPanelPlaceholder({
  linkedImageCount = 0,
  linkedTextCount = 0,
}) {
  if (linkedImageCount > 0 || linkedTextCount > 0) {
    return '描述你想要生成的内容，并在下方调整生成参数。（按下Enter 生成，Shift+Enter 换行）';
  }

  return '输入你想发送的文本内容…（按 Enter 发送，Shift+Enter 换行）';
}

export function getDisplayableTextCardPanelDraft(rawDraft) {
  if (typeof rawDraft !== 'string') {
    return '';
  }

  return rawDraft.trim().length === 0 ? '' : rawDraft;
}

function matchesClosest(target, selector) {
  return !!target && typeof target.closest === 'function' && !!target.closest(selector);
}

export function isEventInsideTextCardPanel(target) {
  return matchesClosest(target, '[data-text-card-panel="true"]');
}

export function shouldFocusTextCardPanelInputOnPointerDown(target) {
  if (!isEventInsideTextCardPanel(target)) {
    return false;
  }

  if (matchesClosest(target, '[data-text-card-panel-control="true"]')) {
    return false;
  }

  if (matchesClosest(target, '[data-text-card-panel-input="true"]')) {
    return false;
  }

  return true;
}

export function shouldSubmitTextCardPanelEnter({
  key,
  shiftKey = false,
  altKey = false,
  isComposing = false,
}) {
  if (isComposing) return false;
  if (key !== 'Enter') return false;
  if (shiftKey || altKey) return false;

  return true;
}

export function buildReferenceImageRequestPayload(previews) {
  if (!Array.isArray(previews) || previews.length === 0) {
    return {
      referenceImages: [],
      referenceLabels: [],
    };
  }

  return previews.reduce(
    (result, preview) => {
      if (
        !preview ||
        typeof preview.src !== 'string' ||
        preview.src.length === 0 ||
        typeof preview.label !== 'string' ||
        preview.label.length === 0
      ) {
        return result;
      }

      result.referenceImages.push(preview.src);
      result.referenceLabels.push(preview.label);
      return result;
    },
    { referenceImages: [], referenceLabels: [] }
  );
}

export function getDirectTextInputsForTextCard({
  textCardId,
  items,
  connections,
}) {
  if (!textCardId || !Array.isArray(items) || !Array.isArray(connections)) {
    return [];
  }

  const itemById = new Map(items.map((item) => [item?.id, item]));
  const seenTextIds = new Set();

  return connections.flatMap((connection) => {
    if (connection?.toItemId !== textCardId) return [];

    const sourceItem = itemById.get(connection.fromItemId);
    if (!sourceItem || sourceItem.id === textCardId || sourceItem.type !== 'text') {
      return [];
    }

    const sourceText = typeof sourceItem.text === 'string' ? sourceItem.text.trim() : '';
    if (!sourceText || seenTextIds.has(sourceItem.id)) {
      return [];
    }

    seenTextIds.add(sourceItem.id);

    return [
      {
        id: sourceItem.id,
        text: sourceText,
      },
    ];
  });
}

export function buildCanvasTextPanelSubmitInput({
  draft,
  linkedTexts = [],
}) {
  const trimmedDraft = typeof draft === 'string' ? draft.trim() : '';
  const linkedTextBlocks = Array.isArray(linkedTexts)
    ? linkedTexts
        .map((entry) => (typeof entry?.text === 'string' ? entry.text.trim() : ''))
        .filter(Boolean)
    : [];

  return [trimmedDraft, ...linkedTextBlocks].filter(Boolean).join('\n\n');
}

export function buildCanvasImagePanelSubmitInput({
  draft,
  linkedTexts = [],
}) {
  return buildCanvasTextPanelSubmitInput({
    draft,
    linkedTexts,
  });
}

export function canSubmitTextCardPanel({
  draft,
  linkedTexts = [],
}) {
  return buildCanvasTextPanelSubmitInput({
    draft,
    linkedTexts,
  }).length > 0;
}

export function canSubmitImageCardPanel({
  draft,
  linkedTexts = [],
  linkedImagePreviews = [],
}) {
  const submitInput = buildCanvasImagePanelSubmitInput({
    draft,
    linkedTexts,
  });
  const references = buildReferenceImageRequestPayload(linkedImagePreviews);

  if (references.referenceImages.length > 0) {
    return submitInput.length > 0;
  }

  return submitInput.length > 0;
}

export function buildCanvasTextGenerationRequest({
  input,
  linkedImagePreviews = [],
  modelId,
}) {
  const trimmedInput = typeof input === 'string' ? input.trim() : '';
  const resolvedModel = resolveTextPanelChatModel(modelId);
  const references = buildReferenceImageRequestPayload(linkedImagePreviews);

  const request = {
    messages: [{ role: 'user', content: trimmedInput }],
    intent: 'chat',
  };

  if (resolvedModel) {
    request.model = resolvedModel;
  }

  if (references.referenceImages.length > 0) {
    request.reference_images = references.referenceImages;
    request.reference_labels = references.referenceLabels;
  }

  return request;
}

export function buildCanvasImageGenerationRequest({
  input,
  linkedImagePreviews = [],
  modelId,
  size,
  quality = 'auto',
  count,
  aspectRatio = 'auto',
  executionMode = 'async',
}) {
  const trimmedInput = typeof input === 'string' ? input.trim() : '';
  const references = buildReferenceImageRequestPayload(linkedImagePreviews);
  const resolvedModel = resolveImageCardModel(modelId);
  const resolvedSize = resolveImageCardSize(resolvedModel, size);
  const supportsAspectRatio = getImageModelCapability(resolvedModel).supportsAspectRatio;

  const request = {
    messages: [{ role: 'user', content: trimmedInput }],
    intent: 'image',
  };

  if (resolvedModel) {
    request.model = resolvedModel;
  }

  if (typeof resolvedSize === 'string' && resolvedSize.trim()) {
    request.size = resolvedSize.trim();
  }

  if (Number.isFinite(count) && count > 0) {
    request.n = count;
  }

  if (!supportsAspectRatio && typeof quality === 'string' && quality.trim()) {
    request.quality = quality.trim();
  }

  if (supportsAspectRatio && typeof aspectRatio === 'string' && aspectRatio.trim() && aspectRatio !== 'auto') {
    request.aspect_ratio = aspectRatio;
  }

  if (executionMode === 'async') {
    request.executionMode = 'async';
  }

  if (references.referenceImages.length > 0) {
    request.reference_images = references.referenceImages;
    request.reference_labels = references.referenceLabels;
  }

  return request;
}

export function buildAsyncImageTaskRequests({
  input,
  linkedImagePreviews = [],
  modelId,
  size,
  quality = 'auto',
  count,
  aspectRatio = 'auto',
}) {
  const safeCount = Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
  if (safeCount <= 0) {
    return [];
  }

  return Array.from({ length: safeCount }, () =>
    buildCanvasImageGenerationRequest({
      input,
      linkedImagePreviews,
      modelId,
      size,
      quality,
      count: 1,
      aspectRatio,
      executionMode: 'async',
    })
  );
}

export function resolveCanvasImageTaskExecutionMode({
  modelId,
  size,
  count,
}) {
  return 'parallel';
}

export async function settleCanvasImageGenerationRequests({
  requests,
  executionMode = 'parallel',
  runTask,
}) {
  const safeRequests = Array.isArray(requests) ? requests : [];
  if (executionMode !== 'serial') {
    return Promise.allSettled(safeRequests.map((request) => runTask(request)));
  }

  const results = [];
  for (const request of safeRequests) {
    try {
      const value = await runTask(request);
      results.push({ status: 'fulfilled', value });
    } catch (error) {
      results.push({ status: 'rejected', reason: error });
      if (error instanceof Error && error.name === 'AbortError') {
        break;
      }
    }
  }
  return results;
}

export function buildCanvasImageGenerationFailureMessage({
  requestedCount,
  completedCount,
  validationFailureCount = 0,
  requestFailureCount = 0,
}) {
  const safeRequestedCount = Number.isFinite(requestedCount) && requestedCount > 0 ? Math.floor(requestedCount) : 0;
  const safeCompletedCount = Number.isFinite(completedCount) && completedCount >= 0 ? Math.floor(completedCount) : 0;
  const safeValidationFailureCount =
    Number.isFinite(validationFailureCount) && validationFailureCount > 0 ? Math.floor(validationFailureCount) : 0;
  const safeRequestFailureCount =
    Number.isFinite(requestFailureCount) && requestFailureCount > 0 ? Math.floor(requestFailureCount) : 0;

  if (safeValidationFailureCount <= 0 && safeRequestFailureCount <= 0) {
    return null;
  }

  if (safeValidationFailureCount > 0 && safeRequestFailureCount > 0) {
    return `请求 ${safeRequestedCount} 张，成功 ${safeCompletedCount} 张；${safeValidationFailureCount} 张未达标已丢弃，请手动补生成剩余 ${safeRequestFailureCount} 张`;
  }

  if (safeRequestFailureCount > 0) {
    return `请求 ${safeRequestedCount} 张，成功 ${safeCompletedCount} 张；请手动补生成剩余 ${safeRequestFailureCount} 张`;
  }

  return `请求 ${safeRequestedCount} 张，成功 ${safeCompletedCount} 张，未达标结果已丢弃`;
}

export function buildImageCardOutputsState(outputs, requestedActiveIndex = 0) {
  if (!Array.isArray(outputs) || outputs.length === 0) {
    return {
      src: '',
      naturalWidth: undefined,
      naturalHeight: undefined,
      imageOutputs: [],
      activeImageOutputIndex: 0,
    };
  }

  const normalizedOutputs = outputs.filter(
    (output) =>
      output &&
      typeof output.src === 'string' &&
      output.src.length > 0 &&
      Number.isFinite(output.naturalWidth) &&
      output.naturalWidth > 0 &&
      Number.isFinite(output.naturalHeight) &&
      output.naturalHeight > 0
  );

  if (normalizedOutputs.length === 0) {
    return {
      src: '',
      naturalWidth: undefined,
      naturalHeight: undefined,
      imageOutputs: [],
      activeImageOutputIndex: 0,
    };
  }

  const safeIndex = Math.min(
    Math.max(0, Number.isFinite(requestedActiveIndex) ? requestedActiveIndex : 0),
    normalizedOutputs.length - 1
  );
  const activeOutput = normalizedOutputs[safeIndex];

  return {
    src: activeOutput.src,
    naturalWidth: activeOutput.naturalWidth,
    naturalHeight: activeOutput.naturalHeight,
    imageOutputs: normalizedOutputs,
    activeImageOutputIndex: safeIndex,
  };
}

export function getCurrentImageCardOutput(item) {
  if (!item || item.type !== 'image') {
    return null;
  }

  if (Array.isArray(item.imageOutputs) && item.imageOutputs.length > 0) {
    const outputState = buildImageCardOutputsState(item.imageOutputs, item.activeImageOutputIndex ?? 0);
    if (typeof outputState.src === 'string' && outputState.src.length > 0) {
      return {
        src: outputState.src,
        naturalWidth: outputState.naturalWidth,
        naturalHeight: outputState.naturalHeight,
      };
    }
  }

  if (typeof item.src === 'string' && item.src.length > 0) {
    return {
      src: item.src,
      naturalWidth: Number.isFinite(item.naturalWidth) ? item.naturalWidth : undefined,
      naturalHeight: Number.isFinite(item.naturalHeight) ? item.naturalHeight : undefined,
    };
  }

  return null;
}

function extractTimestampFromGeneratedId(value) {
  if (typeof value !== 'string' || value.length === 0) {
    return null;
  }

  const matches = value.match(/\d{10,}/g);
  if (!matches || matches.length === 0) {
    return null;
  }

  const timestamp = Number(matches[matches.length - 1]);
  if (!Number.isFinite(timestamp) || timestamp <= 0) {
    return null;
  }

  return timestamp;
}

function extractTimestampFromGeneratedAsset(value) {
  if (typeof value !== 'string' || value.length === 0) {
    return null;
  }

  const normalizedValue = value.split(/[?#]/, 1)[0];
  const filename = normalizedValue.split('/').pop() || normalizedValue;
  return extractGeneratedImageTimestampFromFilename(filename);
}

function buildGeneratedImageHistorySortKey(timestamp, sequence = 0) {
  const safeTimestamp = Number.isFinite(timestamp) && timestamp > 0 ? timestamp : 0;
  const safeSequence = Number.isFinite(sequence) && sequence >= 0 ? sequence : 0;
  return safeTimestamp * 1000 + safeSequence;
}

export function getGeneratedImageHistorySourceSessions({ sessions, currentSessionSnapshot }) {
  const normalizedSessions = Array.isArray(sessions) ? sessions : [];
  const currentSnapshotId = typeof currentSessionSnapshot?.id === 'string' ? currentSessionSnapshot.id : '';

  if (!currentSnapshotId) {
    return normalizedSessions;
  }

  const existingIndex = normalizedSessions.findIndex((session) => session?.id === currentSnapshotId);
  if (existingIndex === -1) {
    return [currentSessionSnapshot, ...normalizedSessions];
  }

  return normalizedSessions.map((session, index) => (index === existingIndex ? currentSessionSnapshot : session));
}

export function getGeneratedImageHistoryEntries({ sessions, currentSessionSnapshot, archiveEntries }) {
  const sourceSessions = getGeneratedImageHistorySourceSessions({ sessions, currentSessionSnapshot });
  const sessionEntries = [];
  const fallbackEntries = [];

  (Array.isArray(sourceSessions) ? sourceSessions : []).forEach((session, sessionIndex) => {
    const sessionId = typeof session?.id === 'string' ? session.id : `session-${sessionIndex}`;
    const sessionUpdatedAt =
      Number.isFinite(session?.updatedAt) && session.updatedAt > 0 ? session.updatedAt : 0;
    const normalizedSessionHistory = normalizeGeneratedImageHistory(session?.generatedImageHistory);
    if (normalizedSessionHistory.length > 0) {
      sessionEntries.push(...normalizedSessionHistory.map((entry) => ({
        ...entry,
        sessionId,
      })));
    }

    const topics = Array.isArray(session?.topics) ? session.topics : [];
    topics.forEach((topic, topicIndex) => {
      const topicMessages = Array.isArray(topic?.messages) ? topic.messages : [];
      const topicUpdatedAt =
        Number.isFinite(topic?.updatedAt) && topic.updatedAt > 0 ? topic.updatedAt : sessionUpdatedAt;

      topicMessages.forEach((message, messageIndex) => {
        if (typeof message?.imageUrl !== 'string' || message.imageUrl.length === 0) {
          return;
        }

        const messageTimestamp =
          extractTimestampFromGeneratedId(message.id) ??
          extractTimestampFromGeneratedAsset(message.imageUrl) ??
          topicUpdatedAt;
        fallbackEntries.push({
          id: `chat:${sessionId}:${topic?.id || topicIndex}:${message?.id || messageIndex}`,
          sessionId,
          source: 'chat',
          src: message.imageUrl,
          createdAt: buildGeneratedImageHistorySortKey(messageTimestamp, messageIndex),
          naturalWidth: undefined,
          naturalHeight: undefined,
        });
      });
    });

    const items = Array.isArray(session?.items) ? session.items : [];
    items.forEach((item, itemIndex) => {
      if (!isImageCardItem(item) || !Array.isArray(item.imageOutputs) || item.imageOutputs.length === 0) {
        return;
      }

      const itemTimestamp = extractTimestampFromGeneratedId(item.id) ?? sessionUpdatedAt;

      item.imageOutputs.forEach((output, outputIndex) => {
        if (
          !output ||
          typeof output.src !== 'string' ||
          output.src.length === 0
        ) {
          return;
        }

        const outputTimestamp =
          extractTimestampFromGeneratedAsset(output.src) ??
          itemTimestamp;

        fallbackEntries.push({
          id: `image-card:${sessionId}:${item.id || itemIndex}:${outputIndex}`,
          sessionId,
          source: 'image-card',
          src: output.src,
          createdAt: buildGeneratedImageHistorySortKey(outputTimestamp, outputIndex),
          naturalWidth:
            Number.isFinite(output.naturalWidth) && output.naturalWidth > 0 ? output.naturalWidth : undefined,
          naturalHeight:
            Number.isFinite(output.naturalHeight) && output.naturalHeight > 0 ? output.naturalHeight : undefined,
        });
      });
    });
  });

  return mergeGeneratedImageHistoryEntries({
    sessionEntries,
    fallbackEntries,
    archiveEntries,
  });
}

export function reorderIncomingImageConnections({
  connections,
  itemById,
  targetItemId,
  fromImageItemId,
  toImageItemId,
}) {
  const normalizedConnections = Array.isArray(connections) ? connections : [];
  if (!targetItemId || !fromImageItemId || !toImageItemId || fromImageItemId === toImageItemId) {
    return normalizedConnections;
  }

  const imageConnectionIndexes = normalizedConnections.flatMap((connection, index) => {
    if (connection?.toItemId !== targetItemId) return [];
    const sourceItem = itemById?.[connection.fromItemId];
    return sourceItem?.type === 'image' ? [index] : [];
  });

  if (imageConnectionIndexes.length < 2) {
    return normalizedConnections;
  }

  const imageConnections = imageConnectionIndexes.map((index) => normalizedConnections[index]);
  const fromIndex = imageConnections.findIndex((connection) => connection?.fromItemId === fromImageItemId);
  const toIndex = imageConnections.findIndex((connection) => connection?.fromItemId === toImageItemId);

  if (fromIndex === -1 || toIndex === -1 || fromIndex === toIndex) {
    return normalizedConnections;
  }

  const reorderedImageConnections = [...imageConnections];
  const [movedConnection] = reorderedImageConnections.splice(fromIndex, 1);
  reorderedImageConnections.splice(toIndex, 0, movedConnection);

  const nextConnections = [...normalizedConnections];
  imageConnectionIndexes.forEach((index, reorderedIndex) => {
    nextConnections[index] = reorderedImageConnections[reorderedIndex];
  });

  return nextConnections;
}

export function appendImageCardOutput({
  existingOutputs = [],
  existingActiveIndex = 0,
  nextOutput,
}) {
  const normalizedExistingOutputs = Array.isArray(existingOutputs) ? existingOutputs : [];
  const nextOutputs = nextOutput ? [...normalizedExistingOutputs, nextOutput] : normalizedExistingOutputs;
  const nextActiveIndex = normalizedExistingOutputs.length === 0 ? nextOutputs.length - 1 : existingActiveIndex;

  return buildImageCardOutputsState(nextOutputs, nextActiveIndex);
}

export function getDirectImagePreviewsForTextCard({
  textCardId,
  items,
  connections,
}) {
  if (!textCardId || !Array.isArray(items) || !Array.isArray(connections)) {
    return [];
  }

  const itemById = new Map(items.map((item) => [item?.id, item]));
  const seenImageIds = new Set();

  return connections.flatMap((connection) => {
    if (connection?.toItemId !== textCardId) return [];

    const sourceItem = itemById.get(connection.fromItemId);
    const currentOutput = getCurrentImageCardOutput(sourceItem);
    if (!sourceItem || !currentOutput) {
      return [];
    }

    if (seenImageIds.has(sourceItem.id)) {
      return [];
    }

    seenImageIds.add(sourceItem.id);

    return [
      {
        id: sourceItem.id,
        src: currentOutput.src,
        label: `image${seenImageIds.size}`,
        alt: `image${seenImageIds.size}`,
      },
    ];
  });
}

/**
 * @param {{
 *   session: any,
 *   now?: number,
 *   normalizeSession?: (value: any) => any,
 *   normalizeItems?: (items: any[]) => any[],
 *   inferTopicSkill?: (topic: any) => any,
 * }} options
 */
export function resolveSessionPresentationState({
  session,
  now = Date.now(),
  normalizeSession = (value) => value,
  normalizeItems = (items) => items,
  inferTopicSkill = () => null,
}) {
  let topics = session.topics || [];
  let activeTopicId = session.activeTopicId || '';

  if (topics.length === 0 && Array.isArray(session.messages) && session.messages.length > 0) {
    const initialTopic = {
      id: `topic-initial-${now}`,
      title: session.messages[0].content?.substring(0, 20) || '初始对话',
      messages: session.messages,
      activeSkill: null,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
    };
    topics = [initialTopic];
    activeTopicId = initialTopic.id;
  } else if (topics.length === 0) {
    const emptyTopic = {
      id: `topic-empty-${now}`,
      title: '新对话',
      messages: [],
      activeSkill: null,
      createdAt: now,
      updatedAt: now,
    };
    topics = [emptyTopic];
    activeTopicId = emptyTopic.id;
  }

  const normalizedSession = normalizeSession(session);
  const activeTopic = topics.find((topic) => topic.id === activeTopicId) || topics[0] || null;
  const chatMessages = activeTopic ? activeTopic.messages || [] : [];

  return {
    normalizedSession,
    topics,
    activeTopic,
    items: normalizeItems(normalizedSession.items || []),
    connections: normalizedSession.connections || [],
    chatMessages,
    activeSkill: inferTopicSkill(activeTopic),
    viewport: normalizedSession.viewport || { ...DEFAULT_VIEWPORT },
    imageCount: chatMessages.filter((message) => message.imageName).length,
    shouldResetWelcome: !activeTopic || chatMessages.length === 0,
    currentSessionId: normalizedSession.id,
  };
}
