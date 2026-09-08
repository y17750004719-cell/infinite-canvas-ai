const LIFECYCLE = new Set(['thread.started', 'turn.started', 'item.started', 'item.updated', 'item.completed', 'turn.completed', 'turn.failed', 'error']);
import { reduceAgentRunProgress } from './run-progress.mjs';

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

export function completedTranscriptMessages(turns, transcriptStartSequence = 0, transcriptSummary = null) {
  const boundary = Number.isSafeInteger(transcriptStartSequence) ? Math.max(0, transcriptStartSequence) : 0;
  const summary = typeof transcriptSummary === 'string' && transcriptSummary.trim()
    ? [{ id: `journal:summary:${boundary}`, role: 'assistant', content: transcriptSummary.trim() }]
    : [];
  return [...summary, ...(turns || []).filter((turn) => Number(turn.startSequence || 0) >= boundary).flatMap((turn) => {
    const items = Array.isArray(turn.items) ? turn.items : [];
    const progressEvents = items
      .flatMap((item) => {
        if (item.type === 'public_event' && item.payload && typeof item.payload === 'object') return [{ ...item.payload, sequence: item.sequence || 0, runId: item.runId || turn.runId }];
        if (item.type === 'tool_call') return [{ type: 'tool_start', toolCallId: item.toolCallId || item.itemId, toolName: item.toolName, sequence: item.sequence || 0, runId: item.runId || turn.runId }];
        if (item.type === 'tool_result') return [{ type: 'tool_result', toolCallId: item.toolCallId || item.itemId, toolName: item.toolName, result: item.result || item.summary, isError: item.isError === true, sequence: item.sequence || 0, runId: item.runId || turn.runId }];
        return [];
      })
      .sort((left, right) => Number(left.sequence || 0) - Number(right.sequence || 0));
    let progress = null;
    for (const event of progressEvents) progress = reduceAgentRunProgress(progress, event);
    if (turn.status === 'failed') progress = reduceAgentRunProgress(progress, { type: 'agent_error', message: turn.error?.message || 'Agent run failed', runId: turn.runId, sequence: turn.completedSequence || turn.endSequence || 0, timestampMs: turn.completedAt || Date.now() });
    if (turn.status === 'completed') progress = reduceAgentRunProgress(progress, { type: 'agent_done', runId: turn.runId, sequence: turn.completedSequence || turn.endSequence || 0, timestampMs: turn.completedAt || Date.now() });
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
