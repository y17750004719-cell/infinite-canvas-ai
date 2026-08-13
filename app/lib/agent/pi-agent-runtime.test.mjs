import assert from 'node:assert/strict';
import test from 'node:test';
import { convertPiMessagesToChatMessages, runZFlowAgentBrain } from './pi-agent-runtime.mjs';

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

function commentaryToolStream(commentary, call) {
  return async function* stream() {
    yield { type: 'start', model: 'test-model' };
    yield { type: 'delta', channel: 'content', content: commentary };
    const args = JSON.stringify(call.args);
    yield { type: 'tool_call_start', toolCallId: call.id, index: 0, name: call.name };
    yield { type: 'tool_call_delta', toolCallId: call.id, index: 0, argumentsDelta: args };
    yield { type: 'tool_call_end', toolCallId: call.id, index: 0, name: call.name, arguments: args };
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

test('Pi runtime terminates on an explicit handoff without charging the query budget', async () => {
  const result = await runZFlowAgentBrain({
    messages: [{ role: 'user', content: 'finish' }],
    providerId: 'provider-1',
    model: 'test-model',
    tools: [{
      name: 'handoff_to_image_planner',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      readOnly: true,
      terminal: true,
      countAgainstToolBudget: false,
    }],
    maxToolCalls: 0,
    chatStream: () => toolStream([{ id: 'handoff-1', name: 'handoff_to_image_planner', args: {} }])(),
    executeTool: async () => ({ terminate: true, type: 'planner_handoff' }),
  });
  assert.equal(result.stopReason, 'completed');
  assert.equal(result.toolCalls, 1);
  assert.equal(result.budgetedToolCalls, 0);
  assert.equal(result.terminal.type, 'planner_handoff');
});

test('Pi runtime forwards an explicitly required terminal tool choice', async () => {
  const requiredToolChoice = { type: 'function', function: { name: 'resolve_failed_task_recovery' } };
  const result = await runZFlowAgentBrain({
    messages: [{ role: 'user', content: 'continue' }],
    providerId: 'provider-1',
    model: 'test-model',
    tools: [{
      name: 'resolve_failed_task_recovery',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      readOnly: true,
      terminal: true,
      countAgainstToolBudget: false,
    }],
    toolChoice: requiredToolChoice,
    maxTurns: 1,
    maxToolCalls: 0,
    chatStream: (request) => {
      assert.deepEqual(request.toolChoice, requiredToolChoice);
      return toolStream([{ id: 'recovery-1', name: 'resolve_failed_task_recovery', args: {} }])();
    },
    executeTool: async () => ({ terminate: true, type: 'recovery_resolution' }),
  });

  assert.equal(result.stopReason, 'completed');
  assert.equal(result.terminal.type, 'recovery_resolution');
});

test('Pi runtime allows a terminal control on the final allowed model turn', async () => {
  let executed = 0;
  const result = await runZFlowAgentBrain({
    messages: [{ role: 'user', content: 'select context' }],
    providerId: 'provider-1',
    model: 'test-model',
    tools: [{
      name: 'request_context_selection',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      readOnly: true,
      terminal: true,
      countAgainstToolBudget: false,
    }],
    maxTurns: 1,
    maxToolCalls: 0,
    chatStream: () => toolStream([{ id: 'selection-1', name: 'request_context_selection', args: {} }])(),
    executeTool: async () => {
      executed += 1;
      return { terminate: true, type: 'context_selection' };
    },
  });

  assert.equal(executed, 1);
  assert.equal(result.stopReason, 'completed');
  assert.equal(result.terminal.type, 'context_selection');
});

test('Pi runtime naturally completes on ordinary text and emits no reasoning event', async () => {
  const events = [];
  const result = await runZFlowAgentBrain({
    messages: [{ role: 'user', content: 'hello' }],
    providerId: 'provider-1',
    model: 'test-model',
    tools,
    chatStream: () => textStream('hello back')(),
    executeTool: async () => null,
    onEvent: (event) => events.push(event),
  });
  assert.equal(result.stopReason, 'completed');
  assert.equal(result.content, 'hello back');
  assert.ok(events.some((event) => event.type === 'message_update' && event.assistantMessageEvent.type === 'text_delta'));
  assert.ok(events.some((event) => event.type === 'turn_end'));
  assert.equal(events.some((event) => event.assistantMessageEvent?.type?.startsWith('thinking')), false);
});

test('Pi runtime preserves commentary, tool, and next-turn final event order', async () => {
  let requestCount = 0;
  const events = [];
  const result = await runZFlowAgentBrain({
    messages: [{ role: 'user', content: 'inspect' }],
    providerId: 'provider-1',
    model: 'test-model',
    tools: tools.map((tool) => ({ ...tool, readOnly: true })),
    chatStream: () => {
      requestCount += 1;
      return requestCount === 1
        ? commentaryToolStream('先读取上下文。', { id: 'read-1', name: 'echo', args: { value: 'context' } })()
        : textStream('读取完成。')();
    },
    executeTool: async (_name, args) => ({ modelResult: args, publicResult: { loaded: true } }),
    onEvent: (event) => events.push(event),
  });
  const visibleOrder = events.flatMap((event) => {
    if (event.type === 'message_update' && event.assistantMessageEvent.type === 'text_delta') {
      return [`text:${event.assistantMessageEvent.delta}`];
    }
    if (event.type === 'tool_execution_start') return ['tool:start'];
    if (event.type === 'tool_execution_end') return ['tool:end'];
    if (event.type === 'turn_end') return ['turn:end'];
    return [];
  });
  assert.equal(result.content, '读取完成。');
  assert.deepEqual(visibleOrder, [
    'text:先读取上下文。',
    'tool:start',
    'tool:end',
    'turn:end',
    'text:读取完成。',
    'turn:end',
  ]);
});

test('Pi provider bridge attaches validated visual tool results to the next model input', () => {
  const converted = convertPiMessagesToChatMessages([{
    role: 'toolResult',
    toolCallId: 'visual-1',
    toolName: 'load_visual_reference',
    content: [{ type: 'text', text: '{"loaded":true}' }],
    details: { visualReferences: [{ id: 'history-image:1', label: '海报 1', src: 'https://example.test/poster.png' }] },
  }]);
  assert.equal(converted[0].role, 'tool');
  assert.equal(converted[1].role, 'user');
  assert.equal(converted[1].content[1].image_url.url, 'https://example.test/poster.png');
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

test('Pi runtime fails closed on a truncated tool call without retrying it', async () => {
  let requests = 0;
  let executed = 0;
  const result = await runZFlowAgentBrain({
    messages: [{ role: 'user', content: 'echo' }],
    providerId: 'provider-1',
    model: 'test-model',
    tools,
    chatStream: () => {
      requests += 1;
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

  assert.equal(requests, 1);
  assert.equal(result.stopReason, 'error');
  assert.match(result.errorMessage, /incomplete tool call/);
  assert.equal(executed, 0);
});

test('Pi runtime enforces maxTurns on repeated tool calls', async () => {
  let requests = 0;
  let executed = 0;
  const result = await runZFlowAgentBrain({
    messages: [{ role: 'user', content: 'echo' }],
    providerId: 'provider-1',
    model: 'test-model',
    tools,
    maxTurns: 3,
    chatStream: () => {
      requests += 1;
      return toolStream([{ id: `call-${requests}`, name: 'echo', args: { value: `turn-${requests}` } }])();
    },
    executeTool: async () => {
      executed += 1;
      return {};
    },
  });

  assert.equal(requests, 3);
  assert.equal(executed, 2);
  assert.equal(result.stopReason, 'budget_exceeded');
});

test('Pi runtime reserves a final text turn after the query budget is consumed', async () => {
  let requests = 0;
  const exposedTools = [];
  const result = await runZFlowAgentBrain({
    messages: [{ role: 'user', content: 'inspect then answer' }],
    providerId: 'provider-1',
    model: 'test-model',
    tools: [
      { ...tools[0], readOnly: true },
      {
        name: 'handoff_to_image_planner',
        parameters: { type: 'object', properties: {}, additionalProperties: false },
        readOnly: true,
        terminal: true,
        countAgainstToolBudget: false,
      },
    ],
    maxTurns: 12,
    maxToolCalls: 1,
    reserveClosingTurn: true,
    chatStream: (request) => {
      requests += 1;
      exposedTools.push(request.tools.map((tool) => tool.function.name));
      return requests === 1
        ? toolStream([{ id: 'read-1', name: 'echo', args: { value: 'context' } }])()
        : textStream('final answer')();
    },
    executeTool: async (_name, args) => ({ modelResult: args, publicResult: args }),
  });
  assert.equal(result.stopReason, 'completed');
  assert.equal(result.content, 'final answer');
  assert.equal(result.turns, 2);
  assert.equal(result.budgetedToolCalls, 1);
  assert.deepEqual(exposedTools, [
    ['echo', 'handoff_to_image_planner'],
    ['handoff_to_image_planner'],
  ]);
});

test('Pi runtime reserves the last model turn when query tools are still active', async () => {
  let requests = 0;
  let executed = 0;
  const result = await runZFlowAgentBrain({
    messages: [{ role: 'user', content: 'keep inspecting' }],
    providerId: 'provider-1',
    model: 'test-model',
    tools: [
      { ...tools[0], readOnly: true },
      {
        name: 'handoff_to_image_planner',
        parameters: { type: 'object', properties: {}, additionalProperties: false },
        readOnly: true,
        terminal: true,
        countAgainstToolBudget: false,
      },
    ],
    maxTurns: 3,
    maxToolCalls: 10,
    reserveClosingTurn: true,
    chatStream: (request) => {
      requests += 1;
      if (requests === 3) {
        assert.deepEqual(request.tools.map((tool) => tool.function.name), ['handoff_to_image_planner']);
        return textStream('wrapped up')();
      }
      return toolStream([{ id: `read-${requests}`, name: 'echo', args: { value: `context-${requests}` } }])();
    },
    executeTool: async (_name, args) => {
      executed += 1;
      return { modelResult: args, publicResult: args };
    },
  });
  assert.equal(result.stopReason, 'completed');
  assert.equal(result.content, 'wrapped up');
  assert.equal(requests, 3);
  assert.equal(executed, 2);
});

test('Pi runtime fails closed when the closing turn calls a hidden query tool', async () => {
  let requests = 0;
  let executed = 0;
  const result = await runZFlowAgentBrain({
    messages: [{ role: 'user', content: 'keep inspecting' }],
    providerId: 'provider-1',
    model: 'test-model',
    tools: [
      { ...tools[0], readOnly: true },
      {
        name: 'handoff_to_image_planner',
        parameters: { type: 'object', properties: {}, additionalProperties: false },
        readOnly: true,
        terminal: true,
        countAgainstToolBudget: false,
      },
    ],
    maxTurns: 3,
    maxToolCalls: 10,
    reserveClosingTurn: true,
    chatStream: () => {
      requests += 1;
      return toolStream([{ id: `read-${requests}`, name: 'echo', args: { value: `context-${requests}` } }])();
    },
    executeTool: async (_name, args) => {
      executed += 1;
      return { modelResult: args, publicResult: args };
    },
  });
  assert.equal(result.stopReason, 'error');
  assert.match(result.errorMessage, /Closing turn cannot call echo/);
  assert.equal(requests, 3);
  assert.equal(executed, 2);
});

test('Pi runtime allows a non-budgeted terminal control during the closing turn', async () => {
  let requests = 0;
  const result = await runZFlowAgentBrain({
    messages: [{ role: 'user', content: 'inspect then hand off' }],
    providerId: 'provider-1',
    model: 'test-model',
    tools: [
      { ...tools[0], readOnly: true },
      {
        name: 'handoff_to_image_planner',
        parameters: { type: 'object', properties: {}, additionalProperties: false },
        readOnly: true,
        terminal: true,
        countAgainstToolBudget: false,
      },
    ],
    maxTurns: 12,
    maxToolCalls: 1,
    reserveClosingTurn: true,
    chatStream: () => {
      requests += 1;
      return requests === 1
        ? toolStream([{ id: 'read-1', name: 'echo', args: { value: 'context' } }])()
        : toolStream([{ id: 'handoff-1', name: 'handoff_to_image_planner', args: {} }])();
    },
    executeTool: async (name, args) => name === 'handoff_to_image_planner'
      ? { terminate: true, type: 'planner_handoff' }
      : { modelResult: args, publicResult: args },
  });
  assert.equal(result.stopReason, 'completed');
  assert.equal(result.terminal.type, 'planner_handoff');
  assert.equal(result.budgetedToolCalls, 1);
  assert.equal(requests, 2);
});

test('Pi runtime does not add a closing request after a terminal penultimate turn', async () => {
  let requests = 0;
  const result = await runZFlowAgentBrain({
    messages: [{ role: 'user', content: 'hand off now' }],
    providerId: 'provider-1',
    model: 'test-model',
    tools: [{
      name: 'handoff_to_image_planner',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      readOnly: true,
      terminal: true,
      countAgainstToolBudget: false,
    }],
    maxTurns: 2,
    maxToolCalls: 12,
    reserveClosingTurn: true,
    chatStream: () => {
      requests += 1;
      return toolStream([{ id: 'handoff-1', name: 'handoff_to_image_planner', args: {} }])();
    },
    executeTool: async () => ({ terminate: true, type: 'planner_handoff' }),
  });
  assert.equal(result.stopReason, 'completed');
  assert.equal(result.terminal.type, 'planner_handoff');
  assert.equal(requests, 1);
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
