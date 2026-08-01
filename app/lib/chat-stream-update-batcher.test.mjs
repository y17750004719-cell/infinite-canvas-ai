import assert from 'node:assert/strict';
import test from 'node:test';

const batcherModule = await import('./chat-stream-update-batcher.mjs').catch(() => ({}));
const { applyQueuedChatMessageUpdates } = batcherModule;

test('applies queued message updaters once per message in enqueue order', () => {
  assert.equal(typeof applyQueuedChatMessageUpdates, 'function');
  if (typeof applyQueuedChatMessageUpdates !== 'function') return;

  const messages = [
    { id: 'assistant-1', content: '', taskStatus: 'running' },
    { id: 'user-1', content: 'hello' },
  ];
  const queuedUpdates = new Map([
    ['assistant-1', [
      (message) => ({ ...message, content: `${message.content}first` }),
      (message) => ({ ...message, content: `${message.content} second` }),
      (message) => ({ ...message, taskStatus: undefined }),
    ]],
  ]);

  const result = applyQueuedChatMessageUpdates(messages, queuedUpdates);

  assert.deepEqual(result, [
    { id: 'assistant-1', content: 'first second', taskStatus: undefined },
    messages[1],
  ]);
  assert.notEqual(result, messages);
  assert.notEqual(result[0], messages[0]);
  assert.equal(result[1], messages[1]);
});

test('preserves the messages array when queued updates are no-ops', () => {
  assert.equal(typeof applyQueuedChatMessageUpdates, 'function');
  if (typeof applyQueuedChatMessageUpdates !== 'function') return;

  const messages = [
    { id: 'assistant-1', content: 'complete' },
    { id: 'user-1', content: 'hello' },
  ];
  const queuedUpdates = new Map([
    ['assistant-1', [(message) => message]],
    ['missing-message', [(message) => ({ ...message, content: 'unused' })]],
  ]);

  assert.equal(applyQueuedChatMessageUpdates(messages, queuedUpdates), messages);
  assert.equal(applyQueuedChatMessageUpdates(messages, new Map()), messages);
});

test('traverses the messages array once for a queued batch', () => {
  const messages = [
    { id: 'assistant-1', content: '' },
    { id: 'assistant-2', content: '' },
  ];
  let messageReads = 0;
  const trackedMessages = new Proxy(messages, {
    get(target, property, receiver) {
      if (property === '0' || property === '1') messageReads += 1;
      return Reflect.get(target, property, receiver);
    },
  });
  const queuedUpdates = new Map([
    ['assistant-1', [
      (message) => ({ ...message, content: `${message.content}a` }),
      (message) => ({ ...message, content: `${message.content}b` }),
    ]],
    ['assistant-2', [(message) => ({ ...message, content: 'c' })]],
  ]);

  assert.deepEqual(applyQueuedChatMessageUpdates(trackedMessages, queuedUpdates), [
    { id: 'assistant-1', content: 'ab' },
    { id: 'assistant-2', content: 'c' },
  ]);
  assert.equal(messageReads, messages.length);
});
