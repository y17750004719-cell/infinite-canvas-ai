import { NextResponse } from 'next/server';
import { updateThreadState } from '../../../../../lib/agent/thread-journal.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(_request: Request, context: { params: Promise<{ threadId: string }> }) {
  const { threadId } = await context.params;
  try { return NextResponse.json({ thread: await updateThreadState(threadId, { archived: false, threadStatus: 'idle' }) }); }
  catch (error: any) { return NextResponse.json({ error: error?.message || 'Unable to unarchive thread', code: error?.code || 'thread_unarchive_failed' }, { status: error?.statusCode || 409 }); }
}
