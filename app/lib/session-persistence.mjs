import { normalizeGeneratedImageHistory } from './generated-image-history.mjs';
import { normalizeSessionChatMessages } from './chat-message-persistence.mjs';

const isRecord = (value) => typeof value === 'object' && value !== null;
const cloneValue = (value) => {
  if (typeof globalThis.structuredClone === 'function') {
    return globalThis.structuredClone(value);
  }

  return JSON.parse(JSON.stringify(value));
};

const LEGACY_AGENT_TOOL_NAMES = new Set(['start_skill_job', 'get_skill_job']);

function omitKeys(value, keys) {
  if (!isRecord(value)) return value;

  return Object.fromEntries(Object.entries(value).filter(([key]) => !keys.has(key)));
}

function removeLegacyAgentFields(value) {
  return omitKeys(value, new Set([
    'executionPlan',
    'generationBrief',
    'executionBrief',
    'promptCompilation',
    'imagePlanning',
    'plannerFailure',
    'plannerCandidates',
    'plannerSelection',
    'plannerProviderId',
    'plannerModel',
    'executionBriefSummary',
    'plannerVisualSummary',
  ]));
}

function normalizeLegacyAgentRecovery(record) {
  if (!isRecord(record)) return undefined;

  const toolCalls = Array.isArray(record.toolCalls) ? record.toolCalls : [];
  const containsLegacyJob = toolCalls.some((call) => (
    isRecord(call) && LEGACY_AGENT_TOOL_NAMES.has(call.toolName)
  )) || LEGACY_AGENT_TOOL_NAMES.has(record.mainAgentLoop?.pendingCall?.name);

  if (record.resumeRoute === 'image_planner' || containsLegacyJob) {
    return undefined;
  }

  const taskSnapshot = isRecord(record.taskSnapshot)
    ? removeLegacyAgentFields(record.taskSnapshot)
    : record.taskSnapshot;

  return {
    ...removeLegacyAgentFields(record),
    ...(taskSnapshot ? { taskSnapshot } : {}),
    ...(toolCalls.length > 0 ? { toolCalls: toolCalls.filter((call) => (
      !isRecord(call) || !LEGACY_AGENT_TOOL_NAMES.has(call.toolName)
    )) } : {}),
  };
}

function normalizeLegacyAgentMessage(message) {
  if (!isRecord(message)) return message;

  const {
    agentRecovery: legacyAgentRecovery,
    agentClarification: legacyAgentClarification,
    taskSnapshot: legacyTaskSnapshot,
    agentImagePrompts: legacyAgentImagePrompts,
    agentClarificationResponsePayload: legacyClarificationResponsePayload,
    ...messageWithoutLegacyAgentState
  } = removeLegacyAgentFields(message);
  const sanitized = messageWithoutLegacyAgentState;
  const agentRecovery = normalizeLegacyAgentRecovery(legacyAgentRecovery);
  const agentClarification = isRecord(legacyAgentClarification)
    ? {
        ...legacyAgentClarification,
        ...(isRecord(legacyAgentClarification.state)
          ? { state: removeLegacyAgentFields(legacyAgentClarification.state) }
          : {}),
      }
    : legacyAgentClarification;
  const taskSnapshot = isRecord(legacyTaskSnapshot)
    ? removeLegacyAgentFields(legacyTaskSnapshot)
    : legacyTaskSnapshot;
  const agentImagePrompts = Array.isArray(legacyAgentImagePrompts)
    ? legacyAgentImagePrompts.map((entry) => (
      isRecord(entry) ? omitKeys(entry, new Set(['compilation'])) : entry
    ))
    : legacyAgentImagePrompts;
  const agentClarificationResponsePayload = isRecord(legacyClarificationResponsePayload)
    ? {
        ...legacyClarificationResponsePayload,
        ...(isRecord(legacyClarificationResponsePayload.clarification)
          ? {
              clarification: {
                ...legacyClarificationResponsePayload.clarification,
                ...(isRecord(legacyClarificationResponsePayload.clarification.state)
                  ? { state: removeLegacyAgentFields(legacyClarificationResponsePayload.clarification.state) }
                  : {}),
              },
            }
          : {}),
        ...(isRecord(legacyClarificationResponsePayload.response)
          ? { response: omitKeys(legacyClarificationResponsePayload.response, new Set(['retryMode'])) }
          : {}),
      }
    : legacyClarificationResponsePayload;

  return {
    ...sanitized,
    ...(agentRecovery ? { agentRecovery } : {}),
    ...(agentClarification ? { agentClarification } : {}),
    ...(taskSnapshot ? { taskSnapshot } : {}),
    ...(agentImagePrompts ? { agentImagePrompts } : {}),
    ...(agentClarificationResponsePayload ? { agentClarificationResponsePayload } : {}),
  };
}

/**
 * Remove obsolete Planner and Skill Job state from a persisted session.
 * Current Main Agent recovery, assets, canvas state, and ordinary messages are retained.
 */
export function removeDeprecatedImageAgentData(session) {
  if (!isRecord(session)) return session;

  const { agentRecovery: legacyAgentRecovery, ...sessionWithoutLegacyAgentRecovery } = session;
  const agentRecovery = normalizeLegacyAgentRecovery(legacyAgentRecovery);

  const sanitizeMessages = (messages) => (
    Array.isArray(messages) ? messages.map(normalizeLegacyAgentMessage) : messages
  );

  return {
    ...removeLegacyAgentFields(sessionWithoutLegacyAgentRecovery),
    schemaVersion: 3,
    ...(Array.isArray(session.messages) ? { messages: sanitizeMessages(session.messages) } : {}),
    ...(Array.isArray(session.topics)
      ? {
          topics: session.topics.map((topic) => (
            isRecord(topic)
              ? {
                  ...removeLegacyAgentFields(topic),
                  ...(Array.isArray(topic.messages) ? { messages: sanitizeMessages(topic.messages) } : {}),
                }
              : topic
          )),
        }
      : {}),
    ...(Array.isArray(session.generatedImageHistory)
      ? {
          generatedImageHistory: session.generatedImageHistory.map((entry) => (
            isRecord(entry) ? removeLegacyAgentFields(entry) : entry
          )),
        }
      : {}),
    ...(isRecord(session.taskSnapshot)
      ? { taskSnapshot: removeLegacyAgentFields(session.taskSnapshot) }
      : {}),
    ...(agentRecovery
      ? { agentRecovery }
      : {}),
  };
}

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
  const cleanedSession = removeDeprecatedImageAgentData(session);
  const normalizedItems = Array.isArray(cleanedSession?.items) ? cleanedSession.items : [];
  const normalizedChat = normalizeSessionChatMessages(cleanedSession);

  return {
    ...cleanedSession,
    schemaVersion: 3,
    items: normalizedItems,
    connections: normalizeConnections(cleanedSession?.connections, normalizedItems),
    textCardPanelDrafts: normalizeTextCardPanelDrafts(cleanedSession?.textCardPanelDrafts, normalizedItems),
    textCardProviderById: normalizeTextCardProviderById(cleanedSession?.textCardProviderById, normalizedItems),
    textCardModelById: normalizeTextCardModelById(cleanedSession?.textCardModelById, normalizedItems),
    imageCardPanelDrafts: normalizeImageCardPanelDrafts(cleanedSession?.imageCardPanelDrafts, normalizedItems),
    imageCardProviderById: normalizeImageCardProviderById(cleanedSession?.imageCardProviderById, normalizedItems),
    imageCardModelById: normalizeImageCardModelById(cleanedSession?.imageCardModelById, normalizedItems),
    imageCardSizeById: normalizeImageCardSizeById(cleanedSession?.imageCardSizeById, normalizedItems),
    imageCardQualityById: normalizeImageCardQualityById(cleanedSession?.imageCardQualityById, normalizedItems),
    imageCardCountById: normalizeImageCardCountById(cleanedSession?.imageCardCountById, normalizedItems),
    imageCardAspectRatioById: normalizeImageCardAspectRatioById(cleanedSession?.imageCardAspectRatioById, normalizedItems),
    chatProviderId: normalizeOptionalId(cleanedSession?.chatProviderId),
    chatModelId: normalizeOptionalId(cleanedSession?.chatModelId),
    imageProviderId: normalizeOptionalId(cleanedSession?.imageProviderId),
    imageModelId: normalizeOptionalId(cleanedSession?.imageModelId),
    generatedImageHistory: normalizeGeneratedImageHistory(cleanedSession?.generatedImageHistory),
    messages: normalizedChat.messages,
    topics: normalizedChat.topics,
    regionSelections: normalizeRegionSelections(cleanedSession?.regionSelections, normalizedItems),
  };
}

export function buildPersistedSession(session, patch) {
  const nextSession = removeDeprecatedImageAgentData(cloneValue({
    ...session,
    ...patch,
  }));

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
    schemaVersion: 3,
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
