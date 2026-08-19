const globals = globalThis;

/** @type {Map<string, { phase: 'reasoning' | 'waiting' | 'executing' | 'settled', nonInterruptible: boolean, steerQueue: any[], followUpQueue: any[] }>} */
const runs = globals.__agentActiveRunRegistry || new Map();
globals.__agentActiveRunRegistry = runs;

const validPhase = new Set(['reasoning', 'waiting', 'executing', 'settled']);

export function registerActiveAgentRun(runId) {
  if (!runId) return null;
  const run = { phase: 'reasoning', nonInterruptible: false, steerQueue: [], followUpQueue: [] };
  runs.set(runId, run);
  return run;
}

export function updateActiveAgentRun(runId, update = {}) {
  const run = runs.get(runId);
  if (!run) return null;
  if (validPhase.has(update.phase)) run.phase = update.phase;
  if (typeof update.nonInterruptible === 'boolean') run.nonInterruptible = update.nonInterruptible;
  return run;
}

export function settleActiveAgentRun(runId) {
  const run = runs.get(runId);
  if (!run) return;
  run.phase = 'settled';
  run.nonInterruptible = false;
  runs.delete(runId);
}

export function enqueueActiveAgentRunInput(runId, input) {
  const run = runs.get(runId);
  if (!run || run.phase === 'settled') return { accepted: false, reason: 'settled' };
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
