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
