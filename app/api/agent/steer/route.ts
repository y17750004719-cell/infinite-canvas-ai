import { NextRequest, NextResponse } from 'next/server';
import { enqueueActiveAgentRunInput } from '../../../lib/agent/active-run-registry.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const runId = typeof body?.runId === 'string' ? body.runId.trim().slice(0, 200) : '';
  const input = typeof body?.input === 'string' ? body.input.trim().slice(0, 8000) : '';
  if (!runId || !input) return NextResponse.json({ error: 'runId and input are required' }, { status: 400 });
  const result = enqueueActiveAgentRunInput(runId, {
    delivery: body?.delivery,
    input,
    referenceImages: body?.referenceImages,
    referenceContext: body?.referenceContext,
  });
  if (!result.accepted) {
    return NextResponse.json({ error: result.reason === 'settled' ? 'Agent run is no longer active' : 'Invalid input' }, { status: result.reason === 'settled' ? 409 : 400 });
  }
  return NextResponse.json(result);
}
