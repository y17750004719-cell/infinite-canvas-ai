import assert from 'node:assert/strict';
import test from 'node:test';
import {
  runAgentLoop,
  runAgentLoopContinue,
} from '@earendil-works/pi-agent-core';

const usage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

const model = {
  id: 'contract-test-model',
  name: 'Contract Test Model',
  api: 'zflow-contract',
  provider: 'contract-test',
  baseUrl: '',
  reasoning: false,
  input: ['text'],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 4096,
  maxTokens: 1024,
};

function assistantMessage(content, stopReason = 'stop') {
  return {
    role: 'assistant',
    content,
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage,
    stopReason,
    timestamp: Date.now(),
  };
}

function streamFor(message) {
  return {
    async *[Symbol.asyncIterator]() {
      yield { type: 'start', partial: message };
      if (message.content.some((part) => part.type === 'text')) {
        const text = message.content.find((part) => part.type === 'text')?.text || '';
        yield {
          type: 'text_start',
          contentIndex: 0,
          partial: message,
        };
        if (text) {
          yield {
            type: 'text_delta',
            contentIndex: 0,
            delta: text,
            partial: message,
          };
        }
        yield {
          type: 'text_end',
          contentIndex: 0,
          content: text,
          partial: message,
        };
      }
      yield {
        type: 'done',
        reason: message.stopReason,
        message,
      };
    },
    async result() {
      return message;
    },
  };
}

function createContractTool(executed) {
  return {
    name: 'echo',
    label: 'Echo',
    description: 'Echo a string.',
    parameters: {
      type: 'object',
      properties: { value: { type: 'string' } },
      required: ['value'],
      additionalProperties: false,
    },
    executionMode: 'sequential',
    async execute(toolCallId, args) {
      executed.push({ toolCallId, args });
      return {
        content: [{ type: 'text', text: args.value }],
        details: { value: args.value },
      };
    },
  };
}

test('pi-agent-core exposes the low-level loop and accepts a local streamFn contract', async () => {
  let calls = 0;
  const executed = [];
  const streamFn = (_model, context) => {
    calls += 1;
    const hasToolResult = context.messages.some((message) => message.role === 'toolResult');
    return streamFor(
      hasToolResult
        ? assistantMessage([{ type: 'text', text: 'done' }])
        : assistantMessage([
            { type: 'toolCall', id: 'call-1', name: 'echo', arguments: { value: 'ok' } },
          ], 'toolUse'),
    );
  };

  const events = [];
  const messages = await runAgentLoop(
    [{ role: 'user', content: 'run echo', timestamp: Date.now() }],
    { systemPrompt: 'contract test', messages: [], tools: [createContractTool(executed)] },
    {
      model,
      convertToLlm: (items) => items,
      toolExecution: 'sequential',
    },
    (event) => events.push(event),
    undefined,
    streamFn,
  );

  assert.equal(calls, 2);
  assert.deepEqual(executed, [{ toolCallId: 'call-1', args: { value: 'ok' } }]);
  assert.deepEqual(messages.map((message) => message.role), ['user', 'assistant', 'toolResult', 'assistant']);
  assert.equal(events.at(-1)?.type, 'agent_end');
});

test('runAgentLoopContinue resumes from a tool result without adding a prompt', async () => {
  const executed = [];
  const context = {
    systemPrompt: 'contract test',
    messages: [
      { role: 'user', content: 'run echo', timestamp: Date.now() },
      assistantMessage([
        { type: 'toolCall', id: 'call-1', name: 'echo', arguments: { value: 'ok' } },
      ], 'toolUse'),
      {
        role: 'toolResult',
        toolCallId: 'call-1',
        toolName: 'echo',
        content: [{ type: 'text', text: 'ok' }],
        details: { value: 'ok' },
        isError: false,
        timestamp: Date.now(),
      },
    ],
    tools: [createContractTool(executed)],
  };
  const streamFn = () => streamFor(assistantMessage([{ type: 'text', text: 'continued' }]));
  const messages = await runAgentLoopContinue(
    context,
    { model, convertToLlm: (items) => items, toolExecution: 'sequential' },
    () => {},
    undefined,
    streamFn,
  );

  assert.deepEqual(executed, []);
  assert.deepEqual(messages.map((message) => message.role), ['assistant']);
  assert.equal(messages[0].content[0].text, 'continued');
});
