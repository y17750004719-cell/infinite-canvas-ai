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

test('image planning stores resolved intent and moves directly from routing to the background Planner', () => {
  const snapshot = createImagePlanningSnapshot(input);
  assert.equal(snapshot.currentStage, 'routing');
  assert.equal(snapshot.resolvedRequirement, input.resolvedRequirement);
  completeImagePlanningStage(snapshot, 'routing', 'image_planner');
  assert.equal(snapshot.currentStage, 'image_planner');
  assert.deepEqual(Object.keys(snapshot.stages), ['routing', 'image_planner', 'execution']);
});

test('unfinished legacy compilation snapshots restart at the background Planner without their prompt artifact', () => {
  const restored = restoreImagePlanningSnapshot({
    ...input,
    version: 2,
    currentStage: 'compilation',
    operation: 'generate',
    stages: { routing: { status: 'completed' }, compilation: { status: 'in_progress' } },
    compilation: { renderPrompt: 'stale prompt' },
  });
  assert.equal(restored.version, 3);
  assert.equal(restored.currentStage, 'image_planner');
  assert.equal(restored.executionPlan, null);
  assert.equal(restored.stages.routing.status, 'completed');
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

test('incomplete execution snapshots return to the Planner instead of reusing an incomplete contract', () => {
  const snapshot = createImagePlanningSnapshot({ ...input, currentStage: 'execution' });
  const restored = restoreImagePlanningSnapshot(snapshot);
  assert.equal(restored.currentStage, 'routing');
  assert.equal(restored.executionPlan, null);
});
