import test from 'node:test';
import assert from 'node:assert/strict';
import { handleThreadReplay } from './thread-replay-service.mjs';
import * as journalStore from './thread-journal.mjs';

test('thread replay marks a stale active turn interrupted before returning state', async () => {
  let appended;
  const journal = {
    queryThread: async () => ({ state: { activeTurn: 'turn-1', turns: [{ turnId: 'turn-1', runId: 'run-1', operationId: 'op-1' }] }, events: [] }),
    interruptOrphanedTurn: async (_threadId, identity) => { appended = identity; },
  };
  const request = { nextUrl: { searchParams: new URLSearchParams('threadId=thread-1&afterSequence=2') } };
  const response = await handleThreadReplay(request, { journal, activeRunRegistry: { getActiveAgentRun: () => null } });
  assert.equal(response.status, 200);
  assert.equal(appended.turnId, 'turn-1');
  assert.equal(appended.runId, 'run-1');
});

test('orphan reconciliation rechecks the journal under its queue after a concurrent completion', async () => {
  const id = `orphan-race-${crypto.randomUUID()}`;
  const identity = { turnId: 'turn', taskId: 'task', operationId: 'op', runId: 'run' };
  await journalStore.appendThreadEvent(id, { type: 'turn.started', ...identity });
  // Simulate a GET holding an old running snapshot while terminal persistence wins the queue.
  const completing = journalStore.appendThreadEvent(id, { type: 'turn.completed', ...identity });
  assert.equal(typeof journalStore.interruptOrphanedTurn, 'function');
  const reconciling = journalStore.interruptOrphanedTurn(id, identity, () => null);
  await completing;
  assert.equal(await reconciling, null);
  const { state, events } = await journalStore.loadThread(id);
  assert.equal(state.turns[0].status, 'completed');
  assert.equal(events.filter((event) => event.type === 'turn.failed').length, 0);
});

test('orphan reconciliation preserves active or waiting turns and terminates one orphan exactly once', async () => {
  assert.equal(typeof journalStore.interruptOrphanedTurn, 'function');
  const id = `orphan-active-${crypto.randomUUID()}`;
  const identity = { turnId: 'turn', taskId: 'task', operationId: 'op', runId: 'run' };
  await journalStore.appendThreadEvent(id, { type: 'turn.started', ...identity });
  assert.equal(await journalStore.interruptOrphanedTurn(id, identity, () => ({ ...identity })), null);
  const [first, duplicate] = await Promise.all([
    journalStore.interruptOrphanedTurn(id, identity, () => null),
    journalStore.interruptOrphanedTurn(id, identity, () => null),
  ]);
  assert.equal(first.status, 'interrupted');
  assert.equal(duplicate, null);
  const waiting = `orphan-waiting-${crypto.randomUUID()}`;
  await journalStore.appendThreadEvent(waiting, { type: 'turn.started', ...identity });
  await journalStore.appendThreadEvent(waiting, { type: 'item.started', itemType: 'confirmation', itemId: 'approval', item: { request: {} }, ...identity });
  assert.equal(await journalStore.interruptOrphanedTurn(waiting, identity, () => null), null);
  assert.equal((await journalStore.loadThread(waiting)).state.turns[0].status, 'waiting');
});
