import assert from 'node:assert/strict';
import test from 'node:test';
import { createChatStreamEventDecoder } from './chat-stream-events.mjs';

test('OpenAI tool-call arguments are aggregated across stream chunks', () => {
  const decoder = createChatStreamEventDecoder();
  const events = [
    ...decoder.decode({
      choices: [{ delta: { tool_calls: [{ index: 0, id: 'call-1', function: { name: 'echo', arguments: '{"value"' } }] } }],
    }),
    ...decoder.decode({
      choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: ':"ok"}' } }] }, finish_reason: 'tool_calls' }],
    }),
  ];

  assert.deepEqual(events, [
    { type: 'tool_call_start', toolCallId: 'call-1', index: 0, name: 'echo' },
    { type: 'tool_call_delta', toolCallId: 'call-1', index: 0, argumentsDelta: '{"value"' },
    { type: 'tool_call_delta', toolCallId: 'call-1', index: 0, argumentsDelta: ':"ok"}' },
    { type: 'tool_call_end', toolCallId: 'call-1', index: 0, name: 'echo', arguments: '{"value":"ok"}' },
  ]);
});

test('Gemini functionCall parts normalize to one complete tool call', () => {
  const decoder = createChatStreamEventDecoder();
  const events = decoder.decode({
    candidates: [{ content: { parts: [
      { text: 'thinking', thought: true },
      { functionCall: { name: 'echo', args: { value: 'ok' } } },
    ] } }],
  });

  assert.deepEqual(events, [
    { type: 'delta', channel: 'reasoning', content: 'thinking' },
    { type: 'tool_call_start', toolCallId: 'gemini-tool-1', index: 0, name: 'echo' },
    { type: 'tool_call_delta', toolCallId: 'gemini-tool-1', index: 0, argumentsDelta: '{"value":"ok"}' },
    { type: 'tool_call_end', toolCallId: 'gemini-tool-1', index: 0, name: 'echo', arguments: '{"value":"ok"}' },
  ]);
});

test('flush completes an unfinished tool call without parsing partial JSON', () => {
  const decoder = createChatStreamEventDecoder();
  decoder.decode({
    choices: [{ delta: { tool_calls: [{ index: 0, id: 'call-1', function: { name: 'echo', arguments: '{"value"' } }] } }],
  });
  assert.deepEqual(decoder.flush(), [
    { type: 'tool_call_end', toolCallId: 'call-1', index: 0, name: 'echo', arguments: '{"value"' },
  ]);
});
