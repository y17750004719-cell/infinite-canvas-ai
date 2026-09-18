/* Request admission and continuation identity checks for /api/agent. */
export async function admitAgentRequest(scope = {}) {
  const {
    request, nextResponse, randomUUID, getLatestUserMessage, normalizeReferenceContext,
    parseSlashCommand, isManagementCommand, commandUsage, handleManagementCommand,
    loadThread, prepareContext, normalizeRecentFailedTask, resolveAgentIdentity,
    continuationState, pruneConfirmationStore, assertSameAgentOperation, assertExpectedSequence,
    createLogger, createInteractionService, loadSkillContent, body: suppliedBody,
  } = scope;
  const body = suppliedBody || await request.json().catch(() => null);
  if (!body || !Array.isArray(body.messages)) {
    return { response: nextResponse.json({ error: 'Messages are required' }, { status: 400 }) };
  }
  const runtimeReferenceContext = normalizeReferenceContext(body.referenceContext);
  const clientRunId = typeof body.clientRunId === 'string' && body.clientRunId.trim()
    ? body.clientRunId.trim() : null;
  if (clientRunId && clientRunId.length > 200) {
    return { response: nextResponse.json({ error: 'clientRunId exceeds 200 characters', code: 'invalid_identity' }, { status: 400 }) };
  }
  const runId = randomUUID();
  const sessionId = typeof body.sessionId === 'string' ? body.sessionId.trim() : '';
  if (!sessionId || sessionId.length > 200) {
    return { response: nextResponse.json({ error: 'sessionId is required', code: 'invalid_identity' }, { status: 400 }) };
  }
  const latestUserMessage = getLatestUserMessage(body.messages);
  const slashCommand = parseSlashCommand(latestUserMessage);
  if (slashCommand && !slashCommand.known) {
    return { response: nextResponse.json({ error: `Unknown command ${slashCommand.raw}`, code: 'unknown_command', usage: commandUsage(slashCommand.name) }, { status: 400 }) };
  }
  if (slashCommand && isManagementCommand(slashCommand)) {
    return { response: await handleManagementCommand(sessionId, slashCommand) };
  }
  const contextFlow = scope.createContextFlow({
    loadThread,
    normalizeReferenceContext,
    prepare: (input) => prepareContext(input),
  });
  const preparedContext = await contextFlow.prepare({
    body, sessionId, latestUserMessage,
    normalizedRecentFailedTask: normalizeRecentFailedTask(body.recentFailedTask, body.messages)
      || normalizeRecentFailedTask(body.clarificationState?.recoveryRecord, body.messages),
  });
  if (!preparedContext.ok) {
    return { response: nextResponse.json(preparedContext.response.payload, { status: preparedContext.response.status }) };
  }
  const preparedSnapshot = preparedContext.value;
  const journalTurnId = preparedSnapshot.journalTurnId || runId;
  const recentFailedTask = preparedSnapshot.recentFailedTask;
  let initialAgentIdentity;
  try {
    initialAgentIdentity = resolveAgentIdentity({
      runId,
      continuation: body.recoveryTaskId ? recentFailedTask || undefined : body.clarificationState || undefined,
      operationId: body.operationId,
    });
  } catch (error) {
    return { response: nextResponse.json({ error: error instanceof Error ? error.message : 'Invalid Agent identity', code: 'invalid_identity' }, { status: 400 }) };
  }
  const continuationOperationId = body.recoveryTaskId ? recentFailedTask?.operationId : body.clarificationState?.operationId;
  if (body.operationId && continuationOperationId && body.operationId !== continuationOperationId) {
    return { response: nextResponse.json({ error: 'Agent operation is stale', code: 'stale_operation' }, { status: 409 }) };
  }
  if (body.recoveryTaskId && recentFailedTask?.runId && recentFailedTask.runId === runId) {
    return { response: nextResponse.json({ error: 'Agent runId has already been used', code: 'stale_operation' }, { status: 409 }) };
  }
  const requestedRecoveryTaskId = typeof body.recoveryTaskId === 'string' ? body.recoveryTaskId.trim().slice(0, 200) : '';
  if (requestedRecoveryTaskId && requestedRecoveryTaskId !== recentFailedTask?.taskId) {
    return { response: nextResponse.json({ error: 'Recovery task is unknown, resolved, or belongs to another Topic' }, { status: 400 }) };
  }
  if (body.confirmation?.confirmationId) {
    pruneConfirmationStore();
    const confirmationRecord = await continuationState.hydrateConfirmation({ sessionId, confirmationId: body.confirmation.confirmationId });
    if (!confirmationRecord || confirmationRecord.expiresAt <= Date.now()) {
      return { response: nextResponse.json({ error: 'Confirmation is stale', code: 'stale_operation' }, { status: 409 }) };
    }
    try {
      if (body.confirmation.taskId && confirmationRecord.taskId) assertSameAgentOperation(body.confirmation.taskId, confirmationRecord.taskId);
      if (body.confirmation.operationId && confirmationRecord.operationId) assertSameAgentOperation(body.confirmation.operationId, confirmationRecord.operationId);
      if (Number.isFinite(Number(body.confirmation.expectedSequence))) assertExpectedSequence(body.confirmation.expectedSequence, confirmationRecord.lastSequence);
    } catch (error) {
      return { response: nextResponse.json({ error: error instanceof Error ? error.message : 'Confirmation is stale', code: error?.code || 'stale_operation' }, { status: 409 }) };
    }
  }
  if (body.clarificationResponse && body.clarificationRequest && body.clarificationState) {
    try {
      if (body.clarificationRequest.operationId && body.clarificationState.operationId) assertSameAgentOperation(body.clarificationRequest.operationId, body.clarificationState.operationId);
      if (Number.isFinite(Number(body.clarificationRequest.lastSequence))) assertExpectedSequence(body.clarificationRequest.lastSequence, body.clarificationState.lastSequence || 0);
    } catch (error) {
      return { response: nextResponse.json({ error: error instanceof Error ? error.message : 'Clarification is stale', code: error?.code || 'stale_operation' }, { status: 409 }) };
    }
  }
  const contextLogger = createLogger('api.agent.context', { source: 'server', route: '/api/agent', requestId: runId, sessionId, clientRunId });
  const interactionService = createInteractionService({ loadSkillContent, logger: contextLogger });
  return { body, runtimeReferenceContext, clientRunId, runId, sessionId, latestUserMessage,
    preparedSnapshot, journalTurnId, recentFailedTask, initialAgentIdentity, requestedRecoveryTaskId,
    contextLogger, interactionService };
}

/** Normalize the persisted context snapshot before the turn stream consumes it. */
export function getAgentRequestPreparedBindings(snapshot = {}) {
  return {
    conversationIntent: snapshot.conversationIntent,
    contextEntities: snapshot.contextEntities,
    sessionVisualAssets: snapshot.sessionVisualAssets,
    contextEvents: snapshot.contextEvents,
    contextAuditEvents: snapshot.contextAuditEvents,
    contextModelEvents: snapshot.contextModelEvents,
    incomingHistoryRevision: snapshot.incomingHistoryRevision,
    incomingUserMessageRevision: snapshot.incomingUserMessageRevision,
    incomingActiveWindowRevision: snapshot.incomingActiveWindowRevision,
    requestHistoryRevision: snapshot.requestHistoryRevision,
    requestUserMessageRevision: snapshot.requestUserMessageRevision,
    requestActiveWindowRevision: snapshot.requestActiveWindowRevision,
    persistedCompactedWindows: snapshot.persistedCompactedWindows,
    preparedNextContextSequence: snapshot.nextContextSequence,
    replayContext: snapshot.replayContext,
    generatedImageHistory: snapshot.generatedImageHistory,
    knownContextEntityIds: snapshot.knownContextEntityIds,
    knownVisualReferenceIds: snapshot.knownVisualReferenceIds,
    recentFailedTask: snapshot.recentFailedTask,
    selectedContextEntityIds: snapshot.selectedContextEntityIds,
    initialBriefSource: snapshot.initialBriefSource,
    rawUserCountResolution: snapshot.rawUserCountResolution,
    briefCountResolution: snapshot.briefCountResolution,
    explicitBatchCountResolution: snapshot.explicitBatchCountResolution,
    rawUserDeliveryPlan: snapshot.rawUserDeliveryPlan,
    briefDeliveryPlan: snapshot.briefDeliveryPlan,
    initialDeliveryPlan: snapshot.initialDeliveryPlan,
    explicitBatchImageRequest: snapshot.explicitBatchImageRequest,
    shouldResolveInitialContext: snapshot.shouldResolveInitialContext,
    initialContextResolution: snapshot.initialContextResolution,
    initialWorkingContext: snapshot.initialWorkingContext,
    skillManifests: snapshot.skillManifests,
    skillCatalogLoaded: snapshot.skillCatalogLoaded,
    providers: snapshot.providers,
    providerImageOptionProfiles: snapshot.providerImageOptionProfiles,
    requestedInterfaceImageCount: snapshot.requestedInterfaceImageCount,
    requestedChatModel: snapshot.requestedChatModel,
    requestedChatProviderId: snapshot.requestedChatProviderId,
    requestedIntent: snapshot.requestedIntent,
    hasExplicitChatSelection: snapshot.hasExplicitChatSelection,
    resolvedChatSelection: snapshot.resolvedChatSelection,
    resolvedChatProvider: snapshot.resolvedChatProvider,
    resolvedChatModelMetadata: snapshot.resolvedChatModelMetadata,
  };
}
