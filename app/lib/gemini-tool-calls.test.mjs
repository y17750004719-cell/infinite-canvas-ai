import test from 'node:test';
import assert from 'node:assert/strict';

import { extractGeminiToolCalls, geminiToolCallToPart, replayGeminiParts } from './gemini-tool-calls.mjs';

test('non-stream Gemini tool responses preserve thought signatures', () => {
  const signature = 'sig-non-stream-1';
  const calls = extractGeminiToolCalls([
    { text: 'thinking', thought: true },
    {
      functionCall: { name: 'read_imagegen_context', args: {} },
      thoughtSignature: signature,
    },
  ]);

  assert.deepEqual(calls, [{
    id: 'gemini-tool-2',
    type: 'function',
    thoughtSignature: signature,
    function: { name: 'read_imagegen_context', arguments: '{}' },
  }]);
  assert.deepEqual(geminiToolCallToPart(calls[0]), {
    functionCall: { name: 'read_imagegen_context', args: {} },
    thoughtSignature: signature,
  });
});

test('tool calls without a signature do not receive one', () => {
  assert.deepEqual(geminiToolCallToPart({
    function: { name: 'echo', arguments: '{"value":"ok"}' },
  }), {
    functionCall: { name: 'echo', args: { value: 'ok' } },
  });
});

test('Gemini function calls keep explicit IDs and generate a stable fallback ID', () => {
  assert.deepEqual(extractGeminiToolCalls([
    { functionCall: { id: 'provider-call-7', name: 'echo', args: { value: 'ok' } } },
  ]), [{
    id: 'provider-call-7',
    type: 'function',
    function: { name: 'echo', arguments: '{"value":"ok"}' },
  }]);
});

test('Gemini signatures are stripped when replaying Parts across models', () => {
  assert.deepEqual(replayGeminiParts([
    { text: 'internal summary', thought: true, thoughtSignature: 'sig-1' },
    { functionCall: { id: 'call-1', name: 'echo', args: {} }, thoughtSignature: 'sig-2' },
  ], 'gemini-3.1-flash', 'gemini-2.5-flash'), [
    { text: 'internal summary' },
    { functionCall: { id: 'call-1', name: 'echo', args: {} } },
  ]);
});

test('Gemini signatures are stripped when the source model is unknown', () => {
  assert.deepEqual(replayGeminiParts([
    { text: 'internal summary', thought: true, thoughtSignature: 'sig-1' },
    { functionCall: { name: 'echo', args: {} }, thoughtSignature: 'sig-2' },
  ], '', 'gemini-3.7-flash'), [
    { text: 'internal summary' },
    { functionCall: { name: 'echo', args: {} } },
  ]);
});
