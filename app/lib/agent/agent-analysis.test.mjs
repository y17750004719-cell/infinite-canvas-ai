import assert from 'node:assert/strict';
import test from 'node:test';

import {
  applyAgentAnalysisCheckpoint,
  createAgentAnalysisSnapshot,
  recordAgentUserDecision,
} from './agent-analysis.mjs';

const checkpoint = (index) => ({
  objective: `Analyze ${index}`,
  currentUnderstanding: { goal: 'Ship the result', expectedResult: 'A reliable answer', domain: 'other' },
  evidence: [],
  workingAssumptions: [],
  constraints: [],
  unresolvedQuestions: [{ dimension: 'scope', reason: 'Needs more analysis', resolvableBy: 'analysis' }],
  nextFocus: 'Resolve scope',
});

test('analysis checkpoints preserve locked facts and stop after three active checkpoints', () => {
  const snapshot = createAgentAnalysisSnapshot({
    taskId: 'task-1', runId: 'run-1', originalRequest: 'Compare architectures',
    selectedSkillId: 'skill-1', explicitReferenceIds: ['ref-1'],
  });
  for (let index = 1; index <= 3; index += 1) applyAgentAnalysisCheckpoint(snapshot, checkpoint(index));
  recordAgentUserDecision(snapshot, 'scope', 'Migrate incrementally');
  assert.equal(snapshot.checkpointCount, 3);
  assert.equal(snapshot.lockedFacts.selectedSkillId, 'skill-1');
  assert.deepEqual(snapshot.lockedFacts.explicitReferenceIds, ['ref-1']);
  assert.deepEqual(snapshot.lockedFacts.userDecisions, [{ dimension: 'scope', answer: 'Migrate incrementally' }]);
  assert.throws(() => applyAgentAnalysisCheckpoint(snapshot, checkpoint(4)), /limit reached/);
});
