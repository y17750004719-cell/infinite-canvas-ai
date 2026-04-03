import test from 'node:test';
import assert from 'node:assert/strict';

const sessionTransitionStateModule = await import('./session-transition-state.mjs').catch(() => ({}));

const { mergeCurrentSessionSnapshotIntoSessions } = sessionTransitionStateModule;

const buildSession = (overrides = {}) => ({
  id: 'session-1',
  name: 'Canvas',
  createdAt: 1,
  updatedAt: 1,
  items: [],
  connections: [],
  textCardPanelDrafts: {},
  imageCardPanelDrafts: {},
  imageCardModelById: {},
  imageCardSizeById: {},
  imageCardCountById: {},
  imageCardAspectRatioById: {},
  generatedImageHistory: [],
  messages: [],
  topics: [],
  activeTopicId: '',
  viewport: { x: 0, y: 0, scale: 1 },
  ...overrides,
});

test('mergeCurrentSessionSnapshotIntoSessions is exposed for pre-switch session persistence', () => {
  assert.equal(typeof mergeCurrentSessionSnapshotIntoSessions, 'function');
});

test('mergeCurrentSessionSnapshotIntoSessions replaces the active session with the latest snapshot and keeps others stable', () => {
  assert.equal(typeof mergeCurrentSessionSnapshotIntoSessions, 'function');
  if (typeof mergeCurrentSessionSnapshotIntoSessions !== 'function') {
    return;
  }

  const currentSession = buildSession({
    id: 'session-current',
    items: [{ id: 'item-1', type: 'text' }],
    connections: [],
  });
  const otherSession = buildSession({
    id: 'session-other',
    name: 'Other',
    items: [{ id: 'other-item', type: 'image' }],
  });

  const result = mergeCurrentSessionSnapshotIntoSessions({
    sessions: [currentSession, otherSession],
    currentSessionId: 'session-current',
    buildCurrentSessionSnapshot: (session) => ({
      ...session,
      updatedAt: 2,
      connections: [{ id: 'conn-1', fromItemId: 'item-1', toItemId: 'item-1' }],
    }),
  });

  assert.deepEqual(result.currentSessionSnapshot, {
    ...currentSession,
    updatedAt: 2,
    connections: [{ id: 'conn-1', fromItemId: 'item-1', toItemId: 'item-1' }],
  });
  assert.deepEqual(result.sessions, [
    {
      ...currentSession,
      updatedAt: 2,
      connections: [{ id: 'conn-1', fromItemId: 'item-1', toItemId: 'item-1' }],
    },
    otherSession,
  ]);
});

test('mergeCurrentSessionSnapshotIntoSessions persists connection-only changes without touching other sessions', () => {
  assert.equal(typeof mergeCurrentSessionSnapshotIntoSessions, 'function');
  if (typeof mergeCurrentSessionSnapshotIntoSessions !== 'function') {
    return;
  }

  const currentSession = buildSession({
    id: 'session-current',
    items: [
      { id: 'image-1', type: 'image' },
      { id: 'text-1', type: 'text' },
    ],
    connections: [],
  });
  const untouchedSession = buildSession({
    id: 'session-untouched',
    name: 'Untouched',
    connections: [{ id: 'existing', fromItemId: 'a', toItemId: 'b' }],
  });

  const result = mergeCurrentSessionSnapshotIntoSessions({
    sessions: [currentSession, untouchedSession],
    currentSessionId: 'session-current',
    buildCurrentSessionSnapshot: (session) => ({
      ...session,
      connections: [{ id: 'conn-new', fromItemId: 'image-1', toItemId: 'text-1' }],
    }),
  });

  assert.deepEqual(result.sessions[0].connections, [
    { id: 'conn-new', fromItemId: 'image-1', toItemId: 'text-1' },
  ]);
  assert.deepEqual(result.sessions[1], untouchedSession);
});

test('mergeCurrentSessionSnapshotIntoSessions returns the original sessions when the active session is missing', () => {
  assert.equal(typeof mergeCurrentSessionSnapshotIntoSessions, 'function');
  if (typeof mergeCurrentSessionSnapshotIntoSessions !== 'function') {
    return;
  }

  const sessions = [buildSession({ id: 'session-1' }), buildSession({ id: 'session-2' })];
  const result = mergeCurrentSessionSnapshotIntoSessions({
    sessions,
    currentSessionId: 'missing-session',
    buildCurrentSessionSnapshot: () => {
      throw new Error('should not be called');
    },
  });

  assert.equal(result.currentSessionSnapshot, null);
  assert.deepEqual(result.sessions, sessions);
});
