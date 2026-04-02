const DEFAULT_HISTORY_LIMIT = 100;

const cloneValue = (value) => {
  if (typeof globalThis.structuredClone === 'function') {
    return globalThis.structuredClone(value);
  }

  return JSON.parse(JSON.stringify(value));
};

const normalizeLimit = (limit) =>
  Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : DEFAULT_HISTORY_LIMIT;

const normalizeSnapshot = (snapshot) => ({
  items: Array.isArray(snapshot?.items) ? cloneValue(snapshot.items) : [],
  connections: Array.isArray(snapshot?.connections) ? cloneValue(snapshot.connections) : [],
  textCardPanelDrafts:
    snapshot?.textCardPanelDrafts && typeof snapshot.textCardPanelDrafts === 'object'
      ? cloneValue(snapshot.textCardPanelDrafts)
      : {},
  imageCardPanelDrafts:
    snapshot?.imageCardPanelDrafts && typeof snapshot.imageCardPanelDrafts === 'object'
      ? cloneValue(snapshot.imageCardPanelDrafts)
      : {},
  imageCardModelById:
    snapshot?.imageCardModelById && typeof snapshot.imageCardModelById === 'object'
      ? cloneValue(snapshot.imageCardModelById)
      : {},
  imageCardSizeById:
    snapshot?.imageCardSizeById && typeof snapshot.imageCardSizeById === 'object'
      ? cloneValue(snapshot.imageCardSizeById)
      : {},
  imageCardCountById:
    snapshot?.imageCardCountById && typeof snapshot.imageCardCountById === 'object'
      ? cloneValue(snapshot.imageCardCountById)
      : {},
  imageCardAspectRatioById:
    snapshot?.imageCardAspectRatioById && typeof snapshot.imageCardAspectRatioById === 'object'
      ? cloneValue(snapshot.imageCardAspectRatioById)
      : {},
});

const serializeSnapshot = (snapshot) => JSON.stringify(normalizeSnapshot(snapshot));

export function createCanvasUndoSnapshot(snapshot) {
  return normalizeSnapshot(snapshot);
}

export function areCanvasUndoSnapshotsEqual(left, right) {
  return serializeSnapshot(left) === serializeSnapshot(right);
}

export function createEmptySessionCanvasHistoryState() {
  return {
    past: [],
    future: [],
  };
}

function normalizeHistory(history) {
  return {
    past: Array.isArray(history?.past) ? history.past.map((snapshot) => createCanvasUndoSnapshot(snapshot)) : [],
    future: Array.isArray(history?.future) ? history.future.map((snapshot) => createCanvasUndoSnapshot(snapshot)) : [],
  };
}

export function pushUndoSnapshot({
  history,
  snapshot,
  limit = DEFAULT_HISTORY_LIMIT,
}) {
  const normalizedHistory = normalizeHistory(history);
  const nextSnapshot = createCanvasUndoSnapshot(snapshot);
  const lastPastSnapshot = normalizedHistory.past.at(-1) ?? null;

  if (lastPastSnapshot && areCanvasUndoSnapshotsEqual(lastPastSnapshot, nextSnapshot)) {
    if (normalizedHistory.future.length === 0) {
      return normalizedHistory;
    }

    return {
      ...normalizedHistory,
      future: [],
    };
  }

  const nextPast = [...normalizedHistory.past, nextSnapshot];
  const maxEntries = normalizeLimit(limit);

  return {
    past: nextPast.slice(-maxEntries),
    future: [],
  };
}

export function undoSnapshot({
  history,
  currentSnapshot,
  limit = DEFAULT_HISTORY_LIMIT,
}) {
  const normalizedHistory = normalizeHistory(history);
  if (normalizedHistory.past.length === 0) {
    return {
      history: normalizedHistory,
      snapshot: null,
    };
  }

  const snapshot = createCanvasUndoSnapshot(normalizedHistory.past.at(-1));
  const nextFuture = [
    createCanvasUndoSnapshot(currentSnapshot),
    ...normalizedHistory.future,
  ].slice(0, normalizeLimit(limit));

  return {
    history: {
      past: normalizedHistory.past.slice(0, -1),
      future: nextFuture,
    },
    snapshot,
  };
}

export function redoSnapshot({
  history,
  currentSnapshot,
  limit = DEFAULT_HISTORY_LIMIT,
}) {
  const normalizedHistory = normalizeHistory(history);
  if (normalizedHistory.future.length === 0) {
    return {
      history: normalizedHistory,
      snapshot: null,
    };
  }

  const [nextSnapshot, ...remainingFuture] = normalizedHistory.future;
  const nextPast = [
    ...normalizedHistory.past,
    createCanvasUndoSnapshot(currentSnapshot),
  ];

  return {
    history: {
      past: nextPast.slice(-normalizeLimit(limit)),
      future: remainingFuture,
    },
    snapshot: createCanvasUndoSnapshot(nextSnapshot),
  };
}
