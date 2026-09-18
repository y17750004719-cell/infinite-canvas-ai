import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareAgentTurnContext } from './agent-context-preparation-service.mjs';
import {
  buildImageCompletionSummary,
  executeImageBatch,
  executeImagePipeline,
  persistImageAssets,
} from './agent-image-pipeline-service.mjs';
import { createAgentStreamOrchestrator } from './agent-stream-orchestrator.mjs';
import { createAgentRequestContextFlow } from './agent-request-context-flow.mjs';

test('request context flow owns migration and continuation gates before preparation', async () => {
  const calls = [];
  const flow = createAgentRequestContextFlow({
    loadThread: async () => ({ state: { contractVersion: 1, nativeCodex: { contractVersion: 1 } } }),
    prepare: async (input) => { calls.push(input); return { ok: true, value: { prepared: true } }; },
    contractVersion: 1,
  });
  const result = await flow.prepare({
    body: { messages: [{ role: 'user', content: 'hello' }], sessionId: 's' },
    sessionId: 's',
    latestUserMessage: 'hello',
  });
  assert.equal(result.ok, true);
  assert.equal(result.value.threadState.contractVersion, 1);
  assert.equal(calls.length, 1);
});

test('request context flow rejects legacy contracts before invoking preparation', async () => {
  let prepared = false;
  const flow = createAgentRequestContextFlow({
    loadThread: async () => ({ state: { nativeCodex: { contractVersion: 1 } } }),
    prepare: async () => { prepared = true; return { ok: true, value: {} }; },
    contractVersion: 2,
  });
  const result = await flow.prepare({
    body: { messages: [{ role: 'user', content: 'hello' }], sessionId: 's' },
    sessionId: 's',
    latestUserMessage: 'hello',
  });
  assert.equal(result.ok, false);
  assert.equal(result.response.status, 409);
  assert.equal(prepared, false);
});

test('context preparation returns a stable Native turn shape without side effects', async () => {
  const result = await prepareAgentTurnContext({
    request: { userText: 'hello' },
    compile: async () => ({ history: [{ role: 'user', content: 'hello' }], images: ['data:image/png;base64,AA=='], contextEntityIds: ['a', 'a'] }),
  });
  assert.equal(result.userText, 'hello');
  assert.deepEqual(result.contextEntityIds, ['a']);
  assert.equal(result.images.length, 1);
});

test('image pipeline normalizes requests and returns structured side-effect results', async () => {
  const result = await executeImagePipeline({
    request: { referenceIds: ['a', 'a'], operation: 'edit' },
    execute: async (request) => ({ assets: [{ id: 'asset-1' }], requestStats: { succeeded: 1 }, operation: request.operation }),
  });
  assert.equal(result.status, 'completed');
  assert.deepEqual(result.assets, [{ id: 'asset-1' }]);
});

test('image pipeline owns batch settlement while preserving request order', async () => {
  const completed = [];
  const results = await executeImageBatch({
    requests: [{ id: 'a' }, { id: 'b' }],
    executionMode: 'serial',
    runTask: async (request) => {
      completed.push(request.id);
      return { assets: [{ id: `asset-${request.id}` }] };
    },
  });
  assert.deepEqual(completed, ['a', 'b']);
  assert.equal(results.length, 2);
  assert.deepEqual(results.map((entry) => entry.status), ['fulfilled', 'fulfilled']);
});

test('image pipeline owns asset persistence and completion summary shaping', async () => {
  const persisted = await persistImageAssets({
    assets: [{ src: 'a' }, { src: 'b' }],
    persist: async (asset, index) => ({ id: `asset-${index}`, src: asset.src }),
  });
  assert.deepEqual(persisted.map((asset) => asset.id), ['asset-0', 'asset-1']);
  assert.deepEqual(buildImageCompletionSummary({
    presentation: { title: '生成完成', summary: '已生成图片' },
    requestStats: { succeeded: 2, failed: 1 },
  }), {
    title: '生成完成',
    summary: '已生成图片 结果已添加到画布。',
    operation: 'generate',
    succeeded: 2,
    failed: 1,
    addedToCanvas: true,
  });
});

test('stream orchestrator persists projected events before live delivery', async () => {
  const persisted = [];
  const chunks = [];
  const stream = createAgentStreamOrchestrator({
    journal: { appendThreadEvent: async (_threadId, event) => { persisted.push(event); return { ...event, sequence: persisted.length }; } },
    streamController: { enqueue: (chunk) => chunks.push(new TextDecoder().decode(chunk)) },
    context: { threadId: 'thread', turnId: 'turn', taskId: 'task', operationId: 'op', runId: 'run' },
  });
  await stream.publish({ type: 'agent_done', stopReason: 'completed' });
  await stream.flush();
  assert.equal(persisted[0].type, 'turn.completed');
  assert.equal(chunks.length, 1);
});
