import path from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

const DEFAULT_PROVIDER_ID = 'comfly';
const PROVIDER_PRESET_BASE_URLS = {
  comfly: 'https://ai.comfly.chat/v1',
  'gpt-best': 'https://gpt-best.cn',
  custom: 'https://api.openai.com/v1',
};

export class ProviderConfigError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.name = 'ProviderConfigError';
    this.statusCode = statusCode;
  }
}

function resolveRuntimeDir(runtimeDir) {
  return runtimeDir || path.join(process.cwd(), 'runtime');
}

function resolveProviderConfigPath(runtimeDir) {
  return path.join(resolveRuntimeDir(runtimeDir), 'provider-config.json');
}

function isProviderId(value) {
  return value === 'comfly' || value === 'gpt-best' || value === 'custom';
}

function inferProviderId(baseUrl) {
  if (typeof baseUrl !== 'string') {
    return DEFAULT_PROVIDER_ID;
  }

  const normalizedBaseUrl = baseUrl.toLowerCase();
  if (normalizedBaseUrl.includes('gpt-best')) {
    return 'gpt-best';
  }
  if (normalizedBaseUrl.includes('comfly')) {
    return 'comfly';
  }
  return 'custom';
}

function normalizeProviderId(value, fallbackBaseUrl) {
  if (isProviderId(value)) {
    return value;
  }

  return inferProviderId(fallbackBaseUrl);
}

function normalizeBaseUrl(value) {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw) {
    throw new ProviderConfigError('Base URL is required');
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(raw);
  } catch {
    throw new ProviderConfigError('Base URL must be a valid http/https URL');
  }

  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
    throw new ProviderConfigError('Base URL must be a valid http/https URL');
  }

  return raw.replace(/\/+$/, '');
}

function normalizeApiKey(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function getDefaultBaseUrlForProvider(providerId) {
  return PROVIDER_PRESET_BASE_URLS[providerId] || PROVIDER_PRESET_BASE_URLS.custom;
}

function getEnvProviderConfig(env = process.env) {
  const envBaseUrl =
    (typeof env.COMFLY_API_URL === 'string' && env.COMFLY_API_URL.trim()) ||
    (typeof env.GPT_BEST_BASE_URL === 'string' && env.GPT_BEST_BASE_URL.trim()) ||
    getDefaultBaseUrlForProvider(DEFAULT_PROVIDER_ID);
  const baseUrl = normalizeBaseUrl(envBaseUrl);

  return {
    providerId: inferProviderId(baseUrl),
    baseUrl,
    apiKey:
      (typeof env.COMFLY_API_KEY === 'string' && env.COMFLY_API_KEY.trim()) ||
      (typeof env.GPT_BEST_API_KEY === 'string' && env.GPT_BEST_API_KEY.trim()) ||
      '',
    updatedAt: new Date(0).toISOString(),
  };
}

function normalizePersistedConfig(rawConfig) {
  if (!rawConfig || typeof rawConfig !== 'object' || Array.isArray(rawConfig)) {
    throw new ProviderConfigError('Provider config file is invalid', 500);
  }

  const nextBaseUrl = normalizeBaseUrl(rawConfig.baseUrl);
  const nextApiKey = normalizeApiKey(rawConfig.apiKey);
  const nextProviderId = normalizeProviderId(rawConfig.providerId, nextBaseUrl);
  const updatedAt =
    typeof rawConfig.updatedAt === 'string' && rawConfig.updatedAt.trim()
      ? rawConfig.updatedAt.trim()
      : new Date().toISOString();

  return {
    providerId: nextProviderId,
    baseUrl: nextBaseUrl,
    apiKey: nextApiKey,
    updatedAt,
  };
}

function maskApiKey(apiKey) {
  if (!apiKey) return '';
  if (apiKey.length <= 8) return '已配置';
  return `${apiKey.slice(0, 4)}...${apiKey.slice(-4)}`;
}

export function resolveProviderRequestTargets(baseUrl) {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
  const openAiBaseUrl = normalizedBaseUrl;
  const providerRootBaseUrl = normalizedBaseUrl.endsWith('/v1')
    ? normalizedBaseUrl.slice(0, -3)
    : normalizedBaseUrl;

  return {
    baseUrl: normalizedBaseUrl,
    openAiBaseUrl,
    geminiBaseUrl: providerRootBaseUrl,
    recraftBaseUrl: providerRootBaseUrl,
  };
}

export async function readProviderConfig({
  runtimeDir,
  env = process.env,
  readFileImpl = readFile,
} = {}) {
  const configPath = resolveProviderConfigPath(runtimeDir);

  try {
    const raw = await readFileImpl(configPath, 'utf8');
    const parsed = JSON.parse(raw);
    return {
      config: normalizePersistedConfig(parsed),
      source: 'runtime',
      path: configPath,
    };
  } catch (error) {
    if (
      error &&
      typeof error === 'object' &&
      'code' in error &&
      (error.code === 'ENOENT' || error.code === 'ENOTDIR')
    ) {
      return {
        config: getEnvProviderConfig(env),
        source: 'env',
        path: configPath,
      };
    }

    if (error instanceof SyntaxError) {
      throw new ProviderConfigError('Provider config file is invalid', 500);
    }

    throw error;
  }
}

export async function updateProviderConfig(
  input,
  {
    runtimeDir,
    env = process.env,
    mkdirImpl = mkdir,
    writeFileImpl = writeFile,
  } = {}
) {
  const existing = await readProviderConfig({ runtimeDir, env });
  const nextBaseUrl = normalizeBaseUrl(input?.baseUrl);
  const nextProviderId = normalizeProviderId(input?.providerId, nextBaseUrl);
  const preservedApiKey = normalizeApiKey(existing.config.apiKey);
  const requestedApiKey = normalizeApiKey(input?.apiKey);
  const nextApiKey = requestedApiKey || preservedApiKey;

  if (!nextApiKey) {
    throw new ProviderConfigError('API Key is required for the first saved provider config');
  }

  const nextConfig = {
    providerId: nextProviderId,
    baseUrl: nextBaseUrl,
    apiKey: nextApiKey,
    updatedAt: new Date().toISOString(),
  };

  const nextRuntimeDir = resolveRuntimeDir(runtimeDir);
  const configPath = resolveProviderConfigPath(runtimeDir);
  await mkdirImpl(nextRuntimeDir, { recursive: true });
  await writeFileImpl(configPath, `${JSON.stringify(nextConfig, null, 2)}\n`, 'utf8');

  return {
    config: nextConfig,
    source: 'runtime',
    path: configPath,
  };
}

export function toProviderConfigView(result) {
  const config = result?.config;
  if (!config) {
    throw new ProviderConfigError('Provider config view requires a config object', 500);
  }

  return {
    providerId: config.providerId,
    baseUrl: config.baseUrl,
    hasApiKey: Boolean(config.apiKey),
    maskedApiKey: maskApiKey(config.apiKey),
    source: result?.source === 'runtime' ? 'runtime' : 'env',
    updatedAt: config.updatedAt,
  };
}
