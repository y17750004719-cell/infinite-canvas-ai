/* Request-scoped adapters shared by the Agent runtime's preparation and turn flows. */
import { createAgentRequestExecutionContext, createAgentTopicMemoryService, createAgentConfirmationTaskIdentity } from './agent-request-execution-context-service.mjs';
import { createAgentRequestExecutionState } from './agent-request-execution-state.mjs';
import { createAgentImageRuntimeContext, createAgentSkillRuntimeContext } from './agent-image-runtime-context-service.mjs';

export function buildSucceededImageTaskIdentities(assets, reservation, selection, items = []) {
  const identities = reservation?.identities || [];
  return assets.map((asset, assetIndex) => {
    // Failed requests disappear from assets, so its index is no longer the
    // original request index. Keep the saved image attached to its own slot.
    let index = asset.versionId ? identities.findIndex((identity) => identity.versionId === asset.versionId) : -1;
    if (index < 0 && asset.slotId) index = identities.findIndex((identity) => identity.slotId === asset.slotId);
    if (index < 0 && !asset.versionId && !asset.slotId) index = assetIndex;
    return {
      ...(identities[index] || {}),
      ...(asset.slotId ? { slotId: asset.slotId } : {}),
      ...(asset.versionId ? { versionId: asset.versionId } : {}),
      ...(asset.assetId || asset.id ? { assetId: asset.assetId || asset.id } : {}),
      assetUrl: asset.durableSrc || asset.src,
      previewSrc: asset.previewSrc || asset.durableSrc || asset.src,
      model: selection.selection.model,
      ...(index >= 0 ? { index, itemId: items[index]?.id, label: items[index]?.label } : {}),
    };
  });
}

/** Assemble stream-owned runtime contexts from request state without leaking the wiring into HTTP orchestration. */
export function createAgentRequestRuntimeContextsFromRequest(scope = {}) {
  const {
    createContexts = createAgentRequestRuntimeContexts,
    body, controller, sessionId, taskId, runId, operationId, journalTurnId,
    initialContextResolution, initialWorkingContext, runtimeReferenceContext, preparedIntent,
    requestedInterfaceImageCount, initialDeliveryPlan, normalizeReferenceContext,
    buildReferenceContext, selectedSkill, reserveTaskExecution,
    getIntent, getSelectedSkill, getWorkingContext, getImageDeliveryPlan,
    getDirectImageExecution, getRunReferenceContext, getAgentAnalysis,
    getRecoveryTaskIdForExecution, interactionService, contextLogger,
    normalizeConversationMemory, mergeTopicMemory, latestUserMessage, writeEvent,
    request, runSignal, providers, providerImageOptionProfiles, buildRequests,
    resolveExecutionMode, materializeSessionVisualAsset, generatedAssetsFromResult,
    hashPrompt, startHeartbeat, resolvedModel, requestHistoryRevision,
    requestUserMessageRevision, requestActiveWindowRevision, threadJournalService,
    updateActiveAgentRun, takeActiveAgentRunInputs, resolvedChatSelection,
    imagegenHostSkillId, createProgressTracker, initialAgentIdentity, eventDependencies,
    getSkillContentHash, getSelectedSkillRef, skillContentRef, imagegenHostContentRef,
    setSkillContent, setSkillContentHash, setImagegenHostContent, setImagegenHostContentHash,
    stagedMainAgentMemoryPatchesRef, clearStagedMainAgentMemoryPatches, flush,
    emitTaskSnapshotCheckpoint, writeLifecycleEvent, directImageExecution = null,
  } = scope;
  return createContexts({
    body, controller, sessionId, taskId, runId, operationId, journalTurnId,
    initialContextResolution, initialWorkingContext, runtimeReferenceContext, preparedIntent,
    requestedInterfaceImageCount, initialDeliveryPlan, normalizeReferenceContext,
    buildReferenceContext, selectedSkill, reserveTaskExecution,
    emitTaskSnapshotCheckpoint, getIntent, getSelectedSkill, getWorkingContext,
    getImageDeliveryPlan, getDirectImageExecution, getRunReferenceContext,
    getAgentAnalysis, getRecoveryTaskIdForExecution, interactionService, contextLogger,
    normalizeConversationMemory, mergeTopicMemory, latestUserMessage, writeEvent,
    writeLifecycleEvent, request, runSignal, providers, providerImageOptionProfiles,
    directImageExecution, buildRequests, resolveExecutionMode, materializeSessionVisualAsset,
    generatedAssetsFromResult, hashPrompt, startHeartbeat, resolvedModel,
    requestHistoryRevision, requestUserMessageRevision, requestActiveWindowRevision,
    threadJournalService, updateActiveAgentRun, takeActiveAgentRunInputs,
    resolvedChatSelection, imagegenHostSkillId, createProgressTracker, initialAgentIdentity,
    eventDependencies, getSkillContentHash, getSelectedSkillRef, skillContentRef,
    imagegenHostContentRef, setSkillContent, setSkillContentHash, setImagegenHostContent,
    setImagegenHostContentHash, stagedMainAgentMemoryPatchesRef,
    clearStagedMainAgentMemoryPatches, flush,
  });
}

/**
 * Builds the mutable request adapters used by the main-agent loop.
 * The request runtime owns orchestration; this service owns the wiring between
 * task identity, progress, memory, Skill loading, and image execution.
 */
export function createAgentRequestRuntimeContexts(scope = {}) {
  const {
    body, controller, taskId, runId, operationId, sessionId, journalTurnId,
    initialContextResolution, initialWorkingContext, runtimeReferenceContext, preparedIntent,
    requestedInterfaceImageCount, initialDeliveryPlan, normalizeReferenceContext,
    buildReferenceContext, reserveTaskExecution, progressTracker: suppliedProgressTracker, emitTaskSnapshotCheckpoint,
    getIntent, getSelectedSkill, getWorkingContext, getImageDeliveryPlan,
    getDirectImageExecution, getRunReferenceContext, getAgentAnalysis,
    getRecoveryTaskIdForExecution, selectedSkill, interactionService, contextLogger,
    normalizeConversationMemory, mergeTopicMemory, latestUserMessage,
    createProgressTracker, initialAgentIdentity,
    stagedMainAgentMemoryPatchesRef, writeEvent, writeLifecycleEvent,
    request, runSignal, providers, providerImageOptionProfiles, directImageExecution,
    buildRequests, resolveExecutionMode, materializeSessionVisualAsset,
    generatedAssetsFromResult, hashPrompt, startHeartbeat, writeProgress,
    resolvedModel, requestHistoryRevision, requestUserMessageRevision,
    requestActiveWindowRevision, threadJournalService, updateActiveAgentRun,
    takeActiveAgentRunInputs, imagegenHostSkillId,
    skillContentRef, skillContentHashRef, imagegenHostContentRef,
    getSkillContentHash, getSelectedSkillRef,
    getImagegenHostContent, setImagegenHostContent, setImagegenHostContentHash,
  } = scope;

  const progressTracker = suppliedProgressTracker || createProgressTracker({
    taskId: initialAgentIdentity?.taskId || taskId,
    runId, operationId,
    lastSequence: initialAgentIdentity?.lastSequence || 0,
    emit: (event) => writeEvent(controller, event),
  });

  const executionContext = createAgentRequestExecutionContext({
    body, initialContextResolution, initialWorkingContext, runtimeReferenceContext, preparedIntent,
    requestedInterfaceImageCount, initialDeliveryPlan, normalizeReferenceContext,
    buildReferenceContext, sessionId, taskId, runId, selectedSkill,
    reserveTaskExecution, getProgressTracker: () => progressTracker,
    emitTaskSnapshotCheckpoint, getIntent, getSelectedSkill, getWorkingContext,
    getImageDeliveryPlan, getDirectImageExecution, getRunReferenceContext,
    getAgentAnalysis, getRecoveryTaskIdForExecution,
  });

  const sourceUserMessageId = typeof body.sourceUserMessageId === 'string' && body.sourceUserMessageId.trim()
    ? body.sourceUserMessageId.trim().slice(0, 200)
    : [...body.messages].reverse().find((message) => message.role === 'user')?.id || `user-${runId}`;

  const getTaskExecutionReservation = (runtime) => executionContext.getTaskExecutionReservation(runtime);
  const recordSucceededTaskIdentities = (identities) => executionContext.recordSucceededTaskIdentities(identities);
  const writeAgentDone = (stopReason) => executionContext.writeAgentDone(stopReason, writeLifecycleEvent);

  const topicMemoryService = createAgentTopicMemoryService({
    initialMemory: body.agentMemory,
    normalize: normalizeConversationMemory,
    merge: mergeTopicMemory,
    messages: body.messages,
    emit: (memory) => writeEvent(controller, { type: 'agent_memory_updated', memory }),
  });
  const updateTopicMemory = (patch) => topicMemoryService.update(patch);
  const commitMainAgentMemory = (patch) => {
    const staged = stagedMainAgentMemoryPatchesRef?.() || [];
    const next = topicMemoryService.commit(staged, patch);
    scope.clearStagedMainAgentMemoryPatches?.();
    return next;
  };
  const getTopicMemory = () => topicMemoryService.memory;

  const confirmationTaskIdentity = createAgentConfirmationTaskIdentity({
    sessionId,
    getReservation: () => getTaskExecutionReservation(),
    getCompletedTaskIdentities: () => executionContext.state.completedTaskIdentities,
  });

  const executionState = createAgentRequestExecutionState({
    tracker: progressTracker,
    emit: (event) => writeEvent(controller, event),
    ...scope.eventDependencies,
    sessionId, runId, taskId, operationId, latestUserMessage, sourceUserMessageId,
    runtimeReferenceContext, requestHistoryRevision, requestUserMessageRevision,
    requestActiveWindowRevision, threadJournalService, journalTurnId, runSignal,
    contextLogger, updateActiveAgentRun, takeActiveAgentRunInputs,
    startHeartbeat, toolResultState: { hasMutationEvidence: false }, resolvedModel,
    getSkillContentHash: getSkillContentHash || (() => skillContentHashRef?.()),
  });

  const skillRuntimeContext = createAgentSkillRuntimeContext({
    interactionService,
    getSelectedSkill: getSelectedSkillRef || getSelectedSkill,
    getSkillContent: skillContentRef || (() => ''),
    setSkillContent: (value) => scope.setSkillContent?.(value),
    setSkillContentHash: (value) => scope.setSkillContentHash?.(value),
    getImagegenHostContent: getImagegenHostContent || (() => imagegenHostContentRef?.() || ''),
    setImagegenHostContent: setImagegenHostContent || (() => {}),
    setImagegenHostContentHash: setImagegenHostContentHash || (() => {}),
    imagegenHostSkillId,
  });

  const runtimeWriteProgress = writeProgress || executionState.writeProgress;

  const { imageExecutionFlow, executeImagePayload } = createAgentImageRuntimeContext({
    request, signal: runSignal, runId, sessionId, taskId, operationId,
    flush: async () => scope.flush?.(), providers, providerImageOptionProfiles,
    selectedSkill,
    getSelectedSkill,
    directImageExecution,
    resolveTaskReservation: (runtime) => getTaskExecutionReservation(runtime),
    buildRequests, resolveExecutionMode,
    persistAsset: async (asset) => materializeSessionVisualAsset({ sessionId, source: {
      src: asset.src, source: 'generated', sourceReferenceId: asset.sourceReferenceId,
      taskId: asset.taskId, batchId: asset.batchId, versionId: asset.versionId,
      previewSrc: asset.previewSrc || asset.src,
    }}),
    materializeAsset: async (asset) => {
      const persisted = await materializeSessionVisualAsset({ sessionId, source: {
        src: asset.src, source: 'generated', sourceReferenceId: directImageExecution?.imageTask?.sourceReferenceId,
        taskId, versionId: asset.versionId, previewSrc: asset.previewSrc || asset.src,
      }});
      return { ...asset, ...persisted, src: persisted.durableSrc,
        previewSrc: persisted.previewSrc || persisted.durableSrc, assetId: persisted.id };
    },
    emit: (event) => writeEvent(controller, event),
    writeProgress: runtimeWriteProgress,
    writeLog: (event, metadata) => void contextLogger.info(event, event, metadata),
    generatedAssetsFromResult, hashPrompt,
    heartbeat: (toolCallId) => startHeartbeat({ onPulse: () => executionState.writeToolProgress('generate_image', 'active', toolCallId) }),
    recordSucceeded: (assets, reservation, selection, items) => {
      recordSucceededTaskIdentities(buildSucceededImageTaskIdentities(assets, reservation, selection, items));
    },
  });

  return {
    executionContext,
    state: executionContext.state,
    sourceUserMessageId,
    getTaskExecutionReservation,
    recordSucceededTaskIdentities,
    writeAgentDone,
    getTopicMemory,
    updateTopicMemory,
    commitMainAgentMemory,
    confirmationTaskIdentity,
    executionState,
    skillRuntimeContext,
    imageExecutionFlow,
    executeImagePayload,
  };
}

/** Flatten the request context into the bindings consumed by the turn loop. */
export function getAgentRequestRuntimeBindings(runtimeContexts) {
  const { executionContext, executionState } = runtimeContexts;
  const state = executionContext.state;
  return {
    ...state,
    skillSource: state.skillSource,
    sourceUserMessageId: runtimeContexts.sourceUserMessageId,
    writeAgentDone: runtimeContexts.writeAgentDone,
    getTopicMemory: runtimeContexts.getTopicMemory,
    updateTopicMemory: runtimeContexts.updateTopicMemory,
    commitMainAgentMemory: runtimeContexts.commitMainAgentMemory,
    confirmationTaskIdentity: runtimeContexts.confirmationTaskIdentity,
    executionState,
    skillRuntimeContext: runtimeContexts.skillRuntimeContext,
    imageExecutionFlow: runtimeContexts.imageExecutionFlow,
    executeImagePayload: runtimeContexts.executeImagePayload,
    progressTracker: executionState.tracker,
    writeContextEvent: executionState.writeContextEvent,
    writeUserContextEvent: executionState.writeUserContextEvent,
    writeLifecycleEvent: executionState.writeLifecycleEvent,
    emitTaskSnapshotCheckpoint: executionState.emitTaskSnapshotCheckpoint,
    writeInteractionEvent: executionState.writeInteractionEvent,
    writeProgress: executionState.writeProgress,
    writeToolStartEvent: executionState.writeToolStartEvent,
    writeToolUpdateEvent: executionState.writeToolUpdateEvent,
    writeToolResultEvent: executionState.writeToolResultEvent,
    writeToolUpdate: executionState.writeToolUpdate,
    writeStampedAgentEvent: executionState.writeStampedAgentEvent,
    writeToolProgress: executionState.writeToolProgress,
    rememberToolPublicProgress: executionState.rememberToolPublicProgress,
    copyToolPublicProgress: executionState.copyToolPublicProgress,
    appendActivityText: executionState.appendActivityText,
    commitCurrentActivity: executionState.commitCurrentActivity,
    emitIntentResolved: executionState.emitIntentResolved,
    startMainAgentKeepalive: executionState.startMainAgentKeepalive,
    getExternalSteeringMessages: executionState.getExternalSteeringMessages,
    getExternalFollowUpMessages: executionState.getExternalFollowUpMessages,
    toolEventMetadata: executionState.toolEventMetadata,
    toolItemId: executionState.toolItemId,
    toolExecutionId: executionState.toolExecutionId,
    publicProgressByToolCallId: executionState.publicProgressByToolCallId,
  };
}
