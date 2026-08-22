import assert from 'node:assert/strict';
import test from 'node:test';

import {
  listAlternativeProviderModelSelections,
  resolveProviderModelCapabilities,
  resolveProviderModelSelection,
} from './provider-model-selection.mjs';

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

test('lists consent-gated alternative chat models with primary provider first', () => {
  assert.deepEqual(
    listAlternativeProviderModelSelections({
      providers,
      currentProviderId: 'secondary',
      currentModel: 'secondary-chat',
      limit: 3,
    }),
    [
      { providerId: 'primary', providerName: 'primary', model: 'primary-chat' },
      { providerId: 'secondary', providerName: 'secondary', model: 'shared-chat' },
    ],
  );
});

test('derives Xiaomi MiMo vision capability from its configured protocol', () => {
  const capabilities = resolveProviderModelCapabilities({ id: 'xiaomi', protocol: 'openai' }, 'mimo-v2.5');
  assert.deepEqual(capabilities.input, ['text']);
  assert.equal(capabilities.supportsVision, false);
  assert.equal(capabilities.supportsToolCalling, true);
  assert.equal(capabilities.supportsRequiredToolChoice, false);

  const geminiCapabilities = resolveProviderModelCapabilities({
    id: 'xiaomi',
    protocol: 'openai',
    modelProtocols: { 'mimo-v2.5': 'gemini' },
  }, 'mimo-v2.5');
  assert.deepEqual(geminiCapabilities.input, ['text', 'image']);
  assert.equal(geminiCapabilities.supportsVision, true);
  assert.equal(geminiCapabilities.supportsRequiredToolChoice, false);
});

test('uses per-model Gemini protocol overrides for reference-image planning', () => {
  for (const model of [
    'gemini-3.5-flash-thinking-minimal',
    'gemini-3.6-flash',
    'gemini-3.7-flash',
  ]) {
    const capabilities = resolveProviderModelCapabilities({
      id: 'comfly',
      protocol: 'openai',
      modelProtocols: { [model]: 'gemini' },
    }, model);
    assert.deepEqual(capabilities.input, ['text', 'image']);
    assert.equal(capabilities.supportsVision, true);
  }
});

test('selects a per-model Gemini chat protocol as a visual planner', () => {
  const result = resolveProviderModelSelection({
    providers: [{
      id: 'comfly',
      protocol: 'openai',
      chatModels: ['gemini-3.7-flash'],
      modelProtocols: { 'gemini-3.7-flash': 'gemini' },
    }],
    purpose: 'chat',
    requestedProviderId: 'comfly',
    requestedModel: 'gemini-3.7-flash',
    requiresToolCalling: true,
    requiresRequiredToolChoice: true,
  });
  assert.deepEqual(result, {
    providerId: 'comfly',
    model: 'gemini-3.7-flash',
    fallback: false,
    reason: 'exact',
  });
});

test('uses the configured protocol for unknown models', () => {
  const capabilities = resolveProviderModelCapabilities({ id: 'comfly', protocol: 'openai' }, 'custom-chat');
  assert.deepEqual(capabilities.input, ['text']);
  assert.equal(capabilities.supportsVision, false);

  const geminiCapabilities = resolveProviderModelCapabilities({
    id: 'comfly',
    protocol: 'openai',
    modelProtocols: { 'custom-chat': 'gemini' },
  }, 'custom-chat');
  assert.deepEqual(geminiCapabilities.input, ['text', 'image']);
  assert.equal(geminiCapabilities.supportsVision, true);
});

test('does not filter configured chat models by visual capability', () => {
  const result = resolveProviderModelSelection({
    providers: [
      { id: 'provider-2', primary: true, chatModels: ['gpt-5.6'] },
      { id: 'xiaomi', chatModels: ['mimo-v2.5'] },
      {
        id: 'provider-3',
        chatModels: ['gpt-5.6-sol'],
        modelProtocols: { 'gpt-5.6-sol': 'gemini' },
      },
    ],
    purpose: 'chat',
    excludeUnavailable: true,
  });
  assert.deepEqual(result, {
    providerId: 'xiaomi',
    model: 'mimo-v2.5',
    fallback: true,
    reason: 'first_capable_provider',
  });
});

test('does not switch an explicitly selected model to a fallback', () => {
  assert.deepEqual(
    resolveProviderModelSelection({
      providers: [
        { id: 'xiaomi', chatModels: ['mimo-v2.5'] },
        { id: 'comfly', chatModels: ['gemini-3.7-flash'] },
      ],
      purpose: 'chat',
      requestedProviderId: 'xiaomi',
      requestedModel: 'mimo-v2.5-pro',
      allowFallback: false,
    }),
    {
      providerId: null,
      model: null,
      fallback: false,
      reason: 'no_capable_provider',
    },
  );
});
