import { enrichGeneratedAssetDeliveryAction } from './generated-asset-delivery.mjs';

function finiteCount(value, fallback = 0) {
  return Number.isFinite(Number(value)) ? Math.max(0, Math.floor(Number(value))) : fallback;
}

function normalizeIdentity(value, fallback = '') {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, 200) : fallback;
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
    if (value.success === false || value.status === 'failed' || value.code === 'skill_lock_failed') {
      const message = sanitizeModelValue(String(value.message || value.error || 'Image generation failed'));
      return {
        modelResult: { error: message, code: value.code || 'image_execution_failed', retryable: false },
        publicResult: { kind: 'tool_error', toolName, status: 'failed', message, code: value.code || 'image_execution_failed' },
      };
    }
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
      ...(typeof item?.assetId === 'string' && item.assetId ? { assetId: item.assetId } : {}),
      ...(typeof item?.slotId === 'string' && item.slotId ? { slotId: item.slotId } : {}),
      ...(typeof item?.versionId === 'string' && item.versionId ? { versionId: item.versionId } : {}),
      ...(typeof item?.parentVersionId === 'string' && item.parentVersionId ? { parentVersionId: item.parentVersionId } : {}),
      ...(Number.isFinite(item?.providerReturnedAt) ? { providerReturnedAt: item.providerReturnedAt } : {}),
      ...(Number.isFinite(item?.locallyStoredAt) ? { locallyStoredAt: item.locallyStoredAt } : {}),
      ...(typeof item?.previewSrc === 'string' && item.previewSrc ? { previewSrc: item.previewSrc } : {}),
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
        action: enrichGeneratedAssetDeliveryAction({
          type: 'add_generated_assets',
          runId,
          assets,
          ...(providerId ? { providerId } : {}),
          ...(sourceReferenceId ? { sourceReferenceId } : {}),
          ...(presentation ? { presentation } : {}),
        }),
      });
    }
  }
  return events;
}

/**
 * @param {{
 *   taskId?: string,
 *   runId?: string,
 *   operationId?: string,
 *   lastSequence?: number,
 *   emit?: (event: import('./events').AgentProgressUpdate) => void,
 * }} input
 */
export function createAgentProgressTracker({
  taskId,
  runId,
  operationId = runId,
  lastSequence = 0,
  emit,
} = {}) {
  let currentTaskId = normalizeIdentity(taskId, normalizeIdentity(operationId, normalizeIdentity(runId)));
  let currentRunId = normalizeIdentity(runId);
  let currentOperationId = operationId || runId || '';
  let sequence = finiteCount(lastSequence);
  const active = new Map();
  const emitEvent = typeof emit === 'function' ? emit : () => {};
  const keyFor = (update) => update.itemId || `${update.stepId || 'run'}:${update.toolCallId || ''}`;

  /**
   * @param {{
   *   stepId: import('./events').AgentProgressStepId,
   *   phase: import('./events').AgentProgressPhase,
   *   status: import('./events').AgentProgressStatus,
   *   label: string,
   *   completionSummary?: string,
   *   toolCallId?: string,
   *   toolName?: string,
   *   itemId?: string,
   *   executionId?: string,
   *   parentItemId?: string,
   *   retryability?: 'retryable' | 'requires_change' | 'unknown',
   *   detail?: string,
   * }} input
   */
  const update = (input) => {
    sequence += 1;
    const event = {
      type: 'progress_update',
      version: 1,
      taskId: currentTaskId,
      runId: currentRunId,
      operationId: currentOperationId,
      sequence,
      timestampMs: Date.now(),
      stepId: String(input.stepId || 'run'),
      phase: String(input.phase || 'running'),
      status: input.status || 'active',
      label: String(input.label || ''),
      ...(input.completionSummary ? { completionSummary: String(input.completionSummary) } : {}),
      ...(input.toolCallId ? { toolCallId: input.toolCallId } : {}),
      ...(input.toolName ? { toolName: input.toolName } : {}),
      ...(input.itemId ? { itemId: input.itemId } : {}),
      ...(input.executionId ? { executionId: input.executionId } : {}),
      ...(input.parentItemId ? { parentItemId: input.parentItemId } : {}),
      ...(input.retryability ? { retryability: input.retryability } : {}),
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
    taskId: currentTaskId,
    runId: currentRunId,
    operationId: currentOperationId,
  });

  return {
    update,
    stamp,
    resume(next = {}) {
      if (typeof next.operationId === 'string' && next.operationId && currentOperationId && next.operationId !== currentOperationId) {
        const error = new Error('Agent operation is stale');
        error.code = 'stale_operation';
        error.statusCode = 409;
        throw error;
      }
      if (typeof next.taskId === 'string' && next.taskId.trim()) currentTaskId = next.taskId.trim().slice(0, 200);
      if (typeof next.runId === 'string' && next.runId.trim()) currentRunId = next.runId.trim().slice(0, 200);
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
          itemId: event.itemId,
          executionId: event.executionId,
          parentItemId: event.parentItemId,
          retryability: event.retryability,
        });
      }
    },
    snapshot() {
      return {
        taskId: currentTaskId,
        operationId: currentOperationId,
        runId: currentRunId,
        lastSequence: sequence,
      };
    },
  };
}
