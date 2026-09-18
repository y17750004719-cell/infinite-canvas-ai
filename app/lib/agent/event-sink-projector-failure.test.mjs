import test from 'node:test';
import assert from 'node:assert/strict';
import { projectNativeEvent } from './native-event-projector.mjs';
import { createEventSink } from './event-sink.mjs';

test('projects native failures into canonical top-level diagnostic fields', () => {
  const [event] = projectNativeEvent({
    type: 'agent_error',
    message: 'tool host unavailable',
    code: 'native_tool_host_disabled',
    failureStage: 'native_runtime',
    retryable: false,
    outcomeUnknown: false,
  }, { threadId: 'thread', turnId: 'turn', taskId: 'task', operationId: 'op', runId: 'run' });
  assert.equal(event.type, 'turn.failed');
  assert.equal(event.failureCode, 'native_tool_host_disabled');
  assert.equal(event.failureStage, 'native_runtime');
  assert.equal(event.retryable, false);
  assert.equal(event.outcomeUnknown, false);
  assert.equal(event.error.failureCode, event.failureCode);
});

test('projects raw native error notifications as failures instead of public items', () => {
  const [event] = projectNativeEvent({
    type: 'error',
    error: { code: 'provider_overloaded', message: 'upstream overloaded', retryable: false },
  }, { threadId: 'thread', turnId: 'turn', taskId: 'task', operationId: 'op', runId: 'run' });
  assert.equal(event.type, 'turn.failed');
  assert.equal(event.failureCode, 'provider_overloaded');
});

test('event sink journal-first delivery deduplicates by event type and identity', async () => {
  const saved = [];
  const streamed = [];
  const journal = { appendThreadEvent: async (_threadId, event) => { saved.push(event); return { ...event, persisted: true }; } };
  const sink = createEventSink({ journal, streamController: { enqueue: value => streamed.push(new TextDecoder().decode(value)) } });
  const base = { threadId: 'thread', turnId: 'turn', runId: 'run', sequence: 1 };
  await sink.persistCanonicalEvents({ threadId: 'thread', events: [
    { ...base, type: 'item.updated' },
    { ...base, type: 'turn.failed', failureCode: 'provider_overloaded' },
    { ...base, type: 'item.updated' },
  ] });
  assert.equal(saved.length, 2);
  assert.equal(streamed.length, 2);
  assert.equal(saved[1].failureCode, 'provider_overloaded');
});
