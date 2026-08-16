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
  assert.match(source, /const loopResult(?::\s*any)? = await runZFlowAgentBrain/);
  assert.doesNotMatch(source, /resolveMainAgentFrontDoor|frontdoor\.resolved|frontdoor\.failed/);
  assert.match(source, /MAX_MAIN_AGENT_TURNS\s*=\s*12/);
  assert.match(source, /MAX_MAIN_AGENT_TOOL_CALLS\s*=\s*6/);
  assert.match(source, /reserveClosingTurn:\s*true/);
});

test('Main Agent first turn exposes only lazy entry tools', () => {
  const source = read(routePath);
  const namesStart = source.indexOf('const standardMainAgentInitialToolNames = [');
  const namesEnd = source.indexOf('];', namesStart);
  const names = source.slice(namesStart, namesEnd);
  for (const tool of ['read_relevant_context', 'submit_agent_analysis_checkpoint', 'request_user_decision', 'start_image_planning']) {
    assert.match(names, new RegExp(`'${tool}'`));
  }
  assert.doesNotMatch(names, /request_context_selection/);
  assert.doesNotMatch(names, /read_selected_skill|submit_image_context_analysis|submit_image_brief|submit_image_prompt_compilation|submit_image_execution_plan/);
  assert.match(source, /relevantContextCandidateIds\.size >= 2 \? \['request_context_selection'\] : \[\]/);
  const modelToolNames = source.slice(source.indexOf('const mainAgentToolNames = ['), source.indexOf('];', source.indexOf('const mainAgentToolNames = [')));
  assert.doesNotMatch(modelToolNames, /read_selected_skill/);
  assert.match(source, /manifests: selectedSkill \? \[selectedSkill\] : \[\]/);
});

test('image tasks hand off once to the background Planner before execution', () => {
  const source = read(routePath);
  assert.match(source, /start_image_planning/);
  assert.match(source, /const runStagedImagePlanning = async/);
  assert.match(source, /await planAgentExecutionRequest\(plannerRequest\)/);
  assert.match(source, /imageContractOnly: true/);
  assert.match(source, /resolvedRequirement: imagePlanning\.resolvedRequirement/);
  assert.match(source, /referenceContext: runReferenceContext/);
  assert.doesNotMatch(source, /validateSkillPromptAssertions|missingCompiledPromptLiterals/);
  assert.match(source, /imagePlanning:\s*structuredClone\(imagePlanning\)/);
  assert.match(source, /agent_task_checkpoint/);
});

test('image recovery keeps stable references and does not restore six-stage handlers', () => {
  const source = read(routePath);
  const recoveryStart = source.indexOf("if (recoveryResolution.route === 'main_agent')");
  const recoveryEnd = source.indexOf("} else if (recoveryResolution.route === 'local_delivery')", recoveryStart);
  const recoveryBranch = source.slice(recoveryStart, recoveryEnd);
  assert.match(recoveryBranch, /runtimeReferenceContext/);
  assert.doesNotMatch(recoveryBranch, /mainAgentReferenceImages = \[\]/);

  assert.doesNotMatch(source, /submitImageContextAnalysis|submitImageBrief|submitImagePromptCompilation|classifyImageOperation/);
});

test('Main Agent naturally completes with text and Planner handoff carries stable IDs only', () => {
  const source = read(routePath);
  assert.match(source, /Main Agent returned an empty response/);
  assert.doesNotMatch(source, /Main Agent ended without a valid terminal tool/);
  assert.match(source, /type: 'image_execution_plan'/);
  assert.match(source, /contextEntityIds = validateContextIds/);
  assert.match(source, /visualReferenceIds = validateContextIds/);
  assert.match(source, /planAgentExecutionRequest/);
  assert.match(source, /loopResult\.terminal\?\.type === 'image_planning_started'/);
});

test('ordinary text cannot trigger an image mutation when the model misses Planner handoff', () => {
  const source = read(routePath);
  const naturalStart = source.indexOf('if (!terminal) {');
  const naturalEnd = source.indexOf("if (terminal.type !== 'image_execution_plan'", naturalStart);
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
  assert.match(source, /const taskId = rootTaskId\(\)/);
  assert.match(source, /sourceUserMessageId: rootSourceUserMessageId\(\)/);
  assert.match(source, /selectedSkill \? \{ skillId: selectedSkill\.id, skillRead: mainAgentLoopState\.skillRead \}/);
});

test('local context code validates explicit stable IDs without semantic history selection', () => {
  const source = read(contextPath);
  const resolverStart = source.indexOf('export function resolveContextReference');
  const resolverEnd = source.indexOf('export function compileExecutionBrief', resolverStart);
  const resolver = source.slice(resolverStart, resolverEnd);
  assert.match(resolver, /selectedEntityIds\.includes\(entity\.id\)/);
  assert.doesNotMatch(resolver, /上一张图|刚才那张|reduce\(\(current, entity\)/);
});

test('Runtime gives the Planner the resolved requirement and preserves task identity locally', () => {
  const source = read(routePath);
  const stagedStart = source.indexOf('const runStagedImagePlanning = async');
  const stagedEnd = source.indexOf('let loopResult', stagedStart);
  const staged = source.slice(stagedStart, stagedEnd);
  assert.match(staged, /originalRequest: imagePlanning\.originalRequest/);
  assert.match(staged, /lockedImageOperation: imagePlanning\.operation/);
  assert.match(staged, /lockedTargetReferenceId: imagePlanning\.targetReferenceId/);
  assert.match(staged, /lockedOutputCount: imagePlanning\.outputCount/);
  assert.match(staged, /lockedAspectRatio/);
  assert.match(staged, /const plannerRequest = \{/);
  assert.match(staged, /\['transport', 'timeout'\]\.includes\(plannerResult\.failureReason/);
  assert.match(staged, /Retrying the unchanged Image Planner contract/);
  assert.match(staged, /executionPlanToImageDeliveryPlan\(executionPlan\)/);
});

test('background Planner receives locked source data and is the only prompt-writing model stage', () => {
  const source = read(routePath);
  const stagedStart = source.indexOf('const runStagedImagePlanning = async');
  const stagedEnd = source.indexOf('let loopResult', stagedStart);
  const stagedSource = source.slice(stagedStart, stagedEnd);
  assert.match(stagedSource, /imageContractOnly: true/);
  assert.match(stagedSource, /manifests: selectedSkill \? \[selectedSkill\] : \[\]/);
  assert.match(stagedSource, /referenceContext: runReferenceContext/);
  assert.match(stagedSource, /chatStreamFn: chatStream/);
  assert.doesNotMatch(stagedSource, /submit_image_compilation|buildImageExecutionDraft|composeFinalImagePrompt/);
  assert.doesNotMatch(stagedSource, /onEvent: emitMainAgentEvent/);
});

test('Image contract generation uses one independent Planner transport', () => {
  const routeSource = read(routePath);
  assert.match(routeSource, /AGENT_PLANNER_PROVIDER_ID/);
  assert.match(routeSource, /AGENT_PLANNER_MODEL/);
  assert.match(routeSource, /await planAgentExecutionRequest/);
  assert.match(routeSource, /Planner returned an empty image prompt/);
});

test('failed tasks stay passive until the lightweight entry explicitly resumes them', () => {
  const route = read(routePath);
  const page = read(pagePath);
  const mainAgent = read(mainAgentPath);

  assert.match(page, /getLatestAgentRecoveryForTask\(chatMessages, options\.recoveryRecord\.taskId\)/);
  assert.match(page, /recentFailedTask: recentRecoveryTask/);
  assert.match(page, /recoveryRecord: recovery/);
  assert.doesNotMatch(page, /skill: activeSkill \|\| sourceMessage\.skill/);
  assert.match(page, /effectiveAgentClarification\?\.state\.sourceUserMessageId/);
  assert.match(route, /normalizeRecentFailedTask\(body\.recentFailedTask, body\.messages\)/);
  assert.match(route, /buildFailedTaskRecoveryMessages/);
  assert.match(route, /\['handle_failed_task'\]/);
  const recoveryGate = route.slice(
    route.indexOf('const runRecoveryGate'),
    route.indexOf('const recoveryRecord'),
  );
  assert.match(recoveryGate, /toolChoice:\s*'auto'/);
  assert.doesNotMatch(recoveryGate, /for \(let attempt = 0; attempt < 2; attempt \+= 1\)/);
  assert.match(recoveryGate, /decision: 'direct_response'/);
  assert.match(route, /recoveryResolution\?\.decision === 'direct_response'/);
  assert.match(route, /recoveryResolution = await runRecoveryGate\(recoveryRecord\)/);
  assert.match(route, /body\.intent !== 'image'/);
  assert.match(route, /selectedSkill\?\.executionMode !== 'image_pipeline'/);
  assert.match(route, /requestedRecoveryTaskId[\s\S]{0,700}runRecoveryGate\(recoveryRecord\)/);
  assert.match(route, /mainAgentReferenceImages = \[\]/);
  assert.match(route, /plannerHistoryMessages = cropMessagesToRecoverySource/);
  assert.match(route, /knownVisualReferenceIds = new Set/);
  assert.match(route, /const route = action === 'resume' \? record\.resumeRoute : null/);
  assert.match(route, /record\.taskSnapshot\?\.imagePlanning\?\.skill\?\.id \|\| record\.skillId \|\| null/);
  assert.match(route, /reserveTaskExecution\([\s\S]{0,500}recoveryTaskIdForExecution/);
  assert.match(route, /preserveRecoveryRecordOnFailure && recoveryBaseRecord[\s\S]{0,120}\? recoveryBaseRecord/);
  assert.match(route, /recoveryResolution\?\.decision === 'continue_current_request'[\s\S]{0,160}recoveryBaseRecord = null[\s\S]{0,100}preserveRecoveryRecordOnFailure = false/);
  assert.match(route, /!nextSnapshot\?\.activeVersions\.length && previousSnapshot[\s\S]{0,80}\? previousSnapshot/);
  assert.match(route, /recoveryRevisionMessage/);
  assert.match(route, /rewindAgentAnalysis/);
  assert.match(route, /rewindImagePlanning\(imagePlanning, requestedStage as AgentImagePlanningStage, runId\)/);
  assert.doesNotMatch(route, /recoveryRevisionMessage[\s\S]{0,800}\/(?:prompt|提示词|关键词)/);
  const recoveryValidation = route.slice(
    route.indexOf('const handleFailedTask'),
    route.indexOf('const runRecoveryGate'),
  );
  assert.doesNotMatch(recoveryValidation, /args\.taskId|args\.route|args\.skillId/);
  assert.match(route, /const src = version\.assetUrl \|\| entity\?\.assetUrl/);
  assert.match(mainAgent, /轻量任务入口/);
  assert.match(mainAgent, /简单寒暄或可以直接回答/);
  assert.match(mainAgent, /action=inspect/);
  assert.match(mainAgent, /action=resume/);
  assert.doesNotMatch(mainAgent, /系统可能提供 recentFailedTask/);
  assert.match(route, /let recoveryBaseRecord: AgentRecoveryRecord \| null = null/);
  assert.match(route, /recoveryBaseRecord = recoveryRecord/);
  assert.match(route, /selectedSkill = null;[\s\S]{0,120}skillSource = null/);
});

test('explicit image UI requests stay in the image domain without forcing an entry tool', () => {
  const route = read(routePath);
  assert.match(route, /body\.intent === 'image'/);
  assert.match(route, /toolChoice:[\s\S]{0,100}terminalContractResume[\s\S]{0,160}'auto'/);
  assert.match(route, /requireInitialTool: ''/);
  assert.doesNotMatch(route, /explicitImageEntryRequired/);
});

test('validated Image Planner contracts execute deterministically without another model decision', () => {
  const source = read(routePath);
  const imagePipeline = source.indexOf('if (shouldUseImagePipeline)');
  const directTool = source.indexOf("executeAgentTool(toolRegistry, 'generate_image'", imagePipeline);
  const completed = source.indexOf("writeAgentDone('image_generated')", directTool);
  assert.ok(imagePipeline >= 0 && directTool > imagePipeline && completed > directTool);
  assert.match(source, /Unsupported deterministic image execution tool/);
  assert.match(source, /toolName: 'start_skill_job'/);
});

test('long-running image supplier calls keep the Agent delivery stream active', () => {
  const source = read(routePath);
  const heartbeat = source.indexOf('startAgentImageGenerationHeartbeat');
  const settle = source.indexOf('await settleCanvasImageGenerationRequests', heartbeat);
  const stop = source.indexOf('stopImageGenerationHeartbeat()', settle);
  assert.ok(heartbeat >= 0 && settle > heartbeat && stop > settle);
  assert.match(source, /onPulse:[\s\S]{0,300}stepId: 'generate_image'/);
});

test('manual image Skills pass the compiler prompt directly to image generation', () => {
  const source = read(routePath);
  const finalPrompt = source.indexOf("const finalGenerationPrompt = String(generationPrompt || '').trim()");
  const requestBuilder = source.indexOf('buildAgentImageGenerationRequests', finalPrompt);
  assert.ok(finalPrompt >= 0 && requestBuilder > finalPrompt);
  assert.doesNotMatch(source, /validateSkillPromptAssertions|missingCompiledPromptLiterals/);
  assert.doesNotMatch(source, /submitImagePromptCompilation|imagePlanning\.promptRepair/);
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
  assert.match(source, /直接用普通文本回答，不创建任务/);
  assert.match(source, /submit_agent_analysis_checkpoint/);
  assert.match(source, /request_user_decision/);
  assert.match(source, /主 Agent 不编写、重写或校验供应商 Prompt/);
  assert.match(source, /后台 Image Planner 会独立接收已理解需求、Skill 和稳定参考图并生成供应商合同/);
  assert.doesNotMatch(source, /submit_image_context_analysis|submit_image_brief|submit_image_prompt_compilation/);
  assert.doesNotMatch(source, /调用 submit_image_execution_plan/);
  assert.doesNotMatch(source, /调用 read_selected_skill/);
  assert.match(source, /不得声称已执行尚未发生的生成或变更/);
});

test('vendor-specific compatibility does not define the Main Agent protocol', () => {
  const mainAgent = read(mainAgentPath);
  const runtime = read(runtimePath);
  assert.doesNotMatch(`${mainAgent}\n${runtime}`, /xiaomi|mimo|tool_choice\.name/i);
});
