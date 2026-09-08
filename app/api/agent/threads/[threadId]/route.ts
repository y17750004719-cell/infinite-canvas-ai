import { NextRequest, NextResponse } from 'next/server';
import { forkThread, loadThread, updateThreadState } from '../../../../lib/agent/thread-journal.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_request: NextRequest, context: { params: Promise<{ threadId: string }> }) {
  const { threadId } = await context.params;
  try { return NextResponse.json(await loadThread(threadId)); }
  catch (error: any) { return NextResponse.json({ error: error?.message || 'Unable to load thread', code: error?.code || 'thread_unavailable' }, { status: error?.statusCode || 404 }); }
}

export async function POST(request: NextRequest, context: { params: Promise<{ threadId: string }> }) {
  const { threadId } = await context.params;
  const body = await request.json().catch(() => ({}));
  const action = body?.action;
  if (action === 'fork') {
    try { return NextResponse.json({ thread: await forkThread(threadId) }, { status: 201 }); }
    catch (error: any) { return NextResponse.json({ error: error?.message || 'Unable to fork thread', code: error?.code || 'fork_failed' }, { status: error?.statusCode || 409 }); }
  }
  if (action === 'archive' || action === 'unarchive') {
    try {
      const current = await loadThread(threadId);
      if (action === 'archive' && (current.state.activeTurn || current.state.pendingDecision || current.state.pendingApproval)) {
        return NextResponse.json({ error: 'Cannot archive an active or waiting thread', code: 'thread_active' }, { status: 409 });
      }
      const thread = await updateThreadState(threadId, { archived: action === 'archive', threadStatus: action === 'archive' ? 'archived' : 'idle' });
      return NextResponse.json({ thread });
    } catch (error: any) {
      return NextResponse.json({ error: error?.message || `Unable to ${action} thread`, code: error?.code || `thread_${action}_failed` }, { status: error?.statusCode || 409 });
    }
  }
  return NextResponse.json({ error: 'action must be fork, archive, or unarchive', code: 'invalid_action' }, { status: 400 });
}
