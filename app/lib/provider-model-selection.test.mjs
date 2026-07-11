import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveProviderModelSelection } from './provider-model-selection.mjs';

const providers = [
  {
    id: 'primary',
    enabled: true,
    primary: true,
    chatModels: ['primary-chat'],
    imageModels: ['primary-image'],
  },
  {
    id: 'secondary',
    enabled: true,
    primary: false,
    chatModels: ['secondary-chat', 'shared-chat'],
    imageModels: ['secondary-image'],
  },
  {
    id: 'disabled',
    enabled: false,
    primary: false,
    chatModels: ['disabled-chat'],
    imageModels: ['disabled-image'],
  },
];

test('keeps an exact enabled provider and chat model pair', () => {
  assert.deepEqual(
    resolveProviderModelSelection({
      providers,
      purpose: 'chat',
      requestedProviderId: 'secondary',
      requestedModel: 'shared-chat',
    }),
    {
      providerId: 'secondary',
      model: 'shared-chat',
      fallback: false,
      reason: 'exact',
    }
  );
});

test('falls back to the first purpose model on the requested provider', () => {
  assert.deepEqual(
    resolveProviderModelSelection({
      providers,
      purpose: 'image',
      requestedProviderId: 'secondary',
      requestedModel: 'primary-image',
    }),
    {
      providerId: 'secondary',
      model: 'secondary-image',
      fallback: true,
      reason: 'requested_provider_first_model',
    }
  );
});

test('preserves a requested model by moving to another enabled provider', () => {
  assert.deepEqual(
    resolveProviderModelSelection({
      providers,
      purpose: 'chat',
      requestedProviderId: 'missing',
      requestedModel: 'shared-chat',
    }),
    {
      providerId: 'secondary',
      model: 'shared-chat',
      fallback: true,
      reason: 'requested_model_other_provider',
    }
  );
});

test('uses the primary provider before the first capable provider', () => {
  assert.deepEqual(
    resolveProviderModelSelection({
      providers,
      purpose: 'image',
      requestedProviderId: 'missing',
      requestedModel: 'missing-image',
    }),
    {
      providerId: 'primary',
      model: 'primary-image',
      fallback: true,
      reason: 'primary_provider_first_model',
    }
  );
});

test('uses the first capable provider when the primary has no model for the purpose', () => {
  assert.deepEqual(
    resolveProviderModelSelection({
      providers: [
        { ...providers[0], imageModels: [] },
        providers[1],
      ],
      purpose: 'image',
    }),
    {
      providerId: 'secondary',
      model: 'secondary-image',
      fallback: true,
      reason: 'first_capable_provider',
    }
  );
});

test('ignores disabled providers and reports when no enabled model is available', () => {
  assert.deepEqual(
    resolveProviderModelSelection({
      providers: [providers[2]],
      purpose: 'chat',
      requestedProviderId: 'disabled',
      requestedModel: 'disabled-chat',
    }),
    {
      providerId: null,
      model: null,
      fallback: true,
      reason: 'no_capable_provider',
    }
  );
});
