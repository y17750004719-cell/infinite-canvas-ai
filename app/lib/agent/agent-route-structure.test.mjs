import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const routePath = path.resolve(import.meta.dirname, '../../api/agent/route.ts');
const generateRoutePath = path.resolve(import.meta.dirname, '../../api/generate/route.ts');
const apiClientPath = path.resolve(import.meta.dirname, '../api-client.ts');
const agentEventsPath = path.resolve(import.meta.dirname, 'events.ts');
const agentLoopPath = path.resolve(import.meta.dirname, 'agent-loop.mjs');

test('agent route exposes NDJSON orchestration events and reuses the generate route', () => {
  const source = fs.readFileSync(routePath, 'utf8');
  const orchestrationSource = `${source}\n${fs.readFileSync(agentLoopPath, 'utf8')}`;
  for (const eventType of [
    'agent_start',
    'routing_start',
    'intent_resolved',
    'proposal_presented',
    'context_resolved',
    'brief_compiled',
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
    assert.match(orchestrationSource, new RegExp(`['\"]${eventType}['\"]`));
  }
  assert.match(source, /\/api\/generate/);
  assert.doesNotMatch(source, /fetch\(new URL\('\/api\/generate'/);
  assert.match(source, /generatePost/);
  assert.match(source, /executeAgentTool/);
  assert.match(source, /routeAgentRequest/);
  assert.match(source, /planAgentExecutionRequest/);
  assert.match(source, /executionPlanToImageDeliveryPlan/);
  assert.match(source, /decisionSource:\s*plannerResult\.source/);
  assert.match(source, /resolveBriefClarification/);
  assert.match(source, /shouldAskClarification/);
  assert.match(source, /clarificationResponse/);
  assert.match(source, /clarificationResponse\.retry/);
  assert.match(source, /clarificationState/);
  assert.match(source, /workingBrief/);
  assert.match(source, /buildMainAgentMessages/);
  assert.match(source, /runAgentLoop/);
  assert.match(source, /getAgentModelTools/);
  assert.match(source, /maxTurns:\s*MAX_AGENT_TURNS/);
  assert.match(source, /maxToolCalls:\s*MAX_TOOL_CALLS/);
  assert.match(source, /onToolResult:\s*\(\{ id, name, result \}\)/);
  assert.match(source, /createAgentToolResultEvents/);
  assert.match(source, /source:\s*skillSource \|\| 'auto'/);
  assert.match(source, /application\/x-ndjson/);
});

test('agent region prompts use compacted context and preserve the region-aware planner prompt', () => {
  const source = fs.readFileSync(routePath, 'utf8');
  assert.match(source, /compactCanvasContext\(canvasContext\)/);
  assert.match(source, /\? regionAwareOptimizedResult\.prompt/);
  assert.match(source, /ensureOptimizedPromptCoverage\(regionAwareOptimizedResult\.prompt/);
});

test('agent route resolves context references before clarification optimization and tools', () => {
  const source = fs.readFileSync(routePath, 'utf8');
  assert.match(source, /resolveContextReference/);
  assert.match(source, /compileExecutionBrief/);
  assert.match(source, /ensureOptimizedPromptCoverage/);
  assert.match(source, /contextEntities\?:\s*AgentContextEntity\[\]/);
  assert.match(source, /selectedContextEntityIds\?:\s*string\[\]/);
  assert.match(source, /contextResolution\.status === 'resolved'/);
  assert.match(source, /dimension:\s*'context_reference'/);
  assert.match(source, /stopReason:\s*'context_reference_required'/);
  assert.match(source, /userMessage:\s*executionBrief/);
  const contextGate = source.indexOf('if (!body.clarificationResponse && contextResolution.detected)');
  const optimizer = source.indexOf('await optimizeImagePrompt', contextGate);
  const imageTool = source.indexOf("executeAgentTool(toolRegistry, 'generate_image'", contextGate);
  assert.ok(contextGate >= 0 && optimizer > contextGate && imageTool > optimizer);
});

test('agent route strips structured proposals and emits public proposal events', () => {
  const source = fs.readFileSync(routePath, 'utf8');
  assert.match(source, /parseAgentProposalBlock/);
  assert.match(source, /type:\s*'proposal_presented'/);
  assert.match(source, /loopProposal\.cleanContent/);
  assert.match(source, /streamedProposal\.cleanContent/);
});

test('agent route emits versioned semantic progress and keeps asset URLs in client actions', () => {
  const source = fs.readFileSync(routePath, 'utf8');
  const eventsSource = fs.readFileSync(agentEventsPath, 'utf8');
  const loopSource = fs.readFileSync(agentLoopPath, 'utf8');
  assert.match(eventsSource, /type:\s*'progress_update'/);
  assert.match(eventsSource, /version:\s*1/);
  assert.match(loopSource, /createAgentProgressTracker/);
  assert.match(source, /operationId/);
  assert.match(loopSource, /sequence/);
  assert.match(source, /stepId/);
  assert.match(source, /phase/);
  assert.match(source, /status/);
  assert.match(source, /label/);
  assert.match(source, /createAgentToolResultViews/);
  assert.match(source, /createAgentToolResultEvents/);
  assert.doesNotMatch(source, /type:\s*'tool_result',[\s\S]{0,180}result:\s*\{[\s\S]{0,80}assets/);
  assert.match(loopSource, /type:\s*'client_action'[\s\S]{0,180}assets/);
});

test('agent route streams confirmed batch images individually without a duplicate aggregate action', () => {
  const source = fs.readFileSync(routePath, 'utf8');
  const loopSource = fs.readFileSync(agentLoopPath, 'utf8');
  assert.match(source, /onSettled:\s*streamIncrementally/);
  assert.match(source, /type:\s*'add_generated_assets'[\s\S]{0,900}itemId:[\s\S]{0,500}batch:/);
  assert.match(source, /total:\s*requests\.length/);
  assert.match(source, /settled:\s*streamedSettled/);
  assert.match(source, /succeeded:\s*streamedSucceeded/);
  assert.match(source, /failed:\s*streamedFailed/);
  assert.match(source, /includeAssets:\s*!\(result as any\)\?\.streamedAssets/);
  assert.match(loopSource, /includeAssets = true/);
  assert.match(loopSource, /toolName === 'generate_image' && includeAssets/);
});

test('agent route resolves raw user counts before briefs and validates the final request count', () => {
  const source = fs.readFileSync(routePath, 'utf8');
  assert.match(source, /const rawUserCountResolution = plannerAuthoritative[\s\S]{0,220}extractAgentImageCount\(latestUserMessage\)/);
  assert.match(source, /rawUserCountResolution\.status !== 'none'[\s\S]{0,120}rawUserCountResolution[\s\S]{0,80}briefCountResolution/);
  assert.match(source, /rawPrompt:\s*latestUserMessage/);
  assert.match(source, /requests\.length !== payloadOutputCount/);
  assert.match(source, /Number\(request\?\.n\) !== 1/);
  assert.match(source, /image\.requests_built/);
  assert.match(source, /actualRequestCount:\s*requests\.length/);
});

test('agent route resolves continuation context and final execution intent before announcing it', () => {
  const source = fs.readFileSync(routePath, 'utf8');
  assert.match(source, /resolveAgentConversationIntent/);
  assert.match(source, /const initialBriefSource = conversationIntent\.brief \|\| latestUserMessage/);
  assert.match(source, /let executionBrief = executionBriefData\.plainText/);
  assert.match(source, /conversationIntent\.inherited[\s\S]{0,120}conversationIntent\.intent/);
  assert.match(source, /if \(!plannerAuthoritative && !executionPlan && intent === 'chat' && selectedSkillExecutionRequest\) \{[\s\S]{0,80}intent = 'skill_action'/);
  const executionIntentIndex = source.indexOf("intent = 'skill_action';");
  const resolvedEventIndex = source.indexOf("writeEvent(controller, { type: 'intent_resolved', intent });", executionIntentIndex);
  assert.ok(executionIntentIndex >= 0 && resolvedEventIndex > executionIntentIndex);
  assert.match(source, /originalRequest:\s*executionBrief/);
  assert.match(source, /workingBrief:\s*executionBrief/);
});

test('agent route rejects unbacked execution claims and requests a real mutation tool', () => {
  const source = fs.readFileSync(routePath, 'utf8');
  assert.match(source, /requireMutationTool:\s*executionPlan[\s\S]{0,120}Boolean\(executionPlan\.execution\.tool\)[\s\S]{0,120}intent === 'image' \|\| intent === 'skill_action'/);
  assert.match(source, /loopResult\.stopReason === 'execution_required'/);
  assert.match(source, /等待确认真实启动生成/);
  assert.match(source, /sanitizeAgentResponseContent/);
  assert.match(source, /UNBACKED_EXECUTION_CLAIM_PATTERN/);
  assert.match(source, /生成尚未实际启动/);
});

test('confirmation records preserve operation identity and skill source', () => {
  const source = fs.readFileSync(routePath, 'utf8');
  assert.match(source, /operationId:\s*string/);
  assert.match(source, /skillSource:\s*'manual'\s*\|\s*'auto'\s*\|\s*null/);
  assert.match(source, /lastSequence:\s*number/);
  assert.match(source, /progressToolCallId\?:\s*string/);
  assert.match(source, /operationId,/);
  assert.match(source, /skillSource,/);
  assert.match(source, /lastSequence:/);
  assert.match(source, /createAgentProgressTracker/);
  assert.match(source, /settleActive\(\s*'failed'/);
  assert.match(source, /confirmationRecord\.progressToolCallId/);
});

test('image generation progress has one outer tool lifecycle', () => {
  const source = fs.readFileSync(routePath, 'utf8');
  const payloadStart = source.indexOf('const generateImagePayload = async');
  const payloadEnd = source.indexOf('const writeResolvedImageOptionUpdate', payloadStart);
  const payloadSource = source.slice(payloadStart, payloadEnd);

  assert.ok(payloadStart >= 0 && payloadEnd > payloadStart);
  assert.doesNotMatch(payloadSource, /writeProgress\(\{ stepId: 'generate_image'/);
  assert.match(source, /writeToolProgress\('generate_image', 'active', toolCallId\)/);
  assert.match(source, /writeToolProgress\('generate_image', 'completed', toolCallId\)/);
});

test('agent route uses one main-agent message hierarchy for text and referenced chat', () => {
  const source = fs.readFileSync(routePath, 'utf8');
  assert.match(source, /buildMainAgentMessages\(\{/);
  assert.match(source, /referenceImages:\s*executionReferenceImages/);
  assert.doesNotMatch(source, /if \(body\.referenceImages\?\.length\) \{[\s\S]{0,1200}generatePost/);
  assert.match(source, /const shouldUseImagePipeline = executionKind[\s\S]{0,180}executionKind === 'image_pipeline'/);
  assert.doesNotMatch(source, /if \(intent === 'skill_action'\)/);
  assert.match(source, /loadSkillContent\(selectedSkill\.id\)/);
  assert.match(source, /runAgentLoop\(\{/);
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
  assert.match(source, /normalizeAgentImageCount\(body\.imageOptions\?\.count\)/);
  assert.match(source, /describeImageDelivery\(imageDeliveryPlan, requestedImageCount\)/);
  assert.doesNotMatch(source, /channel:\s*'reasoning'/);
  assert.match(source, /clarificationSubmissionStore/);
  assert.match(source, /Clarification response has already been submitted/);
  assert.match(source, /selectedSkill\s*=\s*activeClarificationState\.skillId[\s\S]{0,220}:\s*null/);
  assert.match(source, /clarificationSubmissionStore\.delete\(clarificationSubmissionKey\)/);
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

test('agent image execution reuses the canvas image-card request builders', () => {
  const source = fs.readFileSync(routePath, 'utf8');
  assert.match(source, /buildProviderImageOptionProfiles/);
  assert.match(source, /buildAgentImageGenerationRequests/);
  assert.match(source, /resolveCanvasImageTaskExecutionMode/);
  assert.match(source, /settleCanvasImageGenerationRequests/);
  assert.match(source, /resolvedImageOptions/);
  assert.match(source, /runtimeReferenceContext\s*=\s*normalizeAgentRuntimeReferenceContext/);
  assert.match(source, /referenceContext:\s*runReferenceContext/);
  assert.match(source, /linkedImagePreviews:\s*resolvedReferences\.linkedImagePreviews/);
  assert.match(source, /referenceIds:\s*resolvedReferences\.referenceIds/);
  assert.match(source, /imageOperation:\s*imageTask\?\.operation \|\| 'generate'/);
  assert.match(source, /ratioFallback/);
  assert.doesNotMatch(source, /aspect_ratio:\s*imageOptions\?\.aspectRatio/);
  assert.doesNotMatch(source, /size:\s*imageOptions\?\.size/);
  assert.doesNotMatch(source, /quality:\s*imageOptions\?\.quality/);
  assert.doesNotMatch(source, /n:\s*imageOptions\?\.count/);
});

test('agent rejects unconfirmed region targets before generic image fallback can run', () => {
  const source = fs.readFileSync(routePath, 'utf8');
  const rejectionIndex = source.indexOf("reference?.role === 'region_target' && reference.confirmationStatus !== 'confirmed'");
  const normalizationIndex = source.indexOf('const runtimeReferenceContext = normalizeAgentRuntimeReferenceContext');
  assert.ok(rejectionIndex >= 0 && rejectionIndex < normalizationIndex);
  assert.match(source, /body\.clarificationState\?\.referenceContext/);
  assert.match(source, /Region targets must be explicitly confirmed before sending/);
  assert.match(source, /status: 400/);
});

test('agent preserves model-authored image task and result presentation through confirmations and asset actions', () => {
  const source = fs.readFileSync(routePath, 'utf8');
  assert.match(source, /imageTask:\s*executionPlan\?\.imageTask \? structuredClone/);
  assert.match(source, /presentation:\s*executionPlan\?\.presentation \? structuredClone/);
  assert.match(source, /confirmationRecord\.imageTask/);
  assert.match(source, /confirmationRecord\.presentation/);
  assert.match(source, /presentation\.completionSummary/);
  assert.match(source, /operation:\s*imageTask\?\.operation \|\| 'generate'/);
});

test('agent image confirmations keep optimizer control server-side and report partial request results', () => {
  const source = fs.readFileSync(routePath, 'utf8');
  assert.match(source, /optimizePrompt:\s*false/);
  assert.match(source, /confirmationRecord\.optimizePrompt !== false/);
  assert.doesNotMatch(source, /confirmationRecord\.toolArgs\.optimizePrompt/);
  assert.match(source, /buildCanvasImageGenerationFailureMessage/);
  assert.match(source, /requestFailureCount/);
  assert.match(source, /partialFailureMessage/);
});

test('agent route resolves natural-language output counts before clarification and preserves batch state', () => {
  const source = fs.readFileSync(routePath, 'utf8');
  assert.match(source, /resolveAgentImageCountDecision/);
  assert.match(source, /output_count_ambiguity/);
  assert.match(source, /output_count_batching/);
  assert.match(source, /requestedImageCountSource/);
  assert.match(source, /requestedTotalImageCount/);
  assert.match(source, /imageBatchPlan/);
  assert.match(source, /split_batches/);
  assert.match(source, /first_batch/);
  assert.match(source, /remainingCount/);
  assert.match(source, /completedCount \+ succeeded/);
  assert.match(source, /还需生成 \$\{remainingCount\} 张/);
  const countResolutionIndex = source.indexOf('resolveAgentImageCountDecision');
  const genericClarifierIndex = source.indexOf('resolveBriefClarification', countResolutionIndex);
  assert.ok(countResolutionIndex >= 0 && genericClarifierIndex > countResolutionIndex);
});

test('unified planner is authoritative, supports shadow mode, and survives clarification', () => {
  const source = fs.readFileSync(routePath, 'utf8');
  assert.match(source, /AGENT_UNIFIED_PLANNER_ENABLED/);
  assert.match(source, /AGENT_PLANNER_SHADOW_MODE/);
  assert.match(source, /plannerAuthoritative/);
  assert.match(source, /planner\.shadow/);
  assert.match(source, /executionPlan:\s*structuredClone\(executionPlan\)/);
  assert.match(source, /activeClarificationState\?\.executionPlan/);
  assert.match(source, /legacyExecutionPlanDetected/);
  assert.match(source, /该任务使用旧版分析计划，需要重新分析/);
  assert.match(source, /executionPlan\.execution\.kind/);
  assert.match(source, /plannerSeriesItems/);
  assert.match(source, /sourceDetail: plannerResult\.sourceDetail/);
  assert.match(source, /mutationBlocked: true/);
  assert.match(source, /stage: 'planning'/);
  assert.match(source, /stopReason: 'planner_failed'/);
  assert.match(source, /failureReason/);
  assert.match(source, /reason: plannerFailureReason/);
  assert.match(source, /dimension: 'planner_failure'/);
  assert.match(source, /referenceContext: structuredClone\(runReferenceContext\)/);
  assert.match(source, /const shouldRunClarifier = \(intent === 'image' \|\| intent === 'skill_action'\)[\s\S]*&& !executionPlan/);
  assert.match(source, /deliveryPlan[\s\S]*executionPlanToImageDeliveryPlan\(executionPlan\)/);
  assert.match(source, /buildCanonicalAgentReferenceContext/);
  assert.match(source, /runtimeReferenceId[\s\S]*createHash\('sha256'\)/);
  assert.match(source, /explicitPlannerSelection[\s\S]*plannerHasVisualReferences \? resolvedChatSelection : resolvedRouterSelection/);
  assert.match(source, /AGENT_PLANNER_TIMEOUT_MS/);
  assert.match(source, /referenceContext:\s*runReferenceContext/);
  assert.match(source, /vision_unsupported/);
  assert.match(source, /vision_unavailable/);
  assert.match(source, /const isPlannerFailureRetry/);
  assert.match(source, /body\.clarificationResponse\.retryMode === 'replan'/);
  assert.match(source, /activeClarificationState\.plannerFailure\?\.retryMode === 'replan'/);
  assert.match(source, /isPlannerFailureRetry[\s\S]*activeClarificationState\.executionPlan\?\.needsClarification === true/);
  assert.match(source, /isPlannerFailureRetry[\s\S]*activeClarificationState\.originalRequest/);
  assert.match(source, /plannerFailure:\s*\{[\s\S]*retryMode: 'replan'/);
  assert.match(source, /Agent 混淆了图片引用和画布上下文/);
  assert.match(source, /planner\.clarification_failed/);
  assert.match(source, /activeClarificationState\.executionPlan = structuredClone\(executionPlan\)/);
});

test('authoritative image execution fails closed without a complete planner contract', () => {
  const source = fs.readFileSync(routePath, 'utf8');
  assert.match(source, /if \(plannerAuthoritative\)/);
  assert.match(source, /executionPlan\.execution\.tool !== 'generate_image'/);
  assert.match(source, /!imageTask/);
  assert.match(source, /!presentation/);
  assert.match(source, /executionPlan\.version !== 2/);
  assert.match(source, /!generation/);
  assert.match(source, /referencedTaskWithoutRoles/);
  assert.match(source, /图片计划校验失败，已停止执行/);
});

test('image completion summaries and prompt traces follow generated asset delivery', () => {
  const source = fs.readFileSync(routePath, 'utf8');
  assert.match(source, /promptTraceForRequest/);
  assert.match(source, /finalPrompt: effectiveGenerationItems\[requestIndex\]\?\.prompt \|\| optimized\.prompt/);
  assert.match(source, /type: 'agent_completion_summary'/);
  const directActionIndex = source.indexOf("source: 'direct'");
  const directSummaryIndex = source.indexOf('writeImageCompletionSummary(generationPayload)', directActionIndex);
  assert.ok(directActionIndex >= 0 && directSummaryIndex > directActionIndex);
});

test('explicit multi-image requests preserve deterministic image skills while bypassing proposals', () => {
  const source = fs.readFileSync(routePath, 'utf8');
  assert.match(source, /const explicitBatchImageRequest = !plannerAuthoritative && !body\.activeSkillId/);
  assert.match(source, /conversationIntent\.intent === 'image'[\s\S]*\|\| isPotentialDesignExecutionRequest\(initialBriefSource\)/);
  assert.match(source, /isPotentialDesignExecutionRequest\(initialBriefSource\)/);
  assert.match(source, /isReferentialShorthand\(latestUserMessage\)/);
  assert.match(source, /const deterministicImageSkill = !plannerAuthoritative && !body\.activeSkillId/);
  assert.match(source, /manifest\.executionMode === 'image_pipeline'/);
  assert.match(source, /source: 'deterministic_image_skill'/);
  assert.match(source, /source: 'deterministic_batch'/);
  assert.match(source, /contextResolutionSkipped/);
  assert.match(source, /event: 'routing\.resolved'|routing\.resolved/);
  const batchGate = source.indexOf('const explicitBatchImageRequest');
  const contextResolution = source.indexOf('resolveContextReference({', batchGate);
  const modelRouting = source.indexOf('await routeAgentRequest({', contextResolution);
  assert.ok(batchGate >= 0 && contextResolution > batchGate && modelRouting > contextResolution);
});

test('authoritative image plans use their final generation prompt without prompt optimization', () => {
  const source = fs.readFileSync(routePath, 'utf8');
  assert.match(source, /const plannerGeneration = executionPlan\?\.version === 2 \? executionPlan\.generation : null/);
  assert.match(source, /const usesPlannerGeneration = Boolean\(plannerAuthoritative && plannerGeneration\)/);
  assert.match(source, /prompt: plannerGeneration!\.prompt/);
  assert.match(source, /usesPlannerGeneration[\s\S]*await optimizeImagePrompt/);
  assert.match(source, /optimizePrompt: false/);
});

test('series batches persist distinct prompts and retry failed issue ids', () => {
  const source = fs.readFileSync(routePath, 'utf8');
  assert.match(source, /resolveImageDeliveryPlan\(executionBrief, requestedTotalImageCount\)/);
  assert.match(source, /outputCount: requestedTotalImageCount/);
  assert.match(source, /batchMode: imageBatchMode/);
  assert.match(source, /generationItems: structuredClone\(generationItems\)/);
  assert.match(source, /remainingGenerationItems/);
  assert.match(source, /generationPrompts: effectiveGenerationItems\.map/);
  assert.match(source, /failedItemIds/);
  assert.match(source, /resolveAgentImageBatchContinuation/);
});

test('agent route preserves three-mode image delivery plans through confirmation and requests', () => {
  const source = fs.readFileSync(routePath, 'utf8');
  assert.match(source, /imageDeliveryPlan\?: ImageDeliveryPlan/);
  assert.match(source, /resolvedImageDeliveryMode:\s*'composite'/);
  assert.match(source, /dimension:\s*'image_delivery_scope'/);
  assert.match(source, /applyImagePromptDeliveryContract/);
  assert.match(source, /deliveryMode:\s*payloadDeliveryPlan\.mode/);
  assert.match(source, /panelCount:\s*payloadDeliveryPlan\.panelCount/);
  assert.match(source, /confirmationRecord\.imageDeliveryPlan/);
});
