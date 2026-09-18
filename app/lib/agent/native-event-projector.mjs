const publicKeys = [
  'type', 'content', 'delta', 'channel', 'model', 'error', 'message', 'stage', 'reason',
  'retryable', 'code', 'intent', 'summary', 'memory', 'label', 'index', 'prompt', 'skillId',
  'skill', 'source', 'stepId', 'phase', 'status', 'toolCallId', 'toolName', 'isError',
  'activityId', 'disposition', 'event', 'action', 'request', 'state', 'result', 'proposal',
  'entityIds', 'labels', 'kind', 'confidence', 'resolvedEntityIds', 'mustPreserveCount',
  'taskSnapshot', 'recoveryRecord', 'parameters', 'title', 'operation', 'succeeded', 'failed',
  'addedToCanvas', 'stopReason', 'detail', 'completionSummary', 'completedLabel',
];

export function projectNativeEvent(event = {}, context = {}) {
  const type = String(event.type || '');
  // Canonical events may be emitted by the runtime and must never be wrapped
  // as public_event; doing so would make journal replay differ from live SSE.
  if (/^(thread|turn|item)\.(started|updated|completed|failed)$/.test(type)) {
    return [{ ...event, ...Object.fromEntries(Object.entries(context).filter(([key]) => event[key] === undefined && ['threadId', 'turnId', 'taskId', 'operationId', 'runId'].includes(key))) }];
  }
  if (event.channel === 'reasoning') return [];
  const base = {
    threadId: context.threadId,
    turnId: event.turnId || context.turnId,
    taskId: event.taskId || context.taskId,
    operationId: event.operationId || context.operationId,
    runId: event.runId || context.runId,
    timestampMs: Number(event.timestampMs) || Date.now(),
    ...(event.itemId ? { itemId: event.itemId } : {}),
    ...(event.toolCallId ? { toolCallId: event.toolCallId } : {}),
    ...(event.executionId ? { executionId: event.executionId } : {}),
    ...(event.parentItemId ? { parentItemId: event.parentItemId } : {}),
    ...(event.nativeThreadId ? { nativeThreadId: event.nativeThreadId } : {}),
    ...(event.nativeTurnId ? { nativeTurnId: event.nativeTurnId } : {}),
    ...(event.nativeItemId ? { nativeItemId: event.nativeItemId } : {}),
    ...(event.modelSampleIndex !== undefined ? { modelSampleIndex: event.modelSampleIndex } : {}),
  };
  if (type === 'agent_start') return [{ type: 'thread.started', ...base }, { type: 'turn.started', ...base }];
  if (type === 'tool_start') return [{ type: 'item.started', itemType: 'tool_call', item: { toolName: event.toolName }, ...base }];
  if (type === 'tool_update') return [{ type: 'item.updated', itemType: 'tool_call', item: { message: event.message, toolName: event.toolName }, ...base }];
  if (type === 'tool_result') return [{ type: 'item.completed', itemType: 'tool_result', item: { toolName: event.toolName, result: event.result, error: event.error, isError: event.isError === true }, ...base }];
  if (type === 'assistant_delta' || type === 'agent_activity_delta') return [{ type: 'item.updated', itemType: type === 'agent_activity_delta' ? 'public_commentary' : 'assistant_message', itemId: event.itemId || event.activityId || `${context.runId}:assistant`, item: { delta: event.delta || event.content || '' }, ...base }];
  if (type === 'agent_done') return [{ type: 'turn.completed', usage: event.usage || null, stopReason: event.stopReason || null, ...base }];
  if (type === 'agent_error' || type === 'agent_cancelled' || type === 'error') {
    const failureCode = event.failureCode || event.error?.failureCode || event.code || event.error?.code || null;
    const failureStage = event.failureStage || event.stage || event.error?.failureStage || null;
    const retryable = event.retryable ?? event.error?.retryable;
    const outcomeUnknown = event.outcomeUnknown ?? event.error?.outcomeUnknown;
    const message = event.message || event.error?.message || 'Agent run failed';
    return [{
      type: 'turn.failed',
      status: type === 'agent_cancelled' ? 'cancelled' : 'failed',
      failureCode,
      failureStage,
      ...(retryable !== undefined ? { retryable: retryable === true } : {}),
      ...(outcomeUnknown !== undefined ? { outcomeUnknown: outcomeUnknown === true } : {}),
      error: { message, code: event.code || event.error?.code || failureCode, failureStage, failureCode, retryable: retryable === true, outcomeUnknown: outcomeUnknown === true },
      ...base,
    }];
  }
  if (type === 'confirmation_required' || type === 'clarification_required') return [{ type: 'item.started', itemType: type === 'confirmation_required' ? 'confirmation' : 'clarification', item: { ...(event.request && typeof event.request === 'object' ? { request: event.request } : {}), ...(event.state && typeof event.state === 'object' ? { state: event.state } : {}), ...(event.message ? { message: event.message } : {}) }, ...base }];
  if (type.startsWith('thread/') || type.startsWith('turn/') || type.startsWith('item/') || type.startsWith('tool/')) {
    return [{ type: 'item.updated', itemType: type.startsWith('tool/') ? 'tool_event' : 'public_event', itemId: event.itemId || event.eventId || `${context.runId}:event:${type}`, item: { eventType: type, payload: Object.fromEntries(Object.entries(event).filter(([key]) => key !== 'type')) }, ...base }];
  }
  const payload = Object.fromEntries(publicKeys.filter((key) => Object.prototype.hasOwnProperty.call(event, key)).map((key) => [key, event[key]]));
  const itemId = event.itemId || (event.event && typeof event.event === 'object' && typeof event.event.eventId === 'string' ? event.event.eventId : '') || `${context.runId}:public:${type}:${event.sequence || event.timestampMs || Date.now()}`;
  return [{ type: 'item.updated', itemType: 'public_event', itemId, item: { eventType: type, payload }, ...base }];
}
