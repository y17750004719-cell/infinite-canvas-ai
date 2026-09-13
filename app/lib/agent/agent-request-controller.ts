import { NextRequest } from 'next/server';
import { handleGet as handleRuntimeGet, handlePost as handleRuntimePost } from './agent-request-runtime';
import { resolveOmxIntent } from './omx-intent-router.mjs';
import { getOmxWorkflow, startOmxWorkflow } from './omx-workflow.mjs';

/**
 * HTTP orchestration boundary for /api/agent.
 *
 * Native execution, interaction state, recovery, event projection and image
 * side effects live behind the runtime services. Keeping this adapter small
 * makes the compatibility and transport contract independently auditable.
 */
export async function handlePost(request: NextRequest) {
  try {
    const body = await request.clone().json();
    const prompt = [...(Array.isArray(body?.messages) ? body.messages : [])].reverse().find((message: any) => message?.role === 'user')?.content || '';
    const taskId = typeof body?.taskId === 'string' && body.taskId.trim() ? body.taskId.trim() : typeof body?.sessionId === 'string' ? body.sessionId.trim() : '';
    const activeWorkflow = taskId ? await getOmxWorkflow(taskId) : null;
    const decision = resolveOmxIntent({ prompt, activeWorkflow });
    if ((decision.mode === 'explicit' || (decision.mode === 'automatic' && decision.confidence === 'high')) && taskId) {
      const existing = activeWorkflow && !['completed', 'failed', 'cancelled'].includes(activeWorkflow.status) ? activeWorkflow : null;
      if (!existing) await startOmxWorkflow({ taskId, objective: String(prompt).slice(0, 12000), workflowId: decision.workflowId, runId: undefined, trigger: { mode: decision.mode, confidence: decision.confidence, reason: decision.reason, originalPrompt: prompt } });
    }
  } catch {
    // Routing is advisory. Any malformed or unavailable OMX state falls back to the existing runtime.
  }
  return handleRuntimePost(request);
}

export function handleGet(request: NextRequest) {
  return handleRuntimeGet(request);
}
