const DEFAULT_VIEWPORT = { x: 0, y: 0, scale: 1 };

/** @returns {import('./db').ProjectSession} */
export function createEmptySession({
  existingCount = 0,
  now = Date.now(),
  name,
} = {}) {
  return {
    id: `session-${now}`,
    name: name?.trim() || `新画布 ${existingCount + 1}`,
    createdAt: now,
    updatedAt: now,
    items: [],
    connections: [],
    textCardPanelDrafts: {},
    textCardProviderById: {},
    textCardModelById: {},
    imageCardPanelDrafts: {},
    imageCardProviderById: {},
    imageCardModelById: {},
    imageCardSizeById: {},
    imageCardCountById: {},
    imageCardAspectRatioById: {},
    generatedImageHistory: [],
    regionSelections: [],
    messages: [],
    schemaVersion: 5,
    threadId: `session-${now}`,
    turns: [],
    activeTurn: null,
    lastSequence: 0,
    threadStatus: 'idle',
    archived: false,
    pendingApproval: null,
    todoItems: [],
    commandState: { lastCommand: null, lastResult: null },
    activeSkill: null,
    activeSkillExplicit: false,
    visualAssets: [],
    viewport: { ...DEFAULT_VIEWPORT },
  };
}

export function renameSessionInList(sessions, sessionId, nextName, now = Date.now()) {
  const trimmedName = nextName.trim();
  if (!trimmedName) return sessions;

  return sessions.map((session) =>
    session.id === sessionId
      ? {
          ...session,
          name: trimmedName,
          updatedAt: now,
        }
      : session
  );
}

export function upsertSessionInList(sessions, nextSession) {
  const existingIndex = sessions.findIndex((session) => session.id === nextSession.id);

  if (existingIndex === -1) {
    return [nextSession, ...sessions];
  }

  return sessions.map((session, index) => (index === existingIndex ? nextSession : session));
}

export function deleteSessionFromList({
  sessions,
  sessionId,
  currentSessionId = null,
  now = Date.now(),
}) {
  const remainingSessions = sessions.filter((session) => session.id !== sessionId);
  const deletedCurrentSession = currentSessionId === sessionId;

  if (remainingSessions.length === 0 && deletedCurrentSession) {
    const fallbackSession = createEmptySession({ existingCount: 0, now });
    return {
      sessions: [fallbackSession],
      nextCurrentSessionId: fallbackSession.id,
    };
  }

  if (deletedCurrentSession) {
    return {
      sessions: remainingSessions,
      nextCurrentSessionId: remainingSessions[0]?.id ?? '',
    };
  }

  return {
    sessions: remainingSessions,
    nextCurrentSessionId:
      currentSessionId && remainingSessions.some((session) => session.id === currentSessionId)
        ? currentSessionId
        : '',
  };
}
