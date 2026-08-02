import assert from 'node:assert/strict';
import test from 'node:test';
import {
  claimConfirmationContinuation,
  fingerprintProviderModel,
  hashEnvelopeValue,
  resolveConfirmationImageIdentity,
  resolveRemainingConfirmationTaskIdentities,
} from './confirmation-continuation.mjs';

const providers = [{
  id: 'provider-1',
  enabled: true,
  primary: true,
  protocol: 'openai',
  baseUrl: 'https://example.invalid',
  chatModels: ['model-1'],
  modelProtocols: { 'model-1': 'openai' },
}];

function createRecord() {
  const toolArgs = { value: 'ok' };
  return {
    version: 1,
    status: 'pending',
    toolName: 'mutate',
    toolArgs,
    userMessage: 'run',
    resolvedProviderId: 'provider-1',
    resolvedModel: 'model-1',
    providerModelFingerprint: fingerprintProviderModel(providers[0], 'model-1'),
    pendingToolCall: {
      id: 'call-1',
      name: 'mutate',
      args: toolArgs,
      argsHash: hashEnvelopeValue(toolArgs),
      batch: [{ id: 'call-1', name: 'mutate', args: toolArgs }],
    },
    expiresAt: Date.now() + 60_000,
  };
}

test('confirmation continuation can be claimed exactly once', () => {
  const record = createRecord();
  claimConfirmationContinuation({ record, requestedToolName: 'mutate', userMessage: 'run', providers });
  assert.equal(record.status, 'executing');
  assert.throws(
    () => claimConfirmationContinuation({ record, requestedToolName: 'mutate', userMessage: 'run', providers }),
    /already been submitted/,
  );
});

test('confirmation continuation rejects an expired record before mutation', () => {
  const record = { ...createRecord(), expiresAt: Date.now() - 1 };
  assert.throws(
    () => claimConfirmationContinuation({ record, requestedToolName: 'mutate', userMessage: 'run', providers }),
    /expired/,
  );
  assert.equal(record.status, 'pending');
});

test('confirmation continuation rejects a disabled exact provider and model pair', () => {
  const record = createRecord();
  const disabledProviders = [{ ...providers[0], enabled: false }];
  assert.throws(
    () => claimConfirmationContinuation({
      record,
      requestedToolName: 'mutate',
      userMessage: 'run',
      providers: disabledProviders,
    }),
    /no longer enabled/,
  );
  assert.equal(record.status, 'pending');
});

test('confirmation continuation rejects changed arguments', () => {
  const record = createRecord();
  record.toolArgs = { value: 'changed' };
  assert.throws(
    () => claimConfirmationContinuation({ record, requestedToolName: 'mutate', userMessage: 'run', providers }),
    /envelope is invalid/,
  );
  assert.equal(record.status, 'pending');
});

test('confirmation continuation rejects changed per-model transport configuration', () => {
  const record = createRecord();
  const changedProviders = [{ ...providers[0], modelProtocols: { 'model-1': 'gemini' } }];
  assert.throws(
    () => claimConfirmationContinuation({
      record,
      requestedToolName: 'mutate',
      userMessage: 'run',
      providers: changedProviders,
    }),
    /no longer enabled/,
  );
  assert.equal(record.status, 'pending');
});

test('confirmation continuation pins image provider and model selection', () => {
  const imageProviders = [{
    ...providers[0],
    imageModels: ['image-1'],
    imageRequestMode: 'image_generation',
    imageGenerationEndpoint: '/images/generations',
    imageEditEndpoint: '/images/edits',
  }];
  const toolArgs = { prompt: 'render' };
  const createImageRecord = () => ({
    version: 1,
    status: 'pending',
    toolName: 'generate_image',
    toolArgs,
    userMessage: 'render',
    resolvedImageProviderId: 'provider-1',
    resolvedImageModel: 'image-1',
    imageProviderModelFingerprint: fingerprintProviderModel(imageProviders[0], 'image-1', 'image'),
    pendingToolCall: {
      id: 'call-image-1',
      name: 'generate_image',
      args: toolArgs,
      argsHash: hashEnvelopeValue(toolArgs),
    },
    expiresAt: Date.now() + 60_000,
  });
  for (const changedProvider of [
    { ...imageProviders[0], imageModels: ['image-2'] },
    { ...imageProviders[0], imageRequestMode: 'chat_completions' },
    { ...imageProviders[0], imageGenerationEndpoint: '/v2/images/generations' },
    { ...imageProviders[0], imageEditEndpoint: '/v2/images/edits' },
  ]) {
    const record = createImageRecord();
    assert.throws(
      () => claimConfirmationContinuation({
        record,
        requestedToolName: 'generate_image',
        userMessage: 'render',
        providers: [changedProvider],
      }),
      /no longer enabled/,
    );
    assert.equal(record.status, 'pending');
  }
});

test('confirmation continuation validates chat and image identities independently', () => {
  const imageProvider = {
    id: 'provider-2',
    enabled: true,
    protocol: 'openai',
    baseUrl: 'https://images.example.invalid',
    chatModels: [],
    imageModels: ['image-1'],
  };
  const record = createRecord();
  record.resolvedImageProviderId = imageProvider.id;
  record.resolvedImageModel = 'image-1';
  record.imageProviderModelFingerprint = fingerprintProviderModel(imageProvider, 'image-1', 'image');

  claimConfirmationContinuation({
    record,
    requestedToolName: 'mutate',
    userMessage: 'run',
    providers: [...providers, imageProvider],
  });
  assert.equal(record.status, 'executing');
});

test('chained confirmation derives image identity for the newly pending tool', () => {
  const imageProvider = {
    ...providers[0],
    imageModels: ['image-1'],
    imageRequestMode: 'image_generation',
    imageGenerationEndpoint: '/images/generations',
  };
  const toolArgs = { prompt: 'render' };
  const record = {
    ...createRecord(),
    toolName: 'generate_image',
    toolArgs,
    pendingToolCall: {
      id: 'call-image-2',
      name: 'generate_image',
      args: toolArgs,
      argsHash: hashEnvelopeValue(toolArgs),
      batch: [{ id: 'call-image-2', name: 'generate_image', args: toolArgs }],
    },
    ...resolveConfirmationImageIdentity({
      providers: [imageProvider],
      toolName: 'generate_image',
    }),
  };

  claimConfirmationContinuation({
    record,
    requestedToolName: 'generate_image',
    userMessage: 'run',
    providers: [imageProvider],
  });

  assert.equal(record.status, 'executing');
  assert.equal(record.resolvedImageProviderId, 'provider-1');
  assert.equal(record.resolvedImageModel, 'image-1');
});

test('chained confirmation clears inherited image identity for a non-image tool', () => {
  const record = {
    resolvedImageProviderId: 'provider-1',
    resolvedImageModel: 'image-1',
    imageProviderModelFingerprint: 'stale',
    ...resolveConfirmationImageIdentity({ providers, toolName: 'mutate' }),
  };

  assert.equal(record.resolvedImageProviderId, undefined);
  assert.equal(record.resolvedImageModel, undefined);
  assert.equal(record.imageProviderModelFingerprint, undefined);
});

test('partial image failure retries failed current identities before untouched identities', () => {
  const identity = (slotId) => ({ slotId, versionId: `version-${slotId}`, batchId: 'batch-1' });
  const queued = resolveRemainingConfirmationTaskIdentities({
    pendingTaskIdentities: [identity('slot-1'), identity('slot-2'), identity('slot-3')],
    remainingTaskIdentities: [identity('slot-4'), identity('slot-5')],
    completedTaskIdentities: [identity('slot-1'), identity('slot-3')],
  });
  const nextBatch = queued.slice(0, 2);
  const laterBatch = queued.slice(2);

  assert.deepEqual(queued.map(({ slotId }) => slotId), ['slot-2', 'slot-4', 'slot-5']);
  assert.deepEqual(nextBatch.map(({ versionId }) => versionId), ['version-slot-2', 'version-slot-4']);
  assert.equal(nextBatch.length + laterBatch.length, 3);
});
