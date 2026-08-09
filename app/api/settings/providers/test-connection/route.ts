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

    const models = await fetchProviderModels({
      baseUrl,
      apiKey,
      protocol,
      imageRequestMode,
    });
    return NextResponse.json({
      ok: models.ok,
      status: models.status,
      message: models.message,
      modelCount: models.modelCount,
      imageModels: models.imageModels,
      chatModels: models.chatModels,
      voiceModels: models.voiceModels,
      imageRequestMode: models.imageRequestMode,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : '连接测试失败';
    return NextResponse.json({
      ok: false,
      status: 0,
      message,
      modelCount: 0,
      imageModels: [],
      chatModels: [],
      voiceModels: [],
      imageRequestMode: 'openai',
    });
  }
}
