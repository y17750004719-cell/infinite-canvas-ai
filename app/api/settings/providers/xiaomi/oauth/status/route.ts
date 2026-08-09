import { NextRequest, NextResponse } from 'next/server';

import { getXiaomiLoginStatus } from '../../../../../../lib/xiaomi-auth.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const state = request.nextUrl.searchParams.get('state') || '';
  return NextResponse.json(await getXiaomiLoginStatus({ state }));
}
