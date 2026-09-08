import test from 'node:test';
import assert from 'node:assert/strict';

test('v5 retains workbench state while v4 resets it and binds thread to session', () => {
  const base = { schemaVersion: 5, id: 'workbench', threadId: 'wrong', items: [], messages: [], viewport: { x: 0, y: 0, scale: 1 }, archived: true, pendingApproval: { itemId: 'approval' }, todoItems: [{ id: '1', content: 'Review', status: 'completed' }], commandState: { lastCommand: 'status', lastResult: {} } };
  const current = normalizeProjectSession(base);
  assert.equal(current.threadId, base.id);
  assert.deepEqual(current.todoItems, base.todoItems);
  assert.deepEqual(current.pendingApproval, base.pendingApproval);
  const old = normalizeProjectSession({ ...base, schemaVersion: 4 });
  assert.equal(old.archived, false);
  assert.equal(old.pendingApproval, null);
  assert.deepEqual(old.todoItems, []);
});

import {
  buildPersistedSession,
  normalizeProjectSession,
  shouldFlushScheduledSessionSave,
} from './session-persistence.mjs';

test('buildPersistedSession stores connections in the saved session', () => {
  const session = {
    schemaVersion: 5,
    id: 'session-1',
    name: 'Canvas',
    createdAt: 1,
    updatedAt: 1,
    items: [{ id: 'a' }, { id: 'b' }],
    messages: [],
    viewport: { x: 0, y: 0, scale: 1 },
  };

  const result = buildPersistedSession(session, {
    items: session.items,
    messages: [],
    topics: [],
    activeTopicId: undefined,
    viewport: { x: 10, y: 20, scale: 2 },
    connections: [{ id: 'conn-1', fromItemId: 'a', toItemId: 'b' }],
    updatedAt: 2,
  });

  assert.deepEqual(result.connections, [{ id: 'conn-1', fromItemId: 'a', toItemId: 'b' }]);
});

test('project sessions normalize and persist chat panel provider model selections', () => {
  const session = {
    id: 'session-models',
    name: 'Model selections',
    createdAt: 1,
    updatedAt: 1,
    items: [],
    messages: [],
    viewport: { x: 0, y: 0, scale: 1 },
    chatProviderId: '  chat-provider  ',
    chatModelId: '  chat-model  ',
    imageProviderId: '  image-provider  ',
    imageModelId: '  image-model  ',
  };

  const normalized = normalizeProjectSession(session);
  assert.equal(normalized.chatProviderId, 'chat-provider');
  assert.equal(normalized.chatModelId, 'chat-model');
  assert.equal(normalized.imageProviderId, 'image-provider');
  assert.equal(normalized.imageModelId, 'image-model');

  const persisted = buildPersistedSession(session, {
    chatProviderId: 'next-chat-provider',
    chatModelId: 'next-chat-model',
    imageProviderId: 'next-image-provider',
    imageModelId: 'next-image-model',
  });
  assert.equal(persisted.chatProviderId, 'next-chat-provider');
  assert.equal(persisted.chatModelId, 'next-chat-model');
  assert.equal(persisted.imageProviderId, 'next-image-provider');
  assert.equal(persisted.imageModelId, 'next-image-model');
});

test('project sessions preserve normalized image region selections and request revisions', () => {
  const normalized = normalizeProjectSession({
    schemaVersion: 5,
    id: 'session-regions',
    name: 'Regions',
    createdAt: 1,
    updatedAt: 1,
    items: [{ id: 'image-1', type: 'image', src: '/image.png', x: 0, y: 0, width: 100, height: 100 }],
    messages: [],
    viewport: { x: 0, y: 0, scale: 1 },
    regionSelections: [{
      id: 'region-1',
      imageItemId: 'image-1',
      imageSrc: '/image.png',
      mode: 'point',
      point: { x: 1.2, y: -0.2 },
      candidates: [],
      status: 'recognizing',
      recognitionRevision: 3.8,
    }],
  });

  assert.deepEqual(normalized.regionSelections?.[0]?.point, { x: 1, y: 0 });
  assert.equal(normalized.regionSelections?.[0]?.recognitionRevision, 3);
  assert.equal(normalized.regionSelections?.[0]?.confirmationStatus, 'pending');

  const confirmed = normalizeProjectSession({
    ...normalized,
    regionSelections: [{ ...normalized.regionSelections[0], confirmationStatus: 'confirmed' }],
  });
  assert.equal(confirmed.regionSelections?.[0]?.confirmationStatus, 'confirmed');
});

test('buildPersistedSession preserves normalized generated image history entries', () => {
  const session = {
    schemaVersion: 5,
    id: 'session-1',
    name: 'Canvas',
    createdAt: 1,
    updatedAt: 1,
    items: [],
    messages: [],
    viewport: { x: 0, y: 0, scale: 1 },
  };

  const result = buildPersistedSession(session, {
    generatedImageHistory: [
      {
        id: 'history-1',
        sessionId: 'session-1',
        src: '/uploads/generated/a.png',
        previewSrc: '/uploads/previews/a.webp',
        createdAt: 10,
        source: 'image-card',
        sourceItemId: 'image-card-1',
        topicId: 'topic-1',
        taskId: 'task-1',
        contractVersion: 2,
        batchId: 'batch-1',
        slotId: 'slot-1',
        versionId: 'version-2',
        parentVersionId: 'version-1',
      },
      {
        id: 'history-2',
        sessionId: 'session-1',
        src: '',
        createdAt: 11,
        source: 'chat',
      },
    ],
  });

  assert.deepEqual(result.generatedImageHistory, [
    {
      id: 'history-1',
      src: '/uploads/generated/a.png',
      previewSrc: '/uploads/previews/a.webp',
      createdAt: 10,
      source: 'image-card',
      sessionId: 'session-1',
      naturalWidth: undefined,
      naturalHeight: undefined,
      sourceItemId: 'image-card-1',
      messageId: undefined,
      taskId: 'task-1',
      contractVersion: 2,
      batchId: 'batch-1',
      slotId: 'slot-1',
      versionId: 'version-2',
      parentVersionId: 'version-1',
    },
  ]);
});

test('buildPersistedSession keeps task snapshots only on their owning assistant message', () => {
  const taskSnapshot = {
    sessionId: 'session-1',
    taskId: 'task-1',
    contractVersion: 1,
    contract: { intent: 'image' },
    latestBatchId: 'batch-1',
    activeVersions: [{ referenceId: 'task-slot:slot-1', batchId: 'batch-1', slotId: 'slot-1', versionId: 'version-1' }],
  };
  const agentImagePrompts = [{
    index: 0,
    label: '图片 1',
    prompt: '最终供应商 Prompt',
    compilation: {
      skillId: 'modular-watercolor-collage-v0-1',
      skillLabel: 'Modular Watercolor Collage',
      plannerProviderId: 'planner-provider',
      plannerModel: 'planner-model',
      referenceCount: 1,
      visualReferencesUsed: true,
      durationMs: 1200,
      compiledAt: 123456,
    },
  }];
  const agentRecovery = {
    version: 1,
    taskId: 'task-1', runId: 'run-1', operationId: 'run-1', lastSequence: 0, sessionId: 'session-1', sourceUserMessageId: 'user-1',
    status: 'failed', resumeRoute: 'image_planner', intent: 'image', originalRequest: '生成海报',
    failure: { stage: 'planning', kind: 'transport', message: '连接中断', retryability: 'retryable' },
    skillId: null, contextEntityIds: [], visualReferenceIds: [], completedAssetCount: 0, createdAt: 1,
  };
  const assistantMessage = {
    id: 'assistant-1',
    role: 'assistant',
    content: 'done',
    taskSnapshot,
    agentImagePrompts,
    agentProgressMode: 'compact',
    agentRecovery,
  };
  const result = buildPersistedSession({
    schemaVersion: 5,
    id: 'session-1',
    items: [],
    messages: [assistantMessage],
    viewport: { x: 0, y: 0, scale: 1 },
  }, {});

  assert.deepEqual(result.messages[0].taskSnapshot, {
    sessionId: 'session-1',
    taskId: 'task-1',
    contractVersion: 1,
    contract: { intent: 'image' },
    latestBatchId: 'batch-1',
    activeVersions: [{ referenceId: 'task-slot:slot-1', batchId: 'batch-1', slotId: 'slot-1', versionId: 'version-1' }],
  });
  assert.deepEqual(result.messages[0].agentImagePrompts, [{
    index: 0,
    label: '图片 1',
    prompt: '最终供应商 Prompt',
    compilation: agentImagePrompts[0].compilation,
  }]);
  assert.equal(result.messages[0].agentProgressMode, 'compact');
  assert.equal(result.messages[0].agentRecovery.resumeRoute, null);
  assert.equal('topics' in result, false);
  assert.equal('activeTopicId' in result, false);
});

test('legacy sessions reset chat protocol data while retaining canvas and model selections', () => {
  const reset = normalizeProjectSession({
    schemaVersion: 4,
    id: 'session-legacy-cleanup',
    name: 'Legacy canvas',
    createdAt: 1,
    updatedAt: 2,
    items: [{ id: 'canvas-image', type: 'image', src: '/uploads/asset.png' }],
    connections: [],
    viewport: { x: 10, y: 20, scale: 2 },
    chatProviderId: ' chat-provider ',
    chatModelId: ' chat-model ',
    imageProviderId: ' image-provider ',
    imageModelId: ' image-model ',
    messages: [{ id: 'assistant-1', role: 'assistant', content: 'old' }],
    topics: [{ id: 'topic-1', messages: [{ id: 'old', role: 'user', content: 'old' }] }],
    contextEvents: [{ eventId: 'old-event' }],
    contextHistory: { auditEvents: [{ eventId: 'old-event' }] },
    activeAgentRun: { runId: 'old-run' },
    agentRecovery: { runId: 'old-run' },
    pendingApproval: { itemId: 'old-approval' },
    todoItems: [{ id: 'old-todo', content: 'old', status: 'pending' }],
    visualAssets: [{ id: 'old-asset', durableSrc: '/old.png' }],
    generatedImageHistory: [{ id: 'old-image', src: '/old.png', source: 'chat', createdAt: 1 }],
    regionSelections: [{ id: 'old-region' }],
  });

  assert.equal(reset.schemaVersion, 5);
  assert.equal(reset.threadId, 'session-legacy-cleanup');
  assert.deepEqual(reset.items, [{ id: 'canvas-image', type: 'image', src: '/uploads/asset.png' }]);
  assert.deepEqual(reset.viewport, { x: 10, y: 20, scale: 2 });
  assert.equal(reset.chatProviderId, 'chat-provider');
  assert.equal(reset.chatModelId, 'chat-model');
  assert.equal(reset.imageProviderId, 'image-provider');
  assert.equal(reset.imageModelId, 'image-model');
  assert.deepEqual(reset.messages, []);
  assert.deepEqual(reset.turns, []);
  assert.deepEqual(reset.contextEvents, []);
  assert.equal(reset.contextHistory?.auditEvents?.length || 0, 0);
  assert.equal(reset.pendingApproval, null);
  assert.deepEqual(reset.todoItems, []);
  assert.deepEqual(reset.visualAssets, []);
  assert.deepEqual(reset.generatedImageHistory, []);
  assert.deepEqual(reset.regionSelections, []);
  assert.equal('topics' in reset, false);
  assert.equal('activeAgentRun' in reset, false);
  assert.equal('agentRecovery' in reset, false);
});

test('buildPersistedSession keeps valid text card panel drafts for existing text card items', () => {
  const session = {
    id: 'session-1',
    name: 'Canvas',
    createdAt: 1,
    updatedAt: 1,
    items: [
      { id: 'text-1', type: 'text', textVariant: 'card' },
      { id: 'image-1', type: 'image' },
    ],
    messages: [],
    viewport: { x: 0, y: 0, scale: 1 },
  };

  const result = buildPersistedSession(session, {
    items: session.items,
    textCardPanelDrafts: {
      'text-1': '保留这个提示词',
      'image-1': 'should drop',
      'missing': 'should drop',
      'text-2': '',
    },
  });

  assert.deepEqual(result.textCardPanelDrafts, {
    'text-1': '保留这个提示词',
  });
});

test('buildPersistedSession keeps valid text card provider and model state for existing text card items', () => {
  const session = {
    id: 'session-1',
    name: 'Canvas',
    createdAt: 1,
    updatedAt: 1,
    items: [
      { id: 'text-1', type: 'text', textVariant: 'card' },
      { id: 'text-legacy-1', type: 'text' },
      { id: 'image-1', type: 'image' },
    ],
    messages: [],
    viewport: { x: 0, y: 0, scale: 1 },
  };

  const result = buildPersistedSession(session, {
    items: session.items,
    textCardProviderById: {
      'text-1': 'provider-a',
      'text-legacy-1': 'drop legacy',
      'image-1': 'drop image',
      missing: 'drop missing',
    },
    textCardModelById: {
      'text-1': 'chat-a',
      'text-legacy-1': 'drop legacy',
      'image-1': 'drop image',
      missing: 'drop missing',
    },
  });

  assert.deepEqual(result.textCardProviderById, {
    'text-1': 'provider-a',
  });
  assert.deepEqual(result.textCardModelById, {
    'text-1': 'chat-a',
  });
});

test('buildPersistedSession keeps valid image card panel state for existing image card items', () => {
  const session = {
    id: 'session-1',
    name: 'Canvas',
    createdAt: 1,
    updatedAt: 1,
    items: [
      { id: 'image-card-1', type: 'image', imageVariant: 'card' },
      { id: 'image-asset-1', type: 'image', src: '/asset.png' },
    ],
    messages: [],
    viewport: { x: 0, y: 0, scale: 1 },
  };

  const result = buildPersistedSession(session, {
    items: session.items,
    imageCardPanelDrafts: {
      'image-card-1': '保留这个提示词',
      'image-asset-1': 'drop asset',
    },
    imageCardModelById: {
      'image-card-1': 'gemini-3.1-flash-image-preview',
      'image-asset-1': 'drop asset',
    },
    imageCardSizeById: {
      'image-card-1': '2048x2048',
      'missing': 'drop missing',
    },
    imageCardCountById: {
      'image-card-1': 4,
      'image-asset-1': 2,
    },
    imageCardAspectRatioById: {
      'image-card-1': '16:9',
      'image-asset-1': '1:1',
    },
  });

  assert.deepEqual(result.imageCardPanelDrafts, {
    'image-card-1': '保留这个提示词',
  });
  assert.deepEqual(result.imageCardModelById, {
    'image-card-1': 'gemini-3.1-flash-image-preview',
  });
  assert.deepEqual(result.imageCardSizeById, {
    'image-card-1': '2048x2048',
  });
  assert.deepEqual(result.imageCardCountById, {
    'image-card-1': 4,
  });
  assert.deepEqual(result.imageCardAspectRatioById, {
    'image-card-1': '16:9',
  });
});

test('buildPersistedSession keeps card generation timing metadata on items', () => {
  const session = {
    id: 'session-1',
    name: 'Canvas',
    createdAt: 1,
    updatedAt: 1,
    items: [
      {
        id: 'text-1',
        type: 'text',
        textVariant: 'card',
        lastGenerationDurationMs: 12345,
        lastGenerationCompletedAt: 23456,
      },
      {
        id: 'image-card-1',
        type: 'image',
        imageVariant: 'card',
        lastGenerationDurationMs: 67890,
        lastGenerationCompletedAt: 78901,
      },
    ],
    messages: [],
    viewport: { x: 0, y: 0, scale: 1 },
  };

  const result = buildPersistedSession(session, {
    items: session.items,
  });

  assert.equal(result.items[0].lastGenerationDurationMs, 12345);
  assert.equal(result.items[0].lastGenerationCompletedAt, 23456);
  assert.equal(result.items[1].lastGenerationDurationMs, 67890);
  assert.equal(result.items[1].lastGenerationCompletedAt, 78901);
});

test('buildPersistedSession preserves manual text card mode on items', () => {
  const session = {
    id: 'session-1',
    name: 'Canvas',
    createdAt: 1,
    updatedAt: 1,
    items: [
      { id: 'text-1', type: 'text', textVariant: 'card', textMode: 'manual', text: '手动内容' },
    ],
    messages: [],
    viewport: { x: 0, y: 0, scale: 1 },
  };

  const result = buildPersistedSession(session, {
    items: session.items,
  });

  assert.equal(result.items[0].textMode, 'manual');
  assert.equal(result.items[0].text, '手动内容');
});

test('buildPersistedSession clones canvas state collections so later live edits cannot mutate the saved snapshot', () => {
  const items = [
    { id: 'image-1', type: 'image', x: 1, y: 2 },
    { id: 'text-1', type: 'text', textVariant: 'card', text: 'draft' },
  ];
  const connections = [{ id: 'conn-1', fromItemId: 'image-1', toItemId: 'text-1' }];
  const viewport = { x: 10, y: 20, scale: 2 };
  const textCardPanelDrafts = { 'text-1': '保留这个提示词' };

  const result = buildPersistedSession(
    {
      id: 'session-1',
      name: 'Canvas',
      createdAt: 1,
      updatedAt: 1,
      items: [],
      messages: [],
      viewport: { x: 0, y: 0, scale: 1 },
    },
    {
      items,
      connections,
      viewport,
      textCardPanelDrafts,
    }
  );

  assert.notEqual(result.items, items);
  assert.notEqual(result.items[0], items[0]);
  assert.notEqual(result.connections, connections);
  assert.notEqual(result.connections[0], connections[0]);
  assert.notEqual(result.viewport, viewport);
  assert.notEqual(result.textCardPanelDrafts, textCardPanelDrafts);
});

test('normalizeProjectSession keeps only connections whose endpoints still exist', () => {
  const result = normalizeProjectSession({
    schemaVersion: 5,
    id: 'session-1',
    items: [{ id: 'a' }, { id: 'b' }],
    connections: [
      { id: 'conn-1', fromItemId: 'a', toItemId: 'b' },
      { id: 'conn-2', fromItemId: 'a', toItemId: 'missing' },
    ],
  });

  assert.deepEqual(result.connections, [{ id: 'conn-1', fromItemId: 'a', toItemId: 'b' }]);
});

test('normalizeProjectSession falls back missing text card panel drafts to an empty object', () => {
  const result = normalizeProjectSession({
    id: 'session-1',
    items: [],
    connections: [],
  });

  assert.deepEqual(result.textCardPanelDrafts, {});
  assert.deepEqual(result.imageCardPanelDrafts, {});
  assert.deepEqual(result.imageCardModelById, {});
  assert.deepEqual(result.imageCardSizeById, {});
  assert.deepEqual(result.imageCardCountById, {});
  assert.deepEqual(result.imageCardAspectRatioById, {});
  assert.deepEqual(result.generatedImageHistory, []);
});

test('normalizeProjectSession removes orphan, invalid, and blank text card panel drafts', () => {
  const result = normalizeProjectSession({
    id: 'session-1',
    items: [
      { id: 'text-1', type: 'text', textVariant: 'card' },
      { id: 'text-2', type: 'text', textVariant: 'legacy' },
      { id: 'image-1', type: 'image' },
    ],
    textCardPanelDrafts: {
      'text-1': '保留这个草稿',
      'text-2': 'drop legacy',
      'image-1': 'drop image',
      'missing': 'drop missing',
      'text-3': 123,
      'text-4': '   ',
    },
  });

  assert.deepEqual(result.textCardPanelDrafts, {
    'text-1': '保留这个草稿',
  });
});

test('normalizeProjectSession removes orphan and invalid image card state while keeping valid image card fields', () => {
  const result = normalizeProjectSession({
    id: 'session-1',
    items: [
      { id: 'image-card-1', type: 'image', imageVariant: 'card' },
      { id: 'image-asset-1', type: 'image', src: '/asset.png' },
    ],
    imageCardPanelDrafts: {
      'image-card-1': '保留这个草稿',
      'image-asset-1': 'drop asset',
      'missing': 'drop missing',
      'blank': '   ',
    },
    imageCardModelById: {
      'image-card-1': 'gemini-3.1-flash-image-preview',
      'image-asset-1': 'drop asset',
    },
    imageCardSizeById: {
      'image-card-1': '1024x1024',
      'missing': '2048x2048',
    },
    imageCardCountById: {
      'image-card-1': 2,
      'image-asset-1': 4,
      'missing': 0,
    },
    imageCardAspectRatioById: {
      'image-card-1': '1:1',
      'image-asset-1': '16:9',
    },
  });

  assert.deepEqual(result.imageCardPanelDrafts, {
    'image-card-1': '保留这个草稿',
  });
  assert.deepEqual(result.imageCardModelById, {
    'image-card-1': 'gemini-3.1-flash-image-preview',
  });
  assert.deepEqual(result.imageCardSizeById, {
    'image-card-1': '1024x1024',
  });
  assert.deepEqual(result.imageCardCountById, {
    'image-card-1': 2,
  });
  assert.deepEqual(result.imageCardAspectRatioById, {
    'image-card-1': '1:1',
  });
});

test('normalizeProjectSession keeps valid generated image history entries and removes invalid ones', () => {
  const result = normalizeProjectSession({
    schemaVersion: 5,
    id: 'session-1',
    items: [],
    generatedImageHistory: [
      {
        id: 'history-1',
        sessionId: 'session-1',
        src: '/uploads/generated/a.png',
        createdAt: 10,
        source: 'chat',
      },
      {
        id: 'history-2',
        sessionId: 'session-1',
        src: '   ',
        createdAt: 11,
        source: 'archive',
      },
    ],
  });

  assert.deepEqual(result.generatedImageHistory, [
    {
      id: 'history-1',
      src: '/uploads/generated/a.png',
      previewSrc: '/uploads/generated/a.png',
      createdAt: 10,
      source: 'chat',
      sessionId: 'session-1',
      naturalWidth: undefined,
      naturalHeight: undefined,
      sourceItemId: undefined,
      messageId: undefined,
    },
  ]);
});

test('normalizeProjectSession rejects visual assets and generated history owned by another session', () => {
  const result = normalizeProjectSession({
    schemaVersion: 5,
    id: 'session-1',
    items: [],
    messages: [],
    visualAssets: [
      { id: 'local', sessionId: 'session-1', durableSrc: '/local.png' },
      { id: 'foreign', sessionId: 'session-2', durableSrc: '/foreign.png' },
    ],
    generatedImageHistory: [
      { id: 'local', sessionId: 'session-1', src: '/local.png', createdAt: 1, source: 'chat' },
      { id: 'foreign', sessionId: 'session-2', src: '/foreign.png', createdAt: 2, source: 'chat' },
    ],
    viewport: { x: 0, y: 0, scale: 1 },
  });

  assert.deepEqual(result.visualAssets.map((asset) => asset.id), ['local']);
  assert.deepEqual(result.generatedImageHistory.map((entry) => entry.id), ['local']);
});

test('normalizeProjectSession strips obsolete root protocol fields from v5 sessions', () => {
  const result = normalizeProjectSession({
    schemaVersion: 5,
    id: 'session-1',
    items: [],
    messages: [],
    topics: [{ id: 'old-topic' }],
    activeTopicId: 'old-topic',
    activeAgentRun: { runId: 'old-run' },
    agentRecovery: { runId: 'old-run' },
    topicId: 'old-topic',
    viewport: { x: 0, y: 0, scale: 1 },
  });

  for (const key of ['topics', 'activeTopicId', 'activeAgentRun', 'agentRecovery', 'topicId']) {
    assert.equal(key in result, false);
  }
});

test('normalizeProjectSession rejects ownerless persisted assets and context events', () => {
  const result = normalizeProjectSession({
    schemaVersion: 5,
    id: 'session-1',
    items: [],
    messages: [],
    visualAssets: [{ id: 'ownerless', durableSrc: '/ownerless.png' }],
    generatedImageHistory: [{ id: 'ownerless', src: '/ownerless.png', createdAt: 1, source: 'chat' }],
    contextEvents: [{ eventId: 'ownerless', sequence: 1, type: 'user_text', source: 'persisted', content: 'drop' }],
    contextHistory: {
      auditEvents: [{ eventId: 'ownerless-audit', sequence: 1, type: 'user_text', source: 'persisted', content: 'drop' }],
      modelEvents: [{ eventId: 'ownerless-model', sequence: 1, type: 'user_text', source: 'persisted', content: 'drop' }],
    },
    viewport: { x: 0, y: 0, scale: 1 },
  });

  assert.deepEqual(result.visualAssets, []);
  assert.deepEqual(result.generatedImageHistory, []);
  assert.deepEqual(result.contextEvents, []);
  assert.deepEqual(result.contextHistory.auditEvents, []);
  assert.deepEqual(result.contextHistory.modelEvents, []);
});

test('normalizeProjectSession hard resets legacy chat data exactly once', () => {
  const legacyAsset = {
    id: 'asset-1',
    topicId: 'topic-1',
    durableSrc: '/api/local-assets/topic-assets/hash/asset.png',
    contentHash: 'abc123',
    mimeType: 'image/png',
    byteSize: 128,
    source: 'generated',
    createdAt: 10,
  };
  const migrated = normalizeProjectSession({
    schemaVersion: 3,
    id: 'session-legacy',
    name: 'Legacy canvas',
    createdAt: 1,
    updatedAt: 2,
    items: [{ id: 'image-1', type: 'image', src: '/uploads/generated/a.png' }],
    connections: [],
    messages: [{ id: 'legacy-root', role: 'user', content: 'legacy root' }],
    agentMemory: { version: 1, recentRawConversation: [{ role: 'user', content: 'old' }], rollingSummary: 'old', facts: [], preferences: [], activeTask: null, recentReferencedAssetIds: [], updatedAt: 1 },
    topics: [
      { id: 'topic-1', messages: [{ id: 'old-1', role: 'user', content: 'old' }], visualAssets: [legacyAsset] },
      { id: 'topic-2', messages: [{ id: 'old-2', role: 'assistant', content: 'old' }], visualAssets: [{ ...legacyAsset, id: 'asset-duplicate' }] },
    ],
    activeTopicId: 'topic-2',
    generatedImageHistory: [{ id: 'history-1', src: '/uploads/generated/a.png', source: 'chat', topicId: 'topic-1', createdAt: 10 }],
    activeAgentRun: { runId: 'run-1', userMessageId: 'old-1', assistantMessageId: 'old-2', startedAt: 3, status: 'running' },
    viewport: { x: 0, y: 0, scale: 1 },
  });

  assert.equal(migrated.schemaVersion, 5);
  assert.deepEqual(migrated.messages, []);
  assert.equal(migrated.agentMemory, undefined);
  assert.equal('topics' in migrated, false);
  assert.equal('activeTopicId' in migrated, false);
  assert.equal('activeAgentRun' in migrated, false);
  assert.equal(migrated.items.length, 1);
  assert.deepEqual(migrated.visualAssets, []);
  assert.deepEqual(migrated.generatedImageHistory, []);

  const normalizedAgain = normalizeProjectSession({
    ...migrated,
    messages: [{ id: 'new-1', role: 'user', content: 'new conversation' }],
  });
  assert.equal(normalizedAgain.messages.length, 1);
  assert.equal(normalizedAgain.messages[0].content, 'new conversation');
});

test('normalizeProjectSession drops legacy messages when the event list is empty', () => {
  const migrated = normalizeProjectSession({
    schemaVersion: 3,
    id: 'session-empty-events',
    items: [],
    messages: [{ id: 'legacy-message', role: 'user', content: '保留这条消息' }],
    contextEvents: [],
    viewport: { x: 0, y: 0, scale: 1 },
  });
  assert.deepEqual(migrated.messages, []);
  assert.deepEqual(migrated.contextEvents, []);
});

test('normalizeProjectSession preserves compact state and filters foreign context windows', () => {
  const normalized = normalizeProjectSession({
    schemaVersion: 5,
    id: 'session-context',
    items: [],
    messages: [{ id: 'm1', role: 'user', content: 'new' }],
    contextEvents: [{ eventId: 'e1', sessionId: 'session-context', sequence: 1, type: 'user_text', source: 'persisted', content: 'old' }],
    compactedWindows: [
      { version: 1, sessionId: 'session-context', summary: 'keep' },
      { version: 2, sessionId: 'other-session', summary: 'drop' },
    ],
    activeContextWindow: { sessionId: 'other-session', startSequence: 1, endSequence: 1, compactCount: 8, summaryVersion: 8, estimatedTokens: 10, model: 'wrong', contextWindow: 100 },
    viewport: { x: 0, y: 0, scale: 1 },
  });

  assert.deepEqual(normalized.compactedWindows, [{ version: 1, sessionId: 'session-context', summary: 'keep' }]);
  assert.equal(normalized.activeContextWindow.compactCount, 0);
  assert.equal(normalized.activeContextWindow.sessionId, 'session-context');
  assert.deepEqual(normalized.contextEvents.map((event) => event.content), ['old', 'new']);
});

test('buildPersistedSession keeps context events idempotent while appending a new message', () => {
  const session = {
    schemaVersion: 5,
    id: 'session-idempotent',
    items: [],
    messages: [{ id: 'm1', role: 'user', content: 'old' }],
    contextEvents: [{ eventId: 'e1', sessionId: 'session-idempotent', sequence: 1, type: 'user_text', source: 'persisted', content: 'old' }],
    viewport: { x: 0, y: 0, scale: 1 },
  };
  const first = buildPersistedSession(session, { messages: [...session.messages, { id: 'm2', role: 'assistant', content: 'reply' }] });
  const second = buildPersistedSession(first, {});
  assert.deepEqual(second.contextEvents.map((event) => [event.eventId, event.content]), [
    ['e1', 'old'],
    ['session-idempotent:event:2:assistant_text', 'reply'],
  ]);
});

test('context history preserves audit events and revision metadata while extending the model tail', () => {
  const session = {
    schemaVersion: 5,
    id: 'session-revisions',
    items: [],
    messages: [{ id: 'm1', role: 'user', content: 'old' }],
    contextEvents: [
      { eventId: 'e1', sessionId: 'session-revisions', sequence: 1, type: 'user_text', source: 'persisted', content: 'old' },
      { eventId: 'e2', sessionId: 'session-revisions', sequence: 2, type: 'tool_result', source: 'runtime', content: 'new fact' },
    ],
    contextHistory: {
      schemaVersion: 2,
      auditEvents: [{ eventId: 'e1', sessionId: 'session-revisions', sequence: 1, type: 'user_text', source: 'persisted', content: 'old' }],
      modelEvents: [{ eventId: 'e1', sessionId: 'session-revisions', sequence: 1, type: 'user_text', source: 'persisted', content: 'old' }],
      compactionRecords: [],
      activeWindow: { sessionId: 'session-revisions', startSequence: 1, endSequence: 1, compactCount: 1, summaryVersion: 1, estimatedTokens: 4, model: 'm', contextWindow: 100 },
      historyRevision: 1,
      userMessageRevision: 1,
      activeWindowRevision: 1,
    },
    viewport: { x: 0, y: 0, scale: 1 },
  };
  const persisted = buildPersistedSession(session, {});
  assert.deepEqual(persisted.contextHistory.auditEvents.map((event) => event.eventId), ['e1', 'e2']);
  assert.deepEqual(persisted.contextHistory.modelEvents.map((event) => event.eventId), ['e1', 'e2']);
  assert.equal(persisted.contextHistory.historyRevision, 2);
  assert.equal(persisted.contextHistory.userMessageRevision, 1);
  assert.equal(persisted.contextHistory.activeWindowRevision, 1);
});

test('shouldFlushScheduledSessionSave rejects stale save epochs', () => {
  const result = shouldFlushScheduledSessionSave({
    scheduledSessionId: 'session-1',
    scheduledEpoch: 2,
    currentSessionId: 'session-1',
    currentEpoch: 3,
    sessions: [{ id: 'session-1' }],
  });

  assert.equal(result, false);
});

test('shouldFlushScheduledSessionSave rejects deleted sessions', () => {
  const result = shouldFlushScheduledSessionSave({
    scheduledSessionId: 'session-1',
    scheduledEpoch: 4,
    currentSessionId: 'session-1',
    currentEpoch: 4,
    sessions: [{ id: 'session-2' }],
  });

  assert.equal(result, false);
});

test('shouldFlushScheduledSessionSave rejects saves while a session mutation is pending', () => {
  const result = shouldFlushScheduledSessionSave({
    scheduledSessionId: 'session-2',
    scheduledEpoch: 5,
    currentSessionId: 'session-2',
    currentEpoch: 5,
    sessions: [{ id: 'session-2' }],
    hasPendingMutation: true,
  });

  assert.equal(result, false);
});

test('shouldFlushScheduledSessionSave accepts the latest active session save', () => {
  const result = shouldFlushScheduledSessionSave({
    scheduledSessionId: 'session-2',
    scheduledEpoch: 5,
    currentSessionId: 'session-2',
    currentEpoch: 5,
    sessions: [{ id: 'session-1' }, { id: 'session-2' }],
  });

  assert.equal(result, true);
});
