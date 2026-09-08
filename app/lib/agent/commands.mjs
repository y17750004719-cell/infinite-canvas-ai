const COMMANDS = new Set(['compact', 'status', 'history', 'fork', 'archive', 'resume', 'clear', 'skill']);

const boundedText = (value, limit = 500) => typeof value === 'string' ? value.trim().slice(0, limit) : '';
const integer = (value) => {
  if (value === undefined || value === null || value === '') return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
};

export class CommandError extends Error {
  constructor(message, { code = 'invalid_command', statusCode = 400, details } = {}) {
    super(message);
    this.name = 'CommandError';
    this.code = code;
    this.statusCode = statusCode;
    if (details !== undefined) this.details = details;
  }
}

export function parseSlashCommand(input) {
  const raw = boundedText(input, 12_000);
  if (!raw.startsWith('/')) return null;
  const match = raw.match(/^\/([a-z][a-z0-9_-]*)(?:\s+([\s\S]*))?$/i);
  if (!match) return null;
  const name = match[1].toLowerCase();
  return { name, args: match[2]?.trim() || '', known: COMMANDS.has(name), raw };
}

export function isManagementCommand(command) {
  return Boolean(command?.known && command.name !== 'skill');
}

export function parseHistoryCommandArgs(input) {
  const tokens = boundedText(input, 2_000).match(/(?:[^\s"]+|"[^"]*")+/g) || [];
  const options = { limit: 20, afterSequence: 0, beforeSequence: undefined, search: '' };
  const searchParts = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    const next = tokens[index + 1];
    const [flag, inlineValue] = token.split('=', 2);
    if (flag === '--limit' || flag === '--after' || flag === '--before' || flag === '--search') {
      const value = inlineValue ?? next;
      if (inlineValue === undefined) index += 1;
      if (value === undefined) throw new CommandError(`Missing value for ${flag}`, { details: { usage: commandUsage('history') } });
      if (flag === '--search') {
        options.search = boundedText(value.replace(/^"|"$/g, ''), 200);
        continue;
      }
      const parsed = integer(value);
      if (parsed === null || parsed === undefined) throw new CommandError(`${flag} must be a non-negative integer`, { details: { usage: commandUsage('history') } });
      if (flag === '--limit') options.limit = Math.max(1, Math.min(100, parsed));
      if (flag === '--after') options.afterSequence = parsed;
      if (flag === '--before') options.beforeSequence = parsed;
      continue;
    }
    if (/^\d+$/.test(token) && index === 0) {
      options.limit = Math.max(1, Math.min(100, Number(token)));
      continue;
    }
    if (token.startsWith('--')) throw new CommandError(`Unknown history option ${token}`, { details: { usage: commandUsage('history') } });
    searchParts.push(token.replace(/^"|"$/g, ''));
  }
  if (!options.search && searchParts.length) options.search = boundedText(searchParts.join(' '), 200);
  if (options.beforeSequence !== undefined && options.afterSequence >= options.beforeSequence) {
    throw new CommandError('--after must be lower than --before', { details: { usage: commandUsage('history') } });
  }
  return options;
}

export function filterHistoryEvents(events, search) {
  const query = boundedText(search, 200).toLocaleLowerCase();
  if (!query) return Array.isArray(events) ? events : [];
  return (Array.isArray(events) ? events : []).filter((event) => {
    try { return JSON.stringify(event).toLocaleLowerCase().includes(query); } catch { return false; }
  });
}

/**
 * Search a journal through all available pages. The loader receives the same
 * cursor options as queryThread and must return { events, hasOlder, hasNewer }.
 * Search pages are deliberately loaded without a search parameter so the
 * server remains the sole source of pagination boundaries.
 */
export async function searchHistoryPages(loadPage, options = {}) {
  if (typeof loadPage !== 'function') throw new TypeError('History page loader is required');
  const normalized = {
    limit: Math.max(1, Math.min(100, Math.floor(Number(options.limit) || 20))),
    afterSequence: Number.isSafeInteger(options.afterSequence) ? options.afterSequence : 0,
    ...(Number.isSafeInteger(options.beforeSequence) ? { beforeSequence: options.beforeSequence } : {}),
  };
  const search = boundedText(options.search, 200);
  const first = await loadPage(normalized);
  if (!search) return { ...first, events: Array.isArray(first?.events) ? first.events : [] };

  const pages = [];
  const seenSequences = new Set();
  const addPage = (page) => {
    if (!page || !Array.isArray(page.events)) return;
    const events = page.events.filter((event) => {
      const sequence = Number(event?.sequence);
      if (Number.isSafeInteger(sequence)) {
        if (seenSequences.has(sequence)) return false;
        seenSequences.add(sequence);
      }
      return true;
    });
    pages.push({ ...page, events });
  };
  addPage(first);

  // queryThread returns the newest page when no after cursor is supplied.
  // Walk toward older pages in that mode; otherwise walk forward from after.
  if (normalized.afterSequence > 0) {
    let page = first;
    while (page?.hasNewer && Array.isArray(page.events) && page.events.length > 0) {
      const lastSequence = Number(page.events.at(-1)?.sequence);
      if (!Number.isSafeInteger(lastSequence)) break;
      page = await loadPage({ ...normalized, afterSequence: lastSequence });
      addPage(page);
    }
  } else {
    let page = first;
    while (page?.hasOlder && Array.isArray(page.events) && page.events.length > 0) {
      const firstSequence = Number(page.events[0]?.sequence);
      if (!Number.isSafeInteger(firstSequence)) break;
      page = await loadPage({ ...normalized, beforeSequence: firstSequence });
      addPage(page);
    }
  }

  const events = filterHistoryEvents(pages.flatMap((page) => page.events), search);
  // Pages are newest-first for the default cursor and oldest-first for an
  // explicit after cursor, matching queryThread's ordering in either mode.
  return {
    ...first,
    events: events.slice(0, normalized.limit),
    hasOlder: false,
    hasNewer: false,
  };
}

export function commandUsage(name) {
  return {
    compact: '/compact', status: '/status',
    history: '/history [limit] [--before N] [--after N] [--search "text"]',
    fork: '/fork', archive: '/archive', resume: '/resume', clear: '/clear',
    skill: '/skill <id> [input]',
  }[name] || `/${name}`;
}

export function commandErrorResponse(error, fallbackCode = 'command_failed') {
  return {
    status: Number(error?.statusCode) || 400,
    body: {
      error: error instanceof Error ? error.message : 'Command failed',
      code: boundedText(error?.code, 100) || fallbackCode,
      ...(error?.details && typeof error.details === 'object' ? error.details : {}),
    },
  };
}

export { COMMANDS };
