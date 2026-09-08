import { NextRequest, NextResponse } from 'next/server';
import { cancelActiveAgentRun } from '../../../lib/agent/active-run-registry.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const runId = typeof body?.runId === 'string' ? body.runId.trim().slice(0, 200) : '';
  const identity = ['threadId', 'turnId', 'taskId', 'operationId'].reduce<Record<string, string>>((result, key) => {
    if (typeof body?.[key] === 'string') result[key] = (body[key] as string).trim().slice(0, 200);
    return result;
  }, {});
  if (!runId || Object.keys(identity).length !== 4 || Object.values(identity).some((value) => !value)) {
    return NextResponse.json({ error: 'runId and complete run identity are required', code: 'invalid_identity' }, { status: 400 });
  }
  const result = cancelActiveAgentRun(runId, {
    ...identity,
  });
  if (!result.accepted) {
    const status = result.reason === 'settled' || result.reason === 'stale_operation' ? 409 : 404;
    return NextResponse.json({ error: result.reason === 'not_cancellable' ? 'Agent run is not cancellable' : 'Agent run is no longer active', code: result.reason }, { status });
  }
  return NextResponse.json(result);
}
