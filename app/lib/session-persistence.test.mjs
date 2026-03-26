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
