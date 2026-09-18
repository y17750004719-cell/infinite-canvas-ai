import test from 'node:test';
import assert from 'node:assert/strict';
import { createAgentMainAgentResultFlow } from './agent-main-agent-result-flow.mjs';
import { createAgentToolResultEvents } from './agent-loop.mjs';
import { resolveAgentResult } from './agent-result-resolution-service.mjs';
import { runAgentRequestMainLoopFromRuntimeState } from './agent-request-stream-run-service.mjs';

const base = { runId: 'run-1', operationId: 'op-1', rootTaskId: 'task-1', checkpoint: { operationId: 'op-1', lastSequence: 7 }, mainAgentLoopState: { selectedSkillId: 'skill-a', skillRead: true, contextScopes: ['conversation'] } };

test('converts request_user_decision into a stable clarification continuation', () => {
  const flow = createAgentMainAgentResultFlow({ idFactory: () => 'clarification-1' });
  const result = flow.resolve({ loopResult: { stopReason: 'confirmation_required', confirmation: { toolName: 'request_user_decision', toolCallId: 'call-1', arguments: { question: 'Choose', dimension: 'tone', recommendedOptionId: 'a', options: [{ id: 'a', label: 'A', answer: 'a' }] } }, transcript: [], turns: 2, toolCalls: 1 }, context: base });
  assert.equal(result.status, 'pending');
  assert.equal(result.kind, 'clarification');
  assert.equal(result.request.id, 'clarification-1');
  assert.equal(result.request.options[0].label, 'A（推荐）');
  assert.equal(result.state.mainAgentLoop.pendingCall.name, 'request_user_decision');
});

test('converts context selection while preserving candidate identity', () => {
  const flow = createAgentMainAgentResultFlow({ idFactory: () => 'context-1' });
  const result = flow.resolve({ loopResult: { stopReason: 'confirmation_required', confirmation: { toolName: 'request_context_selection', message: 'Pick', candidates: [{ id: 'asset-1', label: 'First', kind: 'image' }] }, transcript: [] }, context: base });
  assert.equal(result.kind, 'context_selection');
  assert.equal(result.request.dimension, 'context_reference');
  assert.equal(result.candidates[0].id, 'asset-1');
  assert.equal(result.state.mainAgentLoop.pendingCall.name, 'request_context_selection');
});

test('converts ordinary confirmation into a stable confirmation identity', () => {
  const flow = createAgentMainAgentResultFlow({ idFactory: () => 'confirmation-1' });
  const result = flow.resolve({ loopResult: { stopReason: 'confirmation_required', confirmation: { toolName: 'generate_image', arguments: { prompt: 'x' } }, transcript: [] }, context: base });
  assert.equal(result.kind, 'confirmation');
  assert.equal(result.confirmation.confirmationId, 'confirmation-1');
  assert.equal(result.confirmation.toolName, 'generate_image');
  assert.equal(result.confirmation.taskId, 'task-1');
});

test('delivers a Native image result written during execution to chat and canvas', async () => {
  let nativeGeneratedImageResult = null;
  let directGenerateImageCallId = null;
  let intent = 'chat';
  const emitted = [];
  const completed = {
    status: 'completed',
    result: {
      outputs: [{
        assetId: 'asset-1',
        localUrl: '/api/runtime-assets/asset-1',
        naturalWidth: 1024,
        naturalHeight: 1024,
      }],
    },
  };
  const refs = {
    nativeGeneratedImageResult: {
      get: () => nativeGeneratedImageResult,
      set: (value) => { nativeGeneratedImageResult = value; },
    },
    directGenerateImageCallId: {
      get: () => directGenerateImageCallId,
      set: (value) => { directGenerateImageCallId = value; },
    },
  };

  const execution = await runAgentRequestMainLoopFromRuntimeState({
    executeMainAgentTurn: async () => {
      refs.directGenerateImageCallId.set('call-image-1');
      refs.nativeGeneratedImageResult.set(completed);
      return {
        loopResult: { stopReason: 'completed', content: 'Image generated.' },
        resolveToolNames: () => ['generate_image'],
      };
    },
    mainAgentRegistry: {},
    incrementRequestCount: () => {},
    getAgentRuntimeModelTools: () => [],
    prepareAgentTurnContext: async () => ({}),
    mainAgentReferenceImages: [],
    sessionId: 'session-1',
    latestUserMessage: 'Generate an image',
    body: { messages: [] },
    imagegenHostContent: 'image host',
    imagegenHostContentHash: 'host-hash',
    skillManifests: [],
    resolvedChatSelection: { providerId: 'provider-1', model: 'model-1' },
    resolvedChatProvider: {},
    effectiveProviderProtocol: () => 'responses',
    rootTaskId: () => 'task-1',
    operationId: 'operation-1',
    runId: 'run-1',
    taskId: 'task-1',
    toolCallRecords: [],
    sessionVisualAssets: [],
    imagegenHostSkillId: 'imagegen',
    nativeAgentInstructions: '',
    hashArguments: () => 'hash',
    progressTracker: { snapshot: () => ({ lastSequence: 0 }) },
    currentActivityRef: { value: null },
    appendActivityText: () => {},
    commitCurrentActivity: () => {},
    writeToolStartEvent: () => {},
    writeToolResultEvent: () => {},
    eventSinks: new Map(),
    controller: {},
    finalAssistantTextRef: { value: '' },
    writeLifecycleEvent: () => {},
    interactionService: {},
    mainAgentLoopState: {},
    buildResultContexts: () => ({
      resultContext: {},
      resultResolutionContext: {
        runId: 'run-1',
        operationId: 'operation-1',
        sessionId: 'session-1',
        taskId: 'task-1',
        intentRef: {
          get value() { return intent; },
          set value(value) { intent = value; },
        },
        emitIntentResolved: () => {},
        writeResolvedImageOptionUpdate: () => {},
        createToolResultEvents: createAgentToolResultEvents,
        enrichGeneratedAssetEvents: (events) => events,
        writeStampedAgentEvent: (event) => emitted.push(event),
        writeImageCompletionSummary: () => {},
        updateTopicMemory: () => {},
        commitMainAgentMemory: () => {},
        writeAgentDone: () => {},
      },
    }),
    mainAgentResultFlow: { resolve: () => ({ status: 'completed' }) },
    resolveAgentResult,
    refs,
  });

  assert.equal(execution.resultHandled.handled, true);
  assert.equal(intent, 'image');
  const deliveryEvent = emitted.find((event) => event.type === 'client_action');
  assert.equal(deliveryEvent.action.assets[0].deliveryId, 'generated-delivery:asset-1');
  assert.ok(Number.isFinite(deliveryEvent.action.deliveryEventAt));
  assert.equal(deliveryEvent.action.assets[0].deliveryEventAt, deliveryEvent.action.deliveryEventAt);
  assert.deepEqual(
    {
      ...deliveryEvent,
      action: {
        ...deliveryEvent.action,
        deliveryEventAt: undefined,
        assets: deliveryEvent.action.assets.map((asset) => ({ ...asset, deliveryId: undefined, deliveryEventAt: undefined })),
      },
    },
    {
      type: 'client_action',
      action: {
        type: 'add_generated_assets',
        runId: 'run-1',
        deliveryEventAt: undefined,
        assets: [{
          src: '/api/runtime-assets/asset-1',
          naturalWidth: 1024,
          naturalHeight: 1024,
          assetId: 'asset-1',
          deliveryId: undefined,
          deliveryEventAt: undefined,
        }],
      },
    },
  );
});
