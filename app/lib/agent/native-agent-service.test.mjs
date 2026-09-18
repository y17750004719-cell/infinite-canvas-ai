import test from 'node:test';
import assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';
import path from 'node:path';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { runNativeAgentTurn, normalizeNativeToolCall, markNativeContextForRotation } from './native-agent-service.ts';
import { loadThread, updateThreadState } from './thread-journal.mjs';

test('normalizes provider function/custom tool calls to item/tool/call', () => {
  const result = normalizeNativeToolCall({
    threadId: 'thread-1', turnId: 'turn-1',
    item: { type: 'custom_tool_call', call_id: 'call-1', name: 'generate_image', arguments: '{"prompt":"x"}' },
  });
  assert.deepEqual(result, {
    ok: true, protocol: 'item/tool/call', threadId: 'thread-1', turnId: 'turn-1',
    callId: 'call-1', tool: 'generate_image', arguments: { prompt: 'x' },
  });
});

test('rejects code-mode tools before they reach the Native host', () => {
  const result = normalizeNativeToolCall({
    threadId: 'thread-1', turnId: 'turn-1', callId: 'call-1', tool: 'exec', arguments: {},
  });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'tool_not_allowed');
  assert.equal(result.error.retryable, false);
  const hostResult = normalizeNativeToolCall({
    threadId: 'thread-1', turnId: 'turn-1', callId: 'call-2', tool: 'code_mode_host', arguments: {},
  });
  assert.equal(hostResult.ok, false);
  assert.equal(hostResult.error.code, 'native_tool_host_disabled');
});

test('rejects malformed provider tool arguments without retry', () => {
  const result = normalizeNativeToolCall({
    threadId: 'thread-1', turnId: 'turn-1', callId: 'call-1', tool: 'generate_image', arguments: '{bad',
  });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'provider_tool_protocol_invalid');
  assert.equal(result.error.retryable, false);
});

function fakeHost({ script }) {
  const handlers = new Map();
  const requests = [];
  let threadSequence = 0;
  let resolveExit;
  const client = {
    exitPromise: new Promise((resolve) => { resolveExit = resolve; }),
    async request(method, params) {
      requests.push({ method, params });
      if (method === 'thread/start' || method === 'thread/resume') {
        if (method === 'thread/start') threadSequence += 1;
        return { thread: { id: params.threadId || `native-thread-${threadSequence}` } };
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
    requests,
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

test('native service correlates canonical commentary with a generate_image call', async () => {
  let executions = 0;
  const events = [];
  const host = fakeHost({ script: async ({ handler, threadId, turnId }) => {
    await handler.onNotification({ method: 'item/started', params: {
      threadId, turnId, item: { id: 'commentary-1', type: 'agentMessage', phase: 'commentary', text: 'I will submit the validated image request now.' },
    } });
    await handler.onNotification({ method: 'item/completed', params: {
      threadId, turnId, item: { id: 'call-canonical', type: 'dynamicToolCall', tool: 'generate_image', status: 'in_progress' },
    } });
    const response = await handler.onToolCall({ params: { threadId, turnId, callId: 'call-canonical', tool: 'generate_image', arguments: {} } });
    assert.equal(response.success, true);
    await handler.onNotification({ method: 'turn/completed', params: { threadId, turn: { id: turnId, status: 'completed' } } });
  } });
  const result = await runWithHost(host, {
    executeTool: async () => { executions += 1; return { modelResult: { completed: true } }; },
    onEvent: (event) => events.push(event),
  });
  assert.equal(result.status, 'completed');
  assert.equal(executions, 1);
  assert.equal(events.some((event) => event.method === 'zflow/tool/progress' && event.params?.commentaryFallbackUsed === true), false);
});

test('native service uses a server commentary fallback for generate_image without commentary', async () => {
  let executions = 0;
  const events = [];
  const host = fakeHost({ script: async ({ handler, threadId, turnId }) => {
    await handler.onNotification({ method: 'rawResponseItem/completed', params: {
      threadId, turnId, item: { type: 'function_call', name: 'generate_image', arguments: '{}', call_id: 'call-fallback' },
    } });
    await handler.onNotification({ method: 'rawResponse/completed', params: { threadId, turnId, responseId: 'response-fallback' } });
    const response = await handler.onToolCall({ params: { threadId, turnId, callId: 'call-fallback', tool: 'generate_image', arguments: {} } });
    assert.equal(response.success, true);
    await handler.onNotification({ method: 'turn/completed', params: { threadId, turn: { id: turnId, status: 'completed' } } });
  } });
  const result = await runWithHost(host, {
    executeTool: async (_name, _args, context) => {
      executions += 1;
      assert.equal(context.commentaryFallbackUsed, true);
      return { modelResult: { completed: true } };
    },
    onEvent: (event) => events.push(event),
  });
  assert.equal(result.status, 'completed');
  assert.equal(executions, 1);
  assert.equal(events.filter((event) => event.method === 'zflow/tool/progress' && event.params?.commentaryFallbackUsed === true).length, 1);
});

test('native service resumes a bounded generation without resending a resident image', async () => {
  const referencePixels = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
  const host = fakeHost({ script: async ({ handler, threadId, turnId }) => {
    await handler.onNotification({ method: 'item/completed', params: {
      threadId, turnId, item: { id: `answer-${host.requests.length}`, type: 'agentMessage', phase: 'final_answer', text: 'Done.' },
    } });
    await handler.onNotification({ method: 'turn/completed', params: { threadId, turn: { id: turnId, status: 'completed' } } });
  } });
  const sessionId = `native-bounded-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const makeInput = () => ({
    sessionId,
    identity: { taskId: 'task-bounded', operationId: 'operation-bounded', runId: 'run-bounded' },
    provider: { id: 'test', model: 'test-model', baseUrl: 'http://127.0.0.1:1/v1', apiKey: 'test', protocol: 'responses' },
    userText: 'Use this image.', images: [referencePixels], baseInstructions: 'Test.', developerInstructions: 'Explain before tools.',
    tools: [], acquireHost: async () => host, executeTool: async () => ({}),
  });
  try {
    assert.equal((await runNativeAgentTurn(makeInput())).status, 'completed');
    assert.equal((await runNativeAgentTurn(makeInput())).status, 'completed');
    const threadMethods = host.requests.filter((request) => request.method === 'thread/start' || request.method === 'thread/resume');
    assert.deepEqual(threadMethods.map((request) => request.method), ['thread/start', 'thread/resume']);
    const turns = host.requests.filter((request) => request.method === 'turn/start');
    assert.equal(JSON.stringify(turns[0].params.input).includes(referencePixels), true);
    assert.equal(JSON.stringify(turns[1].params.input).includes(referencePixels), false);
    assert.match(JSON.stringify(turns[1].params.input), /already resident/);
    const stored = await loadThread(sessionId);
    assert.equal(stored.state.nativeCodex.contextLedger.generation, 1);
    assert.equal(stored.state.nativeCodex.contextLedger.turnCount, 2);
    assert.equal(stored.state.nativeCodex.contextLedger.imageOccurrences, 2);
    assert.equal(stored.state.nativeCodex.contextLedger.uniqueImageHashes.length, 1);
  } finally {
    await rm(path.join(process.cwd(), 'runtime', 'agent-threads', sessionId), { recursive: true, force: true });
  }
});

test('native service rotates a legacy persisted thread and emits bounded-context diagnostics', async () => {
  const host = fakeHost({ script: async ({ handler, threadId, turnId }) => {
    await handler.onNotification({ method: 'turn/completed', params: { threadId, turn: { id: turnId, status: 'completed' } } });
  } });
  const sessionId = `native-legacy-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const events = [];
  try {
    await updateThreadState(sessionId, { nativeCodex: {
      threadId: 'old-unbounded-thread', scopeId: 'test-scope',
      providerFingerprint: 'test\u0000test-model\u0000http://127.0.0.1:1/v1\u0000responses',
    } });
    const result = await runNativeAgentTurn({
      sessionId,
      identity: { taskId: 'task-legacy', operationId: 'operation-legacy', runId: 'run-legacy' },
      provider: { id: 'test', model: 'test-model', baseUrl: 'http://127.0.0.1:1/v1', apiKey: 'test', protocol: 'responses' },
      userText: 'Generate a cat.', baseInstructions: 'Test.', developerInstructions: 'Explain before tools.', tools: [],
      acquireHost: async () => host, executeTool: async () => ({}), onEvent: (event) => events.push(event),
    });
    assert.equal(result.status, 'completed');
    const threadMethods = host.requests.filter((request) => request.method === 'thread/start' || request.method === 'thread/resume');
    assert.deepEqual(threadMethods.map((request) => request.method), ['thread/start']);
    const diagnostic = events.find((event) => event.method === 'zflow/native_context_prepared');
    assert.equal(diagnostic.params.rotationReason, 'legacy_thread');
    assert.equal(diagnostic.params.nativeGeneration, 1);
  } finally {
    await rm(path.join(process.cwd(), 'runtime', 'agent-threads', sessionId), { recursive: true, force: true });
  }
});

test('adapter retry can force the next Native attempt onto a new generation', async () => {
  const sessionId = `native-retry-rotation-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  try {
    await updateThreadState(sessionId, { nativeCodex: {
      threadId: 'thread-before-retry', scopeId: 'scope', providerFingerprint: 'provider', generation: 2,
      contextLedger: {
        version: 1, generation: 2, nativeThreadId: 'thread-before-retry', turnCount: 3,
        estimatedInputTokens: 100, serializedInputBytes: 100, imageOccurrences: 0,
        uniqueImageHashes: [], residentAssetIds: [], summaryVersion: 0, lastTurnStatus: 'completed',
      },
    } });
    assert.equal(await markNativeContextForRotation(sessionId, 'adapter_retry'), true);
    const stored = await loadThread(sessionId);
    assert.equal(stored.state.nativeCodex.contextLedger.forcedRotationReason, 'adapter_retry');
    assert.equal(stored.state.nativeCodex.contextLedger.lastTurnStatus, 'transport_incomplete');
  } finally {
    await rm(path.join(process.cwd(), 'runtime', 'agent-threads', sessionId), { recursive: true, force: true });
  }
});

test('native service blocks ordinary side effects when the originating sample omitted commentary', async () => {
  let executions = 0;
  const host = fakeHost({ script: async ({ handler, threadId, turnId }) => {
    await handler.onNotification({ method: 'rawResponseItem/completed', params: {
      threadId, turnId, item: { type: 'function_call', name: 'read_relevant_context', arguments: '{}', call_id: 'call-1' },
    } });
    await handler.onNotification({ method: 'rawResponse/completed', params: { threadId, turnId, responseId: 'response-1' } });
    const response = await handler.onToolCall({ params: { threadId, turnId, callId: 'call-1', tool: 'read_relevant_context', arguments: {} } });
    assert.equal(response.success, false);
    assert.match(response.contentItems[0].text, /decision_commentary_missing/);
    await handler.onNotification({ method: 'turn/completed', params: { threadId, turn: { id: turnId, status: 'failed', error: { message: 'stopped' } } } });
  } });
  const result = await runWithHost(host, {
    tools: [{ name: 'read_relevant_context', description: 'Read context.', parameters: { type: 'object' }, requiresCommentary: true, commentaryPolicy: 'server_fallback' }],
    executeTool: async () => { executions += 1; return {}; },
  });
  assert.equal(result.status, 'failed');
  assert.equal(executions, 0);
});

test('native service does not reuse prior-sample commentary for a later ordinary tool call', async () => {
  let executions = 0;
  const host = fakeHost({ script: async ({ handler, threadId, turnId }) => {
    await handler.onNotification({ method: 'rawResponseItem/completed', params: {
      threadId, turnId, item: { type: 'message', role: 'assistant', phase: 'commentary', content: [{ type: 'output_text', text: 'I will read the approved context before continuing this request.' }] },
    } });
    await handler.onNotification({ method: 'rawResponseItem/completed', params: {
      threadId, turnId, item: { type: 'function_call', name: 'read_relevant_context', arguments: '{}', call_id: 'call-with-commentary' },
    } });
    const first = await handler.onToolCall({ params: { threadId, turnId, callId: 'call-with-commentary', tool: 'read_relevant_context', arguments: {} } });
    assert.equal(first.success, true);
    await handler.onNotification({ method: 'rawResponse/completed', params: { threadId, turnId, responseId: 'response-1' } });
    await handler.onNotification({ method: 'rawResponseItem/completed', params: {
      threadId, turnId, item: { type: 'function_call', name: 'read_relevant_context', arguments: '{}', call_id: 'call-without-commentary' },
    } });
    const second = await handler.onToolCall({ params: { threadId, turnId, callId: 'call-without-commentary', tool: 'read_relevant_context', arguments: {} } });
    assert.equal(second.success, false);
    assert.match(second.contentItems[0].text, /decision_commentary_missing/);
    await handler.onNotification({ method: 'turn/completed', params: { threadId, turn: { id: turnId, status: 'failed', error: { message: 'stopped' } } } });
  } });
  const result = await runWithHost(host, {
    tools: [{ name: 'read_relevant_context', description: 'Read context.', parameters: { type: 'object' }, requiresCommentary: true }],
    executeTool: async () => { executions += 1; return {}; },
  });
  assert.equal(result.status, 'failed');
  assert.equal(executions, 1);
});

test('native service fails fast when the application tool host is disabled', async () => {
  const host = fakeHost({ script: async ({ handler, threadId, turnId }) => {
    await handler.onNotification({ method: 'rawResponseItem/completed', params: {
      threadId, turnId, item: { type: 'message', role: 'assistant', phase: 'commentary', content: [{ type: 'output_text', text: 'I will generate the image now.' }] },
    } });
    await handler.onNotification({ method: 'rawResponseItem/completed', params: {
      threadId, turnId, item: { type: 'function_call', name: 'generate_image', arguments: '{}', call_id: 'call-disabled' },
    } });
    await handler.onNotification({ method: 'rawResponse/completed', params: { threadId, turnId, responseId: 'response-disabled' } });
    const response = await handler.onToolCall({ params: { threadId, turnId, callId: 'call-disabled', tool: 'generate_image', arguments: {} } });
    assert.equal(response.success, false);
    assert.match(response.contentItems[0].text, /native_tool_host_disabled/);
  } });
  const started = Date.now();
  const result = await runWithHost(host, {
    turnTimeoutMs: 1000,
    executeTool: async () => ({ isError: true, modelResult: {
      code: 'native_capability_disabled', message: 'code-mode host is disabled',
    } }),
  });
  assert.ok(Date.now() - started < 500, 'disabled host should not wait for turn timeout');
  assert.equal(result.status, 'failed');
  assert.equal(result.error.code, 'native_tool_host_disabled');
  assert.equal(result.error.retryable, false);
});

test('native service rejects unsafe commentary for ordinary tools and does not project it publicly', async () => {
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
      threadId, turnId, item: { type: 'function_call', name: 'read_relevant_context', arguments: '{}', call_id: 'call-unsafe' },
    } });
    const response = await handler.onToolCall({ params: { threadId, turnId, callId: 'call-unsafe', tool: 'read_relevant_context', arguments: {} } });
    assert.equal(response.success, false);
    assert.match(response.contentItems[0].text, /decision_commentary_missing/);
    await handler.onNotification({ method: 'turn/completed', params: { threadId, turn: { id: turnId, status: 'failed', error: { message: 'stopped' } } } });
  } });
  const result = await runWithHost(host, {
    tools: [{ name: 'read_relevant_context', description: 'Read context.', parameters: { type: 'object' }, requiresCommentary: true }],
    executeTool: async () => { executions += 1; return {}; },
    onEvent: (event) => events.push(event),
  });
  assert.equal(result.status, 'failed');
  assert.equal(executions, 0);
  assert.equal(JSON.stringify(events).includes('<skill>'), false);
  assert.equal(events.some((event) => event.method === 'item/completed' && event.params?.item?.phase === 'commentary'), false);
});

test('native service rejects empty or too-short commentary for ordinary tools', async () => {
  let executions = 0;
  const host = fakeHost({ script: async ({ handler, threadId, turnId }) => {
    await handler.onNotification({ method: 'rawResponseItem/completed', params: {
      threadId, turnId, item: { type: 'message', role: 'assistant', phase: 'commentary', content: [{ type: 'output_text', text: 'Generating now.' }] },
    } });
    await handler.onNotification({ method: 'rawResponseItem/completed', params: {
      threadId, turnId, item: { type: 'function_call', name: 'read_relevant_context', arguments: '{}', call_id: 'call-short' },
    } });
    const response = await handler.onToolCall({ params: { threadId, turnId, callId: 'call-short', tool: 'read_relevant_context', arguments: {} } });
    assert.equal(response.success, false);
    assert.match(response.contentItems[0].text, /decision_commentary_missing/);
    await handler.onNotification({ method: 'turn/completed', params: { threadId, turn: { id: turnId, status: 'failed', error: { message: 'stopped' } } } });
  } });
  await runWithHost(host, {
    tools: [{ name: 'read_relevant_context', description: 'Read context.', parameters: { type: 'object' }, requiresCommentary: true }],
    executeTool: async () => { executions += 1; return {}; },
  });
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

test('native service rejects a concurrent turn without queueing and releases the session', async () => {
  const sessionId = `native-busy-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  let releaseTurn;
  const gate = new Promise((resolve) => { releaseTurn = resolve; });
  const host = fakeHost({ script: async ({ handler, threadId, turnId }) => {
    await gate;
    await handler.onNotification({ method: 'turn/completed', params: { threadId, turn: { id: turnId, status: 'completed' } } });
  } });
  const makeInput = () => ({
    sessionId,
    identity: { taskId: 'task-busy', operationId: 'operation-busy', runId: `run-${Math.random()}` },
    provider: { id: 'test', model: 'test-model', baseUrl: 'http://127.0.0.1:1/v1', apiKey: 'test', protocol: 'responses' },
    userText: 'Hello.', baseInstructions: 'Test.', developerInstructions: 'Test.', tools: [],
    executeTool: async () => ({}), acquireHost: async () => host,
  });
  try {
    const first = runNativeAgentTurn(makeInput());
    await new Promise((resolve) => setImmediate(resolve));
    const busy = await runNativeAgentTurn(makeInput());
    assert.equal(busy.status, 'failed');
    assert.equal(busy.turnId, null);
    assert.equal(busy.error.code, 'native_session_busy');
    assert.equal(busy.error.retryable, true);
    releaseTurn();
    const completed = await first;
    assert.equal(completed.status, 'completed');
    const next = await runNativeAgentTurn(makeInput());
    assert.equal(next.status, 'completed');
  } finally {
    await rm(path.join(process.cwd(), 'runtime', 'agent-threads', sessionId), { recursive: true, force: true });
  }
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

test('native service runs Gemini through the shared Agent tool loop and continues with a function response', async () => {
  const requests = [];
  const sockets = new Set();
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    requests.push({ url: req.url, payload });
    const continuing = JSON.stringify(payload.contents).includes('functionResponse');
    const responsePayload = continuing
      ? { candidates: [{ content: { parts: [{ text: 'Gemini completed after the shared tool result.' }] }, finishReason: 'STOP' }] }
      : { candidates: [{ content: { parts: [
          { text: 'I will inspect the supplied context with the shared business tool before answering.' },
          { functionCall: { id: 'gemini-call-1', name: 'inspect_context', args: { scope: 'canvas' } }, thoughtSignature: 'sig-gemini-call' },
        ] }, finishReason: 'STOP' }] };
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.end(`data: ${JSON.stringify(responsePayload)}\n\n`);
  });
  server.on('connection', (socket) => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  let executions = 0;
  const events = [];
  try {
    const result = await runNativeAgentTurn({
      sessionId: `native-gemini-${Date.now()}`,
      identity: { taskId: 'task-gemini', operationId: 'operation-gemini', runId: 'run-gemini' },
      provider: { id: 'gemini-test', model: 'gemini-test-model', baseUrl: `http://127.0.0.1:${server.address().port}/v1`, apiKey: 'test', protocol: 'gemini' },
      userText: 'Inspect the canvas.',
      images: ['data:image/png;base64,YWJj'],
      baseInstructions: 'Base agent contract.',
      developerInstructions: 'Developer agent contract.',
      tools: [{ name: 'inspect_context', description: 'Inspect context.', parameters: { type: 'object', properties: { scope: { type: 'string' } }, required: ['scope'] } }],
      executeTool: async (name, args) => {
        executions += 1;
        assert.equal(name, 'inspect_context');
        assert.deepEqual(args, { scope: 'canvas' });
        return { modelResult: { visibleObjects: 2 }, visualReferences: [{ src: 'data:image/png;base64,ZGVm' }] };
      },
      onEvent: (event) => events.push(event),
    });
    assert.equal(result.status, 'completed');
    assert.equal(result.text, 'Gemini completed after the shared tool result.');
    assert.equal(executions, 1);
    assert.equal(requests.length, 2);
    assert.ok(requests.every((request) => request.url === '/v1beta/models/gemini-test-model:streamGenerateContent?alt=sse'));
    assert.equal(requests[0].payload.systemInstruction.parts[0].text, 'Base agent contract.\n\nDeveloper agent contract.');
    assert.deepEqual(requests[0].payload.contents[0].parts[1], { inlineData: { mimeType: 'image/png', data: 'YWJj' } });
    const replayedCall = requests[1].payload.contents.find((content) => content.role === 'model').parts.find((part) => part.functionCall);
    assert.equal(replayedCall.thoughtSignature, 'sig-gemini-call');
    const toolResponse = requests[1].payload.contents.find((content) => content.parts.some((part) => part.functionResponse));
    assert.deepEqual(toolResponse.parts[0].functionResponse, { name: 'inspect_context', response: { visibleObjects: 2 }, id: 'gemini-call-1' });
    assert.deepEqual(toolResponse.parts[1], { inlineData: { mimeType: 'image/png', data: 'ZGVm' } });
    assert.equal(events.filter((event) => event.method === 'zflow/model_sample_completed').length, 2);
    assert.ok(events.some((event) => event.method === 'item/started' && event.params.item.tool === 'inspect_context'));
    assert.ok(events.some((event) => event.method === 'item/completed' && event.params.item.success === true));
  } finally {
    server.close();
    for (const socket of sockets) socket.destroy();
    await once(server, 'close').catch(() => {});
  }
});
