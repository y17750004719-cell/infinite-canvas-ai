import test from 'node:test';
import assert from 'node:assert/strict';

import {
  approveApproval,
  assertApprovalMatches,
  consumeApproval,
  createApproval,
  hashApprovalParameters,
  rejectApproval,
} from './approval-state.mjs';

const identity = {
  threadId: 'thread-1', turnId: 'turn-1', operationId: 'op-1', runId: 'run-1',
  itemId: 'item-1', toolName: 'todo_update', expectedSequence: 7,
};
const request = { ...identity, parameters: { items: [{ status: 'completed', id: 'a', content: 'Ship' }] } };

test('parameter hashes are canonical and approval records retain no arguments', () => {
  assert.equal(hashApprovalParameters({ b: 2, a: [1, true] }), hashApprovalParameters({ a: [1, true], b: 2 }));
  const approval = createApproval({ ...request, expiresAt: 2_000 }, { now: 1_000 });
  assert.equal(approval.parametersHash, hashApprovalParameters(request.parameters));
  assert.equal('parameters' in approval, false);
  assert.equal(JSON.stringify(approval).includes('Ship'), false);
});

test('approve and consume are immutable, matched, and single-use', () => {
  const pending = createApproval({ ...request, expiresAt: 5_000 }, { now: 1_000 });
  const approved = approveApproval(pending, request, { now: 1_100 });
  const consumed = consumeApproval(approved, request, { now: 1_200 });
  assert.equal(pending.status, 'pending');
  assert.equal(approved.status, 'approved');
  assert.equal(consumed.status, 'consumed');
  assert.equal(consumed.consumedAt, 1_200);
  assert.throws(() => consumeApproval(consumed, request, { now: 1_300 }), { statusCode: 409, code: 'stale_operation' });
});

test('reject is terminal and cannot be approved or consumed', () => {
  const pending = createApproval({ ...request, expiresAt: 5_000 }, { now: 1_000 });
  const rejected = rejectApproval(pending, request, { now: 1_100 });
  assert.equal(rejected.status, 'rejected');
  assert.throws(() => approveApproval(rejected, request, { now: 1_200 }), { statusCode: 409 });
  assert.throws(() => consumeApproval(rejected, request, { now: 1_200 }), { statusCode: 409 });
});

test('every identity component, sequence, parameters, and expiry are strict', () => {
  const approval = createApproval({ ...request, expiresAt: 5_000 }, { now: 1_000 });
  for (const field of ['threadId', 'turnId', 'operationId', 'runId', 'itemId', 'toolName']) {
    assert.throws(() => assertApprovalMatches(approval, { ...request, [field]: 'different' }, { now: 1_100 }), { statusCode: 409, code: 'stale_operation' });
  }
  assert.throws(() => assertApprovalMatches(approval, { ...request, expectedSequence: 8 }, { now: 1_100 }), { statusCode: 409, code: 'stale_sequence' });
  assert.throws(() => assertApprovalMatches(approval, { ...request, parameters: { items: [] } }, { now: 1_100 }), { statusCode: 409 });
  assert.throws(() => assertApprovalMatches(approval, request, { now: 5_000 }), { statusCode: 409 });
});
