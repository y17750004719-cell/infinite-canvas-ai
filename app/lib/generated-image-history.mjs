const GENERATED_IMAGE_HISTORY_SOURCES = new Set(['chat', 'image-card', 'archive']);

function toSafeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function toSafePositiveNumber(value) {
  return Number.isFinite(value) && value > 0 ? value : undefined;
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
      createdAt,
      source,
      sessionId: toSafeString(entry?.sessionId) || undefined,
      naturalWidth: toSafePositiveNumber(entry?.naturalWidth),
      naturalHeight: toSafePositiveNumber(entry?.naturalHeight),
      sourceItemId: toSafeString(entry?.sourceItemId) || undefined,
      topicId: toSafeString(entry?.topicId) || undefined,
      messageId: toSafeString(entry?.messageId) || undefined,
    }];
  });
}

export function appendGeneratedImageHistoryEntries(existingEntries, nextEntries) {
  return appendMissingGeneratedHistoryEntries(existingEntries, nextEntries);
}

export function appendMissingGeneratedHistoryEntries(existingEntries, nextEntries) {
  const normalizedExisting = normalizeGeneratedImageHistory(existingEntries);
  const normalizedNext = normalizeGeneratedImageHistory(nextEntries);
  if (normalizedNext.length === 0) {
    return normalizedExisting;
  }

  const seenIds = new Set(normalizedExisting.map((entry) => entry.id));
  const seenSrcs = new Set(normalizedExisting.map((entry) => entry.src));
  const appendedEntries = normalizedNext.filter((entry) => {
    if (seenIds.has(entry.id) || seenSrcs.has(entry.src)) {
      return false;
    }

    seenIds.add(entry.id);
    seenSrcs.add(entry.src);
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
    createdAt: safeCreatedAt + index,
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
  const seenSrcs = new Set();

  const appendBySrc = (entries) => {
    entries.forEach((entry) => {
      if (seenSrcs.has(entry.src)) {
        return;
      }

      seenSrcs.add(entry.src);
      mergedEntries.push(entry);
    });
  };

  appendBySrc(normalizedSessionEntries);
  appendBySrc(normalizedFallbackEntries);
  appendBySrc(normalizedArchiveEntries);

  return mergedEntries.sort((a, b) => {
    if (b.createdAt !== a.createdAt) {
      return b.createdAt - a.createdAt;
    }

    return String(b.id).localeCompare(String(a.id));
  });
}
