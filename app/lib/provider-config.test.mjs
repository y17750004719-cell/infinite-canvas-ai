import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, readFile, rm } from 'node:fs/promises';

import {
  readProviderConfig,
  resolveProviderRequestTargets,
  updateProviderConfig,
} from './provider-config.mjs';

test('readProviderConfig falls back to env defaults when no runtime config exists', async () => {
  const runtimeDir = await mkdtemp(path.join(os.tmpdir(), 'provider-config-read-'));

  try {
    const result = await readProviderConfig({
      runtimeDir,
      env: {
        COMFLY_API_URL: 'https://ai.comfly.chat/v1',
        COMFLY_API_KEY: 'env-test-key',
      },
    });

    assert.equal(result.source, 'env');
    assert.equal(result.config.providerId, 'comfly');
    assert.equal(result.config.baseUrl, 'https://ai.comfly.chat/v1');
    assert.equal(result.config.apiKey, 'env-test-key');
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

test('updateProviderConfig requires apiKey on first save and preserves the previous key on blank updates', async () => {
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

    const rawConfig = JSON.parse(await readFile(path.join(runtimeDir, 'provider-config.json'), 'utf8'));
    assert.equal(rawConfig.apiKey, 'first-secret');
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
