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

export function normalizeProjectSession(session) {
  const normalizedItems = Array.isArray(session?.items) ? session.items : [];

  return {
    ...session,
    items: normalizedItems,
    connections: normalizeConnections(session?.connections, normalizedItems),
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
