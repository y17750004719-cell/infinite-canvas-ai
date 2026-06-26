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

export function classifyModel(modelId: string): 'image' | 'chat' {
  const lower = modelId.toLowerCase();
  if (
    lower.includes('image') ||
    lower.includes('imagen') ||
    lower.includes('dall-e') ||
    lower.includes('dalle') ||
    lower.includes('gemini-2.5-flash-image') ||
    lower.includes('gpt-image')
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
  const allModels = Array.from(
    new Set(
      rawItems
        .map((item) => {
          if (typeof item === 'string') return item;
          if (item && typeof item === 'object') {
            const value =
              (item as { id?: unknown }).id ||
              (item as { name?: unknown }).name ||
              (item as { model?: unknown }).model;
            return typeof value === 'string' ? value : '';
          }
          return '';
        })
        .map((modelId) => (protocol === 'gemini' && modelId.startsWith('models/') ? modelId.slice('models/'.length) : modelId))
        .filter(Boolean)
    )
  ).sort();
  const imageModels = allModels.filter((modelId) => classifyModel(modelId) === 'image');
  const chatModels = allModels.filter((modelId) => classifyModel(modelId) === 'chat');
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
