import { createLogger } from "./logger";

const API_URL =
  process.env.COMFLY_API_URL ||
  process.env.GPT_BEST_BASE_URL ||
  "https://ai.comfly.chat/v1";
const API_KEY =
  process.env.COMFLY_API_KEY ||
  process.env.GPT_BEST_API_KEY ||
  "";
const LOG_LEVEL = (process.env.LOG_LEVEL || "basic").toLowerCase();
const LOG_ENABLED = LOG_LEVEL !== "off";
const LOG_DEBUG = LOG_LEVEL === "debug";
const SUPPORTED_GEMINI_OFFICIAL_IMAGE_MODELS = new Set([
  "gemini-3-pro-image-preview",
  "gemini-3.1-flash-image-preview",
]);
const EXACT_IMAGE_SIZE_REQUEST_SIZES = new Set([
  "1024x1024",
  "2048x2048",
  "4096x4096",
]);
const SUPPLIER_REFERENCE_IMAGE_GENERATIONS_MODELS = new Set([
  "gemini-3.1-flash-image-preview",
]);
const SUPPLIER_IMAGE_EDITS_MODELS = new Set([
  "nano-banana-2",
]);
const SUPPLIER_ASPECT_RATIO_IMAGE_MODELS = new Set([
  "gemini-3.1-flash-image-preview",
  "gemini-3-pro-image-preview",
  "nano-banana-2",
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

interface AsyncImageTaskSubmitResponse {
  task_id?: string;
  id?: string;
  status?: string;
  message?: string;
  error?: { message?: string } | string;
  data?:
    | Array<{ url: string; revised_prompt?: string }>
    | { status?: string; data?: Array<{ url: string; revised_prompt?: string }> };
  result?: {
    status?: string;
    data?: Array<{ url: string; revised_prompt?: string }>;
  };
  output?: {
    status?: string;
    data?: Array<{ url: string; revised_prompt?: string }>;
  };
}

interface AsyncImageTaskResultResponse {
  status?: string;
  message?: string;
  error?: { message?: string } | string;
  last_error?: { message?: string } | string;
  data?:
    | Array<{ url: string; revised_prompt?: string }>
    | { status?: string; data?: Array<{ url: string; revised_prompt?: string }> };
  result?: {
    status?: string;
    data?: Array<{ url: string; revised_prompt?: string }>;
  };
  output?: {
    status?: string;
    data?: Array<{ url: string; revised_prompt?: string }>;
  };
}

export class ImageGenerationError extends Error {
  constructor(message: string, public statusCode?: number) {
    super(message);
    this.name = "ImageGenerationError";
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

function getGeminiOfficialApiBaseUrl(): string {
  const trimmed = API_URL.replace(/\/+$/, "");
  if (trimmed.endsWith("/v1")) {
    return trimmed.slice(0, -3);
  }
  return trimmed;
}

function normalizeImageModelKey(model?: string): string {
  return typeof model === "string" ? model.trim() : "";
}

function isGeminiOfficialImageModel(model?: string): boolean {
  const normalizedModel = normalizeImageModelKey(model);
  return normalizedModel.length > 0 && SUPPORTED_GEMINI_OFFICIAL_IMAGE_MODELS.has(normalizedModel);
}

export function shouldUseExactImageSizeApi(model?: string, size?: string): boolean {
  const normalizedModel = normalizeImageModelKey(model);
  const normalizedSize = typeof size === "string" ? size.trim() : "";
  return (
    normalizedModel.length > 0 &&
    normalizedSize.length > 0 &&
    SUPPORTED_GEMINI_OFFICIAL_IMAGE_MODELS.has(normalizedModel) &&
    EXACT_IMAGE_SIZE_REQUEST_SIZES.has(normalizedSize)
  );
}

function usesSupplierAspectRatioImageModel(model?: string): boolean {
  const normalizedModel = normalizeImageModelKey(model);
  return normalizedModel.length > 0 && SUPPLIER_ASPECT_RATIO_IMAGE_MODELS.has(normalizedModel);
}

export function shouldUseImageEditsApi(model?: string, referenceImageCount = 0): boolean {
  if (referenceImageCount <= 0) {
    return false;
  }

  const normalizedModel = normalizeImageModelKey(model);
  if (!normalizedModel) {
    return false;
  }

  if (SUPPLIER_REFERENCE_IMAGE_GENERATIONS_MODELS.has(normalizedModel)) {
    return false;
  }

  return SUPPLIER_IMAGE_EDITS_MODELS.has(normalizedModel);
}

function resolveGeminiOfficialImageSize(size?: string): "1K" | "2K" | "4K" {
  const raw = typeof size === "string" ? size.trim() : "";
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

function extractTaskData(payload: AsyncImageTaskResultResponse): Array<{ url: string; revised_prompt?: string }> {
  return toImageEntries(payload);
}

function extractAsyncTaskFailureMessage(payload: AsyncImageTaskResultResponse): string | undefined {
  const nestedDataRecord =
    payload.data && !Array.isArray(payload.data) && typeof payload.data === "object"
      ? (payload.data as Record<string, unknown>)
      : null;
  const nestedResultRecord =
    payload.result && typeof payload.result === "object"
      ? (payload.result as Record<string, unknown>)
      : null;
  const nestedOutputRecord =
    payload.output && typeof payload.output === "object"
      ? (payload.output as Record<string, unknown>)
      : null;
  const nestedDataFailReason =
    typeof nestedDataRecord?.fail_reason === "string"
      ? nestedDataRecord.fail_reason
      : undefined;
  const nestedResultFailReason =
    typeof nestedResultRecord?.fail_reason === "string"
      ? nestedResultRecord.fail_reason
      : undefined;
  const nestedOutputFailReason =
    typeof nestedOutputRecord?.fail_reason === "string"
      ? nestedOutputRecord.fail_reason
      : undefined;

  return (
    (typeof payload.error === "object" && payload.error && "message" in payload.error
      ? (payload.error as { message?: string }).message
      : typeof payload.error === "string"
        ? payload.error
        : undefined) ||
    (typeof payload.last_error === "object" && payload.last_error && "message" in payload.last_error
      ? (payload.last_error as { message?: string }).message
      : typeof payload.last_error === "string"
        ? payload.last_error
        : undefined) ||
    nestedDataFailReason ||
    nestedResultFailReason ||
    nestedOutputFailReason ||
    payload.message ||
    undefined
  );
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
): Promise<{ inlineData: { mimeType: string; data: string } }> {
  const { blob, mimeType } = await referenceToBlob(input, signal);
  return {
    inlineData: {
      mimeType,
      data: await blobToBase64(blob),
    },
  };
}

function extractGeminiOfficialImageOutputs(payload: unknown): Array<{ url: string; revised_prompt?: string }> {
  const outputs: Array<{ url: string; revised_prompt?: string }> = [];

  const visit = (value: unknown, depth = 0) => {
    if (depth > 8 || value == null) return;

    if (Array.isArray(value)) {
      value.forEach((entry) => visit(entry, depth + 1));
      return;
    }

    if (typeof value !== "object") {
      return;
    }

    const record = value as Record<string, unknown>;
    const inlineData =
      record.inlineData && typeof record.inlineData === "object"
        ? (record.inlineData as Record<string, unknown>)
        : null;

    if (inlineData) {
      const mimeType = typeof inlineData.mimeType === "string" ? inlineData.mimeType : "image/png";
      const data = typeof inlineData.data === "string" ? inlineData.data : "";
      if (mimeType.startsWith("image/") && data) {
        outputs.push({
          url: `data:${mimeType};base64,${data}`,
        });
      }
    }

    Object.values(record).forEach((entry) => visit(entry, depth + 1));
  };

  visit(payload);
  return outputs;
}

async function generateGeminiOfficialImage(request: UnifiedImageRequest): Promise<GenerationResponse> {
  if (!API_KEY) {
    throw new ImageGenerationError("Please set COMFLY_API_KEY or GPT_BEST_API_KEY in .env.local");
  }

  const model = typeof request.model === "string" ? request.model.trim() : "";
  if (!isGeminiOfficialImageModel(model)) {
    throw new ImageGenerationError(`Gemini official image request failed: model "${request.model}" is not supported`, 400);
  }

  const endpoint = `${getGeminiOfficialApiBaseUrl()}/v1beta/models/${model}:generateContent`;
  const aspectRatio = normalizeAspectRatio(request.aspect_ratio) || toAspectRatio(request.size);
  const imageSize = resolveGeminiOfficialImageSize(request.size);
  const prompt = typeof request.prompt === "string" ? request.prompt : "";
  const referenceImages = Array.isArray(request.images) ? request.images.filter(Boolean) : [];
  const contentParts: Array<
    | { inlineData: { mimeType: string; data: string } }
    | { text: string }
  > = await Promise.all(referenceImages.map((image) => referenceToInlineData(image, request.signal)));
  contentParts.push({ text: prompt });

  const requestBody = {
    contents: [
      {
        role: "user",
        parts: contentParts,
      },
    ],
    generationConfig: {
      responseModalities: ["IMAGE"],
      imageConfig: {
        aspectRatio,
        imageSize,
      },
    },
  };

  basicLog("[SUPPLIER][PREP]", {
    endpointBase: getGeminiOfficialApiBaseUrl(),
    endpoint: `/v1beta/models/${model}:generateContent`,
    model: request.model,
    imageSize,
    aspectRatio,
    n: request.n || 1,
    referenceCount: referenceImages.length,
    executionMode: request.executionMode === "async" ? "async" : "sync",
    apiKeyMasked: maskToken(API_KEY),
  });
  debugLog("[SUPPLIER][PREP_PROMPT]", {
    promptPreview: prompt.slice(0, 200),
  });

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 120000);
  const onAbort = () => controller.abort();
  request.signal?.addEventListener("abort", onAbort);

  try {
    const requestStartedAt = Date.now();
    basicLog("[SUPPLIER][REQ]", {
      method: "POST",
      endpoint,
    });

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${API_KEY}`,
      },
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    });

    basicLog("[SUPPLIER][RES]", {
      method: "POST",
      endpoint,
      status: response.status,
      statusText: response.statusText,
      durationMs: Date.now() - requestStartedAt,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new ImageGenerationError(`Gemini official image request failed: ${errorText || response.statusText}`, response.status);
    }

    const payload = await response.json();
    const outputs = extractGeminiOfficialImageOutputs(payload);

    basicLog("[SUPPLIER][PARSE]", {
      endpoint: `/v1beta/models/${request.model}:generateContent`,
      executionMode: request.executionMode === "async" ? "async" : "sync",
      imageCount: outputs.length,
      imageSize,
      aspectRatio,
    });

    if (outputs.length === 0) {
      throw new ImageGenerationError("Gemini official image request failed: no image data returned", 502);
    }

    return {
      created: Math.floor(Date.now() / 1000),
      data: outputs,
    };
  } catch (error) {
    basicLog("[SUPPLIER][ERR]", {
      endpoint: `/v1beta/models/${request.model}:generateContent`,
      model: request.model,
      imageSize,
      aspectRatio,
      referenceCount: referenceImages.length,
      ...getErrorDiagnostics(error),
    });

    if (error instanceof Error && error.name === "AbortError") {
      if (request.signal?.aborted) {
        throw new ImageGenerationError("Request cancelled by user", 499);
      }
      throw new ImageGenerationError("Gemini official image request timed out", 504);
    }
    if (error instanceof ImageGenerationError) {
      throw error;
    }
    throw new ImageGenerationError(
      error instanceof Error ? `Gemini official image request failed: ${error.message}` : "Gemini official image request failed",
      502
    );
  } finally {
    clearTimeout(timeoutId);
    request.signal?.removeEventListener("abort", onAbort);
  }
}

export async function editImage(request: EditRequest): Promise<GenerationResponse> {
  if (!API_KEY) {
    throw new ImageGenerationError("Please set COMFLY_API_KEY or GPT_BEST_API_KEY in .env.local");
  }
  if (!Array.isArray(request.images) || request.images.length === 0) {
    throw new ImageGenerationError("At least one reference image is required for edits", 400);
  }

  const executionMode = request.executionMode === "async" ? "async" : "sync";
  const endpoint = executionMode === "async"
    ? `${API_URL}/images/edits?async=true`
    : `${API_URL}/images/edits`;
  const formData = new FormData();
  formData.append("model", request.model);
  formData.append("prompt", request.prompt);
  formData.append("n", String(request.n || 1));
  if (typeof request.aspect_ratio === "string" && request.aspect_ratio.trim()) {
    formData.append("aspect_ratio", request.aspect_ratio.trim());
  }
  if (typeof request.size === "string" && request.size.trim()) {
    if (request.model === "nano-banana-2") {
      formData.append("image_size", request.size.trim());
    } else {
      formData.append("size", request.size.trim());
    }
  }

  const imageEntries = await Promise.all(
    request.images.map((img) => referenceToBlob(img, request.signal))
  );
  imageEntries.forEach((entry, index) => {
    const ext = entry.mimeType.includes("jpeg")
      ? "jpg"
      : entry.mimeType.includes("webp")
        ? "webp"
        : entry.mimeType.includes("gif")
          ? "gif"
          : "png";
    formData.append("image", entry.blob, `reference-${index + 1}.${ext}`);
  });

  if (request.mask) {
    const maskEntry = await referenceToBlob(request.mask, request.signal);
    const maskExt = maskEntry.mimeType.includes("jpeg")
      ? "jpg"
      : maskEntry.mimeType.includes("webp")
        ? "webp"
        : maskEntry.mimeType.includes("gif")
          ? "gif"
          : "png";
    formData.append("mask", maskEntry.blob, `mask.${maskExt}`);
  }

  basicLog("[SUPPLIER][PREP]", {
    endpointBase: API_URL,
    endpoint: executionMode === "async" ? "/images/edits?async=true" : "/images/edits",
    model: request.model,
    n: request.n || 1,
    formFieldImageCount: imageEntries.length,
    hasMask: Boolean(request.mask),
    sentAspectRatio: request.aspect_ratio || null,
    sentSize: request.size || null,
    executionMode,
    submitTimeoutMs: executionMode === "async" ? asyncImageSubmitTimeoutMs : 120000,
    apiKeyMasked: maskToken(API_KEY),
  });
  debugLog("[SUPPLIER][PREP_PROMPT]", {
    promptPreview: request.prompt.slice(0, 200),
  });

  const controller = new AbortController();
  const submitTimeoutMs = executionMode === "async" ? asyncImageSubmitTimeoutMs : 120000;
  const timeoutId = setTimeout(() => controller.abort(), submitTimeoutMs);
  const onAbort = () => controller.abort();
  request.signal?.addEventListener("abort", onAbort);

  try {
    const requestStartedAt = Date.now();
    basicLog("[SUPPLIER][REQ]", {
      method: "POST",
      endpoint,
    });

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${API_KEY}`,
      },
      body: formData,
      signal: controller.signal,
    });

    basicLog("[SUPPLIER][RES]", {
      method: "POST",
      endpoint,
      status: response.status,
      statusText: response.statusText,
      durationMs: Date.now() - requestStartedAt,
    });

    if (!response.ok) {
      const errorText = await response.text();
      const errorLower = errorText.toLowerCase();
      if (
        errorLower.includes("model") &&
        (errorLower.includes("not support") || errorLower.includes("unsupported") || errorLower.includes("invalid")) &&
        errorLower.includes("edit")
      ) {
        throw new ImageGenerationError(`Edits failed: model "${request.model}" is not supported for /images/edits`, response.status);
      }
      throw new ImageGenerationError(`Edits failed: ${errorText || response.statusText}`, response.status);
    }

    if (executionMode === "sync") {
      const payload = await response.json() as GenerationResponse;
      const counts = summarizeImagePayloadCounts(payload);
      basicLog("[SUPPLIER][PARSE]", {
        endpoint: "/images/edits",
        executionMode,
        rawDataCount: counts.rawDataCount,
        nestedDataCount: counts.nestedDataCount,
        resultDataCount: counts.resultDataCount,
        outputDataCount: counts.outputDataCount,
        extractedCount: counts.extractedCount,
      });
      if (!payload.data || payload.data.length === 0) {
        const extracted = toImageEntries(payload);
        if (extracted.length === 0) {
          throw new ImageGenerationError("Edits failed: no image data returned", 502);
        }
        return {
          created: payload.created || Math.floor(Date.now() / 1000),
          data: extracted,
        };
      }
      return payload;
    }

    const submitResult = await response.json() as AsyncImageTaskSubmitResponse;
    const submitData = extractTaskData(submitResult as AsyncImageTaskResultResponse);
    const submitStatus = extractTaskStatus(submitResult as AsyncImageTaskResultResponse);

    if (submitData.length > 0) {
      basicLog("[SUPPLIER][TASK]", {
        source: "submit",
        endpoint: "/images/edits",
        status: submitStatus || "DIRECT_DATA",
        taskId: submitResult.task_id || submitResult.id || null,
        dataCount: submitData.length,
      });
      return {
        created: Math.floor(Date.now() / 1000),
        data: submitData,
      };
    }

    if (submitStatus && ["FAILURE", "FAILED", "ERROR", "CANCELLED", "CANCELED", "TIMEOUT", "TIMED_OUT"].includes(submitStatus)) {
      const submitFailureMessage =
        (typeof submitResult.error === "object" && submitResult.error && "message" in submitResult.error
          ? (submitResult.error as { message?: string }).message
          : typeof submitResult.error === "string"
            ? submitResult.error
            : undefined) ||
        submitResult.message ||
        "Edits failed on submit";
      throw new ImageGenerationError(`Edits failed: ${submitFailureMessage}`, 502);
    }

    const taskId = extractTaskId(submitResult);
    const result = await pollAsyncImageTask(taskId, request.signal);
    return result;
  } catch (error) {
    basicLog("[SUPPLIER][ERR]", {
      endpoint: "/images/edits",
      executionMode,
      submitTimeoutMs,
      model: request.model,
      n: request.n || 1,
      formFieldImageCount: request.images.length,
      hasMask: Boolean(request.mask),
      ...getErrorDiagnostics(error),
    });
    debugError("[SUPPLIER][ERR]", {
      endpoint: "/images/edits",
      executionMode,
      submitTimeoutMs,
      model: request.model,
      n: request.n || 1,
      formFieldImageCount: request.images.length,
      hasMask: Boolean(request.mask),
      ...getErrorDiagnostics(error),
    });

    if (error instanceof Error && error.name === "AbortError") {
      if (request.signal?.aborted) {
        throw new ImageGenerationError("Request cancelled by user", 499);
      }
      throw new ImageGenerationError("Image edit request timed out", 504);
    }
    if (error instanceof ImageGenerationError) {
      throw error;
    }
    throw new ImageGenerationError(error instanceof Error ? `Edits failed: ${error.message}` : "Edits failed", 502);
  } finally {
    clearTimeout(timeoutId);
    request.signal?.removeEventListener("abort", onAbort);
  }
}

export async function runImageTask(request: UnifiedImageRequest): Promise<GenerationResponse> {
  const images = Array.isArray(request.images) ? request.images.filter(Boolean) : [];
  if (shouldUseExactImageSizeApi(request.model, request.size)) {
    return generateGeminiOfficialImage({
      ...request,
      images,
    });
  }

  if (shouldUseImageEditsApi(request.model, images.length)) {
    return editImage({
      model: request.model,
      prompt: request.prompt,
      images,
      mask: request.mask,
      n: request.n,
      size: request.size,
      aspect_ratio: request.aspect_ratio,
      executionMode: request.executionMode,
      signal: request.signal,
    });
  }

  return generateImage({
    model: request.model,
    prompt: request.prompt,
    n: request.n,
    reference_images: images.length > 0 ? images : undefined,
    size: request.size,
    aspect_ratio: request.aspect_ratio,
    quality: request.quality,
    response_format: request.response_format,
    executionMode: request.executionMode,
    signal: request.signal,
  });
}

async function pollAsyncImageTask(taskId: string, signal?: AbortSignal): Promise<GenerationResponse> {
  const pollTimeoutMs = parsePositiveInt(process.env.COMFLY_ASYNC_POLL_TIMEOUT_MS, 600000);
  const pollIntervalMs = parsePositiveInt(process.env.COMFLY_ASYNC_POLL_INTERVAL_MS, 2000);
  const startAt = Date.now();
  let pollCount = 0;
  let lastLoggedStatus = "";
  const successStatuses = new Set(["SUCCESS", "SUCCEEDED", "COMPLETED", "DONE", "FINISHED"]);
  const failureStatuses = new Set(["FAILURE", "FAILED", "ERROR", "CANCELLED", "CANCELED", "TIMEOUT", "TIMED_OUT"]);

  while (Date.now() - startAt < pollTimeoutMs) {
    if (signal?.aborted) {
      throw new ImageGenerationError("Request cancelled by user", 499);
    }

    pollCount += 1;
    const pollStartedAt = Date.now();
    debugLog("[SUPPLIER][REQ]", {
      method: "GET",
      endpoint: `${API_URL}/images/tasks/${taskId}`,
      taskId,
      pollCount,
    });

    const response = await fetch(`${API_URL}/images/tasks/${taskId}`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${API_KEY}`,
      },
      signal,
    });

    debugLog("[SUPPLIER][RES]", {
      method: "GET",
      endpoint: `${API_URL}/images/tasks/${taskId}`,
      taskId,
      pollCount,
      status: response.status,
      durationMs: Date.now() - pollStartedAt,
    });

    if (!response.ok) {
      const errorText = await response.text();
      debugError("Supplier async task poll error:", {
        taskId,
        status: response.status,
        raw: errorText,
      });
      const error = parseErrorPayload(errorText);
      throw new ImageGenerationError(
        (error.error as { message?: string } | undefined)?.message ||
          `Async task query failed with status ${response.status}: ${errorText}`,
        response.status
      );
    }

    const taskResult = await response.json() as AsyncImageTaskResultResponse;
    const status = extractTaskStatus(taskResult);
    const data = extractTaskData(taskResult);

    if (!status && data.length > 0) {
      basicLog("[SUPPLIER][TASK]", {
        taskId,
        pollCount,
        status: "EMPTY_STATUS_WITH_DATA",
        elapsedMs: Date.now() - startAt,
      });
      return {
        created: Math.floor(Date.now() / 1000),
        data,
      };
    }

    if (status !== lastLoggedStatus) {
      basicLog("[SUPPLIER][TASK]", {
        taskId,
        pollCount,
        status,
        elapsedMs: Date.now() - startAt,
      });
      lastLoggedStatus = status;
    }

    if (successStatuses.has(status)) {
      if (data.length === 0) {
        const rawSnippet = JSON.stringify(taskResult).slice(0, 1200);
        debugError("Supplier async task success but empty data:", {
          taskId,
          status,
          raw: rawSnippet,
        });
        throw new ImageGenerationError("Async task succeeded but no image data returned", 502);
      }
      return {
        created: Math.floor(Date.now() / 1000),
        data,
      };
    }

    if (failureStatuses.has(status)) {
      const failureMessage = extractAsyncTaskFailureMessage(taskResult) || "Async image generation failed";

      debugError("Supplier async task failed:", {
        taskId,
        status,
        message: failureMessage,
        raw: JSON.stringify(taskResult).slice(0, 1000),
      });

      throw new ImageGenerationError(failureMessage, 502);
    }

    await sleepWithAbort(pollIntervalMs, signal);
  }

  throw new ImageGenerationError("Async image generation polling timed out", 504);
}

export async function generateImage(
  request: GenerationRequest
): Promise<GenerationResponse> {
  if (!API_KEY) {
    throw new ImageGenerationError(
      "Please set COMFLY_API_KEY or GPT_BEST_API_KEY in .env.local"
    );
  }

  const requestedSize = request.size || "2048x2048";
  const requestedAspectRatio = normalizeAspectRatio(request.aspect_ratio);
  const aspectRatio = requestedAspectRatio || toAspectRatio(requestedSize);
  const usesAspectRatioParam = usesSupplierAspectRatioImageModel(request.model);

  const requestBody: Record<string, unknown> = {
    model: request.model,
    prompt: request.prompt,
    n: request.n || 1,
    quality: request.quality || "standard",
    response_format: request.response_format || "url",
  };
  if (usesAspectRatioParam) {
    requestBody.aspect_ratio = aspectRatio;
  } else {
    requestBody.size = requestedSize;
  }

  // 供应商统一生图协议使用 image 字段承载参考图列表
  if (request.reference_images && request.reference_images.length > 0) {
    requestBody.image = request.reference_images;
  }

  const executionMode = request.executionMode === "async" ? "async" : "sync";
  const endpoint = executionMode === "async"
    ? `${API_URL}/images/generations?async=true`
    : `${API_URL}/images/generations`;

  basicLog("[SUPPLIER][PREP]", {
    endpointBase: API_URL,
    model: request.model,
    size: requestedSize,
    aspectRatio: usesAspectRatioParam ? aspectRatio : null,
    n: requestBody.n,
    executionMode: request.executionMode || "sync",
    submitTimeoutMs: executionMode === "async" ? asyncImageSubmitTimeoutMs : 120000,
    referenceCount: Array.isArray(request.reference_images) ? request.reference_images.length : 0,
    apiKeyMasked: maskToken(API_KEY),
  });
  debugLog("[SUPPLIER][PREP_PROMPT]", {
    promptPreview: request.prompt.slice(0, 200),
  });

  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const controller = new AbortController();
    const submitTimeoutMs = executionMode === "async" ? asyncImageSubmitTimeoutMs : 120000;
    const timeoutId = setTimeout(() => controller.abort(), submitTimeoutMs);
    const onAbort = () => controller.abort();
    request.signal?.addEventListener("abort", onAbort);

    try {
      const requestStartedAt = Date.now();
      basicLog("[SUPPLIER][REQ]", {
        method: "POST",
        endpoint,
        attempt,
        maxAttempts,
      });

      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${API_KEY}`,
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });

      basicLog("[SUPPLIER][RES]", {
        method: "POST",
        endpoint,
        attempt,
        status: response.status,
        statusText: response.statusText,
        durationMs: Date.now() - requestStartedAt,
      });

      clearTimeout(timeoutId);
      request.signal?.removeEventListener("abort", onAbort);

      if (!response.ok) {
        const errorText = await response.text();
        debugError("Supplier generation error:", {
          status: response.status,
          model: request.model,
          size: request.size,
          promptPreview: request.prompt.slice(0, 120),
          raw: errorText,
        });
        const error = parseErrorPayload(errorText);
        const errorMessage =
          (error.error as { message?: string } | undefined)?.message ||
          `API request failed with status ${response.status}: ${errorText}`;

        if (response.status === 429 && attempt < maxAttempts) {
          const delayMs = 1000 * Math.pow(2, attempt - 1);
          debugWarn(`Rate limited, retrying in ${delayMs}ms (attempt ${attempt}/${maxAttempts})`);
          await sleep(delayMs);
          continue;
        }

        throw new ImageGenerationError(errorMessage, response.status);
      }

      if (executionMode === "sync") {
        const syncResult = await response.json() as GenerationResponse;
        const counts = summarizeImagePayloadCounts(syncResult);
        basicLog("[SUPPLIER][PARSE]", {
          endpoint: "/images/generations",
          executionMode,
          rawDataCount: counts.rawDataCount,
          nestedDataCount: counts.nestedDataCount,
          resultDataCount: counts.resultDataCount,
          outputDataCount: counts.outputDataCount,
          extractedCount: counts.extractedCount,
        });
        debugLog("generateImage sync success:", JSON.stringify(syncResult, null, 2).substring(0, 300));
        return syncResult;
      }

      const submitResult = await response.json() as AsyncImageTaskSubmitResponse;
      const submitData = extractTaskData(submitResult as AsyncImageTaskResultResponse);
      const submitStatus = extractTaskStatus(submitResult as AsyncImageTaskResultResponse);

      if (submitData.length > 0) {
        basicLog("[SUPPLIER][TASK]", {
          source: "submit",
          status: submitStatus || "DIRECT_DATA",
          taskId: submitResult.task_id || submitResult.id || null,
          dataCount: submitData.length,
        });
        return {
          created: Math.floor(Date.now() / 1000),
          data: submitData,
        };
      }

      if (submitStatus && ["FAILURE", "FAILED", "ERROR", "CANCELLED", "CANCELED", "TIMEOUT", "TIMED_OUT"].includes(submitStatus)) {
        const submitFailureMessage =
          (typeof submitResult.error === "object" && submitResult.error && "message" in submitResult.error
            ? (submitResult.error as { message?: string }).message
            : typeof submitResult.error === "string"
              ? submitResult.error
              : undefined) ||
          submitResult.message ||
          "Async image generation failed on submit";
        throw new ImageGenerationError(submitFailureMessage, 502);
      }

      const taskId = extractTaskId(submitResult);
      debugLog("generateImage async task_id:", taskId);

      const result = await pollAsyncImageTask(taskId, request.signal);
      debugLog("generateImage async success:", JSON.stringify(result, null, 2).substring(0, 300));
      return result;
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        if (request.signal?.aborted) {
          throw new ImageGenerationError("Request cancelled by user", 499);
        }
        throw new ImageGenerationError("Image generation submit timed out", 504);
      }

      if (error instanceof ImageGenerationError) {
        throw error;
      }

      const isSocketClosed =
        error instanceof TypeError &&
        error.message === "fetch failed" &&
        typeof (error as { cause?: { code?: string } }).cause?.code === "string" &&
        (error as { cause?: { code?: string } }).cause?.code === "UND_ERR_SOCKET";

      if (isSocketClosed && attempt < maxAttempts) {
        const delayMs = 1000 * Math.pow(2, attempt - 1);
        debugWarn(`Socket closed, retrying in ${delayMs}ms (attempt ${attempt}/${maxAttempts})`);
        await sleep(delayMs);
        continue;
      }

      if (isSocketClosed) {
        throw new ImageGenerationError("上游连接中断，请稍后重试", 503);
      }

      if (error instanceof Error) {
        throw new ImageGenerationError(error.message, 502);
      }

      throw new ImageGenerationError("Image generation failed", 502);
    } finally {
      clearTimeout(timeoutId);
      request.signal?.removeEventListener("abort", onAbort);
    }
  }

  throw new ImageGenerationError("Image generation failed after retries", 429);
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

export type ChatStreamEvent =
  | { type: "start"; model?: string }
  | { type: "delta"; channel: "content" | "reasoning"; content: string }
  | { type: "done" };

function extractStreamDeltaEvents(parsed: SupplierChatStreamPayload): ChatStreamEvent[] {
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

export async function chat(
  request: ChatRequest
): Promise<ChatResponse> {
  if (!API_KEY) {
    throw new ImageGenerationError(
      "Please set COMFLY_API_KEY or GPT_BEST_API_KEY in .env.local"
    );
  }

  const chatStartedAt = Date.now();
  basicLog("[SUPPLIER][REQ]", {
    method: "POST",
    endpoint: `${API_URL}/chat/completions`,
    mode: "chat",
    model: request.model,
    messageCount: request.messages.length,
  });

  const response = await fetch(`${API_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${API_KEY}`,
    },
    body: JSON.stringify({ model: request.model, messages: request.messages }),
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
    endpoint: `${API_URL}/chat/completions`,
    mode: "chat",
    status: response.status,
    durationMs: Date.now() - chatStartedAt,
  });

  return response.json();
}

export async function* chatStream(
  request: ChatStreamRequest
): AsyncGenerator<ChatStreamEvent, void, unknown> {
  if (!API_KEY) {
    throw new ImageGenerationError(
      "Please set COMFLY_API_KEY or GPT_BEST_API_KEY in .env.local"
    );
  }

  const streamStartedAt = Date.now();
  basicLog("[SUPPLIER][REQ]", {
    method: "POST",
    endpoint: `${API_URL}/chat/completions`,
    mode: "chat_stream",
    model: request.model,
    messageCount: request.messages.length,
  });

  const response = await fetch(`${API_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${API_KEY}`,
    },
    body: JSON.stringify({
      model: request.model,
      messages: request.messages,
      stream: true,
    }),
    signal: request.signal,
  });

  if (!response.ok) {
    const errorText = await response.text();
    debugError("Supplier chat stream error:", {
      status: response.status,
      model: request.model,
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
    endpoint: `${API_URL}/chat/completions`,
    mode: "chat_stream",
    status: response.status,
    durationMs: Date.now() - streamStartedAt,
  });

  if (!response.body) {
    throw new ImageGenerationError("Chat stream body is empty", 502);
  }

  yield { type: "start", model: request.model };

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
  { id: "gemini-3.1-flash-image-preview", name: "Gemini 3.1 Flash (Image)", provider: "Google" },
  { id: "nano-banana-2", name: "Nano Banana 2", provider: "Google" },
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
