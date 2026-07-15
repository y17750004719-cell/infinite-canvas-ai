import test from 'node:test';
import assert from 'node:assert/strict';

import * as agentLoopModule from './agent-loop.mjs';

const { runAgentLoop } = agentLoopModule;

test('agent loop executes normalized tool calls and returns the final response', async () => {
  const modelRequests = [];
  const executed = [];
  const responses = [
    {
      choices: [{ message: {
        content: '',
        tool_calls: [
          { id: 'call-1', type: 'function', function: { name: 'get_canvas_context', arguments: '{}' } },
        ],
      } }],
    },
    { choices: [{ message: { content: '画布中有 3 个元素。' } }] },
  ];

  const result = await runAgentLoop({
    messages: [{ role: 'user', content: '看看画布' }],
    tools: [{ type: 'function', function: { name: 'get_canvas_context', description: 'Read canvas', parameters: { type: 'object' } } }],
    modelFn: async (request) => {
      modelRequests.push(request);
      return responses.shift();
    },
    executeTool: async (name, args) => {
      executed.push({ name, args });
      return { itemCount: 3 };
    },
    isReadOnlyTool: () => true,
  });

  assert.deepEqual(executed, [{ name: 'get_canvas_context', args: {} }]);
  assert.equal(modelRequests.length, 2);
  assert.equal(modelRequests[1].messages.at(-1).role, 'tool');
  assert.equal(result.content, '画布中有 3 个元素。');
  assert.equal(result.toolCalls, 1);
});

test('agent loop runs read-only tools in parallel and mutation tools in order', async () => {
  const started = [];
  const finished = [];
  let releaseReads;
  const readsReleased = new Promise((resolve) => { releaseReads = resolve; });
  let modelCall = 0;

  const resultPromise = runAgentLoop({
    messages: [{ role: 'user', content: '执行工具' }],
    tools: [],
    modelFn: async () => {
      modelCall += 1;
      if (modelCall > 1) return { choices: [{ message: { content: '完成' } }] };
      return { choices: [{ message: {
        content: '',
        tool_calls: [
          { id: 'read-1', type: 'function', function: { name: 'read_a', arguments: '{}' } },
          { id: 'read-2', type: 'function', function: { name: 'read_b', arguments: '{}' } },
          { id: 'write-1', type: 'function', function: { name: 'write_a', arguments: '{}' } },
        ],
      } }] };
    },
    executeTool: async (name) => {
      started.push(name);
      if (name.startsWith('read_')) await readsReleased;
      finished.push(name);
      return { ok: true };
    },
    isReadOnlyTool: (name) => name.startsWith('read_'),
  });

  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(started, ['read_a', 'read_b']);
  releaseReads();
  const result = await resultPromise;
  assert.deepEqual(finished, ['read_a', 'read_b', 'write_a']);
  assert.equal(result.content, '完成');
});

test('agent loop stops when a tool requires confirmation', async () => {
  const executed = [];
  const publicResults = [];
  const result = await runAgentLoop({
    messages: [{ role: 'user', content: '批量生成' }],
    tools: [],
    modelFn: async () => ({ choices: [{ message: {
      content: '',
      tool_calls: [
        { id: 'call-1', type: 'function', function: { name: 'start_skill_job', arguments: '{"skillType":"brand"}' } },
        { id: 'call-2', type: 'function', function: { name: 'generate_image', arguments: '{}' } },
      ],
    } }] }),
    executeTool: async (name) => {
      executed.push(name);
      return name === 'start_skill_job'
        ? { confirmationRequired: true, toolName: 'start_skill_job', message: '请确认' }
        : { ok: true };
    },
    isReadOnlyTool: () => false,
    onToolResult: (event) => publicResults.push(event),
  });
  assert.deepEqual(executed, ['start_skill_job']);
  assert.deepEqual(publicResults, []);
  assert.equal(result.stopReason, 'confirmation_required');
  assert.equal(result.confirmation.message, '请确认');
  assert.equal(result.confirmation.toolCallId, 'call-1');
});

test('execution requests retry once and reject unsupported completion claims without a mutation tool', async () => {
  const modelRequests = [];
  const result = await runAgentLoop({
    messages: [{ role: 'user', content: '生成第二张封面' }],
    tools: [{ type: 'function', function: { name: 'generate_image' } }],
    requireMutationTool: true,
    modelFn: async (request) => {
      modelRequests.push(request);
      return { choices: [{ message: { content: '第二张封面已启动生成。' } }] };
    },
    executeTool: async () => ({ ok: true }),
    isReadOnlyTool: () => false,
  });

  assert.equal(modelRequests.length, 2);
  assert.match(modelRequests[1].messages.at(-1).content, /Call one allowed mutation tool now/);
  assert.equal(result.content, '');
  assert.equal(result.mutationToolCalls, 0);
  assert.equal(result.stopReason, 'execution_required');
});

test('agent loop sends separately serialized model and public tool results', async () => {
  assert.equal(typeof agentLoopModule.createAgentToolResultViews, 'function');
  const publicResults = [];
  const modelRequests = [];
  let modelCall = 0;
  const rawResult = {
    id: 'job-1',
    providerId: 'secret-provider',
    model: 'secret-model',
    metadata: { internal: true },
    items: [{
      name: '海报',
      status: 'completed',
      prompt: 'secret prompt',
      localUrl: 'https://signed.example/asset.png?token=secret',
    }],
  };

  const result = await runAgentLoop({
    messages: [{ role: 'user', content: '查看任务' }],
    tools: [],
    modelFn: async (request) => {
      modelRequests.push(request);
      modelCall += 1;
      if (modelCall === 1) {
        return { choices: [{ message: {
          content: '',
          tool_calls: [{ id: 'job-call', type: 'function', function: { name: 'get_skill_job', arguments: '{"jobId":"job-1"}' } }],
        } }] };
      }
      return { choices: [{ message: { content: '任务已完成' } }] };
    },
    executeTool: async () => rawResult,
    isReadOnlyTool: () => true,
    serializeToolResultForModel: (name, value) => agentLoopModule.createAgentToolResultViews(name, value).modelResult,
    serializeToolResultForPublic: (name, value) => agentLoopModule.createAgentToolResultViews(name, value).publicResult,
    onToolResult: (event) => publicResults.push(event),
  });

  assert.equal(result.content, '任务已完成');
  const modelResult = JSON.parse(modelRequests[1].messages.at(-1).content);
  const serializedModelResult = JSON.stringify(modelResult);
  assert.doesNotMatch(serializedModelResult, /https?:\/\//);
  assert.doesNotMatch(serializedModelResult, /provider|model|prompt|metadata/i);
  assert.deepEqual(publicResults, [{
    id: 'job-call',
    name: 'get_skill_job',
    result: {
      kind: 'skill_job_status',
      jobId: 'job-1',
      status: 'unknown',
      completed: 1,
      failed: 0,
      cancelled: 0,
      total: 1,
    },
  }]);
});

test('public image results contain counts but never asset URLs', () => {
  assert.equal(typeof agentLoopModule.createAgentToolResultViews, 'function');
  const views = agentLoopModule.createAgentToolResultViews('generate_image', {
    result: {
      outputs: [{ localUrl: 'https://signed.example/image.png?token=secret' }],
    },
    resolvedImageOptions: {
      providerId: 'secret-provider',
      model: 'secret-model',
      size: '2048x2048',
      aspectRatio: '4:3',
      quality: 'auto',
    },
    requestStats: { requested: 1, succeeded: 1, failed: 0 },
  });

  assert.deepEqual(views.publicResult, {
    kind: 'image_generation',
    assetCount: 1,
    requestStats: { requested: 1, succeeded: 1, failed: 0 },
    partialFailure: false,
  });
  const serializedViews = JSON.stringify(views);
  assert.doesNotMatch(serializedViews, /https?:\/\//);
  assert.doesNotMatch(serializedViews, /"(?:providerId|model|prompt|metadata|localUrl|url)"/i);
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
  assert.equal(typeof agentLoopModule.createAgentProgressTracker, 'function');
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

test('public tool event helper keeps image URLs only in client actions for every image branch', () => {
  assert.equal(typeof agentLoopModule.createAgentToolResultEvents, 'function');
  for (const source of ['direct', 'loop', 'confirmed']) {
    const events = agentLoopModule.createAgentToolResultEvents({
      source,
      runId: `run-${source}`,
      toolCallId: `tool-${source}`,
      toolName: 'generate_image',
      rawResult: {
        result: { outputs: [{ localUrl: `https://example.test/${source}.png?token=secret` }] },
        requestStats: { requested: 1, succeeded: 1, failed: 0 },
      },
    });
    assert.deepEqual(events.map((event) => event.type), ['tool_result', 'client_action']);
    assert.doesNotMatch(JSON.stringify(events[0]), /https?:\/\/|token=secret/);
    assert.match(JSON.stringify(events[1]), new RegExp(`${source}\\.png`));
  }
});

test('public tool event helper emits no ordinary result for confirmation placeholders', () => {
  assert.equal(typeof agentLoopModule.createAgentToolResultEvents, 'function');
  assert.deepEqual(agentLoopModule.createAgentToolResultEvents({
    runId: 'run-confirm',
    toolCallId: 'tool-confirm',
    toolName: 'start_skill_job',
    rawResult: { confirmationRequired: true, toolName: 'start_skill_job', message: '请确认' },
  }), []);
});

test('agent loop enforces tool and turn budgets', async () => {
  await assert.rejects(
    () => runAgentLoop({
      messages: [{ role: 'user', content: '循环' }],
      tools: [],
      maxToolCalls: 1,
      modelFn: async () => ({ choices: [{ message: {
        content: '',
        tool_calls: [
          { id: 'one', type: 'function', function: { name: 'read_a', arguments: '{}' } },
          { id: 'two', type: 'function', function: { name: 'read_b', arguments: '{}' } },
        ],
      } }] }),
      executeTool: async () => ({}),
      isReadOnlyTool: () => true,
    }),
    /tool call budget exceeded/i,
  );

  await assert.rejects(
    () => runAgentLoop({
      messages: [{ role: 'user', content: '循环' }],
      tools: [],
      maxTurns: 1,
      modelFn: async () => ({ choices: [{ message: {
        content: '',
        tool_calls: [{ id: 'one', type: 'function', function: { name: 'read_a', arguments: '{}' } }],
      } }] }),
      executeTool: async () => ({}),
      isReadOnlyTool: () => true,
    }),
    /turn budget exceeded/i,
  );
});
