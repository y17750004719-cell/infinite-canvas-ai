import test from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeAgentConversationMemory,
  normalizeChatMessageReferences,
  normalizeSessionChatMessages,
} from './chat-message-persistence.mjs';

test('chat messages persist bounded recovery records and drop invalid ones', () => {
  const normalized = normalizeChatMessageReferences({
    id: 'assistant-1',
    role: 'assistant',
    content: 'failed',
    agentRecovery: {
      version: 1,
      taskId: 'task-1',
      runId: 'run-1',
      topicId: 'topic-1',
      sourceUserMessageId: 'user-1',
      status: 'failed',
      resumeRoute: 'image_planner',
      intent: 'image',
      originalRequest: '生成海报',
      failure: { stage: 'planning', kind: 'transport', message: '<b>upstream</b> https://private.test', retryability: 'retryable' },
      skillId: null,
      contextEntityIds: [],
      visualReferenceIds: [],
      completedAssetCount: 0,
      createdAt: 10,
    },
  });
  assert.equal(normalized.agentRecovery.taskId, 'task-1');
  assert.equal(normalized.agentRecovery.failure.message, 'upstream');
  assert.equal(normalizeChatMessageReferences({ id: 'a', role: 'assistant', content: '', agentRecovery: { version: 1 } }).agentRecovery, undefined);
});

test('topic agent memory is bounded and legacy sessions remain compatible', () => {
  assert.equal(normalizeAgentConversationMemory(null), undefined);

  const memory = normalizeAgentConversationMemory({
    recentRawConversation: [
      { role: 'system', content: 'ignore' },
      { role: 'user', content: '  keep this  ' },
    ],
    rollingSummary: 'S'.repeat(7000),
    facts: ['fact', '', 42],
    preferences: ['quiet UI'],
    activeTask: { status: 'planning', summary: 'Create a poster', taskId: 'task-1' },
    recentReferencedAssetIds: ['history-image:1'],
    updatedAt: 123,
  });

  assert.deepEqual(memory.recentRawConversation, [{ role: 'user', content: 'keep this' }]);
  assert.equal(memory.rollingSummary.length, 6000);
  assert.deepEqual(memory.facts, ['fact']);
  assert.deepEqual(memory.activeTask, { status: 'planning', summary: 'Create a poster', taskId: 'task-1' });
  assert.equal(memory.updatedAt, 123);

  const normalized = normalizeSessionChatMessages({
    activeTopicId: 'legacy',
    topics: [{ id: 'legacy', messages: [] }],
  });
  assert.equal(normalized.topics[0].agentMemory, undefined);
});

test('topic agent memory keeps the latest twenty raw conversation messages', () => {
  const memory = normalizeAgentConversationMemory({
    recentRawConversation: Array.from({ length: 25 }, (_, index) => ({
      role: index % 2 === 0 ? 'user' : 'assistant',
      content: `message-${index}`,
    })),
  });
  assert.equal(memory.recentRawConversation.length, 20);
  assert.equal(memory.recentRawConversation[0].content, 'message-5');
  assert.equal(memory.recentRawConversation.at(-1).content, 'message-24');
});

test('chat message persistence stores one canonical image source instead of three copies', () => {
  const src = `data:image/png;base64,${'A'.repeat(1024)}`;
  const normalized = normalizeChatMessageReferences({
    id: 'message-1',
    role: 'user',
    content: '修改这张图',
    referenceImages: [src],
    referenceContext: {
      references: [{ id: 'photo', src, plannerPreviewSrc: '/preview/photo.webp', label: '原图', source: 'upload', role: 'edit_target' }],
      composerSegments: [
        { type: 'reference', referenceId: 'photo' },
        { type: 'text', text: '修改这张图' },
      ],
    },
    inlineContent: [
      { type: 'reference', id: 'photo', src, label: '原图', source: 'upload' },
      { type: 'text', text: '修改这张图' },
    ],
  });

  assert.equal(normalized.referenceImages, undefined);
  assert.equal(normalized.inlineContent, undefined);
  assert.equal(normalized.referenceContext.references.length, 1);
  assert.equal(normalized.referenceContext.references[0].src, src);
  assert.equal(normalized.referenceContext.references[0].plannerPreviewSrc, '/preview/photo.webp');
  assert.deepEqual(normalized.referenceContext.composerSegments, [
    { type: 'reference', referenceId: 'photo' },
    { type: 'text', text: '修改这张图' },
  ]);
});

test('active topic and top-level compatibility messages share the same normalized array', () => {
  const normalized = normalizeSessionChatMessages({
    activeTopicId: 'topic-1',
    messages: [],
    topics: [{
      id: 'topic-1',
      messages: [{ id: 'message-1', role: 'user', content: 'hello' }],
    }],
  });
  assert.equal(normalized.messages, normalized.topics[0].messages);
  assert.equal(normalized.messages[0].content, 'hello');
});

test('distinct region targets on the same image survive message normalization', () => {
  const src = '/api/local-assets/uploads/generated/shared.jpg';
  const normalized = normalizeChatMessageReferences({
    id: 'message-regions',
    role: 'user',
    content: '交换两个对象',
    referenceContext: {
      references: [
        { id: 'region-a', src, label: '左侧老虎', source: 'canvas', role: 'region_target', regionId: 'region-a' },
        { id: 'region-b', src, label: '右侧老虎', source: 'canvas', role: 'region_target', regionId: 'region-b' },
      ],
      composerSegments: [
        { type: 'reference', referenceId: 'region-a' },
        { type: 'reference', referenceId: 'region-b' },
        { type: 'text', text: '交换两个对象' },
      ],
    },
  });

  assert.deepEqual(normalized.referenceContext.references.map((reference) => reference.regionId), [
    'region-a',
    'region-b',
  ]);
  assert.deepEqual(normalized.referenceContext.composerSegments, [
    { type: 'reference', referenceId: 'region-a' },
    { type: 'reference', referenceId: 'region-b' },
    { type: 'text', text: '交换两个对象' },
  ]);
});

test('sent region target persistence treats legacy references as confirmed and keeps confirmed semantics', () => {
  const normalized = normalizeChatMessageReferences({
    id: 'message-region-contract',
    role: 'user',
    content: '修改选区',
    referenceContext: {
      references: [
        { id: 'legacy', src: '/image.png', label: '旧选区', source: 'canvas', role: 'region_target', regionId: 'legacy' },
        { id: 'confirmed', src: '/image.png', label: '左侧老虎', source: 'canvas', role: 'region_target', regionId: 'confirmed', confirmationStatus: 'confirmed', aliases: ['左虎'], description: '画面左侧戴墨镜的老虎', confidence: 'high' },
      ],
      composerSegments: [],
    },
  });
  assert.equal(normalized.referenceContext.references[0].confirmationStatus, 'confirmed');
  assert.deepEqual(normalized.referenceContext.references[1], {
    id: 'confirmed',
    src: '/image.png',
    label: '左侧老虎',
    source: 'canvas',
    role: 'region_target',
    regionId: 'confirmed',
    confirmationStatus: 'confirmed',
    aliases: ['左虎'],
    description: '画面左侧戴墨镜的老虎',
    confidence: 'high',
  });
});
