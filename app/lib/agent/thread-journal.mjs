import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const root = path.join(process.cwd(), 'runtime', 'agent-threads');
const locks = new Map();
const MAX_EVENT_BYTES = 64 * 1024;
const MAX_STRING_BYTES = 12 * 1024;
const MAX_COLLECTION_ITEMS = 100;
const MAX_OBJECT_KEYS = 80;
const REDACTED_EXECUTION_PAYLOAD = '[execution payload omitted]';

const identityKeys = new Set(['type', 'threadId', 'turnId', 'taskId', 'operationId', 'runId', 'sequence', 'timestampMs', 'itemId', 'itemType', 'scope']);
const sensitiveKey = (key) => {
  const normalized = String(key).replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`).toLowerCase();
  return /(?:api[_-]?key|access[_-]?token|refresh[_-]?token|authorization|password|secret|credential|provider[_-]?(?:payload|request|response)|raw[_-]?prompt|hidden[_-]?reasoning|chain[_-]?of[_-]?thought|pi[_-]?transcript|main[_-]?agent[_-]?loop|system[_-]?prompt)/i.test(normalized)
    || normalized === 'reasoning' || normalized.endsWith('_reasoning')
    || normalized === 'transcript' || normalized.endsWith('_transcript');
};
const executionPayloadKey = (key) => /^(args|arguments|tool[_-]?arguments|executable[_-]?payload)$/i.test(String(key));
const dataUrl = (value) => typeof value === 'string' && /^data:[^,]{1,256},/i.test(value.trim());
const byteLength = (value) => Buffer.byteLength(value, 'utf8');

function truncateString(value, maxBytes = MAX_STRING_BYTES) {
  if (byteLength(value) <= maxBytes) return value;
  let end = Math.max(0, maxBytes - 16);
  while (end > 0 && byteLength(value.slice(0, end)) > maxBytes - 16) end -= 32;
  return `${value.slice(0, end)}…[truncated]`;
}

function sanitizeValue(value, context, seen, depth = 0) {
  if (depth > 8 || value === null || typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    if (dataUrl(value)) { context.redactions += 1; return undefined; }
    return truncateString(value);
  }
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'bigint') return String(value);
  if (typeof value !== 'object') return undefined;
  if (seen.has(value)) { context.redactions += 1; return '[circular value omitted]'; }
  seen.add(value);
  let result;
  if (Array.isArray(value)) {
    result = [];
    for (const entry of value.slice(0, MAX_COLLECTION_ITEMS)) {
      const next = sanitizeValue(entry, context, seen, depth + 1);
      if (next !== undefined) result.push(next);
    }
    if (value.length > MAX_COLLECTION_ITEMS) { context.redactions += 1; result.push('[additional items omitted]'); }
  } else {
    result = {};
    const entries = Object.entries(value).slice(0, MAX_OBJECT_KEYS);
    for (const [key, entry] of entries) {
      if (sensitiveKey(key)) { context.redactions += 1; continue; }
      if (executionPayloadKey(key)) {
        context.redactions += 1;
        result[key] = REDACTED_EXECUTION_PAYLOAD;
        continue;
      }
      const next = sanitizeValue(entry, context, seen, depth + 1);
      if (next !== undefined) result[key] = next;
    }
    if (Object.keys(value).length > MAX_OBJECT_KEYS) { context.redactions += 1; result._additionalFieldsOmitted = true; }
  }
  seen.delete(value);
  return result;
}

function compactValue(value, depth = 0) {
  if (typeof value === 'string') return truncateString(value, 2048);
  if (value === null || typeof value === 'boolean' || typeof value === 'number') return value;
  if (depth > 4) return '[nested value omitted]';
  if (Array.isArray(value)) return value.slice(0, 20).map((entry) => compactValue(entry, depth + 1));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).slice(0, 30).map(([key, entry]) => [key, compactValue(entry, depth + 1)]));
  return undefined;
}

export function sanitizeJournalValue(value) {
  const context = { redactions: 0 };
  const sanitized = sanitizeValue(value, context, new WeakSet());
  return { value: sanitized, redactions: context.redactions };
}

export function sanitizeJournalEvent(event) {
  const context = { redactions: 0 };
  const sanitized = sanitizeValue(event, context, new WeakSet());
  const result = sanitized && typeof sanitized === 'object' && !Array.isArray(sanitized) ? sanitized : {};
  for (const key of identityKeys) {
    if (event?.[key] !== undefined) result[key] = event[key];
  }
  if (result.item && typeof result.item === 'object' && !Array.isArray(result.item)) {
    if (result.itemId !== undefined) result.item.itemId = result.itemId;
    if (result.itemType !== undefined && result.item.type === undefined) result.item.type = result.itemType;
  }
  if (context.redactions > 0) result.persistence = { sanitized: true, redactions: context.redactions, executablePayloadPersisted: false };
  let serialized = JSON.stringify(result);
  if (byteLength(serialized) > MAX_EVENT_BYTES) {
    const compact = {};
    for (const key of identityKeys) if (result[key] !== undefined) compact[key] = result[key];
    for (const key of ['item', 'usage', 'error', 'recovery', 'status', 'stopReason', 'message', 'persistence']) {
      if (result[key] !== undefined) compact[key] = compactValue(result[key]);
    }
    compact.persistence = { ...(compact.persistence || {}), sanitized: true, sizeBounded: true, executablePayloadPersisted: false };
    serialized = JSON.stringify(compact);
    return { event: compact, serialized };
  }
  return { event: result, serialized };
}
export function safeId(value) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-][a-zA-Z0-9._-]{0,199}$/.test(value)) throw Object.assign(new Error('Invalid threadId'), { statusCode: 400, code: 'invalid_identity' });
  return value;
}
const directory = (id) => path.join(root, safeId(id));
async function queue(id, fn) {
  safeId(id);
  const previous = locks.get(id) || Promise.resolve();
  const next = previous.then(fn, fn);
  const settled = next.catch(() => {});
  locks.set(id, settled);
  try { return await next; } finally { if (locks.get(id) === settled) locks.delete(id); }
}
const initial = (id) => ({ schemaVersion: 5, threadId: id, createdAt: Date.now(), updatedAt: Date.now(), threadStatus: 'idle', turns: [], activeTurn: null, lastSequence: 0, transcriptStartSequence: 0, transcriptSummary: null, archived: false, pendingApproval: null, pendingDecision: null, queuedInputs: [], todoItems: [], commandState: { lastCommand: null, lastResult: null } });
async function save(id, state) {
  const temp = path.join(directory(id), 'state.tmp');
  await fs.writeFile(temp, JSON.stringify(state));
  await fs.rename(temp, path.join(directory(id), 'state.json'));
}
function reduce(state, event) {
  state.lastSequence = event.sequence;
  state.updatedAt = event.timestampMs;
  if (event.itemType === 'command_result' && event.item) state.commandState = { lastCommand: event.item.command, lastResult: event.item.result || event.item };
  if (event.scope === 'thread' || !event.turnId || event.type === 'thread.started') return;
  let turn = state.turns.find((entry) => entry.turnId === event.turnId);
  if (!turn) {
    turn = { turnId: event.turnId, taskId: event.taskId, operationId: event.operationId, runId: event.runId, runIds: [], status: 'queued', items: [], usage: null, error: null, recovery: null, startSequence: event.sequence, startedAt: event.timestampMs, completedAt: null };
    state.turns.push(turn);
  }
  turn.runIds ||= [];
  if (event.runId && !turn.runIds.includes(event.runId)) turn.runIds.push(event.runId);
  turn.runId = event.runId;
  if (event.taskId) turn.taskId = event.taskId;
  if (event.type === 'turn.started') { turn.status = 'running'; state.activeTurn = turn.turnId; state.threadStatus = 'running'; }
  if (event.type.startsWith('item.')) {
    const itemId = event.itemId || `${turn.turnId}:${event.itemType || 'item'}`;
    const index = turn.items.findIndex((item) => item.itemId === itemId);
    const old = index < 0 ? {} : turn.items[index];
    const item = { ...old, ...event.item, itemId, type: event.itemType || event.item?.type || old.type, status: event.type.slice(5) };
    if (typeof event.item?.delta === 'string') item.content = `${old.content || ''}${event.item.delta}`;
    if (index < 0) turn.items.push(item); else turn.items[index] = item;
    if (item.type === 'todo_list' && event.type === 'item.completed') state.todoItems = structuredClone(item.items || []);
    if (['confirmation', 'clarification'].includes(item.type) && event.type !== 'item.completed') {
      state.pendingDecision = { ...item, threadId: state.threadId, turnId: turn.turnId };
      if (item.type === 'confirmation') state.pendingApproval = state.pendingDecision;
      state.threadStatus = 'waiting'; turn.status = 'waiting';
    }
  }
  if (event.type === 'turn.completed' && turn.status !== 'waiting') {
    turn.status = 'completed'; turn.usage = event.usage || null; turn.completedAt = event.timestampMs;
  }
  if (event.type === 'turn.failed') { turn.status = ['cancelled', 'interrupted'].includes(event.status) ? event.status : 'failed'; turn.error = event.error || null; turn.completedAt = event.timestampMs; }
  if (['completed', 'failed', 'cancelled', 'interrupted'].includes(turn.status)) {
    if (state.activeTurn === turn.turnId) state.activeTurn = null;
    if (state.pendingDecision?.turnId === turn.turnId) state.pendingDecision = null;
    if (state.pendingApproval?.turnId === turn.turnId) state.pendingApproval = null;
    state.threadStatus = turn.status === 'failed' ? 'error' : 'idle';
  }
  if (state.archived) state.threadStatus = 'archived';
}
async function read(id) {
  await fs.mkdir(directory(id), { recursive: true });
  let state = initial(id);
  try { const saved = JSON.parse(await fs.readFile(path.join(directory(id), 'state.json'), 'utf8')); if (saved.schemaVersion === 5 && saved.threadId === id) state = { ...state, ...saved }; } catch (error) { if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error; }
  let raw = Buffer.alloc(0);
  try { raw = await fs.readFile(path.join(directory(id), 'events.jsonl')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const events = []; let offset = 0; let valid = 0; let sequence = 0;
  while (offset < raw.length) {
    const newline = raw.indexOf(10, offset); if (newline < 0) break;
    const line = raw.subarray(offset, newline).toString('utf8');
    try {
      if (line.trim()) { const event = JSON.parse(line); if (!Number.isSafeInteger(event.sequence) || event.sequence <= sequence) break; events.push(event); sequence = event.sequence; }
    } catch { break; }
    offset = newline + 1; valid = offset;
  }
  if (valid !== raw.length) await fs.truncate(path.join(directory(id), 'events.jsonl'), valid);
  for (const event of events) if (event.sequence > state.lastSequence) reduce(state, event);
  await save(id, state);
  return { state, events };
}
export async function loadThread(id) { return queue(id, () => read(id)); }
export async function appendThreadEvent(id, input) {
  return queue(id, async () => {
    const { state } = await read(id);
    const turn = state.turns.find((entry) => entry.turnId === input.turnId);
    if (state.archived && input.type === 'turn.started') throw Object.assign(new Error('Thread is archived'), { statusCode: 409, code: 'thread_archived' });
    if (input.type === 'turn.started' && state.activeTurn && state.activeTurn !== input.turnId) throw Object.assign(new Error('Turn is active'), { statusCode: 409, code: 'turn_active' });
    const eventInput = { ...input, threadId: id, turnId: input.turnId || `thread:${id}`, taskId: input.taskId || id, operationId: input.operationId || turn?.operationId || randomUUID(), runId: input.runId || turn?.runId || randomUUID(), sequence: state.lastSequence + 1, timestampMs: input.timestampMs || Date.now() };
    const { event, serialized } = sanitizeJournalEvent(eventInput);
    await fs.appendFile(path.join(directory(id), 'events.jsonl'), `${serialized}\n`);
    reduce(state, event); await save(id, state); return event;
  });
}
export async function updateThreadState(id, patch) {
  return queue(id, async () => {
    const { state } = await read(id);
    if (patch.archived === true && (state.activeTurn || state.pendingDecision)) throw Object.assign(new Error('Cannot archive an active thread'), { statusCode: 409, code: 'thread_active' });
    const next = { ...state, ...patch, schemaVersion: 5, threadId: id, lastSequence: state.lastSequence, updatedAt: Date.now() };
    if (next.archived) next.threadStatus = 'archived';
    await save(id, next); return next;
  });
}
function normalizeQueuedInput(input) {
  const identity = ['turnId', 'taskId', 'operationId', 'runId'].every((field) => typeof input?.[field] === 'string' && input[field].trim());
  const text = typeof input?.input === 'string' ? input.input.trim().slice(0, 8000) : '';
  if (!identity || !text) throw Object.assign(new Error('Invalid queued input'), { statusCode: 400, code: 'invalid_input' });
  return {
    id: typeof input.id === 'string' && input.id.trim() ? input.id.trim().slice(0, 200) : randomUUID(),
    turnId: input.turnId.trim(), taskId: input.taskId.trim(), operationId: input.operationId.trim(), runId: input.runId.trim(),
    delivery: input.delivery === 'follow_up' ? 'follow_up' : 'steer', input: text,
    referenceIds: Array.isArray(input.referenceIds) ? input.referenceIds.filter((id) => typeof id === 'string' && id.trim()).slice(0, 14) : [],
    createdAt: Number.isFinite(Number(input.createdAt)) ? Number(input.createdAt) : Date.now(),
  };
}
export async function queueThreadInput(id, input) {
  return queue(id, async () => {
    const { state } = await read(id);
    const entry = normalizeQueuedInput(input);
    const turn = state.turns.find((candidate) => candidate.turnId === entry.turnId);
    if (state.archived) throw Object.assign(new Error('Thread is archived'), { statusCode: 409, code: 'thread_archived' });
    if (state.activeTurn !== entry.turnId || !turn || (turn.taskId && turn.taskId !== entry.taskId) || turn.operationId !== entry.operationId || turn.runId !== entry.runId || turn.status === 'waiting') {
      throw Object.assign(new Error('Turn is stale'), { statusCode: 409, code: 'stale_operation' });
    }
    state.queuedInputs = [...(Array.isArray(state.queuedInputs) ? state.queuedInputs : []), entry].slice(-50);
    await save(id, state);
    return entry;
  });
}
export async function consumeThreadInputs(id, identity, delivery, limit = 1) {
  return queue(id, async () => {
    const { state } = await read(id);
    const pending = Array.isArray(state.queuedInputs) ? state.queuedInputs : [];
    const max = Number.isSafeInteger(limit) ? Math.max(1, limit) : 1;
    const matches = pending.filter((entry) => entry.delivery === delivery && ['turnId', 'taskId', 'operationId', 'runId'].every((field) => entry[field] === identity?.[field])).slice(0, max);
    if (matches.length) {
      const matched = new Set(matches.map((entry) => entry.id));
      state.queuedInputs = pending.filter((entry) => !matched.has(entry.id));
      await save(id, state);
    }
    return matches;
  });
}
export async function queryThread(id, options = {}) {
  const { state, events } = await loadThread(id);
  const after = Number(options.afterSequence || 0); const before = options.beforeSequence === undefined ? Infinity : Number(options.beforeSequence);
  const limit = Math.max(1, Math.min(200, Math.floor(Number(options.limit) || 200)));
  const eligible = events.filter((event) => event.sequence > after && event.sequence < before);
  const page = after > 0 ? eligible.slice(0, limit) : eligible.slice(-limit);
  return { state, events: page, hasOlder: Boolean(page.length && events.some((event) => event.sequence < page[0].sequence)), hasNewer: Boolean(page.length && events.some((event) => event.sequence > page.at(-1).sequence)), latestSequence: state.lastSequence };
}
export async function listThreads() {
  await fs.mkdir(root, { recursive: true }); const result = [];
  for (const entry of await fs.readdir(root, { withFileTypes: true })) { if (entry.isDirectory()) try { result.push((await loadThread(entry.name)).state); } catch { /* invalid directory is not a thread */ } }
  return result.sort((a, b) => b.updatedAt - a.updatedAt);
}
export async function forkThread(id) {
  const { state } = await loadThread(id);
  if (state.activeTurn || state.pendingDecision || state.turns.some((turn) => turn.status === 'interrupted')) throw Object.assign(new Error('Cannot fork an unfinished thread'), { statusCode: 409, code: 'thread_active' });
  const nextId = `thread-${randomUUID()}`; await loadThread(nextId);
  for (const turn of state.turns.filter((entry) => entry.status === 'completed')) {
    const identity = { turnId: randomUUID(), operationId: randomUUID(), runId: randomUUID(), taskId: nextId };
    await appendThreadEvent(nextId, { ...identity, type: 'turn.started' });
    for (const item of turn.items.filter((entry) => ['user_message', 'assistant_message', 'public_commentary', 'tool_result', 'todo_list'].includes(entry.type))) {
      const copy = { type: item.type, content: item.content || item.text || '', ...(item.type === 'todo_list' ? { items: structuredClone(item.items || []) } : {}), ...(item.type === 'tool_result' ? { summary: item.summary || '' } : {}) };
      await appendThreadEvent(nextId, { ...identity, type: 'item.completed', itemId: randomUUID(), itemType: item.type, item: copy });
    }
    await appendThreadEvent(nextId, { ...identity, type: 'turn.completed', usage: turn.usage });
  }
  return (await loadThread(nextId)).state;
}
