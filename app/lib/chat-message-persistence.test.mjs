import test from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeChatMessageReferences,
  normalizeSessionChatMessages,
} from './chat-message-persistence.mjs';

test('chat message persistence stores one canonical image source instead of three copies', () => {
  const src = `data:image/png;base64,${'A'.repeat(1024)}`;
  const normalized = normalizeChatMessageReferences({
    id: 'message-1',
    role: 'user',
    content: '修改这张图',
    referenceImages: [src],
    referenceContext: {
      references: [{ id: 'photo', src, label: '原图', source: 'upload', role: 'edit_target' }],
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
