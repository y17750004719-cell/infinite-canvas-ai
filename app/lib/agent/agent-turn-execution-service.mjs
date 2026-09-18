import { validateAgentToolArguments } from './tool-registry.mjs';
import { dispatchRegisteredApplicationTool } from './application-tool-dispatcher.mjs';

/**
 * Boundary for executing one Native Responses turn.
 *
 * The request controller owns HTTP/request state while this module owns the
 * invocation boundary.  Keeping the callback opaque is intentional: tool
 * dispatch, event projection and persistence are injected by the caller and
 * are not reimplemented here.  This makes turn execution independently
 * testable and gives recovery a single entry point.
 */

/**
 * Execute a single turn using the supplied Native runtime callback.
 *
 * @param {{execute: Function, onBeforeExecute?: Function, onAfterExecute?: Function}} input
 * @returns {Promise<unknown>}
 */
export async function executeAgentTurn(input) {
  if (!input || typeof input.execute !== 'function') {
    throw new TypeError('agent-turn-execution-service requires an execute callback');
  }
  await input.onBeforeExecute?.();
  try {
    const result = await input.execute();
    await input.onAfterExecute?.({ result });
    return result;
  } catch (error) {
    await input.onAfterExecute?.({ error });
    throw error;
  }
}

/**
 * Materialize image references for the Native protocol. Native accepts bytes,
 * while the application stores durable/preview URLs; keeping this conversion
 * here prevents request handlers from reaching into asset storage details.
 *
 * @param {{sources?: unknown[], sessionId: string, findAsset?: Function,
 *   materialize: Function, read: Function}} input
 */
export async function materializeNativeImages({
  sources = [],
  sessionId,
  findAsset,
  materialize,
  read,
} = {}) {
  if (!Array.isArray(sources) || sources.length === 0) return [];
  if (typeof materialize !== 'function' || typeof read !== 'function') {
    throw new TypeError('materializeNativeImages requires materialize and read callbacks');
  }
  const images = [];
  for (const [index, source] of sources.entries()) {
    if (typeof source !== 'string' || !source.trim()) continue;
    const existingAsset = typeof findAsset === 'function' ? await findAsset(source) : undefined;
    const asset = await materialize({
      sessionId,
      source: existingAsset || {
        src: source,
        source: 'upload',
        sourceReferenceId: `native-input-${index + 1}`,
      },
      existingAsset,
    });
    const bytes = await read(asset);
    if (!bytes) throw new Error(`Unable to read native image input ${index + 1}`);
    const mimeType = typeof asset?.mimeType === 'string' && asset.mimeType
      ? asset.mimeType
      : 'application/octet-stream';
    images.push(`data:${mimeType};base64,${Buffer.from(bytes).toString('base64')}`);
  }
  return images;
}

/**
 * Build a Native turn request while keeping application-specific callbacks
 * explicit. The returned object is safe to pass to native-runtime-gateway.
 */
export function buildNativeTurnRequest(input = {}) {
  const {
    sessionId,
    identity,
    provider,
    userText = '',
    images = [],
    skills = [],
    baseInstructions = '',
    developerInstructions = '',
    tools = [],
    signal,
    executeTool,
    onEvent,
    hasImageResult = false,
    toolCallCount = 0,
    ...rest
  } = input;
  if (!sessionId || !identity || typeof identity !== 'object') {
    throw new TypeError('buildNativeTurnRequest requires sessionId and identity');
  }
  if (typeof executeTool !== 'function') throw new TypeError('buildNativeTurnRequest requires executeTool');
  if (typeof onEvent !== 'function') throw new TypeError('buildNativeTurnRequest requires onEvent');
  return {
    ...rest,
    sessionId,
    identity: { ...identity },
    provider: provider ? { ...provider } : undefined,
    userText: String(userText),
    images: Array.isArray(images) ? images.slice() : [],
    skills: Array.isArray(skills) ? skills.slice() : [],
    baseInstructions: String(baseInstructions || ''),
    developerInstructions: String(developerInstructions || ''),
    tools: Array.isArray(tools) ? tools.slice() : [],
    signal,
    executeTool,
    onEvent,
    hasImageResult: Boolean(hasImageResult),
    toolCallCount: Number.isFinite(Number(toolCallCount)) ? Number(toolCallCount) : 0,
  };
}

/**
 * Create the dynamic-tool callback used by Native. Approval matching happens
 * before dispatch so a resumed confirmation cannot silently mutate arguments.
 */
export function createDynamicToolCallback({
  approvedConfirmation,
  hashArguments = (value) => JSON.stringify(value ?? {}),
  dispatch,
  registry,
  validate,
  nativeTools = [],
  onSkillSelection,
  resolveAllowedTools,
  executionContext = {},
} = {}) {
  const dispatchTool = typeof dispatch === 'function'
    ? dispatch
    : (input) => dispatchRegisteredApplicationTool({ ...input, registry });
  return async (toolName, args = {}, context = {}) => {
    if (approvedConfirmation && (
      toolName !== approvedConfirmation.toolName
      || hashArguments(args) !== hashArguments(approvedConfirmation.toolArgs)
    )) {
      return { isError: true, modelResult: { code: 'approval_contract_changed', retryable: false } };
    }
    const allowedTools = typeof resolveAllowedTools === 'function'
      ? resolveAllowedTools()
      : executionContext.allowedTools;
    if (typeof validate === 'function') validate(toolName, args, allowedTools);
    else {
      const nativeTool = nativeTools.find((tool) => tool?.name === toolName);
      if (nativeTool) validateAgentToolArguments(nativeTool.parameters || { type: 'object' }, args, toolName);
    }
    if (toolName === 'select_visual_skill' && typeof onSkillSelection === 'function') {
      return onSkillSelection({ args, context, allowedTools, tool: nativeTools.find((entry) => entry?.name === toolName) });
    }
    return dispatchTool({
      name: toolName,
      args,
      allowedTools,
      executionContext: { ...executionContext, ...context, toolName },
    });
  };
}

/**
 * Convert raw Native item notifications into application callbacks. Unknown
 * events are deliberately forwarded to onRawEvent for journal/replay parity.
 */
export function createNativeEventForwarder({
  onRawEvent,
  onActivityText,
  onToolStart,
  onToolResult,
  onCommentary,
  flush,
} = {}) {
  return async (event) => {
    const method = event?.method;
    const params = event?.params || {};
    const item = params.item || {};
    if (method === 'item/agentMessage/delta') {
      await onActivityText?.(String(params.itemId || item.id || ''), String(params.delta || ''));
    } else if (method === 'item/started' && item.type === 'dynamicToolCall') {
      await onToolStart?.(String(item.id || item.callId || ''), String(item.tool || 'tool'), item);
    } else if (method === 'item/completed' && item.type === 'dynamicToolCall') {
      await onToolResult?.(String(item.id || item.callId || ''), String(item.tool || 'tool'), item);
    } else if (method === 'item/completed' && item.type === 'agentMessage') {
      await onCommentary?.(item);
    }
    await onRawEvent?.(event);
    await flush?.();
  };
}

/** Backwards-friendly descriptive alias for callers that prefer run wording. */
export const runAgentTurnExecution = executeAgentTurn;

/**
 * Convenience entry point used by callers that already assembled the Native
 * request. Keeping this here centralizes the turn boundary while preserving
 * dependency injection for tests and recovery.
 */
export async function runNativeResponsesTurn({ runTurn, request }) {
  if (typeof runTurn !== 'function') throw new TypeError('runNativeResponsesTurn requires runTurn');
  return executeAgentTurn({
    onBeforeExecute: undefined,
    execute: () => runTurn({ ...request }),
    onAfterExecute: undefined,
  });
}

/** Stable descriptive name for recovery and controller callers. */
export const runMainAgentOnce = async ({ runTurn, request, startKeepalive } = {}) => {
  return executeAgentTurn({
    onBeforeExecute: undefined,
    execute: () => runTurn({ ...request, startKeepalive }),
    onAfterExecute: undefined,
  });
};
