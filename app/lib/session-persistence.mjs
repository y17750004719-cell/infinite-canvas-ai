import { normalizeGeneratedImageHistory } from './generated-image-history.mjs';
import { normalizeSessionChatMessages } from './chat-message-persistence.mjs';

const isRecord = (value) => typeof value === 'object' && value !== null;
const cloneValue = (value) => {
  if (typeof globalThis.structuredClone === 'function') {
    return globalThis.structuredClone(value);
  }

  return JSON.parse(JSON.stringify(value));
};

const normalizeOptionalId = (value) =>
  typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;

const normalizeRegionSelections = (regions, items) => {
  if (!Array.isArray(regions)) return [];
  const validImageIds = new Set((Array.isArray(items) ? items : [])
    .filter((item) => isRecord(item) && item.type === 'image' && typeof item.src === 'string' && item.src)
    .map((item) => item.id));
  return regions.slice(0, 50).flatMap((region) => {
    if (!isRecord(region) || typeof region.id !== 'string' || !validImageIds.has(region.imageItemId)) return [];
    const point = region.point;
    if (!isRecord(point) || !Number.isFinite(Number(point.x)) || !Number.isFinite(Number(point.y))) return [];
    const candidates = Array.isArray(region.candidates) ? region.candidates.slice(0, 5) : [];
    return [{
      ...region,
      point: { x: Math.min(1, Math.max(0, Number(point.x))), y: Math.min(1, Math.max(0, Number(point.y))) },
      ...(isRecord(region.box) ? { box: {
        x: Math.min(1, Math.max(0, Number(region.box.x) || 0)),
        y: Math.min(1, Math.max(0, Number(region.box.y) || 0)),
        width: Math.min(1, Math.max(0, Number(region.box.width) || 0)),
        height: Math.min(1, Math.max(0, Number(region.box.height) || 0)),
      } } : {}),
      candidates,
      confirmationStatus: region.confirmationStatus === 'confirmed' ? 'confirmed' : 'pending',
      recognitionRevision: Number.isFinite(Number(region.recognitionRevision))
        ? Math.max(0, Math.floor(Number(region.recognitionRevision)))
        : 0,
    }];
  });
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

  const validTextCardIds = getValidTextCardIds(items);

  return Object.entries(drafts).reduce((result, [itemId, value]) => {
    if (!validTextCardIds.has(itemId)) return result;
    if (typeof value !== 'string') return result;
    if (value.trim().length === 0) return result;

    result[itemId] = value;
    return result;
  }, {});
}

function getValidTextCardIds(items) {
  return new Set(
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
}

export function normalizeTextCardProviderById(values, items) {
  if (!isRecord(values)) return {};

  const validTextCardIds = getValidTextCardIds(items);
  return Object.entries(values).reduce((result, [itemId, value]) => {
    if (!validTextCardIds.has(itemId)) return result;
    if (typeof value !== 'string' || value.trim().length === 0) return result;

    result[itemId] = value.trim();
    return result;
  }, {});
}

export function normalizeTextCardModelById(values, items) {
  if (!isRecord(values)) return {};

  const validTextCardIds = getValidTextCardIds(items);
  return Object.entries(values).reduce((result, [itemId, value]) => {
    if (!validTextCardIds.has(itemId)) return result;
    if (typeof value !== 'string' || value.trim().length === 0) return result;

    result[itemId] = value.trim();
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
  const normalizedChat = normalizeSessionChatMessages(session);

  return {
    ...session,
    schemaVersion: 2,
    items: normalizedItems,
    connections: normalizeConnections(session?.connections, normalizedItems),
    textCardPanelDrafts: normalizeTextCardPanelDrafts(session?.textCardPanelDrafts, normalizedItems),
    textCardProviderById: normalizeTextCardProviderById(session?.textCardProviderById, normalizedItems),
    textCardModelById: normalizeTextCardModelById(session?.textCardModelById, normalizedItems),
    imageCardPanelDrafts: normalizeImageCardPanelDrafts(session?.imageCardPanelDrafts, normalizedItems),
    imageCardProviderById: normalizeImageCardProviderById(session?.imageCardProviderById, normalizedItems),
    imageCardModelById: normalizeImageCardModelById(session?.imageCardModelById, normalizedItems),
    imageCardSizeById: normalizeImageCardSizeById(session?.imageCardSizeById, normalizedItems),
    imageCardQualityById: normalizeImageCardQualityById(session?.imageCardQualityById, normalizedItems),
    imageCardCountById: normalizeImageCardCountById(session?.imageCardCountById, normalizedItems),
    imageCardAspectRatioById: normalizeImageCardAspectRatioById(session?.imageCardAspectRatioById, normalizedItems),
    chatProviderId: normalizeOptionalId(session?.chatProviderId),
    chatModelId: normalizeOptionalId(session?.chatModelId),
    imageProviderId: normalizeOptionalId(session?.imageProviderId),
    imageModelId: normalizeOptionalId(session?.imageModelId),
    generatedImageHistory: normalizeGeneratedImageHistory(session?.generatedImageHistory),
    messages: normalizedChat.messages,
    topics: normalizedChat.topics,
    regionSelections: normalizeRegionSelections(session?.regionSelections, normalizedItems),
  };
}

export function buildPersistedSession(session, patch) {
  const nextSession = cloneValue({
    ...session,
    ...patch,
  });

  const normalizedItems = Array.isArray(nextSession.items) ? nextSession.items : [];
  const normalizedConnections = normalizeConnections(nextSession.connections, normalizedItems);
  const normalizedTextCardPanelDrafts = normalizeTextCardPanelDrafts(nextSession.textCardPanelDrafts, normalizedItems);
  const normalizedTextCardProviderById = normalizeTextCardProviderById(nextSession.textCardProviderById, normalizedItems);
  const normalizedTextCardModelById = normalizeTextCardModelById(nextSession.textCardModelById, normalizedItems);
  const normalizedImageCardPanelDrafts = normalizeImageCardPanelDrafts(nextSession.imageCardPanelDrafts, normalizedItems);
  const normalizedImageCardModelById = normalizeImageCardModelById(nextSession.imageCardModelById, normalizedItems);
  const normalizedImageCardProviderById = normalizeImageCardProviderById(nextSession.imageCardProviderById, normalizedItems);
  const normalizedImageCardSizeById = normalizeImageCardSizeById(nextSession.imageCardSizeById, normalizedItems);
  const normalizedImageCardQualityById = normalizeImageCardQualityById(nextSession.imageCardQualityById, normalizedItems);
  const normalizedImageCardCountById = normalizeImageCardCountById(nextSession.imageCardCountById, normalizedItems);
  const normalizedImageCardAspectRatioById = normalizeImageCardAspectRatioById(nextSession.imageCardAspectRatioById, normalizedItems);
  const normalizedGeneratedImageHistory = normalizeGeneratedImageHistory(nextSession.generatedImageHistory);
  const normalizedRegionSelections = normalizeRegionSelections(nextSession.regionSelections, normalizedItems);
  const normalizedChat = normalizeSessionChatMessages(nextSession);

  return {
    ...nextSession,
    schemaVersion: 2,
    items: normalizedItems,
    connections: normalizedConnections,
    textCardPanelDrafts: normalizedTextCardPanelDrafts,
    textCardProviderById: normalizedTextCardProviderById,
    textCardModelById: normalizedTextCardModelById,
    imageCardPanelDrafts: normalizedImageCardPanelDrafts,
    imageCardProviderById: normalizedImageCardProviderById,
    imageCardModelById: normalizedImageCardModelById,
    imageCardSizeById: normalizedImageCardSizeById,
    imageCardQualityById: normalizedImageCardQualityById,
    imageCardCountById: normalizedImageCardCountById,
    imageCardAspectRatioById: normalizedImageCardAspectRatioById,
    chatProviderId: normalizeOptionalId(nextSession.chatProviderId),
    chatModelId: normalizeOptionalId(nextSession.chatModelId),
    imageProviderId: normalizeOptionalId(nextSession.imageProviderId),
    imageModelId: normalizeOptionalId(nextSession.imageModelId),
    generatedImageHistory: normalizedGeneratedImageHistory,
    viewport: nextSession.viewport,
    messages: normalizedChat.messages,
    topics: normalizedChat.topics,
    regionSelections: normalizedRegionSelections,
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
