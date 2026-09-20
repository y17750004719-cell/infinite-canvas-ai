import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { prepareAgentRequestExecution } from './agent-request-preparation-orchestrator.mjs';
import { prepareAgentMainAgentState, createAgentReferenceLookupContext, createAgentMainAgentReferenceState } from './agent-request-execution-context-service.mjs';
import { createInteractionService } from './agent-interaction-service.mjs';
import { resolveRequestInteraction } from './agent-confirmation-continuation-service.mjs';
import { createAgentContinuationFlow } from './agent-continuation-flow.mjs';
import { createAgentRuntimeImageToolHandler } from './agent-runtime-tool-registry-service.mjs';
import { runAgentRequestMainLoopFromRuntimeState } from './agent-request-stream-run-service.mjs';
import { createExecutionRecoveryRecord } from './agent-recovery-service.mjs';

const hash = (value) => createHash('sha256').update(value).digest('hex');
const noop = () => {};
const skill = { id: 'gc-minimal-zine-poster-v0-1', name: 'Poster', executionMode: 'image_pipeline', allowedTools: ['generate_image'] };

function harness({ content = 'poster rules', expectedHash = hash('poster rules') } = {}) {
  const taskId = 'fdd2f9c3-bf0c-46ba-a9f8-3bbab35a8183';
  const record = { taskId, runId: 'old-run', operationId: 'op', skillId: skill.id, skillContentHash: expectedHash,
    originalRequest: 'Create a poster', sourceUserMessageId: 'source', resumeRoute: 'main_agent',
    completedAssetCount: 0, visualReferenceIds: [], failure: { stage: 'tool_dispatch' } };
  const body = { intent: 'image', skillSelectionSource: 'recovery', recoveryTaskId: taskId, messages: [{ id: 'source', role: 'user', content: record.originalRequest }] };
  const state = { selectedSkill: null, skillContent: '', skillContentHash: '', runReferenceContext: { references: [] }, executionReferenceImages: [] };
  const interactionService = createInteractionService({ loadSkillContent: async () => content });
  let providerCalls = 0;
  const scope = {
    body, state, interactionService, skillManifests: [skill], providers: [], sessionId: 'session', runId: 'new-run',
    latestUserMessage: record.originalRequest, contextEntities: [], sessionVisualAssets: [], generatedImageHistory: [],
    contextLogger: { info: noop }, progressTracker: { snapshot: () => ({ operationId: 'op', lastSequence: 0 }) },
    resolveRequestInteraction, createReferenceLookupContext: createAgentReferenceLookupContext,
    createReferenceState: createAgentMainAgentReferenceState, recentFailedTask: record, requestedRecoveryTaskId: taskId,
    continuationFlow: createAgentContinuationFlow({ interactionService }), normalizeReferenceContext: (value) => value,
    applyImageOperationResponse: noop, prepareMainAgentState: prepareAgentMainAgentState,
    ensureImagegenHostContent: async () => 'imagegen rules',
    // Runtime getters still see the pre-routing null selection until preparation returns.
    ensureSelectedSkillContent: async () => '', getSkillContentHash: () => '',
    hash, imagegenHostSkillId: 'imagegen', rootTaskId: () => taskId, rootOriginalRequest: () => record.originalRequest,
    resolvedChatSelection: { model: 'mock' }, writeProgress: noop, writeEvent: noop, writeLifecycleEvent: noop,
  };
  const executeImage = async (mainAgentLoopState = {}) => {
    const handler = createAgentRuntimeImageToolHandler({
      body, runId: 'new-run', sessionId: 'session', rootTaskId: () => taskId,
      getSelectedSkill: () => state.selectedSkill, getSkillContentHash: () => state.skillContentHash,
      mainAgentLoopState, toolCallRecords: [],
      runtimeReferenceById: new Map(), hashPrompt: hash, contextLogger: { info: noop }, positiveInteger: (value) => Number(value) || null,
      AGENT_DEFAULT_IMAGE_OPTIONS: { aspectRatio: '1:1' }, AGENT_MAX_IMAGE_BATCH_COUNT: 4,
      assertImageExecutionContract: (value) => value,
      assertLockedImageSkill: (selected, expected) => interactionService.assertLockedSkill(selected, expected),
      setDirectGenerateImageCallId: noop, setDirectGenerateImageCall: noop, setExecutionReferenceImages: noop,
      setImageOperation: noop, setTargetReferenceId: noop, setIntent: noop, setLockedImageToolArgs: noop,
      emitIntentResolved: noop, setRequestedTotalImageCount: noop, setRequestedImageCount: noop,
      setRequestedImageCountSource: noop, setExecutionKind: noop, setImageDeliveryPlan: noop,
      setDirectImageExecution: noop, setWorkingContextData: noop, setWorkingContext: noop,
      writeLifecycleEvent: noop, writeProgress: noop, writeToolProgress: noop,
      getRunReferenceContext: () => ({ references: [] }), setNativeGeneratedImageResult: noop, setNativeImageFailure: noop,
      runSignal: new AbortController().signal, generatedAssetsFromResult: (result) => result.assets || [],
      executeImagePayload: async () => { providerCalls += 1; return { assets: [{ assetId: 'asset' }] }; },
    });
    const result = await handler({ operation: 'generate', prompt: 'Create a poster', outputCount: 1 }, { toolCallId: 'call' });
    await assert.rejects(() => handler({ operation: 'generate', prompt: 'Create a poster' }, { toolCallId: 'call' }));
    return result;
  };
  const execute = async () => {
    const prepared = await prepareAgentRequestExecution(scope);
    assert.equal(prepared.handled, false);
    assert.equal(state.skillContent, content);
    assert.equal(state.skillContentHash, hash(content));
    return executeImage(prepared.preparationState.mainAgentLoopState);
  };
  return { execute, executeImage, state, providerCalls: () => providerCalls };
}

test('recovery loads the routed Skill and executes the image handler once without manual selection', async () => {
  const h = harness();
  const result = await h.execute();
  assert.equal(h.state.skillSource, 'recovery');
  assert.equal(result.modelResult.assetCount, 1);
  assert.equal(h.providerCalls(), 1);
});

test('changed recovery Skill hash fails at skill_selection before any image execution', async () => {
  const h = harness({ content: 'changed rules' });
  await assert.rejects(h.execute, (error) => error.code === 'skill_lock_failed' && error.failureStage === 'skill_selection');
  assert.equal(h.providerCalls(), 0);
});

test('Native automatic Skill selection updates live state and reaches image execution once', async () => {
  const h = harness();
  const events = [];
  const loopState = {};
  await runAgentRequestMainLoopFromRuntimeState({
    body: { messages: [] }, toolCallRecords: [], runId: 'run-auto', taskId: 'task-auto', operationId: 'op-auto',
    skillManifests: [skill], mainAgentLoopState: loopState, sessionVisualAssets: [], finalAssistantTextRef: { value: '' },
    progressTracker: { snapshot: () => ({ lastSequence: 0 }) },
    interactionService: createInteractionService({ loadSkillContent: async () => 'poster rules' }),
    hashPrompt: hash, writeLifecycleEvent: (event) => events.push(event),
    refs: Object.fromEntries(['selectedSkill', 'skillContent', 'skillContentHash', 'skillSource', 'visualSkillLoaded'].map((name) => [
      name, { get: () => h.state[name], set: (value) => { h.state[name] = value; } },
    ])),
    buildResultContexts: () => ({}), mainAgentResultFlow: { resolve: () => ({}) }, resolveAgentResult: async () => ({ handled: true }),
    executeMainAgentTurn: async ({ onSkillSelection }) => {
      const result = await onSkillSelection({ args: { skillId: skill.id, confidence: 'high' } });
      assert.equal(result.isError, undefined);
      assert.equal(result.modelResult.content, 'poster rules');
      assert.equal(loopState.skillSelectionFailed, undefined);
      await h.executeImage(loopState);
      return { loopResult: { stopReason: 'completed' } };
    },
  });
  assert.equal(h.providerCalls(), 1);
  assert.equal(events[0].skillId, skill.id);
  assert.equal(events[0].skillContentHash, hash('poster rules'));
  const recovery = createExecutionRecoveryRecord({
    taskId: 'task-auto', runId: 'run-auto', operationId: 'op-auto', sessionId: 'session', sourceUserMessageId: 'source',
    latestUserMessage: 'Create a poster', intent: 'image', stage: 'native_request', message: 'Disconnected',
    selectedSkill: h.state.selectedSkill, skillContentHash: h.state.skillContentHash,
  });
  assert.equal(recovery.skillId, skill.id);
  assert.equal(recovery.skillContentHash, hash('poster rules'));
});
