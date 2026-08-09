import { NextResponse } from 'next/server';

import { clearXiaomiLogin } from '../../../../../lib/xiaomi-auth.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function DELETE() {
  await clearXiaomiLogin();
  return NextResponse.json({ ok: true });
}
