import { NextRequest, NextResponse } from 'next/server';

import {
  ProviderConfigError,
  readProviderRegistry,
  toProviderRegistryView,
  updateProviderRegistry,
} from '../../../lib/provider-config.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function toErrorResponse(error: unknown) {
  if (error instanceof ProviderConfigError) {
    return NextResponse.json({ error: error.message }, { status: error.statusCode });
  }

  const message = error instanceof Error ? error.message : 'Provider settings request failed';
  return NextResponse.json({ error: message }, { status: 500 });
}

export async function GET() {
  try {
    const registry = await readProviderRegistry();
    return NextResponse.json(toProviderRegistryView(registry));
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function PUT(request: NextRequest) {
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const providers = Array.isArray((body as { providers?: unknown }).providers)
    ? (body as { providers: unknown[] }).providers
    : null;

  if (!providers) {
    return NextResponse.json({ error: 'Providers are required' }, { status: 400 });
  }

  try {
    const registry = await updateProviderRegistry(providers);
    return NextResponse.json(toProviderRegistryView(registry));
  } catch (error) {
    return toErrorResponse(error);
  }
}
