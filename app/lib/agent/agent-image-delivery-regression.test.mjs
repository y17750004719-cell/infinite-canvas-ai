import test from 'node:test';
import assert from 'node:assert/strict';
import { runAgentRequestMainLoop } from './agent-request-stream-run-service.mjs';
import { resolveAgentResult } from './agent-result-resolution-service.mjs';
import { createAgentToolResultEvents } from './agent-loop.mjs';
import { createAgentImageExecutionFlow } from './agent-image-execution-flow.mjs';

function harness({ code = 'provider_overloaded', outputs = true, cancelled = false, queued = false, imageFailure = null, structuredFailure = false, outcomeUnknown = false, generate } = {}) {
  let saved = null;
  let attempts = 0;
  const events = [];
  const failure = Object.assign(new Error('stream disconnected before completion: Our servers are currently overloaded.'), {
    code, failureStage: 'native_runtime', retryable: false, outcomeUnknown,
  });
  const scope = {
    executeMainAgentTurn: async () => {
      attempts += 1;
      if (outputs) saved = generate ? await generate(events) : {
        status: 'completed', assetDeliveryQueued: queued,
        result: { outputs: [{ assetId: 'saved-cat', localUrl: '/api/local-assets/cat.png' }] },
        requestStats: { requested: 1, succeeded: 1, failed: 0 },
      };
      if (structuredFailure) return { loopResult: { stopReason: 'failed', error: failure } };
      throw failure;
    },
    runSignal: { aborted: cancelled },
    nativeRetryState: { getSnapshot: () => ({ providerRequestStarted: true, assetCount: saved ? 1 : 0 }) },
    mainAgentResultFlow: { resolve: ({ loopResult }) => ({ status: 'completed', loopResult }) },
    resolveAgentResult,
    resultResolutionContext: {
      get nativeGeneratedImageResult() { return saved; },
      nativeImageFailure: imageFailure,
      runId: 'run-cat', taskId: 'task-cat', operationId: 'op-cat',
      intentRef: { value: 'image' },
      emitIntentResolved() {}, writeResolvedImageOptionUpdate() {},
      createToolResultEvents: createAgentToolResultEvents,
      enrichGeneratedAssetEvents: (value) => value,
      writeStampedAgentEvent: (event) => events.push(event),
      writeImageCompletionSummary: (payload) => events.push({ type: 'summary', payload }),
      updateTopicMemory() {}, commitMainAgentMemory() {},
      writeAgentDone: (reason) => events.push({ type: 'done', reason }),
    },
  };
  return { run: () => runAgentRequestMainLoop(scope), events, attempts: () => attempts };
}

test('saved image survives a failed Native final response and is delivered without another provider attempt', async () => {
  const h = harness();
  const result = await h.run();
  assert.equal(h.attempts(), 1);
  assert.equal(result.resultHandled.handled, true);
  assert.equal(result.loopResult.postImageResponseFailure.code, 'provider_overloaded');
  assert.equal(h.events.filter((e) => e.action?.type === 'add_generated_assets').length, 1);
  assert.equal(h.events.find((e) => e.type === 'summary').payload.result.outputs[0].assetId, 'saved-cat');
  assert.match(h.events.find((e) => e.type === 'summary').payload.presentation.summary, /结束语.*中断/);
  assert.deepEqual(h.events.at(-1), { type: 'done', reason: 'image_generated' });
});

test('real image execution queues durable delivery before the final Native response fails', async () => {
  let providerCalls = 0;
  let persisted = 0;
  let deliveryFlushed = false;
  const h = harness({ generate: async (events) => {
    const flow = createAgentImageExecutionFlow({
      runId: 'run-cat', taskId: 'task-cat', sessionId: 'session-cat', operationId: 'op-cat',
      resolveSelection: async () => ({ selection: { providerId: 'image-provider', model: 'image-model' } }),
      resolveReferences: async () => [],
      buildRequests: async ({ prompt }) => ({ requests: [{ messages: [{ content: prompt }] }] }),
      reserveTask: async () => ({ taskId: 'task-cat', identities: [{ slotId: 'slot-cat', versionId: 'version-cat' }] }),
      executeBusinessOperation: async (_metadata, run) => run(),
      requestProvider: async () => {
        providerCalls += 1;
        return { status: 'completed', result: { outputs: [{ src: '/temporary-cat.png' }] } };
      },
      materializeAsset: async (asset) => {
        persisted += 1;
        return { ...asset, assetId: 'saved-cat', durableSrc: '/api/local-assets/cat.png' };
      },
      emit: (event) => events.push(event),
      flush: async () => { deliveryFlushed = events.some((event) => event.action?.type === 'add_generated_assets'); },
    });
    const result = await flow.execute({ finalPromptSource: 'a cat', presentation: { title: 'Cat', completionSummary: 'Cat generated.' } });
    assert.equal(deliveryFlushed, true, 'delivery must be flushed before the failing Native continuation');
    return result;
  } });
  await h.run();
  const deliveries = h.events.filter((event) => event.action?.type === 'add_generated_assets');
  assert.equal(providerCalls, 1);
  assert.equal(persisted, 1);
  assert.equal(h.attempts(), 1);
  assert.equal(deliveries.length, 1);
  assert.equal(deliveries[0].action.assets[0].src, '/api/local-assets/cat.png');
  assert.equal(deliveries[0].action.assets[0].deliveryId, 'generated-delivery:version-cat');
  assert.equal(h.events.at(-1).reason, 'image_generated');
});

test('a saved image already queued for delivery is not emitted twice during final-response recovery', async () => {
  const h = harness({ queued: true });
  await h.run();
  assert.equal(h.attempts(), 1);
  assert.equal(h.events.filter((e) => e.action?.type === 'add_generated_assets').length, 0);
  assert.equal(h.events.filter((e) => e.type === 'summary').length, 1);
});

test('saved image delivery also survives normalized timeouts, process exits and structured Native failures', async () => {
  for (const code of ['provider_overloaded', 'native_turn_timeout', 'request_timeout', 'native_process_exited']) {
    for (const structuredFailure of [false, true]) {
      const h = harness({ code, structuredFailure });
      await h.run();
      assert.equal(h.attempts(), 1);
      assert.equal(h.events.filter((event) => event.action?.type === 'add_generated_assets').length, 1);
      assert.equal(h.events.at(-1).reason, 'image_generated');
    }
  }
});

test('post-image completion does not hide missing assets, cancellation, invalid tools or Skill failures', async () => {
  for (const options of [
    { outputs: false }, { cancelled: true }, { code: 'cancelled' }, { outcomeUnknown: true },
    { code: 'skill_lock_failed' }, { code: 'invalid_tool_arguments' },
    { imageFailure: new Error('image outcome unknown') },
  ]) {
    const h = harness(options);
    await assert.rejects(h.run());
    assert.equal(h.attempts(), 1);
    assert.equal(h.events.length, 0);
  }
});
