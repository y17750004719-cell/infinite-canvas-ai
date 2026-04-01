import { appendLogEntry, sanitizeForLog, type LocalLogEntry, type LocalLogSource } from "./local-logs";

type LoggerDefaults = Partial<Pick<LocalLogEntry, "source" | "route" | "pageUrl" | "requestId">> &
  Record<string, unknown>;

type LoggerDetails = Record<string, unknown> | undefined;

function extractTopLevelDefaults(defaults: LoggerDefaults) {
  return {
    source: defaults.source as LocalLogSource | undefined,
    route: typeof defaults.route === "string" ? defaults.route : undefined,
    pageUrl: typeof defaults.pageUrl === "string" ? defaults.pageUrl : undefined,
    requestId: typeof defaults.requestId === "string" ? defaults.requestId : undefined,
  };
}

function extractDefaultDetails(defaults: LoggerDefaults): Record<string, unknown> {
  const nextDetails: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(defaults)) {
    if (key === "source" || key === "route" || key === "pageUrl" || key === "requestId") {
      continue;
    }
    nextDetails[key] = value;
  }

  return nextDetails;
}

function mergeDetails(
  defaultDetails: Record<string, unknown>,
  details?: Record<string, unknown>
): Record<string, unknown> | null {
  const merged = {
    ...defaultDetails,
    ...(details || {}),
  };

  return Object.keys(merged).length > 0 ? merged : null;
}

function buildMethod(
  scope: string,
  level: LocalLogEntry["level"],
  defaults: LoggerDefaults
) {
  const topLevelDefaults = extractTopLevelDefaults(defaults);
  const defaultDetails = extractDefaultDetails(defaults);

  return async (event: string, message: string, details?: LoggerDetails) => {
    return appendLogEntry({
      timestamp: new Date().toISOString(),
      level,
      source: topLevelDefaults.source || "server",
      scope,
      event,
      message,
      details: mergeDetails(defaultDetails, details),
      route: topLevelDefaults.route,
      pageUrl: topLevelDefaults.pageUrl,
      requestId: topLevelDefaults.requestId,
    });
  };
}

export function serializeError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack || null,
      cause: sanitizeForLog(error.cause),
    };
  }

  return {
    value: sanitizeForLog(error),
  };
}

export function createRequestId(prefix = "log"): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function createLogger(scope: string, defaults: LoggerDefaults = {}) {
  return {
    info: buildMethod(scope, "info", defaults),
    warn: buildMethod(scope, "warn", defaults),
    error: buildMethod(scope, "error", defaults),
  };
}
