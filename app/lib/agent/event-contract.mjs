const MAX_ID_LENGTH = 200;

const text = (value) => typeof value === 'string' ? value.trim() : '';

export const AGENT_LIFECYCLE_EVENT_TYPES = new Set([
  'agent_start', 'progress_update', 'tool_start', 'tool_update', 'tool_result',
  'assistant_delta', 'agent_activity_delta', 'agent_activity_commit',
  'confirmation_required', 'clarification_required', 'agent_task_checkpoint',
  'agent_completion_summary', 'agent_done', 'agent_error', 'agent_cancelled',
]);

export function isAgentLifecycleEvent(value) {
  return Boolean(value && typeof value.type === 'string' && AGENT_LIFECYCLE_EVENT_TYPES.has(value.type));
}

export function normalizeAgentId(value, field = 'id') {
  const normalized = text(value);
  if (!normalized) throw new Error(`${field} is required`);
  if (normalized.length > MAX_ID_LENGTH) throw new Error(`${field} exceeds ${MAX_ID_LENGTH} characters`);
  return normalized;
}

export function normalizeOptionalAgentId(value) {
  const normalized = text(value);
  if (!normalized) return null;
  return normalized.length <= MAX_ID_LENGTH ? normalized : null;
}

export function normalizeSequence(value, fallback = 0) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return Math.max(0, Math.floor(Number(fallback) || 0));
  return Math.min(Number.MAX_SAFE_INTEGER, Math.floor(parsed));
}

export function resolveAgentIdentity({
  runId,
  taskId,
  operationId,
  continuation,
  lastSequence,
} = {}) {
  const continuationRecord = continuation && typeof continuation === 'object' ? continuation : {};
  const resolvedRunId = normalizeAgentId(runId, 'runId');
  const resolvedTaskId = normalizeAgentId(
    continuationRecord.taskId || taskId || resolvedRunId,
    'taskId',
  );
  const resolvedOperationId = normalizeAgentId(
    continuationRecord.operationId || operationId || resolvedRunId,
    'operationId',
  );
  return {
    taskId: resolvedTaskId,
    operationId: resolvedOperationId,
    runId: resolvedRunId,
    lastSequence: normalizeSequence(
      continuationRecord.lastSequence ?? lastSequence,
      0,
    ),
  };
}

export function normalizeAgentEventIdentity(event) {
  const input = event && typeof event === 'object' ? event : {};
  for (const field of ['taskId', 'operationId', 'runId']) {
    if (typeof input[field] === 'string' && input[field].trim().length > MAX_ID_LENGTH) return null;
  }
  const runId = normalizeOptionalAgentId(input.runId);
  const rawTaskId = normalizeOptionalAgentId(input.taskId);
  const rawOperationId = normalizeOptionalAgentId(input.operationId);
  const taskId = rawTaskId;
  const operationId = rawOperationId;
  const rawSequence = input.sequence;
  const hasSequence = Number.isFinite(Number(rawSequence)) && Number(rawSequence) >= 0;
  if (!runId || !taskId || !operationId || !hasSequence) return null;
  return {
    taskId,
    operationId,
    runId,
    sequence: normalizeSequence(rawSequence),
    ...(Number.isFinite(Number(input.timestampMs)) ? { timestampMs: Number(input.timestampMs) } : {}),
  };
}

export function classifyAgentEvent(event, {
  taskId = '',
  operationId = '',
  lastSequence = 0,
} = {}) {
  const identity = normalizeAgentEventIdentity(event);
  if (!identity) return { accepted: false, reason: 'invalid_identity', identity: null };
  if (taskId && identity.taskId !== taskId && event?.type !== 'agent_start') {
    return { accepted: false, reason: 'stale_task', identity };
  }
  if (operationId && identity.operationId !== operationId && event?.type !== 'agent_start') {
    return { accepted: false, reason: 'stale_operation', identity };
  }
  const sameActivityStamp = (
    (event?.type === 'agent_activity_delta' || event?.type === 'agent_activity_commit')
    && identity.sequence === Number(lastSequence)
  );
  if (!sameActivityStamp && classifyAgentSequence(identity.sequence, lastSequence) === 'stale' && event?.type !== 'agent_start') {
    return { accepted: false, reason: 'stale_sequence', identity };
  }
  return { accepted: true, reason: 'accepted', identity };
}

export function classifyAgentSequence(sequence, lastSequence) {
  const next = normalizeSequence(sequence);
  const current = normalizeSequence(lastSequence);
  if (next <= current) return 'stale';
  return 'accepted';
}

export function assertSameAgentOperation(expectedOperationId, actualOperationId) {
  const expected = normalizeAgentId(expectedOperationId, 'operationId');
  const actual = normalizeAgentId(actualOperationId, 'operationId');
  if (expected !== actual) {
    const error = new Error('Agent operation is stale');
    error.code = 'stale_operation';
    error.statusCode = 409;
    throw error;
  }
  return true;
}

export function assertExpectedSequence(expectedSequence, actualSequence) {
  const expected = normalizeSequence(expectedSequence);
  const actual = normalizeSequence(actualSequence);
  if (expected !== actual) {
    const error = new Error('Agent interaction is stale');
    error.code = 'stale_sequence';
    error.statusCode = 409;
    throw error;
  }
  return true;
}
