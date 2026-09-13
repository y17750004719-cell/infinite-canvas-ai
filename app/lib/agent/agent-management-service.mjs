import { randomUUID } from 'node:crypto';
import { appendThreadEvent, loadThread, queryThread, updateThreadState, forkThread } from './thread-journal-service.mjs';
import {
  commandErrorResponse,
  commandUsage,
  parseHistoryCommandArgs,
  searchHistoryPages,
} from './commands.mjs';

function summarizeThreadTranscript(state = {}) {
  const boundary = Number.isSafeInteger(state.transcriptStartSequence) ? Math.max(0, state.transcriptStartSequence) : 0;
  const rows = (Array.isArray(state.turns) ? state.turns : [])
    .filter((turn) => turn.status === 'completed' && Number(turn.startSequence || 0) >= boundary)
    .flatMap((turn) => Array.isArray(turn.items) ? turn.items : [])
    .flatMap((item) => {
      if (item.type === 'todo_list') {
        const todos = (Array.isArray(item.items) ? item.items : [])
          .map((todo) => `${todo.status === 'completed' ? '[x]' : '[ ]'} ${String(todo.content || '').trim()}`)
          .filter(Boolean);
        return todos.length ? [`Todo: ${todos.join('; ')}`] : [];
      }
      if (!['user_message', 'assistant_message', 'public_commentary'].includes(item.type)) return [];
      const text = String(item.content || item.text || '').trim().replace(/\s+/g, ' ');
      if (!text) return [];
      return [`${item.type === 'user_message' ? 'User' : 'Assistant'}: ${text.slice(0, 800)}`];
    });
  const previous = typeof state.transcriptSummary === 'string' ? state.transcriptSummary.trim() : '';
  const body = [...(previous ? [`Previous summary: ${previous}`] : []), ...rows].join('\n').slice(-5600);
  return body ? `Conversation summary:\n${body}` : 'Conversation summary: no completed public conversation yet.';
}

const jsonError = (body, status) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
});

export async function handleManagementCommand(threadId, command, { journal = {} } = {}) {
  const load = journal.loadThread || loadThread;
  const query = journal.queryThread || queryThread;
  const append = journal.appendThreadEvent || appendThreadEvent;
  const update = journal.updateThreadState || updateThreadState;
  const fork = journal.forkThread || forkThread;
  try {
    const loaded = await load(threadId);
    let result;
    let transcriptBoundary = null;
    if (command.name === 'status') {
      result = {
        threadId, threadStatus: loaded.state.threadStatus, archived: Boolean(loaded.state.archived),
        activeTurn: loaded.state.activeTurn, pendingApproval: loaded.state.pendingApproval || loaded.state.pendingDecision || null,
        lastSequence: loaded.state.lastSequence, turnCount: Array.isArray(loaded.state.turns) ? loaded.state.turns.length : 0,
        todoItems: loaded.state.todoItems || [],
      };
    } else if (command.name === 'history') {
      const options = parseHistoryCommandArgs(command.args);
      const history = await searchHistoryPages((pageOptions) => query(threadId, pageOptions), options);
      result = { ...options, events: history.events, hasOlder: history.hasOlder, hasNewer: history.hasNewer, latestSequence: history.latestSequence };
    } else if (command.name === 'fork') {
      const forked = await fork(threadId);
      result = { threadId: forked.threadId };
    } else if (command.name === 'archive') {
      if (loaded.state.activeTurn || loaded.state.pendingDecision || loaded.state.pendingApproval) {
        throw Object.assign(new Error('Cannot archive an active or waiting thread'), { code: 'thread_active', statusCode: 409 });
      }
      const state = await update(threadId, { archived: true, threadStatus: 'archived' });
      result = { archived: true, threadId, threadStatus: state.threadStatus };
    } else if (command.name === 'resume') {
      const state = loaded.state.archived ? await update(threadId, { archived: false, threadStatus: 'idle' }) : loaded.state;
      result = { archived: false, threadId, threadStatus: state.threadStatus };
    } else if (command.name === 'clear') {
      if (loaded.state.activeTurn || loaded.state.pendingDecision || loaded.state.pendingApproval) {
        throw Object.assign(new Error('Cannot clear an active or waiting thread'), { code: 'thread_active', statusCode: 409 });
      }
      transcriptBoundary = { summary: null };
      result = { threadId, cleared: true };
    } else if (command.name === 'compact') {
      if (loaded.state.activeTurn || loaded.state.pendingDecision || loaded.state.pendingApproval) {
        throw Object.assign(new Error('Cannot compact an active or waiting thread'), { code: 'thread_active', statusCode: 409 });
      }
      transcriptBoundary = { summary: summarizeThreadTranscript(loaded.state) };
      result = { threadId, compacted: true, summary: transcriptBoundary.summary };
    } else {
      throw Object.assign(new Error(`Unsupported command ${command.raw}`), { code: 'unknown_command', statusCode: 400 });
    }

    const operationId = `command-${randomUUID()}`;
    const runId = `command-run-${randomUUID()}`;
    const itemId = `command-item-${randomUUID()}`;
    const identity = { taskId: threadId, operationId, runId, itemId, scope: 'thread' };
    const events = [
      await append(threadId, { type: 'item.started', itemType: 'command_result', ...identity, item: { command: command.name } }),
      await append(threadId, { type: 'item.completed', itemType: 'command_result', ...identity, item: { command: command.name, result: command.name === 'history' ? { ...result, events: undefined, count: result.events.length } : result } }),
    ];
    if (command.name === 'history') events[1] = { ...events[1], item: { command: command.name, result } };
    if (transcriptBoundary) {
      const state = await update(threadId, { transcriptStartSequence: events[1].sequence + 1, transcriptSummary: transcriptBoundary.summary });
      result = { ...result, transcriptStartSequence: state.transcriptStartSequence, ...(transcriptBoundary.summary ? { summary: transcriptBoundary.summary } : {}) };
      events[1] = { ...events[1], item: { command: command.name, result } };
    }
    return new Response(`${events.map((event) => JSON.stringify(event)).join('\n')}\n`, { status: 200, headers: { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-store' } });
  } catch (error) {
    const failure = commandErrorResponse(error);
    return jsonError(failure.body, failure.status);
  }
}

export { summarizeThreadTranscript };
