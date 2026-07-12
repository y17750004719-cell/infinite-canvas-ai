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
    'routing_start',
    'intent_resolved',
    'skill_selected',
    'clarification_required',
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
  assert.match(source, /routeAgentRequest/);
  assert.match(source, /buildMainAgentMessages/);
  assert.match(source, /runAgentLoop/);
  assert.match(source, /getAgentModelTools/);
  assert.match(source, /maxTurns:\s*MAX_AGENT_TURNS/);
  assert.match(source, /maxToolCalls:\s*MAX_TOOL_CALLS/);
  assert.match(source, /onToolResult:\s*\(\{ id, name, result \}\)/);
  assert.match(source, /name === 'generate_image'[\s\S]{0,500}add_generated_assets/);
  assert.match(source, /source:\s*routingDecision\.source/);
  assert.match(source, /application\/x-ndjson/);
});

test('agent route uses one main-agent message hierarchy for text and referenced chat', () => {
  const source = fs.readFileSync(routePath, 'utf8');
  assert.match(source, /buildMainAgentMessages\(\{/);
  assert.match(source, /referenceImages:\s*body\.referenceImages/);
  assert.doesNotMatch(source, /if \(body\.referenceImages\?\.length\) \{[\s\S]{0,1200}generatePost/);
  assert.match(source, /if \(intent === 'image' && !selectedSkill\)/);
  assert.doesNotMatch(source, /if \(intent === 'skill_action'\)/);
  assert.match(source, /loadSkillContent\(selectedSkill\.id\)[\s\S]{0,1200}runAgentLoop\(\{/);
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
  assert.match(source, /loopResult\.confirmation\?\.toolName \|\| 'start_skill_job'/);
  assert.match(source, /toolArgs:/);
  assert.match(source, /allowedTools:/);
  assert.match(source, /body\.confirmation\?\.confirmationId/);
  assert.match(source, /confirmed:\s*true/);
  assert.match(source, /body\.imageOptions\?\.count/);
  assert.match(source, /本次将生成 \$\{body\.imageOptions\?\.count\} 张图片，确认后继续/);
  assert.doesNotMatch(source, /channel:\s*'reasoning'/);
});

test('agent route validates router provider and model overrides as one registry pair', () => {
  const source = fs.readFileSync(routePath, 'utf8');
  assert.match(source, /const requestedRouterSelection = resolveProviderModelSelection\(\{/);
  assert.match(source, /const resolvedRouterSelection = requestedRouterSelection\.reason === 'exact'/);
  assert.match(source, /requestedProviderId:\s*process\.env\.AGENT_ROUTER_PROVIDER_ID/);
  assert.match(source, /requestedModel:\s*process\.env\.AGENT_ROUTER_MODEL/);
  assert.match(source, /routerModel:\s*resolvedRouterSelection\.model/);
  assert.match(source, /providerId:\s*resolvedRouterSelection\.providerId/);
  assert.doesNotMatch(source, /routerModel:\s*process\.env\.AGENT_ROUTER_MODEL\s*\|\|/);
  assert.doesNotMatch(source, /providerId:\s*process\.env\.AGENT_ROUTER_PROVIDER_ID\s*\|\|/);
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
