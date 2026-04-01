import { appendFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";

export type LocalLogLevel = "info" | "warn" | "error";
export type LocalLogSource = "server" | "client";

export interface StartupSession {
  startupId: string;
  startedAt: string;
  date: string;
}

export interface LocalLogEntry {
  timestamp: string;
  level: LocalLogLevel;
  source: LocalLogSource;
  scope: string;
  message: string;
  event: string;
  details: Record<string, unknown> | null;
  startupId?: string;
  route?: string;
  pageUrl?: string;
  requestId?: string;
}

export interface ReadLogEntriesFilters {
  date?: string;
  startupId?: string;
  level?: LocalLogLevel | string;
  source?: LocalLogSource | string;
  q?: string;
  limit?: number;
}

export interface LocalLogsRuntimeOptions {
  logsDir?: string;
}

const DEFAULT_LIMIT = 200;
const MAX_STRING_LENGTH = 1200;
const MAX_ARRAY_ITEMS = 30;
const MAX_OBJECT_KEYS = 40;
const MAX_DEPTH = 5;
const REDACTED_VALUE = "[REDACTED]";
const REDACTED_IMAGE_VALUE = "[BASE64_IMAGE_REDACTED]";
const CURRENT_STARTUP_SESSION = createStartupSession();

function resolveLogsDir(options?: LocalLogsRuntimeOptions): string {
  return options?.logsDir || path.join(process.cwd(), "logs");
}

function createStartupSession(now = new Date()): StartupSession {
  const startedAt = now.toISOString();
  return {
    startupId: `${startedAt.slice(11, 19).replace(/:/g, "-")}-${Math.random().toString(36).slice(2, 8)}`,
    startedAt,
    date: startedAt.slice(0, 10),
  };
}

export function getCurrentStartupSession(): StartupSession {
  return CURRENT_STARTUP_SESSION;
}

function normalizeDate(date?: string): string {
  if (typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date.trim())) {
    return date.trim();
  }
  return CURRENT_STARTUP_SESSION.date;
}

function isSensitiveKey(key?: string): boolean {
  return !!key && /authorization|api[-_]?key|token|cookie|password|secret/i.test(key);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object") return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function truncateString(value: string): string {
  if (/^data:image\/[a-z0-9.+-]+;base64,/i.test(value)) {
    return REDACTED_IMAGE_VALUE;
  }

  if (value.length <= MAX_STRING_LENGTH) {
    return value;
  }

  const removed = value.length - MAX_STRING_LENGTH;
  return `${value.slice(0, MAX_STRING_LENGTH)} [TRUNCATED ${removed} chars]`;
}

export function sanitizeForLog(
  value: unknown,
  key?: string,
  depth = 0,
  seen = new WeakSet<object>()
): unknown {
  if (value === null || value === undefined) {
    return value ?? null;
  }

  if (isSensitiveKey(key)) {
    return REDACTED_VALUE;
  }

  if (typeof value === "string") {
    return truncateString(value);
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return value;
  }

  if (typeof value === "bigint") {
    return value.toString();
  }

  if (value instanceof Error) {
    return {
      name: value.name,
      message: truncateString(value.message),
      stack: typeof value.stack === "string" ? truncateString(value.stack) : null,
      cause: sanitizeForLog(value.cause, "cause", depth + 1, seen),
    };
  }

  if (Array.isArray(value)) {
    if (depth >= MAX_DEPTH) {
      return `[Array(${value.length})]`;
    }

    const result = value.slice(0, MAX_ARRAY_ITEMS).map((item) => sanitizeForLog(item, undefined, depth + 1, seen));
    if (value.length > MAX_ARRAY_ITEMS) {
      result.push(`[+${value.length - MAX_ARRAY_ITEMS} more items]`);
    }
    return result;
  }

  if (typeof value === "object") {
    if (seen.has(value as object)) {
      return "[Circular]";
    }

    if (depth >= MAX_DEPTH) {
      return "[Object]";
    }

    seen.add(value as object);

    if (!isPlainObject(value)) {
      return truncateString(String(value));
    }

    const entries = Object.entries(value).slice(0, MAX_OBJECT_KEYS);
    const sanitized: Record<string, unknown> = {};

    for (const [entryKey, entryValue] of entries) {
      sanitized[entryKey] = sanitizeForLog(entryValue, entryKey, depth + 1, seen);
    }

    const extraKeys = Object.keys(value).length - entries.length;
    if (extraKeys > 0) {
      sanitized.__truncatedKeys = `[+${extraKeys} more keys]`;
    }

    return sanitized;
  }

  return truncateString(String(value));
}

function normalizeDetails(details: unknown): Record<string, unknown> | null {
  if (details === null || details === undefined) {
    return null;
  }

  if (isPlainObject(details)) {
    return sanitizeForLog(details) as Record<string, unknown>;
  }

  return {
    value: sanitizeForLog(details),
  };
}

function normalizeString(value?: string): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return truncateString(trimmed);
}

function normalizeEntry(entry: LocalLogEntry, startupIdFallback?: string): LocalLogEntry {
  return {
    timestamp: normalizeString(entry.timestamp) || new Date().toISOString(),
    level: entry.level,
    source: entry.source,
    scope: normalizeString(entry.scope) || "unknown",
    message: normalizeString(entry.message) || "Log entry",
    event: normalizeString(entry.event) || "unknown",
    details: normalizeDetails(entry.details),
    startupId: normalizeString(entry.startupId) || startupIdFallback,
    route: normalizeString(entry.route),
    pageUrl: normalizeString(entry.pageUrl),
    requestId: normalizeString(entry.requestId),
  };
}

function getLogFilePath(session: StartupSession, options?: LocalLogsRuntimeOptions): string {
  return path.join(resolveLogsDir(options), session.date, `${session.startupId}.app.log`);
}

function resolveReadSession(filters: ReadLogEntriesFilters): StartupSession {
  const startupId = normalizeString(filters.startupId) || CURRENT_STARTUP_SESSION.startupId;
  const date = normalizeDate(filters.date);

  if (startupId === CURRENT_STARTUP_SESSION.startupId && date === CURRENT_STARTUP_SESSION.date) {
    return CURRENT_STARTUP_SESSION;
  }

  return {
    startupId,
    startedAt: `${date}T00:00:00.000Z`,
    date,
  };
}

function matchesFilters(entry: LocalLogEntry, filters: ReadLogEntriesFilters): boolean {
  if (filters.startupId && entry.startupId !== filters.startupId) {
    return false;
  }

  if (filters.level && entry.level !== filters.level) {
    return false;
  }

  if (filters.source && entry.source !== filters.source) {
    return false;
  }

  if (filters.q) {
    const haystack = JSON.stringify(entry).toLowerCase();
    if (!haystack.includes(filters.q.toLowerCase())) {
      return false;
    }
  }

  return true;
}

function emitDevelopmentConsoleLog(entry: LocalLogEntry) {
  if (process.env.NODE_ENV !== "development") {
    return;
  }

  const method = entry.level === "error" ? console.error : entry.level === "warn" ? console.warn : console.log;
  method(`[local-log][${entry.level}] ${entry.scope} ${entry.message}`, {
    startupId: entry.startupId,
    event: entry.event,
    route: entry.route,
    pageUrl: entry.pageUrl,
    requestId: entry.requestId,
    details: entry.details,
  });
}

export function isLocalLogAccessAllowed(): boolean {
  return process.env.NODE_ENV === "development";
}

export async function appendLogEntry(
  entry: LocalLogEntry,
  options?: LocalLogsRuntimeOptions
): Promise<LocalLogEntry> {
  const startupSession = CURRENT_STARTUP_SESSION;
  const normalized = normalizeEntry(entry, startupSession.startupId);
  const logFilePath = getLogFilePath(startupSession, options);

  await mkdir(path.dirname(logFilePath), { recursive: true });
  await appendFile(logFilePath, `${JSON.stringify(normalized)}\n`, "utf8");

  emitDevelopmentConsoleLog(normalized);
  return normalized;
}

export async function readLogEntries(
  filters: ReadLogEntriesFilters = {},
  options?: LocalLogsRuntimeOptions
): Promise<LocalLogEntry[]> {
  const targetSession = resolveReadSession(filters);
  const logFilePath = getLogFilePath(targetSession, options);

  let raw = "";
  try {
    raw = await readFile(logFilePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }

  const lines = raw.split("\n").map((line) => line.trim()).filter(Boolean);
  const entries: LocalLogEntry[] = [];

  for (const line of lines) {
    try {
      const parsed = JSON.parse(line) as LocalLogEntry;
      const normalized = normalizeEntry(parsed, targetSession.startupId);
      if (matchesFilters(normalized, filters)) {
        entries.push(normalized);
      }
    } catch {
      continue;
    }
  }

  entries.sort((left, right) => right.timestamp.localeCompare(left.timestamp));

  const limit =
    typeof filters.limit === "number" && Number.isFinite(filters.limit) && filters.limit > 0
      ? Math.floor(filters.limit)
      : DEFAULT_LIMIT;

  return entries.slice(0, limit);
}
