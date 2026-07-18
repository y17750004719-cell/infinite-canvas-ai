import test from 'node:test';
import assert from 'node:assert/strict';

import { buildGeneratedImageHistorySortKey } from './generated-image-history.mjs';
import * as workspaceSessionView from './workspace-session-view.mjs';
import { createEmptySession } from './session-crud.mjs';
import {
  buildProviderImageOptionProfiles,
  getEnabledProviderModelAspectRatios,
  getProviderModelAspectRatios,
  getProviderModelQualityOptions,
} from './image-provider-option-profiles.mjs';
import {
  CANVAS_TEXT_GENERATION_CONCURRENCY_LIMIT,
  canItemAcceptIncomingConnection,
  canSubmitImageCardPanel,
  canSubmitTextCardPanel,
  getDefaultImageCardModelOption,
  getAutoResizedTextareaMetrics,
  syncAutoResizedTextareaLayout,
  appendImageCardOutput,
  buildAsyncImageTaskRequests,
  buildCanvasImageGenerationFailureMessage,
  buildCanvasImageGenerationRequest,
  buildCanvasImagePanelSubmitInput,
  buildImageCardOutputsState,
  buildCanvasTextPanelSubmitInput,
  buildCanvasTextGenerationRequest,
  createCanvasCardItemAtCanvasPoint,
  createWorkspaceModelOptions,
  buildReferenceImageRequestPayload,
  orderLinkedImagePreviewsByReferenceIds,
  canEnterManualTextMode,
  canStartCanvasTextGeneration,
  finalizeManualTextCardItem,
  findWorkspaceModelOption,
  getDefaultTextPanelModelOption,
  getDirectImagePreviewsForTextCard,
  getCurrentImageCardOutput,
  getDirectTextInputsForTextCard,
  getDisplayableTextCardPanelDraft,
  getGeneratedImageHistoryEntries,
  getSupportedImageCardSizeOptions,
  getImageToolResultSpawnPosition,
  getGenerationDurationDisplay,
  getSelectedImageToolbarSource,
  getTextCardPanelPlaceholder,
  getImageCardQualitySummary,
  getImageCardResolutionStatus,
  getImageCardFrameSizeForAspectRatio,
  getImageCardItemSizeForFrameSize,
  getImageCardItemSizeForNaturalImage,
  getResolutionFailureReason,
  isImageAssetItem,
  isImageCardItem,
  isOutputResolutionSufficient,
  moveCanvasItemsToFront,
  removeCanvasTextGenerationEntry,
  isEventInsideTextCardPanel,
  resolveRequestedResolutionTier,
  shouldSubmitTextCardPanelEnter,
  shouldFocusTextCardPanelInputOnPointerDown,
  getTextCardVisualState,
  resolveTextPanelChatModel,
  resolveSessionPresentationState,
  resolveImageCardModel,
  resolveImageCardSize,
  resolveImageCardSizeForAspectRatio,
  normalizeImageCardAspectRatio,
  resolveCanvasImageTaskExecutionMode,
  resolveFloatingPopoverOffset,
  resolveImageGenerationFallbackSizes,
  resolveProviderDeletionFallbacks,
  syncImageCardOptionsForProviderModel,
  extractImageFilesFromClipboardItems,
  getReplacedImageAssetItem,
  resolveCanvasImagePasteTarget,
  reorderIncomingImageConnections,
  settleCanvasImageGenerationRequests,
  shouldHandleCanvasImagePaste,
  shouldPreventScrollableRegionWheelDefault,
  getViewportCenteredOnBounds,
} from './workspace-session-view.mjs';

test('getSessionConversationCount sums topic messages before falling back to legacy messages', () => {
  assert.equal(typeof workspaceSessionView.getSessionConversationCount, 'function');

  const session = {
    ...createEmptySession({ existingCount: 0, now: 100 }),
    messages: [{ id: 'legacy-1', role: 'assistant', content: 'legacy' }],
    topics: [
      {
        id: 'topic-1',
        title: 'Topic 1',
        messages: [
          { id: 'msg-1', role: 'assistant', content: 'one' },
          { id: 'msg-2', role: 'user', content: 'two' },
        ],
        createdAt: 100,
        updatedAt: 100,
      },
      {
        id: 'topic-2',
        title: 'Topic 2',
        messages: [{ id: 'msg-3', role: 'assistant', content: 'three' }],
        createdAt: 101,
        updatedAt: 101,
      },
    ],
  };

  assert.equal(workspaceSessionView.getSessionConversationCount(session), 3);
});

test('getSessionConversationCount falls back to legacy messages when topics are absent', () => {
  assert.equal(typeof workspaceSessionView.getSessionConversationCount, 'function');

  const session = {
    ...createEmptySession({ existingCount: 0, now: 100 }),
    topics: [],
    messages: [
      { id: 'msg-1', role: 'assistant', content: 'one' },
      { id: 'msg-2', role: 'user', content: 'two' },
    ],
  };

  assert.equal(workspaceSessionView.getSessionConversationCount(session), 2);
});

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

test('getGeneratedImageHistoryEntries keeps only generated images and sorts newest items first', () => {
  const result = getGeneratedImageHistoryEntries({
    sessions: [
      {
        id: 'session-chat',
        name: '聊天生成',
        createdAt: 1700000000000,
        updatedAt: 1700000000250,
        items: [
          {
            id: 'image-asset-1',
            type: 'image',
            src: '/asset.png',
            naturalWidth: 800,
            naturalHeight: 600,
          },
        ],
        connections: [],
        messages: [],
        topics: [
          {
            id: 'topic-1',
            title: 'Topic 1',
            createdAt: 1700000000000,
            updatedAt: 1700000000250,
            messages: [
              {
                id: 'msg-1700000000100-old',
                role: 'assistant',
                content: '',
                imageUrl: '/chat-old.png',
              },
              {
                id: 'msg-1700000000200-new',
                role: 'assistant',
                content: '',
                imageUrl: '/chat-new.png',
              },
            ],
          },
        ],
      },
      {
        id: 'session-card',
        name: '画布生成',
        createdAt: 1700000000000,
        updatedAt: 1700000000300,
        items: [
          {
            id: 'image-card-1700000000300',
            type: 'image',
            imageVariant: 'card',
            imageOutputs: [
              { src: '/card-first.png', naturalWidth: 1024, naturalHeight: 1024 },
              { src: '/card-second.png', naturalWidth: 1024, naturalHeight: 1024 },
            ],
          },
        ],
        connections: [],
        messages: [],
        topics: [],
      },
    ],
  });

  assert.deepEqual(
    result.map((entry) => ({ src: entry.src, source: entry.source, sessionId: entry.sessionId })),
    [
      { src: '/card-second.png', source: 'image-card', sessionId: 'session-card' },
      { src: '/card-first.png', source: 'image-card', sessionId: 'session-card' },
      { src: '/chat-new.png', source: 'chat', sessionId: 'session-chat' },
      { src: '/chat-old.png', source: 'chat', sessionId: 'session-chat' },
    ]
  );
});

test('getGeneratedImageHistoryEntries falls back to topic order when chat image message ids do not contain timestamps', () => {
  const result = getGeneratedImageHistoryEntries({
    sessions: [
      {
        id: 'session-chat-fallback',
        name: '聊天回退',
        createdAt: 1700000000000,
        updatedAt: 1700000000400,
        items: [],
        connections: [],
        messages: [],
        topics: [
          {
            id: 'topic-fallback',
            title: 'Topic fallback',
            createdAt: 1700000000000,
            updatedAt: 1700000000400,
            messages: [
              {
                id: 'msg-alpha',
                role: 'assistant',
                content: '',
                imageUrl: '/fallback-old.png',
              },
              {
                id: 'msg-beta',
                role: 'assistant',
                content: '',
                imageUrl: '/fallback-new.png',
              },
            ],
          },
        ],
      },
    ],
  });

  assert.deepEqual(
    result.map((entry) => entry.src),
    ['/fallback-new.png', '/fallback-old.png']
  );
});

test('getGeneratedImageHistoryEntries prefers image-card output file timestamps over older card ids', () => {
  const result = getGeneratedImageHistoryEntries({
    sessions: [
      {
        id: 'session-mixed-order',
        name: '混合排序',
        createdAt: 1700000000000,
        updatedAt: 1700000000300,
        items: [
          {
            id: 'image-card-1700000000100',
            type: 'image',
            imageVariant: 'card',
            imageOutputs: [
              {
                src: '/uploads/generated/img-1700000000500-fresh.png',
                naturalWidth: 1024,
                naturalHeight: 1024,
              },
            ],
          },
        ],
        connections: [],
        messages: [],
        topics: [
          {
            id: 'topic-mixed',
            title: 'Mixed',
            createdAt: 1700000000000,
            updatedAt: 1700000000200,
            messages: [
              {
                id: 'msg-1700000000200-chat',
                role: 'assistant',
                content: '',
                imageUrl: '/uploads/generated/img-1700000000200-chat.png',
              },
            ],
          },
        ],
      },
    ],
  });

  assert.deepEqual(
    result.map((entry) => ({ src: entry.src, source: entry.source })),
    [
      { src: '/uploads/generated/img-1700000000500-fresh.png', source: 'image-card' },
      { src: '/uploads/generated/img-1700000000200-chat.png', source: 'chat' },
    ]
  );
});

test('getGeneratedImageHistoryEntries prefers chat image file timestamps when message ids do not contain timestamps', () => {
  const result = getGeneratedImageHistoryEntries({
    sessions: [
      {
        id: 'session-chat-file-order',
        name: '聊天文件名排序',
        createdAt: 1700000000000,
        updatedAt: 1700000000400,
        items: [],
        connections: [],
        messages: [],
        topics: [
          {
            id: 'topic-file-order',
            title: 'File order',
            createdAt: 1700000000000,
            updatedAt: 1700000000400,
            messages: [
              {
                id: 'msg-alpha',
                role: 'assistant',
                content: '',
                imageUrl: '/uploads/generated/img-1700000000500-newest.png',
              },
              {
                id: 'msg-beta',
                role: 'assistant',
                content: '',
                imageUrl: '/uploads/generated/img-1700000000100-oldest.png',
              },
            ],
          },
        ],
      },
    ],
  });

  assert.deepEqual(
    result.map((entry) => entry.src),
    [
      '/uploads/generated/img-1700000000500-newest.png',
      '/uploads/generated/img-1700000000100-oldest.png',
    ]
  );
});

test('getGeneratedImageHistoryEntries keeps newer explicit session history entries above older chat fallback items', () => {
  const result = getGeneratedImageHistoryEntries({
    sessions: [
      {
        id: 'session-same-scale',
        name: '同量级排序',
        createdAt: 1700000000000,
        updatedAt: 1700000000400,
        generatedImageHistory: [
          {
            id: 'history-image-new',
            src: '/uploads/generated/img-1700000000500-image.png',
            createdAt: buildGeneratedImageHistorySortKey(1700000000500),
            source: 'image-card',
            sourceItemId: 'image-card-1',
          },
        ],
        items: [],
        connections: [],
        messages: [],
        topics: [
          {
            id: 'topic-old-chat',
            title: 'Old chat',
            createdAt: 1700000000000,
            updatedAt: 1700000000200,
            messages: [
              {
                id: 'msg-1700000000200-chat',
                role: 'assistant',
                content: '',
                imageUrl: '/uploads/generated/img-1700000000200-chat.png',
              },
            ],
          },
        ],
      },
    ],
  });

  assert.deepEqual(
    result.map((entry) => ({ src: entry.src, source: entry.source })),
    [
      { src: '/uploads/generated/img-1700000000500-image.png', source: 'image-card' },
      { src: '/uploads/generated/img-1700000000200-chat.png', source: 'chat' },
    ]
  );
});

test('getGeneratedImageHistoryEntries prefers the current session snapshot over the persisted session copy', () => {
  const result = getGeneratedImageHistoryEntries({
    sessions: [
      {
        id: 'session-live',
        name: '实时会话',
        createdAt: 1700000000000,
        updatedAt: 1700000000100,
        items: [
          {
            id: 'image-card-1700000000001',
            type: 'image',
            imageVariant: 'card',
            imageOutputs: [{ src: '/persisted-card.png', naturalWidth: 1024, naturalHeight: 1024 }],
          },
        ],
        connections: [],
        messages: [],
        topics: [
          {
            id: 'topic-persisted',
            title: 'Persisted',
            createdAt: 1700000000000,
            updatedAt: 1700000000100,
            messages: [
              {
                id: 'msg-persisted',
                role: 'assistant',
                content: '',
                imageUrl: '/persisted-chat.png',
              },
            ],
          },
        ],
      },
      {
        id: 'session-other',
        name: '其它会话',
        createdAt: 1700000000000,
        updatedAt: 1700000000200,
        items: [],
        connections: [],
        messages: [],
        topics: [
          {
            id: 'topic-other',
            title: 'Other',
            createdAt: 1700000000000,
            updatedAt: 1700000000200,
            messages: [
              {
                id: 'msg-1700000000200-other',
                role: 'assistant',
                content: '',
                imageUrl: '/other-chat.png',
              },
            ],
          },
        ],
      },
    ],
    currentSessionSnapshot: {
      id: 'session-live',
      name: '实时会话',
      createdAt: 1700000000000,
      updatedAt: 1700000000300,
      items: [
        {
          id: 'image-card-1700000000300',
          type: 'image',
          imageVariant: 'card',
          imageOutputs: [{ src: '/live-card.png', naturalWidth: 1024, naturalHeight: 1024 }],
        },
      ],
      connections: [],
      messages: [],
      topics: [
        {
          id: 'topic-live',
          title: 'Live',
          createdAt: 1700000000000,
          updatedAt: 1700000000300,
          messages: [
            {
              id: 'msg-1700000000300-live',
              role: 'assistant',
              content: '',
              imageUrl: '/live-chat.png',
            },
          ],
        },
      ],
    },
  });

  assert.deepEqual(
    result.map((entry) => entry.src),
    ['/live-card.png', '/live-chat.png', '/other-chat.png']
  );
});

test('getGeneratedImageHistoryEntries prefers append-only session history and merges archive entries without duplicate src values', () => {
  const result = getGeneratedImageHistoryEntries({
    sessions: [
      {
        id: 'session-history',
        name: '独立历史',
        createdAt: 1700000000000,
        updatedAt: 1700000000100,
        generatedImageHistory: [
          {
            id: 'history-1',
            src: '/uploads/generated/run-1.png',
            createdAt: 1700000000400,
            source: 'image-card',
            sourceItemId: 'image-card-1',
          },
          {
            id: 'history-2',
            src: '/uploads/generated/run-2.png',
            createdAt: 1700000000500,
            source: 'image-card',
            sourceItemId: 'image-card-1',
          },
        ],
        items: [
          {
            id: 'image-card-1',
            type: 'image',
            imageVariant: 'card',
            imageOutputs: [
              { src: '/uploads/generated/current-only.png', naturalWidth: 1024, naturalHeight: 1024 },
            ],
          },
        ],
        connections: [],
        messages: [],
        topics: [],
      },
    ],
    archiveEntries: [
      {
        id: 'archive-1',
        src: '/uploads/generated/run-2.png',
        createdAt: 1700000000600,
        source: 'archive',
      },
      {
        id: 'archive-2',
        src: '/uploads/generated/archive-only.png',
        createdAt: 1700000000550,
        source: 'archive',
      },
    ],
  });

  assert.deepEqual(
    result.map((entry) => ({ src: entry.src, source: entry.source })),
    [
      { src: '/uploads/generated/current-only.png', source: 'image-card' },
      { src: '/uploads/generated/archive-only.png', source: 'archive' },
      { src: '/uploads/generated/run-2.png', source: 'image-card' },
      { src: '/uploads/generated/run-1.png', source: 'image-card' },
    ]
  );
});

test('getGeneratedImageHistoryEntries keeps current image-card outputs visible even when the session already has generated history', () => {
  const result = getGeneratedImageHistoryEntries({
    sessions: [
      {
        id: 'session-current-card',
        name: '当前卡片',
        createdAt: 1700000000000,
        updatedAt: 1700000000200,
        generatedImageHistory: [
          {
            id: 'history-1',
            src: '/uploads/generated/older-run.png',
            createdAt: 1700000000100,
            source: 'image-card',
            sourceItemId: 'image-card-1',
          },
        ],
        items: [
          {
            id: 'image-card-1',
            type: 'image',
            imageVariant: 'card',
            imageOutputs: [
              { src: '/uploads/generated/current-run.png', naturalWidth: 1024, naturalHeight: 1024 },
            ],
          },
        ],
        connections: [],
        messages: [],
        topics: [],
      },
    ],
  });

  assert.deepEqual(
    result.map((entry) => entry.src),
    ['/uploads/generated/current-run.png', '/uploads/generated/older-run.png']
  );
});

test('getSelectedImageToolbarSource returns the selected image asset output first and falls back to image card output', () => {
  assert.deepEqual(
    getSelectedImageToolbarSource({
      selectedId: 'asset-1',
      selectedIds: ['asset-1'],
      itemById: {
        'asset-1': {
          id: 'asset-1',
          type: 'image',
          src: '/asset.png',
        },
      },
    }),
    {
      itemId: 'asset-1',
      src: '/asset.png',
      kind: 'asset',
    }
  );

  assert.deepEqual(
    getSelectedImageToolbarSource({
      selectedId: 'card-1',
      selectedIds: ['card-1'],
      itemById: {
        'card-1': {
          id: 'card-1',
          type: 'image',
          imageVariant: 'card',
          src: '/card-current.png',
        },
      },
    }),
    {
      itemId: 'card-1',
      src: '/card-current.png',
      kind: 'card',
    }
  );
});

test('getSelectedImageToolbarSource returns null for multi-select and items without a current image source', () => {
  assert.equal(
    getSelectedImageToolbarSource({
      selectedId: 'asset-1',
      selectedIds: ['asset-1', 'asset-2'],
      itemById: {
        'asset-1': { id: 'asset-1', type: 'image', src: '/asset.png' },
      },
    }),
    null
  );

  assert.equal(
    getSelectedImageToolbarSource({
      selectedId: 'card-1',
      selectedIds: ['card-1'],
      itemById: {
        'card-1': {
          id: 'card-1',
          type: 'image',
          imageVariant: 'card',
        },
      },
    }),
    null
  );
});

test('getImageToolResultSpawnPosition places the new image node to the right of the source node with a small offset', () => {
  assert.deepEqual(
    getImageToolResultSpawnPosition({
      sourceItem: {
        id: 'source-1',
        type: 'image',
        x: 120,
        y: 240,
        width: 360,
        height: 240,
      },
      nextSize: {
        width: 256,
        height: 384,
      },
    }),
    {
      x: 528,
      y: 192,
    }
  );
});

test('extractImageFilesFromClipboardItems keeps image files in clipboard order and ignores other entries', () => {
  const firstImage = { name: 'first.png' };
  const secondImage = { name: 'second.jpg' };

  const result = extractImageFilesFromClipboardItems([
    { type: 'text/plain', getAsFile: () => null },
    { type: 'image/png', getAsFile: () => firstImage },
    { type: 'image/jpeg', getAsFile: () => secondImage },
    { type: 'application/json', getAsFile: () => ({ name: 'ignored.json' }) },
  ]);

  assert.deepEqual(result, [firstImage, secondImage]);
});

test('shouldHandleCanvasImagePaste returns false for textarea, input, and contenteditable targets', () => {
  const buildTarget = ({ tagName, isContentEditable = false, closestResult = null }) => ({
    tagName,
    isContentEditable,
    closest: () => closestResult,
  });

  assert.equal(shouldHandleCanvasImagePaste(buildTarget({ tagName: 'TEXTAREA' })), false);
  assert.equal(shouldHandleCanvasImagePaste(buildTarget({ tagName: 'INPUT' })), false);
  assert.equal(
    shouldHandleCanvasImagePaste(buildTarget({ tagName: 'DIV', isContentEditable: true })),
    false
  );
  assert.equal(
    shouldHandleCanvasImagePaste(
      buildTarget({ tagName: 'SPAN', closestResult: { tagName: 'DIV', isContentEditable: true } })
    ),
    false
  );
});

test('shouldHandleCanvasImagePaste returns true for non-editable canvas targets and missing targets', () => {
  const target = {
    tagName: 'DIV',
    isContentEditable: false,
    closest: () => null,
  };

  assert.equal(shouldHandleCanvasImagePaste(target), true);
  assert.equal(shouldHandleCanvasImagePaste(null), true);
});

test('createCanvasClipboardSnapshot keeps selected items in canvas order and copies bound panel state', () => {
  assert.equal(typeof workspaceSessionView.createCanvasClipboardSnapshot, 'function');

  const snapshot = workspaceSessionView.createCanvasClipboardSnapshot({
    items: [
      {
        id: 'image-asset-1',
        type: 'image',
        x: 20,
        y: 30,
        width: 160,
        height: 120,
        rotation: 0,
        src: '/asset.png',
        naturalWidth: 1600,
        naturalHeight: 1200,
        visible: true,
        locked: false,
      },
      {
        id: 'text-card-1',
        type: 'text',
        x: 240,
        y: 100,
        width: 320,
        height: 220,
        rotation: 0,
        textVariant: 'card',
        textMode: 'manual',
        text: '品牌主张',
        visible: true,
        locked: false,
      },
      {
        id: 'image-card-1',
        type: 'image',
        x: 620,
        y: 180,
        width: 384,
        height: 384,
        rotation: 0,
        imageVariant: 'card',
        src: '/outputs/cover.png',
        naturalWidth: 1024,
        naturalHeight: 1024,
        imageOutputs: [
          {
            src: '/outputs/cover.png',
            naturalWidth: 1024,
            naturalHeight: 1024,
          },
        ],
        activeImageOutputIndex: 0,
        visible: true,
        locked: false,
      },
    ],
    selectedIds: ['image-card-1', 'text-card-1'],
    textCardPanelDrafts: {
      'text-card-1': '给我一句简短品牌口号',
      'other-text': 'ignore',
    },
    textCardProviderById: {
      'text-card-1': 'comfly',
      'other-text': 'ignore',
    },
    textCardModelById: {
      'text-card-1': 'gemini-3.5-flash',
      'other-text': 'ignore',
    },
    imageCardPanelDrafts: {
      'image-card-1': '做一张主视觉海报',
      'other-image': 'ignore',
    },
    imageCardProviderById: {
      'image-card-1': 'comfly',
      'other-image': 'ignore',
    },
    imageCardModelById: {
      'image-card-1': 'flux-dev',
      'other-image': 'ignore',
    },
    imageCardSizeById: {
      'image-card-1': '1024x1024',
      'other-image': 'ignore',
    },
    imageCardQualityById: {
      'image-card-1': 'high',
      'other-image': 'ignore',
    },
    imageCardCountById: {
      'image-card-1': 3,
      'other-image': 2,
    },
    imageCardAspectRatioById: {
      'image-card-1': '16:9',
      'other-image': '1:1',
    },
  });

  assert.deepEqual(snapshot, {
    items: [
      {
        id: 'text-card-1',
        type: 'text',
        x: 240,
        y: 100,
        width: 320,
        height: 220,
        rotation: 0,
        textVariant: 'card',
        textMode: 'manual',
        text: '品牌主张',
        visible: true,
        locked: false,
      },
      {
        id: 'image-card-1',
        type: 'image',
        x: 620,
        y: 180,
        width: 384,
        height: 384,
        rotation: 0,
        imageVariant: 'card',
        src: '/outputs/cover.png',
        naturalWidth: 1024,
        naturalHeight: 1024,
        imageOutputs: [
          {
            src: '/outputs/cover.png',
            naturalWidth: 1024,
            naturalHeight: 1024,
          },
        ],
        activeImageOutputIndex: 0,
        visible: true,
        locked: false,
      },
    ],
    bounds: {
      left: 240,
      top: 100,
      right: 1004,
      bottom: 564,
    },
    textCardPanelDrafts: {
      'text-card-1': '给我一句简短品牌口号',
    },
    textCardProviderById: {
      'text-card-1': 'comfly',
    },
    textCardModelById: {
      'text-card-1': 'gemini-3.5-flash',
    },
    imageCardPanelDrafts: {
      'image-card-1': '做一张主视觉海报',
    },
    imageCardProviderById: {
      'image-card-1': 'comfly',
    },
    imageCardModelById: {
      'image-card-1': 'flux-dev',
    },
    imageCardSizeById: {
      'image-card-1': '1024x1024',
    },
    imageCardQualityById: {
      'image-card-1': 'high',
    },
    imageCardCountById: {
      'image-card-1': 3,
    },
    imageCardAspectRatioById: {
      'image-card-1': '16:9',
    },
  });
});

test('materializeCanvasClipboardPaste remaps ids, offsets items, and carries card state forward', () => {
  assert.equal(typeof workspaceSessionView.materializeCanvasClipboardPaste, 'function');

  const result = workspaceSessionView.materializeCanvasClipboardPaste({
    clipboard: {
      items: [
        {
          id: 'text-card-1',
          type: 'text',
          x: 240,
          y: 100,
          width: 320,
          height: 220,
          rotation: 0,
          textVariant: 'card',
          textMode: 'manual',
          text: '品牌主张',
          visible: true,
          locked: false,
        },
        {
          id: 'image-card-1',
          type: 'image',
          x: 620,
          y: 180,
          width: 384,
          height: 384,
          rotation: 0,
          imageVariant: 'card',
          src: '/outputs/cover.png',
          naturalWidth: 1024,
          naturalHeight: 1024,
          imageOutputs: [
            {
              src: '/outputs/cover.png',
              naturalWidth: 1024,
              naturalHeight: 1024,
            },
          ],
          activeImageOutputIndex: 0,
          visible: true,
          locked: false,
        },
      ],
      bounds: {
        left: 240,
        top: 100,
        right: 1004,
        bottom: 564,
      },
      textCardPanelDrafts: {
        'text-card-1': '给我一句简短品牌口号',
      },
      textCardProviderById: {
        'text-card-1': 'comfly',
      },
      textCardModelById: {
        'text-card-1': 'gemini-3.5-flash',
      },
      imageCardPanelDrafts: {
        'image-card-1': '做一张主视觉海报',
      },
      imageCardProviderById: {
        'image-card-1': 'comfly',
      },
      imageCardModelById: {
        'image-card-1': 'flux-dev',
      },
      imageCardSizeById: {
        'image-card-1': '1024x1024',
      },
      imageCardQualityById: {
        'image-card-1': 'high',
      },
      imageCardCountById: {
        'image-card-1': 3,
      },
      imageCardAspectRatioById: {
        'image-card-1': '16:9',
      },
    },
    pasteCount: 0,
    offsetStep: { x: 32, y: 32 },
    createId: (sourceId, index) => `copy-${index + 1}-${sourceId}`,
  });

  assert.deepEqual(result, {
    items: [
      {
        id: 'copy-1-text-card-1',
        type: 'text',
        x: 272,
        y: 132,
        width: 320,
        height: 220,
        rotation: 0,
        textVariant: 'card',
        textMode: 'manual',
        text: '品牌主张',
        visible: true,
        locked: false,
      },
      {
        id: 'copy-2-image-card-1',
        type: 'image',
        x: 652,
        y: 212,
        width: 384,
        height: 384,
        rotation: 0,
        imageVariant: 'card',
        src: '/outputs/cover.png',
        naturalWidth: 1024,
        naturalHeight: 1024,
        imageOutputs: [
          {
            src: '/outputs/cover.png',
            naturalWidth: 1024,
            naturalHeight: 1024,
          },
        ],
        activeImageOutputIndex: 0,
        visible: true,
        locked: false,
      },
    ],
    selectedIds: ['copy-1-text-card-1', 'copy-2-image-card-1'],
    textCardPanelDrafts: {
      'copy-1-text-card-1': '给我一句简短品牌口号',
    },
    textCardProviderById: {
      'copy-1-text-card-1': 'comfly',
    },
    textCardModelById: {
      'copy-1-text-card-1': 'gemini-3.5-flash',
    },
    imageCardPanelDrafts: {
      'copy-2-image-card-1': '做一张主视觉海报',
    },
    imageCardProviderById: {
      'copy-2-image-card-1': 'comfly',
    },
    imageCardModelById: {
      'copy-2-image-card-1': 'flux-dev',
    },
    imageCardSizeById: {
      'copy-2-image-card-1': '1024x1024',
    },
    imageCardQualityById: {
      'copy-2-image-card-1': 'high',
    },
    imageCardCountById: {
      'copy-2-image-card-1': 3,
    },
    imageCardAspectRatioById: {
      'copy-2-image-card-1': '16:9',
    },
    nextPasteCount: 1,
  });
});

test('materializeCanvasClipboardPaste can remap ids without offsetting positions for alt-drag copies', () => {
  const result = workspaceSessionView.materializeCanvasClipboardPaste({
    clipboard: {
      items: [
        {
          id: 'text-card-1',
          type: 'text',
          x: 240,
          y: 100,
          width: 320,
          height: 220,
          rotation: 0,
          textVariant: 'card',
          textMode: 'manual',
          text: '品牌主张',
          visible: true,
          locked: false,
        },
        {
          id: 'image-card-1',
          type: 'image',
          x: 620,
          y: 180,
          width: 384,
          height: 384,
          rotation: 0,
          imageVariant: 'card',
          visible: true,
          locked: false,
        },
      ],
      textCardPanelDrafts: {
        'text-card-1': '给我一句简短品牌口号',
      },
      imageCardPanelDrafts: {
        'image-card-1': '做一张主视觉海报',
      },
      imageCardProviderById: {
        'image-card-1': 'comfly',
      },
      imageCardModelById: {
        'image-card-1': 'flux-dev',
      },
      imageCardSizeById: {
        'image-card-1': '1024x1024',
      },
      imageCardQualityById: {
        'image-card-1': 'high',
      },
      imageCardCountById: {
        'image-card-1': 3,
      },
      imageCardAspectRatioById: {
        'image-card-1': '16:9',
      },
    },
    pasteCount: 0,
    offsetStep: { x: 0, y: 0 },
    createId: (sourceId, index) => `alt-copy-${index + 1}-${sourceId}`,
  });

  assert.deepEqual(
    result.items.map((item) => ({ id: item.id, x: item.x, y: item.y })),
    [
      { id: 'alt-copy-1-text-card-1', x: 240, y: 100 },
      { id: 'alt-copy-2-image-card-1', x: 620, y: 180 },
    ]
  );
  assert.deepEqual(result.selectedIds, ['alt-copy-1-text-card-1', 'alt-copy-2-image-card-1']);
  assert.deepEqual(result.textCardPanelDrafts, {
    'alt-copy-1-text-card-1': '给我一句简短品牌口号',
  });
  assert.deepEqual(result.imageCardPanelDrafts, {
    'alt-copy-2-image-card-1': '做一张主视觉海报',
  });
  assert.deepEqual(result.imageCardProviderById, {
    'alt-copy-2-image-card-1': 'comfly',
  });
  assert.deepEqual(result.imageCardModelById, {
    'alt-copy-2-image-card-1': 'flux-dev',
  });
  assert.deepEqual(result.imageCardSizeById, {
    'alt-copy-2-image-card-1': '1024x1024',
  });
  assert.deepEqual(result.imageCardQualityById, {
    'alt-copy-2-image-card-1': 'high',
  });
  assert.deepEqual(result.imageCardCountById, {
    'alt-copy-2-image-card-1': 3,
  });
  assert.deepEqual(result.imageCardAspectRatioById, {
    'alt-copy-2-image-card-1': '16:9',
  });
});

test('resolveCanvasImagePasteTarget returns replace for a single selected image asset item', () => {
  const result = resolveCanvasImagePasteTarget({
    selectedId: 'image-1',
    selectedIds: ['image-1'],
    itemById: {
      'image-1': {
        id: 'image-1',
        type: 'image',
        src: '/old.png',
      },
    },
  });

  assert.deepEqual(result, {
    mode: 'replace',
    itemId: 'image-1',
  });
});

test('resolveCanvasImagePasteTarget returns create for image cards, non-images, multi-select, and empty selection', () => {
  assert.deepEqual(
    resolveCanvasImagePasteTarget({
      selectedId: 'image-card-1',
      selectedIds: ['image-card-1'],
      itemById: {
        'image-card-1': {
          id: 'image-card-1',
          type: 'image',
          imageVariant: 'card',
        },
      },
    }),
    { mode: 'create' }
  );

  assert.deepEqual(
    resolveCanvasImagePasteTarget({
      selectedId: 'text-1',
      selectedIds: ['text-1'],
      itemById: {
        'text-1': {
          id: 'text-1',
          type: 'text',
          textVariant: 'card',
        },
      },
    }),
    { mode: 'create' }
  );

  assert.deepEqual(
    resolveCanvasImagePasteTarget({
      selectedId: 'image-1',
      selectedIds: ['image-1', 'image-2'],
      itemById: {
        'image-1': { id: 'image-1', type: 'image', src: '/old.png' },
        'image-2': { id: 'image-2', type: 'image', src: '/other.png' },
      },
    }),
    { mode: 'create' }
  );

  assert.deepEqual(
    resolveCanvasImagePasteTarget({
      selectedId: null,
      selectedIds: [],
      itemById: {},
    }),
    { mode: 'create' }
  );
});

test('moveCanvasItemsToFront moves a single selected item to the end of the canvas item order', () => {
  const items = [
    { id: 'a', type: 'shape' },
    { id: 'b', type: 'text', textVariant: 'card' },
    { id: 'c', type: 'image', src: '/c.png' },
  ];

  const result = moveCanvasItemsToFront(items, ['b']);

  assert.deepEqual(
    result.map((item) => item.id),
    ['a', 'c', 'b']
  );
});

test('moveCanvasItemsToFront moves multiple selected items together while preserving their relative order', () => {
  const items = [
    { id: 'a', type: 'shape' },
    { id: 'b', type: 'text', textVariant: 'card' },
    { id: 'c', type: 'image', src: '/c.png' },
    { id: 'd', type: 'image', imageVariant: 'card' },
  ];

  const result = moveCanvasItemsToFront(items, ['b', 'd']);

  assert.deepEqual(
    result.map((item) => item.id),
    ['a', 'c', 'b', 'd']
  );
});

test('moveCanvasItemsToFront ignores empty, duplicate, and invalid selected ids without disturbing other item order', () => {
  const items = [
    { id: 'a', type: 'shape' },
    { id: 'b', type: 'text', textVariant: 'card' },
    { id: 'c', type: 'image', src: '/c.png' },
  ];

  assert.deepEqual(moveCanvasItemsToFront(items, []).map((item) => item.id), ['a', 'b', 'c']);
  assert.deepEqual(moveCanvasItemsToFront(items, ['missing']).map((item) => item.id), ['a', 'b', 'c']);
  assert.deepEqual(moveCanvasItemsToFront(items, ['b', 'b', 'missing']).map((item) => item.id), ['a', 'c', 'b']);
});

test('getReplacedImageAssetItem keeps the node id and center while resizing to the new image ratio', () => {
  const result = getReplacedImageAssetItem(
    {
      id: 'image-1',
      type: 'image',
      x: 100,
      y: 200,
      width: 1024,
      height: 512,
      rotation: 0,
      src: '/old.png',
      naturalWidth: 2000,
      naturalHeight: 1000,
      visible: true,
      locked: false,
    },
    {
      src: '/new.png',
      naturalWidth: 1000,
      naturalHeight: 2000,
    }
  );

  assert.equal(result.id, 'image-1');
  assert.equal(result.src, '/new.png');
  assert.equal(result.naturalWidth, 1000);
  assert.equal(result.naturalHeight, 2000);
  assert.equal(result.x + result.width / 2, 612);
  assert.equal(result.y + result.height / 2, 456);
  assert.equal(result.width, 512);
  assert.equal(result.height, 1024);
});

test('reorderIncomingImageConnections reorders only image inputs for the targeted card while keeping other connections stable', () => {
  const connections = [
    { id: 'conn-text-before', fromItemId: 'text-1', toItemId: 'card-1' },
    { id: 'conn-img-1', fromItemId: 'img-1', toItemId: 'card-1' },
    { id: 'conn-other-target', fromItemId: 'img-3', toItemId: 'card-2' },
    { id: 'conn-img-2', fromItemId: 'img-2', toItemId: 'card-1' },
    { id: 'conn-text-after', fromItemId: 'text-2', toItemId: 'card-1' },
  ];

  const result = reorderIncomingImageConnections({
    connections,
    itemById: {
      'img-1': { id: 'img-1', type: 'image', src: '/a.png' },
      'img-2': { id: 'img-2', type: 'image', src: '/b.png' },
      'img-3': { id: 'img-3', type: 'image', src: '/c.png' },
      'text-1': { id: 'text-1', type: 'text', text: 'before' },
      'text-2': { id: 'text-2', type: 'text', text: 'after' },
    },
    targetItemId: 'card-1',
    fromImageItemId: 'img-2',
    toImageItemId: 'img-1',
  });

  assert.deepEqual(result, [
    { id: 'conn-text-before', fromItemId: 'text-1', toItemId: 'card-1' },
    { id: 'conn-img-2', fromItemId: 'img-2', toItemId: 'card-1' },
    { id: 'conn-other-target', fromItemId: 'img-3', toItemId: 'card-2' },
    { id: 'conn-img-1', fromItemId: 'img-1', toItemId: 'card-1' },
    { id: 'conn-text-after', fromItemId: 'text-2', toItemId: 'card-1' },
  ]);
});

test('reorderIncomingImageConnections updates preview order and downstream reference image payload order', () => {
  const connections = reorderIncomingImageConnections({
    connections: [
      { id: 'conn-1', fromItemId: 'img-1', toItemId: 'card-1' },
      { id: 'conn-2', fromItemId: 'img-2', toItemId: 'card-1' },
    ],
    itemById: {
      'img-1': { id: 'img-1', type: 'image', src: '/a.png' },
      'img-2': { id: 'img-2', type: 'image', src: '/b.png' },
    },
    targetItemId: 'card-1',
    fromImageItemId: 'img-2',
    toImageItemId: 'img-1',
  });

  const previews = getDirectImagePreviewsForTextCard({
    textCardId: 'card-1',
    items: [
      { id: 'img-1', type: 'image', src: '/a.png' },
      { id: 'img-2', type: 'image', src: '/b.png' },
      { id: 'card-1', type: 'image', imageVariant: 'card' },
    ],
    connections,
  });

  assert.deepEqual(previews, [
    { id: 'img-2', src: '/b.png', label: 'image1', alt: 'image1' },
    { id: 'img-1', src: '/a.png', label: 'image2', alt: 'image2' },
  ]);
  assert.deepEqual(buildReferenceImageRequestPayload(previews), {
    referenceImages: ['/b.png', '/a.png'],
    referenceLabels: ['image1', 'image2'],
  });
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

test('canItemAcceptIncomingConnection allows image cards as incoming targets', () => {
  const result = canItemAcceptIncomingConnection({
    id: 'image-card-1',
    type: 'image',
    imageVariant: 'card',
  });

  assert.equal(result, true);
});

test('canItemAcceptIncomingConnection rejects legacy image assets', () => {
  const result = canItemAcceptIncomingConnection({
    id: 'image-1',
    type: 'image',
    src: '/a.png',
  });

  assert.equal(result, false);
});

test('isImageCardItem returns true for image component cards', () => {
  const result = isImageCardItem({
    id: 'image-card-1',
    type: 'image',
    imageVariant: 'card',
  });

  assert.equal(result, true);
});

test('isImageCardItem returns false for legacy image assets with src only', () => {
  const result = isImageCardItem({
    id: 'image-asset-1',
    type: 'image',
    src: '/a.png',
  });

  assert.equal(result, false);
});

test('isImageAssetItem returns true for legacy image assets with src only', () => {
  const result = isImageAssetItem({
    id: 'image-asset-1',
    type: 'image',
    src: '/a.png',
  });

  assert.equal(result, true);
});

test('isImageAssetItem returns false for image cards', () => {
  const result = isImageAssetItem({
    id: 'image-card-1',
    type: 'image',
    imageVariant: 'card',
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

test('canItemAcceptIncomingConnection keeps canvas annotations outside the node graph', () => {
  assert.equal(canItemAcceptIncomingConnection({ id: 'stroke-1', type: 'stroke' }), false);
  assert.equal(canItemAcceptIncomingConnection({
    id: 'annotation-text-1',
    type: 'text',
    textVariant: 'annotation',
  }), false);
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

test('getDirectImagePreviewsForTextCard also returns direct image previews for image card targets in connection order', () => {
  const result = getDirectImagePreviewsForTextCard({
    textCardId: 'image-card-1',
    items: [
      { id: 'img-1', type: 'image', src: '/a.png' },
      { id: 'img-2', type: 'image', src: '/b.png' },
      { id: 'image-card-1', type: 'image', imageVariant: 'card' },
    ],
    connections: [
      { id: 'conn-1', fromItemId: 'img-2', toItemId: 'image-card-1' },
      { id: 'conn-2', fromItemId: 'img-1', toItemId: 'image-card-1' },
    ],
  });

  assert.deepEqual(result, [
    { id: 'img-2', src: '/b.png', label: 'image1', alt: 'image1' },
    { id: 'img-1', src: '/a.png', label: 'image2', alt: 'image2' },
  ]);
});

test('getDirectImagePreviewsForTextCard uses the current active output from a multi-image card source', () => {
  const result = getDirectImagePreviewsForTextCard({
    textCardId: 'text-1',
    items: [
      {
        id: 'image-card-1',
        type: 'image',
        imageVariant: 'card',
        src: '/stale-preview.png',
        activeImageOutputIndex: 1,
        imageOutputs: [
          { src: '/first-output.png', naturalWidth: 1024, naturalHeight: 1024 },
          { src: '/second-output.png', naturalWidth: 1024, naturalHeight: 1792 },
        ],
      },
      { id: 'text-1', type: 'text', textVariant: 'card' },
    ],
    connections: [{ id: 'conn-1', fromItemId: 'image-card-1', toItemId: 'text-1' }],
  });

  assert.deepEqual(result, [
    { id: 'image-card-1', src: '/second-output.png', label: 'image1', alt: 'image1' },
  ]);
});

test('canSubmitImageCardPanel returns true when prompt exists', () => {
  const result = canSubmitImageCardPanel({
    draft: '生成一张极简海报',
    linkedImagePreviews: [],
    linkedTexts: [],
  });

  assert.equal(result, true);
});

test('canSubmitImageCardPanel returns false when only linked reference images exist without any text prompt', () => {
  const result = canSubmitImageCardPanel({
    draft: '   ',
    linkedImagePreviews: [{ id: 'img-1', src: '/a.png', label: 'image1' }],
    linkedTexts: [],
  });

  assert.equal(result, false);
});

test('buildCanvasImagePanelSubmitInput appends linked text blocks after the draft with double newlines', () => {
  const result = buildCanvasImagePanelSubmitInput({
    draft: '生成包装静物图',
    linkedTexts: [
      { id: 'text-2', text: '第二段约束' },
      { id: 'text-1', text: '第一段约束' },
    ],
  });

  assert.equal(result, '生成包装静物图\n\n第二段约束\n\n第一段约束');
});

test('buildCanvasImagePanelSubmitInput can submit linked text even when draft is empty', () => {
  const result = buildCanvasImagePanelSubmitInput({
    draft: '   ',
    linkedTexts: [{ id: 'text-1', text: '上游文案' }],
  });

  assert.equal(result, '上游文案');
});

test('canSubmitImageCardPanel returns true when only linked text exists', () => {
  const result = canSubmitImageCardPanel({
    draft: '   ',
    linkedImagePreviews: [],
    linkedTexts: [{ id: 'text-1', text: '上游文案' }],
  });

  assert.equal(result, true);
});

test('canSubmitImageCardPanel returns true when reference images exist and linked text provides the prompt', () => {
  const result = canSubmitImageCardPanel({
    draft: '   ',
    linkedImagePreviews: [{ id: 'img-1', src: '/a.png', label: 'image1' }],
    linkedTexts: [{ id: 'text-1', text: '请基于参考图生成新版海报' }],
  });

  assert.equal(result, true);
});

test('canSubmitImageCardPanel returns false when both prompt and references are empty', () => {
  const result = canSubmitImageCardPanel({
    draft: '   ',
    linkedImagePreviews: [],
    linkedTexts: [],
  });

  assert.equal(result, false);
});

test('buildCanvasImageGenerationRequest only uses current prompt, direct image previews, and aspect ratio', () => {
  const result = buildCanvasImageGenerationRequest({
    input: '请做一张科技感 KV',
    linkedImagePreviews: [
      { id: 'img-2', src: '/b.png', label: 'image1', alt: 'image1' },
      { id: 'img-1', src: '/a.png', label: 'image2', alt: 'image2' },
    ],
    modelId: 'gemini-3.1-flash-image-preview',
    size: '2048x2048',
    count: 4,
    aspectRatio: '16:9',
  });

  assert.deepEqual(result, {
    messages: [{ role: 'user', content: '请做一张科技感 KV' }],
    intent: 'image',
    model: 'gemini-3.1-flash-image-preview',
    size: '2048x2048',
    n: 4,
    quality: 'auto',
    aspect_ratio: '16:9',
    reference_images: ['/b.png', '/a.png'],
    reference_labels: ['image1', 'image2'],
    executionMode: 'async',
  });
});

test('orderLinkedImagePreviewsByReferenceIds preserves canvas order when no model order is provided', () => {
  const previews = [
    { id: 'reference-a', src: '/a.png', label: 'A' },
    { id: 'reference-b', src: '/b.png', label: 'B' },
  ];

  assert.equal(orderLinkedImagePreviewsByReferenceIds(previews), previews);
});

test('orderLinkedImagePreviewsByReferenceIds follows the model-selected target and supporting reference order', () => {
  const previews = [
    { id: 'reference-a', src: '/a.png', label: 'A' },
    { id: 'reference-b', src: '/b.png', label: 'B' },
    { id: 'reference-c', src: '/c.png', label: 'C' },
  ];

  assert.deepEqual(
    orderLinkedImagePreviewsByReferenceIds(previews, [
      'reference-c',
      'reference-a',
      'reference-c',
      'missing-reference',
    ]),
    [previews[2], previews[0]],
  );
  assert.deepEqual(orderLinkedImagePreviewsByReferenceIds(previews, []), []);
});

test('buildCanvasImageGenerationRequest preserves 4K size requests for image cards', () => {
  const result = buildCanvasImageGenerationRequest({
    input: '请生成一张高精度产品海报',
    linkedImagePreviews: [],
    modelId: 'gemini-3.1-flash-image-preview',
    size: '4096x4096',
    count: 1,
    aspectRatio: '1:1',
  });

  assert.deepEqual(result, {
    messages: [{ role: 'user', content: '请生成一张高精度产品海报' }],
    intent: 'image',
    model: 'gemini-3.1-flash-image-preview',
    size: '4096x4096',
    n: 1,
    quality: 'auto',
    aspect_ratio: '1:1',
    executionMode: 'async',
  });
});

test('buildCanvasImageGenerationRequest preserves requested multi-image counts for supplier-native flows', () => {
  const result = buildCanvasImageGenerationRequest({
    input: '生成静物海报\n\n上游文案',
    linkedImagePreviews: [
      { id: 'img-2', src: '/b.png', label: 'image1', alt: 'image1' },
      { id: 'img-1', src: '/a.png', label: 'image2', alt: 'image2' },
    ],
    modelId: 'gemini-3.1-flash-image-preview',
    size: '2048x2048',
    count: 2,
    aspectRatio: '3:4',
  });

  assert.deepEqual(result, {
    messages: [{ role: 'user', content: '生成静物海报\n\n上游文案' }],
    intent: 'image',
    model: 'gemini-3.1-flash-image-preview',
    size: '2048x2048',
    n: 2,
    quality: 'auto',
    aspect_ratio: '3:4',
    reference_images: ['/b.png', '/a.png'],
    reference_labels: ['image1', 'image2'],
    executionMode: 'async',
  });
});

test('buildCanvasImageGenerationRequest defaults to async execution mode for image cards', () => {
  const result = buildCanvasImageGenerationRequest({
    input: '生成一张科技海报',
    linkedImagePreviews: [],
    modelId: 'gemini-3.1-flash-image-preview',
    size: '2048x2048',
    count: 1,
    aspectRatio: '1:1',
  });

  assert.deepEqual(result, {
    messages: [{ role: 'user', content: '生成一张科技海报' }],
    intent: 'image',
    model: 'gemini-3.1-flash-image-preview',
    size: '2048x2048',
    n: 1,
    quality: 'auto',
    aspect_ratio: '1:1',
    executionMode: 'async',
  });
});

test('buildAsyncImageTaskRequests expands multi-image generation into async single-image requests', () => {
  const result = buildAsyncImageTaskRequests({
    input: '生成包装海报\n\n上游文案',
    linkedImagePreviews: [
      { id: 'img-2', src: '/b.png', label: 'image1', alt: 'image1' },
      { id: 'img-1', src: '/a.png', label: 'image2', alt: 'image2' },
    ],
    modelId: 'gemini-3.1-flash-image-preview',
    size: '2048x2048',
    count: 2,
    aspectRatio: '3:4',
  });

  assert.equal(result.length, 2);
  assert.deepEqual(result[0], {
    messages: [{ role: 'user', content: '生成包装海报\n\n上游文案' }],
    intent: 'image',
    model: 'gemini-3.1-flash-image-preview',
    size: '2048x2048',
    n: 1,
    quality: 'auto',
    aspect_ratio: '3:4',
    reference_images: ['/b.png', '/a.png'],
    reference_labels: ['image1', 'image2'],
    executionMode: 'async',
  });
  assert.deepEqual(result[1], result[0]);
});

test('buildAsyncImageTaskRequests expands 4K multi-image generation into four exact-size single-image requests', () => {
  const result = buildAsyncImageTaskRequests({
    input: '生成 4K 主视觉',
    linkedImagePreviews: [],
    modelId: 'gemini-3.1-flash-image-preview',
    size: '4096x4096',
    count: 4,
    aspectRatio: '1:1',
  });

  assert.equal(result.length, 4);
  assert.deepEqual(result[0], {
    messages: [{ role: 'user', content: '生成 4K 主视觉' }],
    intent: 'image',
    model: 'gemini-3.1-flash-image-preview',
    size: '4096x4096',
    n: 1,
    quality: 'auto',
    aspect_ratio: '1:1',
    executionMode: 'async',
  });
  assert.deepEqual(result[3], result[0]);
});

test('resolveCanvasImageTaskExecutionMode now uses parallel mode for exact-size Gemini multi-image requests', () => {
  const result = resolveCanvasImageTaskExecutionMode({
    modelId: 'gemini-3.1-flash-image-preview',
    size: '2048x2048',
    count: 2,
  });

  assert.equal(result, 'parallel');
});

test('resolveCanvasImageTaskExecutionMode keeps all checked request shapes in parallel mode', () => {
  assert.equal(
    resolveCanvasImageTaskExecutionMode({
      modelId: 'gemini-3.1-flash-image-preview',
      size: '1024x1792',
      count: 2,
    }),
    'parallel'
  );

  assert.equal(
    resolveCanvasImageTaskExecutionMode({
      modelId: 'gemini-3.1-flash-image-preview',
      size: '2048x2048',
      count: 1,
    }),
    'parallel'
  );

  assert.equal(
    resolveCanvasImageTaskExecutionMode({
      modelId: 'gemini-3-pro-image-preview',
      size: '2048x2048',
      count: 2,
    }),
    'parallel'
  );
});


test('settleCanvasImageGenerationRequests runs serial tasks one at a time and preserves later successes after failures', async () => {
  let releaseFirstTask;
  const firstTaskGate = new Promise((resolve) => {
    releaseFirstTask = resolve;
  });
  const startedRequests = [];

  const resultPromise = settleCanvasImageGenerationRequests({
    requests: ['first', 'second'],
    executionMode: 'serial',
    runTask: async (requestId) => {
      startedRequests.push(requestId);
      if (requestId === 'first') {
        await firstTaskGate;
        throw new Error('socket closed');
      }
      return `${requestId}-ok`;
    },
  });

  await Promise.resolve();
  assert.deepEqual(startedRequests, ['first']);

  releaseFirstTask();
  const results = await resultPromise;

  assert.deepEqual(startedRequests, ['first', 'second']);
  assert.equal(results[0].status, 'rejected');
  assert.match(results[0].reason.message, /socket closed/);
  assert.deepEqual(results[1], { status: 'fulfilled', value: 'second-ok' });
});

test('settleCanvasImageGenerationRequests reports parallel results in completion order while preserving request order', async () => {
  const releases = new Map();
  const completionOrder = [];
  const resultPromise = settleCanvasImageGenerationRequests({
    requests: ['first', 'second', 'third', 'fourth'],
    executionMode: 'parallel',
    runTask: (requestId) => new Promise((resolve) => releases.set(requestId, resolve)),
    onSettled: (result, index) => completionOrder.push({ index, value: result.value }),
  });

  await Promise.resolve();
  releases.get('third')('third-ok');
  await Promise.resolve();
  releases.get('first')('first-ok');
  await Promise.resolve();
  releases.get('fourth')('fourth-ok');
  await Promise.resolve();
  releases.get('second')('second-ok');

  const results = await resultPromise;
  assert.deepEqual(completionOrder.map((item) => item.index), [2, 0, 3, 1]);
  assert.deepEqual(results.map((item) => item.value), ['first-ok', 'second-ok', 'third-ok', 'fourth-ok']);
});

test('buildCanvasImageGenerationFailureMessage asks for manual backfill when request failures leave missing outputs', () => {
  const result = buildCanvasImageGenerationFailureMessage({
    requestedCount: 2,
    completedCount: 1,
    requestFailureCount: 1,
  });

  assert.equal(result, '请求 2 张，成功 1 张；请手动补生成剩余 1 张');
});

test('buildCanvasImageGenerationFailureMessage returns null when outputs exist and there are no request failures', () => {
  const result = buildCanvasImageGenerationFailureMessage({
    requestedCount: 2,
    completedCount: 1,
    requestFailureCount: 0,
  });

  assert.equal(result, null);
});

test('buildCanvasImageGenerationFailureMessage ignores legacy validation failure inputs and only reports request failures', () => {
  const result = buildCanvasImageGenerationFailureMessage({
    requestedCount: 3,
    completedCount: 1,
    requestFailureCount: 1,
  });

  assert.equal(result, '请求 3 张，成功 1 张；请手动补生成剩余 1 张');
});

test('createCanvasCardItemAtCanvasPoint creates a text card centered on the spawn point', () => {
  const result = createCanvasCardItemAtCanvasPoint({
    kind: 'text',
    id: 'text-1',
    canvasPoint: { x: 400, y: 300 },
    width: 380,
    height: 430,
  });

  assert.deepEqual(result, {
    id: 'text-1',
    type: 'text',
    x: 210,
    y: 85,
    width: 380,
    height: 430,
    rotation: 0,
    textVariant: 'card',
    textMode: 'ai',
    visible: true,
    locked: false,
  });
});

test('createCanvasCardItemAtCanvasPoint creates an image card centered on the spawn point', () => {
  const result = createCanvasCardItemAtCanvasPoint({
    kind: 'image',
    id: 'image-card-1',
    canvasPoint: { x: 500, y: 320 },
    width: 380,
    height: 430,
  });

  assert.deepEqual(result, {
    id: 'image-card-1',
    type: 'image',
    x: 310,
    y: 105,
    width: 380,
    height: 430,
    rotation: 0,
    imageVariant: 'card',
    visible: true,
    locked: false,
  });
});

test('resolveFloatingPopoverOffset returns unscaled anchor offset inside the panel root', () => {
  const result = resolveFloatingPopoverOffset({
    panelRect: { left: 100, top: 220 },
    anchorRect: { left: 190, top: 300 },
    scale: 2,
  });

  assert.deepEqual(result, {
    left: 45,
    top: 40,
  });
});

test('resolveFloatingPopoverOffset can position a popover below the panel with a fixed screen gap', () => {
  const result = resolveFloatingPopoverOffset({
    panelRect: { left: 100, top: 220, bottom: 620 },
    anchorRect: { left: 190, top: 300 },
    scale: 2,
    placement: 'below-panel',
    gap: 12,
  });

  assert.deepEqual(result, {
    left: 45,
    top: 206,
  });
});

test('getViewportCenteredOnBounds keeps the selected bounds centered at scale one', () => {
  const viewport = {
    x: 120,
    y: 80,
    scale: 1,
  };

  const result = getViewportCenteredOnBounds(viewport, { left: 200, top: 140, width: 300, height: 120 }, 1200, 900);

  assert.deepEqual(result, {
    x: 250,
    y: 250,
    scale: 1,
  });
});

test('getViewportCenteredOnBounds keeps scale and only recenters x and y', () => {
  const viewport = {
    x: -40,
    y: 20,
    scale: 2,
  };

  const result = getViewportCenteredOnBounds(viewport, { left: 50, top: 75, width: 200, height: 100 }, 1000, 800);

  assert.deepEqual(result, {
    x: 200,
    y: 150,
    scale: 2,
  });
});

test('getViewportCenteredOnBounds returns the original viewport for invalid sizes or bounds', () => {
  const viewport = {
    x: 1,
    y: 2,
    scale: 1.5,
  };

  assert.equal(getViewportCenteredOnBounds(viewport, null, 1000, 800), viewport);
  assert.equal(getViewportCenteredOnBounds(viewport, { left: 0, top: 0, width: 10, height: 10 }, 0, 800), viewport);
});

test('resolveImageGenerationFallbackSizes returns the 4K to 2K to 1K fallback chain', () => {
  const result = resolveImageGenerationFallbackSizes('4096x4096');

  assert.deepEqual(result, ['4096x4096', '2048x2048', '1024x1024']);
});

test('resolveRequestedResolutionTier maps image card sizes onto 1K 2K and 4K tiers', () => {
  assert.equal(resolveRequestedResolutionTier('1024x1024'), '1K');
  assert.equal(resolveRequestedResolutionTier('2048x2048'), '2K');
  assert.equal(resolveRequestedResolutionTier('4096x4096'), '4K');
});

test('isOutputResolutionSufficient requires both sides to meet the target for square outputs', () => {
  assert.equal(
    isOutputResolutionSufficient({
      requestedSize: '2048x2048',
      aspectRatio: '1:1',
      naturalWidth: 2048,
      naturalHeight: 2048,
    }),
    true
  );
  assert.equal(
    isOutputResolutionSufficient({
      requestedSize: '2048x2048',
      aspectRatio: '1:1',
      naturalWidth: 2048,
      naturalHeight: 1536,
    }),
    false
  );
});

test('isOutputResolutionSufficient validates longest edge and requested ratio for non-square outputs', () => {
  assert.equal(
    isOutputResolutionSufficient({
      requestedSize: '2048x2048',
      aspectRatio: '16:9',
      naturalWidth: 2048,
      naturalHeight: 1152,
    }),
    true
  );
  assert.equal(
    isOutputResolutionSufficient({
      requestedSize: '2048x2048',
      aspectRatio: '16:9',
      naturalWidth: 2048,
      naturalHeight: 2048,
    }),
    false
  );
});

test('getResolutionFailureReason explains whether an output missed the target size or ratio', () => {
  assert.equal(
    getResolutionFailureReason({
      requestedSize: '4096x4096',
      aspectRatio: '1:1',
      naturalWidth: 2048,
      naturalHeight: 2048,
    }),
    '返回图未达到 4K 分辨率要求'
  );
  assert.equal(
    getResolutionFailureReason({
      requestedSize: '2048x2048',
      aspectRatio: '16:9',
      naturalWidth: 2048,
      naturalHeight: 2048,
    }),
    '返回图宽高比与请求的 16:9 不匹配'
  );
});

test('buildCanvasImageGenerationRequest falls back to the default image model for unsupported overrides', () => {
  const result = buildCanvasImageGenerationRequest({
    input: '生成一张海报',
    linkedImagePreviews: [],
    modelId: 'unsupported-image-model',
    size: '1024x1024',
    count: 2,
    aspectRatio: 'auto',
  });

  assert.deepEqual(result, {
    messages: [{ role: 'user', content: '生成一张海报' }],
    intent: 'image',
    model: 'gemini-3.1-flash-image-preview',
    size: '1024x1024',
    n: 2,
    quality: 'auto',
    executionMode: 'async',
  });
});

test('getDefaultImageCardModelOption returns Gemini 3.1 Flash Image as the default image-card model', () => {
  const result = getDefaultImageCardModelOption();

  assert.deepEqual(result, {
    id: 'gemini-3.1-flash-image-preview',
    label: 'Gemini 3.1 Flash Image',
  });
});

test('IMAGE_CARD_MODEL_OPTIONS exposes the supported image request models including gpt-image-2', () => {
  assert.deepEqual(workspaceSessionView.IMAGE_CARD_MODEL_OPTIONS, [
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
  ]);
});

test('getSupportedImageCardSizeOptions returns model-driven fixed size choices', () => {
  assert.deepEqual(
    getSupportedImageCardSizeOptions('gemini-2.5-flash-image').map((option) => option.id),
    ['1024x1024', '2048x2048', '4096x4096']
  );
});

test('createWorkspaceModelOptions and findWorkspaceModelOption preserve provider-scoped model choices', () => {
  const providers = [
    {
      id: 'provider-a',
      name: 'Provider A',
      enabled: true,
      imageModels: ['gpt-image-2', 'gpt-image-2', ''],
      chatModels: ['chat-a'],
    },
    {
      id: 'provider-b',
      name: '',
      enabled: true,
      imageModels: ['gemini-3.1-flash-image-preview'],
      chatModels: ['chat-b'],
    },
    {
      id: 'disabled',
      name: 'Disabled',
      enabled: false,
      imageModels: ['disabled-image'],
      chatModels: ['disabled-chat'],
    },
  ];

  const options = createWorkspaceModelOptions(
    providers,
    'image',
    [{ id: 'fallback-image', label: 'Fallback Image' }],
    (providerId) => `Label ${providerId}`
  );

  assert.deepEqual(options, [
    { id: 'gpt-image-2', label: 'gpt-image-2', providerId: 'provider-a', providerName: 'Provider A' },
    {
      id: 'gemini-3.1-flash-image-preview',
      label: 'gemini-3.1-flash-image-preview',
      providerId: 'provider-b',
      providerName: 'Label provider-b',
    },
  ]);
  assert.equal(findWorkspaceModelOption(options, 'gpt-image-2', 'provider-a')?.providerId, 'provider-a');
  assert.equal(findWorkspaceModelOption(options, '', 'provider-b')?.id, 'gemini-3.1-flash-image-preview');
});

test('resolveProviderDeletionFallbacks rewrites deleted provider card state to available providers', () => {
  const remainingProviders = [
    {
      id: 'comfly',
      name: 'Comfly',
      enabled: true,
      primary: true,
      imageModels: ['gpt-image-2'],
      chatModels: ['chat-comfly'],
    },
  ];
  const providerImageOptionProfiles = buildProviderImageOptionProfiles(remainingProviders);
  const result = resolveProviderDeletionFallbacks({
    deletedProviderId: 'custom',
    remainingProviders,
    textCardProviderById: { text1: 'custom', text2: 'comfly' },
    imageCardProviderById: { image1: 'custom', image2: 'comfly' },
    imageCardSizeById: { image1: '4096x4096' },
    imageCardAspectRatioById: { image1: '1:1' },
    imageCardQualityById: { image1: 'high' },
    textFallbackOptions: [{ id: 'chat-comfly', label: 'Chat Comfly' }],
    imageFallbackOptions: [{ id: 'gpt-image-2', label: 'GPT Image 2' }],
    defaultTextModelId: 'chat-comfly',
    defaultImageModelId: 'gpt-image-2',
    defaultImageSizeId: '1024x1024',
    defaultImageQualityId: 'auto',
    providerImageOptionProfiles,
  });

  assert.deepEqual(result.textProviderByItemId, { text1: 'comfly' });
  assert.deepEqual(result.textModelByItemId, { text1: 'chat-comfly' });
  assert.deepEqual(result.imageProviderByItemId, { image1: 'comfly' });
  assert.deepEqual(result.imageModelByItemId, { image1: 'gpt-image-2' });
  assert.deepEqual(result.imageSizeByItemId, { image1: '4096x4096' });
  assert.deepEqual(result.imageAspectRatioByItemId, { image1: '16:9' });
  assert.deepEqual(result.imageQualityByItemId, { image1: 'high' });
});

test('syncImageCardOptionsForProviderModel keeps valid size and quality while normalizing invalid aspect ratio', () => {
  const providerImageOptionProfiles = buildProviderImageOptionProfiles([
    {
      id: 'comfly',
      baseUrl: 'https://ai.comfly.org/v1',
      imageModels: ['gpt-image-2'],
    },
  ]);

  assert.deepEqual(
    syncImageCardOptionsForProviderModel({
      providerId: 'comfly',
      modelId: 'gpt-image-2',
      currentSizeId: '4096x4096',
      currentAspectRatioId: '1:1',
      currentQualityId: 'high',
      defaultSizeId: '1024x1024',
      defaultQualityId: 'auto',
      providerImageOptionProfiles,
    }),
    {
      sizeId: '4096x4096',
      aspectRatioId: '16:9',
      qualityId: 'high',
    }
  );
});

test('resolveImageCardModel accepts the supported documented image model', () => {
  const result = resolveImageCardModel('gemini-3.1-flash-image-preview');

  assert.equal(result, 'gemini-3.1-flash-image-preview');
});

test('resolveImageCardModel accepts gemini-3-pro-image-preview as a supported image model', () => {
  const result = resolveImageCardModel('gemini-3-pro-image-preview');

  assert.equal(result, 'gemini-3-pro-image-preview');
});

test('resolveImageCardModel accepts gpt-image-2 as a supported image model', () => {
  const result = resolveImageCardModel('gpt-image-2');

  assert.equal(result, 'gpt-image-2');
});

test('getSupportedImageCardSizeOptions returns official gpt-image-2 size choices', () => {
  assert.deepEqual(
    getSupportedImageCardSizeOptions('gpt-image-2').map((option) => option.id),
    ['1024x1024', '2048x2048', '4096x4096']
  );
});

test('gpt-image-2 provider variants reuse resolution tier choices and fall back to the comfly default template', () => {
  assert.deepEqual(
    getSupportedImageCardSizeOptions('gpt-image-2-2k').map((option) => option.id),
    ['1024x1024', '2048x2048', '4096x4096']
  );
  assert.equal(resolveImageCardSizeForAspectRatio('gpt-image-2-2k', '2048x2048', '1:1'), '2048x2048');
  assert.equal(resolveImageCardSizeForAspectRatio('gpt-image-2-2k', '2048x2048', '16:9'), '2048x1152');
  assert.equal(resolveImageCardSizeForAspectRatio('gpt-image-2-2k', '2048x2048', '9:16'), '1152x2048');
  assert.equal(resolveImageCardSizeForAspectRatio('gpt-image-2-2k', '2048x2048', '3:2'), '2048x1360');
  assert.equal(resolveImageCardSizeForAspectRatio('gpt-image-2-2k', '2048x2048', '2:3'), '1360x2048');
  assert.equal(resolveImageCardSizeForAspectRatio('gpt-image-2-2k', '2048x2048', '4:3'), '2048x1536');
  assert.equal(resolveImageCardSizeForAspectRatio('gpt-image-2-2k', '2048x2048', '3:4'), '1536x2048');
});

test('comfly gpt-image-2 is the default image option template', () => {
  const providerOptionProfiles = buildProviderImageOptionProfiles([
    {
      id: 'custom-provider',
      baseUrl: 'https://example.com/v1',
      imageModels: ['gpt-image-2'],
    },
  ]);

  assert.deepEqual(
    getProviderModelAspectRatios('custom-provider', 'gpt-image-2', providerOptionProfiles),
    ['1:1', '3:2', '2:3', '16:9', '9:16', '4:3', '3:4']
  );
  assert.deepEqual(
    getProviderModelQualityOptions('custom-provider', 'gpt-image-2', providerOptionProfiles).map((option) => option.id),
    ['auto', 'low', 'medium', 'high']
  );
  assert.deepEqual(
    getEnabledProviderModelAspectRatios('custom-provider', 'gpt-image-2', '1024x1024', providerOptionProfiles),
    ['1:1', '3:2', '2:3', '16:9', '9:16', '4:3', '3:4']
  );
  assert.deepEqual(
    getEnabledProviderModelAspectRatios('custom-provider', 'gpt-image-2', '2048x2048', providerOptionProfiles),
    ['1:1', '3:2', '2:3', '16:9', '9:16', '4:3', '3:4']
  );
  assert.deepEqual(
    getEnabledProviderModelAspectRatios('custom-provider', 'gpt-image-2', '4096x4096', providerOptionProfiles),
    ['16:9', '9:16', '4:3', '3:4']
  );
});

test('comfly gpt-image-2 maps default-template ratios to documented request sizes', () => {
  const providerOptionProfiles = buildProviderImageOptionProfiles([
    {
      id: 'custom-provider',
      baseUrl: 'https://example.com/v1',
      imageModels: ['gpt-image-2'],
    },
  ]);

  assert.equal(resolveImageCardSizeForAspectRatio('gpt-image-2', '1024x1024', '3:2', undefined, 'custom-provider', providerOptionProfiles), '1536x1024');
  assert.equal(resolveImageCardSizeForAspectRatio('gpt-image-2', '1024x1024', '2:3', undefined, 'custom-provider', providerOptionProfiles), '1024x1536');
  assert.equal(resolveImageCardSizeForAspectRatio('gpt-image-2', '1024x1024', '16:9', undefined, 'custom-provider', providerOptionProfiles), '1280x720');
  assert.equal(resolveImageCardSizeForAspectRatio('gpt-image-2', '1024x1024', '9:16', undefined, 'custom-provider', providerOptionProfiles), '720x1280');
  assert.equal(resolveImageCardSizeForAspectRatio('gpt-image-2', '1024x1024', '4:3', undefined, 'custom-provider', providerOptionProfiles), '1344x1008');
  assert.equal(resolveImageCardSizeForAspectRatio('gpt-image-2', '1024x1024', '3:4', undefined, 'custom-provider', providerOptionProfiles), '1008x1344');
  assert.equal(resolveImageCardSizeForAspectRatio('gpt-image-2', '2048x2048', '3:2', undefined, 'custom-provider', providerOptionProfiles), '2048x1360');
  assert.equal(resolveImageCardSizeForAspectRatio('gpt-image-2', '2048x2048', '2:3', undefined, 'custom-provider', providerOptionProfiles), '1360x2048');
  assert.equal(resolveImageCardSizeForAspectRatio('gpt-image-2', '2048x2048', '16:9', undefined, 'custom-provider', providerOptionProfiles), '2048x1152');
  assert.equal(resolveImageCardSizeForAspectRatio('gpt-image-2', '2048x2048', '9:16', undefined, 'custom-provider', providerOptionProfiles), '1152x2048');
  assert.equal(resolveImageCardSizeForAspectRatio('gpt-image-2', '2048x2048', '4:3', undefined, 'custom-provider', providerOptionProfiles), '2048x1536');
  assert.equal(resolveImageCardSizeForAspectRatio('gpt-image-2', '2048x2048', '3:4', undefined, 'custom-provider', providerOptionProfiles), '1536x2048');
  assert.equal(resolveImageCardSizeForAspectRatio('gpt-image-2', '4096x4096', '16:9', undefined, 'custom-provider', providerOptionProfiles), '3840x2160');
  assert.equal(resolveImageCardSizeForAspectRatio('gpt-image-2', '4096x4096', '9:16', undefined, 'custom-provider', providerOptionProfiles), '2160x3840');
  assert.equal(resolveImageCardSizeForAspectRatio('gpt-image-2', '4096x4096', '4:3', undefined, 'custom-provider', providerOptionProfiles), '3264x2448');
  assert.equal(resolveImageCardSizeForAspectRatio('gpt-image-2', '4096x4096', '3:4', undefined, 'custom-provider', providerOptionProfiles), '2448x3264');
});

test('resolveImageCardModel falls back to default when removed nano-banana ids are requested', () => {
  assert.equal(resolveImageCardModel('gemini-3.1-flash-image-preview'), 'gemini-3.1-flash-image-preview');
  assert.equal(resolveImageCardModel('nano-banana-2'), 'gemini-3.1-flash-image-preview');
  assert.equal(resolveImageCardModel('nano-banana'), 'gemini-3.1-flash-image-preview');
});

test('normalizeImageCardAspectRatio maps auto and empty values to 1:1', () => {
  assert.equal(normalizeImageCardAspectRatio('auto'), '1:1');
  assert.equal(normalizeImageCardAspectRatio(''), '1:1');
  assert.equal(normalizeImageCardAspectRatio(undefined), '1:1');
});

test('normalizeImageCardAspectRatio preserves valid explicit aspect ratios', () => {
  assert.equal(normalizeImageCardAspectRatio('16:9'), '16:9');
  assert.equal(normalizeImageCardAspectRatio('4:1'), '4:1');
});

test('getImageCardQualitySummary combines aspect ratio and size label into a single trigger label', () => {
  assert.equal(getImageCardQualitySummary({ modelId: 'gemini-3.1-flash-image-preview', aspectRatio: '1:1', size: '1024x1024' }), '1:1 · 1K');
  assert.equal(getImageCardQualitySummary({ modelId: 'gemini-3.1-flash-image-preview', aspectRatio: '9:16', size: '2048x2048' }), '9:16 · 2K');
  assert.equal(getImageCardQualitySummary({ modelId: 'gemini-3.1-flash-image-preview', aspectRatio: '16:9', size: '4096x4096' }), '16:9 · 4K');
  assert.equal(getImageCardQualitySummary({ modelId: 'gpt-image-2', aspectRatio: '9:16', size: '1536x1024', quality: 'High' }), '3:2 · 1.5K · High');
  assert.equal(getImageCardQualitySummary({ modelId: 'gpt-image-2', aspectRatio: '1:1', size: '1024x1024' }), '1:1 · 1K');
  assert.equal(getImageCardQualitySummary({ modelId: 'gpt-image-2', aspectRatio: '9:16', size: '1024x1536' }), '2:3 · 1.5K');
  assert.equal(getImageCardQualitySummary({ modelId: 'gpt-image-2', aspectRatio: '1:1', size: '2048x2048' }), '1:1 · 2K');
  assert.equal(getImageCardQualitySummary({ modelId: 'gpt-image-2', aspectRatio: '16:9', size: '3840x2160' }), '16:9 · 4K');
  assert.equal(getImageCardQualitySummary({ modelId: 'gpt-image-2', aspectRatio: '9:16', size: '2160x3840' }), '9:16 · 4K');
});

test('getImageCardQualitySummary normalizes legacy aspect ratios and falls back to the raw size when needed', () => {
  assert.equal(getImageCardQualitySummary({ modelId: 'gemini-3.1-flash-image-preview', aspectRatio: 'auto', size: '1024x1024' }), '1:1 · 1K');
  assert.equal(getImageCardQualitySummary({ modelId: 'gemini-3.1-flash-image-preview', aspectRatio: '', size: '1536x1024' }), '1:1 · 1536x1024');
});

test('buildCanvasImageGenerationRequest omits aspect_ratio for gpt-image-2 and preserves newly supported official sizes', () => {
  const result = buildCanvasImageGenerationRequest({
    input: '生成一张封面',
    linkedImagePreviews: [],
    modelId: 'gpt-image-2',
    size: '2048x2048',
    quality: 'high',
    count: 1,
    aspectRatio: '9:16',
  });

  assert.deepEqual(result, {
    messages: [{ role: 'user', content: '生成一张封面' }],
    intent: 'image',
    model: 'gpt-image-2',
    size: '1152x2048',
    quality: 'high',
    n: 1,
    executionMode: 'async',
  });
});

test('buildCanvasImageGenerationRequest keeps quality for aspect-ratio-capable image models too', () => {
  const result = buildCanvasImageGenerationRequest({
    input: '生成一张横版海报',
    linkedImagePreviews: [],
    modelId: 'gemini-3.1-flash-image-preview',
    size: '2048x2048',
    quality: 'medium',
    count: 1,
    aspectRatio: '16:9',
  });

  assert.deepEqual(result, {
    messages: [{ role: 'user', content: '生成一张横版海报' }],
    intent: 'image',
    model: 'gemini-3.1-flash-image-preview',
    size: '2048x2048',
    quality: 'medium',
    n: 1,
    aspect_ratio: '16:9',
    executionMode: 'async',
  });
});

test('buildCanvasImageGenerationRequest resolves provider variant gpt-image-2 2K requests by aspect ratio', () => {
  const result = buildCanvasImageGenerationRequest({
    input: '生成一张封面',
    linkedImagePreviews: [],
    modelId: 'gpt-image-2-2k',
    allowedModelIds: ['gpt-image-2-2k'],
    fallbackModel: 'gpt-image-2-2k',
    size: '2048x2048',
    quality: 'high',
    count: 1,
    aspectRatio: '16:9',
  });

  assert.deepEqual(result, {
    messages: [{ role: 'user', content: '生成一张封面' }],
    intent: 'image',
    model: 'gpt-image-2-2k',
    size: '2048x1152',
    quality: 'high',
    n: 1,
    executionMode: 'async',
  });
});

test('buildCanvasImageGenerationRequest preserves a provider-saved Gemini variant model id', () => {
  const result = buildCanvasImageGenerationRequest({
    input: '生成一张横版海报',
    linkedImagePreviews: [],
    modelId: 'gemini-3.1-flash-image-preview-2k',
    allowedModelIds: ['gemini-3.1-flash-image-preview-2k'],
    fallbackModel: 'gemini-3.1-flash-image-preview-2k',
    size: '2048x2048',
    quality: 'auto',
    count: 1,
    aspectRatio: '16:9',
  });

  assert.deepEqual(result, {
    messages: [{ role: 'user', content: '生成一张横版海报' }],
    intent: 'image',
    model: 'gemini-3.1-flash-image-preview-2k',
    size: '2048x2048',
    quality: 'auto',
    n: 1,
    aspect_ratio: '16:9',
    executionMode: 'async',
  });
});

test('buildAsyncImageTaskRequests keeps gpt-image-2 2K aspect ratio resolved size for every task', () => {
  const result = buildAsyncImageTaskRequests({
    input: '生成一张横版封面',
    linkedImagePreviews: [],
    modelId: 'gpt-image-2-4k',
    allowedModelIds: ['gpt-image-2-4k'],
    fallbackModel: 'gpt-image-2-4k',
    size: '2048x2048',
    quality: 'high',
    count: 2,
    aspectRatio: '9:16',
  });

  assert.equal(result.length, 2);
  assert.deepEqual(
    result.map((request) => request.size),
    ['1152x2048', '1152x2048']
  );
});

test('getImageCardResolutionStatus returns a warning when the actual output is below the requested 2K target', () => {
  assert.deepEqual(
    getImageCardResolutionStatus({
      requestedSize: '2048x2048',
      aspectRatio: '1:1',
      naturalWidth: 1536,
      naturalHeight: 1536,
    }),
    {
      actualLabel: '1536×1536',
      warning: '实际返回 1536×1536，未达到目标 2K',
      meetsRequestedResolution: false,
    }
  );
});

test('getImageCardResolutionStatus reports a clean actual size when the output meets the requested target', () => {
  assert.deepEqual(
    getImageCardResolutionStatus({
      requestedSize: '2048x2048',
      aspectRatio: '1:1',
      naturalWidth: 2048,
      naturalHeight: 2048,
    }),
    {
      actualLabel: '2048×2048',
      warning: null,
      meetsRequestedResolution: true,
    }
  );
});

test('getImageCardFrameSizeForAspectRatio uses a 384px minimum edge for the selected ratio', () => {
  const square = getImageCardFrameSizeForAspectRatio('1:1');
  const landscape = getImageCardFrameSizeForAspectRatio('16:9');
  const portrait = getImageCardFrameSizeForAspectRatio('9:16');

  assert.deepEqual(square, {
    width: 384,
    height: 384,
  });
  assert.ok(Math.abs(landscape.width - 682.6666666667) < 0.001);
  assert.equal(landscape.height, 384);
  assert.equal(portrait.width, 384);
  assert.ok(Math.abs(portrait.height - 682.6666666667) < 0.001);
});

test('getImageCardItemSizeForFrameSize rebuilds outer item size from the frame size', () => {
  const result = getImageCardItemSizeForFrameSize(384, 384);

  assert.deepEqual(result, {
    width: 416,
    height: 420,
  });
});

test('getImageCardItemSizeForNaturalImage derives outer sizes from a 384px minimum edge', () => {
  const square = getImageCardItemSizeForNaturalImage(1024, 1024);
  const landscape = getImageCardItemSizeForNaturalImage(1920, 1080);
  const portrait = getImageCardItemSizeForNaturalImage(1024, 1792);

  assert.deepEqual(square, {
    width: 416,
    height: 420,
  });
  assert.ok(Math.abs(landscape.width - 714.6666666667) < 0.001);
  assert.equal(landscape.height, 420);
  assert.equal(portrait.width, 416);
  assert.equal(portrait.height, 708);
});

test('buildImageCardOutputsState stores all outputs and activates the first output by default', () => {
  const result = buildImageCardOutputsState([
    { src: '/uploads/generated/a.png', naturalWidth: 1024, naturalHeight: 1024 },
    { src: '/uploads/generated/b.png', naturalWidth: 1024, naturalHeight: 1024 },
  ]);

  assert.deepEqual(result, {
    src: '/uploads/generated/a.png',
    naturalWidth: 1024,
    naturalHeight: 1024,
    imageOutputs: [
      { src: '/uploads/generated/a.png', naturalWidth: 1024, naturalHeight: 1024 },
      { src: '/uploads/generated/b.png', naturalWidth: 1024, naturalHeight: 1024 },
    ],
    activeImageOutputIndex: 0,
  });
});

test('buildImageCardOutputsState clamps an out-of-range active index to the available outputs', () => {
  const result = buildImageCardOutputsState(
    [{ src: '/uploads/generated/a.png', naturalWidth: 1024, naturalHeight: 1024 }],
    7
  );

  assert.deepEqual(result, {
    src: '/uploads/generated/a.png',
    naturalWidth: 1024,
    naturalHeight: 1024,
    imageOutputs: [{ src: '/uploads/generated/a.png', naturalWidth: 1024, naturalHeight: 1024 }],
    activeImageOutputIndex: 0,
  });
});

test('appendImageCardOutput appends a new output and preserves the current active output when one already exists', () => {
  const result = appendImageCardOutput({
    existingOutputs: [{ src: '/uploads/generated/a.png', naturalWidth: 1024, naturalHeight: 1024 }],
    existingActiveIndex: 0,
    nextOutput: { src: '/uploads/generated/b.png', naturalWidth: 1024, naturalHeight: 1792 },
  });

  assert.deepEqual(result, {
    src: '/uploads/generated/a.png',
    naturalWidth: 1024,
    naturalHeight: 1024,
    imageOutputs: [
      { src: '/uploads/generated/a.png', naturalWidth: 1024, naturalHeight: 1024 },
      { src: '/uploads/generated/b.png', naturalWidth: 1024, naturalHeight: 1792 },
    ],
    activeImageOutputIndex: 0,
  });
});

test('appendImageCardOutput activates the first completed output when the image card was empty', () => {
  const result = appendImageCardOutput({
    existingOutputs: [],
    existingActiveIndex: 0,
    nextOutput: { src: '/uploads/generated/a.png', naturalWidth: 1024, naturalHeight: 1024 },
  });

  assert.deepEqual(result, {
    src: '/uploads/generated/a.png',
    naturalWidth: 1024,
    naturalHeight: 1024,
    imageOutputs: [{ src: '/uploads/generated/a.png', naturalWidth: 1024, naturalHeight: 1024 }],
    activeImageOutputIndex: 0,
  });
});

test('getCurrentImageCardOutput resolves the active output from imageOutputs before falling back to item src', () => {
  assert.deepEqual(
    getCurrentImageCardOutput({
      id: 'image-card-1',
      type: 'image',
      src: '/fallback.png',
      activeImageOutputIndex: 1,
      imageOutputs: [
        { src: '/first-output.png', naturalWidth: 1024, naturalHeight: 1024 },
        { src: '/second-output.png', naturalWidth: 1024, naturalHeight: 1792 },
      ],
    }),
    { src: '/second-output.png', naturalWidth: 1024, naturalHeight: 1792 }
  );
});

test('getGenerationDurationDisplay formats sub-minute and minute-plus durations for card badges', () => {
  assert.equal(getGenerationDurationDisplay(12345), '12.3s');
  assert.equal(getGenerationDurationDisplay(68000), '1m 08s');
  assert.equal(getGenerationDurationDisplay(0), '0.0s');
  assert.equal(getGenerationDurationDisplay(Number.NaN), null);
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
