import { classifyAgentFailureCode } from './agent-recovery-service.mjs';
import { createAgentResponseLifecycle } from './agent-response-lifecycle.mjs';

/**
 * Request-level failure boundary. Classification, recovery construction and
 * canonical failure emission are injected so this flow stays transport and
 * storage agnostic.
 */
export async function handleAgentFailure({
  error,
  signal,
  executionKind = '',
  intent,
  bodyIntent,
  selectedSkill,
  imageOperation,
  recoveryBaseRecord,
  preserveRecoveryRecord = false,
  mainAgentFailureCheckpoint = false,
  classify = classifyAgentFailureCode,
  buildRecoveryRecord,
  log,
  settle,
  emit,
  context = {},
} = {}) {
  const aborted = Boolean(signal?.aborted);
  const failureCode = classify(error, executionKind);
  const stage = aborted
    ? 'cancelled'
    : failureCode === 'invalid_reference'
      ? 'image_reference_resolution'
      : (error && typeof error.failureStage === 'string' ? error.failureStage : null)
        || (context.analysisFailed ? 'analysis' : null)
        || (mainAgentFailureCheckpoint ? 'main_agent' : null)
        || executionKind
        || (intent === 'image' || bodyIntent === 'image' || selectedSkill?.executionMode === 'image_pipeline' || imageOperation ? 'image_pipeline' : 'chat');
  const message = aborted
    ? '运行已取消'
    : failureCode === 'invalid_reference'
      ? (error instanceof Error ? error.message : '图片引用已失效，请重新选择参考图')
      : (error instanceof Error ? error.message : 'Agent run failed');
  const recoveryRecord = preserveRecoveryRecord && recoveryBaseRecord
    ? recoveryBaseRecord
    : buildRecoveryRecord({ stage, message, status: aborted ? 'cancelled' : 'failed', ...(mainAgentFailureCheckpoint ? { resumeRoute: 'main_agent' } : {}) });
  const retryable = !aborted && error?.outcomeUnknown !== true && error?.retryable === true;
  const metadata = {
    ...Object.fromEntries(['toolName', 'toolCallId', 'fieldPath'].filter((key) => typeof error?.[key] === 'string').map((key) => [key, error[key].slice(0, 200)])),
    ...(typeof error?.providerRequestStarted === 'boolean' ? { providerRequestStarted: error.providerRequestStarted } : {}),
  };
  await log({ failureCode, stage, message, retryable, aborted, ...metadata, ...context });
  settle('failed', aborted ? '运行已取消' : '运行失败');
  emit({ type: aborted ? 'agent_cancelled' : 'agent_error', ...(!aborted ? { code: classify(error, stage) } : {}), stage, message, failureStage: stage, failureCode, retryable, outcomeUnknown: error?.outcomeUnknown === true, ...metadata, recoveryRecord });
  return { aborted, failureCode, failureStage: stage, failureMessage: message, recoveryRecord, retryable };
}

/**
 * Owns the request stream's failure/finalization boundary.  Keeping the
 * callbacks explicit preserves the runtime's state ownership while removing
 * transport and recovery control flow from the request orchestrator.
 */
export async function runAgentRequestFailureBoundary({ error, scope } = {}) {
  const {
    clarificationSubmissionKey,
    continuationState,
    handleFailure = handleAgentFailure,
    runSignal,
    executionKind = '',
    intent,
    bodyIntent,
    selectedSkill,
    imageOperation,
    recoveryBaseRecord,
    preserveRecoveryRecordOnFailure,
    mainAgentFailureCheckpoint,
    buildRecoveryRecord,
    contextLogger,
    runId,
    taskId,
    directGenerateImageCallId,
    resolvedChatSelection,
    agentAnalysis,
    progressTracker,
    writeLifecycleEvent,
    flush,
    settleActiveRun,
    closeStream,
    eventSinks,
    controller,
  } = scope || {};
  const streamFlush = flush || (() => eventSinks?.get(controller)?.flush());
  const streamClose = closeStream || (() => {
    try { controller?.close(); } catch { /* Client disconnected; task has still settled. */ }
  });
  if (error !== undefined && clarificationSubmissionKey) {
    continuationState?.deleteClarificationSubmission(clarificationSubmissionKey);
  }
  if (error !== undefined) await handleFailure({
    error,
    signal: runSignal,
    executionKind,
    intent,
    bodyIntent,
    selectedSkill,
    imageOperation,
    recoveryBaseRecord,
    preserveRecoveryRecord: preserveRecoveryRecordOnFailure,
    mainAgentFailureCheckpoint: Boolean(mainAgentFailureCheckpoint),
    buildRecoveryRecord,
    log: (failure) => contextLogger.error('agent.failure', 'Agent run terminated', {
      runId,
      taskId,
      attemptId: runId,
      toolCallId: directGenerateImageCallId || error?.toolCallId || null,
      providerId: resolvedChatSelection.providerId,
      model: resolvedChatSelection.model,
      ...failure,
    }),
    settle: (_status, message) => progressTracker.settleActive('failed', message),
    emit: (event) => writeLifecycleEvent({
      ...event,
      providerId: resolvedChatSelection.providerId,
      model: resolvedChatSelection.model,
      ...progressTracker.stamp(),
    }),
    context: { analysisFailed: agentAnalysis?.status === 'failed' },
  });
  return createAgentResponseLifecycle({
    flush: streamFlush,
    settle: settleActiveRun,
    close: streamClose,
  }).finalize();
}

/** Resolve a request-owned state snapshot before entering the boundary. */
export async function runAgentRequestFailureBoundaryFromState({ error, state } = {}) {
  const scope = typeof state === 'function' ? await state() : state;
  return runAgentRequestFailureBoundary({ error, scope });
}
