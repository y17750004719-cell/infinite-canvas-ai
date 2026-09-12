import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { updateProviderRegistry, readProviderRegistry, effectiveProviderProtocol } from '../provider-config.mjs';
import { runNativeAgentTurn } from './native-agent-service.ts';

for (const protocol of ['openai', 'gemini']) {
  for (const override of [false, true]) {
    test(`saved ${protocol} ${override ? 'model override' : 'default'} starts chat without probing`, async (t) => {
      const requests = [];
      const server = createServer(async (req, res) => {
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        requests.push({ url: req.url, body: JSON.parse(Buffer.concat(chunks).toString()) });
        const payload = protocol === 'gemini'
          ? { candidates: [{ content: { parts: [{ text: 'Ready.' }] }, finishReason: 'STOP' }] }
          : { choices: [{ delta: { content: 'Ready.' }, finish_reason: 'stop' }] };
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        res.end(`data: ${JSON.stringify(payload)}\n\n`);
      });
      server.listen(0, '127.0.0.1');
      await once(server, 'listening');
      t.after(() => new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); }));
      const runtimeDir = await mkdtemp(path.join(tmpdir(), 'provider-direct-chat-'));
      t.after(() => rm(runtimeDir, { recursive: true, force: true }));
      await updateProviderRegistry([{
        id: 'direct', name: 'Direct', enabled: true, primary: true,
        baseUrl: `http://127.0.0.1:${server.address().port}/v1`, apiKey: 'loopback-only',
        protocol: override ? 'responses' : protocol, chatModels: ['chat-model'],
        modelProtocols: override ? { 'chat-model': protocol } : {},
      }], { runtimeDir });
      const saved = (await readProviderRegistry({ runtimeDir, env: {} })).providers[0];
      const result = await runNativeAgentTurn({
        sessionId: `direct-${protocol}-${override}-${Date.now()}`,
        provider: { ...saved, model: 'chat-model', protocol: effectiveProviderProtocol(saved, 'chat-model') },
        userText: 'Hello.', baseInstructions: '', developerInstructions: '', tools: [],
        executeTool: async () => assert.fail('Ordinary chat must not execute tools'),
      });
      assert.equal(result.status, 'completed');
      assert.equal(result.text, 'Ready.');
      assert.equal(requests.length, 1, 'Only the actual chat request is sent');
      assert.equal(requests[0].url, protocol === 'gemini'
        ? '/v1beta/models/chat-model:streamGenerateContent?alt=sse' : '/v1/chat/completions');
      const after = (await readProviderRegistry({ runtimeDir, env: {} })).providers[0];
      assert.equal(after.protocol, saved.protocol);
      assert.deepEqual(after.modelProtocols, saved.modelProtocols);
    });
  }

  test(`${protocol} upstream failure does not probe or switch protocols`, async (t) => {
    const urls = [];
    const server = createServer((req, res) => {
      urls.push(req.url);
      req.resume();
      res.writeHead(401, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'Invalid fixture key' } }));
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    t.after(() => new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); }));
    await assert.rejects(runNativeAgentTurn({
      sessionId: `direct-failure-${protocol}-${Date.now()}`,
      provider: { id: 'direct', baseUrl: `http://127.0.0.1:${server.address().port}/v1`, model: 'chat-model', protocol },
      userText: 'Hello.', baseInstructions: '', developerInstructions: '', tools: [], executeTool: async () => ({}),
    }), { code: 'provider_unauthorized' });
    assert.deepEqual(urls, [protocol === 'gemini'
      ? '/v1beta/models/chat-model:streamGenerateContent?alt=sse' : '/v1/chat/completions']);
  });
}
