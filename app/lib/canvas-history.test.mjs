import test from 'node:test';
import assert from 'node:assert/strict';

const canvasHistoryModule = await import('./canvas-history.mjs').catch(() => ({}));

const {
  createCanvasUndoSnapshot,
  createEmptySessionCanvasHistoryState,
  pushUndoSnapshot,
  undoSnapshot,
  redoSnapshot,
} = canvasHistoryModule;

const buildCanvasState = (overrides = {}) => ({
  items: [
    {
      id: 'item-1',
      type: 'text',
      x: 10,
      y: 20,
      width: 100,
      height: 120,
      rotation: 0,
      text: 'hello',
      textVariant: 'card',
      textMode: 'manual',
      visible: true,
      locked: false,
    },
  ],
  connections: [{ id: 'conn-1', fromItemId: 'item-1', toItemId: 'item-1' }],
  textCardPanelDrafts: { 'item-1': 'draft-1' },
  imageCardPanelDrafts: {},
  imageCardProviderById: {},
  imageCardModelById: {},
  imageCardSizeById: {},
  imageCardQualityById: {},
  imageCardCountById: {},
  imageCardAspectRatioById: {},
  ...overrides,
});

test('createCanvasUndoSnapshot clones the tracked canvas state shape', () => {
  assert.equal(typeof createCanvasUndoSnapshot, 'function');
  if (typeof createCanvasUndoSnapshot !== 'function') return;

  const source = buildCanvasState();
  const snapshot = createCanvasUndoSnapshot(source);

  assert.deepEqual(snapshot, source);
  assert.notEqual(snapshot, source);
  assert.notEqual(snapshot.items, source.items);
  assert.notEqual(snapshot.connections, source.connections);
  assert.notEqual(snapshot.textCardPanelDrafts, source.textCardPanelDrafts);
});

test('pushUndoSnapshot ignores duplicate snapshots for the same session history state', () => {
  assert.equal(typeof createCanvasUndoSnapshot, 'function');
  assert.equal(typeof createEmptySessionCanvasHistoryState, 'function');
  assert.equal(typeof pushUndoSnapshot, 'function');
  if (
    typeof createCanvasUndoSnapshot !== 'function' ||
    typeof createEmptySessionCanvasHistoryState !== 'function' ||
    typeof pushUndoSnapshot !== 'function'
  ) {
    return;
  }

  const snapshot = createCanvasUndoSnapshot(buildCanvasState());
  const firstHistory = pushUndoSnapshot({
    history: createEmptySessionCanvasHistoryState(),
    snapshot,
  });
  const secondHistory = pushUndoSnapshot({
    history: firstHistory,
    snapshot,
  });

  assert.equal(firstHistory.past.length, 1);
  assert.equal(secondHistory.past.length, 1);
  assert.deepEqual(secondHistory.future, []);
});

test('pushUndoSnapshot clears redo entries when a new canvas edit is recorded', () => {
  assert.equal(typeof createCanvasUndoSnapshot, 'function');
  assert.equal(typeof createEmptySessionCanvasHistoryState, 'function');
  assert.equal(typeof pushUndoSnapshot, 'function');
  if (
    typeof createCanvasUndoSnapshot !== 'function' ||
    typeof createEmptySessionCanvasHistoryState !== 'function' ||
    typeof pushUndoSnapshot !== 'function'
  ) {
    return;
  }

  const history = pushUndoSnapshot({
    history: {
      ...createEmptySessionCanvasHistoryState(),
      future: [createCanvasUndoSnapshot(buildCanvasState({ textCardPanelDrafts: { 'item-1': 'redo' } }))],
    },
    snapshot: createCanvasUndoSnapshot(buildCanvasState()),
  });

  assert.deepEqual(history.future, []);
  assert.equal(history.past.length, 1);
});

test('undoSnapshot returns the previous snapshot and moves the current snapshot into future', () => {
  assert.equal(typeof createCanvasUndoSnapshot, 'function');
  assert.equal(typeof createEmptySessionCanvasHistoryState, 'function');
  assert.equal(typeof pushUndoSnapshot, 'function');
  assert.equal(typeof undoSnapshot, 'function');
  if (
    typeof createCanvasUndoSnapshot !== 'function' ||
    typeof createEmptySessionCanvasHistoryState !== 'function' ||
    typeof pushUndoSnapshot !== 'function' ||
    typeof undoSnapshot !== 'function'
  ) {
    return;
  }

  const firstSnapshot = createCanvasUndoSnapshot(buildCanvasState());
  const secondSnapshot = createCanvasUndoSnapshot(
    buildCanvasState({
      items: [
        {
          id: 'item-1',
          type: 'text',
          x: 200,
          y: 20,
          width: 100,
          height: 120,
          rotation: 0,
          text: 'hello',
          textVariant: 'card',
          textMode: 'manual',
          visible: true,
          locked: false,
        },
      ],
    })
  );
  const history = pushUndoSnapshot({
    history: pushUndoSnapshot({
      history: createEmptySessionCanvasHistoryState(),
      snapshot: firstSnapshot,
    }),
    snapshot: secondSnapshot,
  });

  const result = undoSnapshot({
    history,
    currentSnapshot: createCanvasUndoSnapshot(
      buildCanvasState({
        items: [
          {
            id: 'item-1',
            type: 'text',
            x: 300,
            y: 20,
            width: 100,
            height: 120,
            rotation: 0,
            text: 'hello',
            textVariant: 'card',
            textMode: 'manual',
            visible: true,
            locked: false,
          },
        ],
      })
    ),
  });

  assert.deepEqual(result.snapshot, secondSnapshot);
  assert.equal(result.history.past.length, 1);
  assert.equal(result.history.future.length, 1);
});

test('redoSnapshot restores the next snapshot and pushes the current snapshot back into past', () => {
  assert.equal(typeof createCanvasUndoSnapshot, 'function');
  assert.equal(typeof createEmptySessionCanvasHistoryState, 'function');
  assert.equal(typeof redoSnapshot, 'function');
  if (
    typeof createCanvasUndoSnapshot !== 'function' ||
    typeof createEmptySessionCanvasHistoryState !== 'function' ||
    typeof redoSnapshot !== 'function'
  ) {
    return;
  }

  const currentSnapshot = createCanvasUndoSnapshot(buildCanvasState());
  const redoTarget = createCanvasUndoSnapshot(buildCanvasState({ textCardPanelDrafts: { 'item-1': 'redo-me' } }));
  const result = redoSnapshot({
    history: {
      ...createEmptySessionCanvasHistoryState(),
      future: [redoTarget],
    },
    currentSnapshot,
  });

  assert.deepEqual(result.snapshot, redoTarget);
  assert.equal(result.history.past.length, 1);
  assert.equal(result.history.future.length, 0);
  assert.deepEqual(result.history.past[0], currentSnapshot);
});

test('separate session history states keep their undo stacks isolated', () => {
  assert.equal(typeof createCanvasUndoSnapshot, 'function');
  assert.equal(typeof createEmptySessionCanvasHistoryState, 'function');
  assert.equal(typeof pushUndoSnapshot, 'function');
  if (
    typeof createCanvasUndoSnapshot !== 'function' ||
    typeof createEmptySessionCanvasHistoryState !== 'function' ||
    typeof pushUndoSnapshot !== 'function'
  ) {
    return;
  }

  const historyBySession = {
    'session-a': pushUndoSnapshot({
      history: createEmptySessionCanvasHistoryState(),
      snapshot: createCanvasUndoSnapshot(buildCanvasState()),
    }),
    'session-b': pushUndoSnapshot({
      history: createEmptySessionCanvasHistoryState(),
      snapshot: createCanvasUndoSnapshot(buildCanvasState({ textCardPanelDrafts: { 'item-1': 'session-b' } })),
    }),
  };

  assert.equal(historyBySession['session-a'].past.length, 1);
  assert.equal(historyBySession['session-b'].past.length, 1);
  assert.notDeepEqual(historyBySession['session-a'].past[0], historyBySession['session-b'].past[0]);
});
