const GENERATED_IMAGE_HISTORY_SOURCES = new Set(['chat', 'image-card', 'archive']);

function toSafeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function toSafePositiveNumber(value) {
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

function toSafePositiveInteger(value) {
  return Number.isInteger(value) && value > 0 ? value : undefined;
}

export function buildGeneratedHistorySlotReferenceId(slotId) {
  const normalizedSlotId = toSafeString(slotId);
  return normalizedSlotId ? `task-slot:${normalizedSlotId}` : '';
}

function getImageCardOutputEntries(item) {
  const normalizedOutputs = Array.isArray(item?.imageOutputs) ? item.imageOutputs : [];
  const validOutputs = normalizedOutputs.flatMap((output) => {
    const src = toSafeString(output?.src);
    if (!src) {
      return [];
    }

    return [{
      src,
      naturalWidth: toSafePositiveNumber(output?.naturalWidth),
      naturalHeight: toSafePositiveNumber(output?.naturalHeight),
    }];
  });

  if (validOutputs.length > 0) {
    return validOutputs;
  }

  const fallbackSrc = toSafeString(item?.src);
  if (!fallbackSrc) {
    return [];
  }

  return [{
    src: fallbackSrc,
    naturalWidth: toSafePositiveNumber(item?.naturalWidth),
    naturalHeight: toSafePositiveNumber(item?.naturalHeight),
  }];
}

export function extractGeneratedImageTimestampFromFilename(filename) {
  const normalizedFilename = toSafeString(filename);
  if (!normalizedFilename) {
    return null;
  }

  const match = normalizedFilename.match(/-(\d{10,})-[^.]+\.[a-z0-9]+$/i);
  if (!match) {
    return null;
  }

  const timestamp = Number(match[1]);
  return Number.isFinite(timestamp) && timestamp > 0 ? timestamp : null;
}

export function buildGeneratedImageHistorySortKey(timestamp, sequence = 0) {
  const safeTimestamp = Number.isFinite(timestamp) && timestamp > 0 ? timestamp : 0;
  const safeSequence = Number.isFinite(sequence) && sequence >= 0 ? sequence : 0;
  return safeTimestamp * 1000 + safeSequence;
}

export function normalizeGeneratedImageHistory(entries) {
  if (!Array.isArray(entries) || entries.length === 0) {
    return [];
  }

  return entries.flatMap((entry, index) => {
    const src = toSafeString(entry?.src);
    if (!src) {
      return [];
    }

    const createdAt = toSafePositiveNumber(entry?.createdAt) ?? 0;
    const source = GENERATED_IMAGE_HISTORY_SOURCES.has(entry?.source) ? entry.source : 'archive';
    const id = toSafeString(entry?.id) || `generated-history-${createdAt || 'unknown'}-${index}`;

    return [{
      id,
      src,
      plannerPreviewSrc: toSafeString(entry?.plannerPreviewSrc) || src,
      createdAt,
      source,
      sessionId: toSafeString(entry?.sessionId) || undefined,
      naturalWidth: toSafePositiveNumber(entry?.naturalWidth),
      naturalHeight: toSafePositiveNumber(entry?.naturalHeight),
      sourceItemId: toSafeString(entry?.sourceItemId) || undefined,
      topicId: toSafeString(entry?.topicId) || undefined,
      messageId: toSafeString(entry?.messageId) || undefined,
      ...(toSafeString(entry?.taskId) ? { taskId: toSafeString(entry.taskId) } : {}),
      ...(toSafePositiveInteger(entry?.contractVersion) ? { contractVersion: entry.contractVersion } : {}),
      ...(toSafeString(entry?.batchId) ? { batchId: toSafeString(entry.batchId) } : {}),
      ...(toSafeString(entry?.slotId) ? { slotId: toSafeString(entry.slotId) } : {}),
      ...(toSafeString(entry?.versionId) ? { versionId: toSafeString(entry.versionId) } : {}),
      ...(toSafeString(entry?.parentVersionId) ? { parentVersionId: toSafeString(entry.parentVersionId) } : {}),
      ...(entry?.operation === 'edit' || entry?.operation === 'generate' ? { operation: entry.operation } : {}),
      ...(toSafeString(entry?.sourceReferenceId) ? { sourceReferenceId: toSafeString(entry.sourceReferenceId) } : {}),
      ...(toSafeString(entry?.sourceTaskId) ? { sourceTaskId: toSafeString(entry.sourceTaskId) } : {}),
      ...(toSafeString(entry?.sourceVersionId) ? { sourceVersionId: toSafeString(entry.sourceVersionId) } : {}),
      ...(toSafeString(entry?.providerId) ? { providerId: toSafeString(entry.providerId) } : {}),
      ...(toSafeString(entry?.model) ? { model: toSafeString(entry.model) } : {}),
      ...(entry?.promptTrace
        && typeof entry.promptTrace === 'object'
        && toSafeString(entry.promptTrace.sourcePrompt)
        && toSafeString(entry.promptTrace.finalPrompt)
        && (entry.promptTrace.operation === 'generate' || entry.promptTrace.operation === 'edit')
        ? {
            promptTrace: {
              sourcePrompt: entry.promptTrace.sourcePrompt,
              finalPrompt: entry.promptTrace.finalPrompt,
              optimized: entry.promptTrace.optimized === true,
              operation: entry.promptTrace.operation,
              targetReferenceId: toSafeString(entry.promptTrace.targetReferenceId) || null,
            },
          }
        : {}),
    }];
  });
}

export function appendGeneratedImageHistoryEntries(existingEntries, nextEntries) {
  return appendMissingGeneratedHistoryEntries(existingEntries, nextEntries);
}

export function mergeGeneratedHistoryReferences(currentReferences, selectedSources, maxCount = 14) {
  const safeMaxCount = Number.isFinite(maxCount) ? Math.max(0, Math.floor(maxCount)) : 14;
  const mergedReferences = [];
  const seenSources = new Set();

  const appendUniqueSources = (sources) => {
    if (!Array.isArray(sources)) {
      return;
    }

    sources.forEach((source) => {
      const normalizedSource = toSafeString(source);
      if (!normalizedSource || seenSources.has(normalizedSource) || mergedReferences.length >= safeMaxCount) {
        return;
      }

      seenSources.add(normalizedSource);
      mergedReferences.push(normalizedSource);
    });
  };

  appendUniqueSources(currentReferences);
  appendUniqueSources(selectedSources);
  return mergedReferences;
}

export function appendMissingGeneratedHistoryEntries(existingEntries, nextEntries) {
  const normalizedExisting = normalizeGeneratedImageHistory(existingEntries);
  const normalizedNext = normalizeGeneratedImageHistory(nextEntries);
  if (normalizedNext.length === 0) {
    return normalizedExisting;
  }

  const seenIds = new Set(normalizedExisting.map((entry) => entry.id));
  const seenVersionIds = new Set(normalizedExisting.flatMap((entry) => (
    entry.topicId && entry.taskId && entry.versionId ? [`${entry.topicId}:${entry.taskId}:${entry.versionId}`] : []
  )));
  const seenLegacySrcs = new Set(normalizedExisting.flatMap((entry) => (
    entry.topicId && entry.taskId && entry.versionId ? [] : [entry.src]
  )));
  const appendedEntries = normalizedNext.filter((entry) => {
    const versionKey = entry.topicId && entry.taskId && entry.versionId
      ? `${entry.topicId}:${entry.taskId}:${entry.versionId}`
      : '';
    if (seenIds.has(entry.id) || (versionKey ? seenVersionIds.has(versionKey) : seenLegacySrcs.has(entry.src))) {
      return false;
    }

    seenIds.add(entry.id);
    if (versionKey) seenVersionIds.add(versionKey);
    else seenLegacySrcs.add(entry.src);
    return true;
  });

  return [...normalizedExisting, ...appendedEntries];
}

export function buildGeneratedHistoryEntriesFromImageCard({
  item,
  sourceItemId,
  createdAt = Date.now(),
}) {
  const normalizedSourceItemId = toSafeString(sourceItemId) || toSafeString(item?.id) || 'image-card';
  const safeCreatedAt = toSafePositiveNumber(createdAt) ?? Date.now();
  const outputEntries = getImageCardOutputEntries(item);

  return outputEntries.map((output, index) => ({
    id: `generated-history:${normalizedSourceItemId}:${index}:${output.src}`,
    src: output.src,
    plannerPreviewSrc: output.src,
    createdAt: buildGeneratedImageHistorySortKey(safeCreatedAt, index),
    source: 'image-card',
    sourceItemId: normalizedSourceItemId,
    naturalWidth: output.naturalWidth,
    naturalHeight: output.naturalHeight,
  }));
}

export function mergeGeneratedImageHistoryEntries({
  sessionEntries,
  fallbackEntries,
  archiveEntries,
}) {
  const normalizedSessionEntries = normalizeGeneratedImageHistory(sessionEntries);
  const normalizedFallbackEntries = normalizeGeneratedImageHistory(fallbackEntries);
  const normalizedArchiveEntries = normalizeGeneratedImageHistory(archiveEntries);

  const mergedEntries = [];
  const seenKeys = new Set();

  const appendUnique = (entries) => {
    entries.forEach((entry) => {
      const key = entry.topicId && entry.taskId && entry.versionId
        ? `version:${entry.topicId}:${entry.taskId}:${entry.versionId}`
        : `src:${entry.src}`;
      if (seenKeys.has(key)) {
        return;
      }

      seenKeys.add(key);
      mergedEntries.push(entry);
    });
  };

  appendUnique(normalizedSessionEntries);
  appendUnique(normalizedFallbackEntries);
  appendUnique(normalizedArchiveEntries);

  return mergedEntries.sort((a, b) => {
    if (b.createdAt !== a.createdAt) {
      return b.createdAt - a.createdAt;
    }

    return String(b.id).localeCompare(String(a.id));
  });
}

export function selectTopicActiveTaskSnapshot(messages, topicId) {
  const normalizedTopicId = toSafeString(topicId);
  if (!normalizedTopicId || !Array.isArray(messages)) return null;

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    const snapshot = message?.role === 'assistant' ? message.taskSnapshot : null;
    if (
      toSafeString(snapshot?.topicId) === normalizedTopicId
      && toSafeString(snapshot?.taskId)
      && toSafePositiveInteger(snapshot?.contractVersion)
      && snapshot?.contract
      && typeof snapshot.contract === 'object'
      && Array.isArray(snapshot?.activeVersions)
    ) {
      return snapshot;
    }
  }

  return null;
}

function taskHistoryEntries(entries, topicId, taskId) {
  const normalizedTopicId = toSafeString(topicId);
  const normalizedTaskId = toSafeString(taskId);
  if (!normalizedTopicId || !normalizedTaskId) return [];
  return normalizeGeneratedImageHistory(entries).filter((entry) => (
    entry.topicId === normalizedTopicId && entry.taskId === normalizedTaskId
  ));
}

export function selectLatestGeneratedImageBatch(entries, { topicId, taskId, latestBatchId } = {}) {
  const matchingEntries = taskHistoryEntries(entries, topicId, taskId).filter((entry) => entry.batchId);
  const requestedBatchId = toSafeString(latestBatchId);
  if (requestedBatchId) {
    const requestedEntries = matchingEntries.filter((entry) => entry.batchId === requestedBatchId);
    return requestedEntries.length > 0 ? { batchId: requestedBatchId, entries: requestedEntries } : null;
  }
  if (matchingEntries.length === 0) return null;

  const latestEntry = matchingEntries.reduce((latest, entry) => (
    !latest || entry.createdAt >= latest.createdAt ? entry : latest
  ), null);
  return {
    batchId: latestEntry.batchId,
    entries: matchingEntries.filter((entry) => entry.batchId === latestEntry.batchId),
  };
}

export function selectActiveGeneratedImageSlotVersions(entries, options = {}) {
  const latestBatch = selectLatestGeneratedImageBatch(entries, options);
  if (!latestBatch) return [];

  const latestBySlot = new Map();
  latestBatch.entries.forEach((entry) => {
    if (!entry.slotId || !entry.versionId) return;
    const previous = latestBySlot.get(entry.slotId);
    if (!previous || entry.createdAt >= previous.createdAt) latestBySlot.set(entry.slotId, entry);
  });
  const safeLimit = Number.isFinite(options.maxActiveVersions)
    ? Math.min(9, Math.max(0, Math.floor(options.maxActiveVersions)))
    : 9;
  return Array.from(latestBySlot.values()).slice(0, safeLimit);
}

/**
 * @param {{
 *   topicId?: string,
 *   messages?: Array<any>,
 *   taskSnapshot?: any,
 *   historyEntries?: Array<any>,
 *   maxActiveVersions?: number,
 * }} [options]
 */
export function buildActiveTaskContext({ topicId, messages, taskSnapshot, historyEntries, maxActiveVersions = 9 } = {}) {
  const normalizedTopicId = toSafeString(topicId);
  const snapshot = taskSnapshot || selectTopicActiveTaskSnapshot(messages, normalizedTopicId);
  if (!snapshot || snapshot.topicId !== normalizedTopicId) return null;

  const taskId = toSafeString(snapshot.taskId);
  const contractVersion = toSafePositiveInteger(snapshot.contractVersion);
  const activeVersions = Array.isArray(snapshot.activeVersions) ? snapshot.activeVersions : [];
  const safeLimit = Number.isFinite(maxActiveVersions)
    ? Math.min(9, Math.max(0, Math.floor(maxActiveVersions)))
    : 9;
  if (!taskId || !contractVersion || !snapshot.contract || typeof snapshot.contract !== 'object') return null;
  const topicHistory = normalizeGeneratedImageHistory(historyEntries).filter((entry) => entry.topicId === normalizedTopicId);
  const matchingHistory = topicHistory.filter((entry) => entry.taskId === taskId);
  const entryByVersionId = new Map(matchingHistory.flatMap((entry) => (
    entry.versionId ? [[entry.versionId, entry]] : []
  )));
  const topicEntryByVersionId = new Map(topicHistory.flatMap((entry) => (
    entry.versionId ? [[entry.versionId, entry]] : []
  )));
  const latestBatchId = toSafeString(snapshot.latestBatchId);
  const editBaseVersionId = toSafeString(snapshot.editBaseVersionId);
  const editBaseEntry = editBaseVersionId ? topicEntryByVersionId.get(editBaseVersionId) : null;
  if (latestBatchId ? activeVersions.length === 0 : activeVersions.length > 0) return null;
  if (latestBatchId && activeVersions.some((version) => toSafeString(version?.batchId) !== latestBatchId)) return null;
  if (editBaseVersionId && (!editBaseEntry?.batchId || !editBaseEntry?.slotId)) return null;
  const contractImageTask = snapshot.contract?.imageTask;
  if (
    editBaseEntry
    && contractImageTask?.operation === 'edit'
    && toSafeString(contractImageTask.targetReferenceId)
    && toSafeString(contractImageTask.targetReferenceId) !== buildGeneratedHistorySlotReferenceId(editBaseEntry.slotId)
  ) return null;
  if (
    editBaseEntry
    && editBaseEntry.taskId !== taskId
    && activeVersions.length > 0
    && !activeVersions.some((version) => (
      toSafeString(version?.batchId) === editBaseEntry.batchId
      && toSafeString(version?.slotId) === editBaseEntry.slotId
    ))
  ) return null;

  const slots = activeVersions.slice(0, safeLimit).flatMap((activeVersion) => {
    const versionId = toSafeString(activeVersion?.versionId);
    const batchId = toSafeString(activeVersion?.batchId);
    const slotId = toSafeString(activeVersion?.slotId);
    const referenceId = toSafeString(activeVersion?.referenceId);
    const entry = entryByVersionId.get(versionId);
    if (
      !entry
      || entry.batchId !== batchId
      || entry.slotId !== slotId
      || referenceId !== buildGeneratedHistorySlotReferenceId(slotId)
    ) return [];

    return [{
      referenceId,
      slotId,
      versionId,
      ...(entry.parentVersionId ? { parentVersionId: entry.parentVersionId } : {}),
      src: entry.src,
      plannerPreviewSrc: entry.plannerPreviewSrc,
    }];
  });
  if (slots.length !== activeVersions.slice(0, safeLimit).length) return null;

  return {
    topicId: normalizedTopicId,
    taskId,
    contractVersion,
    contract: snapshot.contract,
    ...(editBaseVersionId ? { editBaseVersionId } : {}),
    ...(editBaseEntry ? {
      editBaseAsset: {
        versionId: editBaseVersionId,
        batchId: editBaseEntry.batchId,
        slotId: editBaseEntry.slotId,
        src: editBaseEntry.src,
        plannerPreviewSrc: editBaseEntry.plannerPreviewSrc,
        ...(editBaseEntry.parentVersionId ? { parentVersionId: editBaseEntry.parentVersionId } : {}),
      },
    } : {}),
    latestBatch: latestBatchId ? { batchId: latestBatchId, slots } : null,
  };
}

export const buildStableSlotReferenceId = buildGeneratedHistorySlotReferenceId;
export const selectLatestTaskBatch = selectLatestGeneratedImageBatch;
export const selectActiveTaskSlotVersions = selectActiveGeneratedImageSlotVersions;
