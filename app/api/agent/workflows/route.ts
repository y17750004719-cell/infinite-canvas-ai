import { NextRequest, NextResponse } from 'next/server';
import { advanceOmxWorkflow, cancelOmxWorkflow, getOmxWorkflow, startOmxWorkflow } from '../../../lib/agent/omx-workflow.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const taskId = request.nextUrl.searchParams.get('taskId');
  if (!taskId) return NextResponse.json({ error: 'taskId is required', code: 'invalid_identity' }, { status: 400 });
  try { return NextResponse.json({ workflow: await getOmxWorkflow(taskId) }); }
  catch (error: any) { return NextResponse.json({ error: error?.message || 'Unable to read workflow', code: error?.code || 'workflow_read_failed' }, { status: error?.statusCode || 500 }); }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const workflow = body?.event
      ? await advanceOmxWorkflow({ taskId: body.taskId, runId: body.runId, event: body.event })
      : body?.cancel === true
        ? await cancelOmxWorkflow(body.taskId, body.runId)
        : await startOmxWorkflow({ taskId: body.taskId, objective: body.objective, workflowId: body.workflowId, runId: body.runId });
    return NextResponse.json({ workflow }, { status: body?.event || body?.cancel ? 200 : 201 });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Unable to update workflow', code: error?.code || 'workflow_update_failed' }, { status: error?.statusCode || 500 });
  }
}
