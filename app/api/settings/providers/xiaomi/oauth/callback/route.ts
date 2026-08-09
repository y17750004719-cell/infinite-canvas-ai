import { NextRequest, NextResponse } from 'next/server';

import { completeXiaomiLogin } from '../../../../../../lib/xiaomi-auth.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function browserResult(ok: boolean, message: string) {
  const escapedMessage = message.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character] || character);
  return new NextResponse(`<!doctype html><meta charset="utf-8"><title>Xiaomi</title><script>window.close()</script><p>${escapedMessage}</p>`, {
    status: ok ? 200 : 400,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}

async function finish(state: string, code: string) {
  if (!code) throw new Error('Xiaomi callback is missing encrypted code');
  return completeXiaomiLogin({ state, code });
}

export async function GET(request: NextRequest) {
  try {
    await finish(request.nextUrl.searchParams.get('state') || '', request.nextUrl.searchParams.get('u') || '');
    return browserResult(true, 'Xiaomi login completed. You can return to Z Flow.');
  } catch (error) {
    return browserResult(false, error instanceof Error ? error.message : 'Xiaomi login failed');
  }
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  try {
    const result = await finish(
      typeof (body as { state?: unknown }).state === 'string' ? (body as { state: string }).state : '',
      typeof (body as { code?: unknown }).code === 'string' ? (body as { code: string }).code : ''
    );
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Xiaomi login failed' }, { status: 400 });
  }
}
