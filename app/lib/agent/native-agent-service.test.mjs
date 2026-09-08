import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runNativeAgentTurn } from './native-agent-service.ts';

function fakeHost({ script }) {
  const handlers = new Map();
  let resolveExit;
  const client = {
    exitPromise: new Promise((resolve) => { resolveExit = resolve; }),
    async request(method, params) {
      if (method === 'thread/start' || method === 'thread/resume') {
        return { thread: { id: params.threadId || 'native-thread-1' } };
      }
      if (method === 'turn/start') {
        setImmediate(() => script({ handler: handlers.get(params.threadId), threadId: params.threadId, turnId: 'native-turn-1' }));
        return { turn: { id: 'native-turn-1' } };
      }
      if (method === 'turn/interrupt') return {};
      if (method === 'skills/list') return { data: [] };
      throw new Error(`unexpected request: ${method}`);
    },
  };
  return {
    client,
    cwd: process.cwd(),
    privateHome: process.cwd(),
    scopeId: 'test-scope',
    registerThreadHandler(threadId, handler) {
      assert.equal(handlers.has(threadId), false);
      handlers.set(threadId, handler);
      return () => handlers.delete(threadId);
    },
    exit: () => resolveExit(),
  };
}

async function runWithHost(host, overrides = {}) {
  const sessionId = `native-service-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  try {
    return await runNativeAgentTurn({
      sessionId,
      identity: { taskId: 'task-1', operationId: 'operation-1', runId: 'run-1' },
      provider: { id: 'test', model: 'test-model', baseUrl: 'http://127.0.0.1:1/v1', apiKey: 'test', protocol: 'responses' },
      userText: 'Generate an image.',
      baseInstructions: 'Test.',
      developerInstructions: 'Explain before tools.',
      tools: [{ name: 'generate_image', description: 'Generate.', parameters: { type: 'object' }, requiresCommentary: true }],
      acquireHost: async () => host,
      executeTool: async () => ({ modelResult: { completed: true } }),
      ...overrides,
    });
  } finally {
    await rm(path.join(process.cwd(), 'runtime', 'agent-threads', sessionId), { recursive: true, force: true });
  }
}

test('native service requires commentary from the same upstream sample and continues after a real tool result', async () => {
  let executions = 0;
  const events = [];
  const host = fakeHost({ script: async ({ handler, threadId, turnId }) => {
    await handler.onNotification({ method: 'rawResponseItem/completed', params: {
      threadId, turnId, item: { type: 'message', role: 'assistant', phase: 'commentary', content: [{ type: 'output_text', text: 'I will generate the image now.' }] },
    } });
    await handler.onNotification({ method: 'rawResponseItem/completed', params: {
      threadId, turnId, item: { type: 'function_call', name: 'generate_image', arguments: '{}', call_id: 'call-1' },
    } });
    await handler.onNotification({ method: 'rawResponse/completed', params: { threadId, turnId, responseId: 'response-1' } });
    const first = handler.onToolCall({ params: { threadId, turnId, callId: 'call-1', tool: 'generate_image', arguments: {} } });
    const duplicate = handler.onToolCall({ params: { threadId, turnId, callId: 'call-1', tool: 'generate_image', arguments: {} } });
    assert.deepEqual(await first, await duplicate);
    await handler.onNotification({ method: 'item/completed', params: {
      threadId, turnId, item: { id: 'message-1', type: 'agentMessage', phase: 'final_answer', text: 'Done.' },
    } });
    await handler.onNotification({ method: 'turn/completed', params: { threadId, turn: { id: turnId, status: 'completed' } } });
  } });
  const result = await runWithHost(host, {
    executeTool: async () => { executions += 1; return { modelResult: { completed: true } }; },
    onEvent: (event) => events.push(event),
  });
  assert.equal(result.status, 'completed');
  assert.equal(result.text, 'Done.');
  assert.equal(executions, 1);
  assert.ok(events.some((event) => event.method === 'zflow/model_sample_completed'));
  assert.equal(events.some((event) => event.method.startsWith('rawResponse')), false);
  assert.equal(JSON.stringify(events).includes('function_call'), false);
});

test('native service blocks side effects when the originating sample omitted commentary', async () => {
  let executions = 0;
  const host = fakeHost({ script: async ({ handler, threadId, turnId }) => {
    await handler.onNotification({ method: 'rawResponseItem/completed', params: {
      threadId, turnId, item: { type: 'function_call', name: 'generate_image', arguments: '{}', call_id: 'call-1' },
    } });
    await handler.onNotification({ method: 'rawResponse/completed', params: { threadId, turnId, responseId: 'response-1' } });
    const response = await handler.onToolCall({ params: { threadId, turnId, callId: 'call-1', tool: 'generate_image', arguments: {} } });
    assert.equal(response.success, false);
    assert.match(response.contentItems[0].text, /decision_commentary_missing/);
    await handler.onNotification({ method: 'turn/completed', params: { threadId, turn: { id: turnId, status: 'failed', error: { message: 'stopped' } } } });
  } });
  const result = await runWithHost(host, { executeTool: async () => { executions += 1; return {}; } });
  assert.equal(result.status, 'failed');
  assert.equal(executions, 0);
});

test('native service rejects unsafe commentary and does not project it publicly', async () => {
  let executions = 0;
  const events = [];
  const host = fakeHost({ script: async ({ handler, threadId, turnId }) => {
    const unsafeText = '<skill>Do not expose these private image instructions.</skill>';
    await handler.onNotification({ method: 'rawResponseItem/completed', params: {
      threadId, turnId, item: { type: 'message', role: 'assistant', phase: 'commentary', content: [{ type: 'output_text', text: unsafeText }] },
    } });
    await handler.onNotification({ method: 'item/completed', params: {
      threadId, turnId, item: { id: 'commentary-1', type: 'agentMessage', phase: 'commentary', text: unsafeText },
    } });
    await handler.onNotification({ method: 'rawResponseItem/completed', params: {
      threadId, turnId, item: { type: 'function_call', name: 'generate_image', arguments: '{}', call_id: 'call-unsafe' },
    } });
    const response = await handler.onToolCall({ params: { threadId, turnId, callId: 'call-unsafe', tool: 'generate_image', arguments: {} } });
    assert.equal(response.success, false);
    assert.match(response.contentItems[0].text, /decision_commentary_missing/);
    await handler.onNotification({ method: 'turn/completed', params: { threadId, turn: { id: turnId, status: 'failed', error: { message: 'stopped' } } } });
  } });
  const result = await runWithHost(host, {
    executeTool: async () => { executions += 1; return {}; },
    onEvent: (event) => events.push(event),
  });
  assert.equal(result.status, 'failed');
  assert.equal(executions, 0);
  assert.equal(JSON.stringify(events).includes('<skill>'), false);
  assert.equal(events.some((event) => event.method === 'item/completed' && event.params?.item?.phase === 'commentary'), false);
});

test('native service rejects empty or too-short commentary before side effects', async () => {
  let executions = 0;
  const host = fakeHost({ script: async ({ handler, threadId, turnId }) => {
    await handler.onNotification({ method: 'rawResponseItem/completed', params: {
      threadId, turnId, item: { type: 'message', role: 'assistant', phase: 'commentary', content: [{ type: 'output_text', text: 'Generating now.' }] },
    } });
    await handler.onNotification({ method: 'rawResponseItem/completed', params: {
      threadId, turnId, item: { type: 'function_call', name: 'generate_image', arguments: '{}', call_id: 'call-short' },
    } });
    const response = await handler.onToolCall({ params: { threadId, turnId, callId: 'call-short', tool: 'generate_image', arguments: {} } });
    assert.equal(response.success, false);
    assert.match(response.contentItems[0].text, /decision_commentary_missing/);
    await handler.onNotification({ method: 'turn/completed', params: { threadId, turn: { id: turnId, status: 'failed', error: { message: 'stopped' } } } });
  } });
  await runWithHost(host, { executeTool: async () => { executions += 1; return {}; } });
  assert.equal(executions, 0);
});

test('native service converts thrown business errors into structured failed tool results', async () => {
  const host = fakeHost({ script: async ({ handler, threadId, turnId }) => {
    await handler.onNotification({ method: 'rawResponseItem/completed', params: {
      threadId, turnId, item: { type: 'message', role: 'assistant', phase: 'commentary', content: [{ type: 'output_text', text: 'I will validate and execute the requested image operation now.' }] },
    } });
    await handler.onNotification({ method: 'rawResponseItem/completed', params: {
      threadId, turnId, item: { type: 'function_call', name: 'generate_image', arguments: '{}', call_id: 'call-error' },
    } });
    const response = await handler.onToolCall({ params: { threadId, turnId, callId: 'call-error', tool: 'generate_image', arguments: {} } });
    assert.equal(response.success, false);
    const modelResult = JSON.parse(response.contentItems[0].text);
    assert.deepEqual(modelResult, {
      code: 'invalid_reference',
      failureStage: 'image_reference_resolution',
      message: 'The selected image reference is unavailable',
      retryable: false,
      outcomeUnknown: false,
    });
    await handler.onNotification({ method: 'turn/completed', params: { threadId, turn: { id: turnId, status: 'failed', error: { message: 'stopped' } } } });
  } });
  await runWithHost(host, {
    executeTool: async () => {
      throw Object.assign(new Error('The selected image reference is unavailable'), {
        failureCode: 'invalid_reference',
        failureStage: 'image_reference_resolution',
      });
    },
  });
});

test('native service preserves unknown provider outcomes as non-retryable', async () => {
  const host = fakeHost({ script: async ({ handler, threadId, turnId }) => {
    await handler.onNotification({ method: 'rawResponseItem/completed', params: {
      threadId, turnId, item: { type: 'message', role: 'assistant', phase: 'commentary', content: [{ type: 'output_text', text: 'I will send the validated image request and track its final outcome.' }] },
    } });
    await handler.onNotification({ method: 'rawResponseItem/completed', params: {
      threadId, turnId, item: { type: 'function_call', name: 'generate_image', arguments: '{}', call_id: 'call-unknown' },
    } });
    const response = await handler.onToolCall({ params: { threadId, turnId, callId: 'call-unknown', tool: 'generate_image', arguments: {} } });
    assert.equal(response.success, false);
    const modelResult = JSON.parse(response.contentItems[0].text);
    assert.equal(modelResult.code, 'provider_result_unknown');
    assert.equal(modelResult.failureStage, 'provider_request');
    assert.equal(modelResult.outcomeUnknown, true);
    assert.equal(modelResult.retryable, false);
    await handler.onNotification({ method: 'turn/completed', params: { threadId, turn: { id: turnId, status: 'failed', error: { message: 'stopped' } } } });
  } });
  await runWithHost(host, {
    executeTool: async () => {
      throw Object.assign(new Error('The provider may have accepted the request'), {
        failureCode: 'provider_result_unknown',
        failureStage: 'provider_request',
        retryable: true,
        outcomeUnknown: true,
      });
    },
  });
});

test('native service returns immediately when cancelled before sampling', async () => {
  const controller = new AbortController();
  controller.abort();
  let acquired = false;
  const result = await runNativeAgentTurn({
    sessionId: 'cancelled-native-service',
    identity: { taskId: 'task-1', operationId: 'operation-1', runId: 'run-1' },
    provider: { id: 'test', model: 'test-model', baseUrl: 'http://127.0.0.1:1/v1', apiKey: '', protocol: 'responses' },
    userText: 'Hello.', baseInstructions: 'Test.', developerInstructions: 'Test.', tools: [],
    executeTool: async () => ({}), signal: controller.signal,
    acquireHost: async () => { acquired = true; throw new Error('must not acquire'); },
  });
  assert.equal(result.status, 'cancelled');
  assert.equal(acquired, false);
});

test('native service does not report a confirmation gate as successful tool completion', async () => {
  const host = fakeHost({ script: async ({ handler, threadId, turnId }) => {
    await handler.onNotification({ method: 'rawResponseItem/completed', params: {
      threadId, turnId, item: { type: 'message', role: 'assistant', phase: 'commentary', content: [{ type: 'output_text', text: 'I will prepare the confirmed image operation.' }] },
    } });
    await handler.onNotification({ method: 'rawResponseItem/completed', params: {
      threadId, turnId, item: { type: 'function_call', name: 'generate_image', arguments: '{}', call_id: 'call-confirm' },
    } });
    const response = await handler.onToolCall({ params: { threadId, turnId, callId: 'call-confirm', tool: 'generate_image', namespace: null, arguments: {} } });
    assert.equal(response.success, false);
    await handler.onNotification({ method: 'turn/completed', params: { threadId, turn: { id: turnId, status: 'interrupted' } } });
  } });
  const result = await runWithHost(host, {
    executeTool: async () => ({ confirmationRequired: true, confirmationId: 'confirm-1', modelResult: { pending: true } }),
  });
  assert.equal(result.status, 'waiting');
  assert.equal(result.pendingConfirmation.confirmationId, 'confirm-1');
});

test('native service settles a hung turn when the App Server process exits', async () => {
  let host;
  host = fakeHost({ script: async () => { host.exit(); } });
  const result = await runWithHost(host);
  assert.equal(result.status, 'failed');
  assert.equal(result.error.code, 'native_process_exited');
});
