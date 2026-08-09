import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';

import {
  effectiveProviderProtocol,
  getPrimaryProvider,
  getProviderById,
  providerEndpointUrl,
  readProviderConfig,
  readProviderRegistry,
  resolveProviderRequestTargets,
  updateProviderConfig,
  updateProviderRegistry,
} from './provider-config.mjs';

test('readProviderRegistry falls back to Comfly plus the disabled Xiaomi login entry', async () => {
  const runtimeDir = await mkdtemp(path.join(os.tmpdir(), 'provider-registry-read-'));

  try {
    const result = await readProviderRegistry({
      runtimeDir,
      env: {
        COMFLY_API_URL: 'https://ai.comfly.org/v1',
        COMFLY_API_KEY: 'env-test-key',
      },
    });

    assert.equal(result.source, 'env');
    assert.deepEqual(
      result.providers.map((provider) => provider.id),
      ['comfly', 'xiaomi']
    );
    assert.equal(getPrimaryProvider(result.providers).id, 'comfly');
    assert.equal(getPrimaryProvider(result.providers).apiKey, 'env-test-key');
    assert.equal(result.providers.find((provider) => provider.id === 'xiaomi').enabled, false);
  } finally {
    await rm(runtimeDir, { recursive: true, force: true });
  }
});

test('provider registry view exposes settings api keys and masks them with middle stars', async () => {
  const runtimeDir = await mkdtemp(path.join(os.tmpdir(), 'provider-registry-view-'));

  try {
    await writeFile(
      path.join(runtimeDir, 'api-providers.json'),
      JSON.stringify([
        {
          id: 'comfly',
          name: 'Comfly',
          baseUrl: 'https://ai.comfly.org/v1',
          protocol: 'openai',
          imageRequestMode: 'openai',
          imageGenerationEndpoint: '',
          imageEditEndpoint: '',
          enabled: true,
          primary: true,
          imageModels: [],
          chatModels: [],
          model_protocols: {
            'gemini-3.1-flash-image-preview': 'gemini',
            'gpt-image-2': 'openai',
            bad: 'codex',
            '': 'gemini',
          },
          apiKey: 'sk-test-secret-1234',
          imageApiKeys: [
            { id: 'img-gemini', apiKey: 'img-secret-5678', scope: 'gemini' },
            { id: 'img-gpt', apiKey: 'gpt-secret-9999', scope: 'gpt' },
          ],
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ]),
      'utf8'
    );

    const result = await readProviderRegistry({ runtimeDir, env: {} });
    const view = (await import('./provider-config.mjs')).toProviderRegistryView(result);

    assert.equal(view.providers[0].apiKey, 'sk-test-secret-1234');
    assert.equal(view.providers[0].maskedApiKey, 'sk-t***********1234');
    assert.equal(view.providers[0].maskedApiKey.includes('...'), false);
    assert.deepEqual(view.providers[0].modelProtocols, {
      'gemini-3.1-flash-image-preview': 'gemini',
      'gpt-image-2': 'openai',
    });
    assert.deepEqual(view.providers[0].imageApiKeys, [
      {
        id: 'img-gemini',
        apiKey: 'img-secret-5678',
        scope: 'gemini',
        hasApiKey: true,
        maskedApiKey: 'img-*******5678',
      },
      {
        id: 'img-gpt',
        apiKey: 'gpt-secret-9999',
        scope: 'gpt',
        hasApiKey: true,
        maskedApiKey: 'gpt-*******9999',
      },
    ]);
  } finally {
    await rm(runtimeDir, { recursive: true, force: true });
  }
});

test('readProviderRegistry migrates the previous single image api key fields into one row', async () => {
  const runtimeDir = await mkdtemp(path.join(os.tmpdir(), 'provider-registry-scalar-image-key-'));

  try {
    await writeFile(
      path.join(runtimeDir, 'api-providers.json'),
      JSON.stringify([
        {
          id: 'comfly',
          name: 'Comfly',
          baseUrl: 'https://ai.comfly.org/v1',
          protocol: 'openai',
          imageRequestMode: 'openai',
          enabled: true,
          primary: true,
          imageModels: [],
          chatModels: [],
          apiKey: 'main-secret',
          imageApiKey: 'legacy-image-secret',
          imageApiKeyScope: 'gpt',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ]),
      'utf8'
    );

    const result = await readProviderRegistry({ runtimeDir, env: {} });
    assert.deepEqual(result.providers[0].imageApiKeys, [
      { id: 'image-key-1', apiKey: 'legacy-image-secret', scope: 'gpt' },
    ]);
  } finally {
    await rm(runtimeDir, { recursive: true, force: true });
  }
});

test('readProviderRegistry keeps old provider configs compatible with blank image api key rows', async () => {
  const runtimeDir = await mkdtemp(path.join(os.tmpdir(), 'provider-registry-old-image-key-'));

  try {
    await writeFile(
      path.join(runtimeDir, 'api-providers.json'),
      JSON.stringify([
        {
          id: 'comfly',
          name: 'Comfly',
          baseUrl: 'https://ai.comfly.org/v1',
          protocol: 'openai',
          imageRequestMode: 'openai',
          enabled: true,
          primary: true,
          imageModels: [],
          chatModels: [],
          apiKey: 'main-secret',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ]),
      'utf8'
    );

    const result = await readProviderRegistry({ runtimeDir, env: {} });
    assert.equal(result.providers[0].apiKey, 'main-secret');
    assert.deepEqual(result.providers[0].imageApiKeys, []);
  } finally {
    await rm(runtimeDir, { recursive: true, force: true });
  }
});

test('readProviderRegistry migrates obvious Xiaomi TTS models from chatModels', async () => {
  const runtimeDir = await mkdtemp(path.join(os.tmpdir(), 'provider-registry-xiaomi-voice-'));

  try {
    await writeFile(path.join(runtimeDir, 'api-providers.json'), JSON.stringify([
      {
        id: 'comfly', baseUrl: 'https://ai.comfly.org/v1', enabled: true, primary: true, apiKey: 'main',
        imageModels: [], chatModels: [],
      },
      {
        id: 'xiaomi', baseUrl: 'https://api.xiaomimimo.com/v1', enabled: false, primary: false, apiKey: 'mimo',
        imageModels: [], chatModels: ['mimo-v2.5-pro', 'mimo-tts-v1'],
      },
    ]), 'utf8');

    const result = await readProviderRegistry({ runtimeDir, env: {} });
    const xiaomi = result.providers.find((provider) => provider.id === 'xiaomi');
    assert.deepEqual(xiaomi.chatModels, ['mimo-v2.5-pro']);
    assert.deepEqual(xiaomi.voiceModels, ['mimo-tts-v1']);
  } finally {
    await rm(runtimeDir, { recursive: true, force: true });
  }
});

test('readProviderConfig remains compatible with the primary provider view', async () => {
  const runtimeDir = await mkdtemp(path.join(os.tmpdir(), 'provider-config-default-'));

  try {
    const result = await readProviderConfig({
      runtimeDir,
      env: {},
    });

    assert.equal(result.source, 'env');
    assert.equal(result.config.providerId, 'comfly');
    assert.equal(result.config.baseUrl, 'https://ai.comfly.org/v1');
    assert.equal(result.config.apiKey, '');
  } finally {
    await rm(runtimeDir, { recursive: true, force: true });
  }
});

test('readProviderRegistry migrates legacy provider-config.json into the multi-provider registry view', async () => {
  const runtimeDir = await mkdtemp(path.join(os.tmpdir(), 'provider-registry-legacy-'));

  try {
    await mkdir(runtimeDir, { recursive: true });
    await writeFile(
      path.join(runtimeDir, 'provider-config.json'),
      JSON.stringify({
        providerId: 'custom',
        baseUrl: 'https://supplier.example.com/v1',
        apiKey: 'legacy-secret',
        model_protocols: {
          'gemini-3.1-flash-image-preview': 'gemini',
          'gpt-image-2': 'openai',
          ignored: 'runninghub',
        },
        updatedAt: '2026-01-01T00:00:00.000Z',
      }),
      'utf8'
    );

    const result = await readProviderRegistry({ runtimeDir, env: {} });
    const primary = getPrimaryProvider(result.providers);

    assert.equal(result.source, 'runtime');
    assert.equal(primary.id, 'custom');
    assert.equal(primary.baseUrl, 'https://supplier.example.com/v1');
    assert.equal(primary.apiKey, 'legacy-secret');
    assert.deepEqual(primary.modelProtocols, {
      'gemini-3.1-flash-image-preview': 'gemini',
      'gpt-image-2': 'openai',
    });
    assert.equal(primary.updatedAt, '2026-01-01T00:00:00.000Z');
  } finally {
    await rm(runtimeDir, { recursive: true, force: true });
  }
});

test('resolveProviderRequestTargets keeps OpenAI compatibility and trims /v1 for Gemini and Recraft paths', () => {
  assert.deepEqual(resolveProviderRequestTargets('https://example.com/v1'), {
    baseUrl: 'https://example.com/v1',
    openAiBaseUrl: 'https://example.com/v1',
    geminiBaseUrl: 'https://example.com',
    recraftBaseUrl: 'https://example.com',
  });
});

test('providerEndpointUrl supports overrides and avoids duplicate version prefixes', () => {
  const openAiProvider = {
    id: 'custom',
    name: 'Custom',
    baseUrl: 'https://supplier.example.com/v1',
    protocol: 'openai',
    imageRequestMode: 'openai',
    imageGenerationEndpoint: '',
    imageEditEndpoint: '/v1/images/edits',
    enabled: true,
    primary: true,
    imageModels: [],
    chatModels: [],
    apiKey: 'secret',
    updatedAt: new Date(0).toISOString(),
  };
  const geminiProvider = {
    ...openAiProvider,
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    protocol: 'gemini',
  };

  assert.equal(
    providerEndpointUrl(openAiProvider, 'imageGenerationEndpoint', '/v1/images/generations'),
    'https://supplier.example.com/v1/images/generations'
  );
  assert.equal(
    providerEndpointUrl(openAiProvider, 'imageEditEndpoint', '/v1/images/edits'),
    'https://supplier.example.com/v1/images/edits'
  );
  assert.equal(
    providerEndpointUrl(geminiProvider, 'imageGenerationEndpoint', '/v1beta/models/gemini-2.5-flash-image:generateContent'),
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent'
  );
});

test('effectiveProviderProtocol uses per-model overrides before provider protocol', () => {
  const provider = {
    id: 'mixed',
    name: 'Mixed',
    baseUrl: 'https://supplier.example.com/v1',
    protocol: 'openai',
    imageRequestMode: 'openai',
    imageGenerationEndpoint: '',
    imageEditEndpoint: '',
    enabled: true,
    primary: true,
    imageModels: [],
    chatModels: [],
    modelProtocols: {
      'gemini-3.1-flash-image-preview': 'gemini',
      'gpt-image-2': 'openai',
    },
    apiKey: 'secret',
    imageApiKeys: [],
    updatedAt: new Date(0).toISOString(),
  };

  assert.equal(effectiveProviderProtocol(provider, 'gemini-3.1-flash-image-preview'), 'gemini');
  assert.equal(effectiveProviderProtocol(provider, 'gpt-image-2'), 'openai');
  assert.equal(effectiveProviderProtocol(provider, 'gemini-3.5-flash'), 'openai');
});

test('updateProviderConfig writes api-providers.json and preserves the previous key on blank updates', async () => {
  const runtimeDir = await mkdtemp(path.join(os.tmpdir(), 'provider-config-write-'));

  try {
    await assert.rejects(
      () =>
        updateProviderConfig(
          {
            providerId: 'custom',
            baseUrl: 'https://supplier.example.com/v1',
            apiKey: '',
          },
          { runtimeDir, env: {} }
        ),
      /API Key is required/
    );

    const initial = await updateProviderConfig(
      {
        providerId: 'custom',
        baseUrl: 'https://supplier.example.com/v1',
        apiKey: 'first-secret',
      },
      { runtimeDir, env: {} }
    );

    assert.equal(initial.source, 'runtime');
    assert.equal(initial.config.providerId, 'custom');
    assert.equal(initial.config.apiKey, 'first-secret');

    const updated = await updateProviderConfig(
      {
        providerId: 'gpt-best',
        baseUrl: 'https://gpt-best.cn',
        apiKey: '',
      },
      { runtimeDir, env: {} }
    );

    assert.equal(updated.config.providerId, 'gpt-best');
    assert.equal(updated.config.baseUrl, 'https://gpt-best.cn');
    assert.equal(updated.config.apiKey, 'first-secret');

    const rawProviders = JSON.parse(await readFile(path.join(runtimeDir, 'api-providers.json'), 'utf8'));
    assert.equal(Array.isArray(rawProviders), true);
    assert.equal(rawProviders.find((provider) => provider.id === 'gpt-best').apiKey, 'first-secret');
  } finally {
    await rm(runtimeDir, { recursive: true, force: true });
  }
});

test('updateProviderRegistry normalizes protocol modes, endpoint overrides, model lists, and primary selection', async () => {
  const runtimeDir = await mkdtemp(path.join(os.tmpdir(), 'provider-registry-write-'));

  try {
    const result = await updateProviderRegistry(
      [
        {
          id: 'first',
          name: 'First',
          baseUrl: 'https://first.example.com/v1',
          protocol: 'invalid',
          imageRequestMode: 'openai-json',
          enabled: true,
          primary: true,
          imageModels: ['gpt-image-2', 'gpt-image-2'],
          chatModels: ['chat-a'],
          modelProtocols: {
            'gemini-3.1-flash-image-preview': 'gemini',
            'chat-a': 'openai',
            ignored: 'runninghub',
          },
          apiKey: 'first-secret',
          imageApiKeys: [
            { id: 'first-gpt', apiKey: 'first-image-secret', scope: 'gpt' },
            { id: 'blank-row', apiKey: '', scope: 'gemini' },
          ],
        },
        {
          id: 'second',
          name: 'Second',
          baseUrl: 'https://second.example.com/v1beta',
          protocol: 'gemini',
          imageGenerationEndpoint: 'https://override.example.com/images',
          enabled: true,
          primary: true,
          imageModels: ['gemini-2.5-flash-image'],
          chatModels: ['gemini-3.1-flash-lite-preview-thinking-medium'],
          apiKey: 'second-secret',
          imageApiKeys: [
            { id: 'second-gemini', apiKey: 'second-image-secret', scope: 'gemini' },
          ],
        },
      ],
      { runtimeDir }
    );

    assert.equal(getPrimaryProvider(result.providers).id, 'second');
    assert.equal(getProviderById(result.providers, 'first').protocol, 'openai');
    assert.equal(getProviderById(result.providers, 'first').imageRequestMode, 'openai-json');
    assert.deepEqual(getProviderById(result.providers, 'first').imageModels, ['gpt-image-2']);
    assert.deepEqual(getProviderById(result.providers, 'first').modelProtocols, {
      'gemini-3.1-flash-image-preview': 'gemini',
      'chat-a': 'openai',
    });
    assert.deepEqual(getProviderById(result.providers, 'first').imageApiKeys, [
      { id: 'first-gpt', apiKey: 'first-image-secret', scope: 'gpt' },
    ]);
    assert.deepEqual(getProviderById(result.providers, 'second').imageApiKeys, [
      { id: 'second-gemini', apiKey: 'second-image-secret', scope: 'gemini' },
    ]);
    assert.equal(
      getProviderById(result.providers, 'second').imageGenerationEndpoint,
      'https://override.example.com/images'
    );
    const rawProviders = JSON.parse(await readFile(path.join(runtimeDir, 'api-providers.json'), 'utf8'));
    assert.deepEqual(rawProviders.find((provider) => provider.id === 'first').imageApiKeys, [
      { id: 'first-gpt', apiKey: 'first-image-secret', scope: 'gpt' },
    ]);
    assert.deepEqual(rawProviders.find((provider) => provider.id === 'first').modelProtocols, {
      'gemini-3.1-flash-image-preview': 'gemini',
      'chat-a': 'openai',
    });
  } finally {
    await rm(runtimeDir, { recursive: true, force: true });
  }
});

test('updateProviderRegistry moves primary selection to the first enabled provider', async () => {
  const runtimeDir = await mkdtemp(path.join(os.tmpdir(), 'provider-registry-enabled-primary-'));

  try {
    const result = await updateProviderRegistry(
      [
        {
          id: 'disabled-primary',
          name: 'Disabled Primary',
          baseUrl: 'https://disabled.example.com/v1',
          enabled: false,
          primary: true,
        },
        {
          id: 'enabled-fallback',
          name: 'Enabled Fallback',
          baseUrl: 'https://enabled.example.com/v1',
          enabled: true,
          primary: false,
        },
      ],
      { runtimeDir }
    );

    assert.equal(getPrimaryProvider(result.providers).id, 'enabled-fallback');
    assert.equal(getProviderById(result.providers, 'disabled-primary').primary, false);
  } finally {
    await rm(runtimeDir, { recursive: true, force: true });
  }
});

test('updateProviderRegistry rejects registries without an enabled provider', async () => {
  const runtimeDir = await mkdtemp(path.join(os.tmpdir(), 'provider-registry-all-disabled-'));

  try {
    await assert.rejects(
      () => updateProviderRegistry(
        [
          {
            id: 'disabled',
            name: 'Disabled',
            baseUrl: 'https://disabled.example.com/v1',
            enabled: false,
            primary: true,
          },
        ],
        { runtimeDir }
      ),
      /At least one provider must be enabled/
    );
  } finally {
    await rm(runtimeDir, { recursive: true, force: true });
  }
});

test('updateProviderConfig rejects invalid base urls', async () => {
  const runtimeDir = await mkdtemp(path.join(os.tmpdir(), 'provider-config-invalid-'));

  try {
    await assert.rejects(
      () =>
        updateProviderConfig(
          {
            providerId: 'custom',
            baseUrl: 'not-a-url',
            apiKey: 'secret',
          },
          { runtimeDir, env: {} }
        ),
      /Base URL must be a valid http\/https URL/
    );
  } finally {
    await rm(runtimeDir, { recursive: true, force: true });
  }
});
