export const IMAGE_PIPELINE_ROUTE = '/api/generate';

import { settleCanvasImageGenerationRequests } from '../workspace-session-view.mjs';

/**
 * Execute a planned set of independent image requests.  Concurrency and
 * ordering are owned by the image service; callers provide only the durable
 * task executor and optional progressive delivery callback.
 */
export async function executeImageBatch({
  requests = [],
  executionMode = 'serial',
  runTask,
  onSettled,
} = {}) {
  if (!Array.isArray(requests) || requests.length === 0) {
    throw new TypeError('image batch requires requests');
  }
  if (typeof runTask !== 'function') throw new TypeError('image batch requires a task executor');
  return settleCanvasImageGenerationRequests({
    requests,
    executionMode,
    runTask,
    ...(typeof onSettled === 'function' ? { onSettled } : {}),
  });
}

/** Persist generated assets through the caller's session-asset adapter. */
export async function persistImageAssets({ assets = [], persist } = {}) {
  if (typeof persist !== 'function') throw new TypeError('image assets require a persistence adapter');
  return Promise.all((Array.isArray(assets) ? assets : []).map((asset, index) => persist(asset, index)));
}

/** Build the canonical user-facing completion summary without emitting it. */
export function buildImageCompletionSummary(result = {}) {
  const presentation = result?.presentation;
  const requestStats = result?.requestStats;
  const succeeded = Number.isFinite(requestStats?.succeeded) ? Math.max(0, requestStats.succeeded) : 0;
  const failed = Number.isFinite(requestStats?.failed) ? Math.max(0, requestStats.failed) : 0;
  if (!presentation?.title || !presentation?.summary || succeeded <= 0) return null;
  const summary = String(presentation.summary).includes('画布')
    ? String(presentation.summary)
    : `${String(presentation.summary)} 结果已添加到画布。`;
  return {
    title: String(presentation.title),
    summary,
    operation: presentation.operation === 'edit' ? 'edit' : 'generate',
    succeeded,
    failed,
    addedToCanvas: true,
  };
}

export async function executeImagePipelineRequest(request, context = {}) {
  const { dispatchImageRequest } = await import('./image-tool-service.mjs');
  return dispatchImageRequest(request, context);
}

export async function runImagePipelineHttp({ request, url, signal, body, headers = {} } = {}) {
  if (!url) throw new TypeError('image pipeline URL is required');
  const { NextRequest } = await import('next/server');
  const response = new NextRequest(new URL(url, request.url), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-z-flow-image-agent': '1', ...headers },
    signal,
    body: JSON.stringify(body),
  });
  return executeImagePipelineRequest(response);
}

/**
 * Provider dispatch boundary used by the runtime's durable task executor.
 * Keeping request construction and response decoding here prevents the
 * request orchestrator from knowing the local image route protocol.
 */
export async function requestImageGeneration({ request, signal, body, url = IMAGE_PIPELINE_ROUTE } = {}) {
  const response = await runImagePipelineHttp({ request, url, signal, body });
  const payload = await response.json().catch(() => null);
  if (!response.ok || payload?.status !== 'completed') {
    throw Object.assign(new Error(payload?.error || `Image generation failed (${response.status})`), {
      code: payload?.code || 'image_provider_failed',
      failureStage: payload?.failureStage || 'image_provider',
      retryable: payload?.isRetryable === true,
      outcomeUnknown: payload?.outcomeUnknown === true,
    });
  }
  // `/api/generate` keeps its public response under `result.outputs`, while
  // the durable ledger requires a canonical top-level `assets` collection.
  // Normalize at this service boundary so a successful supplier call is not
  // misclassified as an invalid operation result after the image is saved.
  const outputs = Array.isArray(payload?.result?.outputs) ? payload.result.outputs : [];
  return {
    ...payload,
    assets: Array.isArray(payload?.assets) ? payload.assets : outputs,
  };
}
