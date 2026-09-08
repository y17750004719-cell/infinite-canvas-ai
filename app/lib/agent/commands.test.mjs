import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CommandError, commandErrorResponse, filterHistoryEvents, parseHistoryCommandArgs, parseSlashCommand,
  searchHistoryPages,
} from './commands.mjs';

test('slash commands preserve raw input and reject unknown names', () => {
  assert.deepEqual(parseSlashCommand(' /status '), { name: 'status', args: '', known: true, raw: '/status' });
  assert.equal(parseSlashCommand('/nope').known, false);
  assert.equal(parseSlashCommand('hello'), null);
});

test('history args support cursors, bounded limit and search', () => {
  assert.deepEqual(parseHistoryCommandArgs('250 --after 4 --before=20 --search "blue cat"'), {
    limit: 100, afterSequence: 4, beforeSequence: 20, search: 'blue cat',
  });
  assert.deepEqual(parseHistoryCommandArgs('poster draft'), {
    limit: 20, afterSequence: 0, beforeSequence: undefined, search: 'poster draft',
  });
  assert.throws(() => parseHistoryCommandArgs('--after 4 --before 4'), CommandError);
  assert.throws(() => parseHistoryCommandArgs('--wat 4'), /Unknown history option/);
});

test('history search is case insensitive and searches structured items', () => {
  const events = [{ sequence: 1, item: { content: 'Blue Cat' } }, { sequence: 2, item: { content: 'red dog' } }];
  assert.deepEqual(filterHistoryEvents(events, 'blue'), [events[0]]);
});

test('history search walks older pages and deduplicates by sequence', async () => {
  const calls = [];
  const pages = new Map([
    [0, { events: [{ sequence: 4, item: { content: 'latest match' } }, { sequence: 3, item: { content: 'nope' } }], hasOlder: true, hasNewer: false }],
    [4, { events: [{ sequence: 3, item: { content: 'nope' } }, { sequence: 2, item: { content: 'OLDER MATCH' } }], hasOlder: true, hasNewer: false }],
    [3, { events: [{ sequence: 2, item: { content: 'OLDER MATCH' } }, { sequence: 1, item: { content: 'oldest' } }], hasOlder: false, hasNewer: false }],
  ]);
  const result = await searchHistoryPages(async (options) => {
    const key = options.beforeSequence || 0;
    calls.push(key);
    return pages.get(key);
  }, { limit: 20, search: 'match' });
  assert.deepEqual(calls, [0, 4, 3]);
  assert.deepEqual(result.events.map((event) => event.sequence), [4, 2]);
  assert.equal(result.hasOlder, false);
});

test('history search walks forward from an after cursor', async () => {
  const calls = [];
  const pages = new Map([
    [4, { events: [{ sequence: 5, item: { content: 'first' } }], hasOlder: false, hasNewer: true }],
    [5, { events: [{ sequence: 5, item: { content: 'first' } }, { sequence: 6, item: { content: 'SECOND MATCH' } }], hasOlder: false, hasNewer: false }],
  ]);
  const result = await searchHistoryPages(async (options) => {
    calls.push(options.afterSequence);
    return pages.get(options.afterSequence);
  }, { limit: 20, afterSequence: 4, search: 'match' });
  assert.deepEqual(calls, [4, 5]);
  assert.deepEqual(result.events.map((event) => event.sequence), [6]);
});

test('command errors expose stable status and code', () => {
  assert.deepEqual(commandErrorResponse(Object.assign(new Error('active'), { code: 'thread_active', statusCode: 409 })), {
    status: 409, body: { error: 'active', code: 'thread_active' },
  });
});
