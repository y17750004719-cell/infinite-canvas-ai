import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';
import { requestChatCompletionsStream } from './chat-completions-adapter.mjs';

async function fixture(t, handler) {
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); });
  return { provider: { baseUrl: `http://127.0.0.1:${server.address().port}/v1`, apiKey: 'loopback' }, body: { model: 'test', messages: [] }, maxAttempts: 1, signal: AbortSignal.timeout(2000) };
}

test('chat transport ends on DONE without waiting for HTTP EOF', async (t) => {
  const input = await fixture(t, (_req, res) => {
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.write('data: {"choices":[{"delta":{"content":"OK"}}]}\n\ndata: [DONE]\n\n');
  });
  assert.equal((await requestChatCompletionsStream(input)).text, 'OK');
});

test('chat transport decodes UTF-8 split across network chunks', async (t) => {
  const input = await fixture(t, (_req, res) => {
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    const bytes = Buffer.from('data: {"choices":[{"delta":{"content":"你好"}}]}\n\ndata: [DONE]\n\n');
    const cut = bytes.indexOf(Buffer.from('你')) + 1;
    res.write(bytes.subarray(0, cut));
    setTimeout(() => res.end(bytes.subarray(cut)), 10);
  });
  assert.equal((await requestChatCompletionsStream(input)).text, '你好');
});

for (const [name, content, code] of [
  ['truncated', 'data: {"choices":[{"delta":{"content":"partial"}}]}\n\n', 'provider_incomplete_stream'],
  ['empty', 'data: [DONE]\n\n', 'provider_empty_stream'],
  ['malformed', 'data: {bad}\n\n', 'provider_malformed_stream'],
  ['error event', 'data: {"error":{"message":"private provider detail"}}\n\n', 'provider_stream_error'],
]) {
  test(`chat transport rejects ${name} streams`, async (t) => {
    const input = await fixture(t, (_req, res) => { res.writeHead(200, { 'content-type': 'text/event-stream' }); res.end(content); });
    await assert.rejects(requestChatCompletionsStream(input), (error) => error.code === code && !error.message.includes('private'));
  });
}

test('chat transport preserves structured HTTP error details', async (t) => {
  const input = await fixture(t, (_req, res) => { res.writeHead(422, { 'content-type': 'application/json' }); res.end('{"error":{"message":"invalid messages"}}'); });
  await assert.rejects(requestChatCompletionsStream(input), (error) => error.status === 422 && error.structured === true);
});

test('chat transport aborts a stalled stream without retrying', async (t) => {
  let requests = 0;
  const input = await fixture(t, (_req, res) => { requests++; res.writeHead(200, { 'content-type': 'text/event-stream' }); res.flushHeaders(); });
  input.signal = AbortSignal.timeout(60);
  await assert.rejects(requestChatCompletionsStream(input), (error) => ['AbortError', 'TimeoutError'].includes(error.name));
  assert.equal(requests, 1);
});
