import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const root = path.join(process.cwd(), 'runtime', 'omx-workflows');
const locks = new Map();
const WORKFLOWS = new Set(['analyze', 'deep_interview', 'plan', 'code_review', 'verify']);
const STATUSES = new Set(['idle', 'running', 'awaiting_input', 'awaiting_subagents', 'verifying', 'completed', 'failed', 'cancelled']);

const queue = async (taskId, fn) => {
  const previous = locks.get(taskId) || Promise.resolve();
  const next = previous.then(fn, fn);
  const settled = next.catch(() => {});
  locks.set(taskId, settled);
  try { return await next; } finally { if (locks.get(taskId) === settled) locks.delete(taskId); }
};

const safeId = (value, label = 'taskId') => {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-][a-zA-Z0-9._-]{0,199}$/.test(value)) {
    throw Object.assign(new Error(`Invalid ${label}`), { code: 'invalid_identity', statusCode: 400 });
  }
  return value;
};

const clone = (value) => structuredClone(value);
const fileFor = (taskId) => path.join(root, safeId(taskId), 'state.json');

function initialState({ taskId, objective, workflowId, runId = randomUUID() }) {
  if (!WORKFLOWS.has(workflowId)) throw Object.assign(new Error('Unknown OMX workflow'), { code: 'unknown_workflow', statusCode: 400 });
  const now = Date.now();
  return {
    schemaVersion: 1,
    taskId: safeId(taskId),
    runId: safeId(runId, 'runId'),
    workflowId,
    status: 'running',
    objective: String(objective || '').trim().slice(0, 12000),
    currentPhase: 'started',
    startedAt: now,
    updatedAt: now,
    subtaskIds: [],
    checkpoints: [{ id: 'started', label: 'Workflow started', status: 'passed', evidence: [] }],
    assumptions: [],
    unresolvedQuestions: [],
    subtasks: [],
    verification: null,
    error: null,
  };
}

async function persist(state) {
  const directory = path.dirname(fileFor(state.taskId));
  await fs.mkdir(directory, { recursive: true });
  const temp = path.join(directory, 'state.tmp');
  await fs.writeFile(temp, JSON.stringify(state, null, 2));
  await fs.rename(temp, fileFor(state.taskId));
  return clone(state);
}

export async function getOmxWorkflow(taskId) {
  try { return JSON.parse(await fs.readFile(fileFor(taskId), 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

export async function startOmxWorkflow({ taskId, objective, workflowId, runId }) {
  return queue(taskId, async () => {
    const existing = await getOmxWorkflow(taskId);
    if (existing && !['completed', 'failed', 'cancelled'].includes(existing.status)) {
      throw Object.assign(new Error('Workflow already active'), { code: 'workflow_active', statusCode: 409 });
    }
    return persist(initialState({ taskId, objective, workflowId, runId }));
  });
}

function checkpoint(state, id, label, status = 'passed', evidence = []) {
  const index = state.checkpoints.findIndex((item) => item.id === id);
  const value = { id, label, status, evidence: evidence.slice(0, 20).map(String) };
  if (index < 0) state.checkpoints.push(value); else state.checkpoints[index] = { ...state.checkpoints[index], ...value };
}

function applyEvent(state, event) {
  if (!event || typeof event.type !== 'string') throw Object.assign(new Error('Invalid workflow event'), { code: 'invalid_event', statusCode: 400 });
  if (event.type === 'cancel') { state.status = 'cancelled'; state.currentPhase = 'cancelled'; checkpoint(state, 'cancelled', 'Workflow cancelled'); return; }
  if (['completed', 'failed', 'cancelled'].includes(state.status)) throw Object.assign(new Error('Workflow is terminal'), { code: 'workflow_terminal', statusCode: 409 });
  if (event.type === 'user_answer') {
    state.unresolvedQuestions = state.unresolvedQuestions.filter((item) => item !== event.dimension);
    state.assumptions.push(`${event.dimension}: ${String(event.answer || '').trim().slice(0, 2000)}`);
    state.status = 'running'; state.currentPhase = 'answer_received';
    checkpoint(state, `answer:${event.dimension}`, `Answer received: ${event.dimension}`); return;
  }
  if (event.type === 'subtask_started') {
    const id = safeId(event.id, 'subtaskId');
    if (!state.subtaskIds.includes(id)) state.subtaskIds.push(id);
    state.subtasks.push({ id, role: event.role || 'worker', status: 'running', summary: '' });
    state.status = 'awaiting_subagents'; state.currentPhase = 'parallel_review'; return;
  }
  if (event.type === 'subtask_result') {
    const id = safeId(event.id, 'subtaskId');
    const index = state.subtasks.findIndex((item) => item.id === id);
    if (index < 0) throw Object.assign(new Error('Unknown subtask'), { code: 'unknown_subtask', statusCode: 409 });
    state.subtasks[index] = { ...state.subtasks[index], status: event.status || 'completed', summary: String(event.summary || '').slice(0, 6000), findings: Array.isArray(event.findings) ? event.findings.slice(0, 100) : [] };
    if (state.subtasks.every((item) => ['completed', 'failed', 'cancelled'].includes(item.status))) { state.status = 'running'; state.currentPhase = 'findings_merged'; checkpoint(state, 'subtasks', 'Subtasks merged'); }
    return;
  }
  if (event.type === 'verification_result') {
    state.verification = { commands: Array.isArray(event.commands) ? event.commands.slice(0, 20).map(String) : [], passed: event.passed === true, summary: String(event.summary || '').slice(0, 6000) };
    state.status = event.passed === true ? 'completed' : 'failed'; state.currentPhase = event.passed === true ? 'completion' : 'verification_failed';
    checkpoint(state, 'verification', 'Verification result', event.passed === true ? 'passed' : 'failed', [state.verification.summary]); return;
  }
  if (event.type === 'phase') { state.currentPhase = String(event.phase || 'working').slice(0, 200); if (event.status && STATUSES.has(event.status)) state.status = event.status; checkpoint(state, `phase:${state.currentPhase}`, state.currentPhase, 'passed'); return; }
  throw Object.assign(new Error(`Unsupported workflow event: ${event.type}`), { code: 'unsupported_event', statusCode: 400 });
}

export async function advanceOmxWorkflow({ taskId, runId, event }) {
  return queue(taskId, async () => {
    const state = await getOmxWorkflow(taskId);
    if (!state || state.runId !== runId) throw Object.assign(new Error('Workflow identity mismatch'), { code: 'stale_operation', statusCode: 409 });
    applyEvent(state, event); state.updatedAt = Date.now(); return persist(state);
  });
}

export async function cancelOmxWorkflow(taskId, runId) {
  const state = await getOmxWorkflow(taskId);
  if (!state) return null;
  return advanceOmxWorkflow({ taskId, runId: runId || state.runId, event: { type: 'cancel' } });
}

export { WORKFLOWS, STATUSES, initialState };
