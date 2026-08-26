import assert from 'node:assert/strict';
import test from 'node:test';
import { readOpenAiImageStream } from './openai-image-stream.mjs';

const sseResponse = (chunks) => new Response(new ReadableStream({
  start(controller) {
    const encoder = new TextEncoder();
    chunks.forEach((chunk) => controller.enqueue(encoder.encode(chunk)));
    controller.close();
  },
}), { headers: { 'content-type': 'text/event-stream' } });

test('prefers a completed OpenAI image stream payload over partial images', async () => {
  const result = await readOpenAiImageStream(sseResponse([
    'data: {"type":"image_generation.partial_image","b64_json":"partial"}\n\n',
    'data: {"type":"image_generation.completed","data":[{"b64_json":"final"}]}\n\n',
  ]));
  assert.equal(result.transport, 'sse');
  assert.equal(result.partialPayload.b64_json, 'partial');
  assert.equal(result.completedPayload.data[0].b64_json, 'final');
});

test('keeps the last valid partial image when an OpenAI stream ends early', async () => {
  const result = await readOpenAiImageStream(sseResponse([
    'data: {"type":"image_generation.partial_image","b64_json":"first"}\n\n',
    'data: {"type":"image_generation.partial_image","b64_json":"last"}\n\n',
  ]));
  assert.equal(result.completedPayload, null);
  assert.equal(result.partialPayload.b64_json, 'last');
});

test('ignores malformed SSE image events', async () => {
  const result = await readOpenAiImageStream(sseResponse(['data: not-json\n\n']));
  assert.equal(result.completedPayload, null);
  assert.equal(result.partialPayload, null);
});

test('accepts JSON from OpenAI-compatible providers that ignore streaming', async () => {
  const result = await readOpenAiImageStream(new Response(JSON.stringify({ data: [{ url: 'https://example.test/final.png' }] }), {
    headers: { 'content-type': 'application/json' },
  }));
  assert.equal(result.transport, 'json');
  assert.equal(result.completedPayload.data[0].url, 'https://example.test/final.png');
  assert.equal(result.partialPayload, null);
});
