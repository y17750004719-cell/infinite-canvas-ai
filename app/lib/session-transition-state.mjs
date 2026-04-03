export function mergeCurrentSessionSnapshotIntoSessions({
  sessions,
  currentSessionId,
  buildCurrentSessionSnapshot,
}) {
  const resolvedSessions = Array.isArray(sessions) ? sessions : [];
  const currentSession = resolvedSessions.find((session) => session?.id === currentSessionId) ?? null;

  if (!currentSession) {
    return {
      sessions: resolvedSessions,
      currentSessionSnapshot: null,
    };
  }

  const currentSessionSnapshot = buildCurrentSessionSnapshot(currentSession);

  return {
    sessions: resolvedSessions.map((session) =>
      session.id === currentSession.id ? currentSessionSnapshot : session
    ),
    currentSessionSnapshot,
  };
}
