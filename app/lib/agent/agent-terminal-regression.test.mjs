import test from 'node:test';
import assert from 'node:assert/strict';
import { createAgentProgressTracker } from './agent-loop.mjs';
import { createAgentRequestExecutionState } from './agent-request-execution-state.mjs';
import { projectNativeEvent } from './native-event-projector.mjs';
import { adaptCanonicalEvent } from './canonical-event-adapter.mjs';
import { handleAgentFailure } from './agent-failure-flow.mjs';
import { createEventSink } from './event-sink.mjs';
import { createAgentResponseLifecycle } from './agent-response-lifecycle.mjs';
import { reduceAgentRunProgress } from './run-progress.mjs';

test('completed Skill leaves the active tracker and cannot be failed by run cleanup or late progress', () => {
  const events = [];
  const tracker = createAgentProgressTracker({ taskId: 'task', operationId: 'op', runId: 'run', emit: (event) => events.push(event) });
  const state = createAgentRequestExecutionState({
    tracker, emit: (event) => events.push(event), sessionId: 'thread', runId: 'run', taskId: 'task', operationId: 'op',
    isAgentLifecycleEvent: () => true, contextEventFromAgentEvent: () => null,
  });
  state.writeToolStartEvent('skill-call', 'select_visual_skill');
  state.writeToolResultEvent('skill-call', 'select_visual_skill', { success: true });
  state.writeProgress({ stepId: 'tool', toolCallId: 'skill-call', toolName: 'select_visual_skill', status: 'active', label: 'late heartbeat' });
  state.writeToolResultEvent('skill-call', 'select_visual_skill', { success: false }, true);
  state.writeToolStartEvent('image-call', 'generate_image');
  tracker.settleActive('failed', '运行失败');
  assert.equal(events.filter((event) => event.type === 'tool_result' && event.toolCallId === 'skill-call').length, 1);
  assert.equal(events.filter((event) => event.toolCallId === 'skill-call' && (event.status === 'failed' || event.label === 'late heartbeat')).length, 0);
  assert.ok(events.some((event) => event.toolCallId === 'image-call' && event.status === 'failed'));
});

test('parameter error metadata survives failure boundary, canonical projection and client adaptation', async () => {
  const metadata = { toolName: 'generate_image', toolCallId: 'call-image', fieldPath: 'arguments.items', providerRequestStarted: false, outcomeUnknown: false };
  const error = Object.assign(new Error('Invalid arguments for generate_image: arguments.items must be array'), {
    code: 'tool_arguments_invalid', failureStage: 'tool_dispatch', retryable: false, ...metadata,
  });
  let emitted;
  await handleAgentFailure({ error, buildRecoveryRecord: () => ({}), log: async () => {}, settle: () => {}, emit: (event) => { emitted = event; } });
  const base = { threadId: 'thread', turnId: 'turn', taskId: 'task', operationId: 'op', runId: 'run' };
  const canonical = { ...projectNativeEvent(emitted, base)[0], sequence: 5 };
  const adapted = adaptCanonicalEvent(canonical);
  for (const [key, value] of Object.entries(metadata)) assert.equal(adapted[key], value, key);
  assert.equal(adapted.stage, 'tool_dispatch');
  assert.equal(adapted.failureStage, 'tool_dispatch');
  assert.equal(adapted.code, 'tool_arguments_invalid');
});

test('Skill success then image rejection journals tool terminal before run terminal and flushes before unregister', async () => {
  const base = { threadId: 'thread', turnId: 'turn', taskId: 'task', operationId: 'op', runId: 'run' };
  const saved = [];
  const streamed = [];
  const order = [];
  let releaseTerminal;
  const terminalGate = new Promise(resolve => { releaseTerminal = resolve; });
  const sink = createEventSink({
    journal: { appendThreadEvent: async (_threadId, event) => {
      if (event.type === 'turn.failed') await terminalGate;
      const result = { ...event, sequence: saved.length + 1 };
      saved.push(result);
      order.push(event.type);
      return result;
    } },
    streamController: { enqueue: chunk => streamed.push(JSON.parse(new TextDecoder().decode(chunk))) },
  });
  const emit = event => { void sink.persistCanonicalEvents({ threadId: base.threadId, events: projectNativeEvent(event, base) }); };
  const tracker = createAgentProgressTracker({ ...base, emit });
  const state = createAgentRequestExecutionState({ tracker, emit, ...base, sessionId: base.threadId,
    isAgentLifecycleEvent: () => true, contextEventFromAgentEvent: () => null });
  state.writeToolStartEvent('skill', 'select_visual_skill');
  state.writeToolResultEvent('skill', 'select_visual_skill', { success: true, locked: true, skillName: 'Fixture style' });
  state.writeToolStartEvent('image', 'generate_image');
  const metadata = { code: 'tool_arguments_invalid', failureStage: 'tool_dispatch', toolName: 'generate_image', toolCallId: 'image', fieldPath: 'arguments.items', providerRequestStarted: false };
  state.writeToolResultEvent('image', 'generate_image', { success: false, ...metadata }, true);
  await handleAgentFailure({ error: Object.assign(new Error('Invalid image arguments'), metadata),
    buildRecoveryRecord: () => ({}), log: async () => {}, settle: status => tracker.settleActive(status), emit });
  const finalizing = createAgentResponseLifecycle({ flush: () => sink.flush(), settle: () => order.push('unregister'), close: () => order.push('close') }).finalize();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(order.includes('unregister'), false);
  releaseTerminal();
  await finalizing;
  assert.deepEqual(order.slice(-3), ['turn.failed', 'unregister', 'close']);
  assert.equal(saved.at(-2).itemType, 'tool_result');
  assert.equal(saved.at(-2).item.isError, true);
  assert.deepEqual(streamed, JSON.parse(JSON.stringify(saved)));
  let progress;
  for (const event of saved) {
    const adapted = adaptCanonicalEvent(event);
    if (adapted) progress = reduceAgentRunProgress(progress, adapted);
  }
  assert.equal(progress.steps.find(step => step.toolCallId === 'skill').status, 'completed');
  assert.equal(progress.steps.find(step => step.toolCallId === 'image').status, 'failed');
  assert.equal(progress.terminalFailed, true);
  assert.equal(progress.outcome, 'failed');
});
