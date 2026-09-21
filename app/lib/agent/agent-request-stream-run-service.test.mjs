import test from 'node:test';
import assert from 'node:assert/strict';
import {
  composeNativeRetryBeforeRetry,
  executeMainAgentTurnWithSafeRetry,
} from './agent-request-stream-run-service.mjs';

const failed = (message = 'stream disconnected before completion') => ({
  loopResult: {
    stopReason: 'failed',
    failureCode: 'native_stream_disconnected',
    errorMessage: message,
    retryable: true,
  },
});

test('default context rotation and configured retry hooks are composed in order', async () => {
  const calls = [];
  const beforeRetry = composeNativeRetryBeforeRetry(
    'session-1',
    async (event) => calls.push(`configured:${event.retryNumber}`),
    async (sessionId, reason) => calls.push(`rotate:${sessionId}:${reason}`),
  );
  await beforeRetry({ lane: 'stream', retryNumber: 2 });
  assert.deepEqual(calls, ['rotate:session-1:adapter_stream_retry', 'configured:2']);
});

test('safe Native retry allows four pre-stream retries and preserves caller identity', async () => {
  const identity = { taskId: 'task-1', operationId: 'operation-1', runId: 'run-1' };
  const observedIdentities = [];
  const rotations = [];
  let calls = 0;
  const result = await executeMainAgentTurnWithSafeRetry(async () => {
    calls += 1;
    observedIdentities.push(identity);
    return calls <= 4 ? failed() : { loopResult: { stopReason: 'completed', content: 'ok' } };
  }, {
    retryState: { beforeRetry: (event) => rotations.push(event) },
    sleep: async () => {},
  });

  assert.equal(result.loopResult.content, 'ok');
  assert.equal(calls, 5);
  assert.equal(rotations.length, 4);
  assert.deepEqual(rotations.map((event) => event.lane), ['request', 'request', 'request', 'request']);
  assert.equal(observedIdentities.every((value) => value === identity), true);
});

test('bounded-context diagnostics do not turn a pre-response failure into a stream retry', async () => {
  const lanes = [];
  let calls = 0;
  const result = await executeMainAgentTurnWithSafeRetry(async (events) => {
    calls += 1;
    await events.onRawEvent?.({
      method: 'zflow/native_context_prepared',
      params: { nativeGeneration: calls },
    });
    return calls === 1 ? failed() : { loopResult: { stopReason: 'completed', content: 'ok' } };
  }, {
    eventHandlers: { onRawEvent: () => {} },
    retryState: { beforeRetry: (event) => lanes.push(event.lane) },
    sleep: async () => {},
  });
  assert.equal(result.loopResult.content, 'ok');
  assert.deepEqual(lanes, ['request']);
});

test('Native attempt observability records retry counters and first response latency', async () => {
  const attempts = [];
  const firstResponses = [];
  await executeMainAgentTurnWithSafeRetry(async (events) => {
    await events.onRawEvent?.({ method: 'turn/started', params: {} });
    return { loopResult: { stopReason: 'completed', content: 'ok' } };
  }, {
    eventHandlers: { onRawEvent: () => {} },
    retryState: {
      onAttempt: (event) => attempts.push(event),
      onFirstResponse: (event) => firstResponses.push(event),
    },
    sleep: async () => {},
  });
  assert.deepEqual(attempts, [{ attempt: 1, requestAttempt: 1, streamAttempt: 1 }]);
  assert.equal(firstResponses.length, 1);
  assert.equal(firstResponses[0].requestAttempt, 1);
  assert.equal(firstResponses[0].streamAttempt, 1);
  assert.ok(Number.isFinite(firstResponses[0].firstResponseEventMs));
});

test('safe Native retry allows five mid-stream retries', async () => {
  let calls = 0;
  const retries = [];
  const result = await executeMainAgentTurnWithSafeRetry(async (events) => {
    calls += 1;
    if (calls <= 5) {
      await events.onRawEvent?.({ method: 'item/agentMessage/delta', params: { delta: 'working' } });
      return failed();
    }
    return { loopResult: { stopReason: 'completed', content: 'ok' } };
  }, {
    eventHandlers: { onRawEvent: () => {} },
    retryState: { beforeRetry: (event) => retries.push(event) },
    sleep: async () => {},
  });

  assert.equal(result.loopResult.content, 'ok');
  assert.equal(calls, 6);
  assert.deepEqual(retries.map((event) => event.lane), ['stream', 'stream', 'stream', 'stream', 'stream']);
});

test('exhausted Native retry is classified as a safe native_request failure', async () => {
  let calls = 0;
  await assert.rejects(
    executeMainAgentTurnWithSafeRetry(async () => {
      calls += 1;
      return failed();
    }, { sleep: async () => {} }),
    (error) => {
      assert.equal(error.code, 'native_request_exhausted');
      assert.equal(error.failureStage, 'native_request');
      assert.equal(error.retryable, true);
      assert.match(error.message, /图片供应商尚未收到请求/);
      return true;
    },
  );
  assert.equal(calls, 5);
});

test('safe Native retry stops when provider submission, assets, confirmation, cancellation or unknown outcome is observed', async () => {
  const snapshots = [
    { providerRequestStarted: true },
    { assetCount: 1 },
    { confirmationPending: true },
    { cancelled: true },
    { outcomeUnknown: true },
  ];
  for (const snapshot of snapshots) {
    let calls = 0;
    await assert.rejects(
      executeMainAgentTurnWithSafeRetry(async () => {
        calls += 1;
        return failed();
      }, {
        retryState: { getSnapshot: () => snapshot },
        sleep: async () => {},
      }),
      /stream disconnected/,
    );
    assert.equal(calls, 1);
  }
});

test('a started tool blocks retry before any duplicate application execution', async () => {
  let calls = 0;
  await assert.rejects(
    executeMainAgentTurnWithSafeRetry(async (events) => {
      calls += 1;
      await events.onToolStart?.('call-1', 'generate_image');
      return failed();
    }, {
      eventHandlers: { onToolStart: () => {} },
      sleep: async () => {},
    }),
    /stream disconnected/,
  );
  assert.equal(calls, 1);
});

test('mid-stream retry does not duplicate identical public commentary', async () => {
  let calls = 0;
  const delivered = [];
  await executeMainAgentTurnWithSafeRetry(async (events) => {
    calls += 1;
    await events.onCommentary?.({ phase: 'commentary', text: '正在准备图片' });
    return calls === 1 ? failed() : { loopResult: { stopReason: 'completed', content: 'done' } };
  }, {
    eventHandlers: { onCommentary: (item) => delivered.push(item.text) },
    sleep: async () => {},
  });
  assert.deepEqual(delivered, ['正在准备图片']);
});

test('retry suppresses replayed activity/raw timeline events but preserves new content', async () => {
  let calls = 0;
  const activities = [];
  const rawTexts = [];
  await executeMainAgentTurnWithSafeRetry(async (events) => {
    calls += 1;
    await events.onActivityText?.(`activity-${calls}`, '分析请求');
    await events.onRawEvent?.({ method: 'item/agentMessage/delta', params: { delta: '正在处理' } });
    if (calls === 1) return failed();
    await events.onActivityText?.(`activity-${calls}`, '重新连接成功');
    await events.onRawEvent?.({ method: 'item/agentMessage/delta', params: { delta: '继续生成' } });
    return { loopResult: { stopReason: 'completed', content: 'done' } };
  }, {
    eventHandlers: {
      onActivityText: (_id, delta) => activities.push(delta),
      onRawEvent: (event) => rawTexts.push(event.params.delta),
    },
    sleep: async () => {},
  });
  assert.deepEqual(activities, ['分析请求', '重新连接成功']);
  assert.deepEqual(rawTexts, ['正在处理', '继续生成']);
});

test('Native tool failure metadata survives the request-loop boundary', async () => {
  await assert.rejects(
    executeMainAgentTurnWithSafeRetry(async () => ({
      loopResult: {
        stopReason: 'failed', failureCode: 'tool_arguments_invalid', errorMessage: 'items must be array',
        failureStage: 'tool_dispatch', retryable: false, toolName: 'generate_image', toolCallId: 'call-1',
        fieldPath: 'arguments.items', providerRequestStarted: false,
      },
    }), { sleep: async () => {} }),
    (error) => {
      assert.equal(error.failureStage, 'tool_dispatch');
      assert.equal(error.toolName, 'generate_image');
      assert.equal(error.toolCallId, 'call-1');
      assert.equal(error.fieldPath, 'arguments.items');
      assert.equal(error.providerRequestStarted, false);
      return true;
    },
  );
});
