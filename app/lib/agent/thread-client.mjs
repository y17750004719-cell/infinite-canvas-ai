const LIFECYCLE = new Set(['thread.started', 'turn.started', 'item.started', 'item.updated', 'item.completed', 'turn.completed', 'turn.failed', 'error']);
const TERMINAL_TURN_STATUSES = new Set(['completed', 'failed', 'cancelled', 'interrupted']);
const IDENTITY_KEYS = ['operationId', 'turnId', 'runId', 'taskId'];
import { reduceAgentRunProgress } from './run-progress.mjs';
import { adaptCanonicalEvent } from './canonical-event-adapter.mjs';

// Shared by refresh replay and live delivery. A cursor advances only for a
// validated event belonging to the current thread.
export function mergeThreadEvents(previous, incoming, threadId) {
  const bySequence = new Map();
  for (const event of [...(previous || []), ...(incoming || [])]) {
    if (!event || event.threadId !== threadId || !LIFECYCLE.has(event.type) || !Number.isSafeInteger(event.sequence) || event.sequence < 1) continue;
    if (!bySequence.has(event.sequence)) bySequence.set(event.sequence, event);
  }
  return [...bySequence.values()].sort((a, b) => a.sequence - b.sequence);
}

export function completedTranscriptMessages(turns, transcriptStartSequence = 0, transcriptSummary = null, options = {}) {
  const boundary = Number.isSafeInteger(transcriptStartSequence) ? Math.max(0, transcriptStartSequence) : 0;
  const summary = typeof transcriptSummary === 'string' && transcriptSummary.trim()
    ? [{ id: `journal:summary:${boundary}`, role: 'assistant', content: transcriptSummary.trim() }]
    : [];
  return [...summary, ...(turns || []).filter((turn) => Number(turn.startSequence || 0) >= boundary).flatMap((turn) => {
    const items = Array.isArray(turn.items) ? turn.items : [];
    const journalEvents = (options.events || []).filter(event => event.turnId === turn.turnId);
    const replayEvents = mergeThreadEvents([], journalEvents, options.threadId || turn.threadId || journalEvents[0]?.threadId);
    const progressEvents = replayEvents.length ? replayEvents.map(adaptCanonicalEvent).filter(Boolean) : items
      .flatMap((item) => {
        const metadata = { itemId: item.itemId, executionId: item.executionId, parentItemId: item.parentItemId,
          sequence: item.sequence || 0, runId: item.runId || turn.runId, timestampMs: item.timestampMs || turn.startedAt };
        if (item.type === 'public_event' && item.payload && typeof item.payload === 'object') return [{ ...item.payload, ...metadata }];
        const prefix = `${metadata.runId}:tool:`;
        const toolCallId = item.toolCallId || (item.itemId?.startsWith(prefix) ? item.itemId.slice(prefix.length) : item.itemId);
        if (item.type === 'tool_call') return [{ ...metadata, type: 'tool_start', toolCallId, toolName: item.toolName }];
        if (item.type === 'tool_result') return [{ ...metadata, type: 'tool_result', toolCallId, toolName: item.toolName, result: item.result || item.summary, isError: item.isError === true }];
        return [];
      })
      .sort((left, right) => Number(left.sequence || 0) - Number(right.sequence || 0));
    let progress = null;
    for (const event of progressEvents) progress = reduceAgentRunProgress(progress, event);
    if (!replayEvents.some(event => event.type === 'turn.failed' || event.type === 'turn.completed')) {
      const terminal = { runId: turn.runId, sequence: turn.completedSequence || turn.endSequence || 0, timestampMs: turn.completedAt || Date.now() };
      if (turn.status === 'failed' || turn.status === 'interrupted') progress = reduceAgentRunProgress(progress, { ...terminal, type: 'agent_error', message: turn.error?.message || 'Agent run failed' });
      if (turn.status === 'cancelled') progress = reduceAgentRunProgress(progress, { ...terminal, type: 'agent_cancelled' });
      if (turn.status === 'completed') progress = reduceAgentRunProgress(progress, { ...terminal, type: 'agent_done' });
    }
    const visible = items.flatMap((item) => {
    if (!['user_message', 'assistant_message', 'public_commentary', 'todo_list'].includes(item.type)) return [];
    const content = item.type === 'todo_list'
      ? (item.items || []).map((todo) => `${todo.status === 'completed' ? '[x]' : '[ ]'} ${todo.content}`).join('\n')
      : item.content || item.text || item.delta || '';
    return content ? [{ id: `journal:${turn.turnId}:${item.itemId}`, role: item.type === 'user_message' ? 'user' : 'assistant', content }] : [];
    });
    if (progress && progress.steps?.length) visible.push({ id: `journal:${turn.turnId}:progress`, role: 'assistant', content: '', agentRunProgress: progress });
    return visible;
  })];
}

function identityValue(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function turnIdentity(turn = {}) {
  return {
    operationId: identityValue(turn.operationId),
    turnId: identityValue(turn.turnId),
    runId: identityValue(turn.runId) || (Array.isArray(turn.runIds) ? identityValue(turn.runIds.at(-1)) : null),
    taskId: identityValue(turn.taskId),
  };
}

function messageIdentity(message = {}) {
  const progress = message.agentRunProgress && typeof message.agentRunProgress === 'object' ? message.agentRunProgress : {};
  const snapshot = message.taskSnapshot && typeof message.taskSnapshot === 'object' ? message.taskSnapshot : {};
  const recovery = message.agentRecovery && typeof message.agentRecovery === 'object' ? message.agentRecovery : {};
  const clarification = message.agentClarification?.request || {};
  const confirmation = message.agentConfirmation || {};
  return {
    operationId: identityValue(progress.operationId) || identityValue(snapshot.operationId) || identityValue(recovery.operationId) || identityValue(clarification.operationId) || identityValue(confirmation.operationId),
    turnId: identityValue(progress.turnId) || identityValue(snapshot.turnId) || identityValue(clarification.turnId) || identityValue(confirmation.turnId),
    runId: identityValue(progress.runId) || identityValue(snapshot.runId) || identityValue(recovery.runId),
    taskId: identityValue(progress.taskId) || identityValue(snapshot.taskId) || identityValue(recovery.taskId) || identityValue(clarification.taskId) || identityValue(confirmation.taskId) || identityValue(message.taskKey),
  };
}

function findTurnForMessage(message, turns) {
  const messageIds = messageIdentity(message);
  for (const key of IDENTITY_KEYS) {
    const value = messageIds[key];
    if (!value) continue;
    const match = turns.find((turn) => {
      const ids = turnIdentity(turn);
      if (key === 'runId' && Array.isArray(turn.runIds) && turn.runIds.some((runId) => identityValue(runId) === value)) return true;
      return ids[key] === value;
    });
    if (match) return match;
  }
  return null;
}

function terminalProgressEvent(turn, state = {}, message = {}) {
  const ids = turnIdentity(turn);
  const persistedSequence = Number(message.agentRunProgress?.lastSequence || 0);
  const sequence = Math.max(1, Number(
    turn.completedSequence
    || turn.endSequence
    || Math.max(Number(turn.startSequence || 0) + 1, Number(state.lastSequence || 0) + 1, persistedSequence + 1),
  ));
  const timestampMs = Number(turn.completedAt || turn.updatedAt || turn.startedAt || Date.now());
  const identity = {
    taskId: ids.taskId || ids.runId || ids.turnId || 'journal-task',
    operationId: ids.operationId || ids.runId || ids.turnId || 'journal-operation',
    runId: ids.runId || ids.turnId || 'journal-run',
    sequence,
    timestampMs: Number.isFinite(timestampMs) ? timestampMs : Date.now(),
  };
  if (turn.status === 'cancelled') return { ...identity, type: 'agent_cancelled' };
  if (turn.status === 'completed') return { ...identity, type: 'agent_done' };
  return {
    ...identity,
    type: 'agent_error',
    message: typeof turn.error?.message === 'string' ? turn.error.message : 'Agent run failed',
    code: typeof turn.error?.code === 'string' ? turn.error.code : undefined,
  };
}

function reconcileMessageWithTerminalTurn(message, turn, state) {
  if (!turn || !TERMINAL_TURN_STATUSES.has(turn.status)) return message;
  const event = terminalProgressEvent(turn, state, message);
  const existingProgress = message.agentRunProgress && typeof message.agentRunProgress === 'object'
    ? message.agentRunProgress
    : null;
  // Older persisted messages can carry the client-side run identity while the
  // journal only knows the server-generated identity. Rebase that identity
  // before reducing the authoritative terminal event so the reducer does not
  // reject it as a stale operation.
  const progressSeed = existingProgress
    ? {
        ...existingProgress,
        taskId: event.taskId,
        operationId: event.operationId,
        runId: event.runId,
      }
    : null;
  const progress = reduceAgentRunProgress(progressSeed, event);
  const taskStatus = turn.status === 'completed'
    ? 'completed'
    : turn.status === 'cancelled'
      ? 'cancelled'
      : 'failed';
  return {
    ...message,
    taskStatus,
    ...(progress ? { agentRunProgress: progress } : {}),
  };
}

function isRunningMessage(message) {
  return message?.taskStatus === 'running' || ['running', 'waiting'].includes(message?.agentRunProgress?.outcome);
}

/**
 * Merge journal-backed terminal state into locally persisted messages. This is
 * intentionally pure so refresh, session restore, and tests share one rule.
 */
export function reconcileHydratedChatMessages(messages, state = {}, options = {}) {
  const local = Array.isArray(messages) ? messages : [];
  const turns = Array.isArray(state.turns) ? state.turns : [];
  const journalMessages = completedTranscriptMessages(turns, state.transcriptStartSequence, state.transcriptSummary, options);
  if (local.length === 0) return journalMessages;

  const merged = [...local];
  const localIds = new Set(local.map((message) => message?.id).filter(Boolean));
  for (const journalMessage of journalMessages) {
    if (localIds.has(journalMessage.id)) continue;
    const journalTurn = turns.find((turn) => journalMessage.id === `journal:${turn.turnId}:progress`);
    const sameIdentity = journalTurn && merged.some((message) => findTurnForMessage(message, [journalTurn]));
    const sameContent = journalMessage.content && merged.some((message) => message.role === journalMessage.role && message.content === journalMessage.content);
    if (!sameIdentity && !sameContent) merged.push(journalMessage);
  }

  const terminalTurns = turns.filter((turn) => TERMINAL_TURN_STATUSES.has(turn.status));
  const lastRunningAssistantIndex = merged.reduce((last, message, index) => (
    message?.role === 'assistant' && isRunningMessage(message) ? index : last
  ), -1);
  return merged.map((message, index) => {
    let turn = findTurnForMessage(message, turns);
    // Legacy local messages may have lost their run identity. Only repair the
    // newest running assistant when the server has no active turn, avoiding a
    // broad guess across unrelated historical messages.
    if (!turn && index === lastRunningAssistantIndex && state.activeTurn == null && terminalTurns.length > 0) {
      turn = [...terminalTurns].sort((left, right) => Number(right.completedAt || 0) - Number(left.completedAt || 0))[0];
    }
    return reconcileMessageWithTerminalTurn(message, turn, state);
  });
}
