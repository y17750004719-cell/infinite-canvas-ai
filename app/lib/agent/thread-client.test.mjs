import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeThreadEvents, completedTranscriptMessages, reconcileHydratedChatMessages } from './thread-client.mjs';
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

test('hydration reconciles a locally running assistant with a failed journal turn', () => {
  const messages = [{
    id: 'assistant-1', role: 'assistant', content: '', taskStatus: 'running',
    agentRunProgress: { taskId: 'task-1', runId: 'run-1', operationId: 'op-1', outcome: 'running', steps: [], lastSequence: 1 },
  }];
  const [message] = reconcileHydratedChatMessages(messages, {
    activeTurn: null,
    threadStatus: 'error',
    turns: [{ turnId: 'turn-1', taskId: 'task-1', runId: 'run-1', operationId: 'op-1', status: 'failed', startSequence: 1, completedAt: 3, error: { code: 'tool_dispatch', message: '工具参数无效' }, items: [] }],
  });
  assert.equal(message.taskStatus, 'failed');
  assert.equal(message.agentRunProgress.outcome, 'failed');
  assert.equal(message.content, '');
});

test('hydration reconciles completed and cancelled turns without duplicating messages', () => {
  const base = (runId, operationId) => ({ taskId: runId, runId, operationId, outcome: 'running', steps: [], lastSequence: 1 });
  const messages = [
    { id: 'assistant-completed', role: 'assistant', content: 'done', taskStatus: 'running', agentRunProgress: base('run-completed', 'op-completed') },
    { id: 'assistant-cancelled', role: 'assistant', content: '', taskStatus: 'running', agentRunProgress: base('run-cancelled', 'op-cancelled') },
  ];
  const turns = [
    { turnId: 'turn-completed', taskId: 'run-completed', runId: 'run-completed', operationId: 'op-completed', status: 'completed', startSequence: 1, completedAt: 2, items: [] },
    { turnId: 'turn-cancelled', taskId: 'run-cancelled', runId: 'run-cancelled', operationId: 'op-cancelled', status: 'cancelled', startSequence: 3, completedAt: 4, items: [] },
  ];
  const result = reconcileHydratedChatMessages(messages, { activeTurn: null, threadStatus: 'idle', turns });
  assert.deepEqual(result.map((message) => [message.id, message.taskStatus, message.agentRunProgress.outcome]), [
    ['assistant-completed', 'completed', 'completed'],
    ['assistant-cancelled', 'cancelled', 'cancelled'],
  ]);
  assert.equal(result.length, 2);
});

test('legacy running message converges to the newest terminal turn when the journal has no active turn', () => {
  const [message] = reconcileHydratedChatMessages([
    { id: 'legacy-assistant', role: 'assistant', content: '处理中', taskStatus: 'running' },
  ], {
    activeTurn: null,
    threadStatus: 'error',
    turns: [{ turnId: 'turn-legacy', runId: 'run-legacy', operationId: 'op-legacy', status: 'failed', startSequence: 1, completedAt: 9, items: [] }],
  });
  assert.equal(message.taskStatus, 'failed');
  assert.equal(message.agentRunProgress.outcome, 'failed');
});

test('hydration converges when a legacy client marker uses identities different from the journal', () => {
  const [message] = reconcileHydratedChatMessages([
    {
      id: 'legacy-server-mismatch',
      role: 'assistant',
      content: '',
      taskStatus: 'running',
      agentRunProgress: {
        taskId: 'client-run',
        runId: 'client-run',
        operationId: 'client-operation',
        outcome: 'running',
        steps: [],
        lastSequence: 4,
      },
    },
  ], {
    activeTurn: null,
    threadStatus: 'error',
    turns: [{
      turnId: 'server-turn',
      taskId: 'server-task',
      runId: 'server-run',
      operationId: 'server-operation',
      status: 'failed',
      startSequence: 5,
      completedAt: 10,
      error: { code: 'tool_arguments_invalid', message: '参数无效' },
      items: [],
    }],
  });
  assert.equal(message.taskStatus, 'failed');
  assert.equal(message.agentRunProgress.outcome, 'failed');
});

test('journal-only hydration reconstructs terminal progress', () => {
  const result = reconcileHydratedChatMessages([], {
    activeTurn: null,
    threadStatus: 'idle',
    turns: [{ turnId: 'turn-done', taskId: 'task-done', runId: 'run-done', operationId: 'op-done', status: 'completed', startSequence: 1, completedAt: 2, items: [{ itemId: 'assistant', type: 'assistant_message', content: '已完成' }] }],
  });
  assert.equal(result.some((message) => message.content === '已完成'), true);
});
