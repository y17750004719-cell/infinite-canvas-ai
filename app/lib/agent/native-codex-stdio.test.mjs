import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { NativeCodexStdioClient } from './native-codex-stdio.mjs';

const FIXTURE_SOURCE = String.raw`
const readline = require('node:readline');
const mode = process.env.FIXTURE_MODE || 'normal';
const pending = new Map();
let nextServerId = 900;
const send = (message, split = false) => {
  const data = JSON.stringify(message) + '\n';
  if (!split) return process.stdout.write(data);
  const pivot = Math.max(1, Math.floor(data.length / 2));
  process.stdout.write(data.slice(0, pivot));
  setTimeout(() => process.stdout.write(data.slice(pivot)), 5);
};
const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on('line', (line) => {
  const message = JSON.parse(line);
  if (Object.prototype.hasOwnProperty.call(message, 'id') && !message.method) {
    const callback = pending.get(message.id);
    pending.delete(message.id);
    callback?.(message);
    return;
  }
  if (message.method === 'initialize') {
    send({ id: message.id, result: { userAgent: 'fixture', platformFamily: 'unix' } }, true);
    return;
  }
  if (message.method === 'initialized') return;
  if (message.method === 'thread/read') {
    const delay = message.params.delay || 0;
    setTimeout(() => send({ id: message.id, result: { marker: message.params.marker } }, true), delay);
    return;
  }
  if (message.method === 'skills/list' && mode === 'malformed') {
    process.stdout.write('{not-json}\n');
    return;
  }
  if (message.method === 'skills/list' && mode === 'oversized') {
    process.stdout.write('x'.repeat(1024));
    return;
  }
  if (message.method === 'thread/resume' && mode === 'exit') {
    process.exit(7);
  }
  if (message.method === 'turn/start' && mode === 'hang') return;
  if (message.method === 'turn/start') {
    send({ method: mode === 'ordered' || mode === 'notification-error' ? 'item/agentMessage/delta' : 'turn/started', params: { threadId: message.params.threadId, delta: 'Preparing tool.' } });
    const toolCount = mode === 'two-tools' ? 2 : 1;
    const responses = [];
    for (let index = 0; index < toolCount; index += 1) {
      const requestId = nextServerId++;
      pending.set(requestId, (response) => {
        responses[index] = response.result || response.error;
        if (responses.filter(Boolean).length === toolCount) {
          send({ id: message.id, result: { turn: { id: 'turn-1' }, toolResponses: responses, toolResponse: responses[0] } });
        }
      });
      send({ method: 'item/tool/call', id: requestId, params: {
        threadId: message.params.threadId,
        turnId: 'turn-1',
        callId: 'call-' + (index + 1),
        tool: 'generate_image',
        arguments: { prompt: 'fixture prompt ' + (index + 1) }
      }}, toolCount === 1);
    }
    return;
  }
  if (message.method === 'turn/interrupt') {
    send({ id: message.id, result: { interrupted: true } });
    return;
  }
});
process.on('SIGTERM', () => process.exit(0));
`;

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function waitFor(predicate, timeoutMs = 500) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('Timed out waiting for test condition');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

async function createFixture(t, mode = 'normal', options = {}) {
  const directory = await mkdtemp(path.join(tmpdir(), 'native-codex-stdio-'));
  const fixturePath = path.join(directory, 'fixture.cjs');
  await writeFile(fixturePath, FIXTURE_SOURCE, 'utf8');
  const notifications = [];
  const client = new NativeCodexStdioClient({
    binaryPath: process.execPath,
    args: [fixturePath],
    cwd: directory,
    env: { FIXTURE_MODE: mode },
    requestTimeoutMs: options.requestTimeoutMs || 500,
    closeTimeoutMs: 250,
    maxLineBytes: options.maxLineBytes || 64 * 1024,
    onNotification: (notification) => notifications.push(notification),
    onServerRequest: options.onServerRequest,
  });
  t.after(async () => {
    await client.close();
    await rm(directory, { recursive: true, force: true });
  });
  await client.start({
    clientInfo: { name: 'zo_design_test', title: 'ZO Design Test', version: '0.0.0' },
    capabilities: { experimentalApi: true },
  });
  return { client, notifications };
}

test('correlates split JSONL responses and delivers notifications', async (t) => {
  const { client, notifications } = await createFixture(t, 'normal', {
    onServerRequest: async () => ({ contentItems: [{ type: 'inputText', text: 'ok' }], success: true }),
  });
  const [slow, fast] = await Promise.all([
    client.request('thread/read', { marker: 'slow', delay: 20 }),
    client.request('thread/read', { marker: 'fast', delay: 0 }),
  ]);
  assert.equal(slow.marker, 'slow');
  assert.equal(fast.marker, 'fast');

  const result = await client.request('turn/start', { threadId: 'thread-1', input: [] });
  assert.equal(result.toolResponse.success, true);
  assert.deepEqual(result.toolResponse.contentItems, [{ type: 'inputText', text: 'ok' }]);
  assert.deepEqual(notifications, [{
    method: 'turn/started',
    params: { threadId: 'thread-1', delta: 'Preparing tool.' },
  }]);
});

test('rejects non-allowlisted RPC locally', async (t) => {
  const { client } = await createFixture(t);
  await assert.rejects(client.request('process/spawn', { command: ['whoami'] }), {
    code: 'rpc_method_not_allowed',
    method: 'process/spawn',
  });
});

test('rejects pending requests when the child exits', async (t) => {
  const { client } = await createFixture(t, 'exit');
  await assert.rejects(client.request('thread/resume', { threadId: 'thread-1' }), {
    code: 'process_exited',
  });
  assert.equal(client.pendingRequestCount, 0);
});

test('sanitizes spawn failures and completes startup cleanup', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'native-codex-missing-'));
  try {
    const client = new NativeCodexStdioClient({
      binaryPath: path.join(directory, 'missing-app-server'),
      cwd: directory,
      env: {},
      requestTimeoutMs: 200,
      closeTimeoutMs: 50,
    });
    await assert.rejects(
      client.start({ clientInfo: { name: 'test', title: 'Test', version: '0.0.0' } }),
      (error) => error.code === 'process_error' && !error.message.includes(directory),
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('marks a timed-out turn start as outcome unknown and never retries it', async (t) => {
  const { client } = await createFixture(t, 'hang');
  await assert.rejects(
    client.request('turn/start', { threadId: 'thread-1', input: [] }, { timeoutMs: 40 }),
    (error) => error.code === 'request_timeout' && error.outcomeUnknown === true && error.retrySafe === false,
  );
  assert.equal(client.pendingRequestCount, 0);
});

test('malformed server JSON terminates the connection and clears pending requests', async (t) => {
  const { client } = await createFixture(t, 'malformed');
  await assert.rejects(client.request('skills/list', {}), { code: 'malformed_json' });
  assert.equal(client.pendingRequestCount, 0);
  await assert.rejects(client.request('thread/read', { marker: 'late' }), {
    code: 'malformed_json',
  });
  assert.equal(client.pendingRequestCount, 0);
});

test('terminates the connection when an unterminated line exceeds the byte limit', async (t) => {
  const { client } = await createFixture(t, 'oversized', { maxLineBytes: 128 });
  await assert.rejects(client.request('skills/list', {}), { code: 'line_too_large' });
});

test('rejects unknown server requests with a JSON-RPC method-not-found error', async (t) => {
  const { client } = await createFixture(t);
  const result = await client.request('turn/start', { threadId: 'thread-1', input: [] });
  assert.deepEqual(result.toolResponse, { code: -32601, message: 'Method not found' });
});

test('awaits async notification persistence before starting a later tool request', async (t) => {
  const persisted = deferred();
  let toolStarted = false;
  const { client } = await createFixture(t, 'ordered', {
    onNotification: undefined,
    onServerRequest: async () => {
      toolStarted = true;
      return { contentItems: [{ type: 'inputText', text: 'done' }], success: true };
    },
  });
  client.onNotification = async () => persisted.promise;

  const turn = client.request('turn/start', { threadId: 'thread-1', input: [] });
  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.equal(toolStarted, false);
  persisted.resolve();
  await turn;
  assert.equal(toolStarted, true);
});

test('starts independent tool callbacks without waiting for earlier tool completion', async (t) => {
  const gates = [deferred(), deferred()];
  const started = [];
  const { client } = await createFixture(t, 'two-tools', {
    onServerRequest: async ({ params }) => {
      const index = Number(params.callId.slice(-1)) - 1;
      started.push(params.callId);
      await gates[index].promise;
      return { contentItems: [{ type: 'inputText', text: params.callId }], success: true };
    },
  });
  const turn = client.request('turn/start', { threadId: 'thread-1', input: [] });
  await waitFor(() => started.length === 2);
  assert.deepEqual(started, ['call-1', 'call-2']);
  gates[0].resolve();
  gates[1].resolve();
  const result = await turn;
  assert.equal(result.toolResponses.length, 2);
});

test('notification rejection fails the connection before dispatching a later tool', async (t) => {
  let toolCalls = 0;
  const { client } = await createFixture(t, 'notification-error', {
    onServerRequest: async () => {
      toolCalls += 1;
      return { contentItems: [], success: true };
    },
  });
  client.onNotification = async () => {
    throw new Error('private persistence failure');
  };
  await assert.rejects(client.request('turn/start', { threadId: 'thread-1', input: [] }), {
    code: 'notification_handler_failed',
  });
  assert.equal(toolCalls, 0);
});

test('processes an interrupt response while a dynamic tool callback is awaiting', async (t) => {
  const toolGate = deferred();
  let toolStarted = false;
  const { client } = await createFixture(t, 'normal', {
    onServerRequest: async () => {
      toolStarted = true;
      await toolGate.promise;
      return { contentItems: [], success: false };
    },
  });
  const turn = client.request('turn/start', { threadId: 'thread-1', input: [] });
  await waitFor(() => toolStarted);
  const interrupted = await client.request('turn/interrupt', { threadId: 'thread-1', turnId: 'turn-1' });
  assert.deepEqual(interrupted, { interrupted: true });
  toolGate.resolve();
  await turn;
});
