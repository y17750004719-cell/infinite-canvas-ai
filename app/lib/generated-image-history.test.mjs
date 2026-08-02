import test from 'node:test';
import assert from 'node:assert/strict';
import * as generatedHistory from './generated-image-history.mjs';

import {
  appendMissingGeneratedHistoryEntries,
  appendGeneratedImageHistoryEntries,
  buildGeneratedImageHistorySortKey,
  buildGeneratedHistoryEntriesFromImageCard,
  extractGeneratedImageTimestampFromFilename,
  mergeGeneratedImageHistoryEntries,
  normalizeGeneratedImageHistory,
} from './generated-image-history.mjs';

test('mergeGeneratedHistoryReferences appends unique history images up to the reference limit', () => {
  assert.deepEqual(
    generatedHistory.mergeGeneratedHistoryReferences(
      ['/existing.png', '/duplicate.png'],
      ['/duplicate.png', '/history-a.png', '/history-b.png'],
      3
    ),
    ['/existing.png', '/duplicate.png', '/history-a.png']
  );
});

test('mergeGeneratedHistoryReferences ignores blank and repeated selected sources', () => {
  assert.deepEqual(
    generatedHistory.mergeGeneratedHistoryReferences([], ['', '/history-a.png', '/history-a.png'], 14),
    ['/history-a.png']
  );
});

test('extractGeneratedImageTimestampFromFilename reads timestamps from generated file names', () => {
  assert.equal(extractGeneratedImageTimestampFromFilename('img-1774856292455-avxj5v.jpg'), 1774856292455);
  assert.equal(extractGeneratedImageTimestampFromFilename('logo-1773047333648-yp62bt.png'), 1773047333648);
  assert.equal(extractGeneratedImageTimestampFromFilename('plain.png'), null);
});

test('buildGeneratedImageHistorySortKey scales timestamps into the shared ordering range', () => {
  assert.equal(buildGeneratedImageHistorySortKey(1700000000500), 1700000000500000);
  assert.equal(buildGeneratedImageHistorySortKey(1700000000500, 3), 1700000000500003);
  assert.equal(buildGeneratedImageHistorySortKey(0, 2), 2);
});

test('normalizeGeneratedImageHistory keeps only valid generated image entries', () => {
  const result = normalizeGeneratedImageHistory([
    {
      id: 'history-1',
      src: '/uploads/generated/a.png',
      plannerPreviewSrc: '/uploads/generated/a.png',
      createdAt: 10,
      source: 'chat',
      naturalWidth: 1024,
      naturalHeight: 1024,
    },
    {
      id: 'history-2',
      src: '',
      createdAt: 11,
      source: 'image-card',
    },
    {
      src: '/uploads/generated/archive.png',
      source: 'unknown',
    },
  ]);

  assert.deepEqual(result, [
    {
      id: 'history-1',
      src: '/uploads/generated/a.png',
      plannerPreviewSrc: '/uploads/generated/a.png',
      createdAt: 10,
      source: 'chat',
      sessionId: undefined,
      naturalWidth: 1024,
      naturalHeight: 1024,
      sourceItemId: undefined,
      topicId: undefined,
      messageId: undefined,
    },
    {
      id: 'generated-history-unknown-2',
      src: '/uploads/generated/archive.png',
      plannerPreviewSrc: '/uploads/generated/archive.png',
      createdAt: 0,
      source: 'archive',
      sessionId: undefined,
      naturalWidth: undefined,
      naturalHeight: undefined,
      sourceItemId: undefined,
      topicId: undefined,
      messageId: undefined,
    },
  ]);
});

test('normalizeGeneratedImageHistory preserves agent edit provenance', () => {
  const [entry] = normalizeGeneratedImageHistory([{
    id: 'edit-1',
    src: '/uploads/generated/edit.png',
    createdAt: 20,
    source: 'chat',
    operation: 'edit',
    sourceReferenceId: 'canvas-reference:image-1',
    sourceTaskId: 'task-source',
    sourceVersionId: 'version-source',
    providerId: 'comfly',
    model: 'gpt-image-2',
    promptTrace: {
      sourcePrompt: '把蓝色瓶子换到场景当中',
      finalPrompt: 'Edit the first reference image. Replace only the bottle.',
      optimized: true,
      operation: 'edit',
      targetReferenceId: 'canvas-reference:image-1',
    },
  }]);
  assert.equal(entry.operation, 'edit');
  assert.equal(entry.sourceReferenceId, 'canvas-reference:image-1');
  assert.equal(entry.sourceTaskId, 'task-source');
  assert.equal(entry.sourceVersionId, 'version-source');
  assert.equal(entry.providerId, 'comfly');
  assert.equal(entry.model, 'gpt-image-2');
  assert.equal(entry.promptTrace.finalPrompt, 'Edit the first reference image. Replace only the bottle.');
  assert.equal(entry.promptTrace.targetReferenceId, 'canvas-reference:image-1');
});

test('appendGeneratedImageHistoryEntries preserves existing entries and skips duplicate ids', () => {
  const result = appendGeneratedImageHistoryEntries(
    [
      { id: 'history-1', src: '/uploads/generated/a.png', createdAt: 10, source: 'chat' },
    ],
    [
      { id: 'history-1', src: '/uploads/generated/a.png', createdAt: 10, source: 'chat' },
      { id: 'history-2', src: '/uploads/generated/b.png', createdAt: 20, source: 'image-card' },
    ]
  );

  assert.deepEqual(
    result.map((entry) => ({ id: entry.id, src: entry.src })),
    [
      { id: 'history-1', src: '/uploads/generated/a.png' },
      { id: 'history-2', src: '/uploads/generated/b.png' },
    ]
  );
});

test('appendMissingGeneratedHistoryEntries skips duplicates by src even when ids differ', () => {
  const result = appendMissingGeneratedHistoryEntries(
    [
      { id: 'history-1', src: '/uploads/generated/a.png', createdAt: 10, source: 'image-card' },
    ],
    [
      { id: 'history-2', src: '/uploads/generated/a.png', createdAt: 20, source: 'image-card' },
      { id: 'history-3', src: '/uploads/generated/b.png', createdAt: 30, source: 'image-card' },
    ]
  );

  assert.deepEqual(
    result.map((entry) => ({ id: entry.id, src: entry.src })),
    [
      { id: 'history-1', src: '/uploads/generated/a.png' },
      { id: 'history-3', src: '/uploads/generated/b.png' },
    ]
  );
});

test('normalizeGeneratedImageHistory preserves task version identity and preview separation', () => {
  const [entry] = normalizeGeneratedImageHistory([{
    id: 'history-v2',
    src: '/original/v2.png',
    plannerPreviewSrc: '/preview/v2.webp',
    createdAt: 20,
    source: 'chat',
    topicId: 'topic-1',
    taskId: 'task-1',
    contractVersion: 2,
    batchId: 'batch-1',
    slotId: 'slot-1',
    versionId: 'version-2',
    parentVersionId: 'version-1',
  }]);

  assert.equal(entry.src, '/original/v2.png');
  assert.equal(entry.plannerPreviewSrc, '/preview/v2.webp');
  assert.deepEqual(
    {
      topicId: entry.topicId,
      taskId: entry.taskId,
      contractVersion: entry.contractVersion,
      batchId: entry.batchId,
      slotId: entry.slotId,
      versionId: entry.versionId,
      parentVersionId: entry.parentVersionId,
    },
    {
      topicId: 'topic-1',
      taskId: 'task-1',
      contractVersion: 2,
      batchId: 'batch-1',
      slotId: 'slot-1',
      versionId: 'version-2',
      parentVersionId: 'version-1',
    }
  );
});

test('appendMissingGeneratedHistoryEntries preserves distinct versions with the same source', () => {
  const base = {
    src: '/original/shared.png',
    createdAt: 10,
    source: 'chat',
    topicId: 'topic-1',
    taskId: 'task-1',
    contractVersion: 1,
    batchId: 'batch-1',
    slotId: 'slot-1',
  };
  const result = appendMissingGeneratedHistoryEntries(
    [{ ...base, id: 'history-v1', versionId: 'version-1' }],
    [{ ...base, id: 'history-v2', versionId: 'version-2', parentVersionId: 'version-1', createdAt: 20 }]
  );

  assert.deepEqual(result.map((entry) => entry.versionId), ['version-1', 'version-2']);
});

test('buildGeneratedHistoryEntriesFromImageCard returns current image-card outputs as generated history entries', () => {
  const result = buildGeneratedHistoryEntriesFromImageCard({
    item: {
      id: 'image-card-1',
      type: 'image',
      imageVariant: 'card',
      imageOutputs: [
        { src: '/uploads/generated/a.png', naturalWidth: 1024, naturalHeight: 1024 },
        { src: '/uploads/generated/b.png', naturalWidth: 2048, naturalHeight: 1024 },
      ],
    },
    sourceItemId: 'image-card-1',
    createdAt: 42,
  });

  assert.deepEqual(
    result.map((entry) => ({
      src: entry.src,
      source: entry.source,
      sourceItemId: entry.sourceItemId,
      naturalWidth: entry.naturalWidth,
      naturalHeight: entry.naturalHeight,
      createdAt: entry.createdAt,
    })),
    [
      {
        src: '/uploads/generated/a.png',
        source: 'image-card',
        sourceItemId: 'image-card-1',
        naturalWidth: 1024,
        naturalHeight: 1024,
        createdAt: buildGeneratedImageHistorySortKey(42, 0),
      },
      {
        src: '/uploads/generated/b.png',
        source: 'image-card',
        sourceItemId: 'image-card-1',
        naturalWidth: 2048,
        naturalHeight: 1024,
        createdAt: buildGeneratedImageHistorySortKey(42, 1),
      },
    ]
  );
});

test('mergeGeneratedImageHistoryEntries keeps session entries ahead of archive duplicates and sorts newest first', () => {
  const result = mergeGeneratedImageHistoryEntries({
    sessionEntries: [
      {
        id: 'session-1',
        src: '/uploads/generated/shared.png',
        createdAt: 50,
        source: 'image-card',
      },
      {
        id: 'session-2',
        src: '/uploads/generated/fresh.png',
        createdAt: 80,
        source: 'chat',
      },
    ],
    fallbackEntries: [
      {
        id: 'fallback-1',
        src: '/uploads/generated/legacy.png',
        createdAt: 60,
        source: 'image-card',
      },
    ],
    archiveEntries: [
      {
        id: 'archive-1',
        src: '/uploads/generated/shared.png',
        createdAt: 100,
        source: 'archive',
      },
      {
        id: 'archive-2',
        src: '/uploads/generated/archive-only.png',
        createdAt: 70,
        source: 'archive',
      },
    ],
  });

  assert.deepEqual(
    result.map((entry) => ({ id: entry.id, src: entry.src, source: entry.source })),
    [
      { id: 'session-2', src: '/uploads/generated/fresh.png', source: 'chat' },
      { id: 'archive-2', src: '/uploads/generated/archive-only.png', source: 'archive' },
      { id: 'fallback-1', src: '/uploads/generated/legacy.png', source: 'image-card' },
      { id: 'session-1', src: '/uploads/generated/shared.png', source: 'image-card' },
    ]
  );
});
