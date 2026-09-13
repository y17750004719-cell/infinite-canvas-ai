import { createHash } from 'node:crypto';
import { readFile, mkdir, writeFile, rename, realpath } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { NativeCodexStdioClient } from './native-codex-stdio.mjs';
import sharp from 'sharp';
import { parseImageDataUrl } from '../api-security.mjs';
import { CODEX_MAIN_SNAPSHOT } from './codex-main-snapshot.mjs';
import { createNativeCollaborationGateway } from './native-collaboration-gateway.mjs';

export const NATIVE_SOURCE_COMMIT = '53c542d944c705f3a66780a19223223bee57cbb6';
export const NATIVE_DISABLED_FEATURES = Object.freeze([
  'shell_tool', 'unified_exec', 'view_image', 'sleep_tool', 'deferred_executor',
  'code_mode', 'code_mode_host', 'code_mode_only', 'multi_agent', 'multi_agent_v2',
  'hooks', 'plugins', 'recommended_plugins', 'tool_suggest', 'apps',
  'image_generation', 'web_search_request', 'web_search_cached', 'standalone_web_search',
  'request_permissions_tool', 'memories', 'goals', 'token_budget', 'current_time_reminder',
]);
const hostPool = globalThis[Symbol.for('zflow.nativeCodexHosts')] ||= new Map();
const hash = (value) => createHash('sha256').update(value).digest('hex');

function failure(code) {
  return Object.assign(new Error(code), { code, failureStage: 'native_runtime', retryable: false });
}

export function nativeProviderFingerprint(provider) {
  return hash(JSON.stringify([provider.id, provider.model, new URL(provider.baseUrl).href]));
}

export async function invalidateNativeCodexHost(host) {
  if (!host) return;
  for (const [key, value] of hostPool) {
    if (value === host || (value && typeof value.then === 'function' && await Promise.resolve(value).catch(() => null) === host)) {
      hostPool.delete(key);
    }
  }
  host.invalidated = true;
  await host.client.close().catch(() => {});
}

// Invalidate an existing pooled host without creating a new one. Recovery uses
// this boundary before replaying a turn after a transport-level disconnect.
export async function invalidateNativeCodexHostScope({ provider, ownerId = 'local', runtimeRoot = resolve('runtime/native-codex') } = {}) {
  if (!provider?.id || !provider?.model || !provider?.baseUrl) return false;
  const scopeId = hash(JSON.stringify([ownerId, nativeProviderFingerprint(provider), hash(provider.apiKey || '')]));
  const key = `${resolve(runtimeRoot)}:${scopeId}`;
  const existing = hostPool.get(key);
  if (!existing) return false;
  hostPool.delete(key);
  const host = await Promise.resolve(existing).catch(() => null);
  if (host) await invalidateNativeCodexHost(host);
  return Boolean(host);
}

export function nativeConfig(provider) {
  const endpoint = new URL(provider.baseUrl);
  if (!['https:', 'http:'].includes(endpoint.protocol) || endpoint.username || endpoint.password) throw failure('native_provider_url_invalid');
  return [
    `model = ${JSON.stringify(provider.model)}`, 'model_provider = "zflow_provider"',
    'approval_policy = "never"', 'sandbox_mode = "read-only"', 'web_search = "disabled"',
    '[tools.experimental_request_user_input]', 'enabled = false', '[tools.update_plan]', 'enabled = false',
    '[orchestrator.skills]', 'enabled = false', '[orchestrator.mcp]', 'enabled = false',
    '[skills.bundled]', 'enabled = false',
    '[features]', ...NATIVE_DISABLED_FEATURES.map((key) => `${key} = false`),
    '[model_providers.zflow_provider]', 'name = "Application Responses provider"',
    `base_url = ${JSON.stringify(endpoint.href.replace(/\/$/, ''))}`, 'wire_api = "responses"',
    'env_key = "ZFLOW_NATIVE_PROVIDER_KEY"', 'request_max_retries = 0', 'stream_max_retries = 0',
    'supports_websockets = false',
  ].join('\n');
}

async function atomicPrivateWrite(path, content) {
  const temporary = `${path}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
  await writeFile(temporary, content, { mode: 0o600 });
  await rename(temporary, path);
}

export async function acquireNativeCodexHost({ provider, ownerId = 'local', runtimeRoot = resolve('runtime/native-codex') }) {
  if (!provider?.id || !provider?.model || !provider?.baseUrl) throw failure('native_provider_required');
  if (provider.protocol !== 'responses') throw failure('native_protocol_unsupported');
  const scopeId = hash(JSON.stringify([ownerId, nativeProviderFingerprint(provider), hash(provider.apiKey || '')]));
  const key = `${resolve(runtimeRoot)}:${scopeId}`;
  const existing = hostPool.get(key);
  if (existing) {
    const host = await existing;
    if (!host.client.closed) return host;
    hostPool.delete(key);
  }
  const pending = createHost({ provider, runtimeRoot, scopeId });
  hostPool.set(key, pending);
  try {
    return await pending;
  } catch (error) {
    if (hostPool.get(key) === pending) hostPool.delete(key);
    throw error;
  }
}

async function createHost({ provider, runtimeRoot, scopeId }) {
  let manifest;
  try {
    manifest = JSON.parse(await readFile(join(runtimeRoot, 'build-manifest.json'), 'utf8'));
    if (manifest.sourceCommit !== NATIVE_SOURCE_COMMIT
        || hash(await readFile(manifest.binaryPath)) !== manifest.binarySha256) throw new Error('digest');
  } catch {
    throw failure('native_binary_unverified');
  }
  const root = join(runtimeRoot, 'instances', scopeId);
  await mkdir(join(root, 'workspace'), { recursive: true, mode: 0o700 });
  await mkdir(join(root, 'home'), { recursive: true, mode: 0o700 });
  const privateHome = await realpath(join(root, 'home'));
  const cwd = await realpath(join(root, 'workspace'));
  await atomicPrivateWrite(join(privateHome, 'config.toml'), nativeConfig(provider));
  const handlers = new Map();
  const client = new NativeCodexStdioClient({
    binaryPath: resolve(manifest.binaryPath), cwd,
    args: ['--listen', 'stdio://', '--strict-config'],
    // Only the child receives this private home; parent shell and app config stay unchanged.
    env: { PATH: '/usr/bin:/bin', HOME: privateHome, CODEX_HOME: privateHome,
      CODEX_APP_SERVER_DISABLE_MANAGED_CONFIG: '1', ZFLOW_NATIVE_PROVIDER_KEY: provider.apiKey || '' },
    maxLineBytes: 32 * 1024 * 1024,
    onNotification: (event) => handlers.get(event.params?.threadId)?.onNotification?.(event),
    onServerRequest: (event) => {
      const handler = handlers.get(event.params?.threadId);
      if (!handler?.onToolCall) throw failure('native_thread_not_registered');
      return handler.onToolCall(event);
    },
  });
  await client.start({ clientInfo: { name: 'zflow_native', version: '0.1.0' }, capabilities: { experimentalApi: true } });
  return {
    client, cwd, scopeId, privateHome,
    capabilitySnapshot: {
      sourceCommit: NATIVE_SOURCE_COMMIT,
      targetCodexMainCommit: CODEX_MAIN_SNAPSHOT.sourceCommit,
      wireApi: 'responses',
      disabledFeatures: [...NATIVE_DISABLED_FEATURES],
      dynamicToolMethod: CODEX_MAIN_SNAPSHOT.dynamicToolMethod,
      collaboration: false,
    },
    collaborationGateway: createNativeCollaborationGateway({ client }),
    registerThreadHandler(threadId, handler) {
      if (handlers.has(threadId)) throw failure('native_thread_busy');
      handlers.set(threadId, handler);
      return () => { if (handlers.get(threadId) === handler) handlers.delete(threadId); };
    },
  };
}

export async function prepareNativeTurnInput(host, { userText, images = [], skills = [] }) {
  if (typeof userText !== 'string' || !userText.trim()) throw failure('native_user_message_required');
  if (images.length > 12) throw failure('native_image_limit_exceeded');
  const input = [{ type: 'text', text: userText, text_elements: [] }];
  for (const image of images) {
    if (typeof image !== 'string' || !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/.test(image)
        || image.length > 20 * 1024 * 1024) throw failure('native_image_input_invalid');
    try {
      const decoded = parseImageDataUrl(image, { maxBytes: 12 * 1024 * 1024 });
      await sharp(decoded.buffer, { failOn: 'error', limitInputPixels: 100_000_000, animated: false })
        .resize(1, 1, { fit: 'inside' }).toBuffer();
    } catch {
      throw failure('native_image_payload_invalid');
    }
    input.push({ type: 'image', url: image });
  }
  for (const skill of skills) {
    if (!skill?.id || typeof skill.content !== 'string' || !skill.content.trim()) throw failure('native_skill_missing');
    const sourceHash = hash(skill.content);
    if (skill.hash && skill.hash !== sourceHash) throw failure('native_skill_hash_mismatch');
    const name = `application-${hash(skill.id).slice(0, 12)}-${sourceHash.slice(0, 12)}`;
    const source = `---\nname: ${name}\ndescription: Application-approved visual instructions.\n---\n${skill.content}\n`;
    // Native injection truncates at 8000 bytes. Fail instead of silently weakening a locked Skill.
    if (Buffer.byteLength(source, 'utf8') > 8000) throw failure('native_skill_context_limit');
    const directory = join(host.privateHome, 'skills', name);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const path = join(await realpath(directory), 'SKILL.md');
    try {
      await writeFile(path, source, { flag: 'wx', mode: 0o400 });
    } catch (error) {
      if (error.code !== 'EEXIST' || await readFile(path, 'utf8') !== source) throw failure('native_skill_snapshot_conflict');
    }
    input.push({ type: 'skill', name, path });
  }
  if (skills.length) await host.client.request('skills/list', { cwds: [host.cwd], forceReload: true });
  return input;
}
