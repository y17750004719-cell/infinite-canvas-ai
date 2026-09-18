/* Main-agent registry and result context assembly for one request. */
export function createAgentMainExecutionRegistry(scope = {}) {
  const {
    createMainAgentExecutionContext, createAgentRuntimeToolHandlers, createAgentRuntimeToolRegistry,
    createAgentRuntimeImageToolHandler, createRecoveryTaskHandler, createTodoUpdateExecutor,
    runtimeContextToolHandlerScope, recoveryHandlerScope, imageHandlerScope,
  } = scope;
  return createMainAgentExecutionContext({
    createAgentRuntimeToolHandlers, createAgentRuntimeToolRegistry,
    createAgentRuntimeImageToolHandler, createRecoveryTaskHandler, createTodoUpdateExecutor,
    runtimeContextToolHandlerScope, recoveryHandlerScope, imageHandlerScope,
  });
}

export function buildAgentMainResultContexts(scope = {}) {
  const {
    agentAnalysis, rootTaskId, runId, operationId, checkpoint, skillSource, selectedSkill,
    mainAgentLoopState, stagedMainAgentMemoryPatches, intent, originalRequest,
    executionReferenceImages, nativeGeneratedImageResult, approvedConfirmation,
    directGenerateImageCallId, directGenerateImageCall, nativeImageFailure, sessionId, taskId,
    activeClarificationState, runReferenceContext, workingContextData, latestUserMessage,
    body, resolvedChatSelection, lockedImageToolArgs, directImageExecution, contextEntityById,
    confirmationTaskIdentity, continuationState, rootOriginalRequest, rootSourceUserMessageId,
    writeInteractionEvent, writeProgress, writeToolProgress, writeAgentDone,
    writeResolvedImageOptionUpdate, writeStampedAgentEvent, writeImageCompletionSummary,
    createToolResultEvents, enrichGeneratedAssetEvents, updateTopicMemory,
    commitMainAgentMemory, emitIntentResolved, hashEnvelopeValue, confirmationTtlMs,
    getIntent, setIntent,
  } = scope;
  return {
    resultContext: {
      rootTaskId: agentAnalysis?.taskId || rootTaskId(), runId, operationId,
      checkpoint, skillSource, selectedSkill,
      mainAgentLoopState: { ...mainAgentLoopState, memoryPatches: stagedMainAgentMemoryPatches },
      intent, originalRequest, referenceImages: executionReferenceImages,
    },
    resultResolutionContext: {
      nativeGeneratedImageResult, approvedConfirmation, directGenerateImageCallId,
      directGenerateImageCall, nativeImageFailure, runId, operationId, sessionId, taskId,
      skillSource, selectedSkill, activeClarificationState, runReferenceContext,
      executionReferenceImages, agentAnalysis, workingContextData, latestUserMessage,
      body, resolvedChatSelection, lockedImageToolArgs, directImageExecution,
      contextEntityById, confirmationTaskIdentity, continuationState, rootTaskId,
      rootOriginalRequest, rootSourceUserMessageId, writeInteractionEvent, writeProgress,
      writeToolProgress, writeAgentDone, writeResolvedImageOptionUpdate, writeStampedAgentEvent,
      writeImageCompletionSummary, createToolResultEvents, enrichGeneratedAssetEvents,
      updateTopicMemory, commitMainAgentMemory, emitIntentResolved,
      hashEnvelopeValue, confirmationTtlMs,
      intentRef: { get value() { return getIntent(); }, set value(value) { setIntent(value); } },
    },
  };
}

/**
 * Assemble the request-scoped application tool registry. Keeping this wiring
 * here makes the request runtime an orchestration boundary; mutable values are
 * supplied through explicit refs rather than captured lexical state.
 */
export function createAgentMainExecutionRegistryFromScope(scope = {}) {
  const {
    createMainAgentExecutionContext, createAgentRuntimeToolHandlers, createAgentRuntimeToolRegistry,
    createAgentRuntimeImageToolHandler, createRecoveryTaskHandler, createTodoUpdateExecutor,
    refs = {}, body, contextEntities, contextEntityById, relevantContextCandidateIds,
    initiallyAttachedVisualIds, sessionVisualAssets, sessionId, resolveVisualReferences,
    readSessionVisualAsset, writeEvent, controller, runtimeReferenceById, runReferenceContext,
    loadedVisualReferenceIds, validateContextIds, getTopicMemory, normalizeConversationMemory,
    mergeTopicMemory, stagedMainAgentMemoryPatches, mainAgentLoopState, analysisDefaults,
    applyAnalysisCheckpoint, writeAgentAnalysisCheckpoint, writeProgress, contextLogger, runId,
    threadJournalService, recoveryCandidateForAgent, recoveryRecord, skillManifests,
    ensureSelectedSkillContent, messages, skillCatalogLoaded, skillSelectionMethod, imagegenLoaded,
    visualSkillLoaded, recoveryMode, recoveryDecision, approvedConfirmation, generatedImageHistory,
    contextAuditEvents, writeLifecycleEvent, writeToolProgress, emitIntentResolved, hashPrompt,
    normalizePublicProgress, positiveInteger, assertImageExecutionContract, assertLockedImageSkill,
    executeImagePayload, generatedAssetsFromResult, imageOptions, runSignal, toolCallRecords,
    rootTaskId,
  } = scope;
  const get = (name, fallback) => refs[name]?.get?.() ?? fallback;
  const set = (name, value) => refs[name]?.set?.(value);
  const state = {
    getIntent: () => get('intent'), setIntent: (v) => set('intent', v),
    getSelectedSkill: () => get('selectedSkill'), setSelectedSkill: (v) => set('selectedSkill', v),
    getAgentAnalysis: () => get('agentAnalysis'), setAgentAnalysis: (v) => set('agentAnalysis', v),
    getImageOperation: () => get('imageOperation'), setImageOperation: (v) => set('imageOperation', v),
    getRecoveryRecord: () => get('recoveryRecord', recoveryRecord),
  };
  return createAgentMainExecutionRegistry({
    createMainAgentExecutionContext, createAgentRuntimeToolHandlers, createAgentRuntimeToolRegistry,
    createAgentRuntimeImageToolHandler, createRecoveryTaskHandler, createTodoUpdateExecutor,
    runtimeContextToolHandlerScope: {
      body, contextEntities, contextEntityById, relevantContextCandidateIds, initiallyAttachedVisualIds,
      sessionVisualAssets, sessionId, resolveVisualReferences, readSessionVisualAsset, writeEvent, controller,
      runtimeReferenceById, runReferenceContext: get('runReferenceContext', runReferenceContext), loadedVisualReferenceIds,
      validateContextIds, getTopicMemory, topicMemory: getTopicMemory(), normalizeConversationMemory,
      mergeConversationMemory: mergeTopicMemory, stagedMemoryPatches: stagedMainAgentMemoryPatches,
      getLoopState: () => mainAgentLoopState, getAgentAnalysis: state.getAgentAnalysis,
      setAgentAnalysis: state.setAgentAnalysis, analysisDefaults, applyAnalysisCheckpoint,
      writeAgentAnalysisCheckpoint, writeProgress, contextLogger, runId,
      selectedSkill: state.getSelectedSkill(), imageOperation: state.getImageOperation(), threadJournalService,
    },
    recoveryHandlerScope: {
      recoveryCandidateForAgent, recoveryRecord, getRecoveryRecord: state.getRecoveryRecord,
      setRecoveryDecision: (v) => set('recoveryDecision', v), setRecoveryBaseRecord: (v) => set('recoveryBaseRecord', v),
      setRecoveryTaskIdForExecution: (v) => set('recoveryTaskIdForExecution', v), setRecoveryRevisionMessage: (v) => set('recoveryRevisionMessage', v),
      setImageOperation: state.setImageOperation, getImageOperation: state.getImageOperation,
      setTargetReferenceId: (v) => set('targetReferenceId', v), getTargetReferenceId: () => get('targetReferenceId'),
      skillManifests, setSelectedSkill: state.setSelectedSkill, setSkillSource: (v) => set('skillSource', v),
      setSkillSelectionMethod: (v) => set('skillSelectionMethod', v), setSkillCandidateIds: (v) => set('skillCandidateIds', v),
      ensureSelectedSkillContent, setIntent: state.setIntent, messages, runId,
      setMainAgentInputMessages: (v) => set('mainAgentInputMessages', v), appendMainAgentInputMessage: (v) => get('mainAgentInputMessages', []).push(v),
      setMainAgentReferenceContext: (v) => set('mainAgentReferenceContext', v), setMainAgentReferenceImages: (v) => set('mainAgentReferenceImages', v),
      setRunReferenceContext: (v) => set('runReferenceContext', v), runtimeReferenceById, contextLogger,
    },
    imageHandlerScope: {
      runId, sessionId, body, selectedSkill: state.getSelectedSkill(), skillContentHash: get('skillContentHash'),
      getSelectedSkill: state.getSelectedSkill, getSkillContentHash: () => get('skillContentHash'),
      skillCatalogLoaded, skillSelectionMethod, imagegenLoaded, visualSkillLoaded, mainAgentLoopState,
      recoveryMode, recoveryDecision, approvedConfirmation, generatedImageHistory, sessionVisualAssets,
      contextAuditEvents, contextEntityById, runtimeReferenceById, resolveVisualReferences, writeEvent, controller,
      writeLifecycleEvent, writeProgress, writeToolProgress, emitIntentResolved, hashPrompt, normalizePublicProgress,
      positiveInteger, assertImageExecutionContract, assertLockedImageSkill, executeImagePayload, generatedAssetsFromResult,
      ...imageOptions, runSignal, contextLogger, toolCallRecords, rootTaskId,
      setImageOperation: state.setImageOperation, setTargetReferenceId: (v) => set('targetReferenceId', v), setIntent: state.setIntent,
      setLockedImageToolArgs: (v) => set('lockedImageToolArgs', v), setRequestedTotalImageCount: (v) => set('requestedTotalImageCount', v),
      setRequestedImageCount: (v) => set('requestedImageCount', v), setRequestedImageCountSource: (v) => set('requestedImageCountSource', v),
      setExecutionKind: (v) => set('executionKind', v), setImageDeliveryPlan: (v) => set('imageDeliveryPlan', v),
      setDirectImageExecution: (v) => set('directImageExecution', v), setWorkingContextData: (v) => set('workingContextData', v), setWorkingContext: (v) => set('workingContext', v),
      getRunReferenceContext: () => get('runReferenceContext', runReferenceContext), setRunReferenceContext: (v) => set('runReferenceContext', v),
      executionReferenceImages: get('executionReferenceImages'), getExecutionReferenceImages: () => get('executionReferenceImages'),
      setExecutionReferenceImages: (v) => set('executionReferenceImages', v), setNativeGeneratedImageResult: (v) => set('nativeGeneratedImageResult', v),
      setNativeImageFailure: (v) => set('nativeImageFailure', v), setDirectGenerateImageCall: (v) => set('directGenerateImageCall', v), setDirectGenerateImageCallId: (v) => set('directGenerateImageCallId', v),
    },
  });
}
