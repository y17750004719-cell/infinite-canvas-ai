import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const routePath = path.resolve(import.meta.dirname, '../../api/agent/route.ts');
const pagePath = path.resolve(import.meta.dirname, '../../page.tsx');
const mainAgentPath = path.resolve(import.meta.dirname, 'main-agent.mjs');
const runtimePath = path.resolve(import.meta.dirname, 'pi-agent-runtime.mjs');
const contextPath = path.resolve(import.meta.dirname, 'context-reference.mjs');

const read = (file) => fs.readFileSync(file, 'utf8');

test('agent route uses one Pi Main Agent Loop instead of an independent Front Door request', () => {
  const source = read(routePath);
  assert.match(source, /buildMainAgentLoopMessages/);
  assert.match(source, /const loopResult(?::\s*any)? = forcedPlannerTerminal[\s\S]{0,400}: await runZFlowAgentBrain/);
  assert.doesNotMatch(source, /resolveMainAgentFrontDoor|frontdoor\.resolved|frontdoor\.failed/);
  assert.match(source, /MAX_MAIN_AGENT_TURNS\s*=\s*12/);
  assert.match(source, /MAX_MAIN_AGENT_TOOL_CALLS\s*=\s*12/);
  assert.match(source, /reserveClosingTurn:\s*true/);
});

test('Main Agent exposes only bounded context and handoff controls', () => {
  const source = read(routePath);
  for (const tool of [
    'get_conversation_memory',
    'list_project_context',
    'read_context_entity',
    'load_visual_reference',
    'update_conversation_memory',
    'handoff_to_image_planner',
    'request_context_selection',
  ]) assert.match(source, new RegExp(`'${tool}'`));
  const namesStart = source.indexOf('const mainAgentToolNames = [');
  const namesEnd = source.indexOf('];', namesStart);
  const names = source.slice(namesStart, namesEnd);
  assert.doesNotMatch(names, /generate_image|start_skill_job/);
});

test('Main Agent naturally completes with text and Planner handoff carries stable IDs only', () => {
  const source = read(routePath);
  assert.match(source, /Main Agent returned an empty response/);
  assert.doesNotMatch(source, /Main Agent ended without a valid terminal tool/);
  assert.match(source, /type: 'planner_handoff'/);
  assert.match(source, /contextEntityIds = validateContextIds/);
  assert.match(source, /visualReferenceIds = validateContextIds/);
  assert.match(source, /contextEntityIds = validateContextIds\(\[[\s\S]{0,200}\.\.\.restoredReferenceIds/);
  assert.match(source, /visualReferenceIds = validateContextIds\(\[[\s\S]{0,200}\.\.\.restoredVisualReferenceIds/);
  assert.doesNotMatch(source, /handoffToImagePlanner:[\s\S]{0,1200}(?:prompt|brief):/i);
});

test('ordinary text cannot trigger an image mutation when the model misses Planner handoff', () => {
  const source = read(routePath);
  const naturalStart = source.indexOf('if (!terminal) {');
  const naturalEnd = source.indexOf("if (terminal.type !== 'planner_handoff')", naturalStart);
  const naturalBranch = source.slice(naturalStart, naturalEnd);
  assert.match(naturalBranch, /writeAgentDone\('completed'\)/);
  assert.doesNotMatch(naturalBranch, /generate_image|start_skill_job|planAgentExecutionRequest/);
});

test('historical visual loading is bounded and becomes a multimodal next-turn attachment', () => {
  const route = read(routePath);
  const runtime = read(runtimePath);
  assert.match(route, /validatedIds\.length === 0 \|\| validatedIds\.length > 4/);
  assert.match(route, /contextEntities\.slice\(-80\)/);
  assert.match(route, /visualReferences,/);
  assert.match(runtime, /message\.details\?\.visualReferences/);
  assert.match(runtime, /role: 'user'[\s\S]{0,300}type: 'image_url'/);
});

test('context ambiguity pauses and resumes the same Pi transcript', () => {
  const source = read(routePath);
  assert.match(source, /toolName === 'request_context_selection'/);
  assert.match(source, /mainAgentLoop:\s*\{/);
  assert.match(source, /transcript: structuredClone\(loopResult\.transcript\)/);
  assert.match(source, /continuation:\s*\{/);
  assert.match(source, /selectedContextEntityId: selectedContextResponse/);
  assert.match(source, /dimension: 'context_reference'/);
});

test('local context code validates explicit stable IDs without semantic history selection', () => {
  const source = read(contextPath);
  const resolverStart = source.indexOf('export function resolveContextReference');
  const resolverEnd = source.indexOf('export function compileExecutionBrief', resolverStart);
  const resolver = source.slice(resolverStart, resolverEnd);
  assert.match(resolver, /selectedEntityIds\.includes\(entity\.id\)/);
  assert.doesNotMatch(resolver, /上一张图|刚才那张|reduce\(\(current, entity\)/);
});

test('Image Planner receives the original request, visual summary, and compact Skill manifest after handoff', () => {
  const source = read(routePath);
  const loopIndex = source.indexOf('const loopResult: any = forcedPlannerTerminal');
  const plannerIndex = source.indexOf('await planAgentExecutionRequest', loopIndex);
  assert.ok(loopIndex >= 0 && plannerIndex > loopIndex);
  const plannerCall = source.slice(plannerIndex, plannerIndex + 1800);
  assert.match(source, /const plannerUserMessage = resumedFailedTask\?\.originalRequest \|\| latestUserMessage/);
  assert.match(plannerCall, /userMessage:[\s\S]{0,220}plannerUserMessage/);
  assert.match(plannerCall, /messages: plannerHistoryMessages/);
  assert.match(plannerCall, /visualSummary: plannerVisualSummary/);
  assert.doesNotMatch(plannerCall, /skillContent,/);
  assert.match(source, /selectedSkill\.executionMode === 'image_pipeline'/);
  assert.match(plannerCall, /lockedSkillId: selectedSkill\?\.id \|\| null/);
});

test('failed tasks use a restricted recovery gate and exact retry ID', () => {
  const route = read(routePath);
  const page = read(pagePath);
  const mainAgent = read(mainAgentPath);

  assert.match(page, /getLatestAgentRecoveryForTask\(chatMessages, options\.recoveryRecord\.taskId\)/);
  assert.match(page, /recentFailedTask: recentRecoveryTask/);
  assert.match(page, /recoveryRecord: recovery/);
  assert.match(route, /normalizeRecentFailedTask\(body\.recentFailedTask, body\.messages\)/);
  assert.match(route, /buildFailedTaskRecoveryMessages/);
  assert.match(route, /\['resolve_failed_task_recovery'\]/);
  assert.match(route, /toolChoice:\s*\{\s*type:\s*'function',\s*function:\s*\{\s*name:\s*'resolve_failed_task_recovery'/);
  assert.match(route, /for \(let attempt = 0; attempt < 2; attempt \+= 1\)/);
  assert.match(route, /mainAgentReferenceImages = \[\]/);
  assert.match(route, /plannerHistoryMessages = cropMessagesToRecoverySource/);
  assert.match(route, /knownVisualReferenceIds = new Set/);
  assert.match(route, /const route = decision === 'resume' \? record\.resumeRoute : null/);
  assert.match(route, /skillSource === 'manual'/);
  assert.match(route, /reserveTaskExecution\([\s\S]{0,500}recoveryTaskIdForExecution/);
  assert.match(route, /preserveRecoveryRecordOnFailure && recoveryBaseRecord[\s\S]{0,120}\? recoveryBaseRecord/);
  assert.match(route, /recoveryResolution\?\.decision === 'continue_current_request'[\s\S]{0,160}recoveryBaseRecord = null[\s\S]{0,100}preserveRecoveryRecordOnFailure = false/);
  assert.match(route, /!nextSnapshot\?\.activeVersions\.length && previousSnapshot[\s\S]{0,80}\? previousSnapshot/);
  const recoveryValidation = route.slice(
    route.indexOf('const validateRecoveryResolution'),
    route.indexOf('const runRecoveryGate'),
  );
  assert.doesNotMatch(recoveryValidation, /args\.taskId|args\.route|args\.skillId/);
  assert.match(route, /const src = version\.assetUrl \|\| entity\?\.assetUrl/);
  assert.match(mainAgent, /任务恢复门控/);
  assert.doesNotMatch(mainAgent, /系统可能提供 recentFailedTask/);
});

test('validated Image Planner contracts execute deterministically without another model decision', () => {
  const source = read(routePath);
  const imagePipeline = source.indexOf('if (shouldUseImagePipeline)');
  const directTool = source.indexOf("executeAgentTool(toolRegistry, 'generate_image'", imagePipeline);
  const completed = source.indexOf("writeAgentDone('image_generated')", directTool);
  assert.ok(imagePipeline >= 0 && directTool > imagePipeline && completed > directTool);
  assert.match(source, /Unsupported deterministic Image Planner tool/);
  assert.match(source, /toolName: 'start_skill_job'/);
});

test('topic memory is bounded, emitted, and persisted by the client', () => {
  const route = read(routePath);
  const page = read(pagePath);
  assert.match(route, /mergeTopicMemory/);
  assert.match(route, /stagedMainAgentMemoryPatches/);
  assert.match(route, /commitMainAgentMemory/);
  assert.match(route, /memoryPatches: structuredClone/);
  assert.match(route, /type: 'agent_memory_updated'/);
  assert.match(route, /recentRawConversation:[\s\S]{0,100}slice\(-20\)/);
  assert.match(page, /agentMemory: requestTopicMemory/);
  assert.match(page, /event\.type === 'agent_memory_updated'/);
  assert.match(page, /topic\.id === requestTopicId \? \{ \.\.\.topic, agentMemory: memory/);
});

test('all chat modes use the Agent endpoint and preserve NDJSON progress and delivery events', () => {
  const route = read(routePath);
  const page = read(pagePath);
  assert.match(page, /const usesAgentRequest = true/);
  assert.match(route, /application\/x-ndjson/);
  for (const event of ['progress_update', 'clarification_required', 'agent_activity_delta', 'agent_activity_commit', 'assistant_delta', 'client_action', 'agent_done']) {
    assert.match(`${route}\n${read(path.resolve(import.meta.dirname, 'events.ts'))}`, new RegExp(`'${event}'`));
  }
});

test('Main Agent streams visible text activity without exposing reasoning and has no app wall-clock timeout', () => {
  const source = read(routePath);
  assert.match(source, /assistantMessageEvent\?\.type === 'text_delta'/);
  assert.match(source, /disposition: failed \|\| hasToolCall \? 'commentary' : 'final'/);
  assert.match(source, /const runSignal = request\.signal/);
  assert.doesNotMatch(source, /AGENT_RUN_TIMEOUT_MS|timeoutSignal/);
  assert.doesNotMatch(source, /assistantMessageEvent\?\.type === 'thinking_delta'/);
});

test('Main Agent prompt uses natural completion and forbids direct image mutation', () => {
  const source = read(mainAgentPath);
  assert.doesNotMatch(source, /finish_main_agent_turn/);
  assert.match(source, /普通文本.*自然结束/);
  assert.match(source, /update_conversation_memory/);
  assert.match(source, /handoff_to_image_planner/);
  assert.match(source, /request_context_selection/);
  assert.match(source, /不得调用生成、编辑、导出或任何变更工具/);
});

test('vendor-specific compatibility does not define the Main Agent protocol', () => {
  const mainAgent = read(mainAgentPath);
  const runtime = read(runtimePath);
  assert.doesNotMatch(`${mainAgent}\n${runtime}`, /xiaomi|mimo|tool_choice\.name/i);
});
