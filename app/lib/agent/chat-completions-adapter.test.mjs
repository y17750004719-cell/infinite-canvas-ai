import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { runChatCompletionsTurn } from './chat-completions-adapter.mjs';

test('Chat Completions streams a tool call, continues with its result, and preserves image input', async () => {
  const requests = [];
  const server = createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    requests.push(JSON.parse(Buffer.concat(chunks).toString()));
    const call = requests.length === 1;
    const payload = call
      ? { id: 'r1', choices: [{ delta: { content: '我先读取参考图并记录颜色，确认结果后再继续处理当前任务。', tool_calls: [{ index: 0, id: 'call-1', function: { name: 'record_color', arguments: '{}' } }] } }] }
      : { id: 'r2', choices: [{ delta: { content: '已完成。' }, finish_reason: 'stop' }] };
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.end(`data: ${JSON.stringify(payload)}\n\ndata: [DONE]\n\n`);
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const events = []; let calls = 0;
  try {
    const result = await runChatCompletionsTurn({
      provider: { baseUrl: `http://127.0.0.1:${server.address().port}/v1`, model: 'mock', apiKey: 'x' },
      userText: '处理图片', images: ['data:image/png;base64,AA=='], baseInstructions: 'base', developerInstructions: 'dev',
      tools: [{ name: 'record_color', description: '记录颜色', parameters: { type: 'object' } }],
      executeTool: async () => { calls += 1; return { modelResult: { ok: true } }; }, onEvent: (event) => events.push(event),
    });
    assert.equal(result.status, 'completed'); assert.equal(calls, 1); assert.equal(requests.length, 2);
    assert.deepEqual(requests[1].messages.at(-1).role, 'tool'); assert.ok(JSON.stringify(requests[0]).includes('data:image/png'));
    assert.equal(events.filter((event) => event.method === 'zflow/model_sample_completed').length, 2);
  } finally { await new Promise((resolve) => server.close(resolve)); }
});

test('Chat Completions rejects a tool call without a model task description', async () => {
  const server = createServer((_req, res) => { res.writeHead(200, { 'content-type': 'text/event-stream' }); res.end(`data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'c', function: { name: 'x', arguments: '{}' } }] } }] })}\n\ndata: [DONE]\n\n`); });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  try { await assert.rejects(runChatCompletionsTurn({ provider: { baseUrl: `http://127.0.0.1:${server.address().port}/v1`, model: 'm' }, userText: 'x', baseInstructions: '', developerInstructions: '', tools: [{ name: 'x', description: 'x', parameters: {} }], executeTool: async () => ({}) }), /decision_commentary_missing/); } finally { await new Promise((resolve) => server.close(resolve)); }
});

test('Chat Completions uses the server fallback for generate_image without commentary', async () => {
  let requests = 0;
  const server = createServer((_req, res) => {
    requests += 1;
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    const payload = requests === 1
      ? { choices: [{ delta: { tool_calls: [{ index: 0, id: 'image-call', function: { name: 'generate_image', arguments: '{}' } }] } }] }
      : { choices: [{ delta: { content: '完成。' }, finish_reason: 'stop' }] };
    res.end(`data: ${JSON.stringify(payload)}\n\ndata: [DONE]\n\n`);
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const events = [];
  try {
    const result = await runChatCompletionsTurn({
      provider: { baseUrl: `http://127.0.0.1:${server.address().port}/v1`, model: 'm' },
      userText: '生成图片', baseInstructions: '', developerInstructions: '',
      tools: [{ name: 'generate_image', description: 'Generate.', parameters: { type: 'object' }, requiresCommentary: true, commentaryPolicy: 'server_fallback' }],
      executeTool: async (_name, _args, context) => { assert.equal(context.commentaryFallbackUsed, true); return { modelResult: { completed: true } }; },
      onEvent: (event) => events.push(event),
    });
    assert.equal(result.status, 'completed');
    assert.ok(events.some((event) => event.method === 'zflow/tool/progress' && event.params?.commentaryFallbackUsed === true));
  } finally { await new Promise((resolve) => server.close(resolve)); }
});
