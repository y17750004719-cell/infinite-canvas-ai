import { NextRequest, NextResponse } from 'next/server';

import { getProviderById, readProviderRegistry } from '../../../../lib/provider-config.mjs';
import {
  fetchProviderModels,
  mergeProviderModelProbeResults,
  normalizeProviderImageRequestMode,
  normalizeProviderModelApiKey,
  normalizeProviderModelBaseUrl,
  normalizeProviderModelProtocol,
  type ProviderImageRequestMode,
  type ProviderModelProbeResult,
} from '../../../../lib/provider-models';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const imageApiKeySourceLabels: Record<string, string> = {
  all: '生图 API',
  gemini: '生图 API（Gemini）',
  gpt: '生图 API（GPT）',
};

function normalizeImageApiKeyScope(value: unknown): 'all' | 'gemini' | 'gpt' {
  return value === 'gemini' || value === 'gpt' ? value : 'all';
}

function normalizeImageApiKeys(value: unknown): Array<{ apiKey: string; scope: 'all' | 'gemini' | 'gpt' }> {
  return Array.isArray(value)
    ? value
        .map((row) => {
          const source = row && typeof row === 'object' && !Array.isArray(row) ? row : {};
          return {
            apiKey: normalizeProviderModelApiKey((source as { apiKey?: unknown }).apiKey),
            scope: normalizeImageApiKeyScope((source as { scope?: unknown }).scope),
          };
        })
        .filter((row) => row.apiKey)
    : [];
}

function failedModelProbeResult(
  message: string,
  imageRequestMode: ProviderImageRequestMode
): ProviderModelProbeResult {
  return {
    ok: false,
    status: 0,
    message,
    modelCount: 0,
    allModels: [],
    imageModels: [],
    chatModels: [],
    imageRequestMode,
  };
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  try {
    const protocol = normalizeProviderModelProtocol((body as { protocol?: unknown }).protocol);
    const baseUrl = normalizeProviderModelBaseUrl((body as { baseUrl?: unknown }).baseUrl);
    const providerId = typeof (body as { providerId?: unknown }).providerId === 'string'
      ? (body as { providerId: string }).providerId
      : '';
    const inputApiKey = normalizeProviderModelApiKey((body as { apiKey?: unknown }).apiKey);
    const inputImageApiKeys = normalizeImageApiKeys((body as { imageApiKeys?: unknown }).imageApiKeys);
    const registry = inputApiKey && inputImageApiKeys.length > 0 ? null : await readProviderRegistry();
    const savedProvider = registry ? getProviderById(registry.providers, providerId) : null;
    const apiKey = inputApiKey || savedProvider?.apiKey || '';
    const imageApiKeys = inputImageApiKeys.length > 0
      ? inputImageApiKeys
      : normalizeImageApiKeys((savedProvider as { imageApiKeys?: unknown } | null)?.imageApiKeys);
    const imageRequestMode = normalizeProviderImageRequestMode((body as { imageRequestMode?: unknown }).imageRequestMode);

    const sources = [
      ...(apiKey ? [{ label: '主 API', apiKey }] : []),
      ...imageApiKeys.map((row) => ({
        label: imageApiKeySourceLabels[row.scope] || imageApiKeySourceLabels.all,
        apiKey: row.apiKey,
      })),
    ];

    if (sources.length === 0) {
      return NextResponse.json({ error: '请先填写或保存 API Key 或生图 API Key' }, { status: 400 });
    }

    const sourceResults = await Promise.all(
      sources.map(async (source) => {
        try {
          return {
            label: source.label,
            result: await fetchProviderModels({
              baseUrl,
              apiKey: source.apiKey,
              protocol,
              imageRequestMode,
            }),
          };
        } catch (error) {
          return {
            label: source.label,
            result: failedModelProbeResult(error instanceof Error ? error.message : '拉取模型失败', imageRequestMode),
          };
        }
      })
    );
    const result = mergeProviderModelProbeResults(sourceResults);

    if (!result.ok) {
      return NextResponse.json(result, { status: result.status >= 400 ? result.status : 502 });
    }

    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : '拉取模型失败';
    return NextResponse.json(
      {
        ok: false,
        status: 0,
        message,
        modelCount: 0,
        allModels: [],
        imageModels: [],
        chatModels: [],
        imageRequestMode: 'openai',
      },
      { status: 500 }
    );
  }
}
