import { createAgentRecoveryRecord } from './recovery.mjs';

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
  if (/^[a-z][a-z0-9_]{1,100}$/.test(explicit)) {
    if (explicit === 'native_capability_disabled' || explicit === 'code_mode_host_disabled') return 'native_tool_host_disabled';
    if (explicit === 'native_turn_timeout' || explicit === 'request_timeout') return 'provider_timeout';
    if (explicit === 'native_model_not_validated' || explicit === 'model_not_validated') return 'native_model_not_validated';
    if (explicit === 'native_provider_unavailable') return 'provider_unavailable';
    return explicit;
  }
  if (['provider_unavailable', 'provider_http', 'provider_timeout', 'transport', 'invalid_tool_arguments', 'decision_commentary_missing', 'empty_model_response', 'native_tool_host_disabled', 'provider_overloaded', 'native_stream_disconnected', 'provider_permission_denied', 'provider_schema_invalid'].includes(failureCode)) return failureCode;
  const message = error instanceof Error ? error.message.toLowerCase() : String(error || '').toLowerCase();
  if (message.includes('code-mode host is disabled') || message.includes('code mode host is disabled')
    || message.includes('code_mode_host_disabled') || message.includes('native capability disabled')) {
    return 'native_tool_host_disabled';
  }
  if (message.includes('servers are currently overloaded') || message.includes('server is overloaded')
    || message.includes('upstream overloaded') || message.includes('service overloaded')) {
    return 'provider_overloaded';
  }
  if (message.includes('stream disconnected') || message.includes('stream disconnect')) {
    // Native's bare disconnect is a lifecycle failure. Older provider adapters
    // append an upstream/socket detail; retain their established wire code.
    return message.includes('upstream error') || message.includes('socket')
      ? 'provider_stream_disconnect'
      : 'native_stream_disconnected';
  }
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
  const message = String(error.message || error.errorMessage || '').toLowerCase();
  const streamDisconnect = /stream disconnected|upstream error|econnreset|socket (?:closed|hang up)|connection (?:closed|reset)/i.test(message);
  const normalizedByMessage = classifyAgentFailureCode(error, error.failureStage || context.failureStage || '');
  const nonRetryable = new Set([
    'native_model_not_validated', 'provider_unavailable', 'provider_permission_denied',
    'provider_schema_invalid', 'invalid_tool_arguments', 'decision_commentary_missing',
    'native_tool_host_disabled',
  ]);
  // Keep the legacy aggregate code for callers that use this classifier to
  // decide retry policy; the detailed classifier exposes native_stream_disconnected.
  const normalizedCode = normalizedByMessage === 'native_stream_disconnected'
    ? 'provider_stream_disconnect'
    : normalizedByMessage || (streamDisconnect ? 'provider_stream_disconnect' : code);
  return {
    ...context,
    code: normalizedCode,
    failureStage: error.failureStage || 'native_runtime',
    retryable: !nonRetryable.has(normalizedCode) && (error.retryable === true || streamDisconnect),
    outcomeUnknown: error.outcomeUnknown === true,
  };
}

export const NATIVE_REQUEST_MAX_RETRIES = 4;
export const NATIVE_STREAM_MAX_RETRIES = 5;

const NATIVE_RETRY_BLOCKED_CODES = new Set([
  'cancelled',
  'skill_lock_failed',
  'native_model_not_validated',
  'provider_unavailable',
  'provider_permission_denied',
  'provider_schema_invalid',
  'invalid_reference',
  'invalid_tool_arguments',
  'decision_commentary_missing',
  'native_tool_host_disabled',
  'native_session_busy',
]);

/**
 * Decide whether one application-level Native retry is safe. Request and
 * stream retry budgets intentionally match Codex Main's observable defaults,
 * while the application adds a stricter business-side-effect gate.
 */
export function resolveNativeRetryDecision({
  error,
  state = {},
  requestRetries = 0,
  streamRetries = 0,
  requestMaxRetries = NATIVE_REQUEST_MAX_RETRIES,
  streamMaxRetries = NATIVE_STREAM_MAX_RETRIES,
} = {}) {
  const classified = classifyAgentFailure(error);
  const code = String(classified.code || 'native_unknown_outcome');
  const assetCount = Number(state.assetCount || 0);
  const blockedByState = state.cancelled === true
    || state.outcomeUnknown === true
    || classified.outcomeUnknown === true
    || state.providerRequestStarted === true
    || state.sideEffectStarted === true
    || assetCount > 0
    || state.confirmationPending === true;
  if (blockedByState) return { retry: false, reason: 'business_state_unsafe', code, classified };
  if (NATIVE_RETRY_BLOCKED_CODES.has(code)) return { retry: false, reason: 'failure_not_retryable', code, classified };

  const retryable = classified.retryable === true || code === 'provider_overloaded';
  if (!retryable) return { retry: false, reason: 'failure_not_retryable', code, classified };

  const lane = state.responseStarted === true ? 'stream' : 'request';
  const retries = lane === 'stream' ? streamRetries : requestRetries;
  const maxRetries = lane === 'stream' ? streamMaxRetries : requestMaxRetries;
  if (retries >= maxRetries) return { retry: false, reason: 'budget_exhausted', lane, retries, maxRetries, code, classified };
  return { retry: true, reason: 'retryable_transport_failure', lane, retries, maxRetries, code, classified };
}

export function nativeRetryDelayMs(retryNumber) {
  const normalized = Math.max(1, Number(retryNumber) || 1);
  return Math.min(2_000, 200 * (2 ** (normalized - 1)));
}

export function createNativeRequestExhaustedError(error, decision = {}) {
  return Object.assign(new Error('主模型请求在生图工具调用前断开，图片供应商尚未收到请求，可安全重试。'), {
    code: 'native_request_exhausted',
    failureCode: 'native_request_exhausted',
    failureStage: 'native_request',
    retryable: true,
    outcomeUnknown: false,
    retryLane: decision.lane || 'request',
    retries: decision.retries,
    maxRetries: decision.maxRetries,
    cause: error,
  });
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
