import test from 'node:test';
import assert from 'node:assert/strict';

import { runAgentLoop } from './agent-loop.mjs';

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
  });
  assert.deepEqual(executed, ['start_skill_job']);
  assert.equal(result.stopReason, 'confirmation_required');
  assert.equal(result.confirmation.message, '请确认');
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
