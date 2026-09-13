import test from 'node:test';
import assert from 'node:assert/strict';
import { projectNativeEvent } from './native-event-projector.mjs';
import { classifyAgentFailure, classifyAgentFailureCode, isRetryablePlannerProviderError, shouldRetryTurn, reconcileImageSideEffect, recoverNativeStreamDisconnect } from './agent-recovery-service.mjs';
import { resolveContinuationTurn } from './thread-turn-service.mjs';
import { dispatchRegisteredApplicationTool } from './application-tool-dispatcher.mjs';
import { createExecutionRecoveryRecord, createRecoveryRecord } from './agent-recovery-service.mjs';
import { executeAgentTurn } from './agent-turn-execution-service.mjs';

test('turn execution service delegates one Native turn and preserves result/error', async () => {
  const phases = [];
  const result = await executeAgentTurn({
    onBeforeExecute: async () => phases.push('before'),
    execute: async () => { phases.push('execute'); return { status: 'completed' }; },
    onAfterExecute: async ({ result: completed }) => phases.push(completed.status),
  });
  assert.deepEqual(phases, ['before', 'execute', 'completed']);
  assert.equal(result.status, 'completed');
});

test('turn execution service reports failures to the after hook without swallowing them', async () => {
  let seen;
  await assert.rejects(
    executeAgentTurn({
      execute: async () => { throw new Error('native failed'); },
      onAfterExecute: async (outcome) => { seen = outcome.error; },
    }),
    /native failed/,
  );
  assert.equal(seen.message, 'native failed');
});

test('registered tool dispatch owns tool-registry execution and preserves identity', async () => {
  const result = await dispatchRegisteredApplicationTool({
    registry: new Map([['read_relevant_context', { name: 'read_relevant_context' }]]),
    name: 'read_relevant_context',
    args: { query: 'brief' },
    allowedTools: ['read_relevant_context'],
    executionContext: { threadId: 'thread', turnId: 'turn', taskId: 'task', operationId: 'op', runId: 'run' },
    execute: async (name, args) => ({ modelResult: { name, args } }),
  });
  assert.equal(result.toolName, 'read_relevant_context');
  assert.equal(result.threadId, 'thread');
  assert.equal(result.turnId, 'turn');
  assert.equal(result.modelResult.name, 'read_relevant_context');
});

test('recovery record creation stays behind the recovery service boundary', () => {
  const record = createRecoveryRecord({
    taskId: 'task',
    runId: 'run',
    operationId: 'op',
    sourceUserMessageId: 'user',
    sessionId: 'session',
    originalRequest: 'request',
    status: 'failed',
    failureStage: 'native_runtime',
    failureMessage: 'failed',
  });
  assert.equal(record.taskId, 'task');
  assert.equal(record.failure.stage, 'native_runtime');
});

test('execution recovery factory preserves snapshot, references, and failure metadata', () => {
  const record = createExecutionRecoveryRecord({
    taskId: 'task', runId: 'run', operationId: 'op', lastSequence: 7, sessionId: 'session',
    sourceUserMessageId: 'user', latestUserMessage: 'make an image',
    stage: 'image_pipeline', message: 'provider failed', reason: '502', retryable: true,
    intent: 'image', imageOperation: 'generate', selectedContextEntityIds: ['entity'],
    runReferenceContext: { references: [{ id: 'ref', assetId: 'asset' }] },
    targetReferenceId: 'ref', selectedSkill: { id: 'imagegen' }, skillContentHash: 'hash',
    taskSnapshot: { activeVersions: [{ slotId: 'slot-1' }] },
    completedTaskIdentities: [], toolCallRecords: [],
  });
  assert.equal(record.failure.stage, 'image_pipeline');
  assert.equal(record.failure.retryability, 'retryable');
  assert.equal(record.assetId, 'asset');
  assert.deepEqual(record.contextEntityIds, ['entity']);
  assert.equal(record.skillId, 'imagegen');
  assert.equal(record.taskSnapshot.activeVersions[0].slotId, 'slot-1');
});

test('native event projector preserves runtime identities', () => {
  const [event] = projectNativeEvent({ type: 'tool_result', toolName: 'generate_image', result: { assetId: 'a' }, itemId: 'item' }, { threadId: 'thread', turnId: 'turn', taskId: 'task', operationId: 'op', runId: 'run' });
  assert.equal(event.type, 'item.completed');
  assert.equal(event.threadId, 'thread');
  assert.equal(event.turnId, 'turn');
  assert.equal(event.itemId, 'item');
  assert.equal(event.item.toolName, 'generate_image');
});

test('stream disconnect retries only before side effects', () => {
  const error = { message: 'stream disconnected before completion: Upstream error' };
  assert.equal(classifyAgentFailure(error).code, 'provider_stream_disconnect');
  assert.equal(shouldRetryTurn({ error, sideEffectStarted: false, attempt: 0 }), true);
  assert.equal(shouldRetryTurn({ error, sideEffectStarted: true, attempt: 0 }), false);
});

test('recovery service owns planner/provider failure code classification', () => {
  assert.equal(classifyAgentFailureCode(new Error('request timed out'), 'provider'), 'provider_timeout');
  assert.equal(classifyAgentFailureCode({ statusCode: 503 }), 'provider_http');
  assert.equal(classifyAgentFailureCode({ failureCode: 'invalid_tool_arguments' }), 'invalid_tool_arguments');
  assert.equal(classifyAgentFailureCode(new Error('unknown reference image')), 'invalid_reference');
  assert.equal(isRetryablePlannerProviderError({ cause: { code: 'EPIPE' } }), true);
  assert.equal(isRetryablePlannerProviderError({ statusCode: 524 }), true);
});

test('unknown image outcome is reconciled without blind retry', async () => {
  assert.deepEqual(await reconcileImageSideEffect({ outcomeUnknown: true }), { status: 'unknown', retryable: false });
});

test('thread service rejects stale continuation and returns resumable turn', () => {
  const state = { activeTurn: null, turns: [{ turnId: 'turn-1', operationId: 'op-1', status: 'failed' }] };
  assert.equal(resolveContinuationTurn({ state, operationId: 'op-1' }), 'turn-1');
  assert.throws(() => resolveContinuationTurn({ state, operationId: 'missing' }), /Continuation is stale/);
});

test('recovery invalidates before one pre-tool stream retry', async () => {
  const calls = [];
  const result = await recoverNativeStreamDisconnect({
    error: { message: 'stream disconnected before completion: Upstream error' },
    sideEffectStarted: false,
    attempt: 0,
    invalidate: async () => calls.push('invalidate'),
    run: async () => { calls.push('run'); return { status: 'completed', text: 'ok' }; },
  });
  assert.equal(result.recovered, true);
  assert.deepEqual(calls, ['invalidate', 'run']);
});

test('recovery never retries after a tool side effect or unknown outcome', async () => {
  let calls = 0;
  const run = async () => { calls += 1; return { status: 'completed' }; };
  assert.equal((await recoverNativeStreamDisconnect({ error: { message: 'stream disconnected' }, sideEffectStarted: true, run })).recovered, false);
  assert.equal((await recoverNativeStreamDisconnect({ error: { message: 'stream disconnected', outcomeUnknown: true }, run })).recovered, false);
  assert.equal(calls, 0);
});
