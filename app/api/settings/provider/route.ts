import { NextRequest, NextResponse } from 'next/server';

import {
  ProviderConfigError,
  readProviderConfig,
  toProviderConfigView,
  updateProviderConfig,
} from '../../../lib/provider-config.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function toErrorResponse(error) {
  if (error instanceof ProviderConfigError) {
    return NextResponse.json({ error: error.message }, { status: error.statusCode });
  }

  const message = error instanceof Error ? error.message : 'Provider settings request failed';
  return NextResponse.json({ error: message }, { status: 500 });
}

export async function GET() {
  try {
    const config = await readProviderConfig();
    return NextResponse.json(toProviderConfigView(config));
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function PUT(request: NextRequest) {
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  try {
    const config = await updateProviderConfig({
      providerId: typeof body.providerId === 'string' ? body.providerId : undefined,
      baseUrl: typeof body.baseUrl === 'string' ? body.baseUrl : undefined,
      apiKey: typeof body.apiKey === 'string' ? body.apiKey : undefined,
    });
    return NextResponse.json(toProviderConfigView(config));
  } catch (error) {
    return toErrorResponse(error);
  }
}
