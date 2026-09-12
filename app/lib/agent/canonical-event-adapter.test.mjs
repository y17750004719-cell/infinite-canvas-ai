import test from 'node:test';
import assert from 'node:assert/strict';
import { adaptCanonicalEvent } from './canonical-event-adapter.mjs';

const base = { threadId: 'thread', turnId: 'turn', taskId: 'task', operationId: 'op', runId: 'run', sequence: 2, timestampMs: 10 };

test('canonical progress and tool events retain stable identity and parent links', () => {
  const ids = { itemId: 'run:tool:call', toolCallId: 'call', executionId: 'run:execution:call', parentItemId: 'commentary' };
  for (const event of [
    { type: 'item.started', itemType: 'tool_call', item: { toolName: 'get_canvas_context' } },
    { type: 'item.completed', itemType: 'tool_result', item: { isError: true } },
    { type: 'item.updated', itemType: 'public_event', item: { payload: { type: 'progress_update', stepId: 'canvas_context' } } },
  ]) {
    const adapted = adaptCanonicalEvent({ ...base, ...ids, ...event });
    for (const [key, value] of Object.entries(ids)) assert.equal(adapted[key], value);
    if (event.itemType === 'tool_result') assert.equal(adapted.isError, true);
  }
});

test('maps canonical assistant and tool items to existing page events', () => {
  assert.equal(adaptCanonicalEvent({ ...base, type: 'thread.started' }), null);
  assert.deepEqual(adaptCanonicalEvent({ ...base, type: 'turn.started' }).type, 'agent_start');
  assert.equal(adaptCanonicalEvent({ ...base, type: 'item.updated', itemType: 'assistant_message', itemId: 'a', item: { delta: 'hello' } }).delta, 'hello');
  assert.equal(adaptCanonicalEvent({ ...base, type: 'item.started', itemType: 'tool_call', toolCallId: 'tc', item: { toolName: 'todo_update' } }).type, 'tool_start');
  const todo = adaptCanonicalEvent({ ...base, type: 'item.completed', itemId: 'todo-1', itemType: 'todo_list', item: { items: [{ content: 'Ship', status: 'completed' }] } });
  assert.equal(todo.type, 'progress_update');
  assert.match(todo.detail, /\[x\] Ship/);
});

test('preserves approval and clarification payloads', () => {
  const approval = adaptCanonicalEvent({ ...base, type: 'item.started', itemType: 'confirmation', item: { request: { confirmationId: 'c1', toolName: 'generate_image' } } });
  assert.equal(approval.type, 'confirmation_required');
  assert.equal(approval.request.confirmationId, 'c1');
  const clarification = adaptCanonicalEvent({ ...base, type: 'item.started', itemType: 'clarification', item: { request: { id: 'q1' }, state: { status: 'pending' } } });
  assert.equal(clarification.type, 'clarification_required');
  assert.equal(clarification.state.status, 'pending');
});

test('maps terminal statuses without exposing a second wire protocol', () => {
  assert.equal(adaptCanonicalEvent({ ...base, type: 'turn.completed' }).type, 'agent_done');
  assert.equal(adaptCanonicalEvent({ ...base, type: 'turn.failed', status: 'cancelled', error: { message: 'cancelled' } }).type, 'agent_cancelled');
  assert.equal(adaptCanonicalEvent({ ...base, type: 'turn.failed', status: 'interrupted', error: { message: 'interrupted' } }).type, 'agent_error');
});
