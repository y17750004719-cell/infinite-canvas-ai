import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildNativeTurnRequest,
  createDynamicToolCallback,
  createNativeEventForwarder,
  materializeNativeImages,
} from './agent-turn-execution-service.mjs';

test('materializeNativeImages converts durable assets to data URLs', async () => {
  const result = await materializeNativeImages({
    sessionId: 'session-1',
    sources: ['asset://one'],
    materialize: async ({ existingAsset }) => existingAsset || { mimeType: 'image/png' },
    read: async () => Uint8Array.from([65, 66]),
  });
  assert.deepEqual(result, ['data:image/png;base64,QUI=']);
});

test('createDynamicToolCallback enforces approval argument identity', async () => {
  const calls = [];
  const callback = createDynamicToolCallback({
    approvedConfirmation: { toolName: 'generate_image', toolArgs: { count: 1 } },
    dispatch: async (input) => { calls.push(input); return { ok: true }; },
  });
  assert.deepEqual(await callback('generate_image', { count: 2 }), {
    isError: true,
    modelResult: { code: 'approval_contract_changed', retryable: false },
  });
  assert.deepEqual(await callback('generate_image', { count: 1 }), { ok: true });
  assert.equal(calls.length, 1);
});

test('createNativeEventForwarder preserves raw events and projects item events', async () => {
  const seen = [];
  const forward = createNativeEventForwarder({
    onRawEvent: (event) => seen.push(['raw', event.method]),
    onActivityText: (id, delta) => seen.push(['delta', id, delta]),
    onToolStart: (id, tool) => seen.push(['start', id, tool]),
    onToolResult: (id, tool) => seen.push(['result', id, tool]),
    onCommentary: (item) => seen.push(['commentary', item.text]),
  });
  await forward({ method: 'item/agentMessage/delta', params: { itemId: 'm1', delta: 'hi' } });
  await forward({ method: 'item/started', params: { item: { type: 'dynamicToolCall', id: 't1', tool: 'generate_image' } } });
  await forward({ method: 'item/completed', params: { item: { type: 'dynamicToolCall', id: 't1', tool: 'generate_image' } } });
  await forward({ method: 'item/completed', params: { item: { type: 'agentMessage', text: 'done' } } });
  assert.deepEqual(seen, [
    ['delta', 'm1', 'hi'], ['raw', 'item/agentMessage/delta'],
    ['start', 't1', 'generate_image'], ['raw', 'item/started'],
    ['result', 't1', 'generate_image'], ['raw', 'item/completed'],
    ['commentary', 'done'], ['raw', 'item/completed'],
  ]);
});

test('buildNativeTurnRequest validates required execution callbacks', () => {
  assert.throws(() => buildNativeTurnRequest({ sessionId: 's', identity: {} }), /executeTool/);
  const request = buildNativeTurnRequest({
    sessionId: 's', identity: { taskId: 't' }, executeTool: () => {}, onEvent: () => {},
    tools: ['a'], images: ['b'],
  });
  assert.deepEqual(request.tools, ['a']);
  assert.deepEqual(request.images, ['b']);
});
