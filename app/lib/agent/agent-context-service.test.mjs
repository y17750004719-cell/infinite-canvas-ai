import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareAgentContext } from './agent-context-service.mjs';

test('context preparation rejects malformed optimistic-concurrency revisions before provider work', async () => {
  const result = await prepareAgentContext({
    body: {
      messages: [{ role: 'user', content: 'hello' }],
      expectedHistoryRevision: 'not-a-number',
    },
    sessionId: 'session-test',
    latestUserMessage: 'hello',
  });
  assert.equal(result.ok, false);
  assert.equal(result.response.status, 400);
  assert.equal(result.response.payload.code, 'invalid_revision');
});

test('context preparation rejects stale snapshots before provider work', async () => {
  const result = await prepareAgentContext({
    body: {
      messages: [{ role: 'user', content: 'hello' }],
      contextHistory: { historyRevision: 3, auditEvents: [] },
      expectedHistoryRevision: 2,
    },
    sessionId: 'session-test',
    latestUserMessage: 'hello',
  });
  assert.equal(result.ok, false);
  assert.equal(result.response.status, 409);
  assert.equal(result.response.payload.code, 'revision_conflict');
});
