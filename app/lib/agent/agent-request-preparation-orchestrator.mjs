/**
 * Runs the request-scoped interaction, reference and main-agent preparation
 * phase.  The runtime owns the request stream; this service owns the mutable
 * preparation state that must survive each phase boundary.
 */
export async function prepareAgentRequestExecution(scope) {
  const {
    body,
    state,
    providers,
    skillManifests,
    interactionService,
    continuationState,
    claimContinuation,
    assertLockedImageSkill,
    resolveRequestInteraction,
    sessionId,
    runId,
    writeEvent,
    controller,
    contextLogger,
    latestUserMessage,
    progressTracker,
    contextEntities,
    sessionVisualAssets,
    generatedImageHistory,
    runtimeReferenceContext,
    recentFailedTask,
    requestedRecoveryTaskId,
    materializeRecoveryReference,
    resolveRecoveryReferences,
    continuationFlow,
    normalizeReferenceContext,
    resolvedChatSelection,
    rootTaskId,
    randomUUID,
    applyImageOperationResponse,
    resolveImageOperationResponse,
    prepareMainAgentState,
    hash,
    imagegenHostSkillId,
    recordAgentUserDecision,
    restoreAgentAnalysisSnapshot,
    emitTaskSnapshotCheckpoint,
    skillCatalogLoaded,
  } = scope;

  // Preparation owns the selection until it returns to the request runtime.
  const ensureSelectedSkillContent = async () => {
    if (!state.selectedSkill) return '';
    if (state.skillLock?.skillId === state.selectedSkill.id) return state.skillLock.skillContent;
    const loaded = await interactionService.loadSkill(state.selectedSkill.id);
    state.skillContent = loaded.content;
    state.skillContentHash = loaded.contentHash;
    return loaded.content;
  };

  const interactionResolution = await resolveRequestInteraction({
    body,
    sessionId,
    runId,
    providers,
    skillManifests,
    interactionService,
    continuationState,
    claimContinuation,
    assertLockedImageSkill,
    activeClarificationState: state.activeClarificationState,
    skillSource: state.skillSource,
    selectedSkill: state.selectedSkill,
    skillSelectionMethod: state.skillSelectionMethod,
    skillCandidateIds: state.skillCandidateIds,
    referenceContext: state.runReferenceContext,
    referenceImages: state.executionReferenceImages,
    progressTracker,
    writeEvent,
    controller,
    contextLogger,
    latestUserMessage,
  });
  state.approvedConfirmation = interactionResolution.approvedConfirmation;
  state.activeClarificationState = interactionResolution.activeClarificationState;
  state.selectedSkill = interactionResolution.selectedSkill;
  state.skillSource = interactionResolution.skillSource;
  state.skillSelectionMethod = interactionResolution.skillSelectionMethod;
  state.skillCandidateIds = interactionResolution.skillCandidateIds;
  state.runReferenceContext = interactionResolution.referenceContext;
  state.executionReferenceImages = interactionResolution.referenceImages;

  const lookup = scope.createReferenceLookupContext({
    contextEntities,
    sessionVisualAssets,
    generatedImageHistory,
    runReferenceContext: state.runReferenceContext,
  });
  const referenceState = scope.createReferenceState({
    body,
    approvedConfirmation: state.approvedConfirmation,
    runtimeReferenceContext,
    runReferenceContext: state.runReferenceContext,
    getRunReferenceContext: () => state.runReferenceContext,
    getRuntimeReferenceContext: () => runtimeReferenceContext,
    contextEntityById: lookup.contextEntityById,
    runtimeReferenceById: lookup.runtimeReferenceById,
    sessionVisualAssets,
    generatedImageHistory,
    sessionId,
    materializeRecoveryReference,
    resolveRecoveryReferences,
    recentFailedTask,
    requestedRecoveryTaskId,
  });
  state.mainAgentInputMessages = referenceState.mainAgentInputMessages;
  state.mainAgentReferenceContext = referenceState.mainAgentReferenceContext;
  state.mainAgentReferenceImages = referenceState.mainAgentReferenceImages;
  state.initiallyAttachedVisualIds = referenceState.initiallyAttachedVisualIds;
  state.loadedVisualReferenceIds = referenceState.loadedVisualReferenceIds;
  state.recoveryHistoryMessages = referenceState.recoveryHistoryMessages;
  state.resolveVisualReferences = referenceState.resolveVisualReferences;
  state.recoveryRecord = referenceState.recoveryRecord;
  state.recoveryCandidateForAgent = referenceState.recoveryCandidateForAgent;
  state.contextEntityById = lookup.contextEntityById;
  state.runtimeReferenceById = lookup.runtimeReferenceById;
  state.validateContextIds = lookup.validateContextIds;

  const continuationRoutingState = {
    activeClarificationState: state.activeClarificationState,
    recoveryMode: state.recoveryMode,
    recoveryDecision: state.recoveryDecision,
    recoveryBaseRecord: state.recoveryBaseRecord,
    recoveryTaskIdForExecution: state.recoveryTaskIdForExecution,
    recoveryRevisionMessage: state.recoveryRevisionMessage,
    preserveRecoveryRecordOnFailure: state.preserveRecoveryRecordOnFailure,
    imageOperation: state.imageOperation,
    targetReferenceId: state.targetReferenceId,
    selectedSkill: state.selectedSkill,
    skillSource: state.skillSource,
    skillSelectionMethod: state.skillSelectionMethod,
    skillCandidateIds: state.skillCandidateIds,
    recoveryHistoryMessages: state.recoveryHistoryMessages,
    mainAgentInputMessages: state.mainAgentInputMessages,
    mainAgentReferenceContext: state.mainAgentReferenceContext,
    mainAgentReferenceImages: state.mainAgentReferenceImages,
    runReferenceContext: state.runReferenceContext,
    executionReferenceImages: state.executionReferenceImages,
    initiallyAttachedVisualIds: state.initiallyAttachedVisualIds,
    loadedVisualReferenceIds: state.loadedVisualReferenceIds,
  };
  const recoveryRouting = await continuationFlow.routeRecoveryContinuation({
    state: continuationRoutingState,
    recoveryRecord: state.recoveryRecord,
    requestedRecoveryTaskId,
    body,
    runId,
    sessionVisualAssets,
    contextEntityById: lookup.contextEntityById,
    runtimeReferenceById: lookup.runtimeReferenceById,
    runtimeReferenceContext,
    normalizeReferenceContext,
    progressTracker,
    writeLifecycleEvent: scope.writeLifecycleEvent,
    writeProgress: scope.writeProgress,
    writeInteractionEvent: scope.writeInteractionEvent,
    writeEvent,
    writeContextEvent: scope.writeContextEvent,
    writeAgentDone: scope.writeAgentDone,
    contextLogger,
    controller,
    resolvedChatSelection,
    rootTaskId,
    randomUUID,
    skillManifests,
  });
  Object.assign(state, continuationRoutingState);
  if (recoveryRouting.handled) return { handled: true };

  if (state.selectedSkill) {
    try {
      const content = await ensureSelectedSkillContent();
      if (!String(content || '').trim() || !state.skillContentHash) throw new Error('The selected Skill could not be locked');
      state.skillLock = Object.freeze({
        skillId: state.selectedSkill.id,
        skillContent: content,
        skillContentHash: state.skillContentHash,
        executionMode: state.selectedSkill.executionMode || null,
        allowedTools: Object.freeze([...(state.selectedSkill.allowedTools || [])]),
        selectionMethod: state.skillSource || state.skillSelectionMethod || 'none',
      });
    } catch (error) {
      throw Object.assign(new Error(error instanceof Error ? error.message : 'The selected Skill could not be locked'), {
        code: 'skill_lock_failed', failureStage: 'skill_selection', retryable: false,
        skillId: state.selectedSkill.id,
      });
    }
  } else {
    state.skillLock = null;
    state.skillContent = '';
    state.skillContentHash = '';
  }

  applyImageOperationResponse({
    body,
    resolveImageOperationResponse,
    setImageOperation: (value) => { state.imageOperation = value; },
    setIntent: (value) => { state.intent = value; },
    setTargetReferenceId: (value) => { state.targetReferenceId = value; },
  });

  const prepared = await prepareMainAgentState({
    body,
    runId,
    sessionId,
    rootTaskId,
    rootOriginalRequest: scope.rootOriginalRequest,
    selectedSkill: state.selectedSkill,
    runtimeReferenceById: lookup.runtimeReferenceById,
    activeClarificationState: state.activeClarificationState,
    recoveryBaseRecord: state.recoveryBaseRecord,
    imageOperation: state.imageOperation,
    contextLogger,
    ensureImagegenHostContent: scope.ensureImagegenHostContent,
    ensureSelectedSkillContent,
    getSelectedSkill: () => state.selectedSkill,
    hash,
    getSavedSkillHash: () => state.activeClarificationState?.skillContentHash || state.recoveryBaseRecord?.skillContentHash,
    setSkillMetrics: (metrics) => Object.assign(state, metrics),
    getSkillContentTruncated: () => state.skillContentTruncated,
    setTaskSnapshot: (value) => { state.taskSnapshot = value; },
    getTaskSnapshot: () => state.taskSnapshot,
    getProgressSnapshot: () => progressTracker.snapshot(),
    emitTaskSnapshotCheckpoint,
    imagegenHostSkillId,
    recordAgentUserDecision,
    restoreAgentAnalysisSnapshot,
    onContextLoaded: ({ mainAgentLoopState: loopState }) => contextLogger.info('skill.context_loaded', 'Runtime loaded the activated Skill before Main Agent execution', {
      skillCatalogLoaded,
      selectedSkillId: state.selectedSkill?.id || null,
      skillSelectionSource: state.skillSelectionMethod,
      skillRead: loopState.skillRead,
      skillContextLoaded: Boolean(state.selectedSkill && state.skillContent),
      skillContentHash: state.skillContentHash || null,
      skillLoadSource: state.skillSource || null,
      executionMode: state.selectedSkill?.executionMode || 'agent_loop',
      imagegenContextLoaded: loopState.skillRead,
      skillContentLength: state.skillContent?.length || 0,
      skillContentTruncated: state.skillContentTruncated,
      skillOriginalBytes: state.visualSkillOriginalBytes,
      imagegenOriginalBytes: state.imagegenSkillOriginalBytes,
      imagegenInjectedBytes: state.imagegenSkillInjectedBytes,
      skillFragmentRole: 'user',
      skillFragmentOrder: ['imagegen', ...(state.selectedSkill ? [state.selectedSkill.id] : [])],
      recoveryMode: state.recoveryMode,
      recoveryDecision: state.recoveryDecision,
    }),
  });
  return {
    handled: false,
    preparationState: prepared,
    contextEntityById: lookup.contextEntityById,
    runtimeReferenceById: lookup.runtimeReferenceById,
    validateContextIds: lookup.validateContextIds,
  };
}
