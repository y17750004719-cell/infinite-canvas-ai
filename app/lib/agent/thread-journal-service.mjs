/**
 * Business-facing journal facade for the agent runtime.
 *
 * The underlying journal remains the single persistence implementation, but
 * callers outside this boundary must not depend on its storage module. This
 * facade also gives request services one stable dependency to mock in tests.
 */
import {
  appendThreadEvent as append,
  queryThread as query,
  loadThread as load,
  updateThreadState as update,
  forkThread as fork,
  consumeThreadInputs as consume,
} from './thread-journal.mjs';

export const appendThreadEvent = (threadId, event) => append(threadId, event);
export const queryThread = (threadId, options) => query(threadId, options);
export const loadThread = (threadId) => load(threadId);
export const updateThreadState = (threadId, patch) => update(threadId, patch);
export const forkThread = (threadId) => fork(threadId);
export const consumeThreadInputs = (threadId, identity, delivery, limit) => consume(threadId, identity, delivery, limit);

export function createThreadJournalService(overrides = {}) {
  return {
    appendThreadEvent: overrides.appendThreadEvent || appendThreadEvent,
    queryThread: overrides.queryThread || queryThread,
    loadThread: overrides.loadThread || loadThread,
    updateThreadState: overrides.updateThreadState || updateThreadState,
    forkThread: overrides.forkThread || forkThread,
    consumeThreadInputs: overrides.consumeThreadInputs || consumeThreadInputs,
  };
}
