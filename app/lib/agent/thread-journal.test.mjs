import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { appendThreadEvent, loadThread, queryThread, forkThread, updateThreadState, queueThreadInput, consumeThreadInputs, sanitizeJournalEvent } from './thread-journal.mjs';

const unique = () => `journal-${crypto.randomUUID()}`;
test('append recovers events ahead of snapshot before allocating sequence', async () => {
  const id = unique();
  await appendThreadEvent(id, { type: 'turn.started', turnId: 't', operationId: 'op', runId: 'r' });
  const snapshot = (await loadThread(id)).state;
  await appendThreadEvent(id, { type: 'item.updated', turnId: 't', itemId: 'a', itemType: 'assistant_message', item: { delta: '你好' } });
  await writeFile(path.join(process.cwd(), 'runtime/agent-threads', id, 'state.json'), JSON.stringify(snapshot));
  const event = await appendThreadEvent(id, { type: 'item.updated', turnId: 't', itemId: 'a', itemType: 'assistant_message', item: { delta: '世界' } });
  assert.equal(event.sequence, 3);
  const turn = (await loadThread(id)).state.turns[0];
  assert.equal(turn.items[0].content, '你好世界');
  assert.deepEqual(turn.runIds, ['r']);
});
test('thread commands do not change waiting turn or approval', async () => {
  const id = unique();
  await appendThreadEvent(id, { type: 'turn.started', turnId: 't' });
  await appendThreadEvent(id, { type: 'item.started', turnId: 't', itemId: 'approve', itemType: 'confirmation', item: { confirmationId: 'a' } });
  await appendThreadEvent(id, { type: 'turn.completed', turnId: 't', stopReason: 'awaiting_confirmation' });
  await appendThreadEvent(id, { type: 'item.completed', scope: 'thread', itemType: 'command_result', item: { command: 'status', result: {} } });
  const { state } = await loadThread(id);
  assert.equal(state.activeTurn, 't');
  assert.equal(state.turns.length, 1);
  assert.equal(state.turns[0].status, 'waiting');
  assert.equal(state.pendingApproval.confirmationId, 'a');
  await assert.rejects(forkThread(id), { statusCode: 409 });
  await assert.rejects(updateThreadState(id, { archived: true }), { statusCode: 409 });
});
test('UTF8 tail recovery preserves byte boundaries and forward replay pagination', async () => {
  const id = unique();
  await appendThreadEvent(id, { type: 'thread.started', message: '中文' });
  const filename = path.join(process.cwd(), 'runtime/agent-threads', id, 'events.jsonl');
  const good = await readFile(filename);
  await writeFile(filename, Buffer.concat([good, Buffer.from('{"损坏":')]));
  await loadThread(id);
  assert.deepEqual(await readFile(filename), good);
  for (let i = 0; i < 5; i++) await appendThreadEvent(id, { type: 'thread.started' });
  assert.deepEqual((await queryThread(id, { afterSequence: 1, limit: 2 })).events.map((e) => e.sequence), [2, 3]);
});
test('fork copies completed public items and todo without execution calls', async () => {
  const id = unique();
  await appendThreadEvent(id, { type: 'turn.started', turnId: 't' });
  await appendThreadEvent(id, { type: 'item.completed', turnId: 't', itemId: 'a', itemType: 'assistant_message', item: { content: 'Ready' } });
  await appendThreadEvent(id, { type: 'item.completed', turnId: 't', itemId: 'tool', itemType: 'tool_call', item: { toolName: 'generate_image' } });
  await appendThreadEvent(id, { type: 'item.completed', turnId: 't', itemId: 'todo', itemType: 'todo_list', item: { items: [{ id: 'a', content: 'Done', status: 'completed' }] } });
  await appendThreadEvent(id, { type: 'turn.completed', turnId: 't' });
  const fork = await forkThread(id);
  assert.equal(fork.turns[0].items.length, 2);
  assert.equal(fork.todoItems[0].content, 'Done');
  assert.notEqual(fork.turns[0].turnId, 't');
  await updateThreadState(id, { archived: true });
  await assert.rejects(appendThreadEvent(id, { type: 'turn.started', turnId: 'new' }), { code: 'thread_archived' });
});
test('invalid path identities are rejected instead of mapped to another thread', async () => {
  for (const id of ['..', '../escape', 'a/b', '', 'x'.repeat(201)]) await assert.rejects(loadThread(id), { code: 'invalid_identity' });
});

test('durable steer and follow-up inputs are bound to the active run and consumed once', async () => {
  const id = unique();
  const identity = { turnId: 'turn', taskId: 'task', operationId: 'operation', runId: 'run' };
  await appendThreadEvent(id, { type: 'turn.started', ...identity });
  await queueThreadInput(id, { ...identity, delivery: 'steer', input: 'make it brighter', referenceIds: ['asset-1'] });
  await queueThreadInput(id, { ...identity, delivery: 'steer', input: 'make it more contrasty' });
  await queueThreadInput(id, { ...identity, delivery: 'follow_up', input: 'then make it warmer' });
  assert.deepEqual((await loadThread(id)).state.queuedInputs.map((entry) => entry.delivery), ['steer', 'steer', 'follow_up']);
  assert.equal((await consumeThreadInputs(id, identity, 'steer'))[0].input, 'make it brighter');
  assert.equal((await consumeThreadInputs(id, identity, 'steer'))[0].input, 'make it more contrasty');
  assert.deepEqual((await consumeThreadInputs(id, identity, 'steer')), []);
  assert.equal((await consumeThreadInputs(id, identity, 'follow_up'))[0].input, 'then make it warmer');
  await assert.rejects(queueThreadInput(id, { ...identity, operationId: 'stale', input: 'wrong' }), { code: 'stale_operation' });
});

test('journal sanitization keeps public progress and stable asset URLs while removing private payloads recursively', async () => {
  const { event } = sanitizeJournalEvent({
    type: 'item.updated', threadId: 'thread-1', turnId: 'turn-1', taskId: 'task-1', operationId: 'op-1', runId: 'run-1', sequence: 1, timestampMs: 1,
    itemId: 'item-1', itemType: 'tool_call', item: {
      status: 'running', message: 'Generating preview', assetUrl: '/api/assets/asset-1', stableUrl: 'https://cdn.example.test/a.png',
      args: { prompt: 'private prompt', apiKey: 'secret' },
      nested: { providerPayload: { authorization: 'Bearer secret' }, dataUrl: 'data:image/png;base64,AAAA', transcript: 'hidden' },
      recovery: { status: 'retryable', summary: 'safe recovery summary', checkpoint: { completedCount: 1, arguments: { prompt: 'do not persist' } } },
    },
    transcriptSummary: 'public summary',
  });
  assert.equal(event.item.itemId, 'item-1');
  assert.equal(event.item.status, 'running');
  assert.equal(event.item.assetUrl, '/api/assets/asset-1');
  assert.equal(event.item.stableUrl, 'https://cdn.example.test/a.png');
  assert.equal(event.item.recovery.summary, 'safe recovery summary');
  assert.equal(event.item.args, '[execution payload omitted]');
  assert.equal(event.item.nested.providerPayload, undefined);
  assert.equal(event.item.nested.dataUrl, undefined);
  assert.equal(event.item.nested.transcript, undefined);
  assert.equal(event.transcriptSummary, 'public summary');
  assert.equal(event.persistence.executablePayloadPersisted, false);
});

test('journal event persistence is bounded and remains valid JSON for untrusted large values', async () => {
  const large = 'x'.repeat(200_000);
  const { event, serialized } = sanitizeJournalEvent({
    type: 'item.completed', threadId: 'thread-2', turnId: 'turn-2', taskId: 'task-2', operationId: 'op-2', runId: 'run-2', sequence: 1, timestampMs: 1,
    itemId: 'item-2', itemType: 'tool_result', item: { content: large, result: { output: large }, rows: Array.from({ length: 500 }, () => ({ content: large })) },
  });
  assert.doesNotThrow(() => JSON.parse(serialized));
  assert.ok(Buffer.byteLength(serialized, 'utf8') <= 64 * 1024);
  assert.equal(event.itemId, 'item-2');
  assert.equal(event.sequence, 1);
});

test('append persists sanitized event rather than raw provider data', async () => {
  const id = unique();
  const event = await appendThreadEvent(id, { type: 'thread.started', providerPayload: { apiKey: 'secret' }, message: 'ready' });
  assert.equal(event.message, 'ready');
  assert.equal(event.providerPayload, undefined);
  const persisted = (await queryThread(id)).events[0];
  assert.equal(persisted.providerPayload, undefined);
  assert.equal(persisted.persistence.sanitized, true);
});

test('a transcript boundary preserves the journal while excluding completed earlier turns', async () => {
  const id = unique();
  await appendThreadEvent(id, { type: 'turn.started', turnId: 'old' });
  await appendThreadEvent(id, { type: 'turn.completed', turnId: 'old' });
  const beforeClear = (await loadThread(id)).state.lastSequence;
  await updateThreadState(id, { transcriptStartSequence: beforeClear + 1 });
  await appendThreadEvent(id, { type: 'turn.started', turnId: 'new' });
  const state = (await loadThread(id)).state;
  assert.equal(state.transcriptStartSequence, beforeClear + 1);
  assert.ok(state.turns.find((turn) => turn.turnId === 'new').startSequence >= state.transcriptStartSequence);
  assert.equal((await queryThread(id)).events.length, 3);
});

test('journal appends canonical identities and recovers state', async () => {
  const threadId = `t1-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const first = await appendThreadEvent(threadId, { type: 'thread.started' });
  const second = await appendThreadEvent(threadId, { type: 'turn.started', turnId: 'turn-1', operationId: 'op-1', runId: 'run-1' });
  assert.equal(first.sequence, 1); assert.equal(second.sequence, 2);
  assert.equal((await loadThread(threadId)).state.activeTurn, 'turn-1');
  assert.equal((await loadThread(threadId)).state.lastSequence, 2);
  assert.equal((await queryThread(threadId, { afterSequence: 1 })).events.length, 1);
});

test('truncates malformed journal tail', async () => {
  const threadId = `corrupt-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const dir = path.join(process.cwd(), 'runtime', 'agent-threads', threadId);
  await (await import('node:fs/promises')).mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, 'events.jsonl'), '{"type":"thread.started","sequence":1}\n{"bad"\n', 'utf8');
  assert.equal((await queryThread(threadId)).events.length, 1);
  assert.equal((await readFile(path.join(dir, 'events.jsonl'), 'utf8')).trim(), '{"type":"thread.started","sequence":1}');
});

test('archive and fork completed thread', async () => {
  const threadId = `source-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  await appendThreadEvent(threadId, { type: 'turn.started', turnId: 'a' });
  await appendThreadEvent(threadId, { type: 'turn.completed', turnId: 'a', usage: null });
});
