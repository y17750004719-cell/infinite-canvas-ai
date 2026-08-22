import { createLogger } from "./logger";
import {
  buildGeminiNoImageErrorMessage,
  classifyGeminiImagePayload,
  extractGeminiImageOutputs,
  summarizeGeminiImagePayload,
} from "./gemini-image-response.mjs";
import { getGeminiImageSizeEnum, getImageModelCapability, imageSizeForResolution, normalizeImageModelCapabilityId, resolveImageModelAlias, resolveImageRequestModel, getGptImage2SizeValidationError, supportsImageModelImageSizeConfig, supportsImageModelRequestedSize } from "./image-model-capabilities.mjs";
import { effectiveProviderProtocol, getProviderById, providerEndpointUrl, readProviderRegistry, resolveProviderRequestTargets } from "./provider-config.mjs";
import {
  materializeChatMessageImages,
  readLocalReferenceImage,
  ReferenceImageUnavailableError,
} from "./reference-image-source.mjs";
import { createChatStreamEventDecoder } from "./chat-stream-events.mjs";
import { toGeminiSchema } from "./gemini-schema.mjs";
import { extractGeminiToolCalls, geminiToolCallToPart, isSyntheticGeminiToolCallId, normalizeGeminiParts, replayGeminiParts } from "./gemini-tool-calls.mjs";
const LOG_LEVEL = (process.env.LOG_LEVEL || "basic").toLowerCase();
const LOG_ENABLED = LOG_LEVEL !== "off";
const LOG_DEBUG = LOG_LEVEL === "debug";
const SUPPORTED_GEMINI_OFFICIAL_IMAGE_MODELS = new Set([
  "gemini-2.5-flash-image",
  "gemini-3.1-flash-image",
  "gemini-3.1-flash-lite-image",
  "gemini-3-pro-image",
  "gemini-3.1-flash-image-preview",
  "gemini-3-pro-image-preview",
]);
const SUPPORTED_OPENAI_COMPATIBLE_IMAGE_MODELS = new Set([
  "gpt-image-2",
]);
const EXACT_IMAGE_SIZE_REQUEST_SIZES = new Set([
  "1024x1024",
  "2048x2048",
  "4096x4096",
]);
const GEMINI_ASPECT_RATIO_IMAGE_MODELS = new Set([
  "gemini-2.5-flash-image",
  "gemini-3.1-flash-image",
  "gemini-3.1-flash-lite-image",
  "gemini-3-pro-image",
  "gemini-3.1-flash-image-preview",
  "gemini-3-pro-image-preview",
]);
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
    isRetryable: error instanceof ImageGenerationError ? error.isRetryable ?? null : null,
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
  isRetryable?: boolean;
  retryAttempt?: number;

  constructor(
    message: string,
    public statusCode?: number,
    meta?: {
      failureClass?: "transport" | "timeout" | "upstream_http" | "payload" | "unknown";
      isRetryable?: boolean;
      retryAttempt?: number;
    }
  ) {
    super(message);
    this.name = "ImageGenerationError";
    this.failureClass = meta?.failureClass;
    this.isRetryable = meta?.isRetryable;
    this.retryAttempt = meta?.retryAttempt;
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
  protocol?: "openai" | "gemini";
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
    if (imageApiKey.scope === "gpt" && protocol === "openai") {
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
    throw new ImageGenerationError("Please configure a supplier provider in settings or environment");
  }
  const providerTargets = resolveProviderRequestTargets(provider.baseUrl);
  const protocol = effectiveProviderProtocol(provider, model);
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

function resolveImageCapabilityModelId(model?: string): string {
  return normalizeImageModelCapabilityId(model);
}

function isGptImage2Model(model?: string): boolean {
  return resolveImageCapabilityModelId(model) === "gpt-image-2";
}

function isGeminiOfficialImageModel(model?: string): boolean {
  const normalizedModel = resolveImageCapabilityModelId(model);
  return normalizedModel.length > 0 && SUPPORTED_GEMINI_OFFICIAL_IMAGE_MODELS.has(normalizedModel);
}

function isOpenAiCompatibleImageModel(model?: string): boolean {
  const normalizedModel = resolveImageCapabilityModelId(model);
  return normalizedModel.length > 0;
}

export function shouldUseExactImageSizeApi(model?: string, size?: string): boolean {
  const normalizedModel = resolveImageCapabilityModelId(model);
  const normalizedSize = typeof size === "string" ? size.trim() : "";
  const capability = getImageModelCapability(normalizedModel);
  return (
    normalizedModel.length > 0 &&
    capability.supportsAspectRatio &&
    SUPPORTED_GEMINI_OFFICIAL_IMAGE_MODELS.has(normalizedModel) &&
    normalizedSize.length > 0 &&
    EXACT_IMAGE_SIZE_REQUEST_SIZES.has(normalizedSize) &&
    supportsImageModelRequestedSize(normalizedModel, normalizedSize)
  );
}

function usesGeminiAspectRatioImageModel(model?: string): boolean {
  const normalizedModel = resolveImageCapabilityModelId(model);
  return normalizedModel.length > 0 && GEMINI_ASPECT_RATIO_IMAGE_MODELS.has(normalizedModel);
}

function supportsGeminiImageSizeConfig(model?: string): boolean {
  const normalizedModel = resolveImageCapabilityModelId(model);
  return supportsImageModelImageSizeConfig(normalizedModel);
}

export function shouldUseImageEditsApi(model?: string, referenceImageCount = 0): boolean {
  const normalizedModel = normalizeImageRequestModel(model);
  return (
    normalizedModel.length > 0 &&
    referenceImageCount > 0 &&
    SUPPORTED_OPENAI_COMPATIBLE_IMAGE_MODELS.has(normalizedModel)
  );
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
} {
  if (error instanceof ImageGenerationError) {
    return {
      failureClass: error.failureClass || (error.statusCode && error.statusCode >= 400 ? "upstream_http" : "unknown"),
      isRetryable: Boolean(error.isRetryable),
    };
  }

  if (error instanceof Error && error.name === "AbortError") {
    return {
      failureClass: "timeout",
      isRetryable: false,
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
      causeMessage?.includes("other side closed") ||
      causeMessage?.includes("client network socket disconnected before secure tls connection was established")
    )
  ) {
    return {
      failureClass: "transport",
      isRetryable: true,
    };
  }

  return {
    failureClass: "unknown",
    isRetryable: false,
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

const asyncImageSubmitTimeoutMs = parsePositiveInt(process.env.COMFLY_ASYNC_IMAGE_SUBMIT_TIMEOUT_MS, 1800000);
const asyncImagePollTimeoutMs = parsePositiveInt(process.env.COMFLY_ASYNC_POLL_TIMEOUT_MS, 1800000);
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

  const model = normalizeImageRequestModel(request.model);
  const capabilityModelId = resolveImageCapabilityModelId(model);
  if (!isGeminiOfficialImageModel(model)) {
    throw new ImageGenerationError(`Gemini official image request failed: model "${request.model}" is not supported`, 400);
  }

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
  if (usesGeminiAspectRatioImageModel(model)) {
    imageConfig.aspectRatio = aspectRatio;
  }
  if (supportsGeminiImageSizeConfig(model)) {
    imageConfig.imageSize = imageSize;
  }

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
    imageSize: supportsGeminiImageSizeConfig(model) ? imageSize : null,
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

  const timeoutMs = 120000;
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
        throw new ImageGenerationError(
          `Gemini official image request failed: ${errorText || response.statusText}`,
          response.status,
          {
            failureClass: "upstream_http",
            isRetryable: false,
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
        imageSize: supportsGeminiImageSizeConfig(model) ? imageSize : null,
        aspectRatio,
      });

      if (outputs.length === 0) {
        const classification = classifyGeminiImagePayload(payloadSummary);
        basicLog("[SUPPLIER][PARSE_EMPTY]", {
          endpoint: `/v1beta/models/${resolvedRequestModel}:generateContent`,
          executionMode: request.executionMode === "async" ? "async" : "sync",
          imageSize: supportsGeminiImageSizeConfig(model) ? imageSize : null,
          aspectRatio,
          classification,
          candidateCount: payloadSummary.candidateCount,
          finishReasons: payloadSummary.finishReasons,
          promptBlockReason: payloadSummary.promptBlockReason,
          promptSafetyRatings: payloadSummary.promptSafetyRatings,
          candidateSafetyRatings: payloadSummary.candidateSafetyRatings,
          partTypes: payloadSummary.partTypes,
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
          isRetryable: false,
          retryAttempt: attempt,
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
        imageSize: supportsGeminiImageSizeConfig(model) ? imageSize : null,
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
      debugError("[SUPPLIER][ERR]", {
        endpoint: `/v1beta/models/${resolvedRequestModel}:generateContent`,
        mode: "gemini_official_image",
        requestedModel,
        normalizedModel: model,
        resolvedRequestModel: resolvedRequestModel,
        imageSize: supportsGeminiImageSizeConfig(model) ? imageSize : null,
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

      if (failureState.isRetryable && attempt < maxAttempts) {
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
        throw error;
      }
      throw new ImageGenerationError(
        error instanceof Error ? `Gemini official image request failed: ${error.message}` : "Gemini official image request failed",
        502,
        {
          failureClass: failureState.failureClass,
          isRetryable: failureState.isRetryable,
          retryAttempt: attempt,
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
  if (!isOpenAiCompatibleImageModel(model)) {
    throw new ImageGenerationError(`OpenAI compatible image request failed: model "${request.model}" is not supported`, 400);
  }

  const prompt = typeof request.prompt === "string" ? request.prompt : "";
  const referenceImages = Array.isArray(request.images) ? request.images.filter(Boolean) : [];
  const usesImageEditsApi = provider.imageRequestMode === "openai-json"
    ? false
    : shouldUseImageEditsApi(model, referenceImages.length);
  const mirrorsInfiniteCanvasGptImage2TextToImage =
    provider.imageRequestMode === "openai" &&
    isGptImage2Model(model) &&
    referenceImages.length === 0;
  const requestedExecutionMode = request.executionMode === "async" ? "async" : "sync";
  const executionMode = (mirrorsInfiniteCanvasGptImage2TextToImage || usesImageEditsApi) ? "sync" : requestedExecutionMode;
  const endpointPath = usesImageEditsApi ? "/images/edits" : "/images/generations";
  const baseEndpoint = usesImageEditsApi ? imageEditUrl : imageGenerationUrl;
  const endpoint = baseEndpoint;
  const supportsAspectRatio = getImageModelCapability(model).supportsAspectRatio;
  const aspectRatio = supportsAspectRatio ? (normalizeAspectRatio(request.aspect_ratio) || toAspectRatio(request.size)) : "";
  const imageSize = typeof request.size === "string" && request.size.trim() ? request.size.trim() : null;
  const requestedImageQuality = typeof request.quality === "string" ? request.quality.trim().toLowerCase() : "";
  const imageQuality = ["low", "medium", "high"].includes(requestedImageQuality) ? requestedImageQuality : null;
  const shouldSendTopLevelResponseFormat = !usesImageEditsApi && provider.imageRequestMode !== "openai-json" && !mirrorsInfiniteCanvasGptImage2TextToImage;
  const defaultOpenAiImageResponseFormat = { response_format: "url" };
  const maxAttempts = 2;
  const requestBody: Record<string, unknown> = {
    model,
    prompt,
  };

  if (isGptImage2Model(model) && imageSize) {
    const gptImage2SizeError = getGptImage2SizeValidationError(imageSize);
    if (gptImage2SizeError) {
      throw new ImageGenerationError(`gpt-image-2 尺寸不合法: ${gptImage2SizeError}`, 400, {
        failureClass: "payload",
        isRetryable: false,
        retryAttempt: 1,
      });
    }
  }

  if (imageSize) {
    requestBody.size = imageSize;
  }
  if (imageQuality && provider.imageRequestMode !== "openai-json") {
    requestBody.quality = imageQuality;
  }
  if (shouldSendTopLevelResponseFormat) {
    requestBody.response_format = request.response_format || "url";
  }
  if (supportsAspectRatio && aspectRatio) {
    requestBody.aspect_ratio = aspectRatio;
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

  let requestPayload: string | FormData;
  let requestHeaders: Record<string, string>;
  if (usesImageEditsApi) {
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
    if (supportsAspectRatio && aspectRatio) {
      formData.set("aspect_ratio", aspectRatio);
    }

    const referenceBlobs = await Promise.all(referenceImages.map((image) => referenceToBlob(image, request.signal)));
    referenceBlobs.forEach(({ blob, mimeType }, index) => {
      formData.append("image", blob, `reference-${index + 1}.${mimeTypeToFileExtension(mimeType)}`);
    });

    requestPayload = formData;
    requestHeaders = {
      Authorization: bearerAuthorizationHeader(apiKey),
    };
  } else {
    requestPayload = JSON.stringify(requestBody);
    requestHeaders = {
      "Content-Type": "application/json",
      Authorization: bearerAuthorizationHeader(apiKey),
    };
  }

  const buildEditsFallbackPayload = async () => {
    const formData = new FormData();
    formData.set("model", model);
    if (prompt) formData.set("prompt", prompt);
    if (imageSize) formData.set("size", imageSize);
    if (imageQuality) formData.set("quality", imageQuality);
    if (supportsAspectRatio && aspectRatio) formData.set("aspect_ratio", aspectRatio);
    const referenceBlobs = await Promise.all(referenceImages.map((image) => referenceToBlob(image, request.signal)));
    referenceBlobs.forEach(({ blob, mimeType }, index) => {
      formData.append("image", blob, `reference-${index + 1}.${mimeTypeToFileExtension(mimeType)}`);
    });
    return formData;
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

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    let requestStartedAt = Date.now();
    let responseEndpoint = endpoint;
    let responseEndpointPath = endpointPath;
    let responseUsesImageEditsApi = usesImageEditsApi;

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
          aspectRatio,
          referenceCount: referenceImages.length,
          usesImageEditsApi: nextUsesImageEditsApi,
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
        if (!usesImageEditsApi && imagesApiUnsupportedText(errorText)) {
          response = await postImageRequest(
            imageEditUrl,
            "/images/edits",
            true,
            await buildEditsFallbackPayload(),
            { Authorization: bearerAuthorizationHeader(apiKey) }
          );
        } else if (usesImageEditsApi && !isGptImage2Model(model)) {
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
          throw new ImageGenerationError(
            `OpenAI compatible image request failed: ${errorText || response.statusText}`,
            response.status,
            {
              failureClass: "upstream_http",
              isRetryable: false,
              retryAttempt: attempt,
            }
          );
        }
      }

      if (!response.ok) {
        const errorText = await response.text();
        throw new ImageGenerationError(
          `OpenAI compatible image request failed: ${errorText || response.statusText}`,
          response.status,
          {
            failureClass: "upstream_http",
            isRetryable: false,
            retryAttempt: attempt,
          }
        );
      }

      const payload = await response.json();
      const outputs = toImageEntries(payload);

      basicLog("[SUPPLIER][PARSE]", {
        endpoint: responseEndpointPath,
        mode: "openai_compatible_image",
        executionMode,
        imageCount: outputs.length,
        imageSize,
        aspectRatio,
        referenceCount: referenceImages.length,
        usesImageEditsApi: responseUsesImageEditsApi,
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
          aspectRatio,
          referenceCount: referenceImages.length,
        });
      }

      if (outputs.length === 0) {
        basicLog("[SUPPLIER][PARSE_EMPTY]", {
          endpoint: responseEndpointPath,
          mode: "openai_compatible_image",
          executionMode,
          imageSize,
          aspectRatio,
          referenceCount: referenceImages.length,
          usesImageEditsApi: responseUsesImageEditsApi,
          ...summarizeImagePayloadCounts(payload),
        });
        throw new ImageGenerationError("OpenAI compatible image request returned no images", 502, {
          failureClass: "payload",
          isRetryable: false,
          retryAttempt: attempt,
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
        aspectRatio,
        referenceCount: referenceImages.length,
        usesImageEditsApi: responseUsesImageEditsApi,
        failureClass: failureState.failureClass,
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

      if (failureState.isRetryable && attempt < maxAttempts) {
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
        throw error;
      }

      throw new ImageGenerationError(
        error instanceof Error ? `OpenAI compatible image request failed: ${error.message}` : "OpenAI compatible image request failed",
        502,
        {
          failureClass: failureState.failureClass,
          isRetryable: failureState.isRetryable,
          retryAttempt: attempt,
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
  const alias = resolveImageModelAlias(requestedModel);
  const normalizedModel = normalizeImageRequestModel(alias.model);
  const normalizedRequest = {
    ...request,
    model: normalizedModel,
    requestedModel,
    images,
    ...(request.size || !alias.resolution ? {} : { size: imageSizeForResolution(alias.resolution) }),
  };
  const { protocol } = await getProviderTransport({
    providerId: request.providerId,
    model: requestedModel,
    purpose: "image",
  });

  if (protocol === "gemini" && isGeminiOfficialImageModel(normalizedModel)) {
    return generateGeminiOfficialImage(normalizedRequest);
  }

  if (isOpenAiCompatibleImageModel(normalizedModel)) {
    return generateOpenAiCompatibleImage(normalizedRequest);
  }

  throw new ImageGenerationError(`Image generation failed: model "${request.model}" is not supported`, 400);
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

export interface ChatRequest {
  model: string;
  providerId?: string;
  messages: ChatMessage[];
  tools?: ChatToolDefinition[];
  toolChoice?: ChatToolChoice;
  signal?: AbortSignal;
  imagesMaterialized?: boolean;
  imageMaterializationStats?: { localImageCount: number; totalImageBytes: number };
}

export interface ChatStreamRequest extends ChatRequest {
  stream?: boolean;
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
  const systemTexts = messages
    .filter((msg) => msg.role === "system")
    .flatMap((msg) => {
      if (typeof msg.content === "string") {
        return [msg.content];
      }
      return msg.content
        .filter((part) => part.type === "text")
        .map((part) => part.text);
    })
    .filter(Boolean);

  const contents: Array<{ role: "user" | "model"; parts: Array<Record<string, unknown>> }> = [];
  let pendingToolResponses: Array<Record<string, unknown>> = [];
  const flushToolResponses = () => {
    if (pendingToolResponses.length === 0) return;
    contents.push({ role: "user", parts: pendingToolResponses });
    pendingToolResponses = [];
  };

  for (const msg of messages.filter((message) => message.role !== "system")) {
      if (msg.role === "tool") {
        let response: unknown = msg.content;
        if (typeof msg.content === "string") {
          try {
            response = JSON.parse(msg.content);
          } catch {
            response = { content: msg.content };
          }
        }
        pendingToolResponses.push({
          functionResponse: {
            name: msg.name || "tool",
            response: response && typeof response === "object" ? response : { result: response },
            ...(msg.tool_call_id && !isSyntheticGeminiToolCallId(msg.tool_call_id) ? { id: msg.tool_call_id } : {}),
          },
        });
        continue;
      }

      flushToolResponses();

      const replayedParts = msg.role === "assistant"
        ? replayGeminiParts(msg.geminiParts || [], msg.geminiSourceModel, model)
        : null;
      const parts: Array<Record<string, unknown>> = replayedParts
        || (typeof msg.content === "string"
          ? (msg.content ? [{ text: msg.content }] : [])
          : await Promise.all(msg.content.map(async (part) => {
              if (part.type === "text") return { text: part.text };
              return referenceToInlineData(part.image_url.url, signal);
            })));
      if (!replayedParts && msg.role === "assistant" && Array.isArray(msg.tool_calls)) {
        for (const toolCall of msg.tool_calls) parts.push(geminiToolCallToPart(toolCall));
      }
      if (parts.length === 0) continue;
      contents.push({
        role: msg.role === "assistant" ? ("model" as const) : ("user" as const),
        parts,
      });
  }
  flushToolResponses();

  return {
    systemInstruction: systemTexts.length > 0
      ? {
          parts: [{ text: systemTexts.join("\n\n") }],
        }
      : undefined,
    contents,
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
  for (const [contentIndex, content] of contents.entries()) {
    for (const [partIndex, part] of (Array.isArray(content.parts) ? content.parts : []).entries()) {
      if (!part || typeof part !== "object" || Array.isArray(part)) {
        throw new ImageGenerationError(`Invalid Gemini Part at contents[${contentIndex}].parts[${partIndex}]`, 400, {
          failureClass: "payload",
          isRetryable: false,
        });
      }
      if ("inline_data" in part || "file_data" in part || "thought_signature" in part) {
        throw new ImageGenerationError(`Invalid Gemini Part field at contents[${contentIndex}].parts[${partIndex}]`, 400, {
          failureClass: "payload",
          isRetryable: false,
        });
      }
      const hasData = (
        (typeof part.text === "string" && part.text.length > 0)
          || Boolean(part.functionCall)
          || Boolean(part.functionResponse)
          || Boolean(part.inlineData)
          || Boolean(part.fileData)
          || Boolean(part.executableCode)
          || Boolean(part.codeExecutionResult)
      );
      if (!hasData) {
        throw new ImageGenerationError(`Empty Gemini Part at contents[${contentIndex}].parts[${partIndex}]`, 400, {
          failureClass: "payload",
          isRetryable: false,
        });
      }
      if (part.inlineData) {
        const inlineData = part.inlineData as { mimeType?: unknown; data?: unknown };
        const mimeType = typeof inlineData.mimeType === "string" ? inlineData.mimeType : "";
        const data = typeof inlineData.data === "string" ? inlineData.data : "";
        if (!mimeType.startsWith("image/") || !data) {
          throw new ImageGenerationError(`Invalid Gemini inlineData at contents[${contentIndex}].parts[${partIndex}]`, 400, {
            failureClass: "payload",
            isRetryable: false,
          });
        }
      }
      if (part.functionResponse && typeof part.functionResponse === "object" && !Array.isArray(part.functionResponse)
        && "thoughtSignature" in part.functionResponse) {
        throw new ImageGenerationError(`Gemini functionResponse cannot contain thoughtSignature at contents[${contentIndex}].parts[${partIndex}]`, 400, {
          failureClass: "payload",
          isRetryable: false,
        });
      }
    }
  }
}

function extractGeminiTextResponse(payload: GeminiGenerateContentPayload): {
  content: string;
  reasoning: string;
  toolCalls: ChatToolCall[];
  geminiParts: GeminiContentPart[];
} {
  const parts = normalizeGeminiParts(Array.isArray(payload.candidates?.[0]?.content?.parts)
    ? payload.candidates?.[0]?.content?.parts || []
    : []);
  let content = "";
  let reasoning = "";
  const toolCalls = extractGeminiToolCalls(parts) as ChatToolCall[];

  for (const part of parts) {
    if (typeof part?.text === "string" && part.text) {
      if (part.thought) reasoning += part.text;
      else content += part.text;
    }
  }

  return { content, reasoning, toolCalls, geminiParts: parts };
}

function resolveGeminiFunctionCallingConfig(toolChoice?: ChatToolChoice): {
  mode: 'AUTO' | 'NONE' | 'ANY';
  allowedFunctionNames?: string[];
} {
  if (toolChoice === 'none') return { mode: 'NONE' };
  if (toolChoice === 'required') return { mode: 'ANY' };
  if (toolChoice && typeof toolChoice === 'object') {
    return {
      mode: 'ANY',
      allowedFunctionNames: [toolChoice.function.name],
    };
  }
  return { mode: 'AUTO' };
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
  isRetryable: boolean;
} {
  const normalized = errorText.toLowerCase();
  return {
    failureClass: 'upstream_http',
    isRetryable: status === 524 || (status === 404 && normalized.includes('no enabled channel for model')),
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
    ? `${getGeminiOfficialApiBaseUrl(providerTargets)}/v1beta/models/${model}:generateContent`
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
          messages: requestMessages,
          ...(request.tools?.length
            ? {
                tools: request.tools,
                tool_choice: request.toolChoice || "auto",
              }
            : {}),
        };
    if (!isGeminiModel) {
      (requestBody as { messages: ChatRequest["messages"] }).messages = stripGeminiThoughtSignatures(requestMessages);
    }
    if (isGeminiModel) {
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
    ? `${getGeminiOfficialApiBaseUrl(providerTargets)}/v1beta/models/${model}:streamGenerateContent?alt=sse`
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
          messages: requestMessages,
          stream: true,
          ...(request.tools?.length
            ? {
                tools: request.tools,
                tool_choice: request.toolChoice || "auto",
              }
            : {}),
        };
    if (!isGeminiModel) {
      (requestBody as { messages: ChatRequest["messages"] }).messages = stripGeminiThoughtSignatures(requestMessages);
    }
    if (isGeminiModel) {
      const geminiContents = (requestBody as { contents: Array<{ role: string; parts: Array<Record<string, unknown>> }> }).contents;
      validateGeminiContents(geminiContents);
      basicLog("[SUPPLIER][GEMINI_PARTS]", { mode: "chat_stream", contents: summarizeGeminiContents(geminiContents) });
    }

    response = await fetch(endpoint, {
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

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const eventDecoder = createChatStreamEventDecoder();
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

export const AVAILABLE_MODELS = [
  { id: "gemini-2.0-flash-exp", name: "Gemini 2.0 Flash", provider: "Google" },
  { id: "gemini-3-pro-image-preview", name: "Gemini 3 Pro (Image)", provider: "Google" },
  { id: "gemini-2.5-flash-image", name: "Gemini 2.5 Flash Image", provider: "Google" },
  { id: "gemini-3.1-flash-image-preview", name: "Gemini 3.1 Flash Image", provider: "Google" },
  { id: "gemini-3.1-flash", name: "Gemini 3.1 Flash", provider: "Google" },
  { id: "gemini-3.5-flash", name: "Gemini 3.5 Flash", provider: "Google" },
  { id: "gemini-3.5-flash-preview-05-20", name: "Gemini 3.5 Flash (Preview)", provider: "Google" },
  { id: "flux/schnell", name: "Flux Schnell", provider: "Flux" },
  { id: "flux/dev", name: "Flux Dev", provider: "Flux" },
  { id: "flux-pro", name: "Flux Pro", provider: "Flux" },
  { id: "dall-e-3", name: "DALL-E 3", provider: "OpenAI" },
  { id: "gpt-image-1", name: "GPT Image 1", provider: "OpenAI" },
  { id: "gpt-image-2", name: "GPT Image 2", provider: "OpenAI" },
  { id: "stable-diffusion-v3-medium", name: "SD3 Medium", provider: "Stability AI" },
];

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
