import { appendThreadEvent, loadThread, updateThreadState } from './thread-journal.mjs';
import { fingerprintProviderModel } from './confirmation-continuation.mjs';

export async function loadTurnState(threadId) { return loadThread(threadId); }
export function validateThreadRequest({ state, contractVersion, requiredContractVersion, continuation = false } = {}) {
  if (contractVersion != null && requiredContractVersion != null && String(contractVersion) !== String(requiredContractVersion)) {
    return { ok: false, code: 'migration_required', statusCode: 409, sourceType: 'session', sourceVersion: String(contractVersion), requiredVersion: String(requiredContractVersion) };
  }
  if (!state) return { ok: false, code: 'thread_unavailable', statusCode: 500 };
  if (state.archived) return { ok: false, code: 'thread_archived', statusCode: 409 };
  if (state.activeTurn && !continuation) return { ok: false, code: 'turn_active', statusCode: 409, activeTurn: state.activeTurn };
  return { ok: true };
}
export function resolveContinuationTurn({ state, operationId } = {}) {
  const turns = Array.isArray(state?.turns) ? state.turns : [];
  const prior = turns.find((turn) => turn && turn.operationId === operationId);
  if (!prior || ['completed', 'running'].includes(prior.status)
    || (state?.activeTurn && state.activeTurn !== prior.turnId)) {
    throw Object.assign(new Error('Continuation is stale'), { statusCode: 409, code: 'stale_operation' });
  }
  return prior.turnId;
}
export async function createOrResumeThread({ threadId, state, providerFingerprint, nativeThreadId }) {
  if (!threadId) throw new Error('thread_id_required');
  const loaded = state || await loadThread(threadId);
  const currentState = loaded?.state || loaded;
  const previous = currentState?.nativeRuntime || currentState?.nativeCodex;
  const reuse = previous?.providerFingerprint === providerFingerprint;
  return { threadId, state: currentState, nativeThreadId: reuse ? (previous.nativeThreadId || previous.threadId) : nativeThreadId, reused: reuse };
}
export function providerFingerprint(provider, model = provider?.model, purpose = 'chat') {
  return fingerprintProviderModel(provider, model, purpose);
}
export async function persistNativeThread(threadId, { nativeThreadId, providerFingerprint: fingerprint, scopeId, ...metadata } = {}) {
  return updateThreadState(threadId, { nativeRuntime: { nativeThreadId, threadId: nativeThreadId, providerFingerprint: fingerprint, scopeId, ...metadata } });
}
export async function startTurn({ threadId, identity, input }) {
  await appendThreadEvent(threadId, { type: 'turn.started', ...identity, status: 'running', ...(input ? { input } : {}) });
  return identity;
}
export async function resumeTurn(input) { return startTurn(input); }
export async function startThread({ threadId, identity, nativeThreadId, providerFingerprint: fingerprint, scopeId } = {}) {
  if (nativeThreadId || fingerprint || scopeId) await persistNativeThread(threadId, { nativeThreadId, providerFingerprint: fingerprint, scopeId });
  return { threadId, nativeThreadId, reused: false };
}
export async function steerTurn({ threadId, identity, input }) {
  return appendThreadEvent(threadId, { type: 'item.completed', ...identity, itemType: 'user_message', itemId: `steer:${identity?.operationId || identity?.turnId}`, item: { content: input, delivery: 'steer' } });
}
export async function interruptTurn({ threadId, identity, reason = 'cancelled' }) {
  await appendThreadEvent(threadId, { type: 'turn.failed', ...identity, status: 'cancelled', error: { code: reason, retryable: false } });
  return { ...identity, status: 'cancelled' };
}
export async function completeTurn({ threadId, identity, usage, stopReason }) {
  await appendThreadEvent(threadId, { type: 'turn.completed', ...identity, usage: usage || null, stopReason: stopReason || null });
  return { ...identity, status: 'completed' };
}
export async function failTurn({ threadId, identity, error }) {
  await appendThreadEvent(threadId, { type: 'turn.failed', ...identity, status: 'failed', error: error || { code: 'agent_failed' } });
  return { ...identity, status: 'failed' };
}
