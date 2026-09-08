const SUPPORTED_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
const SUPPORTED_SOURCES = new Set(['upload', 'canvas', 'generated']);

const text = (value) => typeof value === 'string' ? value.trim() : '';

/**
 * Normalize the small IndexedDB-safe metadata records without importing the
 * server-only filesystem implementation used to materialize assets.
 * @param {unknown} entries
 * @param {{sessionId?: string, maxItems?: number}} [options]
 */
export function normalizeSessionVisualAssets(entries, { sessionId, maxItems = 200 } = {}) {
  const normalizedSessionId = text(sessionId);
  if (!normalizedSessionId || !Array.isArray(entries)) return [];
  const limit = Number.isFinite(maxItems) ? Math.max(0, Math.floor(maxItems)) : 200;
  const seen = new Set();
  return entries.slice(0, limit).map((entry) => {
    if (!entry || typeof entry !== 'object') return null;
    if (text(entry.sessionId) !== normalizedSessionId) return null;
    const id = text(entry.id);
    const durableSrc = text(entry.durableSrc);
    const contentHash = text(entry.contentHash);
    const mimeType = text(entry.mimeType).toLowerCase();
    const source = SUPPORTED_SOURCES.has(entry.source) ? entry.source : null;
    if (!id || !durableSrc || !/^[a-f0-9]{64}$/i.test(contentHash) || !SUPPORTED_MIME_TYPES.has(mimeType) || !source || seen.has(id)) return null;
    seen.add(id);
    return {
      id,
      sessionId: normalizedSessionId,
      durableSrc,
      previewSrc: text(entry.previewSrc) || undefined,
      originalSrc: text(entry.originalSrc) || undefined,
      contentHash: contentHash.toLowerCase(),
      mimeType,
      byteSize: Number.isFinite(Number(entry.byteSize)) ? Math.max(0, Math.floor(Number(entry.byteSize))) : 0,
      naturalWidth: Number.isFinite(Number(entry.naturalWidth)) ? Math.max(0, Math.floor(Number(entry.naturalWidth))) : undefined,
      naturalHeight: Number.isFinite(Number(entry.naturalHeight)) ? Math.max(0, Math.floor(Number(entry.naturalHeight))) : undefined,
      source,
      sourceReferenceId: text(entry.sourceReferenceId) || undefined,
      taskId: text(entry.taskId) || undefined,
      batchId: text(entry.batchId) || undefined,
      versionId: text(entry.versionId) || undefined,
      createdAt: Number.isFinite(Number(entry.createdAt)) ? Number(entry.createdAt) : 0,
    };
  }).filter(Boolean);
}
