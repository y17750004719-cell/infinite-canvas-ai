import { NextRequest, NextResponse } from 'next/server';

import { removeSessionVisualAssets } from '../../lib/agent/session-visual-assets.mjs';

export const runtime = 'nodejs';

export async function DELETE(request: NextRequest) {
  const body = await request.json().catch(() => null) as { sessionId?: unknown } | null;
  const sessionId = typeof body?.sessionId === 'string' ? body.sessionId.trim() : '';
  if (!sessionId || sessionId.length > 200) {
    return NextResponse.json({ error: 'A valid sessionId is required' }, { status: 400 });
  }

  await removeSessionVisualAssets(sessionId);
  return NextResponse.json({ deleted: true, sessionId });
}
