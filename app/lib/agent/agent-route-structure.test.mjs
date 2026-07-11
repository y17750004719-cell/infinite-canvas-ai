import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const routePath = path.resolve(import.meta.dirname, '../../api/agent/route.ts');
const generateRoutePath = path.resolve(import.meta.dirname, '../../api/generate/route.ts');
const apiClientPath = path.resolve(import.meta.dirname, '../api-client.ts');

test('agent route exposes NDJSON orchestration events and reuses the generate route', () => {
  const source = fs.readFileSync(routePath, 'utf8');
  for (const eventType of [
    'agent_start',
    'intent_resolved',
    'skill_selected',
    'prompt_optimization_start',
    'prompt_optimization_done',
    'tool_start',
    'tool_result',
    'client_action',
    'assistant_delta',
    'agent_done',
    'agent_error',
  ]) {
    assert.match(source, new RegExp(`['\"]${eventType}['\"]`));
  }
  assert.match(source, /\/api\/generate/);
  assert.doesNotMatch(source, /fetch\(new URL\('\/api\/generate'/);
  assert.match(source, /generatePost/);
  assert.match(source, /executeAgentTool/);
  assert.match(source, /application\/x-ndjson/);
});

test('agent route enforces run and tool limits', () => {
  const source = fs.readFileSync(routePath, 'utf8');
  assert.match(source, /MAX_AGENT_TURNS\s*=\s*6/);
  assert.match(source, /MAX_TOOL_CALLS\s*=\s*4/);
  assert.match(source, /AbortSignal\.timeout/);
  assert.match(source, /confirmation_required/);
  assert.match(source, /randomUUID/);
  assert.match(source, /confirmationStore/);
  assert.match(source, /expiresAt/);
  assert.match(source, /execution/);
});

test('agent image requests opt into supplier cancellation while legacy requests stay detached', () => {
  const agentSource = fs.readFileSync(routePath, 'utf8');
  const generateSource = fs.readFileSync(generateRoutePath, 'utf8');
  assert.match(agentSource, /cancelWithRequest:\s*true/);
  assert.match(generateSource, /cancelWithRequest\?: boolean/);
  assert.match(generateSource, /signal:\s*cancelWithRequest \? request\.signal : undefined/);
  const apiClientSource = fs.readFileSync(apiClientPath, 'utf8');
  assert.match(apiClientSource, /Gemini official image request cancelled/);
});
