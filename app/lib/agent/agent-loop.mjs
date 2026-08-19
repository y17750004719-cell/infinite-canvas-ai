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
  if (typeof value.error === 'string' && value.error.trim()) {
    const message = sanitizeModelValue(value.error.trim());
    return {
      modelResult: { error: message },
      publicResult: { kind: 'tool_error', toolName, status: 'failed', message },
    };
  }
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
      ...(value?.resolvedImageOptions && typeof value.resolvedImageOptions === 'object'
        ? {
            resolvedImageOptions: {
              count: finiteCount(value.resolvedImageOptions.count, requestStats.requested),
              requestedCount: finiteCount(value.resolvedImageOptions.requestedCount, requestStats.requested),
              countSource: typeof value.resolvedImageOptions.countSource === 'string'
                ? value.resolvedImageOptions.countSource
                : 'default',
            },
          }
        : {}),
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
      ...(item?.promptTrace && typeof item.promptTrace === 'object'
        ? { promptTrace: item.promptTrace }
        : {}),
    }))
    .filter((item) => item.src);
}

function extractAgentImagePresentation(rawResult) {
  const value = rawResult?.presentation;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const title = typeof value.title === 'string' ? value.title.trim() : '';
  const summary = typeof value.summary === 'string' ? value.summary.trim() : '';
  const operation = value.operation === 'generate' || value.operation === 'edit'
    ? value.operation
    : '';
  if (!title || !summary || !operation) return null;
  return { title, summary, operation };
}

/**
 * Keeps a long-running image request's NDJSON stream active while its supplier
 * call is pending. The injected clock/timers keep this transport boundary testable.
 * @param {{
 *   intervalMs?: number,
 *   now?: () => number,
 *   onPulse?: (elapsedMs: number) => void,
 *   setIntervalFn?: (callback: () => void, intervalMs: number) => unknown,
 *   clearIntervalFn?: (timer: unknown) => void,
 * }} options
 */
export function startAgentImageGenerationHeartbeat({
  intervalMs = 10_000,
  now = () => Date.now(),
  onPulse = () => {},
  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval,
} = {}) {
  const startedAt = now();
  const timer = setIntervalFn(() => onPulse(Math.max(0, now() - startedAt)), intervalMs);
  return () => clearIntervalFn(timer);
}

/** @param {{
 * source?: 'direct'|'loop'|'confirmed',
 * runId?: string,
 * toolCallId?: string,
 * toolName?: string,
 * rawResult?: any,
 * includeAssets?: boolean,
 * }} input */
export function createAgentToolResultEvents({
  runId,
  toolCallId,
  toolName,
  rawResult,
  includeAssets = true,
} = {}) {
  if (rawResult?.confirmationRequired === true) return [];
  const { publicResult } = createAgentToolResultViews(toolName, rawResult);
  const events = [{ type: 'tool_result', toolCallId, toolName, result: publicResult }];
  if (toolName === 'generate_image' && includeAssets) {
    const assets = extractAgentImageAssets(rawResult);
    if (assets.length > 0) {
      const presentation = extractAgentImagePresentation(rawResult);
      const providerId = typeof rawResult?.resolvedImageOptions?.providerId === 'string'
        ? rawResult.resolvedImageOptions.providerId
        : '';
      const sourceReferenceId = typeof rawResult?.sourceReferenceId === 'string'
        ? rawResult.sourceReferenceId
        : '';
      events.push({
        type: 'client_action',
        action: {
          type: 'add_generated_assets',
          runId,
          assets,
          ...(providerId ? { providerId } : {}),
          ...(sourceReferenceId ? { sourceReferenceId } : {}),
          ...(presentation ? { presentation } : {}),
        },
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
   *   detail?: string,
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
      timestampMs: Date.now(),
      stepId: String(input.stepId || 'run'),
      phase: String(input.phase || 'running'),
      status: input.status || 'active',
      label: String(input.label || ''),
      ...(input.toolCallId ? { toolCallId: input.toolCallId } : {}),
      ...(input.toolName ? { toolName: input.toolName } : {}),
      ...(input.detail ? { detail: input.detail } : {}),
    };
    const key = keyFor(event);
    if (event.status === 'active') active.set(key, event);
    else active.delete(key);
    emitEvent(event);
    return event;
  };

  const stamp = () => ({
    sequence: ++sequence,
    timestampMs: Date.now(),
    runId: runId || '',
    operationId: currentOperationId,
  });

  return {
    update,
    stamp,
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
