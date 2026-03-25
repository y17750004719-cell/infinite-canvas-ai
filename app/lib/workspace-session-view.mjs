const DEFAULT_VIEWPORT = { x: 0, y: 0, scale: 1 };
export const CANVAS_TEXT_GENERATION_CONCURRENCY_LIMIT = 5;

export const TEXT_PANEL_MODEL_OPTIONS = [
  {
    id: 'gemini-3.1-flash-lite-preview-thinking-medium',
    label: 'Gemini 3.1 Flash Lite',
  },
];

export function getDefaultTextPanelModelOption() {
  return TEXT_PANEL_MODEL_OPTIONS[0];
}

export function resolveTextPanelChatModel(requestedModel, fallbackModel = getDefaultTextPanelModelOption()?.id) {
  const normalizedRequestedModel = typeof requestedModel === 'string' ? requestedModel.trim() : '';
  const allowedModelIds = new Set(TEXT_PANEL_MODEL_OPTIONS.map((option) => option.id));

  if (normalizedRequestedModel && allowedModelIds.has(normalizedRequestedModel)) {
    return normalizedRequestedModel;
  }

  return fallbackModel;
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

export function canItemAcceptIncomingConnection(item) {
  if (!item || item.type === 'image') {
    return false;
  }

  if (item.type === 'text' && item.textVariant === 'card' && item.textMode === 'manual') {
    return false;
  }

  return true;
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
    if (!sourceItem || sourceItem.type !== 'image' || typeof sourceItem.src !== 'string' || sourceItem.src.length === 0) {
      return [];
    }

    if (seenImageIds.has(sourceItem.id)) {
      return [];
    }

    seenImageIds.add(sourceItem.id);

    return [
      {
        id: sourceItem.id,
        src: sourceItem.src,
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
