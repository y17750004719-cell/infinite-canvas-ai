import test from 'node:test';
import assert from 'node:assert/strict';

import { createEmptySession } from './session-crud.mjs';
import {
  CANVAS_TEXT_GENERATION_CONCURRENCY_LIMIT,
  canItemAcceptIncomingConnection,
  canSubmitTextCardPanel,
  getAutoResizedTextareaMetrics,
  syncAutoResizedTextareaLayout,
  buildCanvasTextPanelSubmitInput,
  buildCanvasTextGenerationRequest,
  buildReferenceImageRequestPayload,
  canEnterManualTextMode,
  canStartCanvasTextGeneration,
  finalizeManualTextCardItem,
  getDefaultTextPanelModelOption,
  getDirectImagePreviewsForTextCard,
  getDirectTextInputsForTextCard,
  getDisplayableTextCardPanelDraft,
  getTextCardPanelPlaceholder,
  removeCanvasTextGenerationEntry,
  isEventInsideTextCardPanel,
  shouldSubmitTextCardPanelEnter,
  shouldFocusTextCardPanelInputOnPointerDown,
  getTextCardVisualState,
  resolveTextPanelChatModel,
  resolveSessionPresentationState,
  shouldPreventScrollableRegionWheelDefault,
} from './workspace-session-view.mjs';

test('resolveSessionPresentationState creates a topic for legacy sessions that only have messages', () => {
  const legacyMessages = [
    {
      id: 'msg-1',
      role: 'user',
      content: '品牌方向探索',
    },
  ];

  const session = {
    ...createEmptySession({ existingCount: 0, now: 100 }),
    messages: legacyMessages,
    topics: [],
    activeTopicId: '',
  };

  const result = resolveSessionPresentationState({
    session,
    now: 200,
    normalizeSession: (value) => value,
    normalizeItems: (items) => items,
    inferTopicSkill: () => null,
  });

  assert.equal(result.topics.length, 1);
  assert.equal(result.topics[0].id, 'topic-initial-200');
  assert.equal(result.activeTopic?.id, 'topic-initial-200');
  assert.deepEqual(result.chatMessages, legacyMessages);
  assert.equal(result.currentSessionId, session.id);
});

test('resolveSessionPresentationState creates an empty topic for sessions without any conversation state', () => {
  const session = {
    ...createEmptySession({ existingCount: 0, now: 100 }),
    topics: [],
    activeTopicId: '',
    messages: [],
  };

  const result = resolveSessionPresentationState({
    session,
    now: 300,
    normalizeSession: (value) => value,
    normalizeItems: (items) => items,
    inferTopicSkill: () => null,
  });

  assert.equal(result.topics.length, 1);
  assert.equal(result.topics[0].id, 'topic-empty-300');
  assert.equal(result.activeTopic?.id, 'topic-empty-300');
  assert.deepEqual(result.chatMessages, []);
  assert.equal(result.imageCount, 0);
  assert.equal(result.shouldResetWelcome, true);
});

test('resolveSessionPresentationState uses inferred topic skill and normalized items/connections', () => {
  const session = createEmptySession({ existingCount: 0, now: 100 });
  const skill = { id: 'brand', label: '品牌识别系统' };
  const nextSession = {
    ...session,
    items: [{ id: 'item-1', type: 'text' }],
    connections: [{ id: 'conn-1', fromItemId: 'item-1', toItemId: 'item-1' }],
    topics: [
      {
        id: 'topic-1',
        title: '品牌',
        messages: [{ id: 'msg-1', role: 'assistant', content: '已开始', skill }],
        createdAt: 100,
        updatedAt: 100,
      },
    ],
    activeTopicId: 'topic-1',
  };

  const result = resolveSessionPresentationState({
    session: nextSession,
    now: 400,
    normalizeSession: (value) => ({ ...value, connections: [{ id: 'conn-safe', fromItemId: 'item-1', toItemId: 'item-1' }] }),
    normalizeItems: (items) => items.map((item) => ({ ...item, normalized: true })),
    inferTopicSkill: () => skill,
  });

  assert.equal(result.activeSkill?.id, 'brand');
  assert.equal(result.items[0].normalized, true);
  assert.deepEqual(result.connections, [{ id: 'conn-safe', fromItemId: 'item-1', toItemId: 'item-1' }]);
  assert.equal(result.shouldResetWelcome, false);
});

test('getDirectImagePreviewsForTextCard returns direct image previews for the selected text card only', () => {
  const result = getDirectImagePreviewsForTextCard({
    textCardId: 'text-1',
    items: [
      { id: 'img-1', type: 'image', src: '/a.png' },
      { id: 'img-2', type: 'image', src: '/b.png' },
      { id: 'img-3', type: 'image', src: '/c.png' },
      { id: 'text-1', type: 'text', textVariant: 'card' },
      { id: 'text-2', type: 'text', textVariant: 'card' },
    ],
    connections: [
      { id: 'conn-1', fromItemId: 'img-2', toItemId: 'text-1' },
      { id: 'conn-2', fromItemId: 'img-1', toItemId: 'text-1' },
      { id: 'conn-3', fromItemId: 'img-3', toItemId: 'text-2' },
    ],
  });

  assert.deepEqual(result, [
    { id: 'img-2', src: '/b.png', label: 'image1', alt: 'image1' },
    { id: 'img-1', src: '/a.png', label: 'image2', alt: 'image2' },
  ]);
});

test('getDirectImagePreviewsForTextCard ignores missing, duplicate, and non-image sources', () => {
  const result = getDirectImagePreviewsForTextCard({
    textCardId: 'text-1',
    items: [
      { id: 'img-1', type: 'image', src: '/a.png' },
      { id: 'img-2', type: 'image' },
      { id: 'shape-1', type: 'shape', src: '/shape.png' },
      { id: 'text-1', type: 'text', textVariant: 'card' },
    ],
    connections: [
      { id: 'conn-1', fromItemId: 'img-1', toItemId: 'text-1' },
      { id: 'conn-2', fromItemId: 'img-1', toItemId: 'text-1' },
      { id: 'conn-3', fromItemId: 'img-2', toItemId: 'text-1' },
      { id: 'conn-4', fromItemId: 'shape-1', toItemId: 'text-1' },
      { id: 'conn-5', fromItemId: 'missing', toItemId: 'text-1' },
    ],
  });

  assert.deepEqual(result, [{ id: 'img-1', src: '/a.png', label: 'image1', alt: 'image1' }]);
});

test('getDirectTextInputsForTextCard returns direct text inputs in connection order', () => {
  const result = getDirectTextInputsForTextCard({
    textCardId: 'text-target',
    items: [
      { id: 'text-1', type: 'text', text: '第一段' },
      { id: 'text-2', type: 'text', text: '第二段' },
      { id: 'text-target', type: 'text', textVariant: 'card', text: '' },
      { id: 'image-1', type: 'image', src: '/a.png' },
    ],
    connections: [
      { id: 'conn-1', fromItemId: 'text-2', toItemId: 'text-target' },
      { id: 'conn-2', fromItemId: 'text-1', toItemId: 'text-target' },
      { id: 'conn-3', fromItemId: 'image-1', toItemId: 'text-target' },
    ],
  });

  assert.deepEqual(result, [
    { id: 'text-2', text: '第二段' },
    { id: 'text-1', text: '第一段' },
  ]);
});

test('getDirectTextInputsForTextCard ignores empty, duplicate, missing, self-target, and non-text sources', () => {
  const result = getDirectTextInputsForTextCard({
    textCardId: 'text-target',
    items: [
      { id: 'text-1', type: 'text', text: '保留我' },
      { id: 'text-2', type: 'text', text: '   ' },
      { id: 'text-target', type: 'text', textVariant: 'card', text: '自己' },
      { id: 'image-1', type: 'image', src: '/a.png' },
    ],
    connections: [
      { id: 'conn-1', fromItemId: 'text-1', toItemId: 'text-target' },
      { id: 'conn-2', fromItemId: 'text-1', toItemId: 'text-target' },
      { id: 'conn-3', fromItemId: 'text-2', toItemId: 'text-target' },
      { id: 'conn-4', fromItemId: 'text-target', toItemId: 'text-target' },
      { id: 'conn-5', fromItemId: 'image-1', toItemId: 'text-target' },
      { id: 'conn-6', fromItemId: 'missing', toItemId: 'text-target' },
    ],
  });

  assert.deepEqual(result, [{ id: 'text-1', text: '保留我' }]);
});

test('buildCanvasTextPanelSubmitInput appends linked text blocks after the draft with double newlines', () => {
  const result = buildCanvasTextPanelSubmitInput({
    draft: '详细描述这个图片',
    linkedTexts: [
      { id: 'text-2', text: '第二段上下文' },
      { id: 'text-1', text: '第一段上下文' },
    ],
  });

  assert.equal(result, '详细描述这个图片\n\n第二段上下文\n\n第一段上下文');
});

test('buildCanvasTextPanelSubmitInput can submit linked text even when draft is empty', () => {
  const result = buildCanvasTextPanelSubmitInput({
    draft: '   ',
    linkedTexts: [{ id: 'text-1', text: '上游文本' }],
  });

  assert.equal(result, '上游文本');
});

test('buildCanvasTextPanelSubmitInput returns the original draft when no linked text is present', () => {
  const result = buildCanvasTextPanelSubmitInput({
    draft: '只发我自己',
    linkedTexts: [],
  });

  assert.equal(result, '只发我自己');
});

test('canSubmitTextCardPanel returns true when linked text exists even if the draft is empty', () => {
  const result = canSubmitTextCardPanel({
    draft: '   ',
    linkedTexts: [{ id: 'text-1', text: '上游文本' }],
  });

  assert.equal(result, true);
});

test('canSubmitTextCardPanel returns false when both draft and linked text are empty', () => {
  const result = canSubmitTextCardPanel({
    draft: '   ',
    linkedTexts: [],
  });

  assert.equal(result, false);
});

test('getTextCardPanelPlaceholder uses pure text chat copy when no linked references exist', () => {
  const result = getTextCardPanelPlaceholder({
    linkedImageCount: 0,
    linkedTextCount: 0,
  });

  assert.equal(result, '输入你想发送的文本内容…（按 Enter 发送，Shift+Enter 换行）');
});

test('getTextCardPanelPlaceholder keeps generation copy when linked references exist', () => {
  const result = getTextCardPanelPlaceholder({
    linkedImageCount: 1,
    linkedTextCount: 0,
  });

  assert.equal(result, '描述你想要生成的内容，并在下方调整生成参数。（按下Enter 生成，Shift+Enter 换行）');
});

test('getDisplayableTextCardPanelDraft returns empty string for whitespace-only drafts', () => {
  assert.equal(getDisplayableTextCardPanelDraft('   '), '');
  assert.equal(getDisplayableTextCardPanelDraft('\n\n\t  '), '');
});

test('getDisplayableTextCardPanelDraft preserves non-empty text', () => {
  assert.equal(getDisplayableTextCardPanelDraft('  保留这句文案'), '  保留这句文案');
});

test('isEventInsideTextCardPanel returns true for targets inside the text card panel', () => {
  const target = {
    closest(selector) {
      return selector === '[data-text-card-panel="true"]' ? {} : null;
    },
  };

  assert.equal(isEventInsideTextCardPanel(target), true);
});

test('isEventInsideTextCardPanel returns false for targets outside the text card panel', () => {
  const target = {
    closest() {
      return null;
    },
  };

  assert.equal(isEventInsideTextCardPanel(target), false);
});

test('shouldFocusTextCardPanelInputOnPointerDown focuses the input for shell clicks', () => {
  const target = {
    closest(selector) {
      if (selector === '[data-text-card-panel-control="true"]') return null;
      if (selector === '[data-text-card-panel-input="true"]') return null;
      if (selector === '[data-text-card-panel="true"]') return {};
      return null;
    },
  };

  assert.equal(shouldFocusTextCardPanelInputOnPointerDown(target), true);
});

test('shouldFocusTextCardPanelInputOnPointerDown skips focusing when clicking controls or the textarea itself', () => {
  const controlTarget = {
    closest(selector) {
      if (selector === '[data-text-card-panel-control="true"]') return {};
      return null;
    },
  };
  const inputTarget = {
    closest(selector) {
      if (selector === '[data-text-card-panel-control="true"]') return null;
      if (selector === '[data-text-card-panel-input="true"]') return {};
      if (selector === '[data-text-card-panel="true"]') return {};
      return null;
    },
  };

  assert.equal(shouldFocusTextCardPanelInputOnPointerDown(controlTarget), false);
  assert.equal(shouldFocusTextCardPanelInputOnPointerDown(inputTarget), false);
});

test('shouldSubmitTextCardPanelEnter ignores enter during IME composition', () => {
  const result = shouldSubmitTextCardPanelEnter({
    key: 'Enter',
    shiftKey: false,
    altKey: false,
    isComposing: true,
  });

  assert.equal(result, false);
});

test('shouldSubmitTextCardPanelEnter allows plain enter when not composing', () => {
  const result = shouldSubmitTextCardPanelEnter({
    key: 'Enter',
    shiftKey: false,
    altKey: false,
    isComposing: false,
  });

  assert.equal(result, true);
});

test('canItemAcceptIncomingConnection rejects image nodes', () => {
  const result = canItemAcceptIncomingConnection({
    id: 'image-1',
    type: 'image',
    src: '/a.png',
  });

  assert.equal(result, false);
});

test('canItemAcceptIncomingConnection keeps ai text cards as valid incoming targets', () => {
  const result = canItemAcceptIncomingConnection({
    id: 'text-1',
    type: 'text',
    textVariant: 'card',
    textMode: 'ai',
  });

  assert.equal(result, true);
});

test('canItemAcceptIncomingConnection rejects manual text cards', () => {
  const result = canItemAcceptIncomingConnection({
    id: 'text-1',
    type: 'text',
    textVariant: 'card',
    textMode: 'manual',
  });

  assert.equal(result, false);
});

test('getAutoResizedTextareaMetrics keeps the minimum height for short content', () => {
  const result = getAutoResizedTextareaMetrics({
    scrollHeight: 44,
    minHeight: 52,
    maxHeight: 148,
  });

  assert.deepEqual(result, {
    height: 52,
    isOverflowing: false,
  });
});

test('getAutoResizedTextareaMetrics grows with content until the maximum height', () => {
  const result = getAutoResizedTextareaMetrics({
    scrollHeight: 112,
    minHeight: 52,
    maxHeight: 148,
  });

  assert.deepEqual(result, {
    height: 112,
    isOverflowing: false,
  });
});

test('getAutoResizedTextareaMetrics clamps to the maximum height and enables internal scrolling', () => {
  const result = getAutoResizedTextareaMetrics({
    scrollHeight: 236,
    minHeight: 52,
    maxHeight: 148,
  });

  assert.deepEqual(result, {
    height: 148,
    isOverflowing: true,
  });
});

test('syncAutoResizedTextareaLayout restores a usable height even when measured metrics stay unchanged', () => {
  const textarea = {
    scrollHeight: 44,
    style: {
      height: '0px',
      overflowY: 'hidden',
    },
  };

  const result = syncAutoResizedTextareaLayout(textarea, {
    minHeight: 52,
    maxHeight: 148,
  });

  assert.deepEqual(result, {
    height: 52,
    isOverflowing: false,
  });
  assert.equal(textarea.style.height, '52px');
  assert.equal(textarea.style.overflowY, 'hidden');
});

test('buildReferenceImageRequestPayload preserves preview order for request images and labels', () => {
  const result = buildReferenceImageRequestPayload([
    { id: 'img-2', src: '/b.png', label: 'image1', alt: 'image1' },
    { id: 'img-1', src: '/a.png', label: 'image2', alt: 'image2' },
  ]);

  assert.deepEqual(result, {
    referenceImages: ['/b.png', '/a.png'],
    referenceLabels: ['image1', 'image2'],
  });
});

test('buildCanvasTextGenerationRequest only uses the current input, direct image previews, and selected model', () => {
  const result = buildCanvasTextGenerationRequest({
    input: '请根据这两张参考图生成宠物摄影文案',
    linkedImagePreviews: [
      { id: 'img-2', src: '/b.png', label: 'image1', alt: 'image1' },
      { id: 'img-1', src: '/a.png', label: 'image2', alt: 'image2' },
    ],
    modelId: 'gemini-3.1-flash-lite-preview-thinking-medium',
  });

  assert.deepEqual(result, {
    messages: [{ role: 'user', content: '请根据这两张参考图生成宠物摄影文案' }],
    intent: 'chat',
    model: 'gemini-3.1-flash-lite-preview-thinking-medium',
    reference_images: ['/b.png', '/a.png'],
    reference_labels: ['image1', 'image2'],
  });
});

test('getTextCardVisualState returns idle for text cards without active generation or content', () => {
  const result = getTextCardVisualState({
    item: { id: 'text-1', type: 'text', textVariant: 'card' },
    items: [{ id: 'text-1', type: 'text', textVariant: 'card' }],
    connections: [],
  });

  assert.equal(result, 'idle');
});

test('getTextCardVisualState returns idle when a text card only has direct image inputs but is not generating yet', () => {
  const result = getTextCardVisualState({
    item: { id: 'text-1', type: 'text', textVariant: 'card' },
    items: [
      { id: 'img-1', type: 'image', src: '/a.png' },
      { id: 'text-1', type: 'text', textVariant: 'card' },
    ],
    connections: [{ id: 'conn-1', fromItemId: 'img-1', toItemId: 'text-1' }],
  });

  assert.equal(result, 'idle');
});

test('getTextCardVisualState returns waiting when the current text card is actively generating', () => {
  const result = getTextCardVisualState({
    item: { id: 'text-1', type: 'text', textVariant: 'card' },
    items: [
      { id: 'img-1', type: 'image', src: '/a.png' },
      { id: 'text-1', type: 'text', textVariant: 'card' },
    ],
    connections: [{ id: 'conn-1', fromItemId: 'img-1', toItemId: 'text-1' }],
    generatingItemId: 'text-1',
  });

  assert.equal(result, 'waiting');
});

test('getTextCardVisualState returns waiting when the current text card id exists in the generating item set', () => {
  const result = getTextCardVisualState({
    item: { id: 'text-2', type: 'text', textVariant: 'card' },
    items: [
      { id: 'img-1', type: 'image', src: '/a.png' },
      { id: 'text-1', type: 'text', textVariant: 'card' },
      { id: 'text-2', type: 'text', textVariant: 'card' },
    ],
    connections: [],
    generatingItemIds: new Set(['text-1', 'text-2']),
  });

  assert.equal(result, 'waiting');
});

test('getTextCardVisualState returns content when a text card already has text', () => {
  const result = getTextCardVisualState({
    item: { id: 'text-1', type: 'text', textVariant: 'card', text: '## 已生成内容', textMode: 'ai' },
    items: [
      { id: 'img-1', type: 'image', src: '/a.png' },
      { id: 'text-1', type: 'text', textVariant: 'card', text: '## 已生成内容', textMode: 'ai' },
    ],
    connections: [{ id: 'conn-1', fromItemId: 'img-1', toItemId: 'text-1' }],
  });

  assert.equal(result, 'content');
});

test('getTextCardVisualState returns manual-editing for a manual text card being edited', () => {
  const result = getTextCardVisualState({
    item: { id: 'text-1', type: 'text', textVariant: 'card', text: '手动内容', textMode: 'manual' },
    items: [{ id: 'text-1', type: 'text', textVariant: 'card', text: '手动内容', textMode: 'manual' }],
    connections: [],
    editingItemId: 'text-1',
  });

  assert.equal(result, 'manual-editing');
});

test('getTextCardVisualState returns manual-content for a manual text card with text', () => {
  const result = getTextCardVisualState({
    item: { id: 'text-1', type: 'text', textVariant: 'card', text: '手动内容', textMode: 'manual' },
    items: [{ id: 'text-1', type: 'text', textVariant: 'card', text: '手动内容', textMode: 'manual' }],
    connections: [],
  });

  assert.equal(result, 'manual-content');
});

test('finalizeManualTextCardItem restores an empty manual text card back to ai mode', () => {
  const result = finalizeManualTextCardItem({
    id: 'text-1',
    type: 'text',
    textVariant: 'card',
    textMode: 'manual',
    text: '   ',
  });

  assert.deepEqual(result, {
    id: 'text-1',
    type: 'text',
    textVariant: 'card',
    textMode: 'ai',
    text: '',
  });
});

test('finalizeManualTextCardItem keeps non-empty manual text content in manual mode', () => {
  const result = finalizeManualTextCardItem({
    id: 'text-1',
    type: 'text',
    textVariant: 'card',
    textMode: 'manual',
    text: '手动内容',
  });

  assert.deepEqual(result, {
    id: 'text-1',
    type: 'text',
    textVariant: 'card',
    textMode: 'manual',
    text: '手动内容',
  });
});

test('getTextCardVisualState ignores image connections targeting other text cards', () => {
  const result = getTextCardVisualState({
    item: { id: 'text-1', type: 'text', textVariant: 'card' },
    items: [
      { id: 'img-1', type: 'image', src: '/a.png' },
      { id: 'text-1', type: 'text', textVariant: 'card' },
      { id: 'text-2', type: 'text', textVariant: 'card' },
    ],
    connections: [{ id: 'conn-1', fromItemId: 'img-1', toItemId: 'text-2' }],
  });

  assert.equal(result, 'idle');
});

test('canEnterManualTextMode allows a pure empty ai text card', () => {
  const result = canEnterManualTextMode({
    item: { id: 'text-1', type: 'text', textVariant: 'card', textMode: 'ai' },
    items: [{ id: 'text-1', type: 'text', textVariant: 'card', textMode: 'ai' }],
    connections: [],
    generatingItemIds: new Set(),
  });

  assert.equal(result, true);
});

test('canEnterManualTextMode rejects an ai text card that already has text', () => {
  const result = canEnterManualTextMode({
    item: { id: 'text-1', type: 'text', textVariant: 'card', text: 'AI 内容', textMode: 'ai' },
    items: [{ id: 'text-1', type: 'text', textVariant: 'card', text: 'AI 内容', textMode: 'ai' }],
    connections: [],
    generatingItemIds: new Set(),
  });

  assert.equal(result, false);
});

test('canEnterManualTextMode rejects a text card with incoming connections', () => {
  const result = canEnterManualTextMode({
    item: { id: 'text-1', type: 'text', textVariant: 'card', textMode: 'ai' },
    items: [
      { id: 'image-1', type: 'image', src: '/a.png' },
      { id: 'text-1', type: 'text', textVariant: 'card', textMode: 'ai' },
    ],
    connections: [{ id: 'conn-1', fromItemId: 'image-1', toItemId: 'text-1' }],
    generatingItemIds: new Set(),
  });

  assert.equal(result, false);
});

test('canEnterManualTextMode rejects a text card while it is generating', () => {
  const result = canEnterManualTextMode({
    item: { id: 'text-1', type: 'text', textVariant: 'card', textMode: 'ai' },
    items: [{ id: 'text-1', type: 'text', textVariant: 'card', textMode: 'ai' }],
    connections: [],
    generatingItemIds: new Set(['text-1']),
  });

  assert.equal(result, false);
});

test('getDefaultTextPanelModelOption returns Gemini 3.1 Flash Lite as the default text panel model', () => {
  const result = getDefaultTextPanelModelOption();

  assert.deepEqual(result, {
    id: 'gemini-3.1-flash-lite-preview-thinking-medium',
    label: 'Gemini 3.1 Flash Lite',
  });
});

test('resolveTextPanelChatModel accepts an allowed override model', () => {
  const result = resolveTextPanelChatModel('gemini-3.1-flash-lite-preview-thinking-medium');

  assert.equal(result, 'gemini-3.1-flash-lite-preview-thinking-medium');
});

test('resolveTextPanelChatModel falls back to the default model for unknown overrides', () => {
  const result = resolveTextPanelChatModel('unknown-model');

  assert.equal(result, 'gemini-3.1-flash-lite-preview-thinking-medium');
});

test('canStartCanvasTextGeneration allows a new task when fewer than the concurrency limit are active', () => {
  const result = canStartCanvasTextGeneration({
    itemId: 'text-3',
    activeGenerations: {
      'text-1': { status: 'running', startedAt: 100 },
      'text-2': { status: 'running', startedAt: 200 },
    },
    limit: CANVAS_TEXT_GENERATION_CONCURRENCY_LIMIT,
  });

  assert.equal(result, true);
});

test('canStartCanvasTextGeneration rejects a task when the same text item is already generating', () => {
  const result = canStartCanvasTextGeneration({
    itemId: 'text-2',
    activeGenerations: {
      'text-1': { status: 'running', startedAt: 100 },
      'text-2': { status: 'running', startedAt: 200 },
    },
    limit: CANVAS_TEXT_GENERATION_CONCURRENCY_LIMIT,
  });

  assert.equal(result, false);
});

test('canStartCanvasTextGeneration rejects the sixth task when five text items are already generating', () => {
  const result = canStartCanvasTextGeneration({
    itemId: 'text-6',
    activeGenerations: {
      'text-1': { status: 'running', startedAt: 100 },
      'text-2': { status: 'running', startedAt: 200 },
      'text-3': { status: 'running', startedAt: 300 },
      'text-4': { status: 'running', startedAt: 400 },
      'text-5': { status: 'running', startedAt: 500 },
    },
    limit: CANVAS_TEXT_GENERATION_CONCURRENCY_LIMIT,
  });

  assert.equal(result, false);
});

test('removeCanvasTextGenerationEntry removes only the targeted text item generation', () => {
  const result = removeCanvasTextGenerationEntry({
    activeGenerations: {
      'text-1': { status: 'running', startedAt: 100 },
      'text-2': { status: 'running', startedAt: 200 },
      'text-3': { status: 'running', startedAt: 300 },
    },
    itemId: 'text-2',
  });

  assert.deepEqual(result, {
    'text-1': { status: 'running', startedAt: 100 },
    'text-3': { status: 'running', startedAt: 300 },
  });
});

test('shouldPreventScrollableRegionWheelDefault returns false while vertical content can still scroll', () => {
  const result = shouldPreventScrollableRegionWheelDefault({
    scrollTop: 120,
    scrollHeight: 1200,
    clientHeight: 480,
    deltaY: 80,
  });

  assert.equal(result, false);
});

test('shouldPreventScrollableRegionWheelDefault returns true when scrolling upward at the top edge', () => {
  const result = shouldPreventScrollableRegionWheelDefault({
    scrollTop: 0,
    scrollHeight: 1200,
    clientHeight: 480,
    deltaY: -40,
  });

  assert.equal(result, true);
});

test('shouldPreventScrollableRegionWheelDefault returns true when scrolling downward at the bottom edge', () => {
  const result = shouldPreventScrollableRegionWheelDefault({
    scrollTop: 720,
    scrollHeight: 1200,
    clientHeight: 480,
    deltaY: 40,
  });

  assert.equal(result, true);
});

test('shouldPreventScrollableRegionWheelDefault returns true when horizontal scrolling hits the edge', () => {
  const result = shouldPreventScrollableRegionWheelDefault({
    scrollLeft: 220,
    scrollWidth: 300,
    clientWidth: 80,
    deltaX: 24,
  });

  assert.equal(result, true);
});
