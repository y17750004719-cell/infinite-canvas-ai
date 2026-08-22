import path from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { classifyModel } from './provider-models.ts';
import { effectiveProviderProtocol } from './provider-protocol.mjs';

export { effectiveProviderProtocol } from './provider-protocol.mjs';

const DEFAULT_PROVIDER_ID = 'comfly';
const DEFAULT_PROVIDER_UPDATED_AT = new Date(0).toISOString();
const PROVIDER_ID_RE = /^[A-Za-z0-9_-]{2,40}$/;
const SUPPORTED_PROVIDER_PROTOCOLS = new Set(['openai', 'gemini']);
const SUPPORTED_PROVIDER_AUTH_TYPES = new Set(['api-key', 'xiaomi-browser']);
const SUPPORTED_IMAGE_REQUEST_MODES = new Set(['openai', 'openai-json']);
const SUPPORTED_IMAGE_API_KEY_SCOPES = new Set(['all', 'gemini', 'gpt']);
const PROVIDER_PRESET_TEMPLATES = {
  comfly: {
    id: 'comfly',
    name: 'Comfly',
    baseUrl: 'https://ai.comfly.org/v1',
    protocol: 'openai',
    imageRequestMode: 'openai',
  },
  'gpt-best': {
    id: 'gpt-best',
    name: 'GPT-Best',
    baseUrl: 'https://gpt-best.cn',
    protocol: 'openai',
    imageRequestMode: 'openai',
  },
  custom: {
    id: 'custom',
    name: '自定义',
    baseUrl: 'https://api.openai.com/v1',
    protocol: 'openai',
    imageRequestMode: 'openai',
  },
  xiaomi: {
    id: 'xiaomi',
    name: 'Xiaomi',
    baseUrl: 'https://api.xiaomimimo.com/v1',
    protocol: 'openai',
    imageRequestMode: 'openai',
  },
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

function resolveProviderRegistryPath(runtimeDir) {
  return path.join(resolveRuntimeDir(runtimeDir), 'api-providers.json');
}

function resolveLegacyProviderConfigPath(runtimeDir) {
  return path.join(resolveRuntimeDir(runtimeDir), 'provider-config.json');
}

function normalizeText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function providerKeyEnv(providerId) {
  const normalizedProviderId = normalizeText(providerId).toLowerCase();
  if (normalizedProviderId === 'comfly') {
    return 'COMFLY_API_KEY';
  }
  if (normalizedProviderId === 'gpt-best') {
    return 'GPT_BEST_API_KEY';
  }
  return `API_PROVIDER_${normalizedProviderId.replace(/[^A-Za-z0-9]/g, '_').toUpperCase()}_KEY`;
}

function inferProviderId(baseUrl) {
  const normalizedBaseUrl = normalizeText(baseUrl).toLowerCase();
  if (normalizedBaseUrl.includes('gpt-best')) {
    return 'gpt-best';
  }
  if (normalizedBaseUrl.includes('comfly')) {
    return 'comfly';
  }
  return 'custom';
}

function normalizeProviderId(value, fallbackBaseUrl) {
  const raw = normalizeText(value).toLowerCase();
  if (raw && PROVIDER_ID_RE.test(raw)) {
    return raw;
  }
  return inferProviderId(fallbackBaseUrl) || DEFAULT_PROVIDER_ID;
}

function normalizeProviderName(value, providerId) {
  const raw = normalizeText(value).replace(/\s+/g, ' ');
  if (raw) {
    return raw.slice(0, 60);
  }
  return PROVIDER_PRESET_TEMPLATES[providerId]?.name || providerId;
}

function normalizeBaseUrl(value) {
  const raw = normalizeText(value);
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

function normalizeProtocol(value, fallback = 'openai') {
  const raw = normalizeText(value).toLowerCase();
  if (SUPPORTED_PROVIDER_PROTOCOLS.has(raw)) {
    return raw;
  }
  return SUPPORTED_PROVIDER_PROTOCOLS.has(fallback) ? fallback : 'openai';
}

function normalizeImageRequestMode(value, fallback = 'openai') {
  const raw = normalizeText(value).toLowerCase();
  if (SUPPORTED_IMAGE_REQUEST_MODES.has(raw)) {
    return raw;
  }
  return SUPPORTED_IMAGE_REQUEST_MODES.has(fallback) ? fallback : 'openai';
}

function normalizeEndpointOverride(value, label) {
  const raw = normalizeText(value);
  if (!raw) {
    return '';
  }
  if (raw.length > 300 || /\s/.test(raw)) {
    throw new ProviderConfigError(`${label} must be a valid /v1/... path or full http/https URL`);
  }
  if (/^https?:\/\//i.test(raw)) {
    return raw.replace(/\/+$/, '');
  }
  if (!raw.startsWith('/')) {
    throw new ProviderConfigError(`${label} must start with /v1/... or be a full http/https URL`);
  }
  return raw;
}

function normalizeApiKey(value) {
  return normalizeText(value);
}

function normalizeAuthType(value, providerId) {
  const raw = normalizeText(value).toLowerCase();
  if (SUPPORTED_PROVIDER_AUTH_TYPES.has(raw)) return raw;
  return 'api-key';
}

function normalizeImageApiKeyScope(value) {
  const raw = normalizeText(value).toLowerCase();
  return SUPPORTED_IMAGE_API_KEY_SCOPES.has(raw) ? raw : 'all';
}

function normalizeImageApiKeys(input) {
  const rawRows = Array.isArray(input.imageApiKeys || input.image_api_keys)
    ? input.imageApiKeys || input.image_api_keys
    : normalizeApiKey(input.imageApiKey || input.image_api_key)
      ? [
          {
            id: 'image-key-1',
            apiKey: input.imageApiKey || input.image_api_key,
            scope: input.imageApiKeyScope || input.image_api_key_scope,
          },
        ]
      : [];

  return rawRows
    .map((row, index) => {
      const source = row && typeof row === 'object' && !Array.isArray(row) ? row : {};
      const apiKey = normalizeApiKey(source.apiKey || source.api_key);
      if (!apiKey) {
        return null;
      }
      return {
        id: normalizeText(source.id).slice(0, 80) || `image-key-${index + 1}`,
        apiKey,
        scope: normalizeImageApiKeyScope(source.scope || source.imageApiKeyScope || source.image_api_key_scope),
      };
    })
    .filter(Boolean);
}

function normalizeBoolean(value, fallback = true) {
  if (typeof value === 'boolean') {
    return value;
  }
  return fallback;
}

function normalizeModelList(values) {
  if (!Array.isArray(values)) {
    return [];
  }
  const deduped = [];
  for (const value of values) {
    const item = normalizeText(value);
    if (item && !deduped.includes(item)) {
      deduped.push(item);
    }
  }
  return deduped;
}

function isVoiceModelId(modelId) {
  const normalized = normalizeText(modelId).toLowerCase();
  return /(^|[-_])(tts|speech|voice|audio)([-_]|$)/.test(normalized) || normalized.includes('text-to-speech');
}

function normalizeModelProtocols(values) {
  if (!values || typeof values !== 'object' || Array.isArray(values)) {
    return {};
  }
  const result = {};
  for (const [model, protocol] of Object.entries(values)) {
    const modelId = normalizeText(model);
    const normalizedProtocol = normalizeText(protocol).toLowerCase();
    if (modelId && SUPPORTED_PROVIDER_PROTOCOLS.has(normalizedProtocol)) {
      result[modelId] = normalizedProtocol;
    }
  }
  return result;
}

function maskApiKey(apiKey) {
  if (!apiKey) return '';
  if (apiKey.length <= 4) return '*'.repeat(apiKey.length);
  if (apiKey.length <= 8) {
    return `${apiKey.slice(0, 2)}${'*'.repeat(apiKey.length - 4)}${apiKey.slice(-2)}`;
  }
  return `${apiKey.slice(0, 4)}${'*'.repeat(apiKey.length - 8)}${apiKey.slice(-4)}`;
}

function buildProviderTemplate(providerId) {
  const preset = PROVIDER_PRESET_TEMPLATES[providerId] || PROVIDER_PRESET_TEMPLATES.custom;
  return {
    id: preset.id,
    name: preset.name,
    baseUrl: preset.baseUrl,
    protocol: preset.protocol,
    imageRequestMode: preset.imageRequestMode,
    imageGenerationEndpoint: '',
    imageEditEndpoint: '',
    enabled: true,
    primary: providerId === DEFAULT_PROVIDER_ID,
    imageModels: [],
    chatModels: [],
    voiceModels: [],
    modelProtocols: {},
    apiKey: '',
    authType: 'api-key',
    accountId: '',
    imageApiKeys: [],
    updatedAt: DEFAULT_PROVIDER_UPDATED_AT,
  };
}

function normalizeProvider(input, { fallbackApiKey = '', fallbackPrimary = false } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new ProviderConfigError('Provider config file is invalid', 500);
  }

  const rawBaseUrl = normalizeBaseUrl(input.baseUrl);
  const id = normalizeProviderId(input.id || input.providerId, rawBaseUrl);
  const protocol = normalizeProtocol(
    input.protocol,
    id === 'custom' ? 'openai' : PROVIDER_PRESET_TEMPLATES[id]?.protocol || 'openai'
  );
  const imageRequestMode = normalizeImageRequestMode(input.imageRequestMode || input.image_request_mode);
  const updatedAt = normalizeText(input.updatedAt) || new Date().toISOString();

  const configuredImageModels = normalizeModelList(input.imageModels || input.image_models);
  const configuredChatModels = normalizeModelList(input.chatModels || input.chat_models);
  const configuredVoiceModels = normalizeModelList(input.voiceModels || input.voice_models);
  const migratedImageModels = configuredChatModels.filter((modelId) => classifyModel(modelId) === 'image');
  const imageModels = normalizeModelList([...configuredImageModels, ...migratedImageModels]);
  const imageModelSet = new Set(imageModels);
  const migratedVoiceModels = id === 'xiaomi'
    ? configuredChatModels.filter((modelId) => isVoiceModelId(modelId))
    : [];
  const voiceModels = normalizeModelList([...configuredVoiceModels, ...migratedVoiceModels]);
  const voiceModelSet = new Set(voiceModels);

  return {
    id,
    name: normalizeProviderName(input.name, id),
    baseUrl: rawBaseUrl,
    protocol,
    imageRequestMode,
    imageGenerationEndpoint: normalizeEndpointOverride(
      input.imageGenerationEndpoint || input.image_generation_endpoint,
      'Image generation endpoint'
    ),
    imageEditEndpoint: normalizeEndpointOverride(
      input.imageEditEndpoint || input.image_edit_endpoint,
      'Image edit endpoint'
    ),
    enabled: normalizeBoolean(input.enabled, true),
    primary: normalizeBoolean(input.primary, fallbackPrimary),
    imageModels,
    chatModels: configuredChatModels.filter((modelId) => !imageModelSet.has(modelId) && !voiceModelSet.has(modelId)),
    voiceModels,
    modelProtocols: normalizeModelProtocols(input.modelProtocols || input.model_protocols),
    apiKey: normalizeApiKey(input.apiKey || fallbackApiKey),
    authType: normalizeAuthType(input.authType || input.auth_type, id),
    accountId: normalizeText(input.accountId || input.account_id),
    imageApiKeys: normalizeImageApiKeys(input),
    updatedAt,
  };
}

function cloneProvider(provider) {
  return {
    ...provider,
    imageModels: [...provider.imageModels],
    chatModels: [...provider.chatModels],
    voiceModels: [...provider.voiceModels],
    modelProtocols: { ...provider.modelProtocols },
    imageApiKeys: [...provider.imageApiKeys],
  };
}

function ensureSinglePrimary(providers) {
  const nextProviders = providers.map((provider) => cloneProvider(provider));
  const enabledIndexes = nextProviders
    .map((provider, index) => (provider.enabled !== false ? index : -1))
    .filter((index) => index >= 0);
  if (enabledIndexes.length === 0) {
    throw new ProviderConfigError('At least one provider must be enabled');
  }
  const primaryCandidates = nextProviders
    .map((provider, index) => (provider.enabled !== false && provider.primary ? index : -1))
    .filter((index) => index >= 0);
  const winnerIndex = primaryCandidates.length > 0
    ? primaryCandidates[primaryCandidates.length - 1]
    : enabledIndexes[0];

  return nextProviders.map((provider, index) => ({
    ...provider,
    primary: index === winnerIndex,
  }));
}

function createDefaultProvidersFromEnv(env = process.env) {
  const providers = ['comfly', 'xiaomi'].map((providerId) => buildProviderTemplate(providerId));
  const comflyBaseUrl = normalizeText(env.COMFLY_API_URL);
  const gptBestBaseUrl = normalizeText(env.GPT_BEST_BASE_URL);
  const inferredPrimaryId = inferProviderId(comflyBaseUrl || gptBestBaseUrl || PROVIDER_PRESET_TEMPLATES.comfly.baseUrl);

  const nextProviders = providers.map((provider) => {
    const nextProvider = cloneProvider(provider);
    if (provider.id === 'comfly' && comflyBaseUrl) {
      nextProvider.baseUrl = normalizeBaseUrl(comflyBaseUrl);
    }
    if (provider.id === 'gpt-best' && gptBestBaseUrl) {
      nextProvider.baseUrl = normalizeBaseUrl(gptBestBaseUrl);
    }
    nextProvider.apiKey = normalizeApiKey(env[providerKeyEnv(provider.id)]);
    if (provider.id === 'xiaomi') nextProvider.enabled = false;
    nextProvider.primary = provider.id === inferredPrimaryId;
    return nextProvider;
  });

  return ensureSinglePrimary(nextProviders);
}

function normalizeLegacyProviderConfig(rawConfig, env = process.env) {
  if (!rawConfig || typeof rawConfig !== 'object' || Array.isArray(rawConfig)) {
    throw new ProviderConfigError('Provider config file is invalid', 500);
  }

  const baseUrl = normalizeBaseUrl(rawConfig.baseUrl);
  const providerId = normalizeProviderId(rawConfig.providerId, baseUrl);
  const provider = normalizeProvider(
    {
      ...buildProviderTemplate(providerId),
      id: providerId,
      baseUrl,
      modelProtocols: rawConfig.modelProtocols || rawConfig.model_protocols,
      apiKey: normalizeApiKey(rawConfig.apiKey) || normalizeApiKey(env[providerKeyEnv(providerId)]),
      updatedAt: normalizeText(rawConfig.updatedAt) || new Date().toISOString(),
      primary: true,
    },
    {
      fallbackPrimary: true,
    }
  );

  const defaults = createDefaultProvidersFromEnv(env);
  const matchedDefaults = defaults.map((item) => (item.id === provider.id ? { ...item, ...provider, primary: true } : item));
  if (matchedDefaults.some((item) => item.id === provider.id)) {
    return ensureSinglePrimary(matchedDefaults);
  }
  return ensureSinglePrimary([...matchedDefaults, provider]);
}

function normalizeProviderArray(rawProviders) {
  if (!Array.isArray(rawProviders)) {
    throw new ProviderConfigError('Provider config file is invalid', 500);
  }
  if (rawProviders.length === 0) {
    throw new ProviderConfigError('At least one provider must be configured');
  }

  const providers = [];
  for (const rawProvider of rawProviders) {
    const provider = normalizeProvider(rawProvider);
    if (providers.some((existingProvider) => existingProvider.id === provider.id)) {
      throw new ProviderConfigError(`Duplicate provider id: ${provider.id}`);
    }
    providers.push(provider);
  }

  return ensureSinglePrimary(providers);
}

function providerMatchesId(provider, providerId) {
  return normalizeText(provider?.id).toLowerCase() === normalizeText(providerId).toLowerCase();
}

function buildPrimaryProviderConfig(provider) {
  return {
    providerId: provider.id,
    baseUrl: provider.baseUrl,
    apiKey: provider.apiKey,
    authType: provider.authType,
    accountId: provider.accountId,
    updatedAt: provider.updatedAt,
  };
}

function toProviderView(provider, source) {
  return {
    id: provider.id,
    name: provider.name,
    baseUrl: provider.baseUrl,
    protocol: provider.protocol,
    imageRequestMode: provider.imageRequestMode,
    imageGenerationEndpoint: provider.imageGenerationEndpoint,
    imageEditEndpoint: provider.imageEditEndpoint,
    enabled: provider.enabled,
    primary: provider.primary,
    imageModels: [...provider.imageModels],
    chatModels: [...provider.chatModels],
    voiceModels: [...provider.voiceModels],
    modelProtocols: { ...provider.modelProtocols },
    apiKey: provider.apiKey,
    authType: provider.authType,
    accountId: provider.accountId,
    imageApiKeys: provider.imageApiKeys.map((row) => ({
      id: row.id,
      apiKey: row.apiKey,
      scope: row.scope,
      hasApiKey: Boolean(row.apiKey),
      maskedApiKey: maskApiKey(row.apiKey),
    })),
    hasApiKey: Boolean(provider.apiKey),
    maskedApiKey: maskApiKey(provider.apiKey),
    source: source === 'runtime' ? 'runtime' : 'env',
    updatedAt: provider.updatedAt,
  };
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

export function providerEndpointUrl(provider, key, defaultPath) {
  const providerTargets = resolveProviderRequestTargets(provider.baseUrl);
  const override = normalizeText(provider[key]);
  if (override) {
    if (/^https?:\/\//i.test(override)) {
      return override.replace(/\/+$/, '');
    }
    const parsedBaseUrl = new URL(provider.baseUrl);
    return `${parsedBaseUrl.protocol}//${parsedBaseUrl.host}${override}`;
  }

  const baseUrl = provider.protocol === 'gemini' ? providerTargets.geminiBaseUrl : providerTargets.openAiBaseUrl;
  const trimmedBaseUrl = baseUrl.replace(/\/+$/, '');
  for (const prefix of ['/api/v3', '/v1beta', '/v1', '/v2']) {
    if (trimmedBaseUrl.endsWith(prefix) && defaultPath.startsWith(`${prefix}/`)) {
      return `${trimmedBaseUrl}${defaultPath.slice(prefix.length)}`;
    }
  }
  return `${trimmedBaseUrl}${defaultPath}`;
}

export function getPrimaryProvider(providers) {
  const normalizedProviders = Array.isArray(providers) ? providers : [];
  return normalizedProviders.find((provider) => provider.primary) || normalizedProviders[0] || null;
}

export function getProviderById(providers, providerId) {
  const normalizedProviders = Array.isArray(providers) ? providers : [];
  const matchedProvider = normalizedProviders.find((provider) => providerMatchesId(provider, providerId));
  return matchedProvider || getPrimaryProvider(normalizedProviders);
}

export async function readProviderRegistry({
  runtimeDir,
  env = process.env,
  readFileImpl = readFile,
} = {}) {
  const registryPath = resolveProviderRegistryPath(runtimeDir);
  const legacyPath = resolveLegacyProviderConfigPath(runtimeDir);

  try {
    const raw = await readFileImpl(registryPath, 'utf8');
    const parsed = JSON.parse(raw);
    const providers = normalizeProviderArray(Array.isArray(parsed) ? parsed : parsed.providers);
    return {
      providers,
      source: 'runtime',
      path: registryPath,
    };
  } catch (error) {
    if (!(error && typeof error === 'object' && 'code' in error && (error.code === 'ENOENT' || error.code === 'ENOTDIR'))) {
      if (error instanceof SyntaxError) {
        throw new ProviderConfigError('Provider config file is invalid', 500);
      }
      throw error;
    }
  }

  try {
    const legacyRaw = await readFileImpl(legacyPath, 'utf8');
    const parsedLegacy = JSON.parse(legacyRaw);
    return {
      providers: normalizeLegacyProviderConfig(parsedLegacy, env),
      source: 'runtime',
      path: legacyPath,
    };
  } catch (error) {
    if (!(error && typeof error === 'object' && 'code' in error && (error.code === 'ENOENT' || error.code === 'ENOTDIR'))) {
      if (error instanceof SyntaxError) {
        throw new ProviderConfigError('Provider config file is invalid', 500);
      }
      throw error;
    }
  }

  return {
    providers: createDefaultProvidersFromEnv(env),
    source: 'env',
    path: registryPath,
  };
}

export async function updateProviderRegistry(
  providersInput,
  {
    runtimeDir,
    mkdirImpl = mkdir,
    writeFileImpl = writeFile,
  } = {}
) {
  const providers = normalizeProviderArray(providersInput);
  const registryPath = resolveProviderRegistryPath(runtimeDir);
  const nextRuntimeDir = resolveRuntimeDir(runtimeDir);
  await mkdirImpl(nextRuntimeDir, { recursive: true });
  await writeFileImpl(
    registryPath,
    `${JSON.stringify(providers.map((provider) => ({
      id: provider.id,
      name: provider.name,
      baseUrl: provider.baseUrl,
      protocol: provider.protocol,
      imageRequestMode: provider.imageRequestMode,
      imageGenerationEndpoint: provider.imageGenerationEndpoint,
      imageEditEndpoint: provider.imageEditEndpoint,
      enabled: provider.enabled,
      primary: provider.primary,
      imageModels: provider.imageModels,
      chatModels: provider.chatModels,
      voiceModels: provider.voiceModels,
      modelProtocols: provider.modelProtocols,
      apiKey: provider.apiKey,
      authType: provider.authType,
      accountId: provider.accountId,
      imageApiKeys: provider.imageApiKeys,
      updatedAt: provider.updatedAt,
    })), null, 2)}\n`,
    'utf8'
  );

  return {
    providers,
    source: 'runtime',
    path: registryPath,
  };
}

export async function readProviderConfig(options = {}) {
  const registry = await readProviderRegistry(options);
  const primaryProvider = getPrimaryProvider(registry.providers);
  if (!primaryProvider) {
    throw new ProviderConfigError('Provider config file is invalid', 500);
  }

  return {
    config: buildPrimaryProviderConfig(primaryProvider),
    source: registry.source,
    path: registry.path,
  };
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
  const existing = await readProviderRegistry({ runtimeDir, env });
  const requestedBaseUrl = normalizeBaseUrl(input?.baseUrl);
  const requestedProviderId = normalizeProviderId(input?.providerId, requestedBaseUrl);
  const requestedApiKey = normalizeApiKey(input?.apiKey);
  const currentPrimary = getPrimaryProvider(existing.providers);
  const currentRequested = existing.providers.find((provider) => provider.id === requestedProviderId);
  const preservedApiKey =
    requestedApiKey ||
    normalizeApiKey(currentRequested?.apiKey) ||
    normalizeApiKey(currentPrimary?.apiKey);

  if (!preservedApiKey) {
    throw new ProviderConfigError('API Key is required for the first saved provider config');
  }

  const baseProvider = currentRequested
    ? cloneProvider(currentRequested)
    : buildProviderTemplate(requestedProviderId);
  const updatedProvider = normalizeProvider(
    {
      ...baseProvider,
      id: requestedProviderId,
      baseUrl: requestedBaseUrl,
      apiKey: preservedApiKey,
      primary: true,
      updatedAt: new Date().toISOString(),
    },
    {
      fallbackApiKey: preservedApiKey,
      fallbackPrimary: true,
    }
  );

  const nextProviders = existing.providers.map((provider) =>
    provider.id === updatedProvider.id
      ? updatedProvider
      : {
          ...provider,
          primary: false,
        }
  );

  if (!nextProviders.some((provider) => provider.id === updatedProvider.id)) {
    nextProviders.push(updatedProvider);
  }

  const savedRegistry = await updateProviderRegistry(ensureSinglePrimary(nextProviders), {
    runtimeDir,
    mkdirImpl,
    writeFileImpl,
  });
  const primaryProvider = getPrimaryProvider(savedRegistry.providers);

  return {
    config: buildPrimaryProviderConfig(primaryProvider),
    source: savedRegistry.source,
    path: savedRegistry.path,
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
    apiKey: config.apiKey,
    hasApiKey: Boolean(config.apiKey),
    maskedApiKey: maskApiKey(config.apiKey),
    source: result?.source === 'runtime' ? 'runtime' : 'env',
    updatedAt: config.updatedAt,
  };
}

export function toProviderRegistryView(result) {
  const providers = Array.isArray(result?.providers) ? result.providers : [];
  return {
    providers: providers.map((provider) => toProviderView(provider, result?.source)),
  };
}
