const DEFAULT_PRODUCTION_TIMEOUT_MS = 10 * 60 * 1000;

function parseTimeout(value) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : DEFAULT_PRODUCTION_TIMEOUT_MS;
}

export const PRODUCTION_TIMEOUT_MS = parseTimeout(
  process.env.ZFLOW_PRODUCTION_TIMEOUT_MS || process.env.PRODUCTION_TIMEOUT_MS,
);
