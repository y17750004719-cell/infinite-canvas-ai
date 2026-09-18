import { randomUUID } from 'node:crypto';
import { normalizeAgentConversationMemory } from '../chat-message-persistence.mjs';
import { normalizeAgentRecoveryRecord } from './recovery.mjs';
import { createAgentStreamOrchestrator } from './agent-stream-orchestrator.mjs';
import { enrichGeneratedAssetDeliveryAction } from './generated-asset-delivery.mjs';

export function createAgentEventWriter({ threadJournal, encoder = new TextEncoder() }) {
  const journalContexts = new WeakMap();
  const eventSinks = new WeakMap();
  const writeEvent = (controller, event) => {
    const context = journalContexts.get(controller);
    if (!context) return;
    let sink = eventSinks.get(controller);
    if (!sink) {
      sink = createAgentStreamOrchestrator({
        journal: threadJournal,
        streamController: controller,
        context,
        encoder,
        onError: () => undefined,
      });
      eventSinks.set(controller, sink);
    }
    void sink.publish(event).catch(() => undefined);
  };
  return { journalContexts, eventSinks, writeEvent };
}

export function normalizeRecentFailedTask(value, messages) {
  if (!value || typeof value !== 'object') return null;
  const normalized = normalizeAgentRecoveryRecord(value);
  if (!normalized) return null;
  const sourceExists = (messages || []).some((message) =>
    message.role === 'user' && message.id === normalized.sourceUserMessageId);
  return sourceExists ? normalized : null;
}

export function mergeTopicMemory(previous, patch, messages) {
  const current = normalizeAgentConversationMemory(previous) || {
    version: 1,
    recentRawConversation: [],
    rollingSummary: '',
    facts: [],
    preferences: [],
    activeTask: null,
    recentReferencedAssetIds: [],
    updatedAt: Date.now(),
  };
  const candidate = patch && typeof patch === 'object' ? patch : {};
  const newestUnique = (currentValues, nextValues, limit) => Array.from(new Set([
    ...currentValues,
    ...nextValues.filter((value) => typeof value === 'string').map((value) => value.trim()).filter(Boolean),
  ])).slice(-limit);
  const merged = {
    ...current,
    ...(typeof candidate.rollingSummary === 'string' ? { rollingSummary: candidate.rollingSummary } : {}),
    ...(Array.isArray(candidate.facts) ? { facts: newestUnique(current.facts, candidate.facts, 24) } : {}),
    ...(Array.isArray(candidate.preferences) ? { preferences: newestUnique(current.preferences, candidate.preferences, 16) } : {}),
    ...(Object.hasOwn(candidate, 'activeTask') ? { activeTask: candidate.activeTask } : {}),
    ...(Array.isArray(candidate.recentReferencedAssetIds)
      ? { recentReferencedAssetIds: newestUnique(current.recentReferencedAssetIds, candidate.recentReferencedAssetIds, 20) } : {}),
    recentRawConversation: (Array.isArray(messages) ? messages : []).slice(-20),
    updatedAt: Date.now(),
  };
  return normalizeAgentConversationMemory(merged) || current;
}

export function generatedAssetsFromResult(payload) {
  const result = payload?.result || {};
  if (Array.isArray(result.outputs) && result.outputs.length > 0) {
    return result.outputs
      .filter((item) => typeof item?.localUrl === 'string' || typeof item?.url === 'string')
      .map((item) => ({
        src: item.localUrl || item.url,
        ...(typeof item.assetId === 'string' ? { assetId: item.assetId } : {}),
        ...(typeof item.previewSrc === 'string' ? { previewSrc: item.previewSrc } : {}),
        naturalWidth: item.naturalWidth,
        naturalHeight: item.naturalHeight,
      }));
  }
  const src = result.localUrl || result.data?.[0]?.url;
  return typeof src === 'string'
    ? [{ src, ...(typeof result.outputs?.[0]?.assetId === 'string' ? { assetId: result.outputs[0].assetId } : {}) }]
    : [];
}

export function enrichGeneratedAssetEvents(events, payload) {
  const outputs = Array.isArray(payload?.result?.outputs) ? payload.result.outputs : [];
  return events.map((event) => {
    if (event?.type !== 'client_action' || event.action?.type !== 'add_generated_assets') return event;
    return {
      ...event,
      action: enrichGeneratedAssetDeliveryAction({
        ...event.action,
        ...(typeof payload?.taskId === 'string' ? { taskId: payload.taskId } : {}),
        ...(positiveInteger(payload?.contractVersion) ? { contractVersion: positiveInteger(payload.contractVersion) } : {}),
        ...(typeof payload?.batchId === 'string' ? { batchId: payload.batchId } : {}),
        ...(typeof payload?.sourceTaskId === 'string' ? { sourceTaskId: payload.sourceTaskId } : {}),
        ...(typeof payload?.sourceVersionId === 'string' ? { sourceVersionId: payload.sourceVersionId } : {}),
        assets: event.action.assets.map((asset, index) => ({
          ...asset,
          ...(typeof outputs[index]?.assetId === 'string' ? { assetId: outputs[index].assetId } : {}),
          ...(typeof outputs[index]?.slotId === 'string' ? { slotId: outputs[index].slotId } : {}),
          ...(typeof outputs[index]?.versionId === 'string' ? { versionId: outputs[index].versionId } : {}),
          ...(typeof outputs[index]?.parentVersionId === 'string' ? { parentVersionId: outputs[index].parentVersionId } : {}),
          ...(typeof outputs[index]?.previewSrc === 'string' ? { previewSrc: outputs[index].previewSrc } : {}),
          ...(Number.isFinite(outputs[index]?.providerReturnedAt) ? { providerReturnedAt: outputs[index].providerReturnedAt } : {}),
          ...(Number.isFinite(outputs[index]?.locallyStoredAt) ? { locallyStoredAt: outputs[index].locallyStoredAt } : {}),
        })),
      }),
    };
  });
}

export function positiveInteger(value) {
  const count = Number(value);
  return Number.isFinite(count) && count > 0 ? Math.floor(count) : null;
}

export function reserveTaskExecution(contract, imageTask, outputCount, referenceContext, existingTaskId = null) {
  const taskId = existingTaskId || randomUUID();
  const contractVersion = 1;
  if (contract.execution.kind !== 'image_pipeline') {
    return { taskId, contractVersion, contract, latestBatchId: null, identities: [], sourceTaskId: null, sourceVersionId: null, editBaseVersionId: null };
  }
  const batchId = randomUUID();
  const sourceReferenceId = imageTask?.operation === 'edit' ? imageTask.targetReferenceId : imageTask?.sourceReferenceId;
  const sourceReference = sourceReferenceId ? referenceContext?.references.find((reference) => reference.id === sourceReferenceId) : undefined;
  const parentVersionId = sourceReference?.sourceVersionId;
  const editBaseVersionId = imageTask?.operation === 'edit' ? parentVersionId || null : null;
  const identities = Array.from({ length: outputCount }, () => {
    const slotId = randomUUID();
    return { referenceId: `task-slot:${slotId}`, batchId, slotId, versionId: randomUUID(), ...(parentVersionId ? { parentVersionId } : {}) };
  });
  return {
    taskId, contractVersion, contract, latestBatchId: batchId, identities,
    sourceTaskId: sourceReference?.sourceTaskId || null,
    sourceVersionId: sourceReference?.sourceVersionId || null,
    editBaseVersionId,
  };
}

export function createContinuationPruners(continuationState) {
  return {
    pruneConfirmationStore: (now = Date.now()) => continuationState.prune(now),
    pruneClarificationSubmissionStore: (now = Date.now()) => continuationState.prune(now),
  };
}
