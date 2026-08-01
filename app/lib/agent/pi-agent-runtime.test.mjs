import assert from 'node:assert/strict';
import test from 'node:test';
import { runZFlowAgentBrain } from './pi-agent-runtime.mjs';

const tools = [
  {
    name: 'echo',
    description: 'Echo a value.',
    parameters: {
      type: 'object',
      properties: { value: { type: 'string' } },
      required: ['value'],
      additionalProperties: false,
    },
    readOnly: false,
  },
];

function textStream(value) {
  return async function* stream() {
    yield { type: 'start', model: 'test-model' };
    if (value) yield { type: 'delta', channel: 'content', content: value };
    yield { type: 'done' };
  };
}

function toolStream(calls) {
  return async function* stream() {
    yield { type: 'start', model: 'test-model' };
    for (const [index, call] of calls.entries()) {
      const args = JSON.stringify(call.args);
      yield { type: 'tool_call_start', toolCallId: call.id, index, name: call.name };
      yield { type: 'tool_call_delta', toolCallId: call.id, index, argumentsDelta: args };
      yield { type: 'tool_call_end', toolCallId: call.id, index, name: call.name, arguments: args };
    }
    yield { type: 'done' };
  };
}

test('Pi runtime executes a sequential tool and continues to a final response', async () => {
  let requestCount = 0;
  const executed = [];
  const result = await runZFlowAgentBrain({
    messages: [{ role: 'user', content: 'echo ok' }],
    systemPrompt: 'test',
    providerId: 'provider-1',
    model: 'test-model',
    tools,
    chatStream: (request) => {
      requestCount += 1;
      assert.equal(request.providerId, 'provider-1');
      return requestCount === 1
        ? toolStream([{ id: 'call-1', name: 'echo', args: { value: 'ok' } }])()
        : textStream('done')();
    },
    executeTool: async (name, args, context) => {
      executed.push({ name, args, toolCallId: context.toolCallId });
      return { modelResult: { value: args.value }, publicResult: { value: args.value } };
    },
  });

  assert.equal(result.stopReason, 'completed');
  assert.equal(result.content, 'done');
  assert.equal(result.toolCalls, 1);
  assert.equal(result.mutationToolCalls, 1);
  assert.deepEqual(executed, [{ name: 'echo', args: { value: 'ok' }, toolCallId: 'call-1' }]);
});

test('Pi runtime blocks an entire tool batch when it exceeds the budget', async () => {
  let executed = 0;
  const result = await runZFlowAgentBrain({
    messages: [{ role: 'user', content: 'run tools' }],
    providerId: 'provider-1',
    model: 'test-model',
    tools,
    maxToolCalls: 1,
    chatStream: () => toolStream([
      { id: 'call-1', name: 'echo', args: { value: 'one' } },
      { id: 'call-2', name: 'echo', args: { value: 'two' } },
    ])(),
    executeTool: async () => {
      executed += 1;
      return {};
    },
  });

  assert.equal(result.stopReason, 'budget_exceeded');
  assert.equal(executed, 0);
});

test('Pi runtime uses one follow-up correction before returning execution_required', async () => {
  let requests = 0;
  const result = await runZFlowAgentBrain({
    messages: [{ role: 'user', content: 'execute' }],
    providerId: 'provider-1',
    model: 'test-model',
    tools,
    requireMutationTool: true,
    chatStream: () => {
      requests += 1;
      return textStream(requests === 1 ? 'I will do it.' : 'Still no tool.')();
    },
    executeTool: async () => ({}),
  });

  assert.equal(requests, 2);
  assert.equal(result.stopReason, 'execution_required');
});

test('Pi runtime treats malformed tool arguments as truncated and never executes them', async () => {
  let requests = 0;
  let executed = 0;
  const result = await runZFlowAgentBrain({
    messages: [{ role: 'user', content: 'echo' }],
    providerId: 'provider-1',
    model: 'test-model',
    tools,
    chatStream: () => {
      requests += 1;
      if (requests > 1) return textStream('recovered')();
      return (async function* stream() {
        yield { type: 'start', model: 'test-model' };
        yield { type: 'tool_call_start', toolCallId: 'call-1', index: 0, name: 'echo' };
        yield { type: 'tool_call_delta', toolCallId: 'call-1', index: 0, argumentsDelta: '{"value"' };
        yield { type: 'tool_call_end', toolCallId: 'call-1', index: 0, name: 'echo', arguments: '{"value"' };
        yield { type: 'done' };
      })();
    },
    executeTool: async () => {
      executed += 1;
      return {};
    },
  });

  assert.equal(result.content, 'recovered');
  assert.equal(executed, 0);
});

test('Pi runtime preserves interleaved content and reasoning chunks', async () => {
  const result = await runZFlowAgentBrain({
    messages: [{ role: 'user', content: 'stream' }],
    providerId: 'provider-1',
    model: 'test-model',
    chatStream: () => (async function* stream() {
      yield { type: 'start', model: 'test-model' };
      yield { type: 'delta', channel: 'content', content: 'A' };
      yield { type: 'delta', channel: 'reasoning', content: 'R' };
      yield { type: 'delta', channel: 'content', content: 'B' };
      yield { type: 'done' };
    })(),
    executeTool: async () => ({}),
  });

  assert.equal(result.content, 'AB');
  assert.equal(result.reasoningContent, 'R');
});

test('Pi runtime preserves provider errors for the route error protocol', async () => {
  const result = await runZFlowAgentBrain({
    messages: [{ role: 'user', content: 'fail' }],
    providerId: 'provider-1',
    model: 'test-model',
    chatStream: () => (async function* stream() {
      yield { type: 'start', model: 'test-model' };
      throw new Error('upstream unavailable');
    })(),
    executeTool: async () => ({}),
  });

  assert.equal(result.stopReason, 'error');
  assert.equal(result.errorMessage, 'upstream unavailable');
});

test('Pi runtime preserves aborts for timeout and cancellation mapping', async () => {
  const controller = new AbortController();
  controller.abort(new Error('cancelled'));
  const result = await runZFlowAgentBrain({
    messages: [{ role: 'user', content: 'cancel' }],
    providerId: 'provider-1',
    model: 'test-model',
    signal: controller.signal,
    chatStream: () => (async function* stream() {
      throw controller.signal.reason;
    })(),
    executeTool: async () => ({}),
  });

  assert.equal(result.stopReason, 'aborted');
  assert.equal(result.errorMessage, 'cancelled');
});

test('Pi runtime emits a failed public tool result when execution throws', async () => {
  let requests = 0;
  const toolResults = [];
  const result = await runZFlowAgentBrain({
    messages: [{ role: 'user', content: 'echo' }],
    providerId: 'provider-1',
    model: 'test-model',
    tools,
    chatStream: () => {
      requests += 1;
      return requests === 1
        ? toolStream([{ id: 'call-1', name: 'echo', args: { value: 'ok' } }])()
        : textStream('recovered')();
    },
    executeTool: async () => {
      throw new Error('tool exploded');
    },
    onToolResult: (event) => toolResults.push(event),
  });

  assert.equal(result.stopReason, 'completed');
  assert.equal(result.content, 'recovered');
  assert.equal(toolResults.length, 1);
  assert.equal(toolResults[0].isError, true);
  assert.deepEqual(toolResults[0].rawResult, { error: 'tool exploded' });
});

test('Pi runtime resumes a confirmed call with source-ordered batch results', async () => {
  const requestedMessages = [];
  const result = await runZFlowAgentBrain({
    messages: [{ role: 'user', content: 'unused continuation prompt' }],
    providerId: 'provider-1',
    model: 'test-model',
    tools,
    chatStream: (request) => {
      requestedMessages.push(request.messages);
      return textStream('continued')();
    },
    executeTool: async () => {
      throw new Error('confirmed tool must not execute twice');
    },
    continuation: {
      transcript: [
        { role: 'user', content: [{ type: 'text', text: 'run' }], timestamp: 1 },
        {
          role: 'assistant',
          content: [
            { type: 'toolCall', id: 'call-1', name: 'echo', arguments: { value: 'one' } },
            { type: 'toolCall', id: 'call-2', name: 'echo', arguments: { value: 'two' } },
          ],
          api: 'zflow-provider-bridge',
          provider: 'provider-1',
          model: 'test-model',
          usage: {},
          stopReason: 'toolUse',
          timestamp: 2,
        },
        { role: 'toolResult', toolCallId: 'call-1', toolName: 'echo', content: [], timestamp: 3 },
      ],
      pendingCall: {
        id: 'call-1',
        name: 'echo',
        args: { value: 'one' },
        batch: [
          { id: 'call-1', name: 'echo', args: { value: 'one' } },
          { id: 'call-2', name: 'echo', args: { value: 'two' } },
        ],
      },
      toolResult: { modelResult: { value: 'one' }, publicResult: { value: 'one' } },
      budgets: { turnsUsed: 1, toolCallsUsed: 2, mutationToolCallsUsed: 2 },
    },
  });

  assert.equal(result.content, 'continued');
  const toolMessages = requestedMessages[0].filter((message) => message.role === 'tool');
  assert.deepEqual(toolMessages.map((message) => message.tool_call_id), ['call-1', 'call-2']);
  assert.match(toolMessages[1].content, /skipped/);
});

test('Pi runtime pauses the whole assistant tool batch before a confirmation mutation', async () => {
  let executed = 0;
  const toolStarts = [];
  const toolResults = [];
  const result = await runZFlowAgentBrain({
    messages: [{ role: 'user', content: 'inspect then mutate' }],
    providerId: 'provider-1',
    model: 'test-model',
    tools: [
      { ...tools[0], name: 'inspect', readOnly: true },
      { ...tools[0], name: 'mutate', requiresConfirmation: true, confirmationMessage: 'confirm mutate' },
    ],
    chatStream: () => toolStream([
      { id: 'call-1', name: 'inspect', args: { value: 'one' } },
      { id: 'call-2', name: 'mutate', args: { value: 'two' } },
    ])(),
    executeTool: async () => {
      executed += 1;
      return {};
    },
    onToolStart: (event) => toolStarts.push(event),
    onToolResult: (event) => toolResults.push(event),
  });

  assert.equal(result.stopReason, 'confirmation_required');
  assert.equal(executed, 0);
  assert.equal(result.confirmation?.toolCallId, 'call-2');
  assert.equal(result.confirmation?.message, 'confirm mutate');
  assert.deepEqual(result.confirmation?.batch, [
    { id: 'call-1', name: 'inspect', args: { value: 'one' } },
    { id: 'call-2', name: 'mutate', args: { value: 'two' } },
  ]);
  assert.deepEqual(toolStarts, []);
  assert.deepEqual(toolResults, []);
});

test('Pi runtime rejects a whole mixed batch before confirmation when a later call fails schema validation', async () => {
  let executed = 0;
  const toolResults = [];
  const result = await runZFlowAgentBrain({
    messages: [{ role: 'user', content: 'inspect then mutate' }],
    providerId: 'provider-1',
    model: 'test-model',
    tools: [
      { ...tools[0], name: 'inspect', readOnly: true },
      { ...tools[0], name: 'mutate', requiresConfirmation: true },
    ],
    chatStream: () => toolStream([
      { id: 'call-1', name: 'inspect', args: { value: 'one' } },
      { id: 'call-2', name: 'mutate', args: { value: 123 } },
    ])(),
    executeTool: async () => {
      executed += 1;
      return {};
    },
    onToolResult: (event) => toolResults.push(event),
  });

  assert.equal(result.stopReason, 'error');
  assert.match(result.errorMessage, /arguments\.value must be string/);
  assert.equal(result.confirmation, undefined);
  assert.equal(executed, 0);
  assert.ok(toolResults.every((event) => event.isError === true));
});
