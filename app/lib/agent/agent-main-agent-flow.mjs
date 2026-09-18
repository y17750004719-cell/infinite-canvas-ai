import { executeAgentTurn, createNativeEventForwarder, buildNativeTurnRequest, createDynamicToolCallback } from './agent-turn-execution-service.mjs';
import { runAgentTurn } from './agent-turn-orchestrator.mjs';

/**
 * Native main-agent flow. This owns protocol-facing tool filtering, context
 * preparation, event forwarding, request assembly, and the turn boundary.
 * Application behavior is injected through callbacks so this module remains
 * independent of images, confirmation storage, and HTTP response handling.
 */
/** @param {Record<string, any>} input */
export async function runMainAgentFlow({
  mainAgentTools = [],
  resolveToolNames = () => [],
  approvedConfirmation = null,
  selectedSkill = null,
  prepareTurn,
  buildRequest,
  runTurn = (request) => runAgentTurn({ startKeepalive, request }),
  startKeepalive,
  executeTool,
  createToolCallback,
  toolCallbackOptions,
  eventHandlers = {},
  hasImageResult = false,
  toolCallCount = 0,
  onBeforeTurn,
} = {}) {
  if (typeof prepareTurn !== 'function') throw new TypeError('runMainAgentFlow requires prepareTurn');
  if (typeof buildRequest !== 'function') throw new TypeError('runMainAgentFlow requires buildRequest');
  if (typeof runTurn !== 'function') throw new TypeError('runMainAgentFlow requires runTurn');
  if (typeof executeTool !== 'function' && typeof createToolCallback !== 'function' && !toolCallbackOptions) {
    throw new TypeError('runMainAgentFlow requires executeTool or createToolCallback');
  }

  await onBeforeTurn?.();
  const allowedNames = () => new Set(resolveToolNames());
  const nativeTools = mainAgentTools
    .filter((entry) => allowedNames().has(entry?.function?.name))
    .filter((entry) => !approvedConfirmation || entry.function?.name === approvedConfirmation.toolName)
    .map((entry) => ({
      name: entry.function.name,
      description: entry.function.description || entry.function.name,
      parameters: entry.function.parameters || { type: 'object', properties: {} },
      requiresCommentary: true,
      ...(entry.commentaryPolicy ? { commentaryPolicy: entry.commentaryPolicy } : {}),
    }));

  if (!selectedSkill && !approvedConfirmation) {
    nativeTools.push({
      name: 'select_visual_skill',
      description: 'Load and lock a visual Skill from the application candidate catalog, only when the user request is a high-confidence match. Returns the full rules; apply them before generating.',
      parameters: {
        type: 'object', additionalProperties: false, required: ['skillId', 'confidence'],
        properties: { skillId: { type: 'string' }, confidence: { type: 'string', enum: ['high', 'medium', 'low'] } },
      },
      requiresCommentary: true,
    });
  }

  const prepared = await prepareTurn({ nativeTools });
  const resolvedExecuteTool = typeof createToolCallback === 'function'
    ? createToolCallback({ nativeTools, resolveToolNames, approvedConfirmation })
    : toolCallbackOptions
      ? createDynamicToolCallback({ ...toolCallbackOptions, nativeTools, approvedConfirmation })
      : executeTool;
  if (typeof resolvedExecuteTool !== 'function') throw new TypeError('runMainAgentFlow tool callback factory returned no function');
  const forwardNativeEvent = createNativeEventForwarder({
    ...eventHandlers,
    flush: eventHandlers.flush,
  });
  const request = buildNativeTurnRequest({
    ...buildRequest({ nativeTools, ...prepared, onEvent: forwardNativeEvent, executeTool: resolvedExecuteTool }),
    tools: nativeTools,
    executeTool: resolvedExecuteTool,
    onEvent: forwardNativeEvent,
    startKeepalive,
    hasImageResult,
    toolCallCount,
  });
  return executeAgentTurn({ execute: () => runTurn(request) });
}
