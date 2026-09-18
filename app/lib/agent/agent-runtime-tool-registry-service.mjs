import { createAgentToolRegistry, getAgentModelTools } from './tool-registry.mjs';
import { VisualReferenceResolutionError, selectRecentSessionImage } from './executable-visual-references.mjs';

/** Build the image tool callback without leaking its contract into request runtime. */
export function createAgentRuntimeImageToolHandler(scope = {}) {
  const {
    runId, sessionId, body, selectedSkill: selectedSkillValue, skillContentHash: skillContentHashValue, getSelectedSkill, getSkillContentHash, skillCatalogLoaded,
    skillSelectionMethod, imagegenLoaded, visualSkillLoaded, mainAgentLoopState,
    recoveryMode, recoveryDecision, approvedConfirmation, generatedImageHistory,
    sessionVisualAssets, contextAuditEvents, contextEntityById, runtimeReferenceById,
    resolveVisualReferences, writeEvent, controller, writeLifecycleEvent, writeProgress,
    writeToolProgress, emitIntentResolved, hashPrompt,
    positiveInteger, assertImageExecutionContract, assertLockedImageSkill,
    executeImagePayload, generatedAssetsFromResult, AGENT_DEFAULT_IMAGE_OPTIONS,
    AGENT_IMAGE_ASPECT_RATIO_IDS, AGENT_MAX_IMAGE_BATCH_COUNT, runSignal,
    contextLogger, toolCallRecords, rootTaskId, setImageOperation,
    setTargetReferenceId, setIntent, setLockedImageToolArgs,
    setRequestedTotalImageCount, setRequestedImageCount, setRequestedImageCountSource,
    setExecutionKind, setImageDeliveryPlan, setDirectImageExecution,
    setWorkingContextData, setWorkingContext,
    getRunReferenceContext, setRunReferenceContext, executionReferenceImages, getExecutionReferenceImages,
    setExecutionReferenceImages, setNativeGeneratedImageResult, setNativeImageFailure,
    setDirectGenerateImageCall, setDirectGenerateImageCallId,
  } = scope;

  return async (inputArgs = {}, context = {}) => {
    const selectedSkill = getSelectedSkill ? getSelectedSkill() : selectedSkillValue;
    const skillContentHash = getSkillContentHash ? getSkillContentHash() : skillContentHashValue;
    if (mainAgentLoopState?.skillSelectionFailed === true) {
      const error = Object.assign(new Error('Visual Skill lock failed; image generation is blocked'), {
        code: 'skill_lock_failed', failureStage: 'skill_selection', retryable: false,
      });
      setNativeImageFailure?.(error);
      throw error;
    }
    let args = inputArgs;
    const requestedOperation = String(args.operation || '');
    const normalizationAction = args.numLastImagesToInclude === null ? 'omitted_null_recent_image_parameter' : null;
    const callId = String(context.toolCallId || `${runId}-generate-image`).slice(0, 200);
    const commentarySource = typeof context.commentarySource === 'string' ? context.commentarySource : null;
    const commentaryFallbackUsed = context.commentaryFallbackUsed === true;
    setDirectGenerateImageCallId(callId);
    const attemptId = runId;
    const existingCall = toolCallRecords.find((entry) => entry.callId === callId);
    if (existingCall?.status === 'completed') throw new Error('图片工具调用已完成，恢复时不得重复执行');
    const callRecord = existingCall || { callId, attemptId, taskId: rootTaskId(), toolName: 'generate_image', status: 'running', startedAt: Date.now(), completedAt: undefined };
    if (!existingCall) toolCallRecords.push(callRecord); else callRecord.status = 'running';
    setDirectGenerateImageCall(true);
    void contextLogger.info('main_agent.direct_generate_image', 'Main Agent submitted the image generation contract', {
      skillCatalogLoaded, selectedSkillId: selectedSkill?.id || null, skillSelectionSource: skillSelectionMethod,
      finalPromptLength: typeof args.prompt === 'string' ? args.prompt.trim().length : 0,
      finalPromptHash: hashPrompt(args.prompt), imagegenLoaded, visualSkillLoaded,
      skillRead: mainAgentLoopState.skillRead, attemptId, toolCallId: callId,
      operation: requestedOperation || null, normalizationAction, recoveryMode, recoveryDecision,
      commentarySource, commentaryFallbackUsed, executionReached: false,
      providerRequestStarted: false, assetCount: 0, failureStage: 'tool_dispatch',
    });
    const fail = (message, failureStage = 'tool_dispatch') => {
      callRecord.status = 'failed'; callRecord.completedAt = Date.now();
      void contextLogger.info('main_agent.direct_generate_image_failed', 'Image generation contract was rejected before provider dispatch', {
        toolCallId: callId, selectedSkillId: selectedSkill?.id || null, commentarySource, commentaryFallbackUsed,
        executionReached: false, providerRequestStarted: false, assetCount: 0, failureStage, message,
      });
      throw Object.assign(new Error(message), { failureStage });
    };
    if (selectedSkill && (selectedSkill.executionMode !== 'image_pipeline' || !selectedSkill.allowedTools.includes('generate_image'))) fail('The locked Skill is not allowed to generate images', 'skill_selection');
    if (selectedSkill && !skillContentHash) fail('The image Prompt Skill lock is missing or changed', 'skill_selection');
    const operation = String(args.operation || '');
    if (operation !== 'generate' && operation !== 'edit') fail('图片操作必须是 generate 或 edit', 'tool_dispatch');
    const prompt = String(args.prompt || '').trim();
    if (!prompt) throw new Error('最终图片提示词不能为空');
    const referenceIds = Array.from(new Set((Array.isArray(args.referenceIds) ? args.referenceIds : []).map((value) => String(value).trim()).filter(Boolean)));
    const requestedRecentImageCountAfterNormalization = args.numLastImagesToInclude == null ? null : Number(args.numLastImagesToInclude);
    const requestedTargetReferenceId = typeof args.targetReferenceId === 'string' ? args.targetReferenceId.trim() : '';
    const canonicalTargetReferenceId = requestedTargetReferenceId && !runtimeReferenceById.has(requestedTargetReferenceId)
      ? [...runtimeReferenceById.keys()].find((candidate) => String(candidate).endsWith(`:${requestedTargetReferenceId}`)) || requestedTargetReferenceId : requestedTargetReferenceId;
    if (requestedRecentImageCountAfterNormalization !== null && requestedRecentImageCountAfterNormalization !== 1) throw new VisualReferenceResolutionError('invalid_tool_arguments', 'numLastImagesToInclude 目前只支持 1');
    if (requestedRecentImageCountAfterNormalization !== null && operation !== 'edit') throw new VisualReferenceResolutionError('invalid_tool_arguments', 'numLastImagesToInclude 仅可用于图片编辑');
    if (requestedRecentImageCountAfterNormalization !== null && (referenceIds.length > 0 || requestedTargetReferenceId)) throw new VisualReferenceResolutionError('reference_source_conflict', 'numLastImagesToInclude 不能与显式图片引用同时使用');
    let resolvedReferenceIds = referenceIds;
    let resolvedTargetReferenceId = canonicalTargetReferenceId;
    setExecutionReferenceImages([]);
    if (requestedRecentImageCountAfterNormalization === 1) {
      let recentReference;
      try { recentReference = selectRecentSessionImage({ sessionId, generatedImageHistory, sessionVisualAssets, contextEvents: contextAuditEvents }); }
      catch (error) {
        if (error instanceof VisualReferenceResolutionError && error.reason === 'recent_image_ambiguous') {
          for (const candidate of error.candidates || []) if (!contextEntityById.has(candidate.id)) contextEntityById.set(candidate.id, { id: candidate.id, kind: 'generated_image', intent: 'image', label: candidate.label, aliases: [], summary: '当前画布最近一次生成批次中的图片', brief: '使用用户选择的最近生成图片作为编辑目标。', mustPreserve: [], assetUrl: candidate.src, referenceImageUrls: [candidate.src], selected: false, createdAt: Date.now() });
          callRecord.status = 'completed'; callRecord.completedAt = Date.now();
          return { confirmationRequired: true, toolName: 'request_context_selection', message: error.message, candidates: error.candidates || [] };
        }
        throw error;
      }
      resolvedReferenceIds = [recentReference.id]; resolvedTargetReferenceId = recentReference.id;
    }
    if (resolvedReferenceIds.length > 0) {
      const resolved = await resolveVisualReferences(resolvedReferenceIds);
      if (resolved.registeredAssets.length > 0) writeEvent(controller, { type: 'client_action', action: { type: 'register_session_visual_assets', sessionId, assets: resolved.registeredAssets.map((asset) => ({ ...asset, sessionId })) } });
      const previous = getRunReferenceContext() || {};
      setRunReferenceContext({ references: [...(previous.references || []).filter((reference) => !resolved.references.some((item) => item.id === reference.id)), ...resolved.references], composerSegments: previous.composerSegments || [], ...(previous.evidenceImages ? { evidenceImages: previous.evidenceImages } : {}) });
      for (const reference of resolved.references) runtimeReferenceById.set(reference.id, reference);
      setExecutionReferenceImages(resolved.references.map((reference) => reference.src));
    }
    if (operation === 'edit' && (!resolvedTargetReferenceId || !resolvedReferenceIds.includes(String(resolvedTargetReferenceId)))) fail('编辑任务必须锁定一个已选参考图作为目标', 'image_reference_resolution');
    if (operation === 'generate' && requestedTargetReferenceId) fail('生成任务不能指定编辑目标', 'image_reference_resolution');
    const outputCount = positiveInteger(args.outputCount) || 1;
    const deliveryMode = ['single', 'variants', 'series', 'composite'].includes(String(args.deliveryMode || '')) ? String(args.deliveryMode) : outputCount > 1 ? 'variants' : 'single';
    const panelCount = deliveryMode === 'composite' ? Math.max(2, positiveInteger(args.panelCount) || 2) : null;
    const requestedAspectRatio = typeof args.aspectRatio === 'string' ? args.aspectRatio : '';
    const aspectRatio = requestedAspectRatio || selectedSkill?.aspectRatio || AGENT_DEFAULT_IMAGE_OPTIONS.aspectRatio;
    const generationItems = (Array.isArray(args.items) ? args.items : []).map((item, index) => ({ index: index + 1, label: `系列 ${index + 1}`, prompt: String(item?.prompt || '').trim() })).filter((item) => item.prompt);
    const imageExecutionContract = assertImageExecutionContract({ operation, prompt, referenceIds: resolvedReferenceIds, targetReferenceId: operation === 'edit' ? resolvedTargetReferenceId : null, outputCount, aspectRatio, deliveryMode, panelCount, items: generationItems }, { referenceIds: [...runtimeReferenceById.keys()], aspectRatios: AGENT_IMAGE_ASPECT_RATIO_IDS });
    setImageOperation(operation); setTargetReferenceId(operation === 'edit' ? String(resolvedTargetReferenceId) : null); setIntent('image'); setLockedImageToolArgs(imageExecutionContract); emitIntentResolved('image');
    setRequestedTotalImageCount(outputCount); setRequestedImageCount(Math.min(outputCount, AGENT_MAX_IMAGE_BATCH_COUNT)); setRequestedImageCountSource('prompt'); body.imageOptions = { ...body.imageOptions, aspectRatio }; setExecutionKind('image_pipeline');
    const imageDeliveryPlan = { mode: deliveryMode === 'single' ? 'variants' : deliveryMode, outputCount, promptCount: deliveryMode === 'series' ? outputCount : 1, panelCount: deliveryMode === 'composite' ? panelCount || 2 : 0, variationAxes: [], evidence: ['direct_tool'], confidence: 'high', requiresClarification: false };
    setImageDeliveryPlan(imageDeliveryPlan);
    const imageTask = { operation, selectedSkillId: selectedSkill?.id || null, targetReferenceId: operation === 'edit' ? String(resolvedTargetReferenceId) : null, supportingReferenceIds: resolvedReferenceIds.filter((referenceId) => referenceId !== resolvedTargetReferenceId) };
    const presentation = { title: operation === 'edit' ? '编辑图片' : '生成图片', operation, completionSummary: operation === 'edit' ? '图片编辑已完成。' : '图片生成已完成。' };
    setDirectImageExecution({ contract: imageExecutionContract, imageTask, delivery: imageDeliveryPlan, presentation });
    setWorkingContextData({ version: 1, originalRequest: prompt, resolvedEntityIds: resolvedReferenceIds, resolvedLabels: resolvedReferenceIds.map((referenceId) => runtimeReferenceById.get(referenceId)?.label).filter(Boolean), plainText: prompt, mustPreserve: [], referenceImageUrls: [], canvasItemIds: [] });
    setWorkingContext(prompt);
    writeLifecycleEvent({ type: 'image_parameters_locked', parameters: { outputCount, aspectRatio, deliveryMode, ...(panelCount ? { panelCount } : {}) } });
    writeProgress({ stepId: 'routing', phase: 'analyzing', status: 'completed', label: operation === 'edit' ? '已识别为编辑原图' : '已识别为生成新图' });
    if (outputCount > 1 && !approvedConfirmation && body.imageOptions?.autoConfirm !== true) { callRecord.status = 'pending'; return { confirmationRequired: true, type: 'image_execution', toolName: 'generate_image', toolCallId: callId, arguments: args, contract: imageExecutionContract, message: `本次将生成 ${outputCount} 张图片，确认后继续。`, modelResult: { accepted: false, confirmationRequired: true }, publicResult: { accepted: false, confirmationRequired: true } }; }
    const allGenerationItems = outputCount > 1 ? Array.from({ length: outputCount }, (_, index) => ({ id: `${imageDeliveryPlan.mode}-${index + 1}`, index: index + 1, label: imageDeliveryPlan.mode === 'composite' ? `多宫格 ${index + 1}` : `变体 ${index + 1}`, subject: imageDeliveryPlan.mode === 'composite' ? 'composite image' : 'image variant', prompt: generationItems[index]?.prompt || prompt })) : [];
    try {
      if (selectedSkill) {
        await assertLockedImageSkill(selectedSkill, skillContentHash || null);
      }
      void contextLogger.info('main_agent.image_execution_reached', 'Validated image generation reached the application execution boundary', {
        toolCallId: callId, selectedSkillId: selectedSkill?.id || null, commentarySource, commentaryFallbackUsed,
        executionReached: true, providerRequestStarted: false, assetCount: 0, failureStage: null,
      });
      writeToolProgress('generate_image', 'active', callId);
      const generated = await executeImagePayload(prompt, body.imageOptions, getExecutionReferenceImages ? getExecutionReferenceImages() : executionReferenceImages, { source: 'prompt', totalCount: outputCount, promptOptimized: false }, allGenerationItems, { toolCallId: callId, commentarySource, commentaryFallbackUsed }, imageDeliveryPlan, imageTask, undefined, presentation, getRunReferenceContext());
      const assetCount = generatedAssetsFromResult(generated).length;
      if (assetCount === 0) throw Object.assign(new Error('Image generation returned no usable assets'), { failureStage: 'local_delivery' });
      void contextLogger.info('main_agent.direct_generate_image_completed', 'Image generation returned deliverable assets', {
        toolCallId: callId, selectedSkillId: selectedSkill?.id || null, commentarySource, commentaryFallbackUsed,
        executionReached: true, providerRequestStarted: generated.providerCalled === true, assetCount, failureStage: null,
      });
      setNativeGeneratedImageResult(generated); runSignal.throwIfAborted(); callRecord.status = 'completed'; callRecord.completedAt = Date.now(); callRecord.resultRef = `${runId}:generate_image`; writeToolProgress('generate_image', 'completed', callId);
      return { ...generated, type: 'image_execution_completed', modelResult: { completed: true, partial: Number(generated.requestStats?.failed) > 0, assetCount: generatedAssetsFromResult(generated).length, assets: generatedAssetsFromResult(generated).map((asset) => ({ id: asset.id || asset.assetId || asset.versionId || null, label: asset.label || null })) }, publicResult: generated };
    } catch (error) {
      setNativeImageFailure(error);
      callRecord.status = 'failed'; callRecord.completedAt = Date.now();
      void contextLogger.info('main_agent.direct_generate_image_failed', 'Image generation execution failed', {
        toolCallId: callId, selectedSkillId: selectedSkill?.id || null, commentarySource, commentaryFallbackUsed,
        executionReached: true, providerRequestStarted: error?.providerRequestStarted === true || error?.failureStage === 'provider_request',
        assetCount: Number(error?.assetCount) || 0, failureStage: error?.failureStage || 'image_execution',
      });
      throw error;
    }
  };
}

/**
 * Request-scoped application tool boundary for the Main Agent.
 *
 * The runtime supplies closures for mutable request state (image execution,
 * context selection, recovery and analysis checkpoints).  Keeping registry
 * construction here gives Native execution and replay callers one stable
 * entry point without making this service aware of HTTP or Native lifecycle.
 */
export function createAgentRuntimeToolRegistry(handlers = {}) {
  return createAgentToolRegistry(handlers);
}

/**
 * Project the request-scoped registry into the model tool shape.
 */
export function getAgentRuntimeModelTools(registry, names = []) {
  if (!registry || typeof registry !== 'object') {
    throw new TypeError('getAgentRuntimeModelTools requires a tool registry');
  }
  return getAgentModelTools(registry, Array.isArray(names) ? names : []);
}

/**
 * Build the request-scoped handlers whose only responsibility is context,
 * memory, and analysis interaction.  Mutable values are supplied through
 * accessors so this boundary does not capture the request runtime's locals.
 */
export function createAgentRuntimeToolHandlers(scope = {}) {
  const {
    body, contextEntities = [], contextEntityById, relevantContextCandidateIds,
    initiallyAttachedVisualIds = new Set(), sessionVisualAssets = [], sessionId,
    resolveVisualReferences, readSessionVisualAsset, writeEvent, controller,
    runtimeReferenceById, runReferenceContext, loadedVisualReferenceIds,
    validateContextIds, topicMemory, normalizeConversationMemory,
    mergeConversationMemory, stagedMemoryPatches, getTopicMemory,
    getLoopState, getAgentAnalysis, setAgentAnalysis, analysisDefaults,
    applyAnalysisCheckpoint, writeAgentAnalysisCheckpoint, writeProgress,
    contextLogger, runId, selectedSkill, imageOperation,
    threadJournalService, createTodoUpdateExecutor,
  } = scope;
  const state = () => getLoopState?.() || {};
  const memory = () => normalizeConversationMemory?.(body?.agentMemory) || null;

  return {
    todoRead: async () => {
      const loaded = await threadJournalService.loadThread(sessionId);
      return { items: Array.isArray(loaded.state.todoItems) ? structuredClone(loaded.state.todoItems) : [] };
    },
    todoUpdate: typeof createTodoUpdateExecutor === 'function' ? createTodoUpdateExecutor() : undefined,
    getConversationMemory: async () => ({
      modelResult: { memory: memory(), recentMessages: (body?.messages || []).slice(-20) },
      publicResult: { loaded: true },
    }),
    listProjectContext: async () => ({
      modelResult: {
        entities: contextEntities.slice(-80).map((entity) => ({
          id: entity.id, kind: entity.kind, label: entity.label,
          aliases: entity.aliases || [], summary: entity.summary || '',
          selected: entity.selected === true, createdAt: entity.createdAt || null,
        })),
        total: contextEntities.length,
        truncated: contextEntities.length > 80,
        omitted: Math.max(0, contextEntities.length - 80),
      },
      publicResult: { total: contextEntities.length, truncated: contextEntities.length > 80 },
    }),
    readContextEntity: async (id) => {
      const entity = contextEntityById.get(id);
      if (!entity) throw new Error(`Unknown context entity: ${id}`);
      return {
        modelResult: {
          id: entity.id, kind: entity.kind, label: entity.label,
          aliases: entity.aliases || [], summary: entity.summary || '', brief: entity.brief,
          selected: entity.selected === true,
          hasVisual: Boolean(entity.assetUrl || entity.referenceImageUrls?.length),
        },
        publicResult: { id: entity.id, kind: entity.kind, label: entity.label },
      };
    },
    loadVisualReference: async (ids) => {
      const validatedIds = validateContextIds(ids, 'visual');
      if (validatedIds.length === 0 || validatedIds.length > 4) {
        throw new Error('load_visual_reference requires 1 to 4 stable IDs');
      }
      if (validatedIds.some((id) => initiallyAttachedVisualIds.has(id))) {
        throw new Error('The requested visual reference is already attached to the current Main Agent turn');
      }
      const resolvedVisuals = await resolveVisualReferences(validatedIds);
      const visualReferences = resolvedVisuals.references;
      const modelVisualReferences = await Promise.all(visualReferences.map(async (reference) => {
        const asset = [...resolvedVisuals.registeredAssets, ...sessionVisualAssets]
          .find((candidate) => candidate.id === reference.assetId && candidate.sessionId === sessionId);
        const bytes = asset ? await readSessionVisualAsset(asset) : null;
        if (!asset || !bytes) {
          throw Object.assign(new Error('图片引用已失效，请重新选择参考图'), {
            code: 'invalid_reference', failureStage: 'image_reference_resolution', retryable: false,
          });
        }
        return { id: reference.id, label: reference.label, src: `data:${asset.mimeType};base64,${Buffer.from(bytes).toString('base64')}` };
      }));
      if (resolvedVisuals.registeredAssets.length > 0) {
        writeEvent(controller, {
          type: 'client_action',
          action: { type: 'register_session_visual_assets', sessionId,
            assets: resolvedVisuals.registeredAssets.map((asset) => ({ ...asset, sessionId })) },
        });
      }
      validatedIds.forEach((id) => loadedVisualReferenceIds.add(id));
      for (const visualReference of visualReferences) {
        if (runtimeReferenceById.has(visualReference.id)) continue;
        const reference = {
          id: visualReference.id, src: visualReference.src, label: visualReference.label,
          ...(visualReference.assetId ? { assetId: visualReference.assetId } : {}),
          ...(visualReference.originalSrc ? { originalSrc: visualReference.originalSrc } : {}),
          source: visualReference.source, role: visualReference.role,
        };
        runReferenceContext.references.push(reference);
        runtimeReferenceById.set(reference.id, reference);
      }
      return {
        modelResult: { loaded: visualReferences.map(({ id, label }) => ({ id, label })) },
        publicResult: { loadedIds: visualReferences.map((reference) => reference.id) },
        visualReferences: modelVisualReferences,
      };
    },
    updateConversationMemory: async (patch) => {
      if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
        throw new Error('update_conversation_memory requires a memoryPatch object');
      }
      const normalized = normalizeConversationMemory?.(
        mergeConversationMemory?.(getTopicMemory?.() ?? topicMemory, patch, body?.messages),
      );
      if (!normalized) throw new Error('Invalid conversation memory patch');
      stagedMemoryPatches.push(structuredClone(patch));
      return { type: 'memory_staged', modelResult: { accepted: true }, publicResult: { accepted: true } };
    },
    readRelevantContext: async (args = {}) => {
      const requestedScope = String(args.scope || '');
      const analysis = getAgentAnalysis?.();
      void contextLogger?.info?.('main_agent.context_requested', 'Main Agent requested bounded context', {
        taskId: analysis?.taskId || null, runId, checkpoint: analysis?.checkpointCount || 0,
        scope: requestedScope, skillId: selectedSkill?.id || null, operation: imageOperation, exit: 'context',
      });
      const query = typeof args.query === 'string' ? args.query.trim().toLowerCase().slice(0, 300) : '';
      const requestedIds = new Set((Array.isArray(args.ids) ? args.ids : []).map((id) => String(id).trim()).filter(Boolean));
      if (requestedScope === 'conversation') {
        const loop = state(); loop.contextRequested = true; loop.contextScopes?.add?.('conversation');
        return {
          modelResult: { memory: memory(), messages: (body?.messages || []).slice(-20).map((message) => ({ id: message.id, role: message.role, content: message.content.slice(0, 1200) })) },
          publicResult: { scope: requestedScope, loaded: true },
        };
      }
      const candidates = contextEntities.filter((entity) => {
        if (requestedScope === 'canvas' && entity.kind !== 'canvas_item') return false;
        if (requestedIds.size > 0 && !requestedIds.has(entity.id)) return false;
        if (!query) return true;
        return [entity.id, entity.label, entity.summary, ...(entity.aliases || [])].some((value) => String(value || '').toLowerCase().includes(query));
      }).slice(-40);
      relevantContextCandidateIds.clear(); candidates.forEach((entity) => relevantContextCandidateIds.add(entity.id));
      if (requestedScope === 'project' || requestedScope === 'canvas') { const loop = state(); loop.contextRequested = true; loop.contextScopes?.add?.('project'); }
      return {
        modelResult: { scope: requestedScope, entities: candidates.map((entity) => ({ id: entity.id, kind: entity.kind, label: entity.label, summary: String(entity.summary || '').slice(0, 800), aliases: (entity.aliases || []).slice(0, 6), hasVisual: Boolean(entity.assetUrl || entity.referenceImageUrls?.length) })),
          ...(requestedScope === 'canvas' ? { canvas: { itemCount: Number(body?.canvasContext?.itemCount) || 0, selectedItemIds: Array.isArray(body?.canvasContext?.selectedItemIds) ? body.canvasContext.selectedItemIds.slice(0, 40) : [] } } : {}) },
        publicResult: { scope: requestedScope, count: candidates.length },
      };
    },
    submitAgentAnalysisCheckpoint: async (args) => {
      let analysis = getAgentAnalysis?.();
      if (!analysis) { analysis = setAgentAnalysis?.(analysisDefaults); }
      const checkpoint = applyAnalysisCheckpoint(analysis, args);
      writeAgentAnalysisCheckpoint();
      writeProgress({ stepId: 'agent_analysis', phase: 'analyzing', status: 'completed', label: '正在深入分析' });
      return { terminate: true, type: 'agent_analysis_checkpoint', checkpoint, modelResult: { accepted: true, checkpointCount: analysis.checkpointCount }, publicResult: { accepted: true } };
    },
    requestUserDecision: async (args) => {
      const options = Array.isArray(args.options) ? args.options : [];
      const optionIds = new Set(options.map((option) => String(option?.id || '').trim()).filter(Boolean));
      const recommendedOptionId = String(args.recommendedOptionId || '').trim();
      if (!optionIds.has(recommendedOptionId)) throw new Error('recommendedOptionId must match one option');
      let analysis = getAgentAnalysis?.();
      if (!analysis) analysis = setAgentAnalysis?.(analysisDefaults);
      analysis.status = 'awaiting_input'; writeAgentAnalysisCheckpoint();
      return { confirmationRequired: true, message: String(args.question || ''), candidates: options, clarification: args };
    },
    rewindAgentAnalysis: async (args) => {
      const requestedStage = String(args.stage || '');
      if (!['analysis', 'routing'].includes(requestedStage)) throw new Error('回退阶段无效');
      let analysis = getAgentAnalysis?.();
      if (!analysis) analysis = setAgentAnalysis?.(analysisDefaults);
      analysis.runId = runId; analysis.status = 'analyzing';
      if (requestedStage === 'analysis') analysis.currentObjective = String(args.reason || '').trim() || null;
      writeAgentAnalysisCheckpoint();
      return { terminate: true, type: 'agent_analysis_rewound', stage: requestedStage, modelResult: { accepted: true, stage: requestedStage }, publicResult: { accepted: true } };
    },
    requestMainAgentContext: async (args) => {
      const loop = state(); if (loop.contextRequested) throw new Error('Main Agent context can be unlocked only once per loop');
      const scopes = Array.from(new Set((Array.isArray(args.scopes) ? args.scopes : []).map((value) => String(value)).filter((value) => value === 'conversation' || value === 'project')));
      if (scopes.length === 0) throw new Error('At least one Main Agent context scope is required');
      loop.contextRequested = true; scopes.forEach((value) => loop.contextScopes?.add?.(value));
      return { modelResult: { unlockedScopes: scopes }, publicResult: { unlockedScopes: scopes } };
    },
    requestContextSelection: async (args) => {
      const candidates = Array.isArray(args.candidates) ? args.candidates.slice(0, 4) : [];
      if (candidates.length < 2) throw new Error('At least two context candidates are required');
      const normalizedCandidates = candidates.map((candidate) => {
        const id = String(candidate?.id || '').trim(); const entity = contextEntityById.get(id);
        if (!entity || !relevantContextCandidateIds.has(id)) throw new Error(`Unknown context candidate: ${id}`);
        return { id, label: entity.label, kind: entity.kind };
      });
      return { confirmationRequired: true, message: String(args.question || '').trim(), candidates: normalizedCandidates };
    },
  };
}
