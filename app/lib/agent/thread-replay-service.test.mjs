import test from 'node:test';
import assert from 'node:assert/strict';
import { handleThreadReplay } from './thread-replay-service.mjs';

test('thread replay marks a stale active turn interrupted before returning state', async () => {
  let appended;
  const journal = {
    queryThread: async () => ({ state: { activeTurn: 'turn-1', turns: [{ turnId: 'turn-1', runId: 'run-1', operationId: 'op-1' }] }, events: [] }),
    appendThreadEvent: async (_threadId, event) => { appended = event; return { ...event, sequence: 1 }; },
  };
  const request = { nextUrl: { searchParams: new URLSearchParams('threadId=thread-1&afterSequence=2') } };
  const response = await handleThreadReplay(request, { journal, activeRunRegistry: { getActiveAgentRun: () => null } });
  assert.equal(response.status, 200);
  assert.equal(appended.type, 'turn.failed');
  assert.equal(appended.error.code, 'run_interrupted');
});
