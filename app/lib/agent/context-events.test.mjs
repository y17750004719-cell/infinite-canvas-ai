import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildReplayableContext,
  compactContext,
  compactContextAsync,
  contextEventFromAgentEvent,
  aggregateAssistantTextEvents,
  normalizeToolCallPairs,
  estimateContextTokens,
  migrateMessagesToContextEvents,
  normalizeCompactedWindows,
  replayContextEvents,
  buildResponseItems,
  validateCompactionSummary,
} from './context-events.mjs';

test('modelEvents is the active replay source while auditEvents remains complete', () => {
  const replay = buildReplayableContext({
    sessionId: 's1',
    auditEvents: [{ eventId: 'old', sessionId: 's1', sequence: 1, type: 'user_text', source: 'audit', content: 'old' }],
    modelEvents: [{ eventId: 'new', sessionId: 's1', sequence: 2, type: 'user_text', source: 'model', content: 'new' }],
  });
  assert.deepEqual(replay.events.map((event) => event.eventId), ['new']);
  assert.deepEqual(replay.auditEvents.map((event) => event.eventId), ['old']);
  assert.deepEqual(replayContextEvents(replay), [{ role: 'user', content: 'new' }]);
});

test('provider-neutral response items preserve tool and image semantics', () => {
  const items = buildResponseItems({ sessionId: 's1', events: [
    { eventId: 'u', sessionId: 's1', sequence: 1, type: 'user_text', content: 'look' },
    { eventId: 'i', sessionId: 's1', sequence: 2, type: 'image_input', assetId: 'asset-1' },
    { eventId: 'c', sessionId: 's1', sequence: 3, type: 'tool_call', toolCallId: 'call-1', toolName: 'inspect', arguments: { x: 1 } },
    { eventId: 'r', sessionId: 's1', sequence: 4, type: 'tool_result', toolCallId: 'call-1', result: { ok: true } },
    { eventId: 'o', sessionId: 's1', sequence: 5, type: 'image_output', toolCallId: 'call-1', assetId: 'asset-2' },
  ] });
  assert.deepEqual(items.map((item) => item.type), ['text', 'local_image', 'tool_call', 'tool_result', 'tool_result_image']);
  assert.equal(items[2].callId, 'call-1');
  assert.equal(items[4].assetId, 'asset-2');
});

test('compaction summary validation rejects malformed payloads', () => {
  assert.equal(validateCompactionSummary({ task: 'x', constraints: [] }), null);
  assert.equal(validateCompactionSummary({ task: 'x', constraints: [], decisions: [], completedActions: [], pendingActions: [], toolFacts: [], imageAssets: [] }).task, 'x');
});

test('assistant streaming deltas aggregate within a turn', () => {
  const events = aggregateAssistantTextEvents([
    { type: 'assistant_text', eventId: 'a1', sequence: 1, turnId: 't1', content: '你' },
    { type: 'assistant_text', eventId: 'a2', sequence: 2, turnId: 't1', content: '好' },
    { type: 'assistant_text', eventId: 'a3', sequence: 3, turnId: 't2', content: '新的回合' },
  ]);
  assert.deepEqual(events.map((event) => event.content), ['你好', '新的回合']);
  assert.equal(events[0].endSequence, 2);
});

test('tool normalization removes orphan results and repairs unfinished calls', () => {
  const events = normalizeToolCallPairs([
    { eventId: 'orphan', sessionId: 's1', sequence: 1, type: 'tool_result', source: 'test', toolCallId: 'missing', result: 'x' },
    { eventId: 'call', sessionId: 's1', sequence: 2, type: 'tool_call', source: 'test', toolCallId: 'pending', toolName: 'inspect', arguments: {} },
  ], { sessionId: 's1' });
  assert.deepEqual(events.map((event) => event.type), ['tool_call', 'tool_result']);
  assert.equal(events[1].toolCallId, 'pending');
  assert.equal(events[1].result.status, 'aborted');
});

test('agent lifecycle events map to replayable context event types with stable identity', () => {
  const input = {
    type: 'tool_start',
    runId: 'run-1',
    sequence: 7,
    toolCallId: 'call-1',
    toolName: 'read_context',
    arguments: { scope: 'project' },
  };
  const first = contextEventFromAgentEvent(input, { sessionId: 'session-1' });
  const second = contextEventFromAgentEvent(input, { sessionId: 'session-1' });
  assert.equal(first.type, 'tool_call');
  assert.equal(first.sessionId, 'session-1');
  assert.equal(first.sequence, 7);
  assert.equal(first.eventId, second.eventId);
  assert.deepEqual(first.arguments, { scope: 'project' });
});

test('agent interactions, failures, and cancellation map without leaking binary data', () => {
  const longText = 'x'.repeat(13_000);
  const mapped = [
    contextEventFromAgentEvent({
      type: 'tool_result', runId: 'run-1', sequence: 8, toolCallId: 'call-1',
      toolName: 'read_context', result: { text: longText, image: 'data:image/png;base64,secret' },
    }, { sessionId: 'session-1' }),
    contextEventFromAgentEvent({
      type: 'confirmation_required', runId: 'run-1', sequence: 9,
      request: { confirmationId: 'confirm-1', prompt: longText },
    }, { sessionId: 'session-1' }),
    contextEventFromAgentEvent({
      type: 'clarification_required', runId: 'run-1', sequence: 10,
      request: { id: 'clarify-1', question: '选择哪张图？' }, state: { secret: 'data:text/plain;base64,secret' },
    }, { sessionId: 'session-1' }),
    contextEventFromAgentEvent({
      type: 'agent_error', runId: 'run-1', sequence: 11,
      stage: 'image_pipeline', code: 'invalid_reference', message: longText,
    }, { sessionId: 'session-1' }),
    contextEventFromAgentEvent({
      type: 'agent_cancelled', runId: 'run-1', sequence: 12, message: 'cancelled',
    }, { sessionId: 'session-1' }),
  ];
  assert.deepEqual(mapped.map((event) => event.type), ['tool_result', 'confirmation', 'clarification', 'error', 'recovery']);
  assert.equal(mapped[0].result.text.endsWith('[truncated]'), true);
  assert.equal(mapped[0].result.image, '[binary omitted]');
  assert.equal(mapped[1].request.prompt.endsWith('[truncated]'), true);
  assert.equal(mapped[2].state.secret, '[binary omitted]');
  assert.equal(mapped[3].reason, 'invalid_reference');
  assert.equal(mapped[4].status, 'cancelled');
});

test('generated asset client actions become image output events with stable asset ids', () => {
  const events = contextEventFromAgentEvent({
    type: 'client_action',
    runId: 'run-2',
    sequence: 20,
    action: {
      type: 'add_generated_assets',
      taskId: 'task-1',
      batchId: 'batch-1',
      assets: [
        { assetId: 'asset-1', src: '/api/session-visual-assets/asset-1', previewSrc: '/preview/asset-1', versionId: 'v1' },
        { id: 'asset-2', src: 'data:image/png;base64,secret' },
        { src: '' },
      ],
    },
  }, { sessionId: 'session-1' });
  assert.deepEqual(events.map((event) => ({
    type: event.type,
    assetId: event.assetId,
    src: event.src,
    taskId: event.taskId,
    batchId: event.batchId,
  })), [
    { type: 'image_output', assetId: 'asset-1', src: '/api/session-visual-assets/asset-1', taskId: 'task-1', batchId: 'batch-1' },
    { type: 'image_output', assetId: 'asset-2', src: undefined, taskId: 'task-1', batchId: 'batch-1' },
  ]);
  assert.notEqual(events[0].eventId, events[1].eventId);
});

test('legacy messages migrate idempotently and preserve image position', () => {
  const events = migrateMessagesToContextEvents([
    { role: 'user', content: '第一轮', referenceContext: { references: [{ id: 'r1', src: '/api/session-visual-assets/asset-1', assetId: 'asset-1' }] } },
    { role: 'assistant', content: '收到' },
  ], { sessionId: 's1' });
  assert.deepEqual(events.map((event) => event.type), ['user_text', 'image_input', 'assistant_text']);
  assert.deepEqual(replayContextEvents({ events }), [
    { role: 'user', content: [{ type: 'text', text: '第一轮' }, { type: 'image_url', image_url: { url: '/api/session-visual-assets/asset-1' } }] },
    { role: 'assistant', content: '收到' },
  ]);
  assert.equal(migrateMessagesToContextEvents([], { sessionId: 's1' }).length, 0);
});

test('legacy base64 image data is not persisted or replayed to the provider', () => {
  const events = migrateMessagesToContextEvents([
    { role: 'user', content: '图片', referenceContext: { references: [{ id: 'r1', src: 'data:image/png;base64,secret', assetId: 'asset-1' }] } },
  ], { sessionId: 's1' });
  assert.equal(events[1].src, undefined);
  assert.deepEqual(replayContextEvents({ events, visualAssets: [{ id: 'asset-1', sessionId: 's1', durableSrc: '/api/session-visual-assets/asset-1', contentHash: 'hash', mimeType: 'image/png', byteSize: 1, source: 'upload', createdAt: 1 }] }), [
    { role: 'user', content: [{ type: 'text', text: '图片' }, { type: 'image_url', image_url: { url: '/api/session-visual-assets/asset-1' } }] },
  ]);
});

test('compactContext keeps recent events and records bounded window state', () => {
  const replay = buildReplayableContext({ sessionId: 's1', events: Array.from({ length: 12 }, (_, i) => ({ eventId: `e${i}`, sessionId: 's1', sequence: i + 1, type: 'user_text', source: 'test', content: 'x'.repeat(200) })) });
  const compacted = compactContext(replay, { model: 'test-model', contextWindow: 200, reserveTokens: 32, threshold: 0.5, keepRecent: 3 });
  assert.equal(compacted.activeWindow.compactCount, 1);
  assert.equal(compacted.activeWindow.model, 'test-model');
  assert.equal(compacted.events.at(-1).eventId, 'e11');
  assert.ok(compacted.compactedWindows[0].summary.includes('user_text'));
  assert.ok(estimateContextTokens(compacted.events) < estimateContextTokens(replay.events));
});

test('compactContext gates on the complete provider budget, including system, tools, visuals, and reserves', () => {
  const replay = buildReplayableContext({
    sessionId: 'budget-session',
    events: [
      { eventId: 'u1', sessionId: 'budget-session', sequence: 1, type: 'user_text', source: 'test', content: 'x'.repeat(500) },
      { eventId: 'i1', sessionId: 'budget-session', sequence: 2, type: 'image_input', source: 'test', assetId: 'asset-1', naturalWidth: 1024, naturalHeight: 1024 },
    ],
  });
  const compacted = compactContext(replay, {
    contextWindow: 1200,
    outputReserve: 100,
    fallbackReserve: 100,
    systemPrompt: 'system '.repeat(300),
    tools: [{ name: 'inspect', description: 'tool '.repeat(60), parameters: { type: 'object', properties: {} } }],
    threshold: 0.75,
    keepRecent: 1,
  });
  assert.equal(compacted.activeWindow.compactCount, 1);
  assert.ok(compacted.tokenBudget.systemTokens > 0);
  assert.ok(compacted.tokenBudget.toolDefinitionTokens > 0);
  assert.ok(compacted.tokenBudget.visualTokens >= 256);
  assert.equal(compacted.tokenBudget.outputReserve, 100);
  assert.equal(compacted.tokenBudget.fallbackReserve, 100);
});

test('context replay rejects events owned by another session', () => {
  const replay = buildReplayableContext({
    sessionId: 'session-a',
    events: [
      { eventId: 'a', sessionId: 'session-a', sequence: 1, type: 'user_text', source: 'test', content: 'keep' },
      { eventId: 'b', sessionId: 'session-b', sequence: 2, type: 'user_text', source: 'test', content: 'drop' },
    ],
  });
  assert.deepEqual(replay.events.map((event) => event.eventId), ['a']);
});

test('context replay rejects compact windows owned by another session', () => {
  const windows = normalizeCompactedWindows([
    { version: 1, sessionId: 'session-a', summary: 'keep' },
    { version: 2, sessionId: 'session-b', summary: 'drop' },
    { version: 3, summary: 'adopt' },
  ], 'session-a');
  assert.deepEqual(windows.map((window) => [window.version, window.sessionId]), [
    [1, 'session-a'],
    [3, 'session-a'],
  ]);
});

test('compactContext does not add an empty summary event when all events are retained', () => {
  const replay = buildReplayableContext({
    sessionId: 'session-a',
    events: [
      { eventId: 'e1', sessionId: 'session-a', sequence: 1, type: 'user_text', source: 'test', content: 'x'.repeat(5000) },
    ],
  });
  const compacted = compactContext(replay, { contextWindow: 1024, reserveTokens: 0, threshold: 0.5, keepRecent: 8 });
  assert.deepEqual(compacted.events.map((event) => event.eventId), ['e1']);
  assert.equal(compacted.compactedWindows.length, 1);
});

test('compaction summaries remain boundary events and replay as system context', () => {
  const compacted = compactContext({
    sessionId: 'session-summary',
    events: [
      { eventId: 'u1', sessionId: 'session-summary', sequence: 1, type: 'user_text', source: 'test', content: 'x'.repeat(5000) },
      { eventId: 'a1', sessionId: 'session-summary', sequence: 2, type: 'assistant_text', source: 'test', content: 'done' },
    ],
  }, { contextWindow: 1024, reserveTokens: 128, threshold: 0.5, keepRecent: 1 });
  const summary = compacted.modelEvents.find((event) => event.source === 'compact_summary');
  assert.ok(summary);
  assert.equal(summary.type, 'compaction');
  const replayed = replayContextEvents(compacted);
  assert.ok(replayed.some((message) => message.role === 'system' && /compacted/i.test(message.content)));
});

test('compactContextAsync replaces only the newest summary and preserves prior records', async () => {
  const replay = {
    sessionId: 'session-async',
    events: Array.from({ length: 12 }, (_, index) => ({
      eventId: `e-${index}`,
      sessionId: 'session-async',
      sequence: index + 1,
      type: 'user_text',
      source: 'test',
      content: 'long context '.repeat(20),
    })),
    compactionRecords: [{
      compactionId: 'old', sessionId: 'session-async', fromSequence: 1, toSequence: 2,
      summaryVersion: 1, summary: {}, model: 'm', contextWindow: 100, inputTokens: 1, outputTokens: 1, createdAt: 1,
    }],
    activeWindow: { sessionId: 'session-async', startSequence: 1, endSequence: 12, compactCount: 1, summaryVersion: 1, estimatedTokens: 1, model: 'm', contextWindow: 100 },
  };
  const compacted = await compactContextAsync(replay, {
    model: 'm', contextWindow: 100, reserveTokens: 20, threshold: 0.1, keepRecent: 2,
    summarize: async () => ({ task: 'new', constraints: [], decisions: [], completedActions: [], pendingActions: [], toolFacts: [], imageAssets: [] }),
  });
  assert.equal(compacted.compactionRecords.length, 2);
  assert.equal(compacted.compactionRecords[0].compactionId, 'old');
  assert.deepEqual(compacted.compactionRecords.at(-1).structuredSummary, { task: 'new', constraints: [], decisions: [], completedActions: [], pendingActions: [], toolFacts: [], imageAssets: [] });
});

test('replayable context carries compact state across requests', () => {
  const replay = buildReplayableContext({
    sessionId: 'session-a',
    events: [{ eventId: 'a', sessionId: 'session-a', sequence: 1, type: 'user_text', source: 'test', content: 'hello' }],
    compactedWindows: [{ version: 1, summary: 'older' }],
    activeWindow: { sessionId: 'session-a', startSequence: 1, endSequence: 1, compactCount: 1, summaryVersion: 1, estimatedTokens: 4, model: 'm', contextWindow: 100 },
  });
  assert.equal(replay.compactedWindows.length, 1);
  assert.equal(replay.activeWindow.compactCount, 1);
});

test('replayable context appends newly submitted messages without duplicating history', () => {
  const replay = buildReplayableContext({
    sessionId: 'session-a',
    mergeMessages: true,
    events: [{ eventId: 'old', sessionId: 'session-a', sequence: 1, type: 'user_text', source: 'persisted', content: 'old' }],
    messages: [
      { role: 'user', content: 'old' },
      { role: 'user', content: 'new', referenceContext: { references: [{ id: 'asset-ref', src: 'https://example.test/image.png', assetId: 'asset-1' }] } },
    ],
  });
  assert.deepEqual(replay.events.map((event) => event.content || event.assetId), ['old', 'new', 'asset-1']);
  assert.deepEqual(replay.events.map((event) => event.sequence), [1, 2, 3]);
});

test('replayable context does not duplicate the latest message after lifecycle events', () => {
  const replay = buildReplayableContext({
    sessionId: 'session-a',
    mergeMessages: true,
    events: [
      { eventId: 'u1', sessionId: 'session-a', sequence: 1, type: 'user_text', source: 'persisted', content: '生成图片' },
      { eventId: 'a1', sessionId: 'session-a', sequence: 2, type: 'assistant_text', source: 'persisted', content: '已生成' },
      { eventId: 'img1', sessionId: 'session-a', sequence: 3, type: 'image_output', source: 'runtime', assetId: 'asset-1' },
    ],
    messages: [
      { role: 'user', content: '生成图片' },
      { role: 'assistant', content: '已生成' },
    ],
  });
  assert.deepEqual(replay.events.map((event) => event.type), ['user_text', 'assistant_text', 'image_output']);
});

test('replay preserves tool call/result protocol messages', () => {
  const messages = replayContextEvents({
    events: [
      { eventId: 'u1', sessionId: 's1', sequence: 1, type: 'user_text', source: 'test', content: '查一下' },
      { eventId: 'c1', sessionId: 's1', sequence: 2, type: 'tool_call', source: 'test', toolCallId: 'call-1', toolName: 'read_context', arguments: { scope: 'project' } },
      { eventId: 'r1', sessionId: 's1', sequence: 3, type: 'tool_result', source: 'test', toolCallId: 'call-1', toolName: 'read_context', result: { ok: true } },
    ],
  });
  assert.deepEqual(messages.slice(1), [
    { role: 'assistant', content: '', tool_calls: [{ id: 'call-1', type: 'function', function: { name: 'read_context', arguments: '{"scope":"project"}' } }] },
    { role: 'tool', tool_call_id: 'call-1', name: 'read_context', content: '{"ok":true}' },
  ]);
});

test('compact keeps a tool call when its result is in the recent window', () => {
  const replay = buildReplayableContext({
    sessionId: 's1',
    events: [
      { eventId: 'u1', sessionId: 's1', sequence: 1, type: 'user_text', source: 'test', content: 'x'.repeat(800) },
      { eventId: 'c1', sessionId: 's1', sequence: 2, type: 'tool_call', source: 'test', toolCallId: 'call-1', toolName: 'read_context', arguments: {} },
      { eventId: 'r1', sessionId: 's1', sequence: 3, type: 'tool_result', source: 'test', toolCallId: 'call-1', toolName: 'read_context', result: { ok: true } },
      { eventId: 'u2', sessionId: 's1', sequence: 4, type: 'user_text', source: 'test', content: '继续' },
    ],
  });
  const compacted = compactContext(replay, { contextWindow: 1024, reserveTokens: 0, threshold: 0.1, keepRecent: 2 });
  const types = compacted.events.map((event) => event.type);
  assert.ok(types.includes('tool_call'));
  assert.ok(types.includes('tool_result'));
  assert.ok(compacted.events.findIndex((event) => event.type === 'tool_call') < compacted.events.findIndex((event) => event.type === 'tool_result'));
});
