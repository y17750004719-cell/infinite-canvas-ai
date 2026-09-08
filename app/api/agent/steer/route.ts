import { NextRequest, NextResponse } from 'next/server';
import { enqueueActiveAgentRunInput } from '../../../lib/agent/active-run-registry.mjs';
import { loadThread, queueThreadInput } from '../../../lib/agent/thread-journal.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const runId = typeof body?.runId === 'string' ? body.runId.trim().slice(0, 200) : '';
  const threadId = typeof body?.threadId === 'string' ? body.threadId.trim() : '';
  const turnId = typeof body?.turnId === 'string' ? body.turnId.trim() : '';
  const operationId = typeof body?.operationId === 'string' ? body.operationId.trim().slice(0, 200) : '';
  const input = typeof body?.input === 'string' ? body.input.trim().slice(0, 8000) : '';
  if (!runId || !threadId || !turnId || !operationId || !input) return NextResponse.json({ error: 'threadId, turnId, operationId, runId and input are required' }, { status: 400 });
  if (threadId.length > 200 || turnId.length > 200) return NextResponse.json({ error: 'Invalid thread identity', code: 'invalid_identity' }, { status: 400 });
  let turn: Record<string, any> | undefined;
  try {
    const journal = await loadThread(threadId);
    if (journal.state.archived) return NextResponse.json({ error: 'Thread is archived', code: 'thread_archived' }, { status: 409 });
    turn = (Array.isArray(journal.state.turns) ? journal.state.turns : []).find((entry) => entry.turnId === turnId) as Record<string, any> | undefined;
    if (journal.state.activeTurn !== turnId || !turn || turn.operationId !== operationId || turn.runId !== runId) return NextResponse.json({ error: 'Turn is stale', code: 'stale_operation' }, { status: 409 });
    if (turn.status === 'waiting') return NextResponse.json({ error: 'A decision is pending', code: 'waiting_decision' }, { status: 409 });
  } catch {
    return NextResponse.json({ error: 'Thread is unavailable', code: 'invalid_identity' }, { status: 400 });
  }
  const taskId = typeof body?.taskId === 'string' && body.taskId.trim() ? body.taskId.trim().slice(0, 200) : (turn?.taskId || threadId);
  const result = enqueueActiveAgentRunInput(runId, {
    threadId,
    turnId,
    delivery: body?.delivery,
    operationId,
    input,
    referenceImages: body?.referenceImages,
    referenceContext: body?.referenceContext,
  });
  if (!result.accepted) {
    if (result.reason === 'stale_operation') {
      return NextResponse.json({ error: 'Agent operation is stale', code: 'stale_operation' }, { status: 409 });
    }
    return NextResponse.json({ error: result.reason === 'settled' ? 'Agent run is no longer active' : 'Invalid input', code: result.reason }, { status: result.reason === 'settled' ? 409 : 400 });
  }
  try {
    const referenceIds = Array.isArray((body?.referenceContext as { references?: Array<{ id?: unknown }> } | undefined)?.references)
      ? (body?.referenceContext as { references: Array<{ id?: unknown }> }).references
        .map((reference) => typeof reference?.id === 'string' ? reference.id : '')
        .filter(Boolean)
      : [];
    await queueThreadInput(threadId, {
      threadId, turnId, taskId, operationId, runId, delivery: result.delivery,
      input, referenceIds,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Unable to persist queued input', code: error?.code || 'queue_write_failed' }, { status: error?.statusCode || 500 });
  }
  return NextResponse.json(result);
}
