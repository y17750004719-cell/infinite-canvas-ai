import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const source = fs.readFileSync(path.resolve(import.meta.dirname, 'api-client.ts'), 'utf8');

test('chat request and response types expose normalized tool calling', () => {
  assert.match(source, /export interface ChatToolDefinition/);
  assert.match(source, /tools\?: ChatToolDefinition\[\]/);
  assert.match(source, /tool_calls\?: ChatToolCall\[\]/);
  assert.match(source, /tool_call_id\?: string/);
  assert.match(source, /export type ChatToolChoice/);
  assert.match(source, /\{ type: 'function'; function: \{ name: string \} \}/);
});

test('openai compatible chat forwards tools and tool choice', () => {
  assert.match(source, /tools: request\.tools/);
  assert.match(source, /tool_choice: request\.toolChoice \|\| "auto"/);
});

test('gemini chat maps function declarations calls and responses', () => {
  assert.match(source, /functionDeclarations/);
  assert.match(source, /functionCall/);
  assert.match(source, /functionResponse/);
  assert.match(source, /toolConfig/);
  assert.match(source, /pendingToolResponses/);
  assert.match(source, /mode: 'ANY'/);
  assert.match(source, /allowedFunctionNames: \[toolChoice\.function\.name\]/);
  assert.match(source, /resolveGeminiFunctionCallingConfig\(request\.toolChoice\)/);
});
