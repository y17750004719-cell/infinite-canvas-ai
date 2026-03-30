const GENERATED_IMAGE_HISTORY_SOURCES = new Set(['chat', 'image-card', 'archive']);

function toSafeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function toSafePositiveNumber(value) {
  return Number.isFinite(value) && value > 0 ? value : undefined;
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
  const normalizedExisting = normalizeGeneratedImageHistory(existingEntries);
  const normalizedNext = normalizeGeneratedImageHistory(nextEntries);
  if (normalizedNext.length === 0) {
    return normalizedExisting;
  }

  const seenIds = new Set(normalizedExisting.map((entry) => entry.id));
  const appendedEntries = normalizedNext.filter((entry) => {
    if (seenIds.has(entry.id)) {
      return false;
    }

    seenIds.add(entry.id);
    return true;
  });

  return [...normalizedExisting, ...appendedEntries];
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
