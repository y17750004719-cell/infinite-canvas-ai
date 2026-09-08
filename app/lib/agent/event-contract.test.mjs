import test from 'node:test';
import assert from 'node:assert/strict';

import {
  assertExpectedSequence,
  assertSameAgentOperation,
  classifyAgentEvent,
  classifyAgentSequence,
  normalizeAgentEventIdentity,
  resolveAgentIdentity,
} from './event-contract.mjs';

test('new runs default task and operation identity to runId', () => {
  assert.deepEqual(resolveAgentIdentity({ runId: 'run-1' }), {
    taskId: 'run-1', operationId: 'run-1', runId: 'run-1', lastSequence: 0,
  });
});

test('continuations preserve task and operation identity and sequence', () => {
  assert.deepEqual(resolveAgentIdentity({
    runId: 'run-2',
    continuation: { taskId: 'task-1', operationId: 'op-1', lastSequence: 9 },
  }), {
    taskId: 'task-1', operationId: 'op-1', runId: 'run-2', lastSequence: 9,
  });
});

test('events without the current identity contract are rejected', () => {
  assert.equal(normalizeAgentEventIdentity({ type: 'agent_done', runId: 'run-1' }), null);
});

test('sequence classification rejects duplicates and older events', () => {
  assert.equal(classifyAgentSequence(4, 4), 'stale');
  assert.equal(classifyAgentSequence(3, 4), 'stale');
  assert.equal(classifyAgentSequence(5, 4), 'accepted');
});

test('stale operation and sequence errors expose 409 contracts', () => {
  assert.throws(() => assertSameAgentOperation('op-1', 'op-2'), (error) => (
    error.code === 'stale_operation' && error.statusCode === 409
  ));
  assert.throws(() => assertExpectedSequence(2, 3), (error) => (
    error.code === 'stale_sequence' && error.statusCode === 409
  ));
});

test('strict IDs reject overlong values instead of truncating them', () => {
  assert.throws(() => resolveAgentIdentity({ runId: 'x'.repeat(201) }), /exceeds 200/);
  assert.equal(normalizeAgentEventIdentity({ type: 'agent_done', runId: 'x'.repeat(201) }), null);
});

test('event classification rejects incomplete identity and stale events', () => {
  assert.equal(classifyAgentEvent({ type: 'tool_result', runId: 'run-1' }).reason, 'invalid_identity');
  assert.equal(classifyAgentEvent({ type: 'tool_result', taskId: 'task-1', operationId: 'op-1', runId: 'run-1', sequence: 2 }, { taskId: 'task-1', operationId: 'op-1', lastSequence: 2 }).reason, 'stale_sequence');
  assert.equal(classifyAgentEvent({ type: 'tool_result', taskId: 'task-1', operationId: 'op-1', runId: 'run-1', sequence: 3 }, { taskId: 'task-1', operationId: 'op-1', lastSequence: 2 }).accepted, true);
});
