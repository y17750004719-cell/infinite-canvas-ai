import test from 'node:test';
import assert from 'node:assert/strict';
import { createAgentContinuationFlow } from './agent-continuation-flow.mjs';

test('recovery scope is validated and converted into a stable continuation decision', () => {
  const flow = createAgentContinuationFlow({
    interactionService: {
      resolveRecoveryContinuation: (input) => ({
        ok: input.mode === 'fill_missing',
        ...(input.mode === 'fill_missing'
          ? { decision: 'resume', mode: input.mode, route: 'main_agent', skillId: 'visual' }
          : { error: { code: 'recovery_mode_invalid' } }),
      }),
    },
  });
  const result = flow.resolveRecovery({
    record: { taskId: 'task-1', resumeRoute: 'main_agent', skillId: 'visual' },
    clarificationRequest: { dimension: 'recovery_scope' },
    clarificationResponse: { selectedOptionId: 'fill_missing' },
  });
  assert.deepEqual(result.resolution, {
    decision: 'resume', route: 'main_agent', skillId: 'visual', confidence: 'high',
  });
  assert.equal(result.mode, 'fill_missing');
});

test('invalid recovery continuation is returned as a structured error', () => {
  const flow = createAgentContinuationFlow({
    interactionService: {
      resolveRecoveryContinuation: () => ({ ok: false, error: { code: 'recovery_mode_invalid' } }),
    },
  });
  const result = flow.resolveRecovery({
    record: { taskId: 'task-1' },
    clarificationRequest: { dimension: 'recovery_scope' },
    clarificationResponse: { selectedOptionId: 'invalid' },
  });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'recovery_mode_invalid');
});

test('a requested task without a resumable route stays unresolved', () => {
  const flow = createAgentContinuationFlow();
  const result = flow.resolveRecovery({ record: { taskId: 'task-1' }, requestedTaskId: 'task-1' });
  assert.equal(result.ok, true);
  assert.equal(result.resolution, null);
});

test('local delivery recovery replays durable assets without entering provider execution', async () => {
  const emitted = [];
  const flow = createAgentContinuationFlow({
    interactionService: {
      resolveRecoveryContinuation: () => ({
        ok: true, decision: 'resume', route: 'local_delivery', skillId: null,
      }),
    },
  });
  const state = {
    runReferenceContext: { references: [] },
    selectedSkill: null,
    skillSource: null,
    skillSelectionMethod: 'none',
    skillCandidateIds: [],
    imageOperation: null,
    targetReferenceId: null,
  };
  const result = await flow.routeRecoveryContinuation({
    state,
    recoveryRecord: {
      taskId: 'task-delivery', runId: 'run-old', resumeRoute: 'local_delivery',
      originalRequest: 'generate', sourceUserMessageId: 'message-1', visualReferenceIds: [],
      taskSnapshot: { activeVersions: [{ referenceId: 'ref-1', slotId: 'slot-1', versionId: 'version-1', assetUrl: '/runtime/asset.png' }] },
    },
    requestedRecoveryTaskId: 'task-delivery', body: { messages: [] }, runId: 'run-new',
    sessionVisualAssets: [], contextEntityById: new Map(), runtimeReferenceById: new Map(),
    normalizeReferenceContext: (value) => value,
    progressTracker: { snapshot: () => ({ operationId: 'operation-1', lastSequence: 1 }) },
    writeProgress: () => {}, writeLifecycleEvent: () => {}, writeInteractionEvent: () => {},
    writeEvent: (_controller, event) => emitted.push(event), writeContextEvent: () => {},
    writeAgentDone: () => {}, contextLogger: { info: () => {} }, controller: {},
    resolvedChatSelection: { model: 'chat-model' }, rootTaskId: () => 'task-delivery',
    skillManifests: [], randomUUID: () => 'id-1',
  });

  assert.equal(result.handled, true);
  assert.equal(result.reason, 'local_delivery_recovered');
  assert.equal(emitted.length, 1);
  assert.equal(emitted[0].action.assets[0].deliveryId, 'generated-delivery:version-1');
  assert.ok(Number.isFinite(emitted[0].action.deliveryEventAt));
});
