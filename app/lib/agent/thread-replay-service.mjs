import { appendThreadEvent, queryThread } from './thread-journal-service.mjs';

export async function handleThreadReplay(request, { journal = {}, activeRunRegistry = {} } = {}) {
  const query = journal.queryThread || queryThread;
  const append = journal.appendThreadEvent || appendThreadEvent;
  const getActive = activeRunRegistry.getActiveAgentRun || (() => null);
  const threadId = request.nextUrl.searchParams.get('threadId')?.trim();
  if (!threadId) return Response.json({ error: 'threadId is required' }, { status: 400 });
  const afterSequence = Number(request.nextUrl.searchParams.get('afterSequence') || 0);
  const beforeSequenceValue = request.nextUrl.searchParams.get('beforeSequence');
  const options = { afterSequence: Number.isFinite(afterSequence) ? afterSequence : 0, ...(beforeSequenceValue ? { beforeSequence: Number(beforeSequenceValue) } : {}) };
  let result = await query(threadId, options);
  const activeTurn = result.state.turns?.find((turn) => turn.turnId === result.state.activeTurn);
  const activeRun = activeTurn?.runId ? getActive(activeTurn.runId) : null;
  if (activeTurn && !activeRun) {
    await append(threadId, { type: 'turn.failed', turnId: activeTurn.turnId, taskId: activeTurn.taskId || threadId, operationId: activeTurn.operationId, runId: activeTurn.runId, status: 'interrupted', error: { code: 'run_interrupted', message: 'The server restarted before this run completed. Continue or retry explicitly.' } });
    result = await query(threadId, options);
  }
  return Response.json({ ...result, activeStream: Boolean(activeRun) });
}
