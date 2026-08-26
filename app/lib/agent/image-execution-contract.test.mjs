import test from 'node:test';
import assert from 'node:assert/strict';

import { assertImageExecutionContract, normalizeImageExecutionContract, toInternalImageExecutionState } from './image-execution-contract.mjs';

const base = {
  operation: 'edit',
  prompt: 'Replace the headline while preserving the layout.',
  referenceIds: ['ref-1'],
  targetReferenceId: 'ref-1',
  outputCount: 1,
  aspectRatio: '2:3',
  deliveryMode: 'single',
  panelCount: null,
  items: [],
};

test('image execution contract accepts a valid edit', () => {
  const contract = assertImageExecutionContract(base, { referenceIds: ['ref-1'], aspectRatios: ['2:3'] });
  assert.equal(contract.targetReferenceId, 'ref-1');
});

test('image execution contract rejects missing references and placeholders', () => {
  const result = normalizeImageExecutionContract({ ...base, referenceIds: ['missing'], prompt: '同上' }, { referenceIds: ['ref-1'] });
  assert.equal(result.contract, null);
  assert.ok(result.errors.some((entry) => entry.code === 'invalid_reference'));
  assert.ok(result.errors.some((entry) => entry.code === 'placeholder'));
  assert.throws(() => assertImageExecutionContract({ ...base, referenceIds: ['missing'] }, { referenceIds: ['ref-1'] }), (error) => error.code === 'invalid_reference');
});

test('image execution contract enforces series item count and generate target rules', () => {
  assert.throws(() => assertImageExecutionContract({ ...base, operation: 'generate', targetReferenceId: 'ref-1' }, { referenceIds: ['ref-1'], aspectRatios: ['2:3'] }), /Generate cannot/);
  assert.throws(() => assertImageExecutionContract({ ...base, deliveryMode: 'series', outputCount: 2 }, { referenceIds: ['ref-1'], aspectRatios: ['2:3'] }), /Series items/);
});

test('internal compatibility state is derived from the direct contract', () => {
  const state = toInternalImageExecutionState(base, { skillId: 'poster' });
  assert.equal(state.execution.tool, 'generate_image');
  assert.deepEqual(state.contextReferences, ['ref-1']);
  assert.equal(state.imageTask.targetReferenceId, 'ref-1');
});
