const globals = globalThis;

/** @type {Map<string, { threadId: string, turnId: string, taskId: string, operationId: string, phase: 'reasoning' | 'waiting' | 'executing' | 'settled', nonInterruptible: boolean, steerQueue: any[], followUpQueue: any[] }>} */
const runs = globals.__agentActiveRunRegistry || new Map();
globals.__agentActiveRunRegistry = runs;

const validPhase = new Set(['reasoning', 'waiting', 'executing', 'settled']);

export function registerActiveAgentRun(runId, identity = {}) {
  if (!runId) return null;
  const run = {
    threadId: String(identity.threadId || identity.taskId || runId).trim().slice(0, 200),
    turnId: String(identity.turnId || runId).trim().slice(0, 200),
    taskId: String(identity.taskId || runId).trim().slice(0, 200),
    operationId: String(identity.operationId || runId).trim().slice(0, 200),
    phase: 'reasoning',
    nonInterruptible: false,
    steerQueue: [],
    followUpQueue: [],
    cancel: typeof identity.cancel === 'function' ? identity.cancel : null,
  };
  runs.set(runId, run);
  return run;
}

/** Register/replace the local cancellation hook without exposing the run object. */
export function registerActiveAgentRunControl(runId, control = {}) {
  const run = runs.get(runId);
  if (!run || typeof control.cancel !== 'function') return false;
  run.cancel = control.cancel;
  return true;
}

export function cancelActiveAgentRun(runId, identity = {}) {
  const run = runs.get(runId);
  if (!run || run.phase === 'settled') return { accepted: false, reason: 'settled' };
  for (const key of ['threadId', 'turnId', 'taskId', 'operationId']) {
    if (typeof identity[key] !== 'string' || !identity[key].trim() || identity[key] !== run[key]) {
      return { accepted: false, reason: 'stale_operation' };
    }
  }
  if (typeof run.cancel !== 'function') return { accepted: false, reason: 'not_cancellable' };
  run.cancel();
  return { accepted: true };
}

export function updateActiveAgentRun(runId, update = {}) {
  const run = runs.get(runId);
  if (!run) return null;
  if (validPhase.has(update.phase)) run.phase = update.phase;
  if (typeof update.nonInterruptible === 'boolean') run.nonInterruptible = update.nonInterruptible;
  if (typeof update.taskId === 'string' && update.taskId.trim()) run.taskId = update.taskId.trim().slice(0, 200);
  if (typeof update.operationId === 'string' && update.operationId.trim()) run.operationId = update.operationId.trim().slice(0, 200);
  if (typeof update.threadId === 'string' && update.threadId.trim()) run.threadId = update.threadId.trim().slice(0, 200);
  if (typeof update.turnId === 'string' && update.turnId.trim()) run.turnId = update.turnId.trim().slice(0, 200);
  return run;
}

export function settleActiveAgentRun(runId) {
  const run = runs.get(runId);
  if (!run) return;
  run.phase = 'settled';
  run.nonInterruptible = false;
  runs.delete(runId);
}

export function getActiveAgentRun(runId) {
  const run = runs.get(runId);
  return run && run.phase !== 'settled' ? { ...run } : null;
}

export function enqueueActiveAgentRunInput(runId, input) {
  const run = runs.get(runId);
  if (!run || run.phase === 'settled') return { accepted: false, reason: 'settled' };
  if (run.phase === 'waiting') return { accepted: false, reason: 'waiting_decision' };
  if (input?.operationId && input.operationId !== run.operationId) {
    return { accepted: false, reason: 'stale_operation', operationId: run.operationId };
  }
  if (input?.threadId && input.threadId !== run.threadId) return { accepted: false, reason: 'stale_operation', operationId: run.operationId };
  if (input?.turnId && input.turnId !== run.turnId) return { accepted: false, reason: 'stale_operation', operationId: run.operationId };
  const delivery = input?.delivery === 'follow_up' || (run.phase === 'executing' && run.nonInterruptible)
    ? 'follow_up'
    : 'steer';
  const entry = {
    input: String(input?.input || '').trim().slice(0, 8000),
    referenceImages: Array.isArray(input?.referenceImages)
      ? input.referenceImages.filter((value) => typeof value === 'string' && value.trim()).slice(0, 14)
      : [],
    referenceContext: input?.referenceContext && typeof input.referenceContext === 'object'
      ? structuredClone(input.referenceContext)
      : undefined,
  };
  if (!entry.input) return { accepted: false, reason: 'invalid_input' };
  (delivery === 'steer' ? run.steerQueue : run.followUpQueue).push(entry);
  return { accepted: true, delivery, phase: run.phase };
}

function toPiMessage(entry) {
  const references = Array.isArray(entry.referenceContext?.references)
    ? entry.referenceContext.references.slice(0, 14)
    : [];
  const sourceUrls = [...new Set([
    ...(Array.isArray(entry.referenceImages) ? entry.referenceImages : []),
    ...references.map((reference) => reference?.src),
  ].filter((value) => typeof value === 'string' && value.trim()))];
  const referenceSummary = references.map((reference, index) => (
    `Reference ${index + 1}: ${String(reference?.label || reference?.id || 'image')} (${String(reference?.role || 'reference')})`
  ));
  const content = [{
    type: 'text',
    text: [
      entry.input,
      ...(referenceSummary.length ? ['Attached references:', ...referenceSummary] : []),
    ].join('\n'),
  }];
  for (const source of sourceUrls) {
    const match = /^data:([^;]+);base64,(.*)$/s.exec(source);
    if (match) content.push({ type: 'image', mimeType: match[1], data: match[2] });
  }
  return { role: 'user', content, timestamp: Date.now() };
}

export function takeActiveAgentRunInputs(runId, delivery) {
  const run = runs.get(runId);
  if (!run || run.phase === 'settled') return [];
  const queue = delivery === 'follow_up' ? run.followUpQueue : run.steerQueue;
  return queue.splice(0, 1).map(toPiMessage);
}
