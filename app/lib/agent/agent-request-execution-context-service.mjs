/* Request-scoped identity and task execution state. Side effects are injected by the runtime. */
export function createAgentRequestExecutionContext(scope) {
  const {
    body,
    initialContextResolution,
    initialWorkingContext,
    runtimeReferenceContext,
    preparedIntent,
    requestedInterfaceImageCount,
    initialDeliveryPlan,
    normalizeReferenceContext,
    buildReferenceContext,
    sessionId,
    taskId,
    recoveryTaskIdForExecution,
    selectedSkill,
    skillLock,
    reserveTaskExecution,
    getProgressTracker,
    emitTaskSnapshotCheckpoint,
    getIntent,
    getSelectedSkill,
    getWorkingContext,
    getImageDeliveryPlan,
    getDirectImageExecution,
    getRunReferenceContext,
    getAgentAnalysis,
    getRecoveryTaskIdForExecution,
  } = scope;

  const state = {
    skillSource: body.activeSkillId ? 'manual_ui' : null,
    intent: preparedIntent === 'image' || preparedIntent === 'skill_action' ? preparedIntent : 'chat',
    selectedSkill,
    skillLock: skillLock || null,
    skillSelectionMethod: body.activeSkillId ? 'manual_ui' : 'none',
    skillCandidateIds: [],
    skillContent: '',
    skillContentHash: '',
    imagegenHostContent: '',
    imagegenHostContentHash: '',
    imagegenSkillOriginalBytes: 0,
    imagegenSkillInjectedBytes: 0,
    visualSkillOriginalBytes: 0,
    visualSkillInjectedBytes: 0,
    skillContentTruncated: false,
    imagegenLoaded: false,
    visualSkillLoaded: false,
    mainAgentRequestCount: 0,
    directGenerateImageCall: false,
    directGenerateImageCallId: '',
    contextResolution: structuredClone(initialContextResolution),
    workingContextData: structuredClone(initialWorkingContext),
    workingContext: initialWorkingContext.plainText,
    executionReferenceImages: [...(body.referenceImages || [])],
    activeClarificationState: body.clarificationState ? structuredClone(body.clarificationState) : null,
    stagedMainAgentMemoryPatches: [],
    resumedClarification: false,
    proceedWithCurrentBrief: false,
    clarificationSubmissionKey: null,
    requestedImageCount: requestedInterfaceImageCount,
    requestedTotalImageCount: requestedInterfaceImageCount,
    requestedImageCountSource: requestedInterfaceImageCount > 1 ? 'interface' : 'default',
    imageBatchPlan: undefined,
    imageDeliveryPlan: {
      ...initialDeliveryPlan,
      ...(body.clarificationState?.resolvedImageDeliveryMode ? {
        mode: body.clarificationState.resolvedImageDeliveryMode,
        panelCount: body.clarificationState.resolvedImageDeliveryMode === 'composite'
          ? body.clarificationState.resolvedImagePanelCount
          : undefined,
      } : {}),
    },
    directImageExecution: null,
    lockedImageToolArgs: null,
    nativeGeneratedImageResult: null,
    nativeImageFailure: null,
    approvedConfirmation: null,
    executionKind: null,
    taskExecutionReservation: null,
    completedTaskIdentities: [],
    taskSnapshot: undefined,
    recoveryBaseRecord: null,
    imageOperation: body.clarificationState?.imageOperation || null,
    targetReferenceId: body.clarificationState?.targetReferenceId || null,
    mainAgentFailureCheckpoint: undefined,
    agentAnalysis: body.clarificationState?.agentAnalysis || null,
    writeAgentAnalysisCheckpoint: () => {},
    preserveRecoveryRecordOnFailure: false,
    recoveryTaskIdForExecution: recoveryTaskIdForExecution || null,
    recoveryMode: null,
    recoveryDecision: null,
    recoveryRevisionMessage: '',
    toolCallRecords: [],
  };

  if (state.activeClarificationState?.referenceContext) {
    state.activeClarificationState.referenceContext = normalizeReferenceContext(state.activeClarificationState.referenceContext);
  }
  if (state.executionReferenceImages.length === 0 && state.activeClarificationState?.referenceImages?.length) {
    state.executionReferenceImages = [...state.activeClarificationState.referenceImages];
  }
  state.runReferenceContext = buildReferenceContext({
    referenceContext: runtimeReferenceContext || state.activeClarificationState?.referenceContext,
    referenceImages: state.executionReferenceImages,
    canvasContext: body.canvasContext,
  });
  if (state.imageOperation) state.intent = 'image';

  const getTaskExecutionReservation = (runtime) => {
    if (state.taskExecutionReservation) return state.taskExecutionReservation;
    const directImageExecution = getDirectImageExecution();
    if (!directImageExecution && !runtime) return null;
    const intent = getIntent();
    const selected = getSelectedSkill();
    const imageDeliveryPlan = getImageDeliveryPlan();
    const workingContext = getWorkingContext();
    const contract = directImageExecution ? {
      intent: 'image', skillId: selected?.id || null,
      brief: { deliverable: 'image', subject: directImageExecution.contract.prompt, style: [], literalCopy: [], constraints: [] },
      delivery: { mode: directImageExecution.delivery.mode, outputCount: directImageExecution.contract.outputCount, panelCount: directImageExecution.delivery.panelCount || null, variationAxes: [], sharedInvariants: [], distinctPerItem: [], items: [] },
      imageTask: structuredClone(directImageExecution.imageTask), generation: null,
      execution: { kind: 'image_pipeline', requiresConfirmation: false, tool: 'generate_image' },
    } : {
      intent, skillId: selected?.id || null,
      brief: { deliverable: workingContext, subject: workingContext, style: [], literalCopy: [], constraints: [] },
      delivery: { mode: imageDeliveryPlan.mode, outputCount: runtime?.outputCount || 1, panelCount: imageDeliveryPlan.panelCount || null, variationAxes: imageDeliveryPlan.variationAxes || [], sharedInvariants: [], distinctPerItem: [], items: [] },
      ...(runtime?.imageTask ? { imageTask: structuredClone(runtime.imageTask) } : {}), generation: null,
      execution: { kind: runtime.kind, requiresConfirmation: false, tool: runtime.tool },
    };
    state.taskExecutionReservation = reserveTaskExecution(contract, directImageExecution?.imageTask || runtime?.imageTask, directImageExecution?.contract.outputCount || runtime?.outputCount || 1, getRunReferenceContext(), getRecoveryTaskIdForExecution() || taskId);
    const reservation = state.taskExecutionReservation;
    const identity = getProgressTracker().snapshot();
    state.taskSnapshot = emitTaskSnapshotCheckpoint({ sessionId, taskId: reservation.taskId, operationId: identity.operationId, lastSequence: identity.lastSequence, contractVersion: reservation.contractVersion, contract: structuredClone(reservation.contract), latestBatchId: reservation.latestBatchId, editBaseVersionId: reservation.editBaseVersionId, activeVersions: [] });
    return reservation;
  };

  const recordSucceededTaskIdentities = (identities) => {
    const reservation = getTaskExecutionReservation();
    if (!reservation || !identities.length) return;
    const succeededSlots = new Map(identities.map((identity) => [identity.slotId, identity]));
    state.completedTaskIdentities = [...state.completedTaskIdentities.filter((identity) => !succeededSlots.has(identity.slotId)), ...identities];
    const identity = getProgressTracker().snapshot();
    state.taskSnapshot = emitTaskSnapshotCheckpoint({ sessionId, taskId: reservation.taskId, operationId: identity.operationId, lastSequence: identity.lastSequence, contractVersion: reservation.contractVersion, contract: structuredClone(reservation.contract), editBaseVersionId: reservation.editBaseVersionId, latestBatchId: reservation.latestBatchId, activeVersions: state.completedTaskIdentities.map((item) => structuredClone(item)), ...(getAgentAnalysis() ? { agentAnalysis: structuredClone(getAgentAnalysis()) } : {}) });
  };

  return {
    state,
    getTaskExecutionReservation,
    recordSucceededTaskIdentities,
    writeAgentDone: (stopReason, writeLifecycleEvent) => writeLifecycleEvent({ type: 'agent_done', stopReason, ...(state.taskSnapshot ? { taskSnapshot: structuredClone(state.taskSnapshot) } : {}), ...getProgressTracker().stamp() }),
  };
}

export function createAgentTopicMemoryService(scope) {
  let memory = scope.normalize(scope.initialMemory);
  const emit = () => {
    if (memory) scope.emit(memory);
    return memory;
  };
  return {
    get memory() { return memory; },
    update: (patch) => {
      memory = scope.merge(memory, patch, scope.messages);
      scope.emit(memory);
      return memory;
    },
    commit: (stagedPatches = [], patch) => {
      for (const staged of stagedPatches) memory = scope.merge(memory, staged, scope.messages);
      if (patch) memory = scope.merge(memory, patch, scope.messages);
      return emit();
    },
  };
}

export function createAgentConfirmationTaskIdentity(scope) {
  return () => {
    const reservation = scope.getReservation();
    return reservation ? {
      sessionId: scope.sessionId,
      taskId: reservation.taskId,
      contractVersion: reservation.contractVersion,
      taskContract: structuredClone(reservation.contract),
      pendingTaskIdentities: structuredClone(reservation.identities),
      completedTaskIdentities: structuredClone(scope.getCompletedTaskIdentities()),
      sourceTaskId: reservation.sourceTaskId,
      sourceVersionId: reservation.sourceVersionId,
      editBaseVersionId: reservation.editBaseVersionId,
    } : {};
  };
}

export function createAgentMainAgentPreparationService(scope) {
  const loadImagegenContext = async () => {
    const hostContent = await scope.ensureImagegenHostContent();
    const hostContentHash = scope.hash(hostContent);
    const selectedSkill = scope.getSelectedSkill();
    const visualContent = selectedSkill ? await scope.ensureSelectedSkillContent() : '';
    const visualContentHash = visualContent ? scope.hash(visualContent) : '';
    const hostBound = { originalBytes: Buffer.byteLength(hostContent), injectedBytes: Buffer.byteLength(hostContent), truncated: false };
    const visualBound = { originalBytes: Buffer.byteLength(visualContent), injectedBytes: Buffer.byteLength(visualContent), truncated: false };
    scope.setSkillMetrics({
      imagegenSkillOriginalBytes: hostBound.originalBytes,
      imagegenSkillInjectedBytes: hostBound.injectedBytes,
      visualSkillOriginalBytes: visualBound.originalBytes,
      visualSkillInjectedBytes: visualBound.injectedBytes,
      skillContentTruncated: hostBound.truncated || visualBound.truncated,
      imagegenLoaded: true,
      visualSkillLoaded: Boolean(selectedSkill && visualContent),
    });
    const savedSkillHash = scope.getSavedSkillHash();
    if (savedSkillHash && visualContentHash && savedSkillHash !== visualContentHash) {
      throw Object.assign(new Error('The locked visual Skill changed after this task was created'), {
        code: 'skill_lock_failed',
        failureStage: 'skill_selection',
        retryable: false,
        skillId: selectedSkill?.id || null,
      });
    }
    scope.markSkillRead();
    void scope.logger?.info?.('imagegen.context_read', 'Runtime loaded the ImageGen host and locked visual Skill', {
      source: 'runtime', hostContentLength: hostContent.length, hostContentHash,
      visualSkillId: selectedSkill?.id || null, visualContentLength: visualContent.length,
      visualContentHash: visualContentHash || null, skillContentTruncated: scope.getSkillContentTruncated(),
      imagegenOriginalBytes: hostBound.originalBytes, imagegenInjectedBytes: hostBound.injectedBytes,
      visualOriginalBytes: visualBound.originalBytes, visualInjectedBytes: visualBound.injectedBytes,
      skillFragmentRole: 'user', skillFragmentOrder: ['imagegen', ...(selectedSkill ? [selectedSkill.id] : [])],
    });
    return {
      hostSkill: { id: scope.imagegenHostSkillId, content: hostContent, contentHash: hostContentHash },
      visualSkill: selectedSkill ? { id: selectedSkill.id, content: visualContent, contentHash: visualContentHash } : null,
    };
  };
  return { loadImagegenContext };
}

// Owns the request-level setup immediately before the native Main Agent turn.
// The runtime supplies state accessors because the surrounding request still
// owns continuation and recovery mutation.
export async function prepareAgentMainAgentState(scope) {
  const {
    body,
    runId,
    rootTaskId,
    rootOriginalRequest,
    selectedSkill,
    runtimeReferenceById,
    activeClarificationState,
    recoveryBaseRecord,
    imageOperation,
    contextLogger,
    ensureImagegenHostContent,
    ensureSelectedSkillContent,
    getSelectedSkill,
    hash,
    getSavedSkillHash,
    setSkillMetrics,
    getSkillContentTruncated,
    setTaskSnapshot,
    getTaskSnapshot,
    getProgressSnapshot,
    emitTaskSnapshotCheckpoint,
    recordAgentUserDecision,
    restoreAgentAnalysisSnapshot,
  } = scope;

  const mainAgentLoopState = {
    contextRequested: false,
    contextScopes: new Set(),
    selectedSkillId: selectedSkill?.id || null,
    skillRead: false,
  };
  const relevantContextCandidateIds = new Set();
  const analysisDefaults = {
    taskId: rootTaskId(),
    runId,
    originalRequest: rootOriginalRequest(),
    uiMode: body.intent === 'image' || body.intent === 'chat' ? body.intent : 'agent',
    selectedSkillId: selectedSkill?.id || null,
    explicitReferenceIds: [...runtimeReferenceById.keys()],
    ...(imageOperation ? { operation: imageOperation } : {}),
  };
  const savedAgentAnalysis = activeClarificationState?.agentAnalysis
    || recoveryBaseRecord?.taskSnapshot?.agentAnalysis;
  let agentAnalysis = savedAgentAnalysis
    ? restoreAgentAnalysisSnapshot(savedAgentAnalysis, analysisDefaults)
    : null;
  if (agentAnalysis && body.clarificationResponse && body.clarificationRequest) {
    const answer = body.clarificationResponse.customText
      || body.clarificationRequest.options.find((option) => option.id === body.clarificationResponse?.selectedOptionId)?.answer
      || '';
    if (answer) recordAgentUserDecision(agentAnalysis, body.clarificationRequest.dimension, answer);
  }
  const writeAgentAnalysisCheckpoint = () => {
    if (!agentAnalysis) return;
    const previous = getTaskSnapshot() || recoveryBaseRecord?.taskSnapshot;
    const progress = getProgressSnapshot();
    const nextSnapshot = {
      sessionId: scope.sessionId,
      taskId: agentAnalysis.taskId,
      operationId: previous?.operationId || progress.operationId,
      lastSequence: previous?.lastSequence ?? progress.lastSequence,
      contractVersion: previous?.contractVersion || 1,
      ...(previous?.contract ? { contract: structuredClone(previous.contract) } : {}),
      ...(previous?.editBaseVersionId !== undefined ? { editBaseVersionId: previous.editBaseVersionId } : {}),
      ...(previous?.latestBatchId !== undefined ? { latestBatchId: previous.latestBatchId } : {}),
      activeVersions: structuredClone(previous?.activeVersions || []),
      agentAnalysis: structuredClone(agentAnalysis),
    };
    setTaskSnapshot(emitTaskSnapshotCheckpoint(nextSnapshot));
  };
  const preparation = createAgentMainAgentPreparationService({
    ensureImagegenHostContent,
    ensureSelectedSkillContent,
    getSelectedSkill,
    hash,
    getSavedSkillHash,
    setSkillMetrics,
    markSkillRead: () => { mainAgentLoopState.skillRead = true; },
    getSkillContentTruncated,
    logger: contextLogger,
    imagegenHostSkillId: scope.imagegenHostSkillId,
  });
  if (selectedSkill) await ensureSelectedSkillContent();
  await preparation.loadImagegenContext();
  if (typeof scope.onContextLoaded === 'function') {
    await scope.onContextLoaded({ mainAgentLoopState, agentAnalysis });
  }
  const selectedContextResponse = body.clarificationRequest?.dimension === 'context_reference'
    && typeof body.clarificationResponse?.selectedOptionId === 'string'
    ? body.clarificationResponse.selectedOptionId : '';
  const confirmedSkillResponse = body.clarificationRequest?.dimension === 'skill_selection'
    && typeof body.clarificationResponse?.selectedOptionId === 'string'
    ? body.clarificationResponse.selectedOptionId : '';
  return {
    mainAgentLoopState,
    relevantContextCandidateIds,
    analysisDefaults,
    getAgentAnalysis: () => agentAnalysis,
    setAgentAnalysis: (value) => { agentAnalysis = value; return agentAnalysis; },
    writeAgentAnalysisCheckpoint,
    selectedContextResponse,
    confirmedSkillResponse,
    savedMainAgentLoop: null,
    selectedUserDecisionAnswer: '',
    analysisCheckpointResume: recoveryBaseRecord?.failure.stage === 'analysis'
      && recoveryBaseRecord.resumeRoute === 'main_agent'
      && Boolean(recoveryBaseRecord.mainAgentLoop)
      && Boolean(agentAnalysis),
  };
}

export function validateMainAgentContinuationResponses({
  savedMainAgentLoop,
  selectedContextResponse,
  confirmedSkillResponse,
  contextEntityById,
  selectedSkill,
  imageOperation,
  permittedContextOptionIds = [],
  setTargetReferenceId,
}) {
  if (
    savedMainAgentLoop
    && selectedContextResponse === ''
  ) throw new Error('Context selection requires choosing one of the listed references');
  if (savedMainAgentLoop && selectedContextResponse) {
    const permittedIds = new Set(permittedContextOptionIds);
    if (!permittedIds.has(selectedContextResponse) || !contextEntityById.has(selectedContextResponse)) {
      throw new Error('Context selection response does not match the pending Main Agent request');
    }
    if (imageOperation === 'edit') setTargetReferenceId(selectedContextResponse);
  }
  if (savedMainAgentLoop && confirmedSkillResponse
    && (confirmedSkillResponse !== savedMainAgentLoop.selectedSkillId
      || confirmedSkillResponse !== selectedSkill?.id)) {
    throw new Error('Skill selection response does not match the pending Main Agent request');
  }
}

export function createAgentReferenceLookupContext({
  contextEntities = [],
  sessionVisualAssets = [],
  generatedImageHistory = [],
  runReferenceContext,
}) {
  const contextEntityById = new Map(contextEntities.map((entity) => [entity.id, entity]));
  const runtimeReferenceById = new Map((runReferenceContext?.references || []).map((reference) => [reference.id, reference]));
  const validateContextIds = (ids, source) => {
    const values = Array.isArray(ids) ? ids.map((id) => String(id).trim()).filter(Boolean) : [];
    for (const id of values) {
      const valid = source === 'context'
        ? contextEntityById.has(id)
        : contextEntityById.has(id)
          || runtimeReferenceById.has(id)
          || sessionVisualAssets.some((asset) => asset.id === id || asset.sourceReferenceId === id)
          || generatedImageHistory.some((entry) => `history-image:${entry.id}` === id || entry.assetId === id);
      if (!valid) throw new Error(`Unknown ${source} reference: ${id}`);
    }
    return Array.from(new Set(values));
  };
  return { contextEntityById, runtimeReferenceById, validateContextIds };
}

export function createAgentMainAgentReferenceState(scope) {
  const {
    body, approvedConfirmation, runtimeReferenceContext,
    contextEntityById, runtimeReferenceById, sessionVisualAssets, generatedImageHistory,
    sessionId, materializeRecoveryReference, resolveRecoveryReferences,
    recentFailedTask, requestedRecoveryTaskId,
  } = scope;
  const mainAgentReferenceContext = approvedConfirmation?.referenceContext || runtimeReferenceContext;
  const mainAgentReferenceImages = mainAgentReferenceContext?.references.length
    ? mainAgentReferenceContext.references.map((reference) => reference.src)
    : approvedConfirmation?.referenceImages || body.referenceImages || [];
  const initiallyAttachedVisualIds = new Set((mainAgentReferenceContext?.references || []).map((reference) => reference.id));
  const loadedVisualReferenceIds = new Set(initiallyAttachedVisualIds);
  const resolveVisualReferences = (ids) => resolveRecoveryReferences({
    ids, runtimeReferenceById, referenceContext: scope.getRunReferenceContext()
      || scope.getRuntimeReferenceContext(), contextEntityById, sessionVisualAssets,
    generatedImageHistory, sessionId,
    materialize: ({ input }) => materializeRecoveryReference({ input, sessionId }),
  });
  const recoveryRecord = recentFailedTask;
  const recoveryCandidateForAgent = recoveryRecord && !requestedRecoveryTaskId ? {
    id: recoveryRecord.taskId, status: recoveryRecord.status,
    originalRequest: recoveryRecord.originalRequest, failureMessage: recoveryRecord.failure.message,
    failureStage: recoveryRecord.failure.stage, intent: recoveryRecord.intent,
    skillId: recoveryRecord.skillId, contextEntityIds: recoveryRecord.contextEntityIds,
  } : null;
  return {
    mainAgentInputMessages: body.messages,
    mainAgentReferenceContext, mainAgentReferenceImages,
    initiallyAttachedVisualIds, loadedVisualReferenceIds,
    recoveryHistoryMessages: body.messages,
    resolveVisualReferences, recoveryRecord, recoveryCandidateForAgent,
    recoveryLockedSkillId: recoveryRecord?.skillId || null,
  };
}

export function applyAgentImageOperationResponse({ body, resolveImageOperationResponse, setImageOperation, setIntent, setTargetReferenceId }) {
  if (body.clarificationRequest?.dimension !== 'image_operation') return null;
  const operation = resolveImageOperationResponse(body.clarificationResponse);
  if (!operation) return null;
  setImageOperation(operation);
  setIntent('image');
  if (operation === 'generate') setTargetReferenceId(null);
  return operation;
}
