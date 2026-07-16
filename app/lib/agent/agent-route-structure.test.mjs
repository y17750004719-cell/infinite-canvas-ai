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

test('agent route resolves continuation context and final execution intent before announcing it', () => {
  const source = fs.readFileSync(routePath, 'utf8');
  assert.match(source, /resolveAgentConversationIntent/);
  assert.match(source, /const initialBriefSource = conversationIntent\.brief \|\| latestUserMessage/);
  assert.match(source, /let executionBrief = executionBriefData\.plainText/);
  assert.match(source, /conversationIntent\.inherited[\s\S]{0,120}conversationIntent\.intent/);
  assert.match(source, /if \(intent === 'chat' && selectedSkillExecutionRequest\) \{[\s\S]{0,80}intent = 'skill_action'/);
  const executionIntentIndex = source.indexOf("intent = 'skill_action';");
  const resolvedEventIndex = source.indexOf("writeEvent(controller, { type: 'intent_resolved', intent });", executionIntentIndex);
  assert.ok(executionIntentIndex >= 0 && resolvedEventIndex > executionIntentIndex);
  assert.match(source, /originalRequest:\s*executionBrief/);
  assert.match(source, /workingBrief:\s*executionBrief/);
});

test('agent route rejects unbacked execution claims and requests a real mutation tool', () => {
  const source = fs.readFileSync(routePath, 'utf8');
  assert.match(source, /requireMutationTool:\s*intent === 'image' \|\| intent === 'skill_action'/);
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
  assert.match(source, /if \(intent === 'image' && !selectedSkill\)/);
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
  assert.match(source, /本次将生成 \$\{requestedImageCount\} 张图片，确认后继续/);
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
  assert.match(source, /ratioFallback/);
  assert.doesNotMatch(source, /aspect_ratio:\s*imageOptions\?\.aspectRatio/);
  assert.doesNotMatch(source, /size:\s*imageOptions\?\.size/);
  assert.doesNotMatch(source, /quality:\s*imageOptions\?\.quality/);
  assert.doesNotMatch(source, /n:\s*imageOptions\?\.count/);
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

test('explicit multi-image requests bypass automatic proposals and model routing', () => {
  const source = fs.readFileSync(routePath, 'utf8');
  assert.match(source, /const explicitBatchImageRequest = !body\.activeSkillId/);
  assert.match(source, /conversationIntent\.intent === 'image'[\s\S]*\|\| isPotentialDesignExecutionRequest\(initialBriefSource\)/);
  assert.match(source, /isPotentialDesignExecutionRequest\(initialBriefSource\)/);
  assert.match(source, /isReferentialShorthand\(latestUserMessage\)/);
  assert.match(source, /source: 'deterministic_batch'/);
  assert.match(source, /contextResolutionSkipped/);
  assert.match(source, /event: 'routing\.resolved'|routing\.resolved/);
  const batchGate = source.indexOf('const explicitBatchImageRequest');
  const contextResolution = source.indexOf('resolveContextReference({', batchGate);
  const modelRouting = source.indexOf('await routeAgentRequest({', contextResolution);
  assert.ok(batchGate >= 0 && contextResolution > batchGate && modelRouting > contextResolution);
});

test('series batches persist distinct prompts and retry failed issue ids', () => {
  const source = fs.readFileSync(routePath, 'utf8');
  assert.match(source, /resolveImageBatchMode\(executionBrief, requestedTotalImageCount\)/);
  assert.match(source, /outputCount: requestedTotalImageCount/);
  assert.match(source, /batchMode: imageBatchMode/);
  assert.match(source, /generationItems: structuredClone\(generationItems\)/);
  assert.match(source, /remainingGenerationItems/);
  assert.match(source, /generationPrompts: effectiveGenerationItems\.map/);
  assert.match(source, /failedItemIds/);
  assert.match(source, /resolveAgentImageBatchContinuation/);
});
