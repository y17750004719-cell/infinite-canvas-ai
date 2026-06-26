import { NextRequest, NextResponse } from 'next/server';
import { getProviderById, readProviderRegistry } from '../../../../lib/provider-config.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function normalizeBaseUrl(value: unknown): string {
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

function normalizeApiKey(value: unknown): string {
  return typeof value === 'string' ? value.trim().replace(/^Bearer\s+/i, '') : '';
}

function openAiTaskProbeUrl(baseUrl: string): string {
  const root = baseUrl.endsWith('/v1') ? baseUrl : `${baseUrl}/v1`;
  return `${root}/images/tasks/healthcheck_probe_do_not_submit`;
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  try {
    const protocol = (body as { protocol?: unknown }).protocol === 'gemini' ? 'gemini' : 'openai';
    const baseUrl = normalizeBaseUrl((body as { baseUrl?: unknown }).baseUrl);
    const providerId = typeof (body as { providerId?: unknown }).providerId === 'string'
      ? (body as { providerId: string }).providerId
      : '';
    const inputApiKey = normalizeApiKey((body as { apiKey?: unknown }).apiKey);
    const registry = inputApiKey ? null : await readProviderRegistry();
    const savedProvider = registry ? getProviderById(registry.providers, providerId) : null;
    const apiKey = inputApiKey || savedProvider?.apiKey || '';

    if (!apiKey) {
      return NextResponse.json({ error: '请先填写或保存 API Key' }, { status: 400 });
    }

    if (protocol === 'gemini') {
      return NextResponse.json({
        ok: false,
        protocol,
        statusCode: 0,
        message: 'Gemini 官方接口不使用 OpenAI 兼容异步任务端点',
      });
    }

    const endpoint = openAiTaskProbeUrl(baseUrl);
    const response = await fetch(endpoint, {
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      signal: AbortSignal.timeout(15000),
    });
    const rawText = await response.text();

    if (response.status === 400 || response.status === 404) {
      return NextResponse.json({
        ok: true,
        protocol,
        statusCode: response.status,
        message: '异步任务查询端点可达',
      });
    }

    if (response.status === 401 || response.status === 403) {
      return NextResponse.json({
        ok: false,
        protocol,
        statusCode: response.status,
        message: 'API Key 无效或无权限',
      });
    }

    return NextResponse.json({
      ok: response.status < 500,
      protocol,
      statusCode: response.status,
      message: rawText.slice(0, 300) || `异步任务端点返回 ${response.status}`,
    });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      protocol: 'openai',
      statusCode: 0,
      message: error instanceof Error ? error.message : '异步端点探测失败',
    });
  }
}
