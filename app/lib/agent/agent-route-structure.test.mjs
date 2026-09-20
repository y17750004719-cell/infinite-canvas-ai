import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const routePath = path.resolve(import.meta.dirname, 'agent-request-runtime.ts');
const controllerPath = path.resolve(import.meta.dirname, 'agent-request-controller.ts');
const pagePath = path.resolve(import.meta.dirname, '../../page.tsx');
const instructionsPath = path.resolve(import.meta.dirname, 'native-agent-instructions.mjs');
const servicePath = path.resolve(import.meta.dirname, 'native-agent-service.ts');
const hostPath = path.resolve(import.meta.dirname, 'native-codex-host.mjs');
const ledgerPath = path.resolve(import.meta.dirname, 'native-business-ledger.mjs');
const dispatcherPath = path.resolve(import.meta.dirname, 'application-tool-dispatcher.mjs');
const recoveryPath = path.resolve(import.meta.dirname, 'agent-recovery-service.mjs');
const managementPath = path.resolve(import.meta.dirname, 'agent-management-service.mjs');
const replayPath = path.resolve(import.meta.dirname, 'thread-replay-service.mjs');
const contextPath = path.resolve(import.meta.dirname, 'context-reference.mjs');
const admissionPath = path.resolve(import.meta.dirname, 'agent-request-admission-service.mjs');
const streamRunPath = path.resolve(import.meta.dirname, 'agent-request-stream-run-service.mjs');
const mainAgentFlowPath = path.resolve(import.meta.dirname, 'agent-main-agent-flow.mjs');
const confirmationPath = path.resolve(import.meta.dirname, 'agent-confirmation-continuation-service.mjs');
const executionContextPath = path.resolve(import.meta.dirname, 'agent-request-execution-context-service.mjs');
const read = (file) => fs.readFileSync(file, 'utf8');

test('all chat modes use the Codex Main runtime gateway entry', () => {
  const route = read(routePath);
  const page = read(pagePath);
  const mainAgentFlow = read(mainAgentFlowPath);
  assert.match(route, /import \{ runMainAgentFlow \} from ['"]\.\/agent-main-agent-flow\.mjs['"]/);
  assert.match(route, /runMainAgent: runMainAgentFlow/);
  assert.match(mainAgentFlow, /runAgentTurn\(\{ startKeepalive, request \}\)/);
  assert.doesNotMatch(route, /from ['"]\.\/thread-journal\.mjs['"]/);
  assert.doesNotMatch(route, /runCodexMainTurn/);
  assert.match(page, /const usesAgentRequest = true/);
  assert.doesNotMatch(route, /runZFlowAgentBrain|buildMainAgentLoopMessages|legacy\/tool-capable loop/);
  assert.doesNotMatch(route, /pi-agent-runtime|main-agent\.mjs/);
});

test('management commands and GET replay are delegated to dedicated services', () => {
  const route = read(routePath);
  assert.match(route, /agent-management-service\.mjs/);
  assert.match(route, /thread-replay-service\.mjs/);
  assert.doesNotMatch(route, /async function handleManagementCommand/);
  assert.doesNotMatch(route, /const activeTurn = result\.state\.turns/);
  assert.match(read(managementPath), /export async function handleManagementCommand/);
  assert.match(read(replayPath), /export async function handleThreadReplay/);
});

test('the route remains an authenticated streaming adapter with server-owned run identity', () => {
  const route = read(routePath);
  const admission = read(admissionPath);
  assert.match(admission, /error: 'sessionId is required'/);
  assert.match(admission, /const runId = randomUUID\(\)/);
  assert.match(route, /registerActiveAgentRun\(runId, initialAgentIdentity\)/);
  assert.match(route, /application\/x-ndjson/);
  assert.match(route, /writeLifecycleEvent/);
  assert.match(admission, /code: 'stale_operation'/);
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
  for (const capability of ['shell_tool', 'unified_exec', 'multi_agent', 'plugins', 'image_generation', 'web_search_request']) {
    assert.match(host, new RegExp(`'${capability}'`));
  }
  assert.match(host, /approval_policy = "never"/);
  assert.match(host, /sandbox_mode = "read-only"/);
  assert.match(host, /wire_api = "responses"/);
  assert.match(host, /request_max_retries = 0/);
  assert.match(host, /stream_max_retries = 0/);
  assert.match(host, /\[features\.code_mode\]/);
  assert.match(host, /direct_only_tool_namespaces = \["functions"\]/);
});

test('business tools execute through the native callback and image side effects use the durable ledger', () => {
  const route = read(routePath);
  const ledger = read(ledgerPath);
  const dispatcher = read(dispatcherPath);
  const recovery = read(recoveryPath);
  assert.doesNotMatch(route, /createToolCallback:/);
  assert.doesNotMatch(route, /dispatchRegisteredApplicationTool\(/);
  assert.match(read(path.resolve(import.meta.dirname, 'agent-turn-execution-service.mjs')), /createDynamicToolCallback/);
  assert.match(dispatcher, /executeAgentTool\(registry, requestedTool, requestedArgs/);
  assert.match(recovery, /createRecoveryRecord/);
  assert.doesNotMatch(route, /executeNativeBusinessOperation\(\{/);
  assert.match(dispatcher, /generate_image/);
  assert.match(read(new URL('./agent-image-execution-flow.mjs', import.meta.url)), /executeNativeBusinessOperation/);
  assert.match(ledger, /contractHash = hashNativeBusinessContract\(contract\)/);
  assert.match(ledger, /if \(existing\.status === 'completed'\) return existing\.result/);
  assert.match(ledger, /Business operation result is unknown; explicit reconciliation is required/);
});

test('request runtime keeps Native image execution and delivery state in live refs', () => {
  const route = read(routePath);
  for (const name of [
    'skillContent',
    'skillContentHash',
    'nativeGeneratedImageResult',
    'nativeImageFailure',
    'directGenerateImageCall',
    'directGenerateImageCallId',
    'directImageExecution',
    'lockedImageToolArgs',
  ]) {
    assert.match(route, new RegExp(`${name}: ref\\('${name}'`));
  }
  // The registry is created before the Native loop; it must receive the same
  // live refs, otherwise the image handler sees a stale empty Skill hash and
  // its result setters become no-ops.
  assert.ok((route.match(/skillContentHash: ref\('skillContentHash'/g) || []).length >= 2);
  assert.ok((route.match(/nativeGeneratedImageResult: ref\('nativeGeneratedImageResult'/g) || []).length >= 2);
});

test('reference images are materialized, decoded, and sent as native structured image input', () => {
  const nativeFlow = read(path.resolve(import.meta.dirname, 'agent-native-turn-flow.mjs'));
  const host = read(hostPath);
  assert.match(nativeFlow, /materializeNativeImages/);
  assert.match(nativeFlow, /images/);
  assert.match(host, /input\.push\(\{ type: 'image', url: image \}\)/);
  assert.match(host, /parseImageDataUrl/);
  assert.match(host, /native_image_payload_invalid/);
});

test('ImageGen and a locked visual Skill are injected as verified native Skill inputs', () => {
  const streamRun = read(streamRunPath);
  const host = read(hostPath);
  assert.match(streamRun, /id: imagegenHostSkillId/);
  assert.match(streamRun, /get\('selectedSkill', selectedSkill\) && skillContent/);
  assert.match(streamRun, /content: skillContent, hash: skillContentHash/);
  assert.match(host, /native_skill_hash_mismatch/);
  assert.match(host, /native_skill_context_limit/);
  assert.match(host, /input\.push\(\{ type: 'skill', name, path \}\)/);
});

test('model-selected visual Skills require high confidence and return complete locked rules', () => {
  const route = read(routePath);
  assert.match(read(mainAgentFlowPath), /name: 'select_visual_skill'/);
  const interaction = read(path.resolve(import.meta.dirname, 'agent-interaction-service.mjs'));
  assert.match(interaction, /confidence !== 'high'/);
  assert.match(interaction, /loadSkillContent/);
  assert.match(interaction, /contentHash/);
  assert.match(interaction, /return \{ locked: true, modelResult/);
  const streamRun = read(streamRunPath);
  assert.match(streamRun, /if \(selection\?\.isError\)[\s\S]{0,180}if \(selection\?\.locked !== true\)/);
  assert.doesNotMatch(route, /findDirectSkillMatches\(|selectSkillForPrompt\(/);
});

test('native public items are projected to the existing timeline without exposing raw response items', () => {
  const service = read(servicePath);
  const execution = read(path.resolve(import.meta.dirname, 'agent-turn-execution-service.mjs'));
  assert.match(execution, /item\/started/);
  assert.match(execution, /item\/completed/);
  assert.match(execution, /dynamicToolCall/);
  assert.match(execution, /agentMessage/);
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
  assert.match(route, /createConfirmationContinuationService/);
  const confirmation = read(confirmationPath);
  const executionContext = read(executionContextPath);
  assert.match(confirmation, /saveConfirmation/);
  assert.match(confirmation, /loadConfirmation/);
  assert.match(confirmation, /claimConfirmation/);
  assert.match(read(streamRunPath), /identity: \{ taskId, operationId, runId \}/);
  assert.match(route, /recoveryBaseRecord/);
  assert.match(executionContext, /activeVersions:/);
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

test('request controller is a pure transport adapter', () => {
  const controller = read(controllerPath);
  assert.doesNotMatch(controller, /runMainAgentOnce|executeImageRequest|executeAgentTool|createExecutionRecoveryRecord/);
  assert.doesNotMatch(controller, /item\/(?:started|updated|completed)|appendThreadEvent|nativeCodexHost/);
  assert.match(controller, /handleRuntimePost/);
  assert.match(controller, /handleRuntimeGet/);
});
