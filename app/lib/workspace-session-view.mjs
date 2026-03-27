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
];

export function getDefaultTextPanelModelOption() {
  return TEXT_PANEL_MODEL_OPTIONS[0];
}

export function getDefaultImageCardModelOption() {
  return IMAGE_CARD_MODEL_OPTIONS[0];
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

export function getImageCardFrameSizeForAspectRatio(aspectRatio, frameWidth = 348) {
  const safeFrameWidth = Number.isFinite(frameWidth) && frameWidth > 0 ? frameWidth : 348;
  const parts = parseAspectRatioParts(aspectRatio);

  if (!parts) {
    return {
      width: safeFrameWidth,
      height: safeFrameWidth,
    };
  }

  return {
    width: safeFrameWidth,
    height: safeFrameWidth * (parts.heightRatio / parts.widthRatio),
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
  const safeFrameWidth = Number.isFinite(frameWidth) && frameWidth > 0 ? frameWidth : 348;
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
  frameWidth = 348,
  insets
) {
  const safeFrameWidth = Number.isFinite(frameWidth) && frameWidth > 0 ? frameWidth : 348;
  const safeNaturalWidth = Number.isFinite(naturalWidth) && naturalWidth > 0 ? naturalWidth : safeFrameWidth;
  const safeNaturalHeight = Number.isFinite(naturalHeight) && naturalHeight > 0 ? naturalHeight : safeFrameWidth;

  return getImageCardItemSizeForFrameSize(
    safeFrameWidth,
    safeFrameWidth * (safeNaturalHeight / safeNaturalWidth),
    insets
  );
}

export function getImageCardQualitySummary({ aspectRatio, size }) {
  const normalizedAspectRatio = normalizeImageCardAspectRatio(aspectRatio);
  const normalizedSize = typeof size === 'string' ? size.trim() : '';

  let sizeLabel = normalizedSize;
  if (normalizedSize === '1024x1024') {
    sizeLabel = '1K';
  } else if (normalizedSize === '2048x2048') {
    sizeLabel = '2K';
  } else if (normalizedSize === '4096x4096') {
    sizeLabel = '4K';
  }

  return `${normalizedAspectRatio} · ${sizeLabel}`;
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

export function isImageCardItem(item) {
  return !!item && item.type === 'image' && item.imageVariant === 'card';
}

export function isImageAssetItem(item) {
  return !!item && item.type === 'image' && !isImageCardItem(item) && typeof item.src === 'string' && item.src.length > 0;
}

export function extractImageFilesFromClipboardItems(items) {
  return Array.from(items || [])
    .filter((item) => item && typeof item.type === 'string' && item.type.startsWith('image/'))
    .map((item) => (typeof item.getAsFile === 'function' ? item.getAsFile() : null))
    .filter((file) => file !== null);
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

  return submitInput.length > 0 || references.referenceImages.length > 0;
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
  count,
  aspectRatio = 'auto',
  executionMode = 'sync',
}) {
  const trimmedInput = typeof input === 'string' ? input.trim() : '';
  const references = buildReferenceImageRequestPayload(linkedImagePreviews);
  const resolvedModel = resolveImageCardModel(modelId);

  const request = {
    messages: [{ role: 'user', content: trimmedInput }],
    intent: 'image',
  };

  if (resolvedModel) {
    request.model = resolvedModel;
  }

  if (typeof size === 'string' && size.trim()) {
    request.size = size.trim();
  }

  if (Number.isFinite(count) && count > 0) {
    request.n = count;
  }

  if (typeof aspectRatio === 'string' && aspectRatio.trim() && aspectRatio !== 'auto') {
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
      count: 1,
      aspectRatio,
      executionMode: 'async',
    })
  );
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

function buildGeneratedImageHistorySortKey(timestamp, sequence = 0) {
  const safeTimestamp = Number.isFinite(timestamp) && timestamp > 0 ? timestamp : 0;
  const safeSequence = Number.isFinite(sequence) && sequence >= 0 ? sequence : 0;
  return safeTimestamp * 1000 + safeSequence;
}

export function getGeneratedImageHistoryEntries({ sessions }) {
  if (!Array.isArray(sessions) || sessions.length === 0) {
    return [];
  }

  const entries = [];

  sessions.forEach((session, sessionIndex) => {
    const sessionId = typeof session?.id === 'string' ? session.id : `session-${sessionIndex}`;
    const sessionUpdatedAt =
      Number.isFinite(session?.updatedAt) && session.updatedAt > 0 ? session.updatedAt : 0;

    const topics = Array.isArray(session?.topics) ? session.topics : [];
    topics.forEach((topic, topicIndex) => {
      const topicMessages = Array.isArray(topic?.messages) ? topic.messages : [];
      const topicUpdatedAt =
        Number.isFinite(topic?.updatedAt) && topic.updatedAt > 0 ? topic.updatedAt : sessionUpdatedAt;

      topicMessages.forEach((message, messageIndex) => {
        if (typeof message?.imageUrl !== 'string' || message.imageUrl.length === 0) {
          return;
        }

        const messageTimestamp = extractTimestampFromGeneratedId(message.id) ?? topicUpdatedAt;
        entries.push({
          id: `chat:${sessionId}:${topic?.id || topicIndex}:${message?.id || messageIndex}`,
          sessionId,
          source: 'chat',
          src: message.imageUrl,
          naturalWidth: undefined,
          naturalHeight: undefined,
          sortKey: buildGeneratedImageHistorySortKey(messageTimestamp, messageIndex),
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

        entries.push({
          id: `image-card:${sessionId}:${item.id || itemIndex}:${outputIndex}`,
          sessionId,
          source: 'image-card',
          src: output.src,
          naturalWidth:
            Number.isFinite(output.naturalWidth) && output.naturalWidth > 0 ? output.naturalWidth : undefined,
          naturalHeight:
            Number.isFinite(output.naturalHeight) && output.naturalHeight > 0 ? output.naturalHeight : undefined,
          sortKey: buildGeneratedImageHistorySortKey(itemTimestamp, outputIndex),
        });
      });
    });
  });

  return entries.sort((a, b) => {
    if (b.sortKey !== a.sortKey) {
      return b.sortKey - a.sortKey;
    }

    return String(b.id).localeCompare(String(a.id));
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
