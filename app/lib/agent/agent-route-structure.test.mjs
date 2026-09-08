import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const routePath = path.resolve(import.meta.dirname, '../../api/agent/route.ts');
const pagePath = path.resolve(import.meta.dirname, '../../page.tsx');
const instructionsPath = path.resolve(import.meta.dirname, 'native-agent-instructions.mjs');
const servicePath = path.resolve(import.meta.dirname, 'native-agent-service.ts');
const hostPath = path.resolve(import.meta.dirname, 'native-codex-host.mjs');
const ledgerPath = path.resolve(import.meta.dirname, 'native-business-ledger.mjs');
const contextPath = path.resolve(import.meta.dirname, 'context-reference.mjs');
const read = (file) => fs.readFileSync(file, 'utf8');

test('all chat modes use one native Codex App Server scheduling entry', () => {
  const route = read(routePath);
  const page = read(pagePath);
  assert.match(route, /import \{ runNativeAgentTurn \} from ['"]\.\.\/\.\.\/lib\/agent\/native-agent-service['"]/);
  assert.equal((route.match(/runNativeAgentTurn\(/g) || []).length, 1);
  assert.match(page, /const usesAgentRequest = true/);
  assert.doesNotMatch(route, /runZFlowAgentBrain|buildMainAgentLoopMessages|legacy\/tool-capable loop/);
  assert.doesNotMatch(route, /pi-agent-runtime|main-agent\.mjs/);
});

test('the route remains an authenticated streaming adapter with server-owned run identity', () => {
  const route = read(routePath);
  assert.match(route, /error: 'sessionId is required'/);
  assert.match(route, /const runId = randomUUID\(\)/);
  assert.match(route, /registerActiveAgentRun\(runId, initialAgentIdentity\)/);
  assert.match(route, /application\/x-ndjson/);
  assert.match(route, /writeLifecycleEvent/);
  assert.match(route, /code: 'stale_operation'/);
});

test('native service exposes only registered dynamic business tools and no execution environment', () => {
  const service = read(servicePath);
  assert.match(service, /const dynamicTools = input\.tools\.map/);
  assert.match(service, /type: 'function'/);
  assert.match(service, /environments: \[\]/);
  assert.match(service, /dynamicTools,/);
  assert.match(service, /experimentalRawEvents: true/);
  assert.match(service, /const definition = input\.tools\.find/);
  assert.match(service, /code: 'tool_not_allowed'/);
});

test('native host disables coding, plugins, web search, subagents, and native image generation', () => {
  const host = read(hostPath);
  for (const capability of ['shell_tool', 'unified_exec', 'code_mode', 'multi_agent', 'plugins', 'image_generation', 'web_search_request']) {
    assert.match(host, new RegExp(`'${capability}'`));
  }
  assert.match(host, /approval_policy = "never"/);
  assert.match(host, /sandbox_mode = "read-only"/);
  assert.match(host, /wire_api = "responses"/);
  assert.match(host, /request_max_retries = 0/);
  assert.match(host, /stream_max_retries = 0/);
});

test('business tools execute through the native callback and image side effects use the durable ledger', () => {
  const route = read(routePath);
  const ledger = read(ledgerPath);
  assert.match(route, /executeTool: async \(toolName, args, context\) =>/);
  assert.match(route, /executeAgentTool\(mainAgentRegistry, toolName, args/);
  assert.match(route, /executeNativeBusinessOperation\(\{/);
  assert.match(route, /tool:\s*'generate_image'/);
  assert.match(ledger, /contractHash = hashNativeBusinessContract\(contract\)/);
  assert.match(ledger, /if \(existing\.status === 'completed'\) return existing\.result/);
  assert.match(ledger, /Business operation result is unknown; explicit reconciliation is required/);
});

test('reference images are materialized, decoded, and sent as native structured image input', () => {
  const route = read(routePath);
  const host = read(hostPath);
  assert.match(route, /await materializeSessionVisualAsset\(\{/);
  assert.match(route, /await readSessionVisualAsset\(asset\)/);
  assert.match(route, /nativeImages\.push\(`data:\$\{asset\.mimeType\};base64,/);
  assert.match(route, /images: nativeImages/);
  assert.match(host, /input\.push\(\{ type: 'image', url: image \}\)/);
  assert.match(host, /parseImageDataUrl/);
  assert.match(host, /native_image_payload_invalid/);
});

test('ImageGen and a locked visual Skill are injected as verified native Skill inputs', () => {
  const route = read(routePath);
  const host = read(hostPath);
  assert.match(route, /id: IMAGEGEN_HOST_SKILL_ID/);
  assert.match(route, /\.\.\.\(selectedSkill && skillContent/);
  assert.match(route, /content: skillContent, hash: skillContentHash/);
  assert.match(host, /native_skill_hash_mismatch/);
  assert.match(host, /native_skill_context_limit/);
  assert.match(host, /input\.push\(\{ type: 'skill', name, path \}\)/);
});

test('model-selected visual Skills require high confidence and return complete locked rules', () => {
  const route = read(routePath);
  assert.match(route, /name: 'select_visual_skill'/);
  assert.match(route, /if \(args\.confidence !== 'high'\)/);
  assert.match(route, /const content = await loadSkillContent\(skill\.id\)/);
  assert.match(route, /content, contentHash: skillContentHash, truncated: false/);
  assert.doesNotMatch(route, /findDirectSkillMatches\(|selectSkillForPrompt\(/);
});

test('native public items are projected to the existing timeline without exposing raw response items', () => {
  const route = read(routePath);
  const service = read(servicePath);
  assert.match(route, /event\.method === 'item\/started'/);
  assert.match(route, /event\.method === 'item\/completed'/);
  assert.match(route, /type === 'dynamicToolCall'/);
  assert.match(route, /type === 'agentMessage'/);
  assert.match(service, /method: 'zflow\/model_sample_completed'/);
  assert.match(service, /PRIVATE_TEXT_PATTERN/);
});

test('HTTP disconnect is not wired directly to native cancellation', () => {
  const route = read(routePath);
  assert.doesNotMatch(route, /const runSignal = request\.signal/);
  assert.match(route, /registerActiveAgentRunControl/);
});

test('confirmation and recovery retain durable business identities', () => {
  const route = read(routePath);
  assert.match(route, /saveNativeConfirmation/);
  assert.match(route, /loadNativeConfirmation/);
  assert.match(route, /claimNativeConfirmation/);
  assert.match(route, /taskId, operationId, runId/);
  assert.match(route, /recoveryBaseRecord/);
  assert.match(route, /activeVersions/);
});

test('local context resolution uses explicit stable IDs rather than semantic history guessing', () => {
  const source = read(contextPath);
  const resolverStart = source.indexOf('export function resolveContextReference');
  const resolverEnd = source.indexOf('export function compileExecutionBrief', resolverStart);
  const resolver = source.slice(resolverStart, resolverEnd);
  assert.match(resolver, /selectedEntityIds\.includes\(entity\.id\)/);
  assert.doesNotMatch(resolver, /上一张图|刚才那张|reduce\(\(current, entity\)/);
});

test('native instructions require truthful public action descriptions before side effects', () => {
  const instructions = read(instructionsPath);
  assert.match(instructions, /Before tools, write a concise public commentary/);
  assert.match(instructions, /immediate goal, why the action is useful, and what you will do now/);
  assert.match(instructions, /never claim images exist before the tool returns saved asset IDs/);
  assert.match(instructions, /generate_image is the sole image execution boundary/);
});

test('obsolete Pi scheduling and custom first-tool truncation are absent from production sources', () => {
  const route = read(routePath);
  const service = read(servicePath);
  const combined = `${route}\n${service}`;
  assert.doesNotMatch(combined, /firstToolOnly|toolCalls\.slice\(0,\s*1\)|pendingToolCall\.batch/);
  assert.doesNotMatch(combined, /plannerRequestCount|Prompt Planner|runStagedImagePlanning/);
  assert.doesNotMatch(combined, /runZFlowAgentBrain|piTranscript/);
});
