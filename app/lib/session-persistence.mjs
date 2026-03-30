import { normalizeGeneratedImageHistory } from './generated-image-history.mjs';

const isRecord = (value) => typeof value === 'object' && value !== null;

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
    imageCardModelById: normalizeImageCardModelById(session?.imageCardModelById, normalizedItems),
    imageCardSizeById: normalizeImageCardSizeById(session?.imageCardSizeById, normalizedItems),
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

  return {
    ...nextSession,
    connections: normalizeConnections(nextSession.connections, nextSession.items),
    textCardPanelDrafts: normalizeTextCardPanelDrafts(nextSession.textCardPanelDrafts, nextSession.items),
    imageCardPanelDrafts: normalizeImageCardPanelDrafts(nextSession.imageCardPanelDrafts, nextSession.items),
    imageCardModelById: normalizeImageCardModelById(nextSession.imageCardModelById, nextSession.items),
    imageCardSizeById: normalizeImageCardSizeById(nextSession.imageCardSizeById, nextSession.items),
    imageCardCountById: normalizeImageCardCountById(nextSession.imageCardCountById, nextSession.items),
    imageCardAspectRatioById: normalizeImageCardAspectRatioById(nextSession.imageCardAspectRatioById, nextSession.items),
    generatedImageHistory: normalizeGeneratedImageHistory(nextSession.generatedImageHistory),
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
