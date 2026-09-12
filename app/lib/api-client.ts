import { createLogger } from "./logger";
import {
  buildGeminiNoImageErrorMessage,
  classifyGeminiImagePayload,
  extractGeminiImageOutputs,
  summarizeGeminiImagePayload,
} from "./gemini-image-response.mjs";
import { getGeminiImageSizeEnum, resolveImageRequestModel, resolveOpenAiImageSizeForAspectRatio } from "./image-model-capabilities.mjs";
import { effectiveProviderProtocol, getProviderById, providerEndpointUrl, readProviderRegistry, resolveProviderRequestTargets } from "./provider-config.mjs";
import { resolveConfiguredProviderProtocol } from "./provider-protocol.mjs";
import {
  materializeChatMessageImages,
  readLocalReferenceImage,
  ReferenceImageUnavailableError,
} from "./reference-image-source.mjs";
import { createChatStreamEventDecoder } from "./chat-stream-events.mjs";
import { readOpenAiImageStream } from "./openai-image-stream.mjs";
import { classifyImagePostRetry } from "./image-provider-retry-policy.mjs";
import { PRODUCTION_TIMEOUT_MS } from "./production-timeouts.mjs";
import { assertGeminiSchemaCompatible, toGeminiSchema } from "./gemini-schema.mjs";
import {
  convertChatMessagesToGeminiRequest as convertGeminiMessages,
  extractGeminiTextResponse as extractGeminiResponse,
  geminiChatEndpoint,
  iterateGeminiSsePayloads,
  openGeminiChatStream,
  resolveGeminiFunctionCallingConfig as geminiFunctionCallingConfig,
  validateGeminiContents as validateSharedGeminiContents,
} from "./gemini-chat-transport.mjs";
const LOG_LEVEL = (process.env.LOG_LEVEL || "basic").toLowerCase();
const LOG_ENABLED = LOG_LEVEL !== "off";
const LOG_DEBUG = LOG_LEVEL === "debug";
const apiClientLogger = createLogger("lib.api-client");

function maskToken(token: string): string {
  if (!token) return "<empty>";
  if (token.length <= 8) return "<hidden>";
  return `${token.slice(0, 4)}...${token.slice(-4)}`;
}

function toLogDetails(payload?: unknown): Record<string, unknown> | undefined {
  if (payload === undefined) return undefined;
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    return payload as Record<string, unknown>;
  }
  return { value: payload };
}

function debugLog(message: string, payload?: unknown) {
  if (LOG_DEBUG) {
    void apiClientLogger.info("debug", message, toLogDetails(payload));
  }
}

function basicLog(message: string, payload?: unknown) {
  if (LOG_ENABLED) {
    void apiClientLogger.info("info", message, toLogDetails(payload));
  }
}

function debugWarn(message: string, payload?: unknown) {
  if (LOG_DEBUG) {
    void apiClientLogger.warn("warn", message, toLogDetails(payload));
  }
}

function debugError(message: string, payload?: unknown) {
  if (LOG_ENABLED) {
    const details = toLogDetails(payload);
    const nextDetails =
      details && "error" in details
        ? details
        : details
          ? { ...details }
          : undefined;
    void apiClientLogger.error("error", message, nextDetails);
  }
}

function getErrorDiagnostics(error: unknown) {
  if (!(error instanceof Error)) {
    return {
      errorType: typeof error,
      errorValue: String(error),
    };
  }

  const cause = error.cause as
    | {
        name?: unknown;
        message?: unknown;
        code?: unknown;
        errno?: unknown;
        syscall?: unknown;
        address?: unknown;
        port?: unknown;
      }
    | undefined;

  return {
    errorName: error.name,
    errorMessage: error.message,
    failureClass: error instanceof ImageGenerationError ? error.failureClass || null : null,
    failureCode: error instanceof ImageGenerationError ? error.failureCode || null : null,
    isRetryable: error instanceof ImageGenerationError ? error.isRetryable ?? null : null,
    outcomeUnknown: error instanceof ImageGenerationError ? error.outcomeUnknown ?? null : null,
    causeName: typeof cause?.name === "string" ? cause.name : null,
    causeMessage: typeof cause?.message === "string" ? cause.message : null,
    causeCode: typeof cause?.code === "string" ? cause.code : null,
    causeErrno: typeof cause?.errno === "number" || typeof cause?.errno === "string" ? cause.errno : null,
    causeSyscall: typeof cause?.syscall === "string" ? cause.syscall : null,
    causeAddress: typeof cause?.address === "string" ? cause.address : null,
    causePort: typeof cause?.port === "number" ? cause.port : null,
    stackPreview: error.stack?.split("\n").slice(0, 3).join("\n") || null,
  };
}

function getEndpointHost(endpoint: string): string | null {
  try {
    return new URL(endpoint).host;
  } catch {
    return null;
  }
}

function buildSupplierRequestDiagnostics({
  endpoint,
  requestStartedAt,
  timeoutMs = null,
  attempt = 1,
  maxAttempts = 1,
}: {
  endpoint: string;
  requestStartedAt: number;
  timeoutMs?: number | null;
  attempt?: number;
  maxAttempts?: number;
}) {
  return {
    endpoint,
    host: getEndpointHost(endpoint),
    attempt,
    maxAttempts,
    retryCount: Math.max(0, attempt - 1),
    retriesRemaining: Math.max(0, maxAttempts - attempt),
    elapsedMs: Math.max(0, Date.now() - requestStartedAt),
    timeoutMs,
  };
}

export interface GenerationRequest {
  model: string;
  prompt: string;
  n?: number;
  size?: string;
  aspect_ratio?: string;
  quality?: string;
  response_format?: string;
  reference_images?: string[]; // 参考图base64列表
  executionMode?: "sync" | "async";
  signal?: AbortSignal;
}

export interface EditRequest {
  model: string;
  prompt: string;
  images: string[];
  mask?: string;
  n?: number;
  size?: string;
  aspect_ratio?: string;
  executionMode?: "sync" | "async";
  signal?: AbortSignal;
}

export interface GenerationResponse {
  created: number;
  data: Array<{
    url: string;
    revised_prompt?: string;
  }>;
}

interface AsyncImageTaskResultResponse {
  status?: string;
  message?: string;
  error?: { message?: string } | string;
  last_error?: { message?: string } | string;
  data?: Array<{ url: string; revised_prompt?: string }> | { status?: string; data?: Array<{ url: string; revised_prompt?: string }> };
  result?: {
    status?: string;
    data?: Array<{ url: string; revised_prompt?: string }>;
  };
  output?: {
    status?: string;
    data?: Array<{ url: string; revised_prompt?: string }>;
  };
}

export interface UnifiedImageRequest {
  model: string;
  requestedModel?: string;
  prompt: string;
  providerId?: string;
  images?: string[];
  mask?: string;
  n?: number;
  size?: string;
  aspect_ratio?: string;
  quality?: string;
  response_format?: string;
  executionMode?: "sync" | "async";
  signal?: AbortSignal;
}

export class ImageGenerationError extends Error {
  failureClass?: "transport" | "timeout" | "upstream_http" | "payload" | "unknown";
  failureCode?: "provider_unavailable" | "provider_http" | "provider_timeout" | "provider_result_unknown" | "gemini_payload_unsupported" | "gemini_empty_result" | "transport" | "invalid_tool_arguments" | "provider_protocol_unsupported";
  isRetryable?: boolean;
  retryAttempt?: number;
  outcomeUnknown?: boolean;
  providerId?: string;
  model?: string;
  protocol?: string;
  endpointHost?: string;
  failureStage?: string;

  constructor(
    message: string,
    public statusCode?: number,
    meta?: {
      failureClass?: "transport" | "timeout" | "upstream_http" | "payload" | "unknown";
      failureCode?: "provider_unavailable" | "provider_http" | "provider_timeout" | "provider_result_unknown" | "gemini_payload_unsupported" | "gemini_empty_result" | "transport" | "invalid_tool_arguments" | "provider_protocol_unsupported";
      isRetryable?: boolean;
      retryAttempt?: number;
      outcomeUnknown?: boolean;
      providerId?: string;
      model?: string;
      protocol?: string;
      endpointHost?: string;
      failureStage?: string;
    }
  ) {
    super(message);
    this.name = "ImageGenerationError";
    this.failureClass = meta?.failureClass;
    this.failureCode = meta?.failureCode;
    this.isRetryable = meta?.isRetryable;
    this.retryAttempt = meta?.retryAttempt;
    this.outcomeUnknown = meta?.outcomeUnknown;
    this.providerId = meta?.providerId;
    this.model = meta?.model;
    this.protocol = meta?.protocol;
    this.endpointHost = meta?.endpointHost;
    this.failureStage = meta?.failureStage;
  }
}

function parseErrorPayload(errorText: string): Record<string, unknown> {
  try {
    return JSON.parse(errorText) as Record<string, unknown>;
  } catch {
    return {};
  }
}

const SUPPLIER_ALLOWED_ASPECT_RATIOS = new Set([
  "1:1",
  "1:4",
  "1:8",
  "2:3",
  "3:2",
  "3:4",
  "4:1",
  "4:3",
  "4:5",
  "5:4",
  "8:1",
  "9:16",
  "16:9",
  "21:9",
]);

function gcd(a: number, b: number): number {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y !== 0) {
    const t = y;
    y = x % y;
    x = t;
  }
  return x || 1;
}

function toAspectRatio(size?: string): string {
  const raw = typeof size === "string" ? size.trim() : "";
  if (!raw) return "1:1";
  const match = raw.match(/^(\d+)x(\d+)$/i);
  if (!match) return "1:1";
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return "1:1";
  }
  const divisor = gcd(width, height);
  const ratio = `${width / divisor}:${height / divisor}`;
  return SUPPLIER_ALLOWED_ASPECT_RATIOS.has(ratio) ? ratio : "1:1";
}

function normalizeAspectRatio(input?: string): string {
  const raw = typeof input === "string" ? input.trim() : "";
  if (!raw) return "";
  return SUPPLIER_ALLOWED_ASPECT_RATIOS.has(raw) ? raw : "";
}

function getGeminiOfficialApiBaseUrl(providerTargets: ReturnType<typeof resolveProviderRequestTargets>): string {
  return providerTargets.geminiBaseUrl;
}

function getOpenAiCompatibleImageApiBaseUrl(providerTargets: ReturnType<typeof resolveProviderRequestTargets>): string {
  return providerTargets.openAiBaseUrl;
}

function bearerAuthorizationHeader(apiKey: string): string {
  const token = apiKey.replace(/^Bearer\s+/i, "").trim();
  return token ? `Bearer ${token}` : "";
}

function resolveProviderApiKey({
  provider,
  purpose,
  protocol,
}: {
  provider: { apiKey?: string; imageApiKeys?: Array<{ apiKey?: string; scope?: string }> };
  purpose: "chat" | "image" | "image_task";
  protocol?: "openai" | "responses" | "gemini";
}): string {
  if (purpose === "chat") {
    return provider.apiKey || "";
  }

  const imageApiKeys = Array.isArray(provider.imageApiKeys) ? provider.imageApiKeys : [];
  for (const imageApiKey of imageApiKeys) {
    if (!imageApiKey?.apiKey) {
      continue;
    }
    if (imageApiKey.scope === "all") {
      return imageApiKey.apiKey;
    }
    if (imageApiKey.scope === "gemini" && protocol === "gemini") {
      return imageApiKey.apiKey;
    }
    if (imageApiKey.scope === "gpt" && (protocol === "openai" || protocol === "responses")) {
      return imageApiKey.apiKey;
    }
  }
  return provider.apiKey || "";
}

async function getProviderTransport({
  providerId,
  model,
  purpose = "chat",
}: {
  providerId?: string;
  model?: string;
  purpose?: "chat" | "image" | "image_task";
} = {}) {
  const providerRegistry = await readProviderRegistry();
  const provider = getProviderById(providerRegistry.providers, providerId);
  if (!provider) {
    throw new ImageGenerationError("No enabled image provider is configured", 400, {
      failureCode: "provider_unavailable", failureStage: "provider_selection", isRetryable: false,
    });
  }
  if (provider.enabled === false) {
    throw new ImageGenerationError(`Image provider "${provider.id}" is disabled`, 400, {
      failureCode: "provider_unavailable", failureStage: "provider_selection", isRetryable: false,
      providerId: provider.id, model,
    });
  }
  if (purpose !== "chat" && (!Array.isArray(provider.imageModels) || !provider.imageModels.includes(String(model || "")))) {
    throw new ImageGenerationError(`Image model "${model || ""}" is not enabled for provider "${provider.id}"`, 400, {
      failureCode: "provider_unavailable", failureStage: "provider_selection", isRetryable: false,
      providerId: provider.id, model,
    });
  }
  const providerTargets = resolveProviderRequestTargets(provider.baseUrl);
  const configuredProtocol = resolveConfiguredProviderProtocol(provider, model);
  if (purpose !== "chat" && !configuredProtocol) {
    throw new ImageGenerationError(`Unsupported image provider protocol for ${provider.id}/${model || ""}`, 400, {
      failureCode: "provider_protocol_unsupported",
      failureStage: "provider_selection",
      isRetryable: false,
      providerId: provider.id,
      model,
    });
  }
  const protocol = configuredProtocol || effectiveProviderProtocol(provider, model);
  const transportProvider = { ...provider, protocol };
  const apiKey = resolveProviderApiKey({
    provider,
    purpose,
    protocol,
  });
  const headers = protocol === "gemini"
    ? {
        Accept: "application/json",
        "x-goog-api-key": apiKey,
      }
    : {
        Accept: "application/json",
        Authorization: bearerAuthorizationHeader(apiKey),
        ...(provider.id === "xiaomi" ? { "X-Mimo-Source": "mimocode-cli" } : {}),
      };
  const chatBaseUrl = protocol === "gemini"
    ? providerTargets.geminiBaseUrl
    : providerTargets.openAiBaseUrl;
  const imageGenerationUrl = providerEndpointUrl(transportProvider, "imageGenerationEndpoint", "/v1/images/generations");
  const imageEditUrl = providerEndpointUrl(transportProvider, "imageEditEndpoint", "/v1/images/edits");
  const taskBaseUrl = getOpenAiCompatibleImageApiBaseUrl(providerTargets);

  return {
    providerRegistry,
    provider: transportProvider,
    endpointHost: (() => { try { return new URL(imageGenerationUrl).host; } catch { return null; } })(),
    providerTargets,
    apiKey,
    protocol,
    headers,
    chatBaseUrl,
    imageGenerationUrl,
    imageEditUrl,
    taskBaseUrl,
    purpose,
  };
}

function normalizeImageModelKey(model?: string): string {
  return typeof model === "string" ? model.trim() : "";
}

function normalizeImageRequestModel(model?: string): string {
  const normalizedModel = normalizeImageModelKey(model);
  return normalizedModel;
}

export function shouldUseImageEditsApi(_model?: string, referenceImageCount = 0): boolean {
  return referenceImageCount > 0;
}

function resolveGeminiOfficialImageSize(size?: string): "1K" | "2K" | "4K" {
  const raw = typeof size === "string" ? size.trim() : "";
  if (raw === "1024x1024" || raw === "2048x2048" || raw === "4096x4096") {
    return getGeminiImageSizeEnum(raw) as "1K" | "2K" | "4K";
  }
  const match = raw.match(/^(\d+)x(\d+)$/i);
  if (!match) {
    return "1K";
  }

  const width = Number(match[1]);
  const height = Number(match[2]);
  const longestEdge = Math.max(width, height);

  if (longestEdge >= 4096) {
    return "4K";
  }
  if (longestEdge >= 2048) {
    return "2K";
  }
  return "1K";
}

function classifyGeminiImageTransportFailure(error: unknown): {
  failureClass: "transport" | "timeout" | "upstream_http" | "payload" | "unknown";
  isRetryable: boolean;
  failureCode?: "provider_result_unknown";
  outcomeUnknown?: boolean;
} {
  if (error instanceof ImageGenerationError) {
    return {
      failureClass: error.failureClass || (error.statusCode && error.statusCode >= 400 ? "upstream_http" : "unknown"),
      isRetryable: Boolean(error.isRetryable),
      failureCode: error.failureCode === "provider_result_unknown" ? error.failureCode : undefined,
      outcomeUnknown: error.outcomeUnknown,
    };
  }

  if (error instanceof Error && error.name === "AbortError") {
    const policy = classifyImagePostRetry({ kind: "timeout" });
    return {
      failureClass: "timeout",
      isRetryable: policy.retry,
      failureCode: policy.failureCode === "provider_result_unknown" ? policy.failureCode : undefined,
      outcomeUnknown: policy.outcomeUnknown,
    };
  }

  const cause = error instanceof Error ? (error.cause as { code?: unknown; message?: unknown } | undefined) : undefined;
  const causeCode = typeof cause?.code === "string" ? cause.code : "";
  const causeMessage = typeof cause?.message === "string" ? cause.message.toLowerCase() : "";
  const errorMessage = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();

  if (
    errorMessage === "fetch failed" &&
    (
      causeCode === "UND_ERR_SOCKET" ||
      causeCode === "ECONNRESET" ||
      causeCode === "EPIPE" ||
      causeCode === "ETIMEDOUT" ||
      causeCode === "UND_ERR_CONNECT_TIMEOUT" ||
      causeCode === "UND_ERR_HEADERS_TIMEOUT" ||
      causeCode === "UND_ERR_BODY_TIMEOUT" ||
      causeMessage?.includes("other side closed") ||
      causeMessage?.includes("client network socket disconnected before secure tls connection was established")
    )
  ) {
    const policy = classifyImagePostRetry({ kind: "transport" });
    return {
      failureClass: "transport",
      isRetryable: policy.retry,
      failureCode: policy.failureCode === "provider_result_unknown" ? policy.failureCode : undefined,
      outcomeUnknown: policy.outcomeUnknown,
    };
  }

  return {
    failureClass: "unknown",
    isRetryable: false,
  };
}

function classifyImageProviderHttpFailure(status: number, errorText: string): {
  failureClass: "upstream_http";
  failureCode: "provider_unavailable" | "provider_http" | "invalid_tool_arguments";
  isRetryable: boolean;
} {
  const normalized = errorText.toLowerCase();
  if (normalized.includes('no enabled channel for model') || normalized.includes('no available compatible accounts')) {
    return { failureClass: "upstream_http", failureCode: "provider_unavailable", isRetryable: false };
  }
  if (status === 400 || status === 422) {
    return { failureClass: "upstream_http", failureCode: "invalid_tool_arguments", isRetryable: false };
  }
  return {
    failureClass: "upstream_http",
    failureCode: "provider_http",
    isRetryable: status === 502 || status === 503 || status === 504,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sleepWithAbort(ms: number, signal?: AbortSignal): Promise<void> {
  if (!signal) return sleep(ms);
  if (signal.aborted) {
    throw new ImageGenerationError("Request cancelled by user", 499);
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);

    const onAbort = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      reject(new ImageGenerationError("Request cancelled by user", 499));
    };

    signal.addEventListener("abort", onAbort);
  });
}

function parsePositiveInt(input: string | undefined, fallback: number): number {
  if (!input) return fallback;
  const value = Number.parseInt(input, 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

const asyncImageSubmitTimeoutMs = parsePositiveInt(process.env.COMFLY_ASYNC_IMAGE_SUBMIT_TIMEOUT_MS, PRODUCTION_TIMEOUT_MS);
const asyncImagePollTimeoutMs = parsePositiveInt(process.env.COMFLY_ASYNC_POLL_TIMEOUT_MS, PRODUCTION_TIMEOUT_MS);
const asyncImagePollIntervalMs = parsePositiveInt(process.env.COMFLY_ASYNC_POLL_INTERVAL_MS, 2000);
const IMAGE_TASK_SUCCESS_STATUSES = new Set(["SUCCESS", "SUCCESSFUL", "SUCCEED", "SUCCEEDED", "COMPLETED", "COMPLETE", "DONE", "FINISHED", "OK", "READY"]);
const IMAGE_TASK_FAILURE_STATUSES = new Set(["FAILURE", "FAILED", "FAIL", "ERROR", "ERRORED", "CANCELLED", "CANCELED", "TIMEOUT", "TIMED_OUT", "REJECTED", "EXPIRED"]);

function extractTaskStatus(payload: AsyncImageTaskResultResponse): string {
  const rootStatus = typeof payload.status === "string" ? payload.status : "";
  const nestedDataStatus =
    payload.data && !Array.isArray(payload.data) && typeof payload.data.status === "string"
      ? payload.data.status
      : "";
  const nestedResultStatus =
    payload.result && typeof (payload.result as { status?: unknown }).status === "string"
      ? ((payload.result as { status?: string }).status || "")
      : "";
  const nestedOutputStatus =
    payload.output && typeof (payload.output as { status?: unknown }).status === "string"
      ? ((payload.output as { status?: string }).status || "")
      : "";

  return (rootStatus || nestedDataStatus || nestedResultStatus || nestedOutputStatus).trim().toUpperCase();
}

function extractOptionalTaskId(input: unknown, depth = 0): string | null {
  if (depth > 4 || !input || typeof input !== "object") {
    return null;
  }

  if (Array.isArray(input)) {
    for (const item of input) {
      const taskId = extractOptionalTaskId(item, depth + 1);
      if (taskId) return taskId;
    }
    return null;
  }

  const payload = input as Record<string, unknown>;
  for (const key of ["task_id", "taskId", "submit_id", "video_id", "videoId"]) {
    const value = payload[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  const id = payload.id;
  if (typeof id === "string" && id.trim().toLowerCase().startsWith("task")) {
    return id.trim();
  }

  return extractOptionalTaskId(payload.data, depth + 1);
}

function extractTaskErrorMessage(payload: AsyncImageTaskResultResponse): string | undefined {
  const directError =
    typeof payload.error === "object" && payload.error && "message" in payload.error
      ? (payload.error as { message?: string }).message
      : typeof payload.error === "string"
        ? payload.error
        : undefined;
  const lastError =
    typeof payload.last_error === "object" && payload.last_error && "message" in payload.last_error
      ? (payload.last_error as { message?: string }).message
      : typeof payload.last_error === "string"
        ? payload.last_error
        : undefined;

  return directError || lastError || payload.message || undefined;
}

const IMAGE_ENTRY_URL_KEYS = [
  "url",
  "image_url",
  "imageUrl",
  "image",
  "file_url",
  "fileUrl",
  "output_url",
  "outputUrl",
  "result_url",
  "resultUrl",
  "download_url",
  "downloadUrl",
  "asset_url",
  "assetUrl",
] as const;

const IMAGE_ENTRY_NESTED_KEYS = [
  "data",
  "result",
  "results",
  "output",
  "outputs",
  "image",
  "images",
  "urls",
  "items",
  "files",
  "candidates",
  "content",
  "parts",
  "inlineData",
  "inline_data",
] as const;

const IMAGE_ENTRY_BASE64_KEYS = ["b64_json", "base64", "image_base64", "imageBase64"] as const;

function normalizeImageEntryUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (
    trimmed.startsWith("http://") ||
    trimmed.startsWith("https://") ||
    trimmed.startsWith("data:image/") ||
    trimmed.startsWith("/assets/") ||
    trimmed.startsWith("/output/")
  ) {
    return trimmed;
  }
  return null;
}

function buildBase64ImageDataUrl(base64Value: unknown, mimeTypeValue?: unknown): string | null {
  const obj = { b64_json: base64Value };
  const hasBase64Json = typeof obj.b64_json === "string" && obj.b64_json.trim().length > 0;
  if (!hasBase64Json) return null;
  const b64Json = typeof obj.b64_json === "string" ? obj.b64_json : "";
  const normalizedBase64 = b64Json.trim();
  const normalizedMimeType = typeof mimeTypeValue === "string" && mimeTypeValue.trim()
    ? mimeTypeValue.trim().toLowerCase()
    : "image/png";

  if (normalizedMimeType.includes("jpeg") || normalizedMimeType.includes("jpg")) {
    return `data:image/jpeg;base64,${normalizedBase64}`;
  }
  if (normalizedMimeType.includes("webp")) {
    return `data:image/webp;base64,${normalizedBase64}`;
  }
  if (normalizedMimeType.includes("gif")) {
    return `data:image/gif;base64,${normalizedBase64}`;
  }
  return `data:image/png;base64,${normalizedBase64}`;
}

function imageEntryBase64DataUrl(obj: Record<string, unknown>): string | null {
  for (const key of IMAGE_ENTRY_BASE64_KEYS) {
    const parsed = buildBase64ImageDataUrl(obj[key], obj.mime_type ?? obj.mimeType);
    if (parsed) return parsed;
  }
  if ((typeof obj.mime_type === "string" || typeof obj.mimeType === "string") && typeof obj.data === "string") {
    return buildBase64ImageDataUrl(obj.data, obj.mime_type ?? obj.mimeType);
  }
  if (obj.type === "image_generation_call") {
    return buildBase64ImageDataUrl(obj.result, obj.mime_type ?? obj.mimeType);
  }
  return null;
}

function imagesApiUnsupportedText(text: string): boolean {
  const normalized = text.toLowerCase();
  return normalized.includes("images api is not supported") || normalized.includes("not supported for this platform");
}

function imageStreamUnsupportedText(text: string): boolean {
  const normalized = text.toLowerCase();
  return /partial[ _-]?images?|stream|event-stream|sse/.test(normalized);
}

function summarizePayloadKeys(payload: unknown, depth = 0): unknown {
  if (depth > 2 || payload == null) return null;
  if (Array.isArray(payload)) {
    return payload.slice(0, 5).map((item) => summarizePayloadKeys(item, depth + 1));
  }
  if (typeof payload === "object") {
    return Object.fromEntries(
      Object.entries(payload as Record<string, unknown>)
        .slice(0, 12)
        .map(([key, value]) => {
          if (value == null) return [key, null];
          if (Array.isArray(value)) return [key, `array(${value.length})`];
          if (typeof value === "object") return [key, summarizePayloadKeys(value, depth + 1)];
          return [key, typeof value];
        })
    );
  }
  return typeof payload;
}

function toImageEntries(input: unknown, depth = 0): Array<{ url: string; revised_prompt?: string }> {
  if (depth > 4 || input == null) return [];

  if (typeof input === "string") {
    const normalizedUrl = normalizeImageEntryUrl(input);
    if (normalizedUrl) {
      return [{ url: normalizedUrl }];
    }
    const trimmed = input.trim();
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      try {
        return toImageEntries(JSON.parse(trimmed), depth + 1);
      } catch {
        return [];
      }
    }
    return [];
  }

  if (Array.isArray(input)) {
    const direct = input
      .map((item) => {
        if (!item || typeof item !== "object") return null;
        const obj = item as Record<string, unknown>;
        const directUrl =
          IMAGE_ENTRY_URL_KEYS.map((key) => normalizeImageEntryUrl(obj[key])).find(Boolean) || null;
        const b64DataUrl = imageEntryBase64DataUrl(obj);
        if (!directUrl && !b64DataUrl) return null;
        return {
          url: directUrl || b64DataUrl!,
          revised_prompt: typeof obj.revised_prompt === "string" ? obj.revised_prompt : undefined,
        };
      })
      .filter(Boolean) as Array<{ url: string; revised_prompt?: string }>;
    if (direct.length > 0) return direct;

    const nested: Array<{ url: string; revised_prompt?: string }> = [];
    for (const item of input) {
      for (const entry of toImageEntries(item, depth + 1)) {
        nested.push(entry);
      }
    }
    return nested;
  }

  if (typeof input === "object") {
    const obj = input as Record<string, unknown>;

    const directUrl =
      IMAGE_ENTRY_URL_KEYS.map((key) => normalizeImageEntryUrl(obj[key])).find(Boolean) || null;
    if (directUrl) {
      return [{
        url: directUrl,
        revised_prompt: typeof obj.revised_prompt === "string" ? obj.revised_prompt : undefined,
      }];
    }

    const b64DataUrl = imageEntryBase64DataUrl(obj);
    if (b64DataUrl) {
      return [{
        url: b64DataUrl,
        revised_prompt: typeof obj.revised_prompt === "string" ? obj.revised_prompt : undefined,
      }];
    }

    for (const key of IMAGE_ENTRY_NESTED_KEYS) {
      if (key in obj) {
        const parsed = toImageEntries(obj[key], depth + 1);
        if (parsed.length > 0) return parsed;
      }
    }
  }

  return [];
}

function getArrayLength(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}

function summarizeImagePayloadCounts(payload: unknown): {
  rawDataCount: number;
  nestedDataCount: number;
  resultDataCount: number;
  outputDataCount: number;
  extractedCount: number;
} {
  if (!payload || typeof payload !== "object") {
    return {
      rawDataCount: 0,
      nestedDataCount: 0,
      resultDataCount: 0,
      outputDataCount: 0,
      extractedCount: 0,
    };
  }

  const record = payload as Record<string, unknown>;
  const nestedData =
    record.data && !Array.isArray(record.data) && typeof record.data === "object"
      ? (record.data as Record<string, unknown>).data
      : undefined;
  const resultData =
    record.result && typeof record.result === "object"
      ? (record.result as Record<string, unknown>).data
      : undefined;
  const outputData =
    record.output && typeof record.output === "object"
      ? (record.output as Record<string, unknown>).data
      : undefined;

  return {
    rawDataCount: getArrayLength(record.data),
    nestedDataCount: getArrayLength(nestedData),
    resultDataCount: getArrayLength(resultData),
    outputDataCount: getArrayLength(outputData),
    extractedCount: toImageEntries(payload).length,
  };
}

function dataUrlToBlob(dataUrl: string): { blob: Blob; mimeType: string } {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) {
    throw new ReferenceImageUnavailableError("Reference image data URL is invalid");
  }
  const mimeType = match[1] || "image/png";
  const base64 = match[2];
  const bytes = Buffer.from(base64, "base64");
  const byteArray = new Uint8Array(bytes);
  return {
    blob: new Blob([byteArray], { type: mimeType }),
    mimeType,
  };
}

function mimeTypeToFileExtension(mimeType?: string): string {
  const normalizedMimeType = typeof mimeType === "string" ? mimeType.toLowerCase().trim() : "";
  if (normalizedMimeType.includes("jpeg")) return "jpg";
  if (normalizedMimeType.includes("webp")) return "webp";
  if (normalizedMimeType.includes("gif")) return "gif";
  return "png";
}

async function referenceToBlob(input: string, signal?: AbortSignal): Promise<{ blob: Blob; mimeType: string }> {
  if (input.startsWith("data:image/")) {
    return dataUrlToBlob(input);
  }

  if (input.startsWith("/")) {
    const { bytes, mimeType } = await readLocalReferenceImage(input);
    return {
      blob: new Blob([new Uint8Array(bytes)], { type: mimeType }),
      mimeType,
    };
  }

  if (!input.startsWith("http://") && !input.startsWith("https://")) {
    throw new ReferenceImageUnavailableError("Reference image URL is invalid");
  }

  try {
    const response = await fetch(input, { signal });
    if (!response.ok) {
      throw new ImageGenerationError(`Failed to fetch reference image: ${response.status} ${response.statusText}`, response.status);
    }
    const blob = await response.blob();
    return {
      blob,
      mimeType: blob.type || "image/png",
    };
  } catch (error) {
    basicLog("[SUPPLIER][REFERENCE_ERR]", {
      referenceType: input.startsWith("https://") ? "https" : "http",
      ...getErrorDiagnostics(error),
    });
    throw error;
  }
}

async function blobToBase64(blob: Blob): Promise<string> {
  const arrayBuffer = await blob.arrayBuffer();
  return Buffer.from(arrayBuffer).toString("base64");
}

async function referenceToInlineData(
  input: string,
  signal?: AbortSignal
): Promise<{ inlineData: { mimeType: string; data: string } }> {
  const { blob, mimeType } = await referenceToBlob(input, signal);
  if (!mimeType.toLowerCase().startsWith("image/")) {
    throw new ReferenceImageUnavailableError("Reference image MIME type is invalid");
  }
  const data = await blobToBase64(blob);
  if (!data) {
    throw new ReferenceImageUnavailableError("Reference image is empty");
  }
  return {
    inlineData: {
      mimeType,
      data,
    },
  };
}

async function generateGeminiOfficialImage(request: UnifiedImageRequest): Promise<GenerationResponse> {
  const requestedModel = request.requestedModel || request.model;
  const { provider, providerTargets, apiKey, headers } = await getProviderTransport({
    providerId: request.providerId,
    model: requestedModel,
    purpose: "image",
  });
  if (!apiKey) {
    throw new ImageGenerationError("Please configure a supplier API Key in settings or environment");
  }

  const model = normalizeImageRequestModel(requestedModel);
  const capabilityModelId = model;
  const resolvedRequestModel = resolveImageRequestModel(model, request.size);
  const endpoint = `${getGeminiOfficialApiBaseUrl(providerTargets)}/v1beta/models/${resolvedRequestModel}:generateContent`;
  const aspectRatio = normalizeAspectRatio(request.aspect_ratio) || toAspectRatio(request.size);
  const imageSize = resolveGeminiOfficialImageSize(request.size);
  const prompt = typeof request.prompt === "string" ? request.prompt : "";
  const referenceImages = Array.isArray(request.images) ? request.images.filter(Boolean) : [];
  const referenceParts = await Promise.all(referenceImages.map((image) => referenceToInlineData(image, request.signal)));
  const parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [
    { text: prompt },
    ...referenceParts,
  ];
  const imageConfig: Record<string, string> = {};
  imageConfig.aspectRatio = aspectRatio;
  imageConfig.imageSize = imageSize;

  const requestBody = {
    contents: [
      {
        role: "user",
        parts,
      },
    ],
    generationConfig: {
      responseModalities: ["TEXT", "IMAGE"],
      imageConfig,
    },
  };
  validateGeminiContents(requestBody.contents);
  basicLog("[SUPPLIER][GEMINI_PARTS]", {
    mode: "gemini_official_image",
    contents: summarizeGeminiContents(requestBody.contents),
  });

  basicLog("[SUPPLIER][PREP]", {
    endpointBase: getGeminiOfficialApiBaseUrl(providerTargets),
    endpoint: `/v1beta/models/${resolvedRequestModel}:generateContent`,
    mode: "gemini_official_image",
    protocol: provider.protocol,
    requestedModel,
    normalizedModel: model,
    capabilityModelId,
    resolvedRequestModel: resolvedRequestModel,
    imageSize,
    aspectRatio,
    n: request.n || 1,
    referenceCount: referenceImages.length,
    executionMode: request.executionMode === "async" ? "async" : "sync",
    providerId: provider.id,
    apiKeyMasked: maskToken(apiKey),
  });
  debugLog("[SUPPLIER][PREP_PROMPT]", {
    promptPreview: prompt.slice(0, 200),
  });

  const timeoutMs = PRODUCTION_TIMEOUT_MS;
  const maxAttempts = 2;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const controller = new AbortController();
    const onRequestAbort = () => controller.abort(request.signal?.reason);
    if (request.signal?.aborted) {
      onRequestAbort();
    } else {
      request.signal?.addEventListener("abort", onRequestAbort, { once: true });
    }
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    let requestStartedAt = Date.now();

    try {
      requestStartedAt = Date.now();
      basicLog("[SUPPLIER][REQ]", {
        method: "POST",
        endpoint,
        host: getEndpointHost(endpoint),
        mode: "gemini_official_image",
        protocol: provider.protocol,
        requestedModel,
        normalizedModel: model,
        attempt,
        maxAttempts,
      });

      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...headers,
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });

      basicLog("[SUPPLIER][RES]", {
        method: "POST",
        endpoint,
        mode: "gemini_official_image",
        status: response.status,
        statusText: response.statusText,
        durationMs: Date.now() - requestStartedAt,
      });

      if (!response.ok) {
        const errorText = await response.text();
        const failure = classifyImageProviderHttpFailure(response.status, errorText || response.statusText);
        throw new ImageGenerationError(
          `Gemini official image request failed: ${errorText || response.statusText}`,
          response.status,
          {
            ...failure,
            retryAttempt: attempt,
          }
        );
      }

      const payload = await response.json();
      const outputs = extractGeminiImageOutputs(payload);
      const payloadSummary = summarizeGeminiImagePayload(payload);

      basicLog("[SUPPLIER][PARSE]", {
        endpoint: `/v1beta/models/${resolvedRequestModel}:generateContent`,
        mode: "gemini_official_image",
        executionMode: request.executionMode === "async" ? "async" : "sync",
        imageCount: outputs.length,
        imageSize,
        aspectRatio,
      });

      if (outputs.length === 0) {
        const classification = classifyGeminiImagePayload(payloadSummary);
        basicLog("[SUPPLIER][PARSE_EMPTY]", {
          endpoint: `/v1beta/models/${resolvedRequestModel}:generateContent`,
          executionMode: request.executionMode === "async" ? "async" : "sync",
          imageSize,
          aspectRatio,
          classification,
          candidateCount: payloadSummary.candidateCount,
          finishReasons: payloadSummary.finishReasons,
          promptBlockReason: payloadSummary.promptBlockReason,
          promptSafetyRatings: payloadSummary.promptSafetyRatings,
          candidateSafetyRatings: payloadSummary.candidateSafetyRatings,
          partTypes: payloadSummary.partTypes,
          topLevelKeys: payloadSummary.topLevelKeys,
          hasInlineData: payloadSummary.hasInlineData,
          hasText: payloadSummary.hasText,
          textPreview: payloadSummary.textPreview,
          responseId: payloadSummary.responseId,
          modelVersion: payloadSummary.modelVersion,
          usageMetadata: payloadSummary.usageMetadata,
          rawPayloadPreview: payloadSummary.rawPayloadPreview,
        });
        throw new ImageGenerationError(buildGeminiNoImageErrorMessage(classification), 502, {
          failureClass: "payload",
          failureCode: classification === "unsupported_payload_shape" ? "gemini_payload_unsupported" : "gemini_empty_result",
          isRetryable: false,
          retryAttempt: attempt,
          outcomeUnknown: true,
        });
      }

      return {
        created: Math.floor(Date.now() / 1000),
        data: outputs,
      };
    } catch (error) {
      const failureState = classifyGeminiImageTransportFailure(error);

      basicLog("[SUPPLIER][ERR]", {
        endpoint: `/v1beta/models/${resolvedRequestModel}:generateContent`,
        mode: "gemini_official_image",
        requestedModel,
        normalizedModel: model,
        resolvedRequestModel: resolvedRequestModel,
        imageSize,
        aspectRatio,
        referenceCount: referenceImages.length,
        failureClass: failureState.failureClass,
        failureCode: failureState.failureCode || null,
        outcomeUnknown: failureState.outcomeUnknown || false,
        isRetryable: failureState.isRetryable,
        retryAttempt: attempt,
        requestSize: request.size || null,
        requestCount: request.n || 1,
        ...buildSupplierRequestDiagnostics({
          endpoint,
          requestStartedAt,
          timeoutMs,
          attempt,
          maxAttempts,
        }),
        ...getErrorDiagnostics(error),
      });
      debugError("[SUPPLIER][ERR]", {
        endpoint: `/v1beta/models/${resolvedRequestModel}:generateContent`,
        mode: "gemini_official_image",
        requestedModel,
        normalizedModel: model,
        resolvedRequestModel: resolvedRequestModel,
        imageSize,
        aspectRatio,
        referenceCount: referenceImages.length,
        failureClass: failureState.failureClass,
        isRetryable: failureState.isRetryable,
        retryAttempt: attempt,
        requestSize: request.size || null,
        requestCount: request.n || 1,
        ...buildSupplierRequestDiagnostics({
          endpoint,
          requestStartedAt,
          timeoutMs,
          attempt,
          maxAttempts,
        }),
        ...getErrorDiagnostics(error),
      });

      if (failureState.isRetryable && attempt < maxAttempts && !request.signal?.aborted) {
        debugWarn("Retrying retryable Gemini image transport failure", {
          endpoint,
          mode: "gemini_official_image",
          retryAttempt: attempt,
          nextRetryAttempt: attempt + 1,
          requestSize: request.size || null,
          requestCount: request.n || 1,
          failureClass: failureState.failureClass,
        });
        clearTimeout(timeoutId);
        await sleep(350);
        continue;
      }

      clearTimeout(timeoutId);

      if (request.signal?.aborted) {
        throw new ImageGenerationError("Gemini official image request cancelled", 499, {
          failureClass: "transport",
          isRetryable: false,
          retryAttempt: attempt,
        });
      }
      if (error instanceof Error && error.name === "AbortError") {
        throw new ImageGenerationError("Gemini official image request timed out", 504, {
          failureClass: "timeout",
          failureCode: "provider_result_unknown",
          isRetryable: false,
          retryAttempt: attempt,
          outcomeUnknown: true,
        });
      }
      if (error instanceof ImageGenerationError) {
        if (!error.failureClass) {
          error.failureClass = failureState.failureClass;
        }
        if (typeof error.isRetryable !== "boolean") {
          error.isRetryable = failureState.isRetryable;
        }
        if (typeof error.retryAttempt !== "number") {
          error.retryAttempt = attempt;
        }
        if (!error.failureCode && failureState.failureCode) {
          error.failureCode = failureState.failureCode;
        }
        if (typeof error.outcomeUnknown !== "boolean") {
          error.outcomeUnknown = failureState.outcomeUnknown;
        }
        throw error;
      }
      throw new ImageGenerationError(
        error instanceof Error ? `Gemini official image request failed: ${error.message}` : "Gemini official image request failed",
        502,
        {
          failureClass: failureState.failureClass,
          failureCode: failureState.failureCode,
          isRetryable: failureState.isRetryable,
          retryAttempt: attempt,
          outcomeUnknown: failureState.outcomeUnknown,
        }
      );
    } finally {
      clearTimeout(timeoutId);
      request.signal?.removeEventListener("abort", onRequestAbort);
    }
  }

  throw new ImageGenerationError("Gemini official image request failed", 502, {
    failureClass: "unknown",
    isRetryable: false,
    retryAttempt: maxAttempts,
  });
}

async function generateOpenAiCompatibleImage(request: UnifiedImageRequest): Promise<GenerationResponse> {
  const requestedModel = request.requestedModel || request.model;
  const { provider, providerTargets, apiKey, imageGenerationUrl, imageEditUrl, taskBaseUrl } = await getProviderTransport({
    providerId: request.providerId,
    model: requestedModel,
    purpose: "image",
  });
  if (!apiKey) {
    throw new ImageGenerationError("Please configure a supplier API Key in settings or environment");
  }

  const model = normalizeImageRequestModel(request.model);
  if (!model) {
    throw new ImageGenerationError("OpenAI compatible image request requires a model", 400, {
      failureClass: "payload",
      failureCode: "provider_unavailable",
      isRetryable: false,
    });
  }

  const prompt = typeof request.prompt === "string" ? request.prompt : "";
  const referenceImages = Array.isArray(request.images) ? request.images.filter(Boolean) : [];
  const usesImageEditsApi = provider.imageRequestMode === "openai-json"
    ? false
    : shouldUseImageEditsApi(model, referenceImages.length);
  const mirrorsInfiniteCanvasTextToImage =
    provider.imageRequestMode === "openai" && referenceImages.length === 0;
  const requestedExecutionMode = request.executionMode === "async" ? "async" : "sync";
  const executionMode = (mirrorsInfiniteCanvasTextToImage || usesImageEditsApi) ? "sync" : requestedExecutionMode;
  const endpointPath = usesImageEditsApi ? "/images/edits" : "/images/generations";
  const baseEndpoint = usesImageEditsApi ? imageEditUrl : imageGenerationUrl;
  const endpoint = baseEndpoint;
  const requestedAspectRatio = normalizeAspectRatio(request.aspect_ratio) || toAspectRatio(request.size);
  const imageSize = typeof request.size === "string" && request.size.trim()
    ? resolveOpenAiImageSizeForAspectRatio(request.size, requestedAspectRatio)
    : null;
  const requestedImageQuality = typeof request.quality === "string" ? request.quality.trim().toLowerCase() : "";
  const imageQuality = ["low", "medium", "high"].includes(requestedImageQuality) ? requestedImageQuality : null;
  const shouldSendTopLevelResponseFormat = !usesImageEditsApi && provider.imageRequestMode !== "openai-json" && !mirrorsInfiniteCanvasTextToImage;
  const defaultOpenAiImageResponseFormat = { response_format: "url" };
  const maxAttempts = 2;
  const shouldRequestImageStream = provider.imageRequestMode === "openai" && executionMode === "sync";
  const requestBody: Record<string, unknown> = {
    model,
    prompt,
  };

  if (imageSize) {
    requestBody.size = imageSize;
  }
  if (imageQuality && provider.imageRequestMode !== "openai-json") {
    requestBody.quality = imageQuality;
  }
  if (shouldSendTopLevelResponseFormat) {
    requestBody.response_format = request.response_format || "url";
  }
  if (provider.imageRequestMode === "openai-json") {
    requestBody.extra_body = {
      ...defaultOpenAiImageResponseFormat,
      response_format: request.response_format || "url",
    };
    if (referenceImages.length > 0) {
      (requestBody.extra_body as Record<string, unknown>).image = referenceImages;
    }
  } else if (!usesImageEditsApi && referenceImages.length > 0) {
    requestBody.image = referenceImages;
  }

  const buildEditsPayload = async (stream = false) => {
    const formData = new FormData();
    formData.set("model", model);
    if (prompt) {
      formData.set("prompt", prompt);
    }
    if (imageSize) {
      formData.set("size", imageSize);
    }
    if (imageQuality) {
      formData.set("quality", imageQuality);
    }
    if (stream) {
      formData.set("stream", "true");
      formData.set("partial_images", "1");
    }

    const referenceBlobs = await Promise.all(referenceImages.map((image) => referenceToBlob(image, request.signal)));
    referenceBlobs.forEach(({ blob, mimeType }, index) => {
      formData.append("image", blob, `reference-${index + 1}.${mimeTypeToFileExtension(mimeType)}`);
    });

    return formData;
  };

  const buildGenerationsPayload = (stream = false) => {
    const body = { ...requestBody };
    if (stream) {
      body.stream = true;
      body.partial_images = 1;
    }
    return JSON.stringify(body);
  };

  const buildGenerationsFallbackPayload = () => {
    const body: Record<string, unknown> = {
      model,
      prompt,
      response_format: request.response_format || "url",
      n: 1,
      image: referenceImages,
    };
    if (imageSize) body.size = imageSize;
    if (imageQuality) body.quality = imageQuality;
    return JSON.stringify(body);
  };

  let streamRequested = shouldRequestImageStream;
  let streamFallbackUsed = false;
  let requestPayload: string | FormData = usesImageEditsApi
    ? await buildEditsPayload(streamRequested)
    : buildGenerationsPayload(streamRequested);
  let requestHeaders: Record<string, string> = usesImageEditsApi
    ? { Authorization: bearerAuthorizationHeader(apiKey) }
    : { "Content-Type": "application/json", Authorization: bearerAuthorizationHeader(apiKey) };

  const retryWithoutStream = async (reason: string, status: number) => {
    if (!streamRequested || streamFallbackUsed || request.signal?.aborted) return false;
    const policy = classifyImagePostRetry({
      kind: "http",
      status,
      streamUnsupported: reason === "unsupported",
      attempt: 1,
      maxAttempts: 2,
    });
    if (!policy.retryWithoutStream) return false;
    streamRequested = false;
    streamFallbackUsed = true;
    requestPayload = usesImageEditsApi ? await buildEditsPayload() : buildGenerationsPayload();
    basicLog("[SUPPLIER][IMAGE_STREAM_FALLBACK]", {
      mode: "openai_compatible_image",
      providerId: provider.id,
      reason,
    });
    return true;
  };

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    let requestStartedAt = Date.now();
    let responseEndpoint = endpoint;
    let responseEndpointPath = endpointPath;
    let responseUsesImageEditsApi = usesImageEditsApi;
    let responseAccepted = false;

    try {
      const postImageRequest = async (
        nextEndpoint: string,
        nextEndpointPath: string,
        nextUsesImageEditsApi: boolean,
        nextPayload: string | FormData,
        nextHeaders: Record<string, string>
      ) => {
        requestStartedAt = Date.now();
        responseEndpoint = nextEndpoint;
        responseEndpointPath = nextEndpointPath;
        responseUsesImageEditsApi = nextUsesImageEditsApi;
        basicLog("[SUPPLIER][REQ]", {
          method: "POST",
          endpoint: nextEndpoint,
          host: getEndpointHost(nextEndpoint),
          mode: "openai_compatible_image",
          protocol: provider.protocol,
          requestedModel,
          normalizedModel: model,
          model,
          executionMode,
          imageSize,
          aspectRatio: requestedAspectRatio,
          referenceCount: referenceImages.length,
          usesImageEditsApi: nextUsesImageEditsApi,
          streamRequested,
          providerId: provider.id,
          attempt,
          maxAttempts,
          timeoutMs: asyncImageSubmitTimeoutMs,
        });

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), asyncImageSubmitTimeoutMs);
        const abortFromRequest = () => controller.abort();
        if (request.signal?.aborted) {
          abortFromRequest();
        } else {
          request.signal?.addEventListener("abort", abortFromRequest, { once: true });
        }

        let nextResponse: Response;
        try {
          nextResponse = await fetch(nextEndpoint, {
            method: "POST",
            headers: nextHeaders,
            body: nextPayload,
            signal: controller.signal,
          });
        } finally {
          clearTimeout(timeoutId);
          request.signal?.removeEventListener("abort", abortFromRequest);
        }

        basicLog("[SUPPLIER][RES]", {
          method: "POST",
          endpoint: nextEndpoint,
          mode: "openai_compatible_image",
          status: nextResponse.status,
          statusText: nextResponse.statusText,
          durationMs: Date.now() - requestStartedAt,
        });

        return nextResponse;
      };

      let response = await postImageRequest(endpoint, endpointPath, usesImageEditsApi, requestPayload, requestHeaders);

      if (!response.ok) {
        const errorText = await response.text();
        if (response.status >= 400 && response.status < 500 && imageStreamUnsupportedText(errorText) && await retryWithoutStream("unsupported", response.status)) {
          continue;
        } else if (!usesImageEditsApi && imagesApiUnsupportedText(errorText)) {
          response = await postImageRequest(
            imageEditUrl,
            "/images/edits",
            true,
            await buildEditsPayload(),
            { Authorization: bearerAuthorizationHeader(apiKey) }
          );
        } else if (usesImageEditsApi) {
          response = await postImageRequest(
            imageGenerationUrl,
            "/images/generations",
            false,
            buildGenerationsFallbackPayload(),
            {
              "Content-Type": "application/json",
              Authorization: bearerAuthorizationHeader(apiKey),
            }
          );
        } else {
          const failure = classifyImageProviderHttpFailure(response.status, errorText || response.statusText);
          throw new ImageGenerationError(
            `OpenAI compatible image request failed: ${errorText || response.statusText}`,
            response.status,
            {
              ...failure,
              retryAttempt: attempt,
            }
          );
        }
      }

      if (!response.ok) {
        const errorText = await response.text();
        const failure = classifyImageProviderHttpFailure(response.status, errorText || response.statusText);
        throw new ImageGenerationError(
          `OpenAI compatible image request failed: ${errorText || response.statusText}`,
          response.status,
          {
            ...failure,
            retryAttempt: attempt,
          }
        );
      }

      responseAccepted = true;
      const streamResult = streamRequested
        ? await readOpenAiImageStream(response)
        : { transport: "json", completedPayload: await response.json(), partialPayload: null };
      const completedOutputs = toImageEntries(streamResult.completedPayload);
      const partialOutputs = completedOutputs.length > 0 ? [] : toImageEntries(streamResult.partialPayload);
      const outputs = completedOutputs.length > 0 ? completedOutputs : partialOutputs;
      const payload = streamResult.completedPayload || streamResult.partialPayload || {};

      basicLog("[SUPPLIER][PARSE]", {
        endpoint: responseEndpointPath,
        mode: "openai_compatible_image",
        executionMode,
        imageCount: outputs.length,
        imageSize,
        aspectRatio: requestedAspectRatio,
        referenceCount: referenceImages.length,
        usesImageEditsApi: responseUsesImageEditsApi,
        streamTransport: streamResult.transport,
        streamOutcome: streamResult.completedPayload ? "completed" : streamResult.partialPayload ? "partial" : "empty",
      });

      if (outputs.length > 0) {
        return {
          created: Math.floor(Date.now() / 1000),
          data: outputs,
        };
      }

      const taskStatus = extractTaskStatus(payload as AsyncImageTaskResultResponse);
      const taskErrorMessage = extractTaskErrorMessage(payload as AsyncImageTaskResultResponse);
      if (IMAGE_TASK_FAILURE_STATUSES.has(taskStatus)) {
        throw new ImageGenerationError(
          taskErrorMessage || "OpenAI compatible async image task failed on submit",
          502,
          {
            failureClass: "upstream_http",
            isRetryable: false,
            retryAttempt: attempt,
          }
        );
      }

      const taskId = extractOptionalTaskId(payload);
      if (taskId) {
        return pollOpenAiCompatibleImageTask({
          taskId,
          taskBaseUrl,
          apiKey,
          signal: request.signal,
          requestModel: requestedModel,
          normalizedModel: model,
          imageSize,
          aspectRatio: requestedAspectRatio,
          referenceCount: referenceImages.length,
        });
      }

      if (outputs.length === 0) {
        basicLog("[SUPPLIER][PARSE_EMPTY]", {
          endpoint: responseEndpointPath,
          mode: "openai_compatible_image",
          executionMode,
          imageSize,
          aspectRatio: requestedAspectRatio,
          referenceCount: referenceImages.length,
          usesImageEditsApi: responseUsesImageEditsApi,
          ...summarizeImagePayloadCounts(payload),
        });
        throw new ImageGenerationError("OpenAI compatible image request returned no images", 502, {
          failureClass: "payload",
          failureCode: "provider_result_unknown",
          isRetryable: false,
          retryAttempt: attempt,
          outcomeUnknown: true,
        });
      }

    } catch (error) {
      const failureState = classifyGeminiImageTransportFailure(error);

      basicLog("[SUPPLIER][ERR]", {
        endpoint: responseEndpointPath,
        mode: "openai_compatible_image",
        protocol: provider.protocol,
        requestedModel,
        normalizedModel: model,
        executionMode,
        imageSize,
        aspectRatio: requestedAspectRatio,
        referenceCount: referenceImages.length,
        usesImageEditsApi: responseUsesImageEditsApi,
        failureClass: failureState.failureClass,
        failureCode: failureState.failureCode || (responseAccepted ? "provider_result_unknown" : null),
        outcomeUnknown: failureState.outcomeUnknown || responseAccepted,
        isRetryable: failureState.isRetryable,
        retryAttempt: attempt,
        requestCount: request.n || 1,
        ...buildSupplierRequestDiagnostics({
          endpoint: responseEndpoint,
          requestStartedAt,
          timeoutMs: asyncImageSubmitTimeoutMs,
          attempt,
          maxAttempts,
        }),
        ...getErrorDiagnostics(error),
      });

      if (failureState.isRetryable && attempt < maxAttempts && !request.signal?.aborted) {
        debugWarn("Retrying retryable OpenAI compatible image transport failure", {
          endpoint: responseEndpoint,
          mode: "openai_compatible_image",
          retryAttempt: attempt,
          nextRetryAttempt: attempt + 1,
          requestSize: request.size || null,
          requestCount: request.n || 1,
          failureClass: failureState.failureClass,
        });
        await sleep(350);
        continue;
      }

      if (request.signal?.aborted) {
        throw new ImageGenerationError("OpenAI compatible image request cancelled", 499, {
          failureClass: "transport",
          isRetryable: false,
          retryAttempt: attempt,
        });
      }

      if (error instanceof ImageGenerationError) {
        if (!error.failureClass) {
          error.failureClass = failureState.failureClass;
        }
        if (typeof error.isRetryable !== "boolean") {
          error.isRetryable = failureState.isRetryable;
        }
        if (typeof error.retryAttempt !== "number") {
          error.retryAttempt = attempt;
        }
        if (!error.failureCode && failureState.failureCode) {
          error.failureCode = failureState.failureCode;
        }
        if (typeof error.outcomeUnknown !== "boolean") {
          error.outcomeUnknown = failureState.outcomeUnknown;
        }
        throw error;
      }

      const resultUnknown = responseAccepted || failureState.outcomeUnknown === true;
      throw new ImageGenerationError(
        error instanceof Error ? `OpenAI compatible image request failed: ${error.message}` : "OpenAI compatible image request failed",
        502,
        {
          failureClass: responseAccepted ? "payload" : failureState.failureClass,
          failureCode: resultUnknown ? "provider_result_unknown" : failureState.failureCode,
          isRetryable: false,
          retryAttempt: attempt,
          outcomeUnknown: resultUnknown,
        }
      );
    }
  }

  throw new ImageGenerationError("OpenAI compatible image request failed", 502, {
    failureClass: "unknown",
    isRetryable: false,
    retryAttempt: maxAttempts,
  });
}

async function pollOpenAiCompatibleImageTask({
  taskId,
  taskBaseUrl,
  apiKey,
  signal,
  requestModel,
  normalizedModel,
  imageSize,
  aspectRatio,
  referenceCount,
}: {
  taskId: string;
  taskBaseUrl: string;
  apiKey: string;
  signal?: AbortSignal;
  requestModel: string;
  normalizedModel: string;
  imageSize: string | null;
  aspectRatio: string;
  referenceCount: number;
}): Promise<GenerationResponse> {
  const endpoint = `${taskBaseUrl}/images/tasks/${taskId}`;
  const startAt = Date.now();
  let pollCount = 0;
  let lastLoggedStatus = "";

  while (Date.now() - startAt < asyncImagePollTimeoutMs) {
    if (signal?.aborted) {
      throw new ImageGenerationError("Request cancelled by user", 499);
    }

    pollCount += 1;
    const pollStartedAt = Date.now();

    basicLog("[SUPPLIER][REQ]", {
      method: "GET",
      endpoint,
      host: getEndpointHost(endpoint),
      mode: "openai_compatible_image_task",
      taskId,
      pollCount,
    });

    const response = await fetch(endpoint, {
      method: "GET",
      headers: {
        Authorization: bearerAuthorizationHeader(apiKey),
      },
      signal,
    });

    basicLog("[SUPPLIER][RES]", {
      method: "GET",
      endpoint,
      mode: "openai_compatible_image_task",
      taskId,
      pollCount,
      status: response.status,
      statusText: response.statusText,
      durationMs: Date.now() - pollStartedAt,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new ImageGenerationError(
        `OpenAI compatible image task query failed: ${errorText || response.statusText}`,
        response.status,
        {
          failureClass: "upstream_http",
          isRetryable: false,
          retryAttempt: pollCount,
        }
      );
    }

    const payload = await response.json() as AsyncImageTaskResultResponse;
    const status = extractTaskStatus(payload);
    const outputs = toImageEntries(payload);

    if (status !== lastLoggedStatus) {
      basicLog("[SUPPLIER][TASK]", {
        mode: "openai_compatible_image_task",
        taskId,
        pollCount,
        status: status || "UNKNOWN",
        requestedModel: requestModel,
        normalizedModel,
        imageSize,
        aspectRatio,
        referenceCount,
        elapsedMs: Date.now() - startAt,
      });
      lastLoggedStatus = status;
    }

    if (!status && outputs.length > 0) {
      return {
        created: Math.floor(Date.now() / 1000),
        data: outputs,
      };
    }

    if (IMAGE_TASK_SUCCESS_STATUSES.has(status)) {
      if (outputs.length === 0) {
        basicLog("[SUPPLIER][PARSE_EMPTY]", {
          endpoint: "/images/tasks/{taskId}",
          mode: "openai_compatible_image_task",
          taskId,
          pollCount,
          imageSize,
          aspectRatio,
          referenceCount,
          payloadKeys: summarizePayloadKeys(payload),
          ...summarizeImagePayloadCounts(payload),
        });
        throw new ImageGenerationError("供应商任务成功，但返回体未识别到图片地址", 502, {
          failureClass: "payload",
          isRetryable: false,
          retryAttempt: pollCount,
        });
      }

      return {
        created: Math.floor(Date.now() / 1000),
        data: outputs,
      };
    }

    if (IMAGE_TASK_FAILURE_STATUSES.has(status)) {
      throw new ImageGenerationError(
        extractTaskErrorMessage(payload) || "OpenAI compatible image task failed",
        502,
        {
          failureClass: "upstream_http",
          isRetryable: false,
          retryAttempt: pollCount,
        }
      );
    }

    await sleepWithAbort(asyncImagePollIntervalMs, signal);
  }

  throw new ImageGenerationError("OpenAI compatible image task polling timed out", 504, {
    failureClass: "timeout",
    isRetryable: false,
  });
}

export async function runImageTask(request: UnifiedImageRequest): Promise<GenerationResponse> {
  const images = Array.isArray(request.images) ? request.images.filter(Boolean) : [];
  const requestedModel = typeof request.model === "string" ? request.model.trim() : "";
  const normalizedModel = normalizeImageRequestModel(requestedModel);
  const normalizedRequest = {
    ...request,
    model: normalizedModel,
    requestedModel,
    images,
    ...(request.size ? { size: request.size } : {}),
  };
  const transport = await getProviderTransport({
    providerId: request.providerId,
    model: requestedModel,
    purpose: "image",
  });
  const { protocol } = transport;

  if (protocol === "gemini") {
    try { return await generateGeminiOfficialImage(normalizedRequest); }
    catch (error) {
      if (error instanceof ImageGenerationError) Object.assign(error, { providerId: request.providerId, model: requestedModel, protocol, endpointHost: transport.endpointHost });
      throw error;
    }
  }

  if (protocol === "openai" || protocol === "responses") {
    try { return await generateOpenAiCompatibleImage(normalizedRequest); }
    catch (error) {
      if (error instanceof ImageGenerationError) Object.assign(error, { providerId: request.providerId, model: requestedModel, protocol, endpointHost: transport.endpointHost });
      throw error;
    }
  }

  throw new ImageGenerationError(`Image generation failed: unsupported image protocol "${protocol}"`, 400, {
    failureCode: "provider_protocol_unsupported",
    failureStage: "provider_selection",
    isRetryable: false,
    providerId: request.providerId,
    model: requestedModel,
    protocol,
  });
}

export interface ChatToolDefinition {
  type: 'function';
  function: {
    name: string;
    description?: string;
    strict?: boolean;
    parameters?: Record<string, unknown>;
  };
}

export interface ChatToolCall {
  id: string;
  type: 'function';
  thoughtSignature?: string;
  function: {
    name: string;
    arguments: string;
  };
}

export type ChatToolChoice =
  | 'auto'
  | 'none'
  | 'required'
  | { type: 'function'; function: { name: string } };

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content:
    | string
    | Array<
        | { type: 'text'; text: string }
        | { type: 'image_url'; image_url: { url: string } }
      >;
  tool_calls?: ChatToolCall[];
  tool_call_id?: string;
  name?: string;
  geminiParts?: GeminiContentPart[];
  geminiSourceModel?: string;
}

/** Provider-neutral replay item produced by the context replay layer. */
export type ResponseItem =
  | { type: 'text'; role: 'user' | 'assistant' | 'system'; text: string }
  | { type: 'local_image'; role?: 'user'; assetId?: string; source?: string }
  | { type: 'tool_call'; callId: string; name: string; arguments?: Record<string, unknown> }
  | { type: 'tool_result'; callId: string; name?: string; result?: unknown; isError?: boolean }
  | { type: 'tool_result_image'; callId: string; assetId?: string; source?: string }
  | { type: 'confirmation' | 'clarification' | 'recovery'; data?: Record<string, unknown> };

export interface ResponseItemMessageOptions {
  /** Resolves durable asset IDs when a replay item does not carry a source. */
  imageSources?: Record<string, string>;
}

/**
 * Convert provider-neutral replay items to the ChatMessage contract consumed
 * by both OpenAI-compatible and Gemini transports. Unknown/non-model items are
 * intentionally ignored; asset IDs are resolved only when a source is
 * available, leaving materialization and validation to the normal pipeline.
 */
export function responseItemsToChatMessages(
  items: ResponseItem[] | null | undefined,
  options: ResponseItemMessageOptions = {},
): ChatMessage[] {
  const result: ChatMessage[] = [];
  const imageSources = options.imageSources || {};
  for (const item of Array.isArray(items) ? items : []) {
    if (!item || typeof item !== 'object') continue;
    if (item.type === 'text') {
      result.push({ role: item.role, content: item.text || '' });
    } else if (item.type === 'local_image') {
      const source = item.source || (item.assetId ? imageSources[item.assetId] : undefined);
      if (!source) continue;
      const previous = result.at(-1);
      if (previous?.role === 'user') {
        const content = typeof previous.content === 'string'
          ? [{ type: 'text' as const, text: previous.content }]
          : [...previous.content];
        content.push({ type: 'image_url' as const, image_url: { url: source } });
        previous.content = content;
      } else {
        result.push({ role: 'user', content: [{ type: 'image_url', image_url: { url: source } }] });
      }
    } else if (item.type === 'tool_call') {
      result.push({
        role: 'assistant',
        content: '',
        tool_calls: [{
          id: item.callId || '',
          type: 'function',
          function: { name: item.name || 'tool', arguments: JSON.stringify(item.arguments || {}) },
        }],
      });
    } else if (item.type === 'tool_result') {
      const serialized = typeof item.result === 'string' ? item.result : JSON.stringify(item.result ?? null);
      result.push({ role: 'tool', tool_call_id: item.callId || '', name: item.name || 'tool', content: item.isError ? `Error: ${serialized}` : serialized });
    } else if (item.type === 'tool_result_image') {
      const source = item.source || (item.assetId ? imageSources[item.assetId] : undefined);
      if (!source) continue;
      const previous = result.at(-1);
      if (previous?.role === 'tool') {
        const content = typeof previous.content === 'string'
          ? [{ type: 'text' as const, text: previous.content }]
          : [...previous.content];
        content.push({ type: 'image_url' as const, image_url: { url: source } });
        previous.content = content;
      } else {
        result.push({ role: 'tool', tool_call_id: item.callId || '', name: 'image_output', content: [{ type: 'image_url', image_url: { url: source } }] });
      }
    }
  }
  return result;
}

export interface ChatRequest {
  model: string;
  providerId?: string;
  messages: ChatMessage[];
  responseItems?: ResponseItem[];
  responseItemOptions?: ResponseItemMessageOptions;
  tools?: ChatToolDefinition[];
  toolChoice?: ChatToolChoice;
  signal?: AbortSignal;
  imagesMaterialized?: boolean;
  imageMaterializationStats?: { localImageCount: number; totalImageBytes: number };
}

export interface ChatStreamRequest extends ChatRequest {
  stream?: boolean;
}

function normalizeChatRequest<T extends ChatRequest>(request: T): T {
  if (!Array.isArray(request.responseItems)) return request;
  return {
    ...request,
    messages: responseItemsToChatMessages(request.responseItems, request.responseItemOptions),
  } as T;
}

export interface ChatResponse {
  choices: Array<{
    message: {
      content: string;
      reasoning_content?: string;
      tool_calls?: ChatToolCall[];
      geminiParts?: GeminiContentPart[];
      geminiSourceModel?: string;
    };
  }>;
}

type SupplierChatStreamPayload = {
  choices?: Array<{
    delta?: {
      content?: string;
      reasoning_content?: string;
      tool_calls?: Array<{
        index?: number;
        id?: string;
        function?: { name?: string; arguments?: string };
      }>;
    };
    message?: {
      content?: string;
      reasoning_content?: string;
      tool_calls?: Array<{
        index?: number;
        id?: string;
        function?: { name?: string; arguments?: string };
      }>;
    };
    finish_reason?: string;
  }>;
};

type GeminiContentPart = {
  text?: string;
  thought?: boolean;
  thoughtSignature?: string;
  thought_signature?: string;
  functionCall?: { id?: string; name?: string; args?: Record<string, unknown> };
  functionResponse?: Record<string, unknown>;
  inlineData?: { mimeType?: string; data?: string };
  fileData?: Record<string, unknown>;
  [key: string]: unknown;
};

type GeminiGenerateContentPayload = {
  candidates?: Array<{
    content?: {
      parts?: GeminiContentPart[];
    };
  }>;
};

function adaptToolResultImagesForOpenAi(messages: ChatRequest["messages"]): ChatRequest["messages"] {
  return messages.flatMap((message) => {
    if (message.role !== "tool" || !Array.isArray(message.content)) return [message];
    const textContent = message.content
      .filter((part) => part.type === "text")
      .map((part) => part.text)
      .filter(Boolean)
      .join("\n");
    const imageParts = message.content.filter((part) => part.type === "image_url");
    if (imageParts.length === 0) return [{ ...message, content: textContent }];
    // Chat Completions providers commonly require text-only tool results.
    // Preserve the tool-result boundary and its image references instead of
    // creating a synthetic user turn for the images.
    return [{
      ...message,
      content: [
        textContent || "Tool returned image output.",
        ...imageParts.map((part) => `[tool_result_image: ${part.image_url.url}]`),
      ].join("\n"),
    }];
  });
}

export type ChatStreamEvent =
  | { type: "start"; model?: string }
  | { type: "delta"; channel: "content" | "reasoning"; content: string; thoughtSignature?: string }
  | { type: "tool_call_start"; toolCallId: string; index: number; name?: string }
  | { type: "tool_call_delta"; toolCallId: string; index: number; argumentsDelta: string }
  | { type: "tool_call_end"; toolCallId: string; index: number; name: string; arguments: string; thoughtSignature?: string }
  | { type: "gemini_parts"; parts: GeminiContentPart[] }
  | { type: "done" };

async function convertChatMessagesToGeminiRequest(
  messages: ChatRequest["messages"],
  signal?: AbortSignal,
  model?: string,
): Promise<{
  systemInstruction?: { parts: Array<{ text: string }> };
  contents: Array<{ role: "user" | "model"; parts: Array<Record<string, unknown>> }>;
}> {
  return await convertGeminiMessages(messages, { signal, model, resolveImage: referenceToInlineData }) as {
    systemInstruction?: { parts: Array<{ text: string }> };
    contents: Array<{ role: "user" | "model"; parts: Array<Record<string, unknown>> }>;
  };
}

function summarizeGeminiContents(contents: Array<{ role: string; parts: Array<Record<string, unknown>> }>) {
  return contents.map((content, contentIndex) => ({
    contentIndex,
    role: content.role,
    parts: content.parts.map((part, partIndex) => ({
      partIndex,
      keys: Object.keys(part).filter((key) => key !== "thoughtSignature" && key !== "thought_signature"),
      hasText: typeof part.text === "string" && part.text.length > 0,
      hasFunctionCall: Boolean(part.functionCall),
      hasFunctionResponse: Boolean(part.functionResponse),
      hasInlineData: Boolean(part.inlineData),
      hasFileData: Boolean(part.fileData),
      hasThoughtSignature: typeof part.thoughtSignature === "string" || typeof part.thought_signature === "string",
    })),
  }));
}

function validateGeminiContents(contents: Array<{ role: string; parts: Array<Record<string, unknown>> }>) {
  try { validateSharedGeminiContents(contents); }
  catch (error) {
    throw new ImageGenerationError(error instanceof Error ? error.message : "Invalid Gemini contents", 400, {
      failureClass: "payload",
      isRetryable: false,
    });
  }
}

function extractGeminiTextResponse(payload: GeminiGenerateContentPayload): {
  content: string;
  reasoning: string;
  toolCalls: ChatToolCall[];
  geminiParts: GeminiContentPart[];
} {
  return extractGeminiResponse(payload) as {
    content: string;
    reasoning: string;
    toolCalls: ChatToolCall[];
    geminiParts: GeminiContentPart[];
  };
}

function resolveGeminiFunctionCallingConfig(toolChoice?: ChatToolChoice): {
  mode: 'AUTO' | 'NONE' | 'ANY';
  allowedFunctionNames?: string[];
} {
  return geminiFunctionCallingConfig(toolChoice) as {
    mode: 'AUTO' | 'NONE' | 'ANY';
    allowedFunctionNames?: string[];
  };
}

function stripGeminiThoughtSignatures(messages: ChatRequest["messages"]): ChatRequest["messages"] {
  return messages.map((message) => {
    if (message.role !== "assistant") return message;
    const { geminiParts: _geminiParts, geminiSourceModel: _geminiSourceModel, ...withoutGeminiParts } = message;
    if (!Array.isArray(message.tool_calls)) return withoutGeminiParts;
    return {
      ...withoutGeminiParts,
      tool_calls: message.tool_calls.map(({ thoughtSignature: _thoughtSignature, ...toolCall }) => toolCall),
    };
  });
}

function flatToolChoiceRetryBody(
  requestBody: Record<string, unknown>,
  toolChoice?: ChatToolChoice,
): Record<string, unknown> | null {
  if (!toolChoice || typeof toolChoice !== 'object') return null;
  return {
    ...requestBody,
    tool_choice: { type: toolChoice.type, name: toolChoice.function.name },
  };
}

function needsFlatToolChoiceRetry(errorText: string, toolChoice?: ChatToolChoice): boolean {
  if (!toolChoice || typeof toolChoice !== 'object') return false;
  const normalized = errorText.toLowerCase();
  return normalized.includes('tool_choice.name') && normalized.includes('missing');
}

function strictToolSchemaError(errorText: string, tools?: ChatToolDefinition[]): string | null {
  if (!tools?.some((tool) => tool.function.strict === true)) return null;
  const normalized = errorText.toLowerCase();
  const rejectsStrict = normalized.includes('strict') && [
    'unsupported',
    'not supported',
    'unknown',
    'unrecognized',
    'not permitted',
    'invalid',
  ].some((marker) => normalized.includes(marker));
  return rejectsStrict
    ? 'The current Planner model does not support strict structured tool output.'
    : null;
}

function chatHttpFailureMeta(status: number, errorText: string): {
  failureClass: 'upstream_http';
  failureCode: 'provider_unavailable' | 'provider_http';
  isRetryable: boolean;
} {
  const normalized = errorText.toLowerCase();
  const unavailable = normalized.includes('no enabled channel for model') || normalized.includes('no available compatible accounts');
  return {
    failureClass: 'upstream_http',
    failureCode: unavailable ? 'provider_unavailable' : 'provider_http',
    isRetryable: status === 524 && !unavailable,
  };
}

function normalizeChatTransportError(error: unknown): unknown {
  if (error instanceof ImageGenerationError) return error;
  const cause = error instanceof Error ? error.cause as { code?: unknown; message?: unknown } | undefined : undefined;
  const causeCode = typeof cause?.code === 'string' ? cause.code.toUpperCase() : '';
  const causeMessage = typeof cause?.message === 'string' ? cause.message : '';
  const message = error instanceof Error ? error.message : String(error);
  if (message.toLowerCase() === 'fetch failed' && (causeCode === 'EPIPE' || causeCode === 'ECONNRESET' || causeMessage.toLowerCase().includes('closed'))) {
    return new ImageGenerationError(`Chat supplier connection failed${causeCode ? ` (${causeCode})` : ''}`, 502, {
      failureClass: 'transport',
      isRetryable: true,
    });
  }
  return error;
}

export async function chat(
  request: ChatRequest
): Promise<ChatResponse> {
  request = normalizeChatRequest(request);
  const { provider, providerTargets, apiKey, protocol, headers, chatBaseUrl } = await getProviderTransport({
    providerId: request.providerId,
    model: request.model,
    purpose: "chat",
  });
  if (!apiKey) {
    throw new ImageGenerationError(
      "Please configure a supplier API Key in settings or environment"
    );
  }

  const model = normalizeImageModelKey(request.model);
  const isGeminiModel = protocol === "gemini";
  const endpoint = isGeminiModel
    ? geminiChatEndpoint(provider.baseUrl, model)
    : `${chatBaseUrl}/chat/completions`;
  const attempt = 1;
  const maxAttempts = 1;
  let requestStartedAt = Date.now();

  try {
    requestStartedAt = Date.now();
    const materialized = request.imagesMaterialized
      ? {
          messages: request.messages,
          localImageCount: request.imageMaterializationStats?.localImageCount || 0,
          totalImageBytes: request.imageMaterializationStats?.totalImageBytes || 0,
        }
      : await materializeChatMessageImages(request.messages);
    const requestMessages = materialized.messages as ChatRequest["messages"];
    basicLog("[SUPPLIER][REQ]", {
      method: "POST",
      endpoint,
      host: getEndpointHost(endpoint),
      mode: "chat",
      model,
      messageCount: requestMessages.length,
      localImageCount: materialized.localImageCount,
      referenceImageBytes: materialized.totalImageBytes,
      providerId: provider.id,
      attempt,
      maxAttempts,
    });

    const requestBody = isGeminiModel
      ? {
          ...await convertChatMessagesToGeminiRequest(requestMessages, request.signal, model),
          ...(request.tools?.length
            ? {
                tools: [{
                  functionDeclarations: request.tools.map((tool) => ({
                    name: tool.function.name,
                    description: tool.function.description,
                    parameters: toGeminiSchema(tool.function.parameters || { type: "object", properties: {} }),
                  })),
                }],
                toolConfig: {
                  functionCallingConfig: resolveGeminiFunctionCallingConfig(request.toolChoice),
                },
              }
            : {}),
        }
      : {
          model,
          messages: adaptToolResultImagesForOpenAi(requestMessages),
          ...(request.tools?.length
            ? {
                tools: request.tools,
                tool_choice: request.toolChoice || "auto",
              }
            : {}),
        };
    if (!isGeminiModel) {
      (requestBody as { messages: ChatRequest["messages"] }).messages = stripGeminiThoughtSignatures(
        adaptToolResultImagesForOpenAi(requestMessages),
      );
    }
    if (isGeminiModel) {
      request.tools?.forEach((tool) => assertGeminiSchemaCompatible(toGeminiSchema(tool.function.parameters || { type: "object", properties: {} })));
      const geminiContents = (requestBody as { contents: Array<{ role: string; parts: Array<Record<string, unknown>> }> }).contents;
      validateGeminiContents(geminiContents);
      basicLog("[SUPPLIER][GEMINI_PARTS]", { mode: "chat", contents: summarizeGeminiContents(geminiContents) });
    }

    let response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...headers,
      },
      body: JSON.stringify(requestBody),
      signal: request.signal,
    });

    if (!response.ok) {
      let errorText = await response.text();
      const retryBody = !isGeminiModel && needsFlatToolChoiceRetry(errorText, request.toolChoice)
        ? flatToolChoiceRetryBody(requestBody as Record<string, unknown>, request.toolChoice)
        : null;
      if (retryBody) {
        response = await fetch(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...headers,
          },
          body: JSON.stringify(retryBody),
          signal: request.signal,
        });
        if (response.ok) {
          basicLog("[SUPPLIER][COMPAT_RETRY]", {
            endpoint,
            mode: "chat",
            compatibility: "flat_tool_choice",
          });
        } else {
          errorText = await response.text();
        }
      }
      if (!response.ok) {
        const error = parseErrorPayload(errorText);
        throw new ImageGenerationError(
          strictToolSchemaError(errorText, request.tools) ||
            (error.error as { message?: string } | undefined)?.message ||
            `API request failed with status ${response.status}: ${errorText}`,
          response.status,
          chatHttpFailureMeta(response.status, errorText),
        );
      }
    }

    basicLog("[SUPPLIER][RES]", {
      method: "POST",
      endpoint,
      mode: "chat",
      status: response.status,
      durationMs: Date.now() - requestStartedAt,
    });

    const payload = await response.json();
    if (!isGeminiModel) {
      return payload;
    }

    const geminiResponse = extractGeminiTextResponse(payload as GeminiGenerateContentPayload);
    return {
      choices: [
        {
          message: {
            content: geminiResponse.content,
            reasoning_content: geminiResponse.reasoning || undefined,
            tool_calls: geminiResponse.toolCalls.length > 0 ? geminiResponse.toolCalls : undefined,
            geminiParts: geminiResponse.geminiParts,
            geminiSourceModel: model,
          },
        },
      ],
    };
  } catch (rawError) {
    const error = normalizeChatTransportError(rawError);
    basicLog("[SUPPLIER][ERR]", {
      mode: "chat",
      model,
      messageCount: request.messages.length,
      ...buildSupplierRequestDiagnostics({
        endpoint,
        requestStartedAt,
        attempt,
        maxAttempts,
      }),
      ...getErrorDiagnostics(error),
    });
    debugError("[SUPPLIER][ERR]", {
      mode: "chat",
      model,
      messageCount: request.messages.length,
      ...buildSupplierRequestDiagnostics({
        endpoint,
        requestStartedAt,
        attempt,
        maxAttempts,
      }),
      ...getErrorDiagnostics(error),
    });
    throw error;
  }
}

export async function* chatStream(
  request: ChatStreamRequest
): AsyncGenerator<ChatStreamEvent, void, unknown> {
  request = normalizeChatRequest(request);
  const { provider, providerTargets, apiKey, protocol, headers, chatBaseUrl } = await getProviderTransport({
    providerId: request.providerId,
    model: request.model,
    purpose: "chat",
  });
  if (!apiKey) {
    throw new ImageGenerationError(
      "Please configure a supplier API Key in settings or environment"
    );
  }

  const model = normalizeImageModelKey(request.model);
  const isGeminiModel = protocol === "gemini";
  const endpoint = isGeminiModel
    ? geminiChatEndpoint(provider.baseUrl, model, true)
    : `${chatBaseUrl}/chat/completions`;
  const attempt = 1;
  const maxAttempts = 1;
  let requestStartedAt = Date.now();
  let response;

  try {
    requestStartedAt = Date.now();
    const materialized = request.imagesMaterialized
      ? {
          messages: request.messages,
          localImageCount: request.imageMaterializationStats?.localImageCount || 0,
          totalImageBytes: request.imageMaterializationStats?.totalImageBytes || 0,
        }
      : await materializeChatMessageImages(request.messages);
    const requestMessages = materialized.messages as ChatRequest["messages"];
    basicLog("[SUPPLIER][REQ]", {
      method: "POST",
      endpoint,
      host: getEndpointHost(endpoint),
      mode: "chat_stream",
      model,
      messageCount: requestMessages.length,
      localImageCount: materialized.localImageCount,
      referenceImageBytes: materialized.totalImageBytes,
      providerId: provider.id,
      attempt,
      maxAttempts,
    });

    const requestBody = isGeminiModel
      ? {
          ...await convertChatMessagesToGeminiRequest(requestMessages, request.signal, model),
          ...(request.tools?.length
            ? {
                tools: [{
                  functionDeclarations: request.tools.map((tool) => ({
                    name: tool.function.name,
                    description: tool.function.description,
                    parameters: toGeminiSchema(tool.function.parameters || { type: "object", properties: {} }),
                  })),
                }],
                toolConfig: {
                  functionCallingConfig: resolveGeminiFunctionCallingConfig(request.toolChoice),
                },
              }
            : {}),
        }
      : {
          model,
          messages: adaptToolResultImagesForOpenAi(requestMessages),
          stream: true,
          ...(request.tools?.length
            ? {
                tools: request.tools,
                tool_choice: request.toolChoice || "auto",
              }
            : {}),
        };
    if (!isGeminiModel) {
      (requestBody as { messages: ChatRequest["messages"] }).messages = stripGeminiThoughtSignatures(
        adaptToolResultImagesForOpenAi(requestMessages),
      );
    }
    if (isGeminiModel) {
      request.tools?.forEach((tool) => assertGeminiSchemaCompatible(toGeminiSchema(tool.function.parameters || { type: "object", properties: {} })));
      const geminiContents = (requestBody as { contents: Array<{ role: string; parts: Array<Record<string, unknown>> }> }).contents;
      validateGeminiContents(geminiContents);
      basicLog("[SUPPLIER][GEMINI_PARTS]", { mode: "chat_stream", contents: summarizeGeminiContents(geminiContents) });
    }

    response = isGeminiModel
      ? await openGeminiChatStream({ provider, model, body: requestBody, signal: request.signal })
      : await fetch(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...headers,
          },
          body: JSON.stringify(requestBody),
          signal: request.signal,
        });

    if (!response.ok) {
      let errorText = await response.text();
      const retryBody = !isGeminiModel && needsFlatToolChoiceRetry(errorText, request.toolChoice)
        ? flatToolChoiceRetryBody(requestBody as Record<string, unknown>, request.toolChoice)
        : null;
      if (retryBody) {
        response = await fetch(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...headers,
          },
          body: JSON.stringify(retryBody),
          signal: request.signal,
        });
        if (response.ok) {
          basicLog("[SUPPLIER][COMPAT_RETRY]", {
            endpoint,
            mode: "chat_stream",
            compatibility: "flat_tool_choice",
          });
        } else {
          errorText = await response.text();
        }
      }
      if (!response.ok) {
        debugError("Supplier chat stream error:", {
          status: response.status,
          model,
          raw: errorText,
        });
        const error = parseErrorPayload(errorText);
        throw new ImageGenerationError(
          strictToolSchemaError(errorText, request.tools) ||
            (error.error as { message?: string } | undefined)?.message ||
            `API request failed with status ${response.status}: ${errorText}`,
          response.status,
          chatHttpFailureMeta(response.status, errorText),
        );
      }
    }

    basicLog("[SUPPLIER][RES]", {
      method: "POST",
      endpoint,
      mode: "chat_stream",
      status: response.status,
      durationMs: Date.now() - requestStartedAt,
    });

    if (!response.body) {
      throw new ImageGenerationError("Chat stream body is empty", 502);
    }
  } catch (rawError) {
    const error = normalizeChatTransportError(rawError);
    basicLog("[SUPPLIER][ERR]", {
      mode: "chat_stream",
      model,
      messageCount: request.messages.length,
      ...buildSupplierRequestDiagnostics({
        endpoint,
        requestStartedAt,
        attempt,
        maxAttempts,
      }),
      ...getErrorDiagnostics(error),
    });
    debugError("[SUPPLIER][ERR]", {
      mode: "chat_stream",
      model,
      messageCount: request.messages.length,
      ...buildSupplierRequestDiagnostics({
        endpoint,
        requestStartedAt,
        attempt,
        maxAttempts,
      }),
      ...getErrorDiagnostics(error),
    });
    throw error;
  }

  yield { type: "start", model };

  const eventDecoder = createChatStreamEventDecoder();
  if (isGeminiModel) {
    for await (const parsed of iterateGeminiSsePayloads(response)) {
      for (const event of eventDecoder.decode(parsed)) yield event as ChatStreamEvent;
    }
    for (const event of eventDecoder.flush()) yield event as ChatStreamEvent;
    yield { type: "done" };
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line || !line.startsWith("data:")) {
        continue;
      }

      const payload = line.slice(5).trim();
      if (!payload) {
        continue;
      }

      if (payload === "[DONE]") {
        for (const event of eventDecoder.flush()) yield event as ChatStreamEvent;
        yield { type: "done" };
        return;
      }

      try {
        const parsed = JSON.parse(payload) as SupplierChatStreamPayload;
        for (const event of eventDecoder.decode(parsed)) yield event as ChatStreamEvent;
      } catch {
        continue;
      }
    }
  }

  if (buffer.trim().startsWith("data:")) {
    const payload = buffer.trim().slice(5).trim();
    if (payload && payload !== "[DONE]") {
      try {
        const parsed = JSON.parse(payload) as SupplierChatStreamPayload;
        for (const event of eventDecoder.decode(parsed)) yield event as ChatStreamEvent;
      } catch {
        // ignore malformed tail chunk
      }
    }
  }

  for (const event of eventDecoder.flush()) yield event as ChatStreamEvent;
  yield { type: "done" };
}

// Models are supplied by the current provider registry.  Keep this export as an
// empty compatibility surface for callers that have not yet been migrated.
export const AVAILABLE_MODELS = [];

export const ASPECT_RATIOS = [
  { id: "auto", name: "默认（模型自动匹配）" },
  { id: "1:1", name: "2K (1:1 Square)" },
  { id: "9:16", name: "9:16 (Portrait)" },
  { id: "16:9", name: "16:9 (Landscape)" },
  { id: "2:3", name: "2:3 (Portrait)" },
  { id: "3:2", name: "3:2 (Landscape)" },
  { id: "4:3", name: "4:3 (Classic Landscape)" },
  { id: "3:4", name: "3:4 (Classic Portrait)" },
  { id: "4:5", name: "4:5 (Portrait)" },
  { id: "5:4", name: "5:4 (Landscape)" },
  { id: "21:9", name: "21:9 (Ultra-wide)" },
  { id: "1:4", name: "1:4 (Tall Banner)" },
  { id: "4:1", name: "4:1 (Wide Banner)" },
  { id: "1:8", name: "1:8 (Vertical Strip)" },
  { id: "8:1", name: "8:1 (Horizontal Strip)" },
];
