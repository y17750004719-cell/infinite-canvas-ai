import { appendFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";

export type LocalLogLevel = "info" | "warn" | "error";
export type LocalLogSource = "server" | "client";

export interface LocalLogEntry {
  timestamp: string;
  level: LocalLogLevel;
  source: LocalLogSource;
  scope: string;
  message: string;
  event: string;
  details: Record<string, unknown> | null;
  route?: string;
  pageUrl?: string;
  requestId?: string;
}

export interface ReadLogEntriesFilters {
  date?: string;
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

function resolveLogsDir(options?: LocalLogsRuntimeOptions): string {
  return options?.logsDir || path.join(process.cwd(), "logs");
}

function normalizeDate(date?: string): string {
  if (typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date.trim())) {
    return date.trim();
  }
  return new Date().toISOString().slice(0, 10);
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

function normalizeEntry(entry: LocalLogEntry): LocalLogEntry {
  return {
    timestamp: normalizeString(entry.timestamp) || new Date().toISOString(),
    level: entry.level,
    source: entry.source,
    scope: normalizeString(entry.scope) || "unknown",
    message: normalizeString(entry.message) || "Log entry",
    event: normalizeString(entry.event) || "unknown",
    details: normalizeDetails(entry.details),
    route: normalizeString(entry.route),
    pageUrl: normalizeString(entry.pageUrl),
    requestId: normalizeString(entry.requestId),
  };
}

function getLogFilePath(timestamp: string, options?: LocalLogsRuntimeOptions): string {
  const normalizedTimestamp = normalizeString(timestamp) || new Date().toISOString();
  const datePart = normalizedTimestamp.slice(0, 10);
  return path.join(resolveLogsDir(options), `${datePart}.app.log`);
}

function matchesFilters(entry: LocalLogEntry, filters: ReadLogEntriesFilters): boolean {
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
  const normalized = normalizeEntry(entry);
  const logsDir = resolveLogsDir(options);

  await mkdir(logsDir, { recursive: true });
  await appendFile(getLogFilePath(normalized.timestamp, options), `${JSON.stringify(normalized)}\n`, "utf8");

  emitDevelopmentConsoleLog(normalized);
  return normalized;
}

export async function readLogEntries(
  filters: ReadLogEntriesFilters = {},
  options?: LocalLogsRuntimeOptions
): Promise<LocalLogEntry[]> {
  const targetDate = normalizeDate(filters.date);
  const logFilePath = path.join(resolveLogsDir(options), `${targetDate}.app.log`);

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
      const normalized = normalizeEntry(parsed);
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
