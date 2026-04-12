import { createLogger } from "./logger";
import {
  buildGeminiNoImageErrorMessage,
  classifyGeminiImagePayload,
  extractGeminiImageOutputs,
  summarizeGeminiImagePayload,
} from "./gemini-image-response.mjs";
import { getGeminiImageSizeEnum, getImageModelCapability, resolveImageRequestModel, supportsImageModelImageSizeConfig, supportsImageModelRequestedSize } from "./image-model-capabilities.mjs";
import { readProviderConfig, resolveProviderRequestTargets } from "./provider-config.mjs";
const LOG_LEVEL = (process.env.LOG_LEVEL || "basic").toLowerCase();
const LOG_ENABLED = LOG_LEVEL !== "off";
const LOG_DEBUG = LOG_LEVEL === "debug";
const SUPPORTED_GEMINI_OFFICIAL_IMAGE_MODELS = new Set([
  "gemini-2.5-flash-image",
  "gemini-3.1-flash-image-preview",
  "gemini-3-pro-image-preview",
]);
const EXACT_IMAGE_SIZE_REQUEST_SIZES = new Set([
  "1024x1024",
  "2048x2048",
  "4096x4096",
]);
const GEMINI_ASPECT_RATIO_IMAGE_MODELS = new Set([
  "gemini-2.5-flash-image",
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

interface AsyncImageTaskSubmitResponse {
  task_id?: string;
  id?: string;
}

interface AsyncImageTaskResultResponse {
  status?: string;
  data?: Array<{ url: string; revised_prompt?: string }> | { status?: string };
  result?: {
    status?: string;
  };
  output?: {
    status?: string;
  };
}

export interface UnifiedImageRequest {
  model: string;
  prompt: string;
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

async function getProviderTransport() {
  const providerConfig = await readProviderConfig();
  const providerTargets = resolveProviderRequestTargets(providerConfig.config.baseUrl);
  return {
    providerConfig,
    providerTargets,
    apiKey: providerConfig.config.apiKey,
  };
}

function normalizeImageModelKey(model?: string): string {
  return typeof model === "string" ? model.trim() : "";
}

function normalizeImageRequestModel(model?: string): string {
  const normalizedModel = normalizeImageModelKey(model);
  return normalizedModel;
}

function isGeminiOfficialImageModel(model?: string): boolean {
  const normalizedModel = normalizeImageRequestModel(model);
  return normalizedModel.length > 0 && SUPPORTED_GEMINI_OFFICIAL_IMAGE_MODELS.has(normalizedModel);
}

export function shouldUseExactImageSizeApi(model?: string, size?: string): boolean {
  const normalizedModel = normalizeImageRequestModel(model);
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
  const normalizedModel = normalizeImageRequestModel(model);
  return normalizedModel.length > 0 && GEMINI_ASPECT_RATIO_IMAGE_MODELS.has(normalizedModel);
}

function supportsGeminiImageSizeConfig(model?: string): boolean {
  const normalizedModel = normalizeImageRequestModel(model);
  return supportsImageModelImageSizeConfig(normalizedModel);
}

export function shouldUseImageEditsApi(model?: string, referenceImageCount = 0): boolean {
  return false;
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

function resolveSupplierExecutionMode(
  requestedMode: "sync" | "async" | undefined,
  model?: string
): "sync" | "async" {
  if (requestedMode === "sync" || requestedMode === "async") {
    return requestedMode;
  }

  return "sync";
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

const asyncImageSubmitTimeoutMs = parsePositiveInt(process.env.COMFLY_ASYNC_IMAGE_SUBMIT_TIMEOUT_MS, 600000);

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

function extractTaskId(payload: AsyncImageTaskSubmitResponse): string {
  const taskId = payload.task_id || payload.id;
  if (!taskId || typeof taskId !== "string") {
    throw new ImageGenerationError("Missing task_id from async image response", 502);
  }
  return taskId;
}

function toImageEntries(input: unknown, depth = 0): Array<{ url: string; revised_prompt?: string }> {
  if (depth > 4 || input == null) return [];

  if (typeof input === "string") {
    const trimmed = input.trim();
    if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
      return [{ url: trimmed }];
    }
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
        const obj = item as { url?: unknown; revised_prompt?: unknown };
        if (typeof obj.url !== "string" || !obj.url) return null;
        return {
          url: obj.url,
          revised_prompt: typeof obj.revised_prompt === "string" ? obj.revised_prompt : undefined,
        };
      })
      .filter(Boolean) as Array<{ url: string; revised_prompt?: string }>;
    if (direct.length > 0) return direct;

    const nested: Array<{ url: string; revised_prompt?: string }> = [];
    for (const item of input) {
      nested.push(...toImageEntries(item, depth + 1));
    }
    return nested;
  }

  if (typeof input === "object") {
    const obj = input as Record<string, unknown>;

    if (typeof obj.url === "string" && obj.url) {
      return [{
        url: obj.url,
        revised_prompt: typeof obj.revised_prompt === "string" ? obj.revised_prompt : undefined,
      }];
    }

    const keys = ["data", "result", "output", "image", "images"];
    for (const key of keys) {
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
    throw new ImageGenerationError("Invalid data URL for edit image", 400);
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

async function referenceToBlob(input: string, signal?: AbortSignal): Promise<{ blob: Blob; mimeType: string }> {
  if (input.startsWith("data:image/")) {
    return dataUrlToBlob(input);
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
      referencePreview: input.slice(0, 120),
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
): Promise<{ inline_data: { mime_type: string; data: string } }> {
  const { blob, mimeType } = await referenceToBlob(input, signal);
  return {
    inline_data: {
      mime_type: mimeType,
      data: await blobToBase64(blob),
    },
  };
}

async function generateGeminiOfficialImage(request: UnifiedImageRequest): Promise<GenerationResponse> {
  const { providerConfig, providerTargets, apiKey } = await getProviderTransport();
  if (!apiKey) {
    throw new ImageGenerationError("Please configure a supplier API Key in settings or environment");
  }

  const model = normalizeImageRequestModel(request.model);
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
  const parts: Array<{ text: string } | { inline_data: { mime_type: string; data: string } }> = [
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

  basicLog("[SUPPLIER][PREP]", {
    endpointBase: getGeminiOfficialApiBaseUrl(providerTargets),
    endpoint: `/v1beta/models/${resolvedRequestModel}:generateContent`,
    mode: "gemini_official_image",
    requestedModel: request.model,
    normalizedModel: model,
    resolvedRequestModel: resolvedRequestModel,
    imageSize: supportsGeminiImageSizeConfig(model) ? imageSize : null,
    aspectRatio,
    n: request.n || 1,
    referenceCount: referenceImages.length,
    executionMode: request.executionMode === "async" ? "async" : "sync",
    providerId: providerConfig.config.providerId,
    apiKeyMasked: maskToken(apiKey),
  });
  debugLog("[SUPPLIER][PREP_PROMPT]", {
    promptPreview: prompt.slice(0, 200),
  });

  const timeoutMs = 120000;
  const maxAttempts = 2;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    let requestStartedAt = Date.now();

    try {
      requestStartedAt = Date.now();
      basicLog("[SUPPLIER][REQ]", {
        method: "POST",
        endpoint,
        host: getEndpointHost(endpoint),
        mode: "gemini_official_image",
        attempt,
        maxAttempts,
      });

      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
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
        requestedModel: request.model,
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
        requestedModel: request.model,
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
    }
  }

  throw new ImageGenerationError("Gemini official image request failed", 502, {
    failureClass: "unknown",
    isRetryable: false,
    retryAttempt: maxAttempts,
  });
}

export async function runImageTask(request: UnifiedImageRequest): Promise<GenerationResponse> {
  const images = Array.isArray(request.images) ? request.images.filter(Boolean) : [];
  const normalizedModel = normalizeImageRequestModel(request.model);

  if (shouldUseExactImageSizeApi(normalizedModel, request.size)) {
    return generateGeminiOfficialImage({
      ...request,
      model: normalizedModel,
      images,
    });
  }

  if (isGeminiOfficialImageModel(normalizedModel)) {
    return generateGeminiOfficialImage({
      ...request,
      model: normalizedModel,
      images,
    });
  }

  throw new ImageGenerationError(`Image generation failed: model "${request.model}" is not supported`, 400);
}

export interface ChatRequest {
  model: string;
  messages: Array<{
    role: 'user' | 'assistant' | 'system';
    content:
      | string
      | Array<
          | { type: 'text'; text: string }
          | { type: 'image_url'; image_url: { url: string } }
        >;
  }>;
  signal?: AbortSignal;
}

export interface ChatStreamRequest extends ChatRequest {
  stream?: boolean;
}

export interface ChatResponse {
  choices: Array<{
    message: {
      content: string;
      reasoning_content?: string;
    };
  }>;
}

type SupplierChatStreamPayload = {
  choices?: Array<{
    delta?: {
      content?: string;
      reasoning_content?: string;
    };
    message?: {
      content?: string;
      reasoning_content?: string;
    };
  }>;
};

type GeminiContentPart = {
  text?: string;
  thought?: boolean;
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
  | { type: "delta"; channel: "content" | "reasoning"; content: string }
  | { type: "done" };

function extractStreamDeltaEvents(parsed: SupplierChatStreamPayload): ChatStreamEvent[] {
  if ("candidates" in parsed) {
    const geminiParsed = parsed as unknown as GeminiGenerateContentPayload;
    const parts = Array.isArray(geminiParsed.candidates?.[0]?.content?.parts)
      ? geminiParsed.candidates?.[0]?.content?.parts || []
      : [];
    const events: ChatStreamEvent[] = [];
    for (const part of parts) {
      if (!part || typeof part.text !== "string" || !part.text) {
        continue;
      }
      if (part.thought) {
        events.push({ type: "delta", channel: "reasoning", content: part.text });
      } else {
        events.push({ type: "delta", channel: "content", content: part.text });
      }
    }
    return events;
  }

  const content =
    parsed.choices?.[0]?.delta?.content ??
    parsed.choices?.[0]?.message?.content ??
    "";
  const reasoning =
    parsed.choices?.[0]?.delta?.reasoning_content ??
    parsed.choices?.[0]?.message?.reasoning_content ??
    "";

  const events: ChatStreamEvent[] = [];
  if (reasoning) {
    events.push({ type: "delta", channel: "reasoning", content: reasoning });
  }
  if (content) {
    events.push({ type: "delta", channel: "content", content });
  }
  return events;
}

function isGeminiOfficialTextModel(model?: string): boolean {
  const normalizedModel = normalizeImageModelKey(model);
  return normalizedModel.startsWith("gemini-");
}

async function convertChatMessagesToGeminiRequest(
  messages: ChatRequest["messages"],
  signal?: AbortSignal
): Promise<{
  systemInstruction?: { parts: Array<{ text: string }> };
  contents: Array<{ role: "user" | "model"; parts: Array<{ text: string } | { inline_data: { mime_type: string; data: string } }> }>;
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

  const contents = await Promise.all(
    messages
      .filter((msg) => msg.role !== "system")
      .map(async (msg) => {
        const parts = typeof msg.content === "string"
          ? [{ text: msg.content }]
          : await Promise.all(
              msg.content.map(async (part) => {
                if (part.type === "text") {
                  return { text: part.text };
                }
                return referenceToInlineData(part.image_url.url, signal);
              })
            );

        return {
          role: msg.role === "assistant" ? ("model" as const) : ("user" as const),
          parts,
        };
      })
  );

  return {
    systemInstruction: systemTexts.length > 0
      ? {
          parts: [{ text: systemTexts.join("\n\n") }],
        }
      : undefined,
    contents,
  };
}

function extractGeminiTextResponse(payload: GeminiGenerateContentPayload): { content: string; reasoning: string } {
  const parts = Array.isArray(payload.candidates?.[0]?.content?.parts)
    ? payload.candidates?.[0]?.content?.parts || []
    : [];
  let content = "";
  let reasoning = "";

  for (const part of parts) {
    if (!part || typeof part.text !== "string" || !part.text) {
      continue;
    }

    if (part.thought) {
      reasoning += part.text;
    } else {
      content += part.text;
    }
  }

  return { content, reasoning };
}

export async function chat(
  request: ChatRequest
): Promise<ChatResponse> {
  const { providerConfig, providerTargets, apiKey } = await getProviderTransport();
  if (!apiKey) {
    throw new ImageGenerationError(
      "Please configure a supplier API Key in settings or environment"
    );
  }

  const model = normalizeImageModelKey(request.model);
  const isGeminiModel = isGeminiOfficialTextModel(model);
  const endpoint = isGeminiModel
    ? `${getGeminiOfficialApiBaseUrl(providerTargets)}/v1beta/models/${model}:generateContent`
    : `${providerTargets.openAiBaseUrl}/chat/completions`;
  const attempt = 1;
  const maxAttempts = 1;
  let requestStartedAt = Date.now();

  try {
    requestStartedAt = Date.now();
    basicLog("[SUPPLIER][REQ]", {
      method: "POST",
      endpoint,
      host: getEndpointHost(endpoint),
      mode: "chat",
      model,
      messageCount: request.messages.length,
      providerId: providerConfig.config.providerId,
      attempt,
      maxAttempts,
    });

    const requestBody = isGeminiModel
      ? await convertChatMessagesToGeminiRequest(request.messages, request.signal)
      : { model, messages: request.messages };

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(requestBody),
      signal: request.signal,
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new ImageGenerationError(
        error.error?.message || `API request failed with status ${response.status}`,
        response.status
      );
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
          },
        },
      ],
    };
  } catch (error) {
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
  const { providerConfig, providerTargets, apiKey } = await getProviderTransport();
  if (!apiKey) {
    throw new ImageGenerationError(
      "Please configure a supplier API Key in settings or environment"
    );
  }

  const model = normalizeImageModelKey(request.model);
  const isGeminiModel = isGeminiOfficialTextModel(model);
  const endpoint = isGeminiModel
    ? `${getGeminiOfficialApiBaseUrl(providerTargets)}/v1beta/models/${model}:streamGenerateContent?alt=sse`
    : `${providerTargets.openAiBaseUrl}/chat/completions`;
  const attempt = 1;
  const maxAttempts = 1;
  let requestStartedAt = Date.now();
  let response;

  try {
    requestStartedAt = Date.now();
    basicLog("[SUPPLIER][REQ]", {
      method: "POST",
      endpoint,
      host: getEndpointHost(endpoint),
      mode: "chat_stream",
      model,
      messageCount: request.messages.length,
      providerId: providerConfig.config.providerId,
      attempt,
      maxAttempts,
    });

    const requestBody = isGeminiModel
      ? await convertChatMessagesToGeminiRequest(request.messages, request.signal)
      : {
          model,
          messages: request.messages,
          stream: true,
        };

    response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(requestBody),
      signal: request.signal,
    });

    if (!response.ok) {
      const errorText = await response.text();
      debugError("Supplier chat stream error:", {
        status: response.status,
        model,
        raw: errorText,
      });
      const error = parseErrorPayload(errorText);
      throw new ImageGenerationError(
        (error.error as { message?: string } | undefined)?.message ||
          `API request failed with status ${response.status}: ${errorText}`,
        response.status
      );
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
  } catch (error) {
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
        yield { type: "done" };
        return;
      }

      try {
        const parsed = JSON.parse(payload) as SupplierChatStreamPayload;
        for (const event of extractStreamDeltaEvents(parsed)) {
          yield event;
        }
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
        for (const event of extractStreamDeltaEvents(parsed)) {
          yield event;
        }
      } catch {
        // ignore malformed tail chunk
      }
    }
  }

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
