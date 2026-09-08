import { NextResponse } from 'next/server';
import { loadThread, updateThreadState } from '../../../../../lib/agent/thread-journal.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(_request: Request, context: { params: Promise<{ threadId: string }> }) {
  const { threadId } = await context.params;
  try {
    const current = await loadThread(threadId);
    if (current.state.activeTurn || current.state.pendingDecision || current.state.pendingApproval) {
      return NextResponse.json({ error: 'Cannot archive an active or waiting thread', code: 'thread_active' }, { status: 409 });
    }
    return NextResponse.json({ thread: await updateThreadState(threadId, { archived: true, threadStatus: 'archived' }) });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Unable to archive thread', code: error?.code || 'thread_archive_failed' }, { status: error?.statusCode || 409 });
  }
}
