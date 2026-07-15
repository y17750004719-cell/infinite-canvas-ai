function parseToolArguments(raw) {
  if (!raw) return {};
  if (typeof raw === 'object') return raw;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('Tool arguments must be an object');
    }
    return parsed;
  } catch (error) {
    throw new Error(`Invalid tool arguments: ${error instanceof Error ? error.message : 'invalid JSON'}`);
  }
}

function normalizeToolCalls(message) {
  return (Array.isArray(message?.tool_calls) ? message.tool_calls : [])
    .filter((call) => call?.function?.name)
    .map((call, index) => ({
      id: typeof call.id === 'string' && call.id ? call.id : `tool-call-${index + 1}`,
      type: 'function',
      function: {
        name: call.function.name,
        arguments: typeof call.function.arguments === 'string'
          ? call.function.arguments
          : JSON.stringify(call.function.arguments || {}),
      },
    }));
}

function finiteCount(value, fallback = 0) {
  return Number.isFinite(Number(value)) ? Math.max(0, Math.floor(Number(value))) : fallback;
}

function jobCounts(value) {
  const items = Array.isArray(value?.items) ? value.items : [];
  return {
    completed: Number.isFinite(Number(value?.completed))
      ? finiteCount(value.completed)
      : items.filter((item) => item?.status === 'completed').length,
    failed: Number.isFinite(Number(value?.failed))
      ? finiteCount(value.failed)
      : items.filter((item) => item?.status === 'failed').length,
    cancelled: Number.isFinite(Number(value?.cancelled))
      ? finiteCount(value.cancelled)
      : items.filter((item) => item?.status === 'cancelled').length,
    total: Number.isFinite(Number(value?.total)) ? finiteCount(value.total) : items.length,
  };
}

function sanitizeModelValue(value) {
  if (Array.isArray(value)) {
    return value
      .map(sanitizeModelValue)
      .filter((item) => item !== undefined);
  }
  if (!value || typeof value !== 'object') {
    if (typeof value !== 'string') return value;
    return value
      .replace(/https?:\/\/[^\s"'<>]+/gi, '[redacted-url]')
      .replace(/\/(?:Users|Volumes|var)\/[^\s"'<>]+/g, '[redacted-path]')
      .replace(/\b(?:access[_-]?token|refresh[_-]?token|api[_-]?key|token)\s*[:=]\s*[^\s,;]+/gi, '$1=[redacted]')
      .replace(/\b(?:provider|providerId|model|modelId)\s*[:=]\s*[^\s,;]+/gi, (match) => `${match.split(/[:=]/)[0]}=[redacted]`);
  }
  const result = {};
  for (const [key, entry] of Object.entries(value)) {
    if (/(?:url|provider|model|prompt|metadata)/i.test(key)) continue;
    const sanitized = sanitizeModelValue(entry);
    if (sanitized !== undefined) result[key] = sanitized;
  }
  return result;
}

export function createAgentToolResultViews(toolName, rawResult) {
  const value = rawResult && typeof rawResult === 'object' ? rawResult : {};
  if (toolName === 'generate_image') {
    const outputs = Array.isArray(value?.result?.outputs)
      ? value.result.outputs
      : Array.isArray(value?.assets)
        ? value.assets
        : [];
    const requestStats = value?.requestStats && typeof value.requestStats === 'object'
      ? {
          requested: finiteCount(value.requestStats.requested, outputs.length),
          succeeded: finiteCount(value.requestStats.succeeded, outputs.length),
          failed: finiteCount(value.requestStats.failed),
        }
      : {
          requested: outputs.length,
          succeeded: outputs.length,
          failed: 0,
        };
    const publicResult = {
      kind: 'image_generation',
      assetCount: outputs.length,
      requestStats,
      partialFailure: requestStats.failed > 0,
    };
    return { modelResult: publicResult, publicResult };
  }

  if (toolName === 'get_canvas_context') {
    const selectedItemIds = Array.isArray(value.selectedItemIds)
      ? value.selectedItemIds.filter((item) => typeof item === 'string')
      : [];
    const publicResult = {
      kind: 'canvas_context',
      itemCount: finiteCount(value.itemCount),
      selectedCount: selectedItemIds.length,
    };
    return {
      modelResult: { ...publicResult, selectedItemIds },
      publicResult,
    };
  }

  if (toolName === 'start_skill_job' || toolName === 'get_skill_job') {
    const counts = jobCounts(value);
    const publicResult = {
      kind: toolName === 'start_skill_job' ? 'skill_job_started' : 'skill_job_status',
      jobId: typeof value.jobId === 'string' ? value.jobId : typeof value.id === 'string' ? value.id : '',
      ...(typeof value.skillType === 'string' ? { skillType: value.skillType } : {}),
      status: typeof value.status === 'string' ? value.status : 'unknown',
      ...counts,
    };
    const safeItems = (Array.isArray(value.items) ? value.items : []).map((item) => ({
      ...(typeof item?.key === 'string' ? { key: item.key } : {}),
      ...(typeof item?.name === 'string' ? { name: item.name } : {}),
      ...(typeof item?.status === 'string' ? { status: item.status } : {}),
      ...(typeof item?.size === 'string' ? { size: item.size } : {}),
      ...(typeof item?.error === 'string' ? { error: item.error } : {}),
    }));
    return {
      modelResult: sanitizeModelValue(safeItems.length > 0 ? { ...publicResult, items: safeItems } : publicResult),
      publicResult,
    };
  }

  const modelResult = sanitizeModelValue(value);
  return {
    modelResult,
    publicResult: { kind: 'tool_result', toolName, status: 'completed' },
  };
}

function extractAgentImageAssets(rawResult) {
  const value = rawResult && typeof rawResult === 'object' ? rawResult : {};
  const outputs = Array.isArray(value?.result?.outputs)
    ? value.result.outputs
    : Array.isArray(value?.assets)
      ? value.assets
      : [];
  return outputs
    .map((item) => ({
      src: typeof item?.src === 'string'
        ? item.src
        : typeof item?.localUrl === 'string'
          ? item.localUrl
          : typeof item?.url === 'string'
            ? item.url
            : '',
      ...(Number.isFinite(item?.naturalWidth) ? { naturalWidth: item.naturalWidth } : {}),
      ...(Number.isFinite(item?.naturalHeight) ? { naturalHeight: item.naturalHeight } : {}),
    }))
    .filter((item) => item.src);
}

export function createAgentToolResultEvents({
  runId,
  toolCallId,
  toolName,
  rawResult,
} = {}) {
  if (rawResult?.confirmationRequired === true) return [];
  const { publicResult } = createAgentToolResultViews(toolName, rawResult);
  const events = [{ type: 'tool_result', toolCallId, result: publicResult }];
  if (toolName === 'generate_image') {
    const assets = extractAgentImageAssets(rawResult);
    if (assets.length > 0) {
      events.push({
        type: 'client_action',
        action: { type: 'add_generated_assets', runId, assets },
      });
    }
  }
  return events;
}

/**
 * @param {{
 *   runId?: string,
 *   operationId?: string,
 *   lastSequence?: number,
 *   emit?: (event: import('./events').AgentProgressUpdate) => void,
 * }} input
 */
export function createAgentProgressTracker({
  runId,
  operationId = runId,
  lastSequence = 0,
  emit,
} = {}) {
  let currentOperationId = operationId || runId || '';
  let sequence = finiteCount(lastSequence);
  const active = new Map();
  const emitEvent = typeof emit === 'function' ? emit : () => {};
  const keyFor = (update) => `${update.stepId || 'run'}:${update.toolCallId || ''}`;

  /**
   * @param {{
   *   stepId: import('./events').AgentProgressStepId,
   *   phase: import('./events').AgentProgressPhase,
   *   status: import('./events').AgentProgressStatus,
   *   label: string,
   *   toolCallId?: string,
   *   toolName?: string,
   * }} input
   */
  const update = (input) => {
    sequence += 1;
    const event = {
      type: 'progress_update',
      version: 1,
      runId: runId || '',
      operationId: currentOperationId,
      sequence,
      stepId: String(input.stepId || 'run'),
      phase: String(input.phase || 'running'),
      status: input.status || 'active',
      label: String(input.label || ''),
      ...(input.toolCallId ? { toolCallId: input.toolCallId } : {}),
      ...(input.toolName ? { toolName: input.toolName } : {}),
    };
    const key = keyFor(event);
    if (event.status === 'active') active.set(key, event);
    else active.delete(key);
    emitEvent(event);
    return event;
  };

  return {
    update,
    resume(next = {}) {
      if (typeof next.operationId === 'string' && next.operationId) currentOperationId = next.operationId;
      sequence = Math.max(sequence, finiteCount(next.lastSequence));
      active.clear();
    },
    settleActive(status = 'completed', label = '') {
      for (const event of [...active.values()]) {
        update({
          stepId: event.stepId,
          phase: event.phase,
          status,
          label: label || event.label,
          toolCallId: event.toolCallId,
          toolName: event.toolName,
        });
      }
    },
    snapshot() {
      return { operationId: currentOperationId, lastSequence: sequence };
    },
  };
}

export async function runAgentLoop({
  messages,
  tools,
  modelFn,
  executeTool,
  isReadOnlyTool = (_name) => false,
  requireMutationTool = false,
  maxTurns = 6,
  maxToolCalls = 4,
  onToolStart,
  onToolResult,
  serializeToolResultForModel = (_name, result) => result,
  serializeToolResultForPublic = (_name, result) => result,
}) {
  if (typeof modelFn !== 'function') throw new Error('Agent model is unavailable');
  if (typeof executeTool !== 'function') throw new Error('Agent tool executor is unavailable');
  const conversation = [...(Array.isArray(messages) ? messages : [])];
  let toolCallCount = 0;
  let mutationToolCallCount = 0;
  let executionCorrectionUsed = false;

  for (let turn = 1; turn <= maxTurns; turn += 1) {
    const response = await modelFn({ messages: conversation, tools });
    const message = response?.choices?.[0]?.message || {};
    const toolCalls = normalizeToolCalls(message);
    if (toolCalls.length === 0) {
      if (requireMutationTool && mutationToolCallCount === 0) {
        if (!executionCorrectionUsed) {
          executionCorrectionUsed = true;
          conversation.push({
            role: 'system',
            content: 'This is an execution request. Call one allowed mutation tool now. Do not claim that generation or execution started unless the tool call is present. Clarification has already been handled.',
          });
          continue;
        }
        return {
          content: '',
          reasoningContent: '',
          turns: turn,
          toolCalls: toolCallCount,
          mutationToolCalls: mutationToolCallCount,
          stopReason: 'execution_required',
        };
      }
      return {
        content: typeof message.content === 'string' ? message.content : '',
        reasoningContent: typeof message.reasoning_content === 'string' ? message.reasoning_content : '',
        turns: turn,
        toolCalls: toolCallCount,
        mutationToolCalls: mutationToolCallCount,
        stopReason: 'completed',
      };
    }

    if (toolCallCount + toolCalls.length > maxToolCalls) {
      throw new Error('Agent tool call budget exceeded');
    }
    if (turn >= maxTurns) {
      throw new Error('Agent turn budget exceeded');
    }
    toolCallCount += toolCalls.length;
    conversation.push({
      role: 'assistant',
      content: typeof message.content === 'string' ? message.content : '',
      tool_calls: toolCalls,
    });

    const executeCall = async (call) => {
      const name = call.function.name;
      const args = parseToolArguments(call.function.arguments);
      await onToolStart?.({ id: call.id, name, args });
      const rawResult = await executeTool(name, args, { toolCallId: call.id });
      const modelResult = await serializeToolResultForModel(name, rawResult);
      const publicResult = await serializeToolResultForPublic(name, rawResult);
      if (rawResult?.confirmationRequired !== true) {
        await onToolResult?.({ id: call.id, name, result: publicResult });
      }
      return { call, rawResult, modelResult };
    };

    const readCalls = toolCalls.filter((call) => isReadOnlyTool(call.function.name));
    const mutationCalls = toolCalls.filter((call) => !isReadOnlyTool(call.function.name));
    mutationToolCallCount += mutationCalls.length;
    const results = await Promise.all(readCalls.map(executeCall));
    for (const call of mutationCalls) {
      const executed = await executeCall(call);
      results.push(executed);
      if (executed.rawResult?.confirmationRequired === true) {
        return {
          content: '',
          reasoningContent: '',
          turns: turn,
          toolCalls: toolCallCount,
          mutationToolCalls: mutationToolCallCount,
          stopReason: 'confirmation_required',
          confirmation: {
            ...executed.rawResult,
            toolCallId: executed.call.id,
            arguments: parseToolArguments(executed.call.function.arguments),
          },
        };
      }
    }

    for (const { call, modelResult } of results) {
      conversation.push({
        role: 'tool',
        tool_call_id: call.id,
        name: call.function.name,
        content: JSON.stringify(modelResult ?? null),
      });
    }
  }

  throw new Error('Agent turn budget exceeded');
}
