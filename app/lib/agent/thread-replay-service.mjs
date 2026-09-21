import { interruptOrphanedTurn, queryThread } from './thread-journal-service.mjs';

export async function handleThreadReplay(request, { journal = {}, activeRunRegistry = {} } = {}) {
  const query = journal.queryThread || queryThread;
  const interruptOrphan = journal.interruptOrphanedTurn || interruptOrphanedTurn;
  const getActive = activeRunRegistry.getActiveAgentRun || (() => null);
  const threadId = request.nextUrl.searchParams.get('threadId')?.trim();
  if (!threadId) return Response.json({ error: 'threadId is required' }, { status: 400 });
  const afterSequence = Number(request.nextUrl.searchParams.get('afterSequence') || 0);
  const beforeSequenceValue = request.nextUrl.searchParams.get('beforeSequence');
  const options = { afterSequence: Number.isFinite(afterSequence) ? afterSequence : 0, ...(beforeSequenceValue ? { beforeSequence: Number(beforeSequenceValue) } : {}) };
  let result = await query(threadId, options);
  let activeTurn = result.state.turns?.find((turn) => turn.turnId === result.state.activeTurn);
  let activeRun = activeTurn?.runId ? getActive(activeTurn.runId) : null;
  if (activeTurn && !activeRun) {
    await interruptOrphan(threadId, activeTurn, getActive);
    result = await query(threadId, options);
    activeTurn = result.state.turns?.find((turn) => turn.turnId === result.state.activeTurn);
    activeRun = activeTurn?.runId ? getActive(activeTurn.runId) : null;
  }
  return Response.json({ ...result, activeStream: Boolean(activeRun) });
}
