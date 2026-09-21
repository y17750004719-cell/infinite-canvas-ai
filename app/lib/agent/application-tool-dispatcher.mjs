const DISABLED_NATIVE_TOOLS = new Set([
  'code_mode', 'code-mode', 'code_mode_host', 'code-mode-host',
  'image_generation', 'image-generation', 'image_generation_host', 'image-generation-host',
]);

const normalizeName = (value) => String(value || '').trim().toLowerCase().replace(/\//g, '_');

// Registry validation is kept at this boundary so every caller (Native,
// replay, and HTTP) observes the same argument contract.
async function validateRegisteredArguments(registry, name, args) {
  const tool = registry?.get?.(name);
  if (!tool) return;
  const { validateAgentToolArguments, validateToolArgumentRelationships, normalizeToolArguments } = await import('./tool-registry.mjs');
  const normalized = normalizeToolArguments(name, args);
  const raw = normalized && typeof normalized === 'object' && !Array.isArray(normalized) ? { ...normalized } : normalized;
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) delete raw.publicProgress;
  validateAgentToolArguments(tool.parameters, raw, name);
  validateToolArgumentRelationships(name, raw);
  return normalized;
}

// Keep the registry-specific execution contract behind this boundary. The
// request controller should only provide the registry and execution context;
// tool-registry remains the implementation detail of this dispatcher.
/** @param {any} input */
/** @param {any} input */
/**
 * @param {{registry?: any, name?: string, args?: any, allowedTools?: any[], executionContext?: any, execute?: Function}} input
 */
export async function dispatchRegisteredApplicationTool({
  registry,
  name,
  args,
  allowedTools = [],
  executionContext = {},
  execute,
  interaction,
} = {}) {
  const runner = execute || (async (requestedTool, requestedArgs, context) => {
    const { executeAgentTool } = await import('./tool-registry.mjs');
    return executeAgentTool(registry, requestedTool, requestedArgs, context);
  });
  return dispatchApplicationTool({
    name,
    args,
    allowedTools,
    context: executionContext,
    execute: runner,
    registry,
    interaction,
  });
}

export function validateApplicationToolName(name, allowedTools = []) {
  const requestedTool = String(name || '').trim();
  const allowed = Array.isArray(allowedTools) ? allowedTools.filter(Boolean) : [];
  if (allowed.includes(requestedTool)) return { ok: true, requestedTool, allowedTools: allowed };
  const normalized = normalizeName(requestedTool);
  const disabled = DISABLED_NATIVE_TOOLS.has(normalized);
  // `exec` is a Native/code-mode tool, not an application capability. Keep
  // it out of the code-mode host and report the normal registry rejection so
  // callers cannot mistake it for a recoverable application capability.
  const code = normalized === 'exec' ? 'tool_not_allowed' : (disabled ? 'native_capability_disabled' : 'tool_not_allowed');
  return {
    ok: false,
    requestedTool,
    allowedTools: allowed,
    error: {
      code,
      failureStage: 'tool_dispatch',
      retryable: false,
      requestedTool,
      allowedTools: allowed,
    },
  };
}

export const APPLICATION_TOOL_CAPABILITY_SNAPSHOT = Object.freeze({
  dynamicToolMethod: 'item/tool/call',
  applicationToolsEnabled: true,
  codeModeEnabled: false,
  nativeImageGenerationEnabled: false,
});

export function isApplicationImageTool(name) {
  return String(name || '').trim() === 'generate_image';
}

const INTERACTION_TOOLS = new Set([
  'request_user_decision', 'request_context_selection', 'resolve_failed_task_recovery',
  'request_main_agent_context', 'rewind_agent_analysis', 'select_visual_skill',
]);

function withExecutionIdentity(result, name, context) {
  const payload = result && typeof result === 'object' && !Array.isArray(result)
    ? result
    : { value: result };
  return {
    ...payload,
    toolName: name,
    threadId: context.threadId,
    turnId: context.turnId,
    taskId: context.taskId,
    operationId: context.operationId,
    runId: context.runId,
  };
}

function dispatchError(code, extra = {}) {
  return { isError: true, modelResult: { code, failureStage: 'tool_dispatch', retryable: false, ...extra } };
}

/** @param {any} input */
export async function dispatchApplicationTool({ name, args, allowedTools = [], execute, context = {}, registry, interaction } = {}) {
  const validation = validateApplicationToolName(name, allowedTools);
  if (!validation.ok) return { isError: true, modelResult: validation.error };
  const imageExecutor = context.generateImage || context.executeImage || context.imageExecutor;
  if (typeof execute !== 'function' && !(isApplicationImageTool(name) && typeof imageExecutor === 'function')) return dispatchError('tool_dispatch_unavailable');
  let normalizedArgs = args;
  try {
    normalizedArgs = await validateRegisteredArguments(registry, name, args) ?? args;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const fieldPath = message.match(/arguments(\.[\w]+|\[[^\]]+\])+/)?.[0] || undefined;
    return {
      isError: true,
      modelResult: {
        code: 'tool_arguments_invalid',
        failureStage: 'tool_dispatch',
        retryable: false,
        toolName: name,
        ...(context.toolCallId ? { toolCallId: context.toolCallId } : {}),
        ...(fieldPath ? { fieldPath } : {}),
        providerRequestStarted: false,
        message,
      },
    };
  }
  try {
    let result;
    if (name === 'generate_image' && typeof imageExecutor === 'function') {
      result = await dispatchImageGeneration({ generateImage: imageExecutor, request: normalizedArgs, context });
    } else if (INTERACTION_TOOLS.has(name) && typeof interaction?.[name] === 'function') {
      result = await interaction[name]({ args: normalizedArgs, context });
    } else if (name === 'select_visual_skill' && typeof interaction?.selectVisualSkill === 'function') {
      result = await interaction.selectVisualSkill({ args: normalizedArgs, context });
    } else if (typeof execute === 'function') {
      result = await execute(name, normalizedArgs, context);
    } else {
      return dispatchError('tool_dispatch_unavailable');
    }
    return withExecutionIdentity(result, name, context);
  } catch (error) {
    return dispatchError('tool_execution_failed', { message: error instanceof Error ? error.message : String(error) });
  }
}

export async function dispatchImageGeneration({ generateImage, request, context } = {}) {
  if (typeof generateImage !== 'function') throw Object.assign(new Error('image_dispatch_unavailable'), { code: 'image_dispatch_unavailable', failureStage: 'tool_dispatch', retryable: false });
  return generateImage(request, context);
}
