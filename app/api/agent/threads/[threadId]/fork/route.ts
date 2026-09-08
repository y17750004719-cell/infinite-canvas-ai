import { NextResponse } from 'next/server';
import { forkThread } from '../../../../../lib/agent/thread-journal.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(_request: Request, context: { params: Promise<{ threadId: string }> }) {
  const { threadId } = await context.params;
  try { return NextResponse.json({ thread: await forkThread(threadId) }, { status: 201 }); }
  catch (error: any) { return NextResponse.json({ error: error?.message || 'Unable to fork thread', code: error?.code || 'fork_failed' }, { status: error?.statusCode || 409 }); }
}
