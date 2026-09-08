const CANONICAL_TYPES = new Set([
  'thread.started',
  'turn.started',
  'item.started',
  'item.updated',
  'item.completed',
  'turn.completed',
  'turn.failed',
  'error',
]);

const text = (value) => typeof value === 'string' ? value : '';

function identity(event) {
  return {
    ...(event.threadId ? { threadId: event.threadId } : {}),
    ...(event.turnId ? { turnId: event.turnId } : {}),
    ...(event.taskId ? { taskId: event.taskId } : {}),
    ...(event.operationId ? { operationId: event.operationId } : {}),
    ...(event.runId ? { runId: event.runId } : {}),
    ...(Number.isSafeInteger(event.sequence) ? { sequence: event.sequence } : {}),
    ...(Number.isFinite(event.timestampMs) ? { timestampMs: event.timestampMs } : {}),
  };
}

function pageEvent(event, payload = {}) {
  return { ...payload, ...identity(event) };
}

/**
 * Convert the canonical wire contract to the page's existing progress events.
 * The page remains intentionally unaware of journal item envelopes.
 */
export function adaptCanonicalEvent(event) {
  if (!event || typeof event !== 'object') return null;
  if (!CANONICAL_TYPES.has(event.type) || !hasCanonicalIdentity(event)) return null;
  const item = event.item && typeof event.item === 'object' ? event.item : {};
  const type = event.type;

  if (type === 'thread.started') return null;
  if (type === 'turn.started') return pageEvent(event, { type: 'agent_start' });

  if (type === 'item.started' || type === 'item.updated' || type === 'item.completed') {
    const itemType = String(event.itemType || item.type || '');
    const status = type.slice(5);
    if (itemType === 'tool_call') {
      if (type === 'item.started') return pageEvent(event, { type: 'tool_start', toolCallId: event.toolCallId || item.toolCallId || event.itemId || '', toolName: text(item.toolName || event.toolName) });
      if (type === 'item.updated') return pageEvent(event, { type: 'tool_update', toolCallId: event.toolCallId || item.toolCallId || event.itemId || '', toolName: text(item.toolName || event.toolName), message: text(item.message || item.delta || item.detail) });
    }
    if (itemType === 'tool_result' || itemType === 'image_generation') {
      return pageEvent(event, {
        type: 'tool_result',
        toolCallId: event.toolCallId || item.toolCallId || event.itemId || '',
        toolName: text(item.toolName || event.toolName),
        result: item.result ?? item,
        isError: Boolean(item.isError || item.error),
      });
    }
    if (itemType === 'assistant_message' && typeof item.delta === 'string') {
      return pageEvent(event, { type: 'assistant_delta', delta: item.delta, channel: 'content' });
    }
    if (itemType === 'public_commentary' && typeof item.delta === 'string') {
      return pageEvent(event, { type: 'agent_activity_delta', activityId: event.itemId || `${event.runId}:commentary`, delta: item.delta });
    }
    if (itemType === 'confirmation' && type !== 'item.completed') {
      return pageEvent(event, { type: 'confirmation_required', request: item.request || item });
    }
    if (itemType === 'clarification' && type !== 'item.completed') {
      return pageEvent(event, { type: 'clarification_required', request: item.request || item, state: item.state, message: item.message || item.question });
    }
    if (itemType === 'public_event' && item.payload && typeof item.payload === 'object') {
      return pageEvent(event, item.payload);
    }
    if (itemType === 'command_result') {
      return pageEvent(event, { type: 'command_result', ...item });
    }
    if (itemType === 'todo_list') {
      const items = Array.isArray(item.items) ? item.items : [];
      const detail = items.map((todo) => `${todo?.status === 'completed' ? '[x]' : '[ ]'} ${text(todo?.content)}`).filter(Boolean).join('\n');
      return pageEvent(event, {
        type: 'progress_update',
        stepId: event.itemId || 'todo',
        itemId: event.itemId,
        phase: 'todo',
        status: status === 'completed' ? 'completed' : 'active',
        label: 'Todo',
        detail,
      });
    }
    return null;
  }

  if (type === 'turn.completed') return pageEvent(event, { type: 'agent_done', stopReason: event.stopReason || 'completed', usage: event.usage || null });
  if (type === 'turn.failed') {
    const status = event.status === 'cancelled' ? 'agent_cancelled' : 'agent_error';
    return pageEvent(event, { type: status, message: event.error?.message || event.message || 'Agent run failed', code: event.error?.code || event.code, retryable: event.error?.retryable });
  }
  if (type === 'error') return pageEvent(event, { type: 'error', message: event.message || event.error?.message || 'Agent error', code: event.code || event.error?.code });
  return null;
}

export function isCanonicalEvent(value) {
  return Boolean(value && typeof value.type === 'string' && CANONICAL_TYPES.has(value.type) && hasCanonicalIdentity(value));
}

function hasCanonicalIdentity(event) {
  return typeof event.taskId === 'string' && event.taskId.trim()
    && typeof event.operationId === 'string' && event.operationId.trim()
    && typeof event.runId === 'string' && event.runId.trim()
    && Number.isSafeInteger(event.sequence) && event.sequence >= 0;
}
