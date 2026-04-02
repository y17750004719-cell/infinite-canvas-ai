const RESPONSE_HEADER_WHITELIST = [
  'content-type',
  'content-length',
  'x-request-id',
  'x-trace-id',
  'trace-id',
  'cf-ray',
  'openai-request-id',
  'anthropic-request-id',
];

const TRACE_ID_BODY_KEYS = ['request_id', 'requestId', 'trace_id', 'traceId', 'id'];
const BODY_PREVIEW_LIMIT = 2000;

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function getSupplierPayloadString(payload, key) {
  if (!payload || typeof payload !== 'object') {
    return '';
  }

  return normalizeString(payload[key]);
}

function truncatePreview(value, maxLength = BODY_PREVIEW_LIMIT) {
  const normalized = normalizeString(value);
  if (!normalized) {
    return '';
  }

  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength)} [TRUNCATED ${normalized.length - maxLength} chars]`;
}

function getHeaderValue(headers, headerName) {
  if (!headers || typeof headerName !== 'string') {
    return '';
  }

  if (typeof headers.get === 'function') {
    return normalizeString(headers.get(headerName));
  }

  if (typeof headers === 'object') {
    const value = headers[headerName] ?? headers[headerName.toLowerCase()];
    return normalizeString(Array.isArray(value) ? value.join(', ') : value);
  }

  return '';
}

function normalizeContentLength(rawValue) {
  const parsed = Number(rawValue || '0');
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function collectTraceIds(headers, payload) {
  const traceIds = [];
  const push = (value) => {
    const normalized = normalizeString(value);
    if (!normalized || traceIds.includes(normalized)) {
      return;
    }
    traceIds.push(normalized);
  };

  push(getHeaderValue(headers, 'x-request-id'));
  push(getHeaderValue(headers, 'x-trace-id'));
  push(getHeaderValue(headers, 'trace-id'));
  push(getHeaderValue(headers, 'cf-ray'));
  push(getHeaderValue(headers, 'openai-request-id'));
  push(getHeaderValue(headers, 'anthropic-request-id'));

  if (payload && typeof payload === 'object') {
    for (const key of TRACE_ID_BODY_KEYS) {
      push(payload[key]);
    }
  }

  return traceIds;
}

export function createReferencePreview(value, maxLength = 160) {
  const normalized = normalizeString(value);
  if (!normalized) {
    return '';
  }

  if (/^data:/i.test(normalized)) {
    return '[DATA_URL]';
  }

  if (normalized.startsWith('/')) {
    return truncatePreview(normalized.split(/[?#]/, 1)[0], maxLength);
  }

  try {
    const parsedUrl = new URL(normalized);
    return truncatePreview(`${parsedUrl.origin}${parsedUrl.pathname}`, maxLength);
  } catch {
    return truncatePreview(normalized, maxLength);
  }
}

export function getReferenceHost(value) {
  const normalized = normalizeString(value);
  if (!normalized || normalized.startsWith('/')) {
    return '';
  }

  try {
    return new URL(normalized).host;
  } catch {
    return '';
  }
}

export function collectHeaderDiagnostics(headers) {
  const diagnostics = {};

  for (const headerName of RESPONSE_HEADER_WHITELIST) {
    const value = getHeaderValue(headers, headerName);
    if (value) {
      diagnostics[headerName] = value;
    }
  }

  return diagnostics;
}

export function parseSupplierPayload(bodyText, contentType = '') {
  const trimmedBody = normalizeString(bodyText);
  const normalizedContentType = normalizeString(contentType).toLowerCase();
  const shouldTryJson =
    normalizedContentType.includes('json') ||
    trimmedBody.startsWith('{') ||
    trimmedBody.startsWith('[');

  if (!shouldTryJson || !trimmedBody) {
    return {
      ok: false,
      errorStage: 'supplier.parse_error',
      payload: null,
    };
  }

  try {
    const payload = JSON.parse(trimmedBody);
    const imageUrl =
      payload &&
      typeof payload === 'object' &&
      payload.image &&
      typeof payload.image === 'object' &&
      typeof payload.image.url === 'string'
        ? payload.image.url.trim()
        : '';

    if (!imageUrl) {
      return {
        ok: false,
        errorStage: 'supplier.payload_invalid',
        payload,
      };
    }

    return {
      ok: true,
      errorStage: null,
      payload,
    };
  } catch {
    return {
      ok: false,
      errorStage: 'supplier.parse_error',
      payload: null,
    };
  }
}

export function createSupplierResponseDiagnostics({ response, bodyText, payload }) {
  return {
    status: response?.status ?? null,
    statusText: normalizeString(response?.statusText),
    contentType: getHeaderValue(response?.headers, 'content-type'),
    contentLength: normalizeContentLength(getHeaderValue(response?.headers, 'content-length')),
    headerDiagnostics: collectHeaderDiagnostics(response?.headers),
    bodyPreview: truncatePreview(bodyText),
    traceIds: collectTraceIds(response?.headers, payload),
  };
}

export function createDownloadFailureDiagnostics({ fileReference, response, bodyText }) {
  return {
    failedStage: 'download_result',
    fileReferencePreview: createReferencePreview(fileReference),
    host: getReferenceHost(fileReference),
    status: response?.status ?? null,
    statusText: normalizeString(response?.statusText),
    contentType: getHeaderValue(response?.headers, 'content-type'),
    contentLength: normalizeContentLength(getHeaderValue(response?.headers, 'content-length')),
    bodyPreview: truncatePreview(bodyText),
  };
}

export function createSupplierProxyErrorMessage({
  host,
  failedStage,
  payload,
  fallbackMessage,
}) {
  const normalizedStage = normalizeString(failedStage) || 'supplier.error';
  const normalizedHost = normalizeString(host) || 'unknown-host';
  const code = getSupplierPayloadString(payload, 'code');
  const upstreamMessage =
    getSupplierPayloadString(payload, 'message') ||
    getSupplierPayloadString(payload, 'error') ||
    normalizeString(fallbackMessage) ||
    'unknown error';
  const summary = code ? `${code} - ${upstreamMessage}` : upstreamMessage;

  return `COMFLY 抠图代理错误（${normalizedStage} @ ${normalizedHost}）：${summary}`;
}
