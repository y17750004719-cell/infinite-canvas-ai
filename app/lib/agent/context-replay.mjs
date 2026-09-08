/**
 * Context replay adapters.
 *
 * Keeping these exports in a dedicated module gives model callers a narrow
 * dependency for turning persisted events into provider messages while the
 * event normalizer remains the owner of wire compatibility and validation.
 */
import {
  buildReplayableContext,
  normalizeContextEvents,
  replayContextEvents,
  buildResponseItems,
  replayResponseItems,
} from './context-events.mjs';

/**
 * Build a provider-ready conversation from persisted context.
 *
 * @param {Record<string, unknown>|Array<Record<string, unknown>>} replay
 * @param {{ currentReferenceImages?: unknown[] }} options
 * @returns {Array<{role: string, content: unknown}>}
 */
export function replayContext(replay, options = {}) {
  const value = Array.isArray(replay)
    ? { events: replay }
    : (replay && typeof replay === 'object' ? replay : {});
  return replayContextEvents(value, options);
}

/**
 * Normalize and replay current request messages as a single context value.
 */
export function buildReplayMessages({
  events = [],
  messages = [],
  referenceContext,
  sessionId = '',
  visualAssets = [],
  compactedWindows = [],
  activeWindow,
  mergeMessages = false,
  currentReferenceImages = [],
} = {}) {
  const context = buildReplayableContext({
    events,
    messages,
    referenceContext,
    sessionId,
    visualAssets,
    compactedWindows,
    activeWindow,
    mergeMessages,
  });
  return replayContextEvents(context, { currentReferenceImages });
}

export { normalizeContextEvents, replayContextEvents, buildResponseItems, replayResponseItems };
