import test from 'node:test';
import assert from 'node:assert/strict';
import { readCommandResponse, formatCommandResult } from './command-client.mjs';
test('command reader accepts chunk-independent NDJSON and requires a result', async () => {
  const item = { command: 'status', result: { threadId: 't', turnCount: 2, lastSequence: 9 } };
  const parsed = await readCommandResponse(new Response(JSON.stringify({ type: 'item.completed', itemType: 'command_result', item })));
  assert.deepEqual(parsed.item, item);
  assert.match(formatCommandResult(item), /Turn 数：2/);
  await assert.rejects(readCommandResponse(new Response('{}')), /缺少结果/);
});
test('stale commands surface conflict without a success result', async () => {
  await assert.rejects(readCommandResponse(new Response(JSON.stringify({ error: 'stale', code: 'stale_operation' }), { status: 409 })), { code: 'stale_operation' });
});
