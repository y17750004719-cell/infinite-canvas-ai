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
  assert.match(source, /const runMainAgentOnce = async[\s\S]*runZFlowAgentBrain/);
  assert.doesNotMatch(source, /resolveMainAgentFrontDoor|frontdoor\.resolved|frontdoor\.failed/);
  assert.match(source, /MAX_MAIN_AGENT_TURNS\s*=\s*12/);
  assert.match(source, /MAX_MAIN_AGENT_TOOL_CALLS\s*=\s*6/);
  assert.match(source, /reserveClosingTurn:\s*true/);
});

test('Main Agent gates image execution on host-loaded ImageGen context', () => {
  const source = read(routePath);
  const namesStart = source.indexOf('const standardMainAgentToolNames = [');
  const namesEnd = source.indexOf('];', namesStart);
  const names = source.slice(namesStart, namesEnd);
  for (const tool of ['read_relevant_context', 'submit_agent_analysis_checkpoint', 'request_user_decision']) {
    assert.match(names, new RegExp(`'${tool}'`));
  }
  assert.doesNotMatch(names, /request_context_selection/);
  assert.doesNotMatch(names, /submit_image_context_analysis|submit_image_brief|submit_image_prompt_compilation|submit_image_execution_plan/);
  assert.match(source, /relevantContextCandidateIds\.size >= 2 \? \['request_context_selection'\] : \[\]/);
  const modelToolNames = source.slice(source.indexOf('const mainAgentToolNames = ['), source.indexOf('];', source.indexOf('const mainAgentToolNames = [')));
  assert.match(modelToolNames, /generate_image/);
  assert.match(source, /const imageExecutionToolName = \(\) => 'generate_image'/);
  assert.match(source, /manifests: skillManifests/);
  assert.doesNotMatch(source, /submit_image_execution_plan|image_execution_plan/);
});

test('image tasks submit one direct ImageGen contract before execution', () => {
  const source = read(routePath);
  assert.match(source, /generateImage: async \(args: Record<string, unknown>, context: \{ publicProgress\?: unknown; toolCallId\?: string \}\)/);
  assert.match(source, /const prompt = String\(args\.prompt \|\| ''\)\.trim\(\)/);
  assert.match(source, /assertImageExecutionContract\(/);
  assert.match(source, /lockedImageToolArgs = imageExecutionContract/);
  assert.doesNotMatch(source, /loopResult = await runStagedImagePlanning\(\)/);
  assert.doesNotMatch(source, /validateSkillPromptAssertions|missingCompiledPromptLiterals/);
  assert.doesNotMatch(source, /imagePlanning|completeImagePlanningStage/);
  assert.match(source, /agent_task_checkpoint/);
});

test('image recovery keeps stable references and does not restore six-stage handlers', () => {
  const source = read(routePath);
  const recoveryStart = source.indexOf("if (recoveryResolution.route === 'main_agent')");
  const recoveryEnd = source.indexOf("} else if (recoveryResolution.route === 'local_delivery')", recoveryStart);
  const recoveryBranch = source.slice(recoveryStart, recoveryEnd);
  assert.match(recoveryBranch, /runtimeReferenceContext/);
  assert.match(recoveryBranch, /runtimeReferenceById\.clear\(\)/);
  assert.match(recoveryBranch, /executionReferenceImages = runReferenceContext\.references\.map/);
  assert.doesNotMatch(recoveryBranch, /mainAgentReferenceImages = \[\]/);

  assert.doesNotMatch(source, /submitImageContextAnalysis|submitImageBrief|submitImagePromptCompilation|classifyImageOperation/);
});

test('provider availability failures are non-retryable Agent failures', () => {
  const source = read(routePath);
  assert.match(source, /provider_unavailable/);
  assert.match(source, /no enabled channel for model/);
  assert.match(source, /no available compatible accounts/);
  const retryClassifier = source.slice(source.indexOf('const isRetryablePlannerProviderError'), source.indexOf('const classifyAgentFailureCode'));
  assert.doesNotMatch(retryClassifier, /no enabled channel for model/);
});

test('Main Agent naturally completes with text and direct ImageGen keeps stable IDs', () => {
  const source = read(routePath);
  assert.match(source, /Main Agent returned an empty response/);
  assert.doesNotMatch(source, /Main Agent ended without a valid terminal tool/);
  assert.match(source, /type: 'image_execution'/);
  assert.match(source, /referenceIds\.some\(\(id\) => !runtimeReferenceById\.has\(id\)\)/);
  assert.match(source, /targetReferenceId = operation === 'edit' \? requestedTargetReferenceId : null/);
  assert.match(source, /type: 'image_execution'/);
});

test('legacy image Planner tools are absent from the production route', () => {
  const source = read(routePath);
  assert.doesNotMatch(source, /submit_image_execution_plan|image_execution_plan/);
  assert.match(source, /type: 'image_execution'/);
  assert.match(source, /contract: imageExecutionContract/);
});

test('ordinary text cannot trigger an image mutation when the model misses Planner handoff', () => {
  const source = read(routePath);
  const naturalStart = source.indexOf('if (!terminal) {');
  const naturalEnd = source.indexOf("if (terminal.type !== 'image_execution'", naturalStart);
  const naturalBranch = source.slice(naturalStart, naturalEnd);
  assert.match(naturalBranch, /writeAgentDone\('completed'\)/);
  assert.doesNotMatch(naturalBranch, /generate_image|start_skill_job/);
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

test('Runtime preserves direct ImageGen task identity locally', () => {
  const source = read(routePath);
  const mainAgentStart = source.indexOf('const mainAgentRegistry = createAgentToolRegistry');
  const directStart = source.indexOf('generateImage: async (args: Record<string, unknown>, context:', mainAgentStart);
  const directEnd = source.indexOf('getConversationMemory:', directStart);
  const direct = source.slice(directStart, directEnd);
  assert.match(direct, /referenceIds\.some\(\(id\) => !runtimeReferenceById\.has\(id\)\)/);
  assert.match(direct, /requestedAspectRatio \|\| selectedSkill\?\.aspectRatio \|\| AGENT_DEFAULT_IMAGE_OPTIONS\.aspectRatio/);
  assert.match(direct, /assertImageExecutionContract\(/);
  assert.match(direct, /lockedImageToolArgs = imageExecutionContract/);
  assert.match(direct, /emitIntentResolved\('image'\)/);
  assert.doesNotMatch(direct, /executionPlanToImageDeliveryPlan|executionPlanToBrief/);
});

test('Main Agent reads ImageGen and the locked visual Skill together before writing the prompt', () => {
  const source = read(routePath);
  const mainAgent = read(mainAgentPath);
  assert.match(source, /hostSkill: \{ id: IMAGEGEN_HOST_SKILL_ID, content: hostContent, contentHash: hostContentHash \}/);
  assert.doesNotMatch(source, /lockedSkillContract:/);
  assert.match(mainAgent, /运行时先加载 ImageGen 方法/);
  assert.match(mainAgent, /ImageGen 负责判断生成\/编辑.*Prompt 结构/);
  assert.doesNotMatch(source, /validateSkillPromptAssertions|missingCompiledPromptLiterals/);
});

test('image execution telemetry proves the single-agent contract', () => {
  const source = read(routePath);
  for (const field of [
    'imagegenLoaded',
    'visualSkillLoaded',
    'selectedSkillId',
    'skillContentLength',
    'skillContentHash',
    'mainAgentRequestCount',
    'plannerRequestCount',
    'directGenerateImageCall',
    'finalPromptLength',
  ]) {
    assert.match(source, new RegExp(field));
  }
  assert.match(source, /const plannerRequestCount = 0/);
  assert.match(source, /main_agent\.direct_generate_image/);
});

test('direct ImageGen does not invoke Planner transport from the active route', () => {
  const routeSource = read(routePath);
  const mainAgentStart = routeSource.indexOf('const mainAgentRegistry = createAgentToolRegistry');
  const directStart = routeSource.indexOf('generateImage: async (args: Record<string, unknown>, context:', mainAgentStart);
  const directEnd = routeSource.indexOf('getConversationMemory:', directStart);
  const activeSource = routeSource.slice(directStart, directEnd);
  assert.match(activeSource, /lockedImageToolArgs = imageExecutionContract/);
});

test('direct image execution and confirmation reuse the complete locked tool arguments', () => {
  const source = read(routePath);
  const pipelineStart = source.indexOf('if (shouldUseImagePipeline)');
  assert.ok(pipelineStart >= 0);
  assert.match(source, /const imageContract = assertImageExecutionContract\(lockedImageToolArgs/);
  assert.match(source, /const imageToolArgs = imageContract \|\|/);
  assert.match(source, /toolArgs: structuredClone\(imageToolArgs\)/);
  assert.match(source, /args: structuredClone\(imageToolArgs\)/);
  assert.match(source, /executeAgentTool\(toolRegistry, 'generate_image', imageToolArgs/);
  assert.doesNotMatch(source, /executeAgentTool\(toolRegistry, 'generate_image', \{\}/);
});

test('failed tasks are supplied to the same Main Agent recovery loop', () => {
  const route = read(routePath);
  const page = read(pagePath);
  const mainAgent = read(mainAgentPath);

  assert.match(page, /getLatestAgentRecoveryForTask\(chatMessages, options\.recoveryRecord\.taskId\)/);
  assert.match(page, /recentFailedTask: recentRecoveryTask/);
  assert.match(page, /recoveryRecord: recovery/);
  assert.doesNotMatch(page, /skill: activeSkill \|\| sourceMessage\.skill/);
  assert.match(page, /effectiveAgentClarification\?\.state\.sourceUserMessageId/);
  assert.match(route, /normalizeRecentFailedTask\(body\.recentFailedTask, body\.messages\)/);
  assert.doesNotMatch(route, /buildFailedTaskRecoveryMessages/);
  assert.doesNotMatch(route, /const runRecoveryGate/);
  assert.match(route, /recoveryCandidateForAgent \? \['handle_failed_task'\] : \[\]/);
  assert.match(route, /handleFailedTask: async/);
  assert.match(route, /recentFailedTask: recoveryCandidateForAgent/);
  assert.match(route, /recoveryHistoryMessages = cropMessagesToRecoverySource/);
  assert.match(route, /knownVisualReferenceIds = new Set/);
  assert.match(route, /recoveryRecord\.skillId \|\| null/);
  assert.match(route, /reserveTaskExecution\([\s\S]{0,500}recoveryTaskIdForExecution/);
  assert.match(route, /preserveRecoveryRecordOnFailure && recoveryBaseRecord[\s\S]{0,120}\? recoveryBaseRecord/);
  assert.match(route, /recoveryResolution\?\.decision === 'continue_current_request'[\s\S]{0,160}recoveryBaseRecord = null[\s\S]{0,100}preserveRecoveryRecordOnFailure = false/);
  assert.match(route, /!nextSnapshot\?\.activeVersions\.length && previousSnapshot[\s\S]{0,80}\? previousSnapshot/);
  assert.match(route, /recoveryRevisionMessage/);
  assert.match(route, /rewindAgentAnalysis/);
  assert.doesNotMatch(route, /rewindImagePlanning|AgentImagePlanningStage|imagePlanning/);
  assert.doesNotMatch(route, /recoveryRevisionMessage[\s\S]{0,800}\/(?:prompt|提示词|关键词)/);
  assert.doesNotMatch(route, /const runRecoveryGate/);
  assert.match(route, /const src = version\.assetUrl \|\| entity\?\.assetUrl/);
  assert.match(mainAgent, /同一个 Main Agent 流程/);
  assert.match(mainAgent, /不得调用独立恢复门控模型/);
  assert.match(mainAgent, /action=inspect/);
  assert.match(mainAgent, /action=resume/);
  assert.match(route, /let recoveryBaseRecord: AgentRecoveryRecord \| null = null/);
  assert.match(route, /recoveryBaseRecord = recoveryRecord/);
  assert.match(route, /selectedSkill = null;[\s\S]{0,120}skillSource = null/);
});

test('explicit image UI requests stay in the image domain without forcing an entry tool', () => {
  const route = read(routePath);
  assert.match(route, /body\.intent === 'image'/);
  assert.match(route, /toolChoice:\s*'auto'/);
  assert.match(route, /requireInitialTool: ''/);
  assert.doesNotMatch(route, /explicitImageEntryRequired/);
});

test('Main Agent image contracts execute directly without a Prompt Planner', () => {
  const source = read(routePath);
  const imagePipeline = source.indexOf('if (shouldUseImagePipeline)');
  const directTool = source.indexOf("executeAgentTool(toolRegistry, 'generate_image'", imagePipeline);
  const completed = source.indexOf("writeAgentDone('image_generated')", directTool);
  assert.ok(imagePipeline >= 0 && directTool > imagePipeline && completed > directTool);
  assert.match(source, /const finalGenerationPrompt = String\(imageContract\?\.prompt \|\| ''\)\.trim\(\)/);
  assert.match(source, /const imageToolArgs = imageContract \|\|/);
  assert.match(source, /let directImageExecution: DirectImageExecutionState \| null = null/);
  assert.match(source, /directImageExecution = \{/);
  assert.doesNotMatch(source, /toInternalImageExecutionState/);
  assert.doesNotMatch(source.slice(imagePipeline, completed), /generation!\.prompt|executionPlan\.generation\.prompt/);
});

test('long-running image supplier calls keep the Agent delivery stream active', () => {
  const source = read(routePath);
  const heartbeat = source.indexOf('startAgentImageGenerationHeartbeat');
  const settle = source.indexOf('await settleCanvasImageGenerationRequests', heartbeat);
  const stop = source.indexOf('stopImageGenerationHeartbeat()', settle);
  assert.ok(heartbeat >= 0 && settle > heartbeat && stop > settle);
  assert.match(source, /onPulse:[\s\S]{0,180}writeToolProgress\('generate_image', 'active', heartbeatToolCallId\)/);
  assert.match(source, /const heartbeatToolCallId = streamOptions\?\.toolCallId/);
  assert.match(source, /toolCallId: heartbeatToolCallId/);
  assert.match(source, /canvasContext: body\.canvasContext,\n\s*toolCallId,/);
});

test('Main Agent image Skill Prompt is passed directly to image generation', () => {
  const source = read(routePath);
  const finalPrompt = source.indexOf("const finalGenerationPrompt = String(imageContract?.prompt || '').trim()");
  assert.ok(finalPrompt >= 0);
  assert.match(source, /prompt: finalGenerationPrompt/);
  assert.match(source, /sourcePrompt: finalGenerationPrompt/);
  assert.doesNotMatch(source, /const finalGenerationPrompt = String\(generationPrompt/);
  assert.doesNotMatch(source, /validateSkillPromptAssertions|missingCompiledPromptLiterals/);
  assert.doesNotMatch(source, /submitImagePromptCompilation|imagePlanning\.promptRepair/);
});

test('image execution never falls back from tool Prompt to legacy brief fields', () => {
  const source = read(routePath);
  const payloadStart = source.indexOf('const generateImagePayload = async');
  const payloadEnd = source.indexOf('const writeResolvedImageOptionUpdate', payloadStart);
  const payload = source.slice(payloadStart, payloadEnd);
  assert.doesNotMatch(payload, /generationBrief|executionBrief|\bgenerationPrompt\b|promptCompilation/);
  const imageStart = source.indexOf('if (shouldUseImagePipeline)');
  const imageEnd = source.indexOf('const imageToolArgs =', imageStart);
  const image = source.slice(imageStart, imageEnd);
  assert.match(image, /imageContract\?\.prompt/);
  assert.doesNotMatch(image, /generation!\.prompt|executionPlan\.generation\.prompt/);
});

test('image Prompt provenance is hashed and verified through the supplier bridge', () => {
  const route = read(routePath);
  const generate = read(path.resolve(import.meta.dirname, '../../api/generate/route.ts'));
  assert.match(route, /function hashPrompt\(value: unknown\)/);
  assert.match(route, /finalPromptHash/);
  assert.match(route, /supplierPromptHash/);
  assert.match(route, /供应商回执 Prompt 与 Main Agent Prompt 不一致/);
  assert.match(route, /promptHash: hashPrompt\(prompt\)/);
  assert.match(generate, /function hashPrompt\(value: unknown\)/);
  assert.match(generate, /supplierPromptHash/);
  assert.doesNotMatch(generate, /loadSkillContent\(skill\)[\s\S]{0,300}resolved\.intent === "image"/);
});

test('image Skill selection is explicit and does not use trigger similarity in the route', () => {
  const route = read(routePath);
  assert.match(route, /resolveExplicitSkillDirective\(latestUserMessage, skillManifests\)/);
  assert.doesNotMatch(route, /findDirectSkillMatches\(|hasDirectSkillExecutionIntent\(/);
  assert.doesNotMatch(route, /selectSkillForPrompt\(/);
  assert.match(route, /selectedSkill = null;[\s\S]{0,180}skillSelectionMethod = 'none'/);
});

test('image-capable Skills bypass the legacy second-model clarifier', () => {
  const route = read(routePath);
  assert.doesNotMatch(route, /resolveBriefClarification|shouldRunClarifier|compileExecutionBrief/);
  assert.match(route, /runMainAgentOnce/);
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

test('server owns run identity and stale interactions have a recovery path', () => {
  const route = read(routePath);
  const page = read(pagePath);
  assert.match(route, /clientRunId\?: string/);
  assert.match(route, /const runId = randomUUID\(\)/);
  assert.match(route, /registerActiveAgentRun\(runId, initialAgentIdentity\)/);
  assert.match(route, /writeLifecycleEvent/);
  assert.match(route, /code: 'stale_operation'/);
  assert.match(page, /clientRunId:\s*agentRunId/);
  assert.match(page, /agentInteractionStale/);
  assert.match(page, /重新打开任务/);
});

test('Main Agent streams visible text activity without exposing reasoning and has no app wall-clock timeout', () => {
  const source = read(routePath);
  assert.match(source, /assistantMessageEvent\?\.type === 'text_delta'/);
  assert.match(source, /const commitCurrentActivity =/);
  assert.match(source, /onAssistantTurnComplete: handleAssistantTurnComplete/);
  assert.match(source, /onToolUpdate:/);
  assert.match(source, /onToolResult:/);
  const activityStart = source.indexOf('const appendActivityText =');
  const activityEnd = source.indexOf('const emitMainAgentEvent =', activityStart);
  assert.ok(activityStart >= 0 && activityEnd > activityStart);
  assert.doesNotMatch(source.slice(activityStart, activityEnd), /maxLength|boundedDelta|1200/);
  assert.match(source, /const runSignal = request\.signal/);
  assert.doesNotMatch(source, /AGENT_RUN_TIMEOUT_MS|timeoutSignal/);
  assert.doesNotMatch(source, /assistantMessageEvent\?\.type === 'thinking_delta'/);
});

test('every Pi run path uses the shared live event adapter', () => {
  const source = read(routePath);
  assert.equal((source.match(/runZFlowAgentBrain\(/g) || []).length, 3);
  assert.equal((source.match(/onEvent: emitMainAgentEvent/g) || []).length, 3);
  assert.equal((source.match(/onAssistantTurnComplete: handleAssistantTurnComplete/g) || []).length, 3);
  assert.equal((source.match(/onToolUpdate: writeToolUpdate/g) || []).length, 3);
});

test('direct image execution keeps prompt and supplier stages tied to real work', () => {
  const source = read(routePath);
  assert.doesNotMatch(source, /正在等待模型规划/);
  assert.match(source, /type: 'image_prompts_ready'/);
  assert.match(source, /finalPromptLength/);
  assert.match(source, /writeToolProgress\('generate_image', 'active', heartbeatToolCallId\)/);
  assert.doesNotMatch(source, /正在提交图片生成请求|图片生成请求已提交|正在等待图片生成结果/);
});

test('image execution records terminal checkpoints and maps aborts explicitly', () => {
  const source = read(routePath);
  assert.match(source, /main_agent\.direct_generate_image/);
  assert.match(source, /stage: 'supplier_dispatch_start'/);
  assert.match(source, /stage: 'supplier_dispatch_complete'/);
  assert.match(source, /stage: 'asset_delivery_ready'/);
  assert.match(source, /agent\.failure/);
  assert.match(source, /type: aborted \? 'agent_cancelled' : 'agent_error'/);
  assert.match(source, /request\.signal\.aborted/);
});

test('Main Agent keepalive emits bounded activity during long requests', () => {
  const source = read(routePath);
  assert.match(source, /startAgentImageGenerationHeartbeat\(\{\s*intervalMs: 10_000/);
  assert.match(source, /main_agent\.keepalive/);
  assert.match(source, /Main Agent 仍在处理当前请求/);
});

test('Main Agent image contract does not create supplier-generation progress', () => {
  const source = read(routePath);
  const mainAgentStart = source.indexOf('const runMainAgentOnce =');
  const mainAgentEnd = source.indexOf('rerunMainAgent = runMainAgentOnce;', mainAgentStart);
  const mainAgentCallbacks = source.slice(mainAgentStart, mainAgentEnd);
  assert.ok(mainAgentStart >= 0 && mainAgentEnd > mainAgentStart);
  assert.match(mainAgentCallbacks, /rememberToolPublicProgress\(id, name, args\)/);
  assert.match(mainAgentCallbacks, /onToolStart:[\s\S]{0,180}if \(name !== 'generate_image'\) writeToolProgress\(name, 'active', id\)/);
  assert.match(mainAgentCallbacks, /onToolResult:[\s\S]{0,240}if \(name !== 'generate_image'\) writeToolProgress\(name, isError \? 'failed' : 'completed', id, summarizePublicToolResult\(result\)\)/);
  assert.match(source, /const toolCallId = directGenerateImageCallId \|\| `\$\{runId\}-generate-image-1`;\n\s*copyToolPublicProgress\(toolCallId, imagePublicProgress, 'generate_image'\);\n\s*writeToolProgress\('generate_image', 'active', toolCallId\)/);
});

test('supplier completion is emitted before generated-asset delivery', () => {
  const source = read(routePath);
  const directStart = source.indexOf('const generationPayload = await executeAgentTool');
  const directEnd = source.indexOf("writeAgentDone('image_generated')", directStart);
  const direct = source.slice(directStart, directEnd);
  assert.ok(direct.indexOf("writeToolProgress('generate_image', 'completed', toolCallId)") < direct.indexOf('createAgentToolResultEvents'));
  const confirmedStart = source.indexOf('confirmationRecord.status = \'completed\';');
  const confirmedEnd = source.indexOf('updateTopicMemory({', confirmedStart);
  const confirmed = source.slice(confirmedStart, confirmedEnd);
  assert.ok(confirmed.indexOf("writeToolProgress(confirmationRecord.toolName, 'completed', toolCallId)") < confirmed.indexOf('createAgentToolResultEvents'));
});

test('Main Agent prompt uses natural completion and direct ImageGen', () => {
  const source = read(mainAgentPath);
  assert.doesNotMatch(source, /finish_main_agent_turn/);
  assert.match(source, /直接用普通文本回答，不创建任务/);
  assert.match(source, /submit_agent_analysis_checkpoint/);
  assert.match(source, /request_user_decision/);
  assert.match(source, /generate_image/);
  assert.match(source, /运行时先加载 ImageGen 方法和已锁定的视觉 Skill/);
  assert.doesNotMatch(source, /submit_image_context_analysis|submit_image_brief|submit_image_prompt_compilation/);
  assert.doesNotMatch(source, /调用 submit_image_execution_plan/);
  assert.match(source, /运行时先加载 ImageGen 方法/);
  assert.match(source, /不得声称已执行尚未发生的生成或变更/);
});

test('vendor-specific compatibility does not define the Main Agent protocol', () => {
  const mainAgent = read(mainAgentPath);
  const runtime = read(runtimePath);
  assert.doesNotMatch(`${mainAgent}\n${runtime}`, /xiaomi|mimo|tool_choice\.name/i);
});
