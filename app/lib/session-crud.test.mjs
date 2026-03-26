import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createEmptySession,
  deleteSessionFromList,
  renameSessionInList,
  upsertSessionInList,
} from './session-crud.mjs';

test('createEmptySession creates a persisted-ready empty canvas', () => {
  const session = createEmptySession({
    existingCount: 2,
    now: 123,
  });

  assert.equal(session.id, 'session-123');
  assert.equal(session.name, '新画布 3');
  assert.equal(session.createdAt, 123);
  assert.equal(session.updatedAt, 123);
  assert.deepEqual(session.items, []);
  assert.deepEqual(session.connections, []);
  assert.deepEqual(session.messages, []);
  assert.deepEqual(session.textCardPanelDrafts, {});
  assert.deepEqual(session.imageCardPanelDrafts, {});
  assert.deepEqual(session.imageCardModelById, {});
  assert.deepEqual(session.imageCardSizeById, {});
  assert.deepEqual(session.imageCardCountById, {});
  assert.deepEqual(session.imageCardAspectRatioById, {});
  assert.equal(session.topics?.length, 1);
  assert.equal(session.viewport.scale, 1);
});

test('renameSessionInList only updates the targeted session', () => {
  const sessions = [
    createEmptySession({ existingCount: 0, now: 100 }),
    createEmptySession({ existingCount: 1, now: 200 }),
  ];

  const renamed = renameSessionInList(sessions, sessions[0].id, '已重命名', 300);

  assert.equal(renamed[0].name, '已重命名');
  assert.equal(renamed[0].updatedAt, 300);
  assert.equal(renamed[1].name, sessions[1].name);
});

test('upsertSessionInList prepends new sessions and replaces existing ones in place', () => {
  const first = createEmptySession({ existingCount: 0, now: 100 });
  const second = createEmptySession({ existingCount: 1, now: 200 });

  const inserted = upsertSessionInList([first], second);
  assert.deepEqual(inserted.map((session) => session.id), [second.id, first.id]);

  const updatedSecond = { ...second, name: '已更新', updatedAt: 300 };
  const replaced = upsertSessionInList(inserted, updatedSecond);
  assert.deepEqual(replaced.map((session) => session.id), [updatedSecond.id, first.id]);
  assert.equal(replaced[0].name, '已更新');
});

test('deleteSessionFromList removes a non-current canvas without creating a fallback', () => {
  const sessions = [
    createEmptySession({ existingCount: 0, now: 100 }),
    createEmptySession({ existingCount: 1, now: 200 }),
  ];

  const result = deleteSessionFromList({
    sessions,
    sessionId: sessions[1].id,
    currentSessionId: sessions[0].id,
    now: 300,
  });

  assert.equal(result.sessions.length, 1);
  assert.equal(result.sessions[0].id, sessions[0].id);
  assert.equal(result.nextCurrentSessionId, sessions[0].id);
});

test('deleteSessionFromList creates a fallback canvas when deleting the last session', () => {
  const session = createEmptySession({ existingCount: 0, now: 100 });

  const result = deleteSessionFromList({
    sessions: [session],
    sessionId: session.id,
    currentSessionId: session.id,
    now: 200,
  });

  assert.equal(result.sessions.length, 1);
  assert.notEqual(result.sessions[0].id, session.id);
  assert.equal(result.nextCurrentSessionId, result.sessions[0].id);
  assert.deepEqual(result.sessions[0].items, []);
  assert.deepEqual(result.sessions[0].connections, []);
});
