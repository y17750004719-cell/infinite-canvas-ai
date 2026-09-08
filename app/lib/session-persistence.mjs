import { normalizeGeneratedImageHistory } from './generated-image-history.mjs';
import { normalizeAgentConversationMemory, normalizeSessionChatMessages } from './chat-message-persistence.mjs';
import { buildReplayableContext, normalizeContextEvents } from './agent/context-events.mjs';

const isRecord = (value) => typeof value === 'object' && value !== null;
const cloneValue = (value) => {
  if (typeof globalThis.structuredClone === 'function') {
    return globalThis.structuredClone(value);
  }

  return JSON.parse(JSON.stringify(value));
};

const normalizeVisualAssets = (assets, sessionId) => {
  if (!Array.isArray(assets)) return [];
  const normalizedSessionId = typeof sessionId === 'string' ? sessionId.trim() : '';
  const seen = new Set();
  return assets.flatMap((asset, index) => {
    if (!isRecord(asset)) return [];
    const owner = typeof asset.sessionId === 'string' ? asset.sessionId.trim() : '';
    if (!owner || owner !== normalizedSessionId) return [];
    const durableSrc = typeof asset.durableSrc === 'string' ? asset.durableSrc.trim() : '';
    if (!durableSrc) return [];
    const id = typeof asset.id === 'string' && asset.id.trim() ? asset.id.trim() : `visual-asset-${index + 1}`;
    const key = asset.contentHash ? `hash:${asset.contentHash}` : `src:${durableSrc}`;
    if (seen.has(key)) return [];
    seen.add(key);
    const { sessionId: _sessionId, ...assetWithoutOwner } = asset;
    return [{
      ...assetWithoutOwner,
      id,
      ...(normalizedSessionId ? { sessionId: normalizedSessionId } : {}),
      durableSrc,
      createdAt: Number.isFinite(Number(asset.createdAt)) ? Number(asset.createdAt) : Date.now(),
    }];
  });
};

const normalizeSessionGeneratedImageHistory = (entries, sessionId) => (
  normalizeGeneratedImageHistory(entries)
    .filter((entry) => entry.sessionId === sessionId)
    .map((entry) => ({ ...entry, ...(sessionId ? { sessionId } : {}) }))
);

const normalizeContextWindowState = (window, sessionId) => {
  if (!isRecord(window)) return undefined;
  const owner = typeof window.sessionId === 'string' ? window.sessionId.trim() : '';
  if (owner && owner !== sessionId) return undefined;
  return { ...window, sessionId };
};

const normalizeCompactedWindows = (windows, sessionId) => (
  Array.isArray(windows)
    ? windows.filter((window) => isRecord(window) && (!window.sessionId || window.sessionId === sessionId)).map((window) => ({ ...window, sessionId }))
    : []
);

const normalizeContextHistory = (history, sessionId, fallbackEvents, fallbackWindows, fallbackWindow) => {
  const sourceHistory = isRecord(history) ? history : {};
  const normalizedFallbackEvents = normalizeContextEvents(fallbackEvents, sessionId);
  const normalizedStoredAudit = normalizeContextEvents(
    Array.isArray(sourceHistory.auditEvents) ? sourceHistory.auditEvents : [],
    sessionId,
  );
  const auditById = new Map(normalizedStoredAudit.map((event) => [event.eventId, event]));
  for (const event of normalizedFallbackEvents) {
    if (!auditById.has(event.eventId)) auditById.set(event.eventId, event);
  }
  const auditEvents = [...auditById.values()].sort((a, b) => Number(a.sequence) - Number(b.sequence));
  let modelEvents = normalizeContextEvents(
    Array.isArray(sourceHistory.modelEvents) ? sourceHistory.modelEvents : auditEvents,
    sessionId,
  );
  const compactionRecords = Array.isArray(sourceHistory.compactionRecords)
    ? sourceHistory.compactionRecords.filter((record) => isRecord(record) && (!record.sessionId || record.sessionId === sessionId))
    : [];
  const activeWindow = normalizeContextWindowState(sourceHistory.activeWindow, sessionId)
    || fallbackWindow
    || { sessionId, startSequence: 1, endSequence: modelEvents.at(-1)?.sequence || 0, compactCount: compactionRecords.length, summaryVersion: compactionRecords.at(-1)?.summaryVersion || 0, estimatedTokens: 0, model: '', contextWindow: 0 };
  // A request can commit a new event to the compatibility `contextEvents`
  // field before the richer history object is persisted. Preserve compacted
  // history while appending only the unmaterialized tail to the active model
  // window. This prevents a late save from dropping the latest tool result.
  const modelIds = new Set(modelEvents.map((event) => event.eventId));
  const tailEvents = auditEvents.filter((event) => (
    Number(event.sequence) > Number(activeWindow.endSequence || 0) && !modelIds.has(event.eventId)
  ));
  if (tailEvents.length > 0) {
    modelEvents = [...modelEvents, ...tailEvents].sort((a, b) => Number(a.sequence) - Number(b.sequence));
  }
  const revision = (value) => {
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? Math.floor(number) : 0;
  };
  const historyRevision = Math.max(
    revision(sourceHistory.historyRevision),
    auditEvents.reduce((max, event) => Math.max(max, Number(event.sequence) || 0), 0),
  );
  const userMessageRevision = Math.max(
    revision(sourceHistory.userMessageRevision),
    auditEvents.filter((event) => event?.type === 'user_text').length,
  );
  const activeWindowRevision = Math.max(
    revision(sourceHistory.activeWindowRevision),
    revision(activeWindow?.summaryVersion),
  );
  return {
    schemaVersion: 3,
    auditEvents,
    modelEvents,
    compactionRecords,
    activeWindow,
    historyRevision,
    userMessageRevision,
    activeWindowRevision,
  };
};

function resetLegacySession(session) {
  const source = isRecord(session) ? session : {};
  const id = typeof source.id === 'string' && source.id.trim()
    ? source.id.trim()
    : `session-${Date.now()}`;

  return {
    schemaVersion: 5,
    id,
    name: typeof source.name === 'string' ? source.name : '未命名画布',
    createdAt: Number.isFinite(Number(source.createdAt)) ? Number(source.createdAt) : Date.now(),
    updatedAt: Number.isFinite(Number(source.updatedAt)) ? Number(source.updatedAt) : Date.now(),
    items: Array.isArray(source.items) ? source.items : [],
    connections: Array.isArray(source.connections) ? source.connections : [],
    textCardPanelDrafts: isRecord(source.textCardPanelDrafts) ? source.textCardPanelDrafts : {},
    textCardProviderById: isRecord(source.textCardProviderById) ? source.textCardProviderById : {},
    textCardModelById: isRecord(source.textCardModelById) ? source.textCardModelById : {},
    imageCardPanelDrafts: isRecord(source.imageCardPanelDrafts) ? source.imageCardPanelDrafts : {},
    imageCardProviderById: isRecord(source.imageCardProviderById) ? source.imageCardProviderById : {},
    imageCardModelById: isRecord(source.imageCardModelById) ? source.imageCardModelById : {},
    imageCardSizeById: isRecord(source.imageCardSizeById) ? source.imageCardSizeById : {},
    imageCardQualityById: isRecord(source.imageCardQualityById) ? source.imageCardQualityById : {},
    imageCardCountById: isRecord(source.imageCardCountById) ? source.imageCardCountById : {},
    imageCardAspectRatioById: isRecord(source.imageCardAspectRatioById) ? source.imageCardAspectRatioById : {},
    chatProviderId: source.chatProviderId,
    chatModelId: source.chatModelId,
    imageProviderId: source.imageProviderId,
    imageModelId: source.imageModelId,
    viewport: isRecord(source.viewport) ? source.viewport : { x: 0, y: 0, scale: 1 },
    messages: [],
    threadId: id,
    turns: [],
    activeTurn: null,
    lastSequence: 0,
    transcriptStartSequence: 0,
    transcriptSummary: null,
    threadStatus: 'idle',
    archived: false,
    pendingApproval: null,
    todoItems: [],
    commandState: { lastCommand: null, lastResult: null },
    activeSkill: null,
    activeSkillExplicit: false,
    visualAssets: [],
    generatedImageHistory: [],
    contextEvents: [],
    compactedWindows: [],
    regionSelections: [],
  };
}

function normalizeThreadState(session) {
  const source = isRecord(session) ? session : {};
  const {
    topics: _topics,
    activeTopicId: _activeTopicId,
    activeAgentRun: _activeAgentRun,
    agentRecovery: _agentRecovery,
    topicId: _topicId,
    ...currentSource
  } = source;
  const threadId = typeof currentSource.threadId === 'string' && currentSource.threadId.trim() ? currentSource.threadId.trim() : currentSource.id;
  const turns = Array.isArray(currentSource.turns) ? currentSource.turns.filter(isRecord).map((turn) => ({
    ...turn,
    turnId: typeof turn.turnId === 'string' ? turn.turnId : `turn-${Date.now()}`,
    operationId: typeof turn.operationId === 'string' ? turn.operationId : turn.turnId,
    status: ['queued', 'running', 'waiting', 'completed', 'failed', 'cancelled', 'interrupted'].includes(turn.status) ? turn.status : 'interrupted',
    items: Array.isArray(turn.items) ? turn.items : [],
    usage: turn.usage || null,
  })) : [];
  return {
    ...currentSource,
    schemaVersion: 5,
    threadId: currentSource.id || threadId,
    turns,
    archived: currentSource.archived === true,
    pendingApproval: isRecord(currentSource.pendingApproval) ? currentSource.pendingApproval : null,
    todoItems: Array.isArray(currentSource.todoItems) ? currentSource.todoItems : [],
    commandState: isRecord(currentSource.commandState) ? currentSource.commandState : { lastCommand: null, lastResult: null },
    activeTurn: typeof currentSource.activeTurn === 'string' ? currentSource.activeTurn : null,
    lastSequence: Number.isFinite(Number(currentSource.lastSequence)) ? Math.max(0, Math.floor(Number(currentSource.lastSequence))) : 0,
    transcriptStartSequence: Number.isFinite(Number(currentSource.transcriptStartSequence)) ? Math.max(0, Math.floor(Number(currentSource.transcriptStartSequence))) : 0,
    transcriptSummary: typeof currentSource.transcriptSummary === 'string' ? currentSource.transcriptSummary.trim().slice(0, 6000) || null : null,
    threadStatus: currentSource.archived ? 'archived' : (['idle', 'running', 'waiting', 'error'].includes(currentSource.threadStatus) ? currentSource.threadStatus : 'idle'),
  };
}

const filterOwnedContextEvents = (events, sessionId) => (
  Array.isArray(events) ? events.filter((event) => isRecord(event) && event.sessionId === sessionId) : []
);

const filterOwnedContextHistory = (history, sessionId) => {
  if (!isRecord(history)) return history;
  return {
    ...history,
    auditEvents: filterOwnedContextEvents(history.auditEvents, sessionId),
    modelEvents: filterOwnedContextEvents(history.modelEvents, sessionId),
  };
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
  const currentSession = Number(session?.schemaVersion) === 5 ? session : resetLegacySession(session);
  const cleanedSession = normalizeThreadState(currentSession);
  const normalizedItems = Array.isArray(cleanedSession?.items) ? cleanedSession.items : [];
  const normalizedChat = normalizeSessionChatMessages(cleanedSession);
  const normalizedTopics = [];
  const ownedContextEvents = filterOwnedContextEvents(cleanedSession?.contextEvents, cleanedSession?.id);
  const replay = buildReplayableContext({ sessionId: cleanedSession?.id, events: ownedContextEvents, messages: normalizedChat.messages, mergeMessages: true });
  const contextHistory = normalizeContextHistory(filterOwnedContextHistory(cleanedSession?.contextHistory, cleanedSession?.id), cleanedSession?.id, replay.events, cleanedSession?.compactedWindows, cleanedSession?.activeContextWindow);

  return {
    ...cleanedSession,
    schemaVersion: 5,
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
    generatedImageHistory: normalizeSessionGeneratedImageHistory(cleanedSession?.generatedImageHistory, cleanedSession?.id),
    messages: normalizedChat.messages,
    activeSkill: cleanedSession.activeSkill || null,
    activeSkillExplicit: Boolean(cleanedSession.activeSkillExplicit),
    agentMemory: normalizeAgentConversationMemory(cleanedSession.agentMemory),
    visualAssets: normalizeVisualAssets(cleanedSession.visualAssets, cleanedSession.id),
    contextEvents: contextHistory?.auditEvents || normalizeContextEvents(replay.events, cleanedSession?.id),
    ...(contextHistory ? { contextHistory } : {}),
    compactedWindows: normalizeCompactedWindows(cleanedSession.compactedWindows, cleanedSession.id),
    activeContextWindow: normalizeContextWindowState(cleanedSession.activeContextWindow, cleanedSession.id) || replay.activeWindow,
    regionSelections: normalizeRegionSelections(cleanedSession?.regionSelections, normalizedItems),
  };
}

export function buildPersistedSession(session, patch) {
  const mergedSession = cloneValue({
    ...session,
    ...patch,
  });
  const nextSession = normalizeThreadState(
    Number(mergedSession?.schemaVersion) === 5 ? mergedSession : resetLegacySession(mergedSession)
  );

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
  const normalizedGeneratedImageHistory = normalizeSessionGeneratedImageHistory(nextSession.generatedImageHistory, nextSession.id);
  const normalizedRegionSelections = normalizeRegionSelections(nextSession.regionSelections, normalizedItems);
  const normalizedChat = normalizeSessionChatMessages(nextSession);
  const ownedContextEvents = filterOwnedContextEvents(nextSession?.contextEvents, nextSession?.id);
  const replay = buildReplayableContext({ sessionId: nextSession?.id, events: ownedContextEvents, messages: normalizedChat.messages, compactedWindows: nextSession?.compactedWindows, mergeMessages: true });
  const contextHistory = normalizeContextHistory(filterOwnedContextHistory(nextSession?.contextHistory, nextSession?.id), nextSession?.id, replay.events, nextSession?.compactedWindows, nextSession?.activeContextWindow);

  return {
    ...nextSession,
    schemaVersion: 5,
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
    activeSkill: nextSession.activeSkill || null,
    activeSkillExplicit: Boolean(nextSession.activeSkillExplicit),
    agentMemory: normalizeAgentConversationMemory(nextSession.agentMemory),
    visualAssets: normalizeVisualAssets(nextSession.visualAssets, nextSession.id),
    contextEvents: contextHistory?.auditEvents || normalizeContextEvents(replay.events, nextSession?.id),
    ...(contextHistory ? { contextHistory } : {}),
    compactedWindows: normalizeCompactedWindows(nextSession.compactedWindows, nextSession.id),
    activeContextWindow: normalizeContextWindowState(nextSession.activeContextWindow, nextSession.id) || replay.activeWindow,
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
