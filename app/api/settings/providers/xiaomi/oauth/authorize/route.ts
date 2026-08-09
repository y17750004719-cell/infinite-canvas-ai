import { NextResponse } from 'next/server';

import { beginXiaomiLogin } from '../../../../../../lib/xiaomi-auth.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST() {
  const login = await beginXiaomiLogin();
  return NextResponse.json(login);
}
