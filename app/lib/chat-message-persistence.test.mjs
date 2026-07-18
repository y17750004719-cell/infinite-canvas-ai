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
