import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildPersistedSession,
  normalizeProjectSession,
  shouldFlushScheduledSessionSave,
} from './session-persistence.mjs';

test('buildPersistedSession stores connections in the saved session', () => {
  const session = {
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
        src: '/uploads/generated/a.png',
        createdAt: 10,
        source: 'image-card',
        sourceItemId: 'image-card-1',
      },
      {
        id: 'history-2',
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
      createdAt: 10,
      source: 'image-card',
      sessionId: undefined,
      naturalWidth: undefined,
      naturalHeight: undefined,
      sourceItemId: 'image-card-1',
      topicId: undefined,
      messageId: undefined,
    },
  ]);
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
    id: 'session-1',
    items: [],
    generatedImageHistory: [
      {
        id: 'history-1',
        src: '/uploads/generated/a.png',
        createdAt: 10,
        source: 'chat',
      },
      {
        id: 'history-2',
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
      createdAt: 10,
      source: 'chat',
      sessionId: undefined,
      naturalWidth: undefined,
      naturalHeight: undefined,
      sourceItemId: undefined,
      topicId: undefined,
      messageId: undefined,
    },
  ]);
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
