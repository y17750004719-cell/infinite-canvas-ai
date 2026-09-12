import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { access, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { NativeCodexStdioClient } from './native-codex-stdio.mjs';
import { acquireNativeCodexHost, NATIVE_DISABLED_FEATURES } from './native-codex-host.mjs';
import { updateProviderRegistry, readProviderRegistry, effectiveProviderProtocol } from '../provider-config.mjs';
import { runNativeAgentTurn } from './native-agent-service.ts';

const binaryPath = path.resolve('runtime/native-codex/target/debug/codex-app-server');
const binaryAvailable = await access(binaryPath, constants.X_OK).then(() => true, () => false);

test('saved Responses override chats without admission and continues real tools across image stages', { skip: !binaryAvailable }, async () => {
  const scratch = await mkdtemp(path.join(tmpdir(), 'native-agent-service-integration-'));
  const sessionId = `native-integration-${Date.now()}`;
  const requests = [];
  const toolCalls = [];
  const modelSampleEvents = [];
  const referencePixels = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
  const commentary = [
    'I will inspect the approved canvas reference first so the image contract uses verified visual facts.',
    'The reference is available. I will now generate and save the requested image using that stable reference.',
  ];
  const responseDone = (id) => ({ type: 'response.completed', response: { id, usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 } } });
  const messageDone = (id, value, phase) => ({
    type: 'response.output_item.done',
    item: { id, type: 'message', role: 'assistant', phase, content: [{ type: 'output_text', text: value }] },
  });
  const functionDone = (callId, name) => ({
    type: 'response.output_item.done',
    item: { type: 'function_call', call_id: callId, name, arguments: '{}' },
  });
  const server = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    requests.push(body);
    const index = requests.length;
    const id = `response-${index}`;
    const events = index === 1
      ? [
          messageDone('commentary-1', commentary[0], 'commentary'),
          functionDone('context-call', 'get_canvas_context'),
          functionDone('memory-call', 'read_relevant_context'),
        ]
      : index === 2
        ? [messageDone('commentary-2', commentary[1], 'commentary'), functionDone('image-call', 'generate_image')]
        : [messageDone('final-1', 'The image is generated and saved.', 'final_answer')];
    response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
    for (const event of [{ type: 'response.created', response: { id } }, ...events, responseDone(id)]) {
      response.write(`data: ${JSON.stringify(event)}\n\n`);
    }
    response.end();
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const endpoint = `http://127.0.0.1:${server.address().port}`;
  const runtimeRoot = path.join(scratch, 'native-codex');
  await mkdir(runtimeRoot, { recursive: true });
  const manifest = JSON.parse(await readFile(path.resolve('runtime/native-codex/build-manifest.json'), 'utf8'));
  await writeFile(path.join(runtimeRoot, 'build-manifest.json'), JSON.stringify({ ...manifest, binaryPath }));
  await updateProviderRegistry([{
    id: 'local', name: 'Loopback', baseUrl: `${endpoint}/v1`, apiKey: 'local-test',
    protocol: 'openai', chatModels: ['mock-model'], modelProtocols: { 'mock-model': 'responses' },
    enabled: true, primary: true,
  }], { runtimeDir: scratch });
  const saved = (await readProviderRegistry({ runtimeDir: scratch })).providers[0];
  const configuredProvider = { ...saved, model: 'mock-model', protocol: effectiveProviderProtocol(saved, 'mock-model') };
  assert.equal(configuredProvider.protocol, 'responses');
  await assert.rejects(access(path.join(runtimeRoot, 'model-compatibility.json')), { code: 'ENOENT' });
  let host;
  try {
    const result = await runNativeAgentTurn({
      sessionId,
      identity: { taskId: 'task-integration', operationId: 'operation-integration', runId: 'run-integration' },
      provider: configuredProvider,
      userText: 'Use my canvas reference and generate one image.',
      baseInstructions: 'You are a visual assistant.',
      developerInstructions: 'Explain the immediate action before every tool call.',
      tools: [
        { name: 'get_canvas_context', description: 'Read canvas context.', parameters: { type: 'object', properties: {}, additionalProperties: false }, requiresCommentary: true },
        { name: 'read_relevant_context', description: 'Read approved conversation context.', parameters: { type: 'object', properties: {}, additionalProperties: false }, requiresCommentary: true },
        { name: 'generate_image', description: 'Generate and save an image.', parameters: { type: 'object', properties: {}, additionalProperties: false }, requiresCommentary: true },
      ],
      acquireHost: async (args) => (host = await acquireNativeCodexHost({ ...args, runtimeRoot })),
      executeTool: async (name) => {
        toolCalls.push(name);
        if (name === 'get_canvas_context') return {
          modelResult: { referenceId: 'reference-1', available: true },
          visualReferences: [{ id: 'reference-1', src: referencePixels }],
        };
        if (name === 'read_relevant_context') return { modelResult: { requirement: 'preserve-layout' } };
        return { modelResult: { completed: true, assetId: 'asset-1' }, publicResult: { assets: [{ id: 'asset-1' }] } };
      },
      onEvent: (event) => {
        if (event.method === 'zflow/model_sample_completed') modelSampleEvents.push(event.params);
      },
      turnTimeoutMs: 30_000,
    });
    assert.equal(result.status, 'completed');
    assert.equal(result.text, 'The image is generated and saved.');
    assert.deepEqual(toolCalls, ['get_canvas_context', 'read_relevant_context', 'generate_image']);
    assert.equal(requests.length, 3);
    assert.equal(modelSampleEvents.length, 3);
    assert.equal(modelSampleEvents[0].hadPublicCommentary, true);
    assert.equal(modelSampleEvents[1].hadPublicCommentary, true);
    assert.ok(JSON.stringify(requests[1].input).includes('reference-1'));
    assert.ok(JSON.stringify(requests[1].input).includes(referencePixels), 'tool-result image pixels must reach the next actual model request');
    assert.ok(JSON.stringify(requests[1].input).includes('preserve-layout'));
    assert.ok(JSON.stringify(requests[2].input).includes('asset-1'));
    const visibleTools = requests[0].tools.flatMap((tool) => tool.type === 'namespace'
      ? tool.tools.map((entry) => `${tool.name}.${entry.name}`)
      : [tool.name || tool.type]);
    assert.deepEqual(visibleTools.sort(), ['generate_image', 'get_canvas_context', 'read_relevant_context']);
    assert.equal(visibleTools.some((name) => /shell|exec|patch|file|code|skill|plugin/i.test(name)), false);
  } finally {
    await host?.client.close();
    await new Promise((resolve) => server.close(resolve));
    await rm(scratch, { recursive: true, force: true });
    await rm(path.join(process.cwd(), 'runtime', 'agent-threads', sessionId), { recursive: true, force: true });
  }
});

async function runSimpleRealScenario({ responseItems, tools = [], executeTool = async () => ({}) }) {
  const scratch = await mkdtemp(path.join(tmpdir(), 'native-agent-service-simple-'));
  const sessionId = `native-simple-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const requests = [];
  const server = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    requests.push(body);
    const id = `simple-response-${requests.length}`;
    const items = responseItems(requests.length);
    response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
    for (const event of [
      { type: 'response.created', response: { id } },
      ...items,
      { type: 'response.completed', response: { id, usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 } } },
    ]) response.write(`data: ${JSON.stringify(event)}\n\n`);
    response.end();
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const endpoint = `http://127.0.0.1:${server.address().port}`;
  const privateHome = path.join(scratch, 'home');
  const cwd = path.join(scratch, 'workspace');
  await mkdir(privateHome, { recursive: true });
  await mkdir(cwd, { recursive: true });
  await writeFile(path.join(privateHome, 'config.toml'), [
    'model = "mock-model"', 'model_provider = "zflow_provider"', 'approval_policy = "never"',
    'sandbox_mode = "read-only"', 'web_search = "disabled"',
    '[tools.experimental_request_user_input]', 'enabled = false', '[tools.update_plan]', 'enabled = false',
    '[orchestrator.skills]', 'enabled = false', '[orchestrator.mcp]', 'enabled = false', '[skills.bundled]', 'enabled = false',
    '[features]', ...NATIVE_DISABLED_FEATURES.map((name) => `${name} = false`),
    '[model_providers.zflow_provider]', 'name = "Local integration provider"',
    `base_url = ${JSON.stringify(`${endpoint}/v1`)}`, 'wire_api = "responses"',
    'env_key = "ZFLOW_NATIVE_PROVIDER_KEY"', 'request_max_retries = 0', 'stream_max_retries = 0', 'supports_websockets = false',
  ].join('\n'));
  const handlers = new Map();
  const client = new NativeCodexStdioClient({
    binaryPath, args: ['--listen', 'stdio://', '--strict-config', '--disable-plugin-startup-tasks-for-tests'], cwd,
    env: { PATH: '/usr/bin:/bin', HOME: privateHome, CODEX_HOME: privateHome, CODEX_APP_SERVER_DISABLE_MANAGED_CONFIG: '1', ZFLOW_NATIVE_PROVIDER_KEY: 'local-test' },
    requestTimeoutMs: 30_000,
    onNotification: (event) => handlers.get(event.params?.threadId)?.onNotification?.(event),
    onServerRequest: (event) => handlers.get(event.params?.threadId)?.onToolCall?.(event),
  });
  await client.start({ clientInfo: { name: 'native_agent_service_simple_test', version: '0.1.0' }, capabilities: { experimentalApi: true } });
  const host = { client, cwd, privateHome, scopeId: `simple-${Date.now()}`, registerThreadHandler(threadId, handler) {
    handlers.set(threadId, handler); return () => handlers.delete(threadId);
  } };
  try {
    const result = await runNativeAgentTurn({
      sessionId,
      identity: { taskId: 'task-simple', operationId: 'operation-simple', runId: 'run-simple' },
      provider: { id: 'local', model: 'mock-model', baseUrl: `${endpoint}/v1`, apiKey: 'local-test', protocol: 'responses' },
      userText: 'Handle this request.', baseInstructions: 'You are a visual assistant.',
      developerInstructions: 'Explain actions before tools.', tools, executeTool,
      acquireHost: async () => host, turnTimeoutMs: 10_000,
    });
    return { result, requests };
  } finally {
    await client.close();
    await new Promise((resolve) => server.close(resolve));
    await rm(scratch, { recursive: true, force: true });
    await rm(path.join(process.cwd(), 'runtime', 'agent-threads', sessionId), { recursive: true, force: true });
  }
}

test('real App Server completes an ordinary no-tool request in one sample', { skip: !binaryAvailable }, async () => {
  const { result, requests } = await runSimpleRealScenario({
    responseItems: () => [{ type: 'response.output_item.done', item: {
      id: 'answer-1', type: 'message', role: 'assistant', phase: 'final_answer',
      content: [{ type: 'output_text', text: 'A direct answer.' }],
    } }],
  });
  assert.equal(result.status, 'completed');
  assert.equal(result.text, 'A direct answer.');
  assert.equal(requests.length, 1);
});

test('real App Server cannot execute a side-effect tool after two samples omit commentary', { skip: !binaryAvailable }, async () => {
  let executions = 0;
  const { result, requests } = await runSimpleRealScenario({
    tools: [{ name: 'generate_image', description: 'Generate.', parameters: { type: 'object', properties: {}, additionalProperties: false }, requiresCommentary: true }],
    executeTool: async () => { executions += 1; return { modelResult: { completed: true } }; },
    responseItems: (index) => index <= 2
      ? [{ type: 'response.output_item.done', item: { type: 'function_call', call_id: `missing-commentary-${index}`, name: 'generate_image', arguments: '{}' } }]
      : [{ type: 'response.output_item.done', item: { id: 'fallback', type: 'message', role: 'assistant', phase: 'final_answer', content: [{ type: 'output_text', text: 'Stopped.' }] } }],
  });
  assert.equal(executions, 0);
  assert.ok(requests.length >= 2);
  assert.notEqual(result.status, 'waiting');
});
