import test from 'node:test';
import assert from 'node:assert/strict';
import { createAgentImageExecutionFlow } from './agent-image-execution-flow.mjs';

const IMAGE_OUTPUT = { id: 'asset-1', src: 'data:image/png;base64,valid' };

function createFlow({ providerResult = { outputs: [IMAGE_OUTPUT] }, logs = [], events = [] } = {}) {
  let providerCalls = 0;
  const flow = createAgentImageExecutionFlow({
    runId: 'run-image-flow',
    sessionId: 'session-image-flow',
    taskId: 'task-image-flow',
    operationId: 'operation-image-flow',
    resolveSelection: async () => ({
      selection: { providerId: 'mock-provider', model: 'mock-image-model' },
      allowedModelIds: ['mock-image-model'],
    }),
    resolveReferences: async ({ referenceImages }) => ({
      referenceIds: [],
      linkedImagePreviews: (referenceImages || []).map((src, index) => ({ id: `reference-${index + 1}`, src, label: `image${index + 1}` })),
    }),
    buildRequests: async ({ prompt, outputCount, references }) => ({
      requests: Array.from({ length: outputCount }, () => ({
        messages: [{ role: 'user', content: prompt }],
        reference_images: references.linkedImagePreviews.map((reference) => reference.src),
      })),
      options: { providerId: 'mock-provider', model: 'mock-image-model' },
    }),
    reserveTask: async () => ({ taskId: 'task-image-flow', identities: [{ slotId: 'slot-1' }] }),
    executeBusinessOperation: async (_metadata, execute) => execute(),
    requestProvider: async ({ body, toolCallId }) => {
      providerCalls += 1;
      assert.equal(body.messages[0].content, 'a cat in a studio');
      assert.equal(toolCallId, 'call-image-flow');
      return { status: 'completed', result: providerResult };
    },
    generatedAssetsFromResult: (payload) => payload?.result?.outputs || [],
    materializeAsset: async (asset) => ({ ...asset, assetId: asset.id, durableSrc: `/api/local-assets/${asset.id}` }),
    writeLog: (name, details) => logs.push({ name, details }),
    emit: (event) => events.push(event),
    writeProgress: () => {},
    recordSucceeded: () => {},
    heartbeat: () => () => {},
    flush: async () => {},
  });
  return { flow, getProviderCalls: () => providerCalls };
}

test('streaming multi-image execution materializes each asset only once', async () => {
  let persisted = 0;
  const streamingFlow = createAgentImageExecutionFlow({
    runId: 'run-stream', sessionId: 'session-stream', taskId: 'task-stream', operationId: 'op-stream',
    resolveSelection: async () => ({ selection: { providerId: 'mock', model: 'model' }, allowedModelIds: ['model'] }),
    resolveReferences: async () => ({ referenceIds: [], linkedImagePreviews: [] }),
    buildRequests: async ({ prompt, outputCount }) => ({ requests: Array.from({ length: outputCount }, () => ({ messages: [{ content: prompt }] })), options: {} }),
    reserveTask: async () => ({ identities: [{ slotId: '0' }, { slotId: '1' }] }),
    executeBusinessOperation: async (_meta, run) => run(),
    requestProvider: async ({ body }) => ({ status: 'completed', result: { outputs: [{ id: body.messages[0].content, src: 'data:image/png;base64,x' }] } }),
    generatedAssetsFromResult: (payload) => payload?.result?.outputs || [],
    materializeAsset: async (asset) => { persisted += 1; return { ...asset, assetId: `saved-${persisted}` }; },
    writeLog: () => {}, emit: () => {}, writeProgress: () => {}, recordSucceeded: () => {}, heartbeat: () => () => {}, flush: async () => {},
  });
  const result = await streamingFlow.execute({ finalPromptSource: 'cat', imageOptions: { count: 2 }, countMetadata: { totalCount: 2 }, imageTask: { operation: 'generate' }, streamOptions: { enabled: true, toolCallId: 'stream-call' } });
  assert.equal(result.result.outputs.length, 2);
  assert.equal(persisted, 2);
});

test('image execution reaches the provider and delivers an asset without a selected Skill', async () => {
  const logs = [];
  const events = [];
  const { flow, getProviderCalls } = createFlow({ logs, events });
  const result = await flow.execute({
    finalPromptSource: 'a cat in a studio',
    imageOptions: { count: 1 },
    countMetadata: { totalCount: 1 },
    referenceImages: [],
    imageTask: { operation: 'generate', selectedSkillId: null },
    streamOptions: { toolCallId: 'call-image-flow', commentaryFallbackUsed: true },
  });

  assert.equal(getProviderCalls(), 1);
  assert.equal(result.status, 'completed');
  assert.equal(result.result.outputs[0].assetId, 'asset-1');
  const deliveries = events.filter((event) => event.action?.type === 'add_generated_assets');
  assert.equal(deliveries.length, 1, 'saved images must be delivered before the Native turn resumes');
  assert.equal(deliveries[0].action.assets[0].src, '/api/local-assets/asset-1');
  assert.equal(deliveries[0].action.assets[0].deliveryId, 'generated-delivery:asset-1');
  assert.equal(deliveries[0].action.providerId, 'mock-provider');
  assert.equal(result.assetDeliveryQueued, true);
  assert.ok(Number.isFinite(result.result.outputs[0].providerReturnedAt));
  assert.ok(Number.isFinite(result.result.outputs[0].locallyStoredAt));
  assert.ok(result.result.outputs[0].locallyStoredAt >= result.result.outputs[0].providerReturnedAt);
  assert.equal(logs.find((entry) => entry.name === 'image.provider_request_started').details.providerRequestStarted, true);
  assert.equal(logs.find((entry) => entry.name === 'image.execution_completed').details.selectedSkillId, null);
  assert.equal(logs.find((entry) => entry.name === 'image.execution_completed').details.assetCount, 1);
});

test('model-selected reference images are carried into the provider request', async () => {
  let providerBody;
  const flow = createAgentImageExecutionFlow({
    runId: 'run-reference', sessionId: 'session-reference', taskId: 'task-reference', operationId: 'op-reference',
    resolveSelection: async () => ({ selection: { providerId: 'mock', model: 'model' }, allowedModelIds: ['model'] }),
    resolveReferences: async ({ referenceImages }) => ({ referenceIds: ['reference-1'], linkedImagePreviews: (referenceImages || []).map((src) => ({ id: 'reference-1', src, label: 'selected reference' })) }),
    buildRequests: async ({ prompt, references }) => ({ requests: [{ messages: [{ role: 'user', content: prompt }], reference_images: references.linkedImagePreviews.map((item) => item.src) }], options: {} }),
    reserveTask: async () => ({ identities: [{ slotId: 'slot-1' }] }),
    executeBusinessOperation: async (_meta, run) => run(),
    requestProvider: async ({ body }) => { providerBody = body; return { status: 'completed', result: { outputs: [{ id: 'asset-ref', src: 'data:image/png;base64,ref' }] } }; },
    generatedAssetsFromResult: (payload) => payload?.result?.outputs || [],
    materializeAsset: async (asset) => ({ ...asset, assetId: asset.id, durableSrc: `/api/local-assets/${asset.id}` }),
    emit: () => {}, writeProgress: () => {}, writeLog: () => {}, recordSucceeded: () => {}, heartbeat: () => () => {}, flush: async () => {},
  });
  await flow.execute({
    finalPromptSource: 'edit the selected reference', imageOptions: { count: 1 }, countMetadata: { totalCount: 1 },
    referenceImages: ['data:image/png;base64,selected'], imageTask: { operation: 'edit', targetReferenceId: 'reference-1' },
    streamOptions: { toolCallId: 'call-reference' }, referenceContext: { references: [{ id: 'reference-1', assetId: 'asset-input' }] },
  });
  assert.deepEqual(providerBody.reference_images, ['data:image/png;base64,selected']);
});

test('image execution preserves the selected Skill identity without changing provider reachability', async () => {
  const logs = [];
  const { flow, getProviderCalls } = createFlow({ logs });
  const result = await flow.execute({
    finalPromptSource: 'a cat in a studio',
    imageOptions: { count: 1 },
    countMetadata: { totalCount: 1 },
    imageTask: { operation: 'generate', selectedSkillId: 'poster' },
    streamOptions: { toolCallId: 'call-image-flow', commentarySource: 'raw_response_item' },
  });

  assert.equal(getProviderCalls(), 1);
  assert.equal(result.status, 'completed');
  assert.equal(logs.find((entry) => entry.name === 'image.requests_built').details.selectedSkillId, 'poster');
  assert.equal(logs.find((entry) => entry.name === 'image.execution_completed').details.assetCount, 1);
});

test('image execution classifies a completed provider response with no asset as local delivery failure', async () => {
  const logs = [];
  const { flow } = createFlow({ providerResult: { outputs: [] }, logs });
  await assert.rejects(
    () => flow.execute({
      finalPromptSource: 'a cat in a studio',
      imageOptions: { count: 1 },
      countMetadata: { totalCount: 1 },
      imageTask: { operation: 'generate', selectedSkillId: null },
      streamOptions: { toolCallId: 'call-image-flow' },
    }),
    (error) => error.failureStage === 'local_delivery' && error.providerRequestStarted === true,
  );
  const failed = logs.find((entry) => entry.name === 'image.execution_failed');
  assert.equal(failed.details.failureStage, 'local_delivery');
  assert.equal(failed.details.providerRequestStarted, true);
});
