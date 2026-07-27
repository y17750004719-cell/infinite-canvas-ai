import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const source = fs.readFileSync(path.resolve(import.meta.dirname, '../../page.tsx'), 'utf8');
const globalStyles = fs.readFileSync(path.resolve(import.meta.dirname, '../../globals.css'), 'utf8');
const motionControllerSource = fs.readFileSync(
  path.resolve(import.meta.dirname, '../../components/GsapMotionController.tsx'),
  'utf8',
);
const decisionPopoverSource = fs.readFileSync(
  path.resolve(import.meta.dirname, '../../components/workspace/AgentDecisionPopover.tsx'),
  'utf8',
);
const skillsIconPath = path.resolve(import.meta.dirname, '../../../public/icons/lovart-skills.svg');

function controlIndex(id) {
  return source.indexOf(`data-chat-composer-control="${id}"`);
}

test('right chat defaults to agent and loads skills from the registry api', () => {
  assert.match(source, /type GenerationMode = 'agent' \| 'image' \| 'chat'/);
  assert.match(source, /PROMPT_PIPELINE_AGENT_ENABLED \? 'agent' : 'chat'/);
  assert.match(source, /fetch\('\/api\/skills'/);
});

test('agent mode posts to the agent route and handles agent events', () => {
  assert.match(source, /generationMode === 'agent' \? '\/api\/agent' : '\/api\/generate'/);
  assert.match(source, /routing_start/);
  assert.match(source, /clarification_required/);
  assert.match(source, /agentClarification/);
  assert.match(source, /agentClarificationResponse/);
  assert.match(source, /按当前信息开始制作/);
  assert.match(source, /prompt_optimization_start/);
  assert.match(source, /prompt_optimization_done/);
  assert.match(source, /client_action/);
  assert.match(source, /agent_error/);
});

test('agent clarification uses the shared editable decision popover', () => {
  assert.match(source, /showAgentClarificationModal/);
  assert.match(source, /pendingAgentClarification/);
  assert.match(source, /agentClarificationCustomText/);
  assert.match(source, /<AgentDecisionPopover/);
  assert.match(decisionPopoverSource, /role="dialog"/);
  assert.doesNotMatch(decisionPopoverSource, /aria-modal="true"/);
  assert.match(decisionPopoverSource, /自定义回答|custom\.label/);
  assert.match(source, /按当前信息开始制作/);
  assert.match(source, /\['creative_direction', 'context_reference'\]\.includes/);
  assert.match(source, /retry:\s*true/);
  assert.match(source, /!options\?\.agentClarification/);
  assert.match(source, /agentClarificationResponsePayload/);
  assert.match(source, /agentClarification:\s*sourceMessage\.agentClarificationResponsePayload\.clarification/);
  assert.doesNotMatch(source, /agent-clarification[^\n]*shadow/);
});

test('failed clarification submissions preserve their structured retry context', () => {
  assert.match(source, /AGENT_RETRY_CONFIRMATION_PATTERN/);
  assert.match(source, /latestConversationMessage\.agentRunProgress\?\.outcome === 'failed'/);
  assert.match(source, /retrySourceMessage\?\.agentClarificationResponsePayload\?\.clarification/);
  assert.match(source, /effectiveAgentClarificationResponse/);
  assert.match(source, /agentClarificationResolved:\s*false/);
  assert.match(source, /resolveAgentClarificationMessage\(effectiveAgentClarification\.request\.id\)/);
  assert.match(source, /重试生成/);
  assert.match(source, /persistedReferenceContext/);
  assert.match(source, /referenceContext: currentReferenceContext/);
  assert.match(source, /persistedReferenceContext\?\.references/);
});

test('region targets are snapshotted before composer cleanup and submitted from the frozen data', () => {
  const snapshotIndex = source.indexOf('const regionSelectionSnapshot = buildAgentRegionSelectionSnapshot');
  const cleanupIndex = source.indexOf('if (!options?.suppressUserMessage) clearSentChatReferenceTokens()', snapshotIndex);
  const requestIndex = source.indexOf('const response = await fetch(resolvedRequestEndpoint', cleanupIndex);
  assert.ok(snapshotIndex >= 0);
  assert.ok(cleanupIndex > snapshotIndex);
  assert.ok(requestIndex > cleanupIndex);
  assert.match(source, /regionSelections:\s*regionSelectionSnapshot\.regionSelections/);
  assert.match(source, /定位对象数据已失效，请重新定位/);
});

test('planner failures use one message owner and expose a disabled reanalysis action while running', () => {
  assert.match(source, /failedClarificationOwnsMessage/);
  assert.match(source, /label: '重新分析'/);
  assert.match(source, /disabled: isGenerating/);
  assert.match(source, /agentReanalysisInFlightRef/);
  assert.match(source, /handleGenerate\([\s\S]*\.finally\(\(\) => \{[\s\S]*agentReanalysisInFlightRef\.current = false/);
  assert.match(source, /!pendingAgentClarification\.request\.failed[\s\S]*skipLabel: '按当前信息开始制作'/);
  assert.doesNotMatch(source, /规划模型连接中断，系统已自动重试/);
});

test('agent proposals and context entities persist and submit stable selections', () => {
  assert.match(source, /buildAgentContextEntities/);
  assert.match(source, /contextEntities,/);
  assert.match(source, /selectedContextEntityIds:\s*options\?\.selectedContextEntityIds/);
  assert.match(source, /event\.type === 'proposal_presented'/);
  assert.match(source, /event\.type === 'context_resolved'/);
  assert.match(source, /showAgentProposalModal/);
  assert.match(source, /pendingAgentProposal\.options\.map/);
  assert.match(source, /selectedContextEntityIds:\s*\[option\.entityId\]/);
  assert.match(source, /已采用：/);
  assert.match(source, /\['creative_direction', 'context_reference'\]\.includes/);
});

test('agent progress accumulates reached breadcrumbs without an assistant bubble', () => {
  assert.match(source, /createInitialAgentRunProgress/);
  assert.match(source, /agentRunProgress:\s*generationMode === 'agent'[\s\S]{0,120}createInitialAgentRunProgress\(agentRunId\)/);
  assert.match(source, /reduceAgentRunProgress/);
  assert.match(source, /event\.type === 'progress_update'/);
  assert.match(source, /createAgentProgressEventRouter/);
  assert.match(source, /routeAgentProgressEvent\(progressEventRouter, event\)/);
  assert.match(source, /event\.type === 'agent_done'/);
  assert.match(source, /getAgentProgressElapsedMs/);
  assert.match(source, /hasActiveAgentImageGeneration/);
  assert.match(source, /getAgentProgressDurationLabel\(step, generationClockMs\)/);
  assert.match(source, /timestampMs\?: number/);
  assert.match(source, /agentRunProgress\.steps\.map/);
  assert.match(source, /formatAgentProgressLabel\(step\)/);
  assert.match(source, /getAgentProgressCompletionLabel/);
  assert.match(source, /✍️ 回复已完成/);
  assert.match(source, /🖼️ 设计生成已完成/);
  assert.match(source, /⚙️ 任务已完成/);
  assert.match(source, /\{ type: 'intent_resolved', intent \},[\s\S]{0,140}routed\.events/);
  assert.match(source, /status === 'completed' \? '✓'/);
  assert.match(source, /status === 'waiting' \? '⏸'/);
  assert.match(source, /status === 'active' \|\| status === 'running' \? '○'/);
  assert.match(source, /outcome === 'warning'/);
  assert.match(source, /outcome === 'failed'/);
  assert.match(source, /\['completed', 'warning', 'failed'\]\.includes\(msg\.agentRunProgress\.outcome\)/);
  assert.match(source, /isAgentProgressMessage\s*\?\s*'py-1'/);
  assert.match(source, /shouldShowAgentRunProgress\(msg\.agentRunProgress\)/);
  assert.doesNotMatch(source, /模型推理/);
  assert.doesNotMatch(source, /animate-pulse/);
  assert.doesNotMatch(globalStyles, /@keyframes/);
  assert.match(motionControllerSource, /'\.agent-progress-enter'/);
  assert.match(motionControllerSource, /prefers-reduced-motion: reduce/);
  assert.match(motionControllerSource, /gsap\.fromTo\(/);
});

test('every chat-generated image is materialized in both chat and the canvas', () => {
  assert.match(source, /const updateChatMessageById =/);
  assert.match(source, /processedAgentActionsRef\.current\.has\(key\)/);
  assert.match(source, /await preloadGeneratedAssets\(freshAssets, \{ timeoutMs: 15_000 \}\)/);
  assert.match(source, /loadedAssets\.length > 0[\s\S]{0,4000}setChatMessages\(prev => \[\.\.\.prev, \.\.\.imageMessages\]\)/);
  assert.match(source, /const canvasItems = loadedAssets\.map/);
  assert.match(source, /recordCurrentCanvasUndoSnapshot\(\);\s*setItems\(prev => \[\.\.\.prev, \.\.\.canvasItems\]\)/);
  assert.match(source, /type: 'assets_settled'/);
  assert.match(source, /setImageCount\(\(prev\) => prev \+ loadedAssets\.length\)/);
  assert.match(source, /if \(msg\.imageUrl && !content\) return \[\]/);
  assert.doesNotMatch(source, /\[Generated image\$\{/);
  assert.match(source, /currentSessionIdRef\.current !== generationSessionId/);
  assert.match(source, /processedAgentActionKeysForRun\.add\(key\)/);
  assert.match(source, /for \(const key of processedAgentActionKeysForRun\)[\s\S]{0,180}processedAgentActionsRef\.current\.delete\(key\)/);
  assert.match(source, /generateAbortRef\.current === runController/);
  assert.match(source, /pendingAssistantMessageIdRef\.current === assistantPlaceholderId/);
  assert.match(source, /activeSkillJobMessageIdRef\.current = assistantId/);
  assert.match(source, /type: 'assets_progress'/);
  assert.match(source, /updateChatMessageById\(skillJobMessageId/);
  assert.doesNotMatch(source, /agentReadOnlySkillJobIdsRef/);
  assert.doesNotMatch(source, /if \(!isAgentReadOnlyJob\)/);
  assert.match(source, /recordCurrentCanvasUndoSnapshot\(\);\s*setItems\(prev => \[\.\.\.prev, newItem\]\);/);
});

test('agent batch assets render in completion order while retaining their original labels', () => {
  assert.match(source, /generatedAssetExpectedCount = batchTotal/);
  assert.match(source, /generatedAssetSucceededCount \+= loadedAssets\.length/);
  assert.match(source, /generatedAssetPreloadFailureCount \+= preloadFailureCount/);
  assert.match(source, /imageName:\s*asset\.label \|\|/);
  assert.match(source, /const firstStreamedOrdinal = streamedAssetOrdinal/);
  assert.match(source, /imageName:\s*asset\.label \|\| `image \$\{firstImageNumber \+ index\}`/);
  assert.match(source, /getSpawnPosition\(\s*displaySize,\s*firstStreamedOrdinal \+ index,\s*currentViewport\s*\)/);
  assert.match(source, /succeeded:\s*generatedAssetSucceededCount/);
  assert.match(source, /failed:\s*generatedAssetFailureCount \+ generatedAssetPreloadFailureCount/);
});

test('clarification and confirmation preserve waiting agent progress', () => {
  const clarificationStart = source.indexOf("event.type === 'clarification_required'");
  const confirmationStart = source.indexOf("event.type === 'confirmation_required'");
  const toolResultStart = source.indexOf("event.type === 'tool_result'", confirmationStart);
  assert.ok(clarificationStart >= 0 && confirmationStart > clarificationStart && toolResultStart > confirmationStart);
  assert.doesNotMatch(source.slice(clarificationStart, confirmationStart), /agentRunProgress:\s*undefined/);
  assert.doesNotMatch(source.slice(confirmationStart, toolResultStart), /agentRunProgress:\s*undefined/);
});

test('all agent decisions use one Codex-style popover above the composer', () => {
  assert.match(source, /setPendingAgentConfirmation\(confirmation\)/);
  assert.match(source, /setShowAgentConfirmationModal\(true\)/);
  assert.match(source, /showAgentConfirmationModal && pendingAgentConfirmation[\s\S]{0,220}<AgentDecisionPopover/);
  assert.match(source, /showAgentProposalModal && pendingAgentProposal[\s\S]{0,180}<AgentDecisionPopover/);
  assert.match(source, /showAgentClarificationModal && pendingAgentClarification[\s\S]{0,180}<AgentDecisionPopover/);
  assert.match(source, /showSkillChoiceModal && pendingSkillChoice[\s\S]{0,180}<AgentDecisionPopover/);
  assert.match(decisionPopoverSource, /absolute bottom-full left-4 right-4/);
  assert.match(decisionPopoverSource, /rounded-\[18px\]/);
  assert.match(decisionPopoverSource, /option\.recommended/);
  assert.match(decisionPopoverSource, /onClick=\{\(\) => onSelect\(option\.id\)\}/);
  assert.match(source, /暂不执行/);
  assert.doesNotMatch(source, /重新打开确认|重新回答|重新选择/);
  assert.doesNotMatch(source, /absolute inset-0 z-(?:20|30|40).*bg-black\//);
  assert.match(source, /openPendingAgentDecision\(msg\)/);
});

test('confirmation transitions stay in breadcrumbs without a nested message bubble', () => {
  assert.match(source, /type: 'confirmation_submitted'/);
  assert.match(source, /content: ''/);
  assert.doesNotMatch(source, /content: '正在确认并启动任务…'/);
  assert.match(source, /suppressAssistantContentForDecision/);
  assert.match(source, /step\.status === 'waiting' && hasPendingAgentDecision\(msg\)/);
});

test('typed confirmation replies submit the stored image delivery plan instead of starting a new run', () => {
  assert.match(source, /pendingAgentConfirmation[\s\S]{0,120}AGENT_RETRY_CONFIRMATION_PATTERN\.test\(currentChatInput\)/);
  assert.match(source, /setChatInput\(''\)[\s\S]{0,80}submitAgentConfirmation\(\)/);
  assert.match(source, /agentConfirmation:\s*confirmation/);
});

test('skill jobs, cancellation, and clarification recovery preserve progress state', () => {
  assert.match(source, /interface AgentClarificationState\s*\{[\s\S]{0,260}operationId\?: string/);
  assert.match(source, /interface AgentClarificationState\s*\{[\s\S]{0,320}skillSource\?: 'manual' \| 'auto' \| null/);
  assert.match(source, /interface AgentClarificationState\s*\{[\s\S]{0,380}lastSequence\?: number/);

  const jobResultStart = source.indexOf("event.type === 'tool_result' && typeof event.result?.jobId === 'string'");
  const imageResultStart = source.indexOf("event.type === 'tool_result' && event.result?.kind === 'image_generation'", jobResultStart);
  assert.ok(jobResultStart >= 0 && imageResultStart > jobResultStart);
  assert.doesNotMatch(source.slice(jobResultStart, imageResultStart), /agentRunProgress:\s*undefined/);

  const abortStart = source.indexOf("error instanceof Error && error.name === 'AbortError'");
  const failureStart = source.indexOf("updateActiveStreamMessageStatus('failed'", abortStart);
  assert.ok(abortStart >= 0 && failureStart > abortStart);
  assert.doesNotMatch(source.slice(abortStart, failureStart), /agentRunProgress:\s*undefined/);
  assert.match(source.slice(abortStart, failureStart), /updateAgentRunProgress\(msg, \{ type: 'agent_error' \}\)/);
});

test('right chat exposes adaptive chat and image provider model selectors', () => {
  assert.match(source, /对话 ·/);
  assert.match(source, /生图 ·/);
  assert.match(source, /generationMode === 'agent' \|\| generationMode === 'chat'/);
  assert.match(source, /generationMode === 'agent' \|\| generationMode === 'image'/);
  assert.match(source, /chatProviderId/);
  assert.match(source, /chatModelId/);
  assert.match(source, /imageProviderId/);
  assert.match(source, /imageModelId/);
  assert.match(source, /aria-expanded=/);
  assert.match(source, /未配置聊天模型/);
  assert.match(source, /未配置生图模型/);
});

test('chat panel sends selected providers and models to agent and direct routes', () => {
  assert.match(source, /chatOptions:\s*\{/);
  assert.match(source, /chatOptions:\s*\{[\s\S]{0,140}providerId:\s*selectedChatProviderId/);
  assert.match(source, /chatOptions:\s*\{[\s\S]{0,180}model:\s*selectedChatModelId/);
  assert.match(source, /imageOptions:\s*\{[\s\S]{0,140}providerId:\s*selectedImageProviderId/);
  assert.match(source, /imageOptions:\s*\{[\s\S]{0,180}model:\s*selectedImageModelId/);
  assert.match(source, /requestBody\.chatProviderId/);
  assert.match(source, /requestBody\.imageProviderId/);
});

test('agent image preferences default to 2K and portrait 3:4 without changing direct image mode', () => {
  assert.match(source, /const \[imageAspectRatio, setImageAspectRatio\] = useState\('auto'\)/);
  assert.match(source, /const \[agentImageAspectRatio, setAgentImageAspectRatio\] = useState\('3:4'\)/);
  assert.match(source, /generationMode === 'agent' \? agentImageAspectRatio : imageAspectRatio/);
  assert.match(source, /generationMode === 'agent'\s*\? setAgentImageAspectRatio\(option\.id\)\s*:\s*setImageAspectRatio\(option\.id\)/);
  assert.match(source, /imageOptions:\s*\{[\s\S]{0,260}aspectRatio:\s*agentImageAspectRatio/);
  assert.match(source, /imageOptions:\s*\{[\s\S]{0,320}size:\s*'2048x2048'/);
  assert.match(source, /imageOptions:\s*\{[\s\S]{0,360}quality:\s*'auto'/);
  assert.match(source, /imageOptions:\s*\{[\s\S]{0,400}count:\s*1/);
  assert.match(source, /generationMode === 'image' && imageAspectRatio !== 'auto'/);
});

test('chat panel keeps persisted model selections available while provider settings are unavailable', () => {
  assert.match(source, /resolvedChatSelection\.providerId\s*\|\|\s*chatProviderId\s*\|\|\s*undefined/);
  assert.match(source, /resolvedChatSelection\.model\s*\|\|\s*chatModelId\s*\|\|\s*undefined/);
  assert.match(source, /resolvedImageSelection\.providerId\s*\|\|\s*imageProviderId\s*\|\|\s*undefined/);
  assert.match(source, /resolvedImageSelection\.model\s*\|\|\s*imageModelId\s*\|\|\s*undefined/);
});

test('brand bootstrap logo generation follows the selected image provider and model', () => {
  assert.match(source, /const logoResponse = await fetch\('\/api\/generate'[\s\S]{0,420}imageProviderId:\s*selectedImageProviderId/);
  assert.match(source, /const logoResponse = await fetch\('\/api\/generate'[\s\S]{0,460}model:\s*selectedImageModelId/);
  assert.match(source, /const bootstrapMessageId[\s\S]{0,420}model:\s*selectedImageModelId/);
});

test('provider selection stays open until a model is chosen', () => {
  assert.match(source, /onClick=\{\(\) => setDraftProviderId\(provider\.id\)\}/);
  assert.doesNotMatch(source, /onClick=\{\(\) => onSelect\(provider\.id, provider\[modelsKey\]\[0\]\)\}/);
  assert.match(source, /onClick=\{\(\) => activeProvider && onSelect\(activeProvider\.id, modelId\)\}/);
});

test('chat panel model selections participate in project snapshots and hydration', () => {
  assert.match(source, /chatProviderId:\s*liveState\.chatProviderId/);
  assert.match(source, /chatModelId:\s*liveState\.chatModelId/);
  assert.match(source, /imageProviderId:\s*liveState\.imageProviderId/);
  assert.match(source, /imageModelId:\s*liveState\.imageModelId/);
  assert.match(source, /resolvedState\.normalizedSession\?\.chatProviderId/);
  assert.match(source, /resolvedState\.normalizedSession\?\.imageProviderId/);
});

test('chat panel model selectors expose provider-load failure recovery', () => {
  assert.match(source, /供应商加载失败/);
  assert.match(source, /重新加载/);
  assert.match(source, /onRetry=/);
  assert.match(source, /loadProviderSettings/);
});

test('switching generation mode closes both model selector popovers', () => {
  assert.match(source, /setGenerationMode\(option\.id\)[\s\S]{0,240}setShowChatModelSelector\(false\)/);
  assert.match(source, /setGenerationMode\(option\.id\)[\s\S]{0,300}setShowImageModelSelector\(false\)/);
});

test('chat composer uses the taller reference layout and ordered single-row controls', () => {
  assert.match(source, /workspace-chat-input[^\n]*min-h-\[148px\]/);
  assert.match(source, /minHeight:\s*'72px'/);
  const orderedControls = ['more', 'skills', 'mode', 'reasoning', 'models', 'send'];
  const indexes = orderedControls.map(controlIndex);
  assert.ok(indexes.every((index) => index >= 0));
  assert.deepEqual([...indexes].sort((a, b) => a - b), indexes);
});

test('chat composer uses the supplied Lovart skills icon as a theme-aware mask', () => {
  assert.equal(fs.existsSync(skillsIconPath), true);
  assert.match(source, /lovart-skills\.svg/);
  assert.match(source, /maskImage/);
});

test('chat composer more menu exposes uploads, history selection, and disabled search', () => {
  assert.match(source, /上传文件/);
  assert.match(source, /从素材库选取/);
  assert.match(source, /联网搜索/);
  assert.match(source, /即将支持/);
  assert.match(source, /showChatAssetPicker/);
  assert.match(source, /selectedChatHistoryAssetIds/);
});

test('chat composer exposes disabled reasoning and one adaptive model preference popover', () => {
  assert.match(source, /aria-label="深度思考 · 即将支持"/);
  assert.match(source, /data-chat-composer-control="reasoning"[\s\S]{0,240}disabled/);
  assert.match(source, /aria-label="模型偏好"/);
  assert.match(source, /showModelPreferencePopover/);
  assert.match(source, /generationMode === 'agent' \|\| generationMode === 'chat'/);
  assert.match(source, /generationMode === 'agent' \|\| generationMode === 'image'/);
  assert.match(
    source,
    /ASPECT_RATIOS\s*\.filter\(\(option\) => generationMode !== 'agent' \|\| option\.id !== 'auto'\)\s*\.map/
  );
  assert.doesNotMatch(source, /aria-label="聊天框供应商与模型"/);
});

test('chat composer closes transient menus when a generation starts', () => {
  assert.match(
    source,
    /useEffect\(\(\) => \{\s*if \(!isGenerating\) return;\s*closeChatComposerPopovers\(\);\s*setSelectedChatHistoryAssetIds\(\[\]\);\s*\}, \[closeChatComposerPopovers, isGenerating\]\)/
  );
});

test('canvas selection references render as compact composer tokens and submit annotation context', () => {
  assert.match(source, /interface ChatReferenceToken/);
  assert.match(source, /data-reference-token/);
  assert.match(source, /data-reference-id/);
  assert.match(source, /workspace-reference-token/);
  assert.match(globalStyles, /\.workspace-reference-token\s*\{[\s\S]{0,180}background:\s*transparent/);
  assert.match(source, /parseChatEditorSegments/);
  assert.match(source, /materializeChatMessageInlineContent/);
  assert.doesNotMatch(source, /inlineContent: currentInlineContent/);
  assert.match(source, /referenceContext: currentReferenceContext/);
  assert.match(source, /userInlineContent\.map/);
  assert.doesNotMatch(source, /resolvedChatReferenceTokens\.map\(\(token, index\) =>/);
  assert.doesNotMatch(source, /msg\.referenceImages\.map\(\(img, index\) =>/);
  assert.match(source, /tokenData\.annotationCount/);
  assert.match(source, /toggleChatReferenceTokenPin\(token\)/);
  assert.match(source, /selectedContextEntityIds: options\?\.selectedContextEntityIds \?\? selectedIds\.map\(\(id\) => `canvas:\$\{id\}`\)/);
  assert.match(source, /annotationContext: annotationContextForRequest/);
  assert.match(source, /referenceContext: currentReferenceContext/);
  assert.match(source, /composerSegments: currentComposerSegments\.map/);
  assert.match(source, /await uploadAnnotationCompositePreview/);
  assert.match(source, /fetch\('\/api\/upload'/);
  assert.match(source, /evidenceImages\?: Array/);
  assert.match(source, /kind: 'annotation_composite'/);
  assert.match(source, /referenceContext: referenceContextForRequest/);
  assert.match(source, /message\.id === userMessage\.id[\s\S]*referenceContext: referenceContextForRequest/);
});

test('generated image result cards persist and render model-authored presentation', () => {
  assert.match(source, /resultTitle\?: string/);
  assert.match(source, /resultSummary\?: string/);
  assert.match(source, /imageOperation\?: 'generate' \| 'edit'/);
  assert.match(source, /event\.action\?\.presentation\?\.title/);
  assert.match(source, /msg\.resultTitle \|\| msg\.imageName/);
  assert.match(source, /event\.type === 'agent_completion_summary'/);
  assert.match(source, /processedAgentCompletionSummariesRef/);
  assert.match(source, /role: 'assistant',\s*content: event\.summary/);
  assert.doesNotMatch(source, /generatedPresentationSummary/);
  assert.doesNotMatch(source, /resultSummary: event\.action\.presentation\.summary/);
});

test('chat exposes a bottom jump control without forcing users away from history', () => {
  assert.match(source, /scrollHeight - container\.scrollTop - container\.clientHeight/);
  assert.match(source, /distanceFromBottom <= 56/);
  assert.match(source, /const scrollChatToBottom = useCallback/);
  assert.match(source, /if \(shouldFollowLatest\) \{\s*scrollChatToBottom\('auto'\)/);
  assert.match(source, /new ResizeObserver/);
  assert.match(source, /onScroll=\{handleChatContainerScroll\}/);
  assert.match(source, /!isChatNearBottom && \(/);
  assert.match(source, /aria-label="滚动到最新消息"/);
  assert.match(source, /<ArrowDown size=\{15\}/);
  assert.match(globalStyles, /\.workspace-chat-scroll-bottom\s*\{/);
});

test('chat image uploads land in local assets before becoming sendable references', () => {
  assert.match(source, /const isGeneratingRef = useRef\(false\)/);
  assert.match(source, /uploadChatReferenceFile/);
  assert.match(source, /fetch\('\/api\/upload'/);
  assert.match(source, /uploadStatus: 'uploading'/);
  assert.match(source, /hasPendingChatReferenceUploads/);
  assert.match(source, /if \(!src \|\| existingSources\.has\(src\) \|\| nextTokens\.length >= 14\) continue;/);
});

test('composer dialogs expose semantics, unique asset labels, and focus restoration', () => {
  assert.match(source, /role="dialog"/);
  assert.match(source, /aria-modal="false"/);
  assert.match(source, /tabIndex=\{-1\}/);
  assert.match(source, /aria-label=\{`选择历史生成素材 \$\{index \+ 1\}`\}/);
  assert.match(source, /chatAssetPickerRef\.current\?\.focus\(\)/);
  assert.match(source, /modelPreferencePopoverRef\.current\?\.focus\(\)/);
  assert.match(source, /chatComposerMoreButtonRef\.current\?\.focus\(\)/);
  assert.match(source, /modelPreferenceButtonRef\.current\?\.focus\(\)/);
});

test('chat composer keeps utility icons borderless and hides the Skills label', () => {
  assert.doesNotMatch(source, /<span>Skills<\/span>/);
  for (const control of ['more', 'skills', 'mode', 'reasoning', 'models']) {
    const start = controlIndex(control);
    assert.ok(start >= 0, `missing ${control} composer control`);
    assert.match(source.slice(start, start + 10_000), /workspace-chat-icon-control/);
  }
  assert.match(
    source,
    /data-chat-composer-control="mode"[\s\S]{0,700}className=\{`workspace-chat-icon-control/
  );

  const styles = fs.readFileSync(path.resolve(import.meta.dirname, '../../globals.css'), 'utf8');
  assert.match(styles, /\.workspace-chat-icon-control\s*\{[\s\S]*?border:\s*0;/);
  assert.match(styles, /\.workspace-chat-icon-control:hover:not\(:disabled\)[\s\S]*?background:\s*var\(--workspace-control-hover\)/);
});
