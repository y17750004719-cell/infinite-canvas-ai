import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';

import { beginXiaomiLogin, clearXiaomiLogin, completeXiaomiLogin, decryptXiaomiCode, getXiaomiLoginStatus } from './xiaomi-auth.mjs';
import { getPrimaryProvider, readProviderRegistry, updateProviderRegistry } from './provider-config.mjs';

function encryptFor(publicKey, payload) {
  const ephemeral = crypto.generateKeyPairSync('x25519');
  const shared = crypto.diffieHellman({ privateKey: ephemeral.privateKey, publicKey });
  const nonce = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', crypto.createHash('sha256').update(shared).digest(), nonce);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(payload)), cipher.final()]);
  return Buffer.concat([
    ephemeral.publicKey.export({ type: 'spki', format: 'der' }).subarray(-32),
    nonce,
    ciphertext,
    cipher.getAuthTag(),
  ]).toString('base64url');
}

test('decryptXiaomiCode decrypts credentials and restricts the returned base URL', () => {
  const keys = crypto.generateKeyPairSync('x25519');
  const privateDer = keys.privateKey.export({ type: 'pkcs8', format: 'der' });
  const valid = decryptXiaomiCode(privateDer, encryptFor(keys.publicKey, { sk: 'secret', uid: 'user-1', url: 'https://edge.xiaomimimo.com/v1/' }));
  assert.deepEqual(valid, { apiKey: 'secret', accountId: 'user-1', baseUrl: 'https://edge.xiaomimimo.com/v1' });
  const fallback = decryptXiaomiCode(privateDer, encryptFor(keys.publicKey, { sk: 'secret', uid: 'user-1', url: 'https://example.com/v1' }));
  assert.equal(fallback.baseUrl, 'https://api.xiaomimimo.com/v1');
  assert.throws(() => decryptXiaomiCode(privateDer, encryptFor(keys.publicKey, { sk: '', uid: 'user-1' })), /missing sk/);
  assert.throws(() => decryptXiaomiCode(privateDer, `${valid.apiKey}broken`));
});

test('beginXiaomiLogin replaces the pending login, writes 0600, and expires after five minutes', async () => {
  const runtimeDir = await mkdtemp(path.join(os.tmpdir(), 'xiaomi-login-'));
  try {
    const first = await beginXiaomiLogin({ runtimeDir, now: 1000 });
    assert.equal((await stat(path.join(runtimeDir, 'xiaomi-login.json'))).mode & 0o777, 0o600);
    const second = await beginXiaomiLogin({ runtimeDir, now: 2000 });
    assert.notEqual(first.state, second.state);
    assert.equal((await getXiaomiLoginStatus({ state: first.state, runtimeDir, now: 2000 })).status, 'invalid');
    assert.equal((await getXiaomiLoginStatus({ state: second.state, runtimeDir, now: 302001 })).status, 'expired');
    const file = await readFile(path.join(runtimeDir, 'xiaomi-login.json'), 'utf8');
    assert.equal(file.includes('privateKey'), false);
  } finally {
    await rm(runtimeDir, { recursive: true, force: true });
  }
});

test('beginXiaomiLogin starts a temporary local callback server', async () => {
  const runtimeDir = await mkdtemp(path.join(os.tmpdir(), 'xiaomi-authorize-contract-'));
  try {
    const login = await beginXiaomiLogin({ runtimeDir, now: 1000 });
    const authorizeUrl = new URL(login.authorizeUrl);
    assert.match(authorizeUrl.searchParams.get('redirect_uri') || '', /^http:\/\/localhost:\d+\/$/);
    assert.match(authorizeUrl.searchParams.get('key_name') || '', /^mimo-code-cli-key-[a-f0-9]{8}$/);
    assert.doesNotThrow(() => crypto.createPublicKey({
      key: Buffer.from(authorizeUrl.searchParams.get('pk'), 'base64url'),
      format: 'der', type: 'spki',
    }));
  } finally {
    await rm(runtimeDir, { recursive: true, force: true });
  }
});

test('temporary callback server completes an automatic Xiaomi login', async () => {
  const runtimeDir = await mkdtemp(path.join(os.tmpdir(), 'xiaomi-auto-callback-'));
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response(JSON.stringify({ data: [{ id: 'mimo-v2.5-pro' }] }), { status: 200 });
    const login = await beginXiaomiLogin({ runtimeDir });
    const publicKey = crypto.createPublicKey({
      key: Buffer.from(new URL(login.authorizeUrl).searchParams.get('pk'), 'base64url'),
      format: 'der', type: 'spki',
    });
    const callback = new URL(new URL(login.authorizeUrl).searchParams.get('redirect_uri'));
    callback.searchParams.set('u', encryptFor(publicKey, { sk: 'mimo-secret', uid: 'user-1' }));
    const response = await originalFetch(callback, { redirect: 'manual' });
    assert.equal(response.status, 302);
    assert.match(response.headers.get('location') || '', /authorize\/callback\?status=success/);
    assert.equal((await getXiaomiLoginStatus({ state: login.state, runtimeDir })).status, 'success');
  } finally {
    globalThis.fetch = originalFetch;
    await clearXiaomiLogin(runtimeDir);
    await rm(runtimeDir, { recursive: true, force: true });
  }
});

test('Xiaomi login stores voice models without changing primary and logout disables the provider', async () => {
  const runtimeDir = await mkdtemp(path.join(os.tmpdir(), 'xiaomi-complete-'));
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response(JSON.stringify({ data: [{ id: 'mimo-tts-v1', output_modalities: ['audio'] }] }), { status: 200 });
    const login = await beginXiaomiLogin({ runtimeDir, now: 1000 });
    const pk = new URL(login.authorizeUrl).searchParams.get('pk');
    const publicKey = crypto.createPublicKey({ key: Buffer.from(pk, 'base64url'), format: 'der', type: 'spki' });
    const code = encryptFor(publicKey, { sk: 'mimo-secret', uid: 'user-1', url: 'https://api.xiaomimimo.com/v1' });
    const completed = await completeXiaomiLogin({ state: '', code, runtimeDir, now: 2000 });
    assert.equal(completed.selectedModel, '');

    const registry = await readProviderRegistry({ runtimeDir, env: {} });
    const xiaomi = registry.providers.find((provider) => provider.id === 'xiaomi');
    assert.equal(getPrimaryProvider(registry.providers).id, 'comfly');
    assert.equal(xiaomi.enabled, true);
    assert.deepEqual(xiaomi.chatModels, []);
    assert.deepEqual(xiaomi.voiceModels, ['mimo-tts-v1']);

    await clearXiaomiLogin(runtimeDir);
    const loggedOut = (await readProviderRegistry({ runtimeDir, env: {} })).providers.find((provider) => provider.id === 'xiaomi');
    assert.equal(loggedOut.enabled, false);
    assert.equal(loggedOut.apiKey, '');
    assert.deepEqual(loggedOut.voiceModels, ['mimo-tts-v1']);
  } finally {
    globalThis.fetch = originalFetch;
    await rm(runtimeDir, { recursive: true, force: true });
  }
});

test('Xiaomi login consumes a callback code only once when callbacks overlap', async () => {
  const runtimeDir = await mkdtemp(path.join(os.tmpdir(), 'xiaomi-replay-'));
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response(JSON.stringify({ data: [{ id: 'mimo-v2.5-pro' }] }), { status: 200 });
    const login = await beginXiaomiLogin({ runtimeDir, now: 1000 });
    const pk = new URL(login.authorizeUrl).searchParams.get('pk');
    const publicKey = crypto.createPublicKey({ key: Buffer.from(pk, 'base64url'), format: 'der', type: 'spki' });
    const code = encryptFor(publicKey, { sk: 'mimo-secret', uid: 'user-1' });
    const results = await Promise.allSettled([
      completeXiaomiLogin({ state: login.state, code, runtimeDir, now: 2000 }),
      completeXiaomiLogin({ state: login.state, code, runtimeDir, now: 2000 }),
    ]);
    assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
    assert.equal(results.filter((result) => result.status === 'rejected').length, 1);
    assert.equal((await getXiaomiLoginStatus({ state: login.state, runtimeDir, now: 2000 })).status, 'success');
  } finally {
    globalThis.fetch = originalFetch;
    await rm(runtimeDir, { recursive: true, force: true });
  }
});

test('Xiaomi login does not select a stale chat model after a model probe failure', async () => {
  const runtimeDir = await mkdtemp(path.join(os.tmpdir(), 'xiaomi-probe-failure-'));
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response('upstream error', { status: 502 });
    const initialRegistry = await readProviderRegistry({ runtimeDir, env: {} });
    await updateProviderRegistry(initialRegistry.providers.map((provider) => provider.id === 'xiaomi'
      ? { ...provider, chatModels: ['stale-chat-model'] }
      : provider), { runtimeDir });
    const login = await beginXiaomiLogin({ runtimeDir, now: 1000 });
    const pk = new URL(login.authorizeUrl).searchParams.get('pk');
    const publicKey = crypto.createPublicKey({ key: Buffer.from(pk, 'base64url'), format: 'der', type: 'spki' });
    const result = await completeXiaomiLogin({
      state: login.state,
      code: encryptFor(publicKey, { sk: 'mimo-secret', uid: 'user-1' }),
      runtimeDir,
      now: 2000,
    });
    assert.equal(result.selectedModel, '');
    assert.notEqual(result.modelProbeError, '');
  } finally {
    globalThis.fetch = originalFetch;
    await rm(runtimeDir, { recursive: true, force: true });
  }
});
