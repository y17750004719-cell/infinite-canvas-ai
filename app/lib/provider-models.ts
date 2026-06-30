export type ProviderModelProtocol = 'openai' | 'gemini';
export type ProviderImageRequestMode = 'openai' | 'openai-json';

export interface ProviderModelProbeResult {
  ok: boolean;
  status: number;
  message: string;
  modelCount: number;
  allModels: string[];
  imageModels: string[];
  chatModels: string[];
  imageRequestMode: ProviderImageRequestMode;
}

export function normalizeProviderModelProtocol(value: unknown): ProviderModelProtocol {
  return value === 'gemini' ? 'gemini' : 'openai';
}

export function normalizeProviderImageRequestMode(value: unknown): ProviderImageRequestMode {
  return value === 'openai-json' ? 'openai-json' : 'openai';
}

export function normalizeProviderModelBaseUrl(value: unknown): string {
  const baseUrl = typeof value === 'string' ? value.trim().replace(/\/+$/, '') : '';
  if (!baseUrl) {
    throw new Error('请先填写请求地址');
  }
  const parsedUrl = new URL(baseUrl);
  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
    throw new Error('请求地址必须以 http:// 或 https:// 开头');
  }
  return baseUrl;
}

export function normalizeProviderModelApiKey(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function upstreamModelsUrl(baseUrl: string, protocol: ProviderModelProtocol): string {
  if (protocol === 'gemini') {
    return baseUrl.endsWith('/v1beta') ? `${baseUrl}/models` : `${baseUrl}/v1beta/models`;
  }
  return baseUrl.endsWith('/v1') ? `${baseUrl}/models` : `${baseUrl}/v1/models`;
}

export function upstreamModelHeaders(apiKey: string, protocol: ProviderModelProtocol): Record<string, string> {
  if (protocol === 'gemini') {
    return {
      Accept: 'application/json',
      'x-goog-api-key': apiKey,
    };
  }
  return {
    Accept: 'application/json',
    Authorization: `Bearer ${apiKey.replace(/^Bearer\s+/i, '')}`,
  };
}

function normalizeProviderModelId(modelId: unknown, protocol?: ProviderModelProtocol): string {
  const normalizedModelId = typeof modelId === 'string' ? modelId.trim() : '';
  if (protocol === 'gemini' && normalizedModelId.startsWith('models/')) {
    return normalizedModelId.slice('models/'.length);
  }
  return normalizedModelId;
}

function collectModelCapabilityHints(value: unknown, result: string[] = []): string[] {
  if (typeof value === 'string') {
    const normalizedValue = value.trim().toLowerCase();
    if (normalizedValue) result.push(normalizedValue);
    return result;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      collectModelCapabilityHints(item, result);
    }
    return result;
  }
  if (!value || typeof value !== 'object') {
    return result;
  }

  for (const [key, nestedValue] of Object.entries(value)) {
    const normalizedKey = key.trim().toLowerCase();
    if (!normalizedKey) continue;
    if (typeof nestedValue === 'boolean') {
      result.push(`${normalizedKey}:${nestedValue ? 'true' : 'false'}`);
      continue;
    }
    result.push(normalizedKey);
    collectModelCapabilityHints(nestedValue, result);
  }
  return result;
}

function modelSupportsImageFromMetadata(model: unknown): boolean | null {
  if (!model || typeof model !== 'object') {
    return null;
  }

  const hints = collectModelCapabilityHints([
    (model as { modalities?: unknown }).modalities,
    (model as { input_modalities?: unknown }).input_modalities,
    (model as { output_modalities?: unknown }).output_modalities,
    (model as { capabilities?: unknown }).capabilities,
    (model as { type?: unknown }).type,
    (model as { mode?: unknown }).mode,
  ]);

  if (hints.length === 0) {
    return null;
  }

  const imageHintPatterns = [
    /(^|[\W_])image([\W_]|$)/,
    /(^|[\W_])images([\W_]|$)/,
    /(^|[\W_])vision([\W_]|$)/,
    /(^|[\W_])recraft([\W_]|$)/,
    /(^|[\W_])text-to-image([\W_]|$)/,
    /(^|[\W_])image-to-image([\W_]|$)/,
  ];
  const textOnlyHintPatterns = [
    /(^|[\W_])text([\W_]|$)/,
    /(^|[\W_])chat([\W_]|$)/,
    /(^|[\W_])language([\W_]|$)/,
  ];

  let sawTextOnlyHint = false;
  for (const hint of hints) {
    if (hint.endsWith(':false')) {
      continue;
    }
    if (hint.endsWith(':true')) {
      const key = hint.slice(0, -':true'.length);
      if (imageHintPatterns.some((pattern) => pattern.test(key))) {
        return true;
      }
    }
    if (imageHintPatterns.some((pattern) => pattern.test(hint))) {
      return true;
    }
    if (textOnlyHintPatterns.some((pattern) => pattern.test(hint))) {
      sawTextOnlyHint = true;
    }
  }

  return sawTextOnlyHint ? false : null;
}

export function classifyModel(modelId: string, model?: unknown): 'image' | 'chat' {
  const metadataClassification = modelSupportsImageFromMetadata(model);
  if (metadataClassification === true) {
    return 'image';
  }
  if (metadataClassification === false) {
    return 'chat';
  }

  const lower = modelId.toLowerCase();
  if (
    lower.includes('image') ||
    lower.includes('imagen') ||
    lower.includes('dall-e') ||
    lower.includes('dalle') ||
    lower.includes('gemini-2.5-flash-image') ||
    lower.includes('gpt-image') ||
    lower.includes('flux') ||
    lower.includes('recraft') ||
    lower.includes('seedream') ||
    lower.includes('wanx') ||
    lower.includes('-t2i') ||
    lower.includes('-i2i') ||
    lower.includes('stable-diffusion') ||
    lower.startsWith('sd3')
  ) {
    return 'image';
  }
  return 'chat';
}

export function parseProviderModels(
  payload: unknown,
  protocol: ProviderModelProtocol
): { imageModels: string[]; chatModels: string[]; allModels: string[] } {
  const rawItems =
    payload && typeof payload === 'object' && Array.isArray((payload as { data?: unknown }).data)
      ? (payload as { data: unknown[] }).data
      : payload && typeof payload === 'object' && Array.isArray((payload as { models?: unknown }).models)
        ? (payload as { models: unknown[] }).models
        : [];
  const parsedModels = rawItems
    .map((item) => {
      if (typeof item === 'string') {
        return {
          id: normalizeProviderModelId(item, protocol),
          model: item,
        };
      }
      if (item && typeof item === 'object') {
        const value =
          (item as { id?: unknown }).id ||
          (item as { name?: unknown }).name ||
          (item as { model?: unknown }).model;
        return {
          id: normalizeProviderModelId(value, protocol),
          model: item,
        };
      }
      return { id: '', model: item };
    })
    .filter((entry) => entry.id);

  const categoryByModelId = new Map<string, 'image' | 'chat'>();
  for (const entry of parsedModels) {
    if (categoryByModelId.has(entry.id)) continue;
    categoryByModelId.set(entry.id, classifyModel(entry.id, entry.model));
  }

  const allModels = Array.from(categoryByModelId.keys()).sort();
  const imageModels = allModels.filter((modelId) => categoryByModelId.get(modelId) === 'image');
  const chatModels = allModels.filter((modelId) => categoryByModelId.get(modelId) === 'chat');
  return { imageModels, chatModels, allModels };
}

export async function fetchProviderModels({
  baseUrl,
  apiKey,
  protocol,
  imageRequestMode,
}: {
  baseUrl: string;
  apiKey: string;
  protocol: ProviderModelProtocol;
  imageRequestMode: ProviderImageRequestMode;
}): Promise<ProviderModelProbeResult> {
  const endpoint = upstreamModelsUrl(baseUrl, protocol);
  const response = await fetch(endpoint, {
    headers: upstreamModelHeaders(apiKey, protocol),
    signal: AbortSignal.timeout(15000),
  });
  const rawText = await response.text();
  const payload = rawText ? JSON.parse(rawText) : {};

  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      message: rawText.slice(0, 300) || `上游模型列表不可用 (${response.status})`,
      modelCount: 0,
      allModels: [],
      imageModels: [],
      chatModels: [],
      imageRequestMode,
    };
  }

  const models = parseProviderModels(payload, protocol);
  return {
    ok: true,
    status: response.status,
    message: `连接可用${models.allModels.length ? `，找到 ${models.allModels.length} 个模型` : ''}`,
    modelCount: models.allModels.length,
    allModels: models.allModels,
    imageModels: models.imageModels,
    chatModels: models.chatModels,
    imageRequestMode,
  };
}
