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
