const DEFAULT_HISTORY_LIMIT = 100;

const cloneValue = (value) => {
  if (typeof globalThis.structuredClone === 'function') {
    return globalThis.structuredClone(value);
  }

  return JSON.parse(JSON.stringify(value));
};

const normalizeLimit = (limit) =>
  Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : DEFAULT_HISTORY_LIMIT;

const isMoveItemsCommand = (entry) => entry?.kind === 'move-items';

const normalizePositions = (positions) => Object.fromEntries(
  Object.entries(positions && typeof positions === 'object' ? positions : {})
    .flatMap(([id, position]) => (
      Number.isFinite(position?.x) && Number.isFinite(position?.y)
        ? [[id, { x: position.x, y: position.y }]]
        : []
    ))
);

const normalizeMoveItemsCommand = (command) => ({
  kind: 'move-items',
  before: normalizePositions(command?.before),
  after: normalizePositions(command?.after),
  orderBefore: Array.isArray(command?.orderBefore) ? [...command.orderBefore] : [],
  orderAfter: Array.isArray(command?.orderAfter) ? [...command.orderAfter] : [],
});

const normalizeSnapshot = (snapshot) => ({
  items: Array.isArray(snapshot?.items) ? cloneValue(snapshot.items) : [],
  connections: Array.isArray(snapshot?.connections) ? cloneValue(snapshot.connections) : [],
  textCardPanelDrafts:
    snapshot?.textCardPanelDrafts && typeof snapshot.textCardPanelDrafts === 'object'
      ? cloneValue(snapshot.textCardPanelDrafts)
      : {},
  textCardProviderById:
    snapshot?.textCardProviderById && typeof snapshot.textCardProviderById === 'object'
      ? cloneValue(snapshot.textCardProviderById)
      : {},
  textCardModelById:
    snapshot?.textCardModelById && typeof snapshot.textCardModelById === 'object'
      ? cloneValue(snapshot.textCardModelById)
      : {},
  imageCardPanelDrafts:
    snapshot?.imageCardPanelDrafts && typeof snapshot.imageCardPanelDrafts === 'object'
      ? cloneValue(snapshot.imageCardPanelDrafts)
      : {},
  imageCardModelById:
    snapshot?.imageCardModelById && typeof snapshot.imageCardModelById === 'object'
      ? cloneValue(snapshot.imageCardModelById)
      : {},
  imageCardProviderById:
    snapshot?.imageCardProviderById && typeof snapshot.imageCardProviderById === 'object'
      ? cloneValue(snapshot.imageCardProviderById)
      : {},
  imageCardSizeById:
    snapshot?.imageCardSizeById && typeof snapshot.imageCardSizeById === 'object'
      ? cloneValue(snapshot.imageCardSizeById)
      : {},
  imageCardQualityById:
    snapshot?.imageCardQualityById && typeof snapshot.imageCardQualityById === 'object'
      ? cloneValue(snapshot.imageCardQualityById)
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

function readHistory(history) {
  return {
    past: Array.isArray(history?.past) ? history.past : [],
    future: Array.isArray(history?.future) ? history.future : [],
  };
}

const applyMoveItemsCommand = (snapshot, command, direction) => {
  const normalizedSnapshot = createCanvasUndoSnapshot(snapshot);
  const normalizedCommand = normalizeMoveItemsCommand(command);
  const positions = direction === 'backward' ? normalizedCommand.before : normalizedCommand.after;
  const order = direction === 'backward' ? normalizedCommand.orderBefore : normalizedCommand.orderAfter;
  const updatedItems = normalizedSnapshot.items.map((item) => {
    const position = positions[item.id];
    return position ? { ...item, x: position.x, y: position.y } : item;
  });
  if (order.length === 0) return { ...normalizedSnapshot, items: updatedItems };

  const itemById = new Map(updatedItems.map((item) => [item.id, item]));
  const orderedItems = order.flatMap((id) => {
    const item = itemById.get(id);
    if (!item) return [];
    itemById.delete(id);
    return [item];
  });
  return {
    ...normalizedSnapshot,
    items: [...orderedItems, ...itemById.values()],
  };
};

export function pushUndoSnapshot({
  history,
  snapshot,
  limit = DEFAULT_HISTORY_LIMIT,
}) {
  const normalizedHistory = readHistory(history);
  const nextSnapshot = createCanvasUndoSnapshot(snapshot);
  const lastPastSnapshot = normalizedHistory.past.at(-1) ?? null;

  if (lastPastSnapshot && !isMoveItemsCommand(lastPastSnapshot) && areCanvasUndoSnapshotsEqual(lastPastSnapshot, nextSnapshot)) {
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

export function createCanvasMoveHistoryCommand(command) {
  return normalizeMoveItemsCommand(command);
}

export function pushUndoCommand({
  history,
  command,
  limit = DEFAULT_HISTORY_LIMIT,
}) {
  const normalizedHistory = readHistory(history);
  const nextCommand = normalizeMoveItemsCommand(command);
  const maxEntries = normalizeLimit(limit);
  return {
    past: [...normalizedHistory.past, nextCommand].slice(-maxEntries),
    future: [],
  };
}

export function undoSnapshot({
  history,
  currentSnapshot,
  limit = DEFAULT_HISTORY_LIMIT,
}) {
  const normalizedHistory = readHistory(history);
  if (normalizedHistory.past.length === 0) {
    return {
      history: normalizedHistory,
      snapshot: null,
    };
  }

  const previousEntry = normalizedHistory.past.at(-1);
  if (isMoveItemsCommand(previousEntry)) {
    return {
      history: {
        past: normalizedHistory.past.slice(0, -1),
        future: [normalizeMoveItemsCommand(previousEntry), ...normalizedHistory.future]
          .slice(0, normalizeLimit(limit)),
      },
      snapshot: applyMoveItemsCommand(currentSnapshot, previousEntry, 'backward'),
    };
  }

  const snapshot = createCanvasUndoSnapshot(previousEntry);
  const nextFuture = [createCanvasUndoSnapshot(currentSnapshot), ...normalizedHistory.future]
    .slice(0, normalizeLimit(limit));

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
  const normalizedHistory = readHistory(history);
  if (normalizedHistory.future.length === 0) {
    return {
      history: normalizedHistory,
      snapshot: null,
    };
  }

  const [nextSnapshot, ...remainingFuture] = normalizedHistory.future;
  if (isMoveItemsCommand(nextSnapshot)) {
    return {
      history: {
        past: [...normalizedHistory.past, normalizeMoveItemsCommand(nextSnapshot)]
          .slice(-normalizeLimit(limit)),
        future: remainingFuture,
      },
      snapshot: applyMoveItemsCommand(currentSnapshot, nextSnapshot, 'forward'),
    };
  }
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
