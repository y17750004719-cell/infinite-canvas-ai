import { randomUUID } from 'node:crypto';

const ROLES = new Set(['explorer', 'reviewer', 'test_engineer', 'verifier']);

export function buildWorkerPrompt({ workflowId, parentTaskId, parentRunId, objective, subtask }) {
  return [
    `You are the OMX ${subtask.role} worker.`,
    `Workflow: ${workflowId}`,
    `Parent task: ${parentTaskId}`,
    `Parent run: ${parentRunId}`,
    `Objective: ${objective}`,
    `Bounded assignment: ${subtask.prompt}`,
    'Rules: stay read-only; do not spawn agents; return evidence with file paths and line numbers; report blockers; do not claim the parent task is complete.',
  ].join('\n\n');
}

export function createOmxSubtasks({ taskId, runId, requests = [] } = {}) {
  return requests.slice(0, 4).map((request, index) => {
    const role = ROLES.has(request?.role) ? request.role : 'explorer';
    return {
      id: String(request?.id || `${role}-${index + 1}-${randomUUID().slice(0, 8)}`),
      taskId,
      runId,
      role,
      prompt: String(request?.prompt || '').trim().slice(0, 12000),
      readonly: true,
      ...(request?.scope ? { scope: String(request.scope).slice(0, 2000) } : {}),
    };
  });
}

export async function runOmxSubtasks({ subtasks = [], executor } = {}) {
  if (typeof executor !== 'function') throw new TypeError('subtask executor is required');
  return Promise.all(subtasks.map(async (subtask) => {
    try {
      const result = await executor(subtask);
      return { id: subtask.id, status: 'completed', summary: String(result?.summary || result || '').slice(0, 6000), evidence: Array.isArray(result?.evidence) ? result.evidence.slice(0, 20) : [], findings: Array.isArray(result?.findings) ? result.findings.slice(0, 100) : [] };
    } catch (error) {
      return { id: subtask.id, status: 'failed', summary: error?.message || 'Subtask failed', evidence: [] };
    }
  }));
}

export async function startOmxSubtasks({ workflowId, objective, parentTaskId, parentRunId, subtasks = [], gateway } = {}) {
  if (!gateway?.spawnAgent) throw Object.assign(new Error('Native collaboration gateway is required'), { code: 'subagents_unavailable' });
  return Promise.all(subtasks.map(async (subtask) => ({
    subtask,
    ...(await gateway.spawnAgent({ parentTaskId, parentRunId, workflowId, role: subtask.role, prompt: buildWorkerPrompt({ workflowId, parentTaskId, parentRunId, objective, subtask }), readonly: true })),
    startedAt: Date.now(),
  })));
}

export async function collectOmxSubtaskResults({ handles = [], gateway, timeoutMs = 600_000 } = {}) {
  if (!gateway?.wait) throw Object.assign(new Error('Native collaboration gateway is required'), { code: 'subagents_unavailable' });
  return Promise.all(handles.map(async (handle) => {
    try {
      const result = await gateway.wait({ childThreadId: handle.childThreadId, childTaskId: handle.childTaskId, childRunId: handle.childRunId, timeoutMs });
      return { id: handle.subtask.id, status: result?.status === 'completed' ? 'completed' : (result?.status || 'failed'), summary: String(result?.summary || '').slice(0, 6000), evidence: Array.isArray(result?.evidence) ? result.evidence.slice(0, 20) : [], findings: Array.isArray(result?.findings) ? result.findings.slice(0, 100) : [] };
    } catch (error) { return { id: handle.subtask.id, status: error?.code === 'native_rpc_timeout' ? 'timed_out' : 'failed', summary: error?.message || 'Subtask failed', evidence: [] }; }
  }));
}

export async function cancelOmxSubtasks({ handles = [], gateway } = {}) {
  if (!gateway?.interruptAgent) return;
  await Promise.all(handles.map((handle) => gateway.interruptAgent({ childThreadId: handle.childThreadId, childTaskId: handle.childTaskId, childRunId: handle.childRunId }).catch(() => {})));
}

export { ROLES };
