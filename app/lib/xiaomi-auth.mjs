import crypto from 'node:crypto';
import { createServer } from 'node:http';
import path from 'node:path';
import { chmod, mkdir, readFile, unlink, writeFile } from 'node:fs/promises';

import { readProviderRegistry, updateProviderRegistry } from './provider-config.mjs';
import { fetchProviderModels } from './provider-models.ts';

const PLATFORM_URL = 'https://platform.xiaomimimo.com';
const DEFAULT_API_URL = 'https://api.xiaomimimo.com/v1';
const LOGIN_TTL_MS = 5 * 60 * 1000;
const callbackServers = new Map();

function runtimePath(runtimeDir, name) {
  return path.join(runtimeDir || path.join(process.cwd(), 'runtime'), name);
}

function pendingPath(runtimeDir) {
  return runtimePath(runtimeDir, 'xiaomi-login.json');
}

function claimPath(runtimeDir, state) {
  const stateHash = crypto.createHash('sha256').update(String(state)).digest('hex');
  return runtimePath(runtimeDir, `xiaomi-login-${stateHash}.claim`);
}

function keyNamePath(runtimeDir) {
  return runtimePath(runtimeDir, 'xiaomi-key-name');
}

function callbackServerKey(runtimeDir) {
  return path.resolve(runtimeDir || path.join(process.cwd(), 'runtime'));
}

function closeCallbackServer(runtimeDir, state = '') {
  const key = callbackServerKey(runtimeDir);
  const entry = callbackServers.get(key);
  if (!entry || (state && entry.state !== state)) return;
  callbackServers.delete(key);
  clearTimeout(entry.timeout);
  entry.server.close();
}

function callbackResultUrl(status, message = '') {
  const params = new URLSearchParams({ status });
  if (message) params.set('message', message);
  return `${PLATFORM_URL}/authorize/callback?${params}`;
}

async function startCallbackServer({ state, runtimeDir }) {
  closeCallbackServer(runtimeDir);
  const server = createServer((request, response) => {
    void (async () => {
      const requestUrl = new URL(request.url || '/', 'http://localhost');
      const code = requestUrl.searchParams.get('u') || '';
      try {
        if (!code) throw new Error('Xiaomi callback is missing encrypted code');
        await completeXiaomiLogin({ state, code, runtimeDir });
        response.writeHead(302, { Location: callbackResultUrl('success') });
      } catch (error) {
        response.writeHead(302, {
          Location: callbackResultUrl('error', error instanceof Error && error.message === 'Xiaomi callback is missing encrypted code' ? 'missing_data' : 'decrypt_failed'),
        });
      } finally {
        response.end();
      }
    })();
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, () => {
      server.off('error', reject);
      resolve();
    });
  });

  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  if (!port) {
    server.close();
    throw new Error('Unable to start Xiaomi callback server');
  }
  server.unref();
  const timeout = setTimeout(() => closeCallbackServer(runtimeDir, state), LOGIN_TTL_MS);
  timeout.unref();
  callbackServers.set(callbackServerKey(runtimeDir), { server, state, timeout });
  return `http://localhost:${port}/`;
}

async function writePrivateFile(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, value, { encoding: 'utf8', mode: 0o600 });
  await chmod(filePath, 0o600);
}

async function getKeyName(runtimeDir) {
  const filePath = keyNamePath(runtimeDir);
  try {
    const value = (await readFile(filePath, 'utf8')).trim();
    if (/^mimo-code-cli-key-[a-f0-9]{8}$/.test(value)) return value;
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  const value = `mimo-code-cli-key-${crypto.randomBytes(4).toString('hex')}`;
  await writePrivateFile(filePath, `${value}\n`);
  return value;
}

function authorizeUrl(publicKey, redirectUri, keyName) {
  const params = new URLSearchParams({
    pk: publicKey,
    redirect_uri: redirectUri,
    kn: 'mimocode',
    key_name: keyName,
  });
  return `${PLATFORM_URL}/authorize?${params}`;
}

function normalizeBaseUrl(value) {
  if (typeof value !== 'string' || !value.trim()) return DEFAULT_API_URL;
  try {
    const url = new URL(value.trim());
    const hostname = url.hostname.toLowerCase();
    if (url.protocol !== 'https:' || (hostname !== 'xiaomimimo.com' && !hostname.endsWith('.xiaomimimo.com'))) {
      return DEFAULT_API_URL;
    }
    return value.trim().replace(/\/+$/, '');
  } catch {
    return DEFAULT_API_URL;
  }
}

export function decryptXiaomiCode(privateKeyDer, encryptedBase64) {
  const encrypted = Buffer.from(String(encryptedBase64 || '').trim(), 'base64url');
  if (encrypted.length < 61) throw new Error('Encrypted code is invalid');
  const ephemeralPub = encrypted.subarray(0, 32);
  const nonce = encrypted.subarray(32, 44);
  const ciphertextAndTag = encrypted.subarray(44);
  const tag = ciphertextAndTag.subarray(-16);
  const ciphertext = ciphertextAndTag.subarray(0, -16);
  const privateKey = crypto.createPrivateKey({ key: privateKeyDer, format: 'der', type: 'pkcs8' });
  const publicKey = crypto.createPublicKey({
    key: Buffer.concat([Buffer.from('302a300506032b656e032100', 'hex'), ephemeralPub]),
    format: 'der',
    type: 'spki',
  });
  const sharedSecret = crypto.diffieHellman({ privateKey, publicKey });
  const decipher = crypto.createDecipheriv('aes-256-gcm', crypto.createHash('sha256').update(sharedSecret).digest(), nonce);
  decipher.setAuthTag(tag);
  const result = JSON.parse(Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8'));
  if (!result || typeof result !== 'object' || typeof result.sk !== 'string' || !result.sk.trim()) {
    throw new Error('Xiaomi credential is missing sk');
  }
  return {
    apiKey: result.sk.trim(),
    accountId: typeof result.uid === 'string' ? result.uid.trim() : '',
    baseUrl: normalizeBaseUrl(result.url),
  };
}

async function readLogin(runtimeDir) {
  try {
    return JSON.parse(await readFile(pendingPath(runtimeDir), 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

async function claimLogin(runtimeDir, state) {
  try {
    await writeFile(claimPath(runtimeDir, state), `${state}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    await chmod(claimPath(runtimeDir, state), 0o600);
  } catch (error) {
    if (error?.code === 'EEXIST') throw new Error('Xiaomi login code was already used');
    throw error;
  }
}

async function writeLoginStatusIfCurrent(runtimeDir, state, status) {
  const current = await readLogin(runtimeDir);
  if (!current || current.state !== state) return false;
  await writePrivateFile(pendingPath(runtimeDir), `${JSON.stringify({ ...status, state, expiresAt: current.expiresAt })}\n`);
  return true;
}

export async function beginXiaomiLogin({ runtimeDir, now = Date.now() } = {}) {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('x25519');
  const state = crypto.randomBytes(24).toString('base64url');
  const expiresAt = now + LOGIN_TTL_MS;
  const keyName = await getKeyName(runtimeDir);
  const login = {
    state,
    status: 'pending',
    expiresAt,
    privateKey: privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64'),
  };
  await unlink(claimPath(runtimeDir, state)).catch((error) => { if (error?.code !== 'ENOENT') throw error; });
  await writePrivateFile(pendingPath(runtimeDir), `${JSON.stringify(login)}\n`);
  let redirectUri;
  try {
    redirectUri = await startCallbackServer({ state, runtimeDir });
  } catch (error) {
    await unlink(pendingPath(runtimeDir)).catch((unlinkError) => { if (unlinkError?.code !== 'ENOENT') throw unlinkError; });
    throw error;
  }
  const pk = publicKey.export({ type: 'spki', format: 'der' }).toString('base64url');
  return {
    state,
    expiresAt: new Date(expiresAt).toISOString(),
    authorizeUrl: authorizeUrl(pk, redirectUri, keyName),
    manualAuthorizeUrl: authorizeUrl(pk, `${PLATFORM_URL}/authorize/code/callback`, keyName),
  };
}

async function saveXiaomiProvider(credentials, runtimeDir) {
  const registry = await readProviderRegistry({ runtimeDir });
  const existing = registry.providers.find((provider) => provider.id === 'xiaomi');
  const provider = {
    id: 'xiaomi',
    name: existing?.name || 'Xiaomi',
    baseUrl: credentials.baseUrl,
    protocol: 'openai',
    imageRequestMode: existing?.imageRequestMode || 'openai',
    imageGenerationEndpoint: existing?.imageGenerationEndpoint || '',
    imageEditEndpoint: existing?.imageEditEndpoint || '',
    enabled: true,
    primary: existing?.primary || false,
    imageModels: existing?.imageModels || [],
    chatModels: existing?.chatModels || [],
    voiceModels: existing?.voiceModels || [],
    modelProtocols: existing?.modelProtocols || {},
    apiKey: credentials.apiKey,
    imageApiKeys: existing?.imageApiKeys || [],
    authType: 'xiaomi-browser',
    accountId: credentials.accountId,
    updatedAt: new Date().toISOString(),
  };
  let modelProbeError = '';
  try {
    const models = await fetchProviderModels({ baseUrl: provider.baseUrl, apiKey: provider.apiKey, protocol: 'openai', imageRequestMode: provider.imageRequestMode });
    if (models.ok) {
      provider.chatModels = models.chatModels;
      provider.voiceModels = models.voiceModels;
    } else {
      modelProbeError = models.message || '模型拉取失败';
    }
  } catch (error) {
    modelProbeError = error instanceof Error ? error.message : '模型拉取失败';
  }
  const providers = registry.providers.some((item) => item.id === 'xiaomi')
    ? registry.providers.map((item) => item.id === 'xiaomi' ? provider : item)
    : [...registry.providers, provider];
  return { registry: await updateProviderRegistry(providers, { runtimeDir }), modelProbeError };
}

export async function completeXiaomiLogin({ state, code, runtimeDir = undefined, now = Date.now() }) {
  const pending = await readLogin(runtimeDir);
  const resolvedState = String(state || '').trim() || pending?.state;
  if (!resolvedState) throw new Error('Xiaomi login state is invalid');
  await claimLogin(runtimeDir, resolvedState);
  try {
    const login = await readLogin(runtimeDir);
    if (!login || login.state !== resolvedState) throw new Error('Xiaomi login state is invalid');
    if (login.status !== 'pending' || !login.privateKey) throw new Error('Xiaomi login code was already used');
    if (now >= login.expiresAt) {
      await writeLoginStatusIfCurrent(runtimeDir, resolvedState, { status: 'expired' });
      throw new Error('Xiaomi login expired');
    }
    await writeLoginStatusIfCurrent(runtimeDir, resolvedState, { status: 'processing' });
    const credentials = decryptXiaomiCode(Buffer.from(login.privateKey, 'base64'), code);
    const { registry, modelProbeError } = await saveXiaomiProvider(credentials, runtimeDir);
    const provider = registry.providers.find((item) => item.id === 'xiaomi');
    const selectedModel = modelProbeError ? '' : provider?.chatModels.includes('mimo-v2.5-pro') ? 'mimo-v2.5-pro' : provider?.chatModels[0] || '';
    await writeLoginStatusIfCurrent(runtimeDir, resolvedState, { status: 'success', accountId: credentials.accountId, selectedModel, modelProbeError });
    return { accountId: credentials.accountId, selectedModel, modelProbeError };
  } catch (error) {
    const current = await readLogin(runtimeDir);
    if (current?.state === resolvedState && current.status === 'processing') {
      await writeLoginStatusIfCurrent(runtimeDir, resolvedState, { status: 'failed', error: error instanceof Error ? error.message : 'Xiaomi login failed' });
    }
    throw error;
  } finally {
    await unlink(claimPath(runtimeDir, resolvedState)).catch((error) => { if (error?.code !== 'ENOENT') throw error; });
    closeCallbackServer(runtimeDir, resolvedState);
  }
}

export async function getXiaomiLoginStatus({ state, runtimeDir = undefined, now = Date.now() }) {
  const login = await readLogin(runtimeDir);
  if (!login || login.state !== state) return { status: 'invalid' };
  if (login.status === 'pending' && now >= login.expiresAt) {
    await writePrivateFile(pendingPath(runtimeDir), `${JSON.stringify({ state, status: 'expired', expiresAt: login.expiresAt })}\n`);
    closeCallbackServer(runtimeDir, state);
    return { status: 'expired' };
  }
  return { status: login.status, accountId: login.accountId || '', selectedModel: login.selectedModel || '', modelProbeError: login.modelProbeError || '', error: login.error || '', expiresAt: new Date(login.expiresAt).toISOString() };
}

export async function clearXiaomiLogin(runtimeDir) {
  const login = await readLogin(runtimeDir);
  const registry = await readProviderRegistry({ runtimeDir });
  const providers = registry.providers.map((provider) => provider.id === 'xiaomi' ? {
    ...provider,
    apiKey: '',
    enabled: false,
    authType: 'api-key',
    accountId: '',
    updatedAt: new Date().toISOString(),
  } : provider);
  if (providers.some((provider) => provider.id === 'xiaomi')) await updateProviderRegistry(providers, { runtimeDir });
  await unlink(pendingPath(runtimeDir)).catch((error) => { if (error?.code !== 'ENOENT') throw error; });
  if (login?.state) await unlink(claimPath(runtimeDir, login.state)).catch((error) => { if (error?.code !== 'ENOENT') throw error; });
  closeCallbackServer(runtimeDir);
}
