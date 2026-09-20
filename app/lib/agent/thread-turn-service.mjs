import { loadThread } from './thread-journal.mjs';

export async function loadTurnState(threadId) { return loadThread(threadId); }
export function resolveContinuationTurn({ state, operationId } = {}) {
  const turns = Array.isArray(state?.turns) ? state.turns : [];
  const prior = turns.find((turn) => turn && turn.operationId === operationId);
  if (!prior || ['completed', 'running'].includes(prior.status)
    || (state?.activeTurn && state.activeTurn !== prior.turnId)) {
    throw Object.assign(new Error('Continuation is stale'), { statusCode: 409, code: 'stale_operation' });
  }
  return prior.turnId;
}
