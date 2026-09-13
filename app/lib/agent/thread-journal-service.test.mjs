import test from 'node:test';
import assert from 'node:assert/strict';
import { createThreadJournalService } from './thread-journal-service.mjs';

test('thread journal service exposes an injectable facade', async () => {
  const calls = [];
  const journal = createThreadJournalService({
    appendThreadEvent: async (...args) => { calls.push(['append', ...args]); return { sequence: 1 }; },
    queryThread: async (...args) => { calls.push(['query', ...args]); return { events: [] }; },
  });
  assert.deepEqual(await journal.appendThreadEvent('thread-1', { type: 'turn.started' }), { sequence: 1 });
  assert.deepEqual(await journal.queryThread('thread-1', { afterSequence: 0 }), { events: [] });
  assert.deepEqual(calls.map(([name]) => name), ['append', 'query']);
  assert.equal(typeof journal.loadThread, 'function');
  assert.equal(typeof journal.consumeThreadInputs, 'function');
});
