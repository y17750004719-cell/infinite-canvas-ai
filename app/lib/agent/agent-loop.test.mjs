import test from 'node:test';
import assert from 'node:assert/strict';

import * as agentLoopModule from './agent-loop.mjs';

test('public image results contain counts but never asset URLs', () => {
  const views = agentLoopModule.createAgentToolResultViews('generate_image', {
    result: { outputs: [{ localUrl: 'https://signed.example/image.png?token=secret' }] },
    resolvedImageOptions: {
      providerId: 'secret-provider',
      model: 'secret-model',
      count: 5,
      requestedCount: 12,
      countSource: 'batch',
    },
    requestStats: { requested: 1, succeeded: 1, failed: 0 },
  });

  assert.deepEqual(views.publicResult, {
    kind: 'image_generation',
    assetCount: 1,
    requestStats: { requested: 1, succeeded: 1, failed: 0 },
    partialFailure: false,
    resolvedImageOptions: { count: 5, requestedCount: 12, countSource: 'batch' },
  });
  assert.doesNotMatch(JSON.stringify(views), /https?:\/\/|"(?:providerId|model|prompt|metadata|localUrl|url)"/i);
});

test('progress tracker resumes one operation with strictly increasing sequence and settles active steps', () => {
  const firstEvents = [];
  const first = agentLoopModule.createAgentProgressTracker({
    runId: 'run-1',
    operationId: 'operation-1',
    emit: (event) => firstEvents.push(event),
  });
  first.update({ stepId: 'clarification', phase: 'analyzing', status: 'active', label: '正在分析' });
  first.update({ stepId: 'clarification', phase: 'waiting_input', status: 'waiting', label: '等待补充' });
  const checkpoint = first.snapshot();

  const resumedEvents = [];
  const resumed = agentLoopModule.createAgentProgressTracker({
    runId: 'run-2',
    operationId: checkpoint.operationId,
    lastSequence: checkpoint.lastSequence,
    emit: (event) => resumedEvents.push(event),
  });
  resumed.update({ stepId: 'clarification', phase: 'resuming', status: 'active', label: '正在恢复' });
  resumed.update({ stepId: 'generate_image', phase: 'generating', status: 'active', label: '正在生成' });
  resumed.settleActive('failed', '运行失败');

  assert.deepEqual(firstEvents.map((event) => event.sequence), [1, 2]);
  assert.deepEqual(resumedEvents.map((event) => event.sequence), [3, 4, 5, 6]);
  assert.ok(resumedEvents.slice(-2).every((event) => event.status === 'failed'));
  assert.ok(resumedEvents.every((event) => event.operationId === 'operation-1'));
});

test('progress tracker rejects resuming a different operation', () => {
  const tracker = agentLoopModule.createAgentProgressTracker({ runId: 'run-1', operationId: 'operation-1' });
  assert.throws(() => tracker.resume({ operationId: 'operation-2' }), (error) => (
    error.code === 'stale_operation' && error.statusCode === 409
  ));
});

test('progress tracker keeps one stable item identity across tool updates', () => {
  const events = [];
  const tracker = agentLoopModule.createAgentProgressTracker({
    runId: 'run-items',
    emit: (event) => events.push(event),
  });
  tracker.update({
    stepId: 'tool', phase: 'executing', status: 'active', label: '正在读取',
    toolCallId: 'call-1', toolName: 'read_relevant_context', itemId: 'run-items:tool:call-1', executionId: 'run-items:execution:call-1',
  });
  tracker.update({
    stepId: 'tool', phase: 'executing', status: 'completed', label: '读取完成',
    toolCallId: 'call-1', toolName: 'read_relevant_context', itemId: 'run-items:tool:call-1', executionId: 'run-items:execution:call-1',
  });

  assert.deepEqual(events.map((event) => event.itemId), ['run-items:tool:call-1', 'run-items:tool:call-1']);
  assert.deepEqual(events.map((event) => event.executionId), ['run-items:execution:call-1', 'run-items:execution:call-1']);
});

test('image generation heartbeat emits while a supplier request is pending and stops cleanly', () => {
  const pulses = [];
  let timerCallback;
  let clearedTimer;
  const clockValues = [1_000, 11_250];
  const stop = agentLoopModule.startAgentImageGenerationHeartbeat({
    intervalMs: 10_000,
    now: () => clockValues.shift(),
    onPulse: (elapsedMs) => pulses.push(elapsedMs),
    setIntervalFn: (callback, intervalMs) => {
      timerCallback = callback;
      assert.equal(intervalMs, 10_000);
      return 'heartbeat-timer';
    },
    clearIntervalFn: (timer) => { clearedTimer = timer; },
  });

  timerCallback();
  stop();

  assert.deepEqual(pulses, [10_250]);
  assert.equal(clearedTimer, 'heartbeat-timer');
});

test('public tool event helper keeps image URLs only in client actions', () => {
  const events = agentLoopModule.createAgentToolResultEvents({
    runId: 'run-loop',
    toolCallId: 'tool-loop',
    toolName: 'generate_image',
    rawResult: {
      result: { outputs: [{ localUrl: 'https://example.test/loop.png?token=secret' }] },
      requestStats: { requested: 1, succeeded: 1, failed: 0 },
    },
  });

  assert.deepEqual(events.map((event) => event.type), ['tool_result', 'client_action']);
  assert.doesNotMatch(JSON.stringify(events[0]), /https?:\/\/|token=secret/);
  assert.match(JSON.stringify(events[1]), /loop\.png/);
  assert.match(events[1].action.assets[0].deliveryId, /^generated-delivery:run-loop:/);
  assert.ok(Number.isFinite(events[1].action.deliveryEventAt));
});

test('public tool event helper forwards valid image presentation only to the client action', () => {
  const events = agentLoopModule.createAgentToolResultEvents({
    runId: 'run-presented',
    toolCallId: 'tool-presented',
    toolName: 'generate_image',
    rawResult: {
      result: { outputs: [{ localUrl: 'https://example.test/presented.png' }] },
      presentation: { title: '  标题  ', summary: '  完成  ', operation: 'edit' },
    },
  });

  assert.deepEqual(events[1].action.presentation, { title: '标题', summary: '完成', operation: 'edit' });
  assert.equal(events[0].result.presentation, undefined);
});

test('public tool event helper emits no ordinary result for confirmation placeholders', () => {
  assert.deepEqual(agentLoopModule.createAgentToolResultEvents({
    runId: 'run-confirm',
    toolCallId: 'tool-confirm',
    toolName: 'generate_image',
    rawResult: { confirmationRequired: true },
  }), []);
});

test('public tool event helper exposes sanitized failures instead of completed results', () => {
  const events = agentLoopModule.createAgentToolResultEvents({
    toolCallId: 'tool-failed',
    toolName: 'echo',
    rawResult: { error: 'provider=secret https://example.test/failure' },
  });

  assert.deepEqual(events[0].result, {
    kind: 'tool_error',
    toolName: 'echo',
    status: 'failed',
    message: 'provider=[redacted] [redacted-url]',
  });
});

test('public tool event helper can suppress aggregate assets after incremental delivery', () => {
  const events = agentLoopModule.createAgentToolResultEvents({
    runId: 'run-streamed',
    toolCallId: 'tool-streamed',
    toolName: 'generate_image',
    includeAssets: false,
    rawResult: {
      result: { outputs: [{ localUrl: 'https://example.test/already-streamed.png' }] },
      requestStats: { requested: 1, succeeded: 1, failed: 0 },
    },
  });
  assert.deepEqual(events.map((event) => event.type), ['tool_result']);
});
