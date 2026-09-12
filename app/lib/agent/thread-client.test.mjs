import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeThreadEvents, completedTranscriptMessages } from './thread-client.mjs';
import { adaptCanonicalEvent } from './canonical-event-adapter.mjs';
import { reduceAgentRunProgress } from './run-progress.mjs';

test('journal event replay matches live progress and ignores duplicate and foreign delivery', () => {
  const identity = { threadId: 'thread', turnId: 'turn', taskId: 'task', operationId: 'op', runId: 'run', itemId: 'run:tool:call', toolCallId: 'call', executionId: 'exec', parentItemId: 'commentary' };
  const events = [
    { type: 'item.updated', itemType: 'public_event', item: { payload: { type: 'progress_update', stepId: 'canvas_context', status: 'pending', toolCallId: 'call' } } },
    { type: 'item.updated', itemType: 'public_event', item: { payload: { type: 'progress_update', stepId: 'tool', status: 'active', toolCallId: 'call' } } },
    { type: 'item.started', itemType: 'tool_call', item: { toolName: 'get_canvas_context' } },
    { type: 'item.completed', itemType: 'tool_result', item: { result: { summary: 'Read' } } },
    { type: 'item.updated', itemType: 'public_event', item: { payload: { type: 'progress_update', stepId: 'agent_analysis', status: 'active', toolCallId: 'call' } } },
  ].map((event, index) => ({ ...identity, ...event, sequence: index + 1, timestampMs: (index + 1) * 1000 }));
  let live;
  for (const event of events) live = reduceAgentRunProgress(live, adaptCanonicalEvent(event));
  const restored = completedTranscriptMessages([{ ...identity, startSequence: 1, status: 'running', items: [] }], 0, null, {
    threadId: 'thread', events: [...events].reverse().concat(events[0], { ...events[0], threadId: 'foreign' }),
  }).find(message => message.agentRunProgress)?.agentRunProgress;
  assert.deepEqual(restored, live);
  assert.equal(restored.steps.length, 1);
  assert.equal(restored.steps[0].status, 'completed');
  assert.equal(restored.steps[0].parentItemId, 'commentary');
});
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
