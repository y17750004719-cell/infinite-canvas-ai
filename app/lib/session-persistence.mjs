import { normalizeGeneratedImageHistory } from './generated-image-history.mjs';

const isRecord = (value) => typeof value === 'object' && value !== null;
const cloneValue = (value) => {
  if (typeof globalThis.structuredClone === 'function') {
    return globalThis.structuredClone(value);
  }

  return JSON.parse(JSON.stringify(value));
};

const normalizeConnections = (connections, items) => {
  if (!Array.isArray(connections)) return [];

  const validIds = new Set(
    (Array.isArray(items) ? items : [])
      .map((item) => (isRecord(item) ? item.id : null))
      .filter(Boolean)
  );

  return connections.filter(
    (connection) =>
      isRecord(connection) &&
      typeof connection.id === 'string' &&
      validIds.has(connection.fromItemId) &&
      validIds.has(connection.toItemId)
  );
};

export function normalizeTextCardPanelDrafts(drafts, items) {
  if (!isRecord(drafts)) return {};

  const validTextCardIds = new Set(
    (Array.isArray(items) ? items : [])
      .filter(
        (item) =>
          isRecord(item) &&
          typeof item.id === 'string' &&
          item.type === 'text' &&
          item.textVariant === 'card'
      )
      .map((item) => item.id)
  );

  return Object.entries(drafts).reduce((result, [itemId, value]) => {
    if (!validTextCardIds.has(itemId)) return result;
    if (typeof value !== 'string') return result;
    if (value.trim().length === 0) return result;

    result[itemId] = value;
    return result;
  }, {});
}

function getValidImageCardIds(items) {
  return new Set(
    (Array.isArray(items) ? items : [])
      .filter(
        (item) =>
          isRecord(item) &&
          typeof item.id === 'string' &&
          item.type === 'image' &&
          item.imageVariant === 'card'
      )
      .map((item) => item.id)
  );
}

export function normalizeImageCardPanelDrafts(drafts, items) {
  if (!isRecord(drafts)) return {};

  const validImageCardIds = getValidImageCardIds(items);

  return Object.entries(drafts).reduce((result, [itemId, value]) => {
    if (!validImageCardIds.has(itemId)) return result;
    if (typeof value !== 'string') return result;
    if (value.trim().length === 0) return result;

    result[itemId] = value;
    return result;
  }, {});
}

export function normalizeImageCardModelById(values, items) {
  if (!isRecord(values)) return {};

  const validImageCardIds = getValidImageCardIds(items);
  return Object.entries(values).reduce((result, [itemId, value]) => {
    if (!validImageCardIds.has(itemId)) return result;
    if (typeof value !== 'string' || value.trim().length === 0) return result;

    result[itemId] = value.trim();
    return result;
  }, {});
}

export function normalizeImageCardProviderById(values, items) {
  if (!isRecord(values)) return {};

  const validImageCardIds = getValidImageCardIds(items);
  return Object.entries(values).reduce((result, [itemId, value]) => {
    if (!validImageCardIds.has(itemId)) return result;
    if (typeof value !== 'string' || value.trim().length === 0) return result;

    result[itemId] = value.trim();
    return result;
  }, {});
}

export function normalizeImageCardSizeById(values, items) {
  if (!isRecord(values)) return {};

  const validImageCardIds = getValidImageCardIds(items);
  return Object.entries(values).reduce((result, [itemId, value]) => {
    if (!validImageCardIds.has(itemId)) return result;
    if (typeof value !== 'string' || value.trim().length === 0) return result;

    result[itemId] = value.trim();
    return result;
  }, {});
}

export function normalizeImageCardQualityById(values, items) {
  if (!isRecord(values)) return {};

  const validImageCardIds = getValidImageCardIds(items);
  return Object.entries(values).reduce((result, [itemId, value]) => {
    if (!validImageCardIds.has(itemId)) return result;
    if (typeof value !== 'string' || value.trim().length === 0) return result;

    result[itemId] = value.trim();
    return result;
  }, {});
}

export function normalizeImageCardCountById(values, items) {
  if (!isRecord(values)) return {};

  const validImageCardIds = getValidImageCardIds(items);
  return Object.entries(values).reduce((result, [itemId, value]) => {
    if (!validImageCardIds.has(itemId)) return result;
    if (!Number.isFinite(value) || value <= 0) return result;

    result[itemId] = value;
    return result;
  }, {});
}

export function normalizeImageCardAspectRatioById(values, items) {
  if (!isRecord(values)) return {};

  const validImageCardIds = getValidImageCardIds(items);
  return Object.entries(values).reduce((result, [itemId, value]) => {
    if (!validImageCardIds.has(itemId)) return result;
    if (typeof value !== 'string' || value.trim().length === 0) return result;

    result[itemId] = value.trim();
    return result;
  }, {});
}

export function normalizeProjectSession(session) {
  const normalizedItems = Array.isArray(session?.items) ? session.items : [];

  return {
    ...session,
    items: normalizedItems,
    connections: normalizeConnections(session?.connections, normalizedItems),
    textCardPanelDrafts: normalizeTextCardPanelDrafts(session?.textCardPanelDrafts, normalizedItems),
    imageCardPanelDrafts: normalizeImageCardPanelDrafts(session?.imageCardPanelDrafts, normalizedItems),
    imageCardProviderById: normalizeImageCardProviderById(session?.imageCardProviderById, normalizedItems),
    imageCardModelById: normalizeImageCardModelById(session?.imageCardModelById, normalizedItems),
    imageCardSizeById: normalizeImageCardSizeById(session?.imageCardSizeById, normalizedItems),
    imageCardQualityById: normalizeImageCardQualityById(session?.imageCardQualityById, normalizedItems),
    imageCardCountById: normalizeImageCardCountById(session?.imageCardCountById, normalizedItems),
    imageCardAspectRatioById: normalizeImageCardAspectRatioById(session?.imageCardAspectRatioById, normalizedItems),
    generatedImageHistory: normalizeGeneratedImageHistory(session?.generatedImageHistory),
  };
}

export function buildPersistedSession(session, patch) {
  const nextSession = {
    ...session,
    ...patch,
  };

  const normalizedItems = Array.isArray(nextSession.items) ? cloneValue(nextSession.items) : [];
  const normalizedConnections = cloneValue(normalizeConnections(nextSession.connections, normalizedItems));
  const normalizedTextCardPanelDrafts = cloneValue(
    normalizeTextCardPanelDrafts(nextSession.textCardPanelDrafts, normalizedItems)
  );
  const normalizedImageCardPanelDrafts = cloneValue(
    normalizeImageCardPanelDrafts(nextSession.imageCardPanelDrafts, normalizedItems)
  );
  const normalizedImageCardModelById = cloneValue(
    normalizeImageCardModelById(nextSession.imageCardModelById, normalizedItems)
  );
  const normalizedImageCardProviderById = cloneValue(
    normalizeImageCardProviderById(nextSession.imageCardProviderById, normalizedItems)
  );
  const normalizedImageCardSizeById = cloneValue(
    normalizeImageCardSizeById(nextSession.imageCardSizeById, normalizedItems)
  );
  const normalizedImageCardQualityById = cloneValue(
    normalizeImageCardQualityById(nextSession.imageCardQualityById, normalizedItems)
  );
  const normalizedImageCardCountById = cloneValue(
    normalizeImageCardCountById(nextSession.imageCardCountById, normalizedItems)
  );
  const normalizedImageCardAspectRatioById = cloneValue(
    normalizeImageCardAspectRatioById(nextSession.imageCardAspectRatioById, normalizedItems)
  );
  const normalizedGeneratedImageHistory = cloneValue(
    normalizeGeneratedImageHistory(nextSession.generatedImageHistory)
  );

  return {
    ...nextSession,
    items: normalizedItems,
    connections: normalizedConnections,
    textCardPanelDrafts: normalizedTextCardPanelDrafts,
    imageCardPanelDrafts: normalizedImageCardPanelDrafts,
    imageCardProviderById: normalizedImageCardProviderById,
    imageCardModelById: normalizedImageCardModelById,
    imageCardSizeById: normalizedImageCardSizeById,
    imageCardQualityById: normalizedImageCardQualityById,
    imageCardCountById: normalizedImageCardCountById,
    imageCardAspectRatioById: normalizedImageCardAspectRatioById,
    generatedImageHistory: normalizedGeneratedImageHistory,
    viewport: isRecord(nextSession.viewport) ? cloneValue(nextSession.viewport) : nextSession.viewport,
    messages: Array.isArray(nextSession.messages) ? cloneValue(nextSession.messages) : nextSession.messages,
    topics: Array.isArray(nextSession.topics) ? cloneValue(nextSession.topics) : nextSession.topics,
  };
}

export function shouldFlushScheduledSessionSave({
  scheduledSessionId,
  scheduledEpoch,
  currentSessionId,
  currentEpoch,
  sessions,
  hasPendingMutation = false,
}) {
  if (hasPendingMutation) return false;
  if (!scheduledSessionId || scheduledSessionId !== currentSessionId) return false;
  if (scheduledEpoch !== currentEpoch) return false;

  return Array.isArray(sessions) && sessions.some((session) => session?.id === scheduledSessionId);
}
