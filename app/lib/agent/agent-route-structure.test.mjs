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

test('Main Agent gates image execution on an explicit ImageGen-context read', () => {
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
  assert.match(modelToolNames, /read_imagegen_context/);
  assert.match(modelToolNames, /generate_image/);
  assert.match(source, /!mainAgentLoopState\.skillRead \? 'read_imagegen_context' : 'generate_image'/);
  assert.match(source, /skillRead: hasExplicitImagegenContextTranscript\(restoredMainAgentLoop\)/);
  assert.match(source, /manifests: selectedSkill \? \[selectedSkill\] : \[\]/);
});

test('image tasks submit one direct ImageGen contract before execution', () => {
  const source = read(routePath);
  assert.match(source, /generateImage: async \(args: Record<string, unknown>, context: \{ publicProgress\?: unknown \}\)/);
  assert.match(source, /const prompt = String\(args\.prompt \|\| ''\)\.trim\(\)/);
  assert.match(source, /const directPlan: AgentExecutionPlan/);
  assert.match(source, /executionPlan = directPlan/);
  assert.match(source, /completeImagePlanningStage\(imagePlanning, 'routing', 'execution'\)/);
  assert.doesNotMatch(source, /loopResult = await runStagedImagePlanning\(\)/);
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

test('Main Agent naturally completes with text and direct ImageGen keeps stable IDs', () => {
  const source = read(routePath);
  assert.match(source, /Main Agent returned an empty response/);
  assert.doesNotMatch(source, /Main Agent ended without a valid terminal tool/);
  assert.match(source, /type: 'image_execution_plan'/);
  assert.match(source, /referenceIds\.some\(\(id\) => !runtimeReferenceById\.has\(id\)\)/);
  assert.match(source, /targetReferenceId = operation === 'edit' \? requestedTargetReferenceId : null/);
  assert.match(source, /type: 'image_execution_plan'/);
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

test('Runtime preserves direct ImageGen task identity locally', () => {
  const source = read(routePath);
  const mainAgentStart = source.indexOf('const mainAgentRegistry = createAgentToolRegistry');
  const directStart = source.indexOf('generateImage: async (args: Record<string, unknown>, context:', mainAgentStart);
  const directEnd = source.indexOf('getConversationMemory:', directStart);
  const direct = source.slice(directStart, directEnd);
  assert.match(direct, /referenceIds\.some\(\(id\) => !runtimeReferenceById\.has\(id\)\)/);
  assert.match(direct, /requestedAspectRatio \|\| imagePlanningDefaults\.aspectRatio \|\| selectedSkill\?\.aspectRatio/);
  assert.match(direct, /deliveryMode === 'series' && generationItems\.length !== outputCount/);
  assert.match(direct, /generation: \{ aspectRatio, promptFormat: 'text', prompt, items: generationItems \}/);
  assert.match(direct, /lockedImageToolArgs = \{/);
  assert.match(direct, /emitIntentResolved\('image'\)/);
  assert.doesNotMatch(direct, /executionPlanToImageDeliveryPlan|executionPlanToBrief/);
});

test('Main Agent reads ImageGen and the locked visual Skill together before writing the prompt', () => {
  const source = read(routePath);
  const mainAgent = read(mainAgentPath);
  assert.match(source, /readImagegenContext: async \(\) => \{/);
  assert.match(source, /const context = await loadImagegenContext\(\{ source: 'model' \}\)/);
  assert.match(source, /modelResult: context/);
  assert.match(source, /publicResult: \{/);
  assert.match(source, /hostSkill: \{ id: context\.hostSkill\.id, contentHash: context\.hostSkill\.contentHash \}/);
  assert.match(source, /hostSkill: \{ id: IMAGEGEN_HOST_SKILL_ID, content: hostContent, contentHash: hostContentHash \}/);
  assert.doesNotMatch(source, /lockedSkillContract:/);
  assert.match(mainAgent, /先调用 read_imagegen_context/);
  assert.match(mainAgent, /ImageGen 方法负责 Prompt 组织/);
  assert.doesNotMatch(source, /validateSkillPromptAssertions|missingCompiledPromptLiterals/);
});

test('direct ImageGen does not invoke Planner transport from the active route', () => {
  const routeSource = read(routePath);
  const mainAgentStart = routeSource.indexOf('const mainAgentRegistry = createAgentToolRegistry');
  const directStart = routeSource.indexOf('generateImage: async (args: Record<string, unknown>, context:', mainAgentStart);
  const directEnd = routeSource.indexOf('getConversationMemory:', directStart);
  const activeSource = routeSource.slice(directStart, directEnd);
  assert.doesNotMatch(activeSource, /planAgentExecutionRequest|AGENT_PLANNER_PROVIDER_ID|AGENT_PLANNER_MODEL/);
  assert.match(activeSource, /executionPlan = directPlan/);
});

test('direct image execution and confirmation reuse the complete locked tool arguments', () => {
  const source = read(routePath);
  const pipelineStart = source.indexOf('if (shouldUseImagePipeline)');
  const pipelineEnd = source.indexOf("if (executionPlan) {", pipelineStart);
  const pipeline = source.slice(pipelineStart, pipelineEnd);
  assert.match(pipeline, /const imageToolArgs = lockedImageToolArgs/);
  assert.match(pipeline, /toolArgs: structuredClone\(imageToolArgs\)/);
  assert.match(pipeline, /args: structuredClone\(imageToolArgs\)/);
  assert.match(pipeline, /executeAgentTool\(toolRegistry, 'generate_image', imageToolArgs/);
  assert.doesNotMatch(pipeline, /executeAgentTool\(toolRegistry, 'generate_image', \{\}/);
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
  assert.match(source, /onPulse:[\s\S]{0,180}writeToolProgress\('generate_image', 'active', heartbeatToolCallId\)/);
  assert.match(source, /const heartbeatToolCallId = streamOptions\?\.toolCallId/);
  assert.match(source, /toolCallId: heartbeatToolCallId/);
  assert.match(source, /canvasContext: body\.canvasContext,\n\s*toolCallId,/);
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
  assert.equal((source.match(/runZFlowAgentBrain\(/g) || []).length, 5);
  assert.equal((source.match(/onEvent: emitMainAgentEvent/g) || []).length, 5);
  assert.equal((source.match(/onAssistantTurnComplete: handleAssistantTurnComplete/g) || []).length, 5);
  assert.equal((source.match(/onToolUpdate: writeToolUpdate/g) || []).length, 5);
});

test('deterministic image execution keeps prompt and supplier stages tied to real work', () => {
  const source = read(routePath);
  assert.doesNotMatch(source, /正在等待模型规划/);
  assert.match(source, /type: 'image_prompts_ready'[\s\S]{0,300}completedLabel: imageProgress\?\.promptPreparation\?\.completedLabel/);
  assert.match(source, /completionSummary: imageProgress\?\.promptPreparation\?\.completionSummary/);
  assert.match(source, /writePromptPreparationProgress\('active', heartbeatToolCallId\)/);
  assert.match(source, /writeToolProgress\('generate_image', 'active', heartbeatToolCallId\)/);
  assert.doesNotMatch(source, /正在提交图片生成请求|图片生成请求已提交|正在等待图片生成结果/);
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
  assert.match(source, /const toolCallId = `\$\{runId\}-generate-image-1`;\n\s*copyToolPublicProgress\(toolCallId, imagePublicProgress, 'generate_image'\);\n\s*writeToolProgress\('generate_image', 'active', toolCallId\)/);
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
  assert.match(source, /获得 ImageGen 方法和可选的已选视觉 Skill；再结合用户需求和稳定参考图写出最终 Prompt/);
  assert.doesNotMatch(source, /submit_image_context_analysis|submit_image_brief|submit_image_prompt_compilation/);
  assert.doesNotMatch(source, /调用 submit_image_execution_plan/);
  assert.match(source, /先调用 read_imagegen_context/);
  assert.match(source, /不得声称已执行尚未发生的生成或变更/);
});

test('vendor-specific compatibility does not define the Main Agent protocol', () => {
  const mainAgent = read(mainAgentPath);
  const runtime = read(runtimePath);
  assert.doesNotMatch(`${mainAgent}\n${runtime}`, /xiaomi|mimo|tool_choice\.name/i);
});
