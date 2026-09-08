/**
 * Context-window budgeting and compaction adapters.
 *
 * The event module remains the compatibility boundary. These exports make
 * token accounting and window management usable without importing replay code.
 */
import {
  buildReplayableContext,
  compactContext as compactReplayableContext,
  estimateContextTokens,
  estimateVisualTokens,
  estimateEventTokens,
  normalizeCompactedWindows,
} from './context-events.mjs';

export { estimateContextTokens, estimateVisualTokens, estimateEventTokens, normalizeCompactedWindows };

/**
 * Compute a conservative, inspectable budget for a provider request. The
 * caller may supply already-serialized system/tool definitions so accounting
 * remains independent of any specific provider SDK.
 */
export function estimateContextBudget({
  contextWindow = 32768,
  systemPrompt = '',
  history = [],
  tools = [],
  outputReserve = 4096,
  fallbackReserve = 0,
} = {}) {
  const fullContextLimit = Math.max(1024, Number(contextWindow) || 32768);
  const systemTokens = estimateContextTokens(systemPrompt);
  const historyTokens = (Array.isArray(history) ? history : []).reduce((sum, item) => {
    if (!item || typeof item !== 'object') return sum + estimateContextTokens(item);
    let tokens = estimateContextTokens(item.content || item.summary || item.message || '');
    if (item.type === 'tool_call') tokens += estimateContextTokens(item.arguments || {});
    if (item.type === 'confirmation' || item.type === 'clarification') tokens += estimateContextTokens(item.request || {});
    return sum + tokens;
  }, 0);
  const toolDefinitionTokens = estimateContextTokens(tools);
  const visualTokens = (Array.isArray(history) ? history : []).reduce((sum, item) => sum + estimateVisualTokens(item), 0);
  const effectiveInputBudget = Math.max(
    512,
    fullContextLimit - Math.max(0, Number(outputReserve) || 0) - Math.max(0, Number(fallbackReserve) || 0),
  );
  return {
    systemTokens,
    historyTokens,
    toolDefinitionTokens,
    toolResultTokens: (Array.isArray(history) ? history : []).filter((item) => item?.type === 'tool_result').reduce((sum, item) => sum + estimateContextTokens(item.result || item.content || ''), 0),
    visualTokens,
    outputReserve: Math.max(0, Number(outputReserve) || 0),
    fallbackReserve: Math.max(0, Number(fallbackReserve) || 0),
    effectiveInputBudget,
    fullContextLimit,
  };
}

/**
 * Compact a replayable context to the configured model budget.
 *
 * @param {Record<string, unknown>} replay
 * @param {{ model?: string, contextWindow?: number, reserveTokens?: number,
 * threshold?: number, keepRecent?: number }} options
 */
export function compactContextWindow(replay, options = {}) {
  return compactReplayableContext(buildReplayableContext(replay || {}), options);
}

// Alias matching the existing context-events API.
export const compactContext = compactContextWindow;
