import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeThreadEvents, completedTranscriptMessages } from './thread-client.mjs';
test('replay deduplicates sequences and ignores foreign or invalid events', () => {
  const event = (sequence) => ({ threadId: 't', type: 'item.completed', sequence });
  assert.deepEqual(mergeThreadEvents([event(2)], [event(1), event(2), event(0), { ...event(3), threadId: 'foreign' }], 't').map((entry) => entry.sequence), [1, 2]);
});
test('transcript restoration only renders public message and todo items', () => {
  const messages = completedTranscriptMessages([{ turnId: 't', items: [{ itemId: 'private', type: 'reasoning', content: 'hidden' }, { itemId: 'todo', type: 'todo_list', items: [{ content: 'Review', status: 'completed' }] }] }]);
  assert.equal(messages.length, 1);
  assert.equal(messages[0].content, '[x] Review');
});
test('transcript boundary hides cleared turns but retains later public items', () => {
  const turns = [
    { turnId: 'old', startSequence: 2, items: [{ itemId: 'old-user', type: 'user_message', content: 'old' }] },
    { turnId: 'new', startSequence: 8, items: [{ itemId: 'new-assistant', type: 'assistant_message', content: 'new' }] },
  ];
  assert.deepEqual(completedTranscriptMessages(turns, 8).map((message) => message.content), ['new']);
});

test('compacted transcript restores a bounded summary before later turns', () => {
  const messages = completedTranscriptMessages(
    [{ turnId: 'new', startSequence: 8, items: [{ itemId: 'new', type: 'user_message', content: 'continue' }] }],
    8,
    'Conversation summary: earlier decision',
  );
  assert.deepEqual(messages.map((message) => message.content), ['Conversation summary: earlier decision', 'continue']);
});

test('journal restoration rebuilds public progress events into a replayable timeline', () => {
  const messages = completedTranscriptMessages([{
    turnId: 'run-1',
    runId: 'run-1',
    status: 'running',
    startSequence: 1,
    completedAt: 4,
    items: [
      { itemId: 'p1', type: 'public_event', sequence: 1, payload: { type: 'progress_update', stepId: 'generate_image', phase: 'checking', status: 'active', label: '正在整理图片合同' } },
      { itemId: 'p2', type: 'public_event', sequence: 2, payload: { type: 'progress_update', stepId: 'generate_image', phase: 'checking', status: 'failed', label: '图片引用失效' } },
    ],
  }]);
  const progressMessage = messages.find((message) => message.agentRunProgress);
  assert.ok(progressMessage);
  assert.ok(progressMessage.agentRunProgress.steps.some((step) => step.label === '图片引用失效'));
  assert.equal(progressMessage.agentRunProgress.outcome, 'running');
});
