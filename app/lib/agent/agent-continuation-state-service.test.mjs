import test from 'node:test';
import assert from 'node:assert/strict';
import { createAgentContinuationStateService } from './agent-continuation-state-service.mjs';

test('continuation state persists and clears approval snapshots through the journal adapter', async () => {
  const updates = [];
  const state = createAgentContinuationStateService({
    threadJournal: { updateThreadState: async (...args) => updates.push(args) },
    confirmationTtlMs: 100,
  });
  const record = {
    confirmationId: 'c1', sessionId: 's1', operationId: 'o1', runId: 'r1',
    taskId: 't1', toolName: 'todo_update', toolArgs: { items: [{ id: 'x' }] },
    userMessage: 'approve', status: 'pending', lastSequence: 2, expiresAt: Date.now() + 1000,
  };
  state.setConfirmation('c1', record);
  await Promise.resolve();
  assert.equal(state.getConfirmation('c1'), record);
  assert.equal(updates.at(-1)[1].pendingApproval.confirmationId, 'c1');
  assert.equal(state.deleteConfirmation('c1'), true);
  await Promise.resolve();
  assert.equal(updates.at(-1)[1].pendingApproval, null);
  assert.equal(state.deleteConfirmation('c1'), false);
});

test('continuation state prunes expired confirmations and clarification submissions', () => {
  const state = createAgentContinuationStateService();
  state.setConfirmation('expired', { confirmationId: 'expired', expiresAt: 1 });
  state.setClarificationSubmission('old', 1);
  state.prune(2);
  assert.equal(state.getConfirmation('expired'), undefined);
  assert.equal(state.clarificationSubmissionStore.has('old'), false);
});

test('continuation state routes confirmation persistence through structured callbacks', async () => {
  const calls = [];
  const state = createAgentContinuationStateService({
    persistence: {
      load: async (input) => { calls.push(['load', input]); return { status: 'pending', parameters: { confirmationId: input.confirmationId, sessionId: input.sessionId, expiresAt: Date.now() + 1000 } }; },
      save: async (input) => { calls.push(['save', input]); },
      claim: async (input) => { calls.push(['claim', input]); return { status: 'claimed' }; },
      updateSnapshot: (sessionId, snapshot) => { calls.push(['snapshot', sessionId, snapshot]); },
      clearSnapshot: (sessionId) => { calls.push(['clear', sessionId]); },
    },
  });

  const hydrated = await state.hydrateConfirmation({ sessionId: 's1', confirmationId: 'c1' });
  assert.equal(hydrated.confirmationId, 'c1');
  assert.equal(state.getConfirmation('c1'), hydrated);
  await state.storePendingConfirmation({
    sessionId: 's1', confirmationId: 'c2', taskId: 't2', operationId: 'o2', runId: 'r2',
    contract: { value: true }, parameters: { confirmationId: 'c2', sessionId: 's1', expiresAt: Date.now() + 1000 }, expiresAt: Date.now() + 1000,
  });
  await state.claimStoredConfirmation({ sessionId: 's1', confirmationId: 'c2' });
  state.completeConfirmation('c2');
  assert.deepEqual(calls.map(([kind]) => kind), ['load', 'snapshot', 'snapshot', 'save', 'claim', 'clear']);
});
