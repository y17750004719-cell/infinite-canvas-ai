import test from 'node:test';
import assert from 'node:assert/strict';

import { createEmptySession } from './session-crud.mjs';
import { resolveSessionPresentationState } from './workspace-session-view.mjs';

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
