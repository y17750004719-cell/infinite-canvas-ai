import test from 'node:test';
import assert from 'node:assert/strict';

import {
  appendGeneratedImageHistoryEntries,
  extractGeneratedImageTimestampFromFilename,
  mergeGeneratedImageHistoryEntries,
  normalizeGeneratedImageHistory,
} from './generated-image-history.mjs';

test('extractGeneratedImageTimestampFromFilename reads timestamps from generated file names', () => {
  assert.equal(extractGeneratedImageTimestampFromFilename('img-1774856292455-avxj5v.jpg'), 1774856292455);
  assert.equal(extractGeneratedImageTimestampFromFilename('logo-1773047333648-yp62bt.png'), 1773047333648);
  assert.equal(extractGeneratedImageTimestampFromFilename('plain.png'), null);
});

test('normalizeGeneratedImageHistory keeps only valid generated image entries', () => {
  const result = normalizeGeneratedImageHistory([
    {
      id: 'history-1',
      src: '/uploads/generated/a.png',
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
