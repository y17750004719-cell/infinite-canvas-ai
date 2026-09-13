import { randomUUID } from 'node:crypto';

const ROLES = new Set(['explorer', 'reviewer', 'test_engineer', 'verifier']);

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

export { ROLES };
