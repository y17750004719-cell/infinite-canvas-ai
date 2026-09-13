import { createAgentRecoveryRecord } from './recovery.mjs';
import { appendThreadEvent } from './thread-journal.mjs';

export function isRetryablePlannerProviderError(error = {}) {
  const candidate = error && typeof error === 'object' ? error : {};
  const statusCode = Number(candidate.statusCode);
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  const causeCode = typeof candidate.cause?.code === 'string' ? candidate.cause.code.toUpperCase() : '';
  return statusCode === 524
    || causeCode === 'EPIPE'
    || message.includes('write epipe')
    || message === 'fetch failed';
}

export function classifyAgentFailureCode(error, stage = '') {
  const value = error && typeof error === 'object' ? error : {};
  const explicit = typeof value.code === 'string' ? value.code : '';
  const failureCode = typeof value.failureCode === 'string' ? value.failureCode : '';
  if (/^[a-z][a-z0-9_]{1,100}$/.test(explicit)) return explicit;
  if (['provider_unavailable', 'provider_http', 'provider_timeout', 'transport', 'invalid_tool_arguments', 'decision_commentary_missing', 'empty_model_response'].includes(failureCode)) return failureCode;
  const message = error instanceof Error ? error.message.toLowerCase() : String(error || '').toLowerCase();
  if (message.includes('图片引用已失效') || message.includes('未知图片引用') || message.includes('unknown reference')) return 'invalid_reference';
  if (message.includes('no enabled channel for model') || message.includes('no available compatible accounts')) return 'provider_unavailable';
  if (message.includes('closing turn') || message.includes('terminal control') || String(stage) === 'terminal_contract') return 'terminal_contract';
  if (message.includes('budget exceeded') || message.includes('预算')) return 'budget_exceeded';
  if (message.includes('forbidden') || message.includes('unauthorized') || message.includes('upstream access')) return 'provider_http';
  if (message.includes('timeout') || message.includes('timed out') || message.includes('524')) return 'provider_timeout';
  if (message.includes('fetch failed') || message.includes('epipe') || message.includes('econnreset') || message.includes('connection')) return 'transport';
  if (message.includes('invalid') || message.includes('requires') || message.includes('must be')) return 'invalid_tool_arguments';
  if (isRetryablePlannerProviderError(error)) return message.includes('timeout') || message.includes('524') ? 'provider_timeout' : 'transport';
  if (Number(value.statusCode) >= 400) return Number(value.statusCode) >= 500 ? 'provider_http' : 'invalid_tool_arguments';
  return undefined;
}

export function classifyAgentFailure(error = {}, context = {}) {
  const code = String(error.code || 'native_unknown_outcome');
  const streamDisconnect = /stream disconnected|upstream error/i.test(String(error.message || ''));
  return { ...context, code: streamDisconnect ? 'provider_stream_disconnect' : code, failureStage: error.failureStage || 'native_runtime', retryable: error.retryable === true || streamDisconnect, outcomeUnknown: error.outcomeUnknown === true };
}
export function shouldRetryTurn({ error, sideEffectStarted = false, attempt = 0 } = {}) {
  if (sideEffectStarted || attempt >= 1) return false;
  const classified = classifyAgentFailure(error);
  return classified.retryable && !classified.outcomeUnknown;
}

/**
 * Run a Native turn once more only for a pre-tool stream disconnect. The
 * caller supplies host invalidation so the second attempt cannot reuse the
 * connection that produced the disconnect. Unknown outcomes and any tool
 * side effect are terminal by design.
 */
export async function recoverNativeStreamDisconnect({ run, invalidate, error, sideEffectStarted = false, attempt = 0 } = {}) {
  const classified = classifyAgentFailure(error);
  if (!shouldRetryTurn({ error: classified, sideEffectStarted, attempt })) {
    return { recovered: false, result: error, failure: classified };
  }
  await invalidate?.();
  const result = await run();
  const resultFailure = result?.status === 'failed'
    ? classifyAgentFailure({
      code: result.failureCode || result.error?.code,
      message: result.errorMessage || result.error?.message,
      retryable: result.retryable ?? result.error?.retryable,
      outcomeUnknown: result.outcomeUnknown ?? result.error?.outcomeUnknown,
    })
    : null;
  return { recovered: true, result, failure: resultFailure };
}
export async function reconcileImageSideEffect({ completed = false, outcomeUnknown = false } = {}) {
  return { status: completed ? 'completed' : outcomeUnknown ? 'unknown' : 'not_started', retryable: !completed && !outcomeUnknown };
}

export function sideEffectKey({ threadId, turnId, toolCallId, operationId } = {}) {
  return [threadId, turnId, operationId, toolCallId].filter(Boolean).join(':');
}

export async function persistRecoveryRecord({ threadId, identity = {}, record, journal = { appendThreadEvent }, idempotency = new Set() } = {}) {
  if (!threadId || !record) throw new TypeError('threadId and recovery record are required');
  const key = `recovery:${threadId}:${identity.operationId || record.operationId || ''}`;
  if (idempotency.has(key)) return { persisted: false, record };
  const event = await journal.appendThreadEvent(threadId, { type: 'turn.failed', ...identity, status: 'failed', recovery: record, error: record.failure || record.error || { code: 'agent_failed' } });
  idempotency.add(key);
  return { persisted: true, record, event };
}

export function createRecoveryRecord(input = {}) {
  const { taskId, runId, operationId, failure, context = {} } = input;
  // The runtime's durable recovery contract contains more than the compact
  // diagnostic record used by the gateway. Preserve the existing factory
  // semantics here so the controller does not reach into recovery internals.
  if (Object.prototype.hasOwnProperty.call(input, 'failureStage') || Object.prototype.hasOwnProperty.call(input, 'sourceUserMessageId')) {
    return createAgentRecoveryRecord(input);
  }
  if (failure && !Object.prototype.hasOwnProperty.call(failure, 'message') && Object.prototype.hasOwnProperty.call(failure, 'failureMessage')) {
    return createAgentRecoveryRecord({ taskId, runId, operationId, ...failure });
  }
  return {
    taskId: taskId || null,
    runId: runId || null,
    operationId: operationId || null,
    status: 'failed',
    failure: {
      code: failure?.code || failure?.failureCode || 'agent_failed',
      stage: failure?.failureStage || failure?.stage || 'agent',
      message: failure?.message || 'Agent run failed',
      retryable: failure?.retryable === true,
      outcomeUnknown: failure?.outcomeUnknown === true,
      providerId: context.providerId || failure?.providerId || null,
      model: context.model || failure?.model || null,
      protocol: context.protocol || failure?.protocol || null,
    },
  };
}

/**
 * Build the durable recovery record for a completed agent execution.  The
 * request controller owns the live execution state, but recovery record
 * shape and fallback semantics belong to this service boundary.
 */
export function createExecutionRecoveryRecord(input = {}) {
  const {
    stage,
    message,
    reason,
    retryable,
    status = 'failed',
    resumeRoute,
    taskId,
    runId,
    operationId,
    lastSequence,
    sessionId,
    sourceUserMessageId,
    latestUserMessage,
    recoveryBaseRecord,
    activeClarificationState,
    intent,
    selectedSkill,
    skillContentHash,
    imageOperation,
    runReferenceContext,
    targetReferenceId,
    selectedContextEntityIds = [],
    taskSnapshot,
    recoveryMode,
    mainAgentFailureCheckpoint,
    toolCallRecords = [],
    completedTaskIdentities = [],
  } = input;
  const previousSnapshot = recoveryBaseRecord?.taskSnapshot;
  const recoverySnapshot = !taskSnapshot?.activeVersions?.length && previousSnapshot
    ? previousSnapshot
    : recoveryMode === 'fill_missing' && previousSnapshot && taskSnapshot
      ? {
          ...taskSnapshot,
          activeVersions: Array.from(new Map([
            ...previousSnapshot.activeVersions,
            ...taskSnapshot.activeVersions,
          ].map((version) => [version.slotId || version.versionId, version])).values()),
        }
      : taskSnapshot || previousSnapshot;
  const rootTaskId = taskId || recoveryBaseRecord?.taskId || null;
  const rootSourceUserMessageId = recoveryBaseRecord?.sourceUserMessageId
    || activeClarificationState?.sourceUserMessageId
    || sourceUserMessageId;
  const rootOriginalRequest = recoveryBaseRecord?.originalRequest
    || activeClarificationState?.originalRequest
    || latestUserMessage;
  return createRecoveryRecord({
    taskId: rootTaskId,
    runId,
    operationId,
    lastSequence,
    sessionId,
    sourceUserMessageId: rootSourceUserMessageId,
    status,
    resumeRoute: resumeRoute === undefined
      ? stage === 'local_delivery'
        ? 'local_delivery'
        : intent === 'image' || intent === 'skill_action'
          ? 'main_agent'
          : recoveryBaseRecord?.resumeRoute || 'main_agent'
      : resumeRoute,
    intent: intent || recoveryBaseRecord?.intent,
    originalRequest: rootOriginalRequest,
    failureStage: stage,
    failureReason: reason,
    failureMessage: message,
    retryability: retryable === true ? 'retryable' : retryable === false ? 'requires_change' : undefined,
    skillId: selectedSkill?.id || recoveryBaseRecord?.skillId || null,
    skillContentHash: skillContentHash || recoveryBaseRecord?.skillContentHash || null,
    imageOperation: imageOperation || undefined,
    assetId: runReferenceContext?.references?.find((reference) => reference.id === (targetReferenceId || ''))?.assetId
      || recoveryBaseRecord?.assetId
      || undefined,
    targetReferenceId: targetReferenceId || undefined,
    contextEntityIds: selectedContextEntityIds.length > 0
      ? selectedContextEntityIds
      : recoveryBaseRecord?.contextEntityIds || [],
    visualReferenceIds: runReferenceContext?.references?.length
      ? runReferenceContext.references.map((reference) => reference.id)
      : recoveryBaseRecord?.visualReferenceIds || [],
    referenceContext: runReferenceContext || recoveryBaseRecord?.referenceContext,
    visualSummary: recoveryBaseRecord?.visualSummary,
    taskSnapshot: recoverySnapshot,
    mainAgentLoop: mainAgentFailureCheckpoint,
    toolCalls: toolCallRecords,
    completedAssetCount: Math.max(
      recoverySnapshot?.activeVersions?.length || completedTaskIdentities.length,
      recoveryBaseRecord?.completedAssetCount || 0,
    ),
  });
}
