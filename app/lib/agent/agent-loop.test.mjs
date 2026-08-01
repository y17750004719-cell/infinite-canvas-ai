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

test('public skill job results preserve the skill type without exposing job internals', () => {
  const views = agentLoopModule.createAgentToolResultViews('start_skill_job', {
    id: 'brand-job-1',
    skillType: 'brand',
    status: 'queued',
    metadata: { prompt: 'private prompt' },
    items: [{ key: 'poster', name: '海报', status: 'queued', localUrl: '/var/private.png' }],
  });

  assert.equal(views.publicResult.skillType, 'brand');
  assert.doesNotMatch(JSON.stringify(views.publicResult), /private prompt|localUrl|\/var\//i);
});

test('tool model results redact embedded URLs paths credentials and provider details', () => {
  const views = agentLoopModule.createAgentToolResultViews('get_skill_job', {
    id: 'job-sensitive',
    status: 'failed',
    providerId: 'private-provider',
    model: 'private-model',
    metadata: { token: 'raw-secret' },
    items: [{
      key: 'poster',
      name: '海报',
      status: 'failed',
      prompt: 'private prompt',
      localUrl: 'https://example.test/result.png?token=raw-secret',
      error: 'provider=private-provider model=private-model failed at https://example.test/log?token=raw-secret /Users/alice/file /Volumes/ZO/file /var/tmp/file access_token=raw-secret',
    }],
  });

  const serialized = JSON.stringify(views.modelResult);
  assert.doesNotMatch(serialized, /raw-secret|private-provider|private-model|https?:\/\/|\/Users\/|\/Volumes\/|\/var\//i);
  assert.doesNotMatch(serialized, /"(?:providerId|model|prompt|metadata|localUrl|url)"/i);
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
    toolName: 'start_skill_job',
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
