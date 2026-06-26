import { NextRequest, NextResponse } from 'next/server';

import { getProviderById, readProviderRegistry } from '../../../../lib/provider-config.mjs';
import {
  fetchProviderModels,
  normalizeProviderImageRequestMode,
  normalizeProviderModelApiKey,
  normalizeProviderModelBaseUrl,
  normalizeProviderModelProtocol,
} from '../../../../lib/provider-models';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

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
    const registry = inputApiKey ? null : await readProviderRegistry();
    const savedProvider = registry ? getProviderById(registry.providers, providerId) : null;
    const apiKey = inputApiKey || savedProvider?.apiKey || '';
    const imageRequestMode = normalizeProviderImageRequestMode((body as { imageRequestMode?: unknown }).imageRequestMode);

    if (!apiKey) {
      return NextResponse.json({ error: '请先填写或保存 API Key' }, { status: 400 });
    }

    const result = await fetchProviderModels({
      baseUrl,
      apiKey,
      protocol,
      imageRequestMode,
    });

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
