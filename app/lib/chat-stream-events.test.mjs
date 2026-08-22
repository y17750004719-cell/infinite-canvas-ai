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
      { functionCall: { name: 'echo', args: { value: 'ok' } }, thoughtSignature: 'sig-echo-1' },
    ] } }],
  });

  assert.deepEqual(events, [
    { type: 'delta', channel: 'reasoning', content: 'thinking' },
    { type: 'tool_call_start', toolCallId: 'gemini-tool-1', index: 0, name: 'echo' },
    { type: 'tool_call_delta', toolCallId: 'gemini-tool-1', index: 0, argumentsDelta: '{"value":"ok"}' },
  ]);
  assert.deepEqual(decoder.flush(), [
    { type: 'tool_call_end', toolCallId: 'gemini-tool-1', index: 0, name: 'echo', arguments: '{"value":"ok"}', thoughtSignature: 'sig-echo-1' },
    { type: 'gemini_parts', parts: [
      { text: 'thinking', thought: true },
      { functionCall: { name: 'echo', args: { value: 'ok' } }, thoughtSignature: 'sig-echo-1' },
    ] },
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

test('Gemini stream preserves ordered raw parts across chunks and reuses the call ID', () => {
  const decoder = createChatStreamEventDecoder();
  const first = decoder.decode({
    candidates: [{ content: { parts: [
      { text: 'think', thought: true, thoughtSignature: 'sig-thinking' },
    ] } }],
  });
  const second = decoder.decode({
    candidates: [{ content: { parts: [
      { text: 'ing', thought: true },
      { functionCall: { name: 'echo', args: { value: 'o' } }, thoughtSignature: 'sig-call' },
    ] } }],
  });
  const third = decoder.decode({
    candidates: [{ content: { parts: [
      { functionCall: { name: 'echo', args: { suffix: 'k' } } },
    ] } }],
  });
  const flushed = decoder.flush();

  assert.equal(first.filter((event) => event.type === 'tool_call_start').length, 0);
  assert.equal(second.filter((event) => event.type === 'tool_call_start').length, 1);
  assert.equal(third.filter((event) => event.type === 'tool_call_start').length, 0);
  const raw = flushed.find((event) => event.type === 'gemini_parts');
  assert.deepEqual(raw.parts, [
    { text: 'thinking', thought: true, thoughtSignature: 'sig-thinking' },
    { functionCall: { name: 'echo', args: { value: 'o', suffix: 'k' } }, thoughtSignature: 'sig-call' },
  ]);
});

test('Gemini stream attaches metadata-only signature chunks to the previous Part', () => {
  const decoder = createChatStreamEventDecoder();
  decoder.decode({ candidates: [{ content: { parts: [
    { functionCall: { name: 'echo', args: { value: 'ok' } } },
  ] } }] });
  decoder.decode({ candidates: [{ content: { parts: [
    { thought_signature: 'sig-late' },
  ] } }] });
  const raw = decoder.flush().find((event) => event.type === 'gemini_parts');
  assert.deepEqual(raw.parts, [{
    functionCall: { name: 'echo', args: { value: 'ok' } },
    thoughtSignature: 'sig-late',
  }]);
});
