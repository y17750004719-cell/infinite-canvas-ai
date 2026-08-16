import assert from 'node:assert/strict';
import test from 'node:test';
import {
  completeImagePlanningStage,
  createImagePlanningSnapshot,
  restoreImagePlanningSnapshot,
} from './image-planning.mjs';

const input = {
  taskId: 'task',
  runId: 'run',
  sourceUserMessageId: 'message',
  originalRequest: 'Create an architectural poster.',
  resolvedRequirement: 'Create a restrained architectural poster using the supplied courtyard reference.',
  aspectRatio: '3:4',
  referenceIds: ['ref-1'],
};

test('image planning stores resolved intent and moves directly from routing to execution', () => {
  const snapshot = createImagePlanningSnapshot(input);
  assert.equal(snapshot.currentStage, 'routing');
  assert.equal(snapshot.resolvedRequirement, input.resolvedRequirement);
  completeImagePlanningStage(snapshot, 'routing', 'execution');
  assert.equal(snapshot.currentStage, 'execution');
  assert.deepEqual(Object.keys(snapshot.stages), ['routing', 'execution']);
});

test('unfinished legacy compilation snapshots restart at direct routing without their prompt artifact', () => {
  const restored = restoreImagePlanningSnapshot({
    ...input,
    version: 2,
    currentStage: 'compilation',
    operation: 'generate',
    stages: { routing: { status: 'completed' }, compilation: { status: 'in_progress' } },
    compilation: { renderPrompt: 'stale prompt' },
  });
  assert.equal(restored.version, 4);
  assert.equal(restored.currentStage, 'routing');
  assert.equal(restored.executionPlan, null);
  assert.equal(restored.stages.routing.status, 'in_progress');
});

test('completed legacy contracts remain immutable for supplier-only retries', () => {
  const executionPlan = { version: 4, intent: 'image', generation: { prompt: 'Planner prompt' } };
  const restored = restoreImagePlanningSnapshot({
    ...input,
    version: 2,
    currentStage: 'local_finalization',
    operation: 'generate',
    executionPlan,
    stages: { local_finalization: { status: 'completed' } },
  });
  assert.equal(restored.currentStage, 'execution');
  assert.deepEqual(restored.executionPlan, executionPlan);
  assert.equal(restored.stages.execution.status, 'completed');
});

test('incomplete execution snapshots return to routing instead of reusing an incomplete contract', () => {
  const snapshot = createImagePlanningSnapshot({ ...input, currentStage: 'execution' });
  const restored = restoreImagePlanningSnapshot(snapshot);
  assert.equal(restored.currentStage, 'routing');
  assert.equal(restored.executionPlan, null);
});

test('completed contracts remain retryable when their legacy snapshot lacks ImageGen context', () => {
  const snapshot = createImagePlanningSnapshot({ ...input, currentStage: 'execution' });
  snapshot.executionPlan = { version: 4, intent: 'image' };
  snapshot.stages.execution.status = 'completed';
  delete snapshot.imagegenContext;
  const restored = restoreImagePlanningSnapshot(snapshot);
  assert.equal(restored.imagegenContext, null);
  assert.equal(restored.currentStage, 'execution');
});
