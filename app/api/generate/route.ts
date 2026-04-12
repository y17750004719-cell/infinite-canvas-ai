import { NextRequest, NextResponse } from "next/server";
import { chat, chatStream, ImageGenerationError, runImageTask, shouldUseExactImageSizeApi, shouldUseImageEditsApi } from "../../lib/api-client";
import fs from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createStoredImageName } from "../../lib/api-security.mjs";
import { buildRuntimeAssetUrl, LOCAL_ASSET_ALLOWED_EXTENSIONS, resolveLocalAssetPath } from "../../lib/local-assets.mjs";
import { resolveImageCardModel, resolveImageGenerationFallbackSizes, resolveTextPanelChatModel } from "../../lib/workspace-session-view.mjs";
import { createLogger, createRequestId, serializeError } from "../../lib/logger";

const DEBUG_API_LOGS = process.env.LOG_ALL_REQUESTS !== "0";
const PUBLIC_DIR = path.join(process.cwd(), "public");
const RUNTIME_DIR = path.join(process.cwd(), "runtime");
const GENERATED_UPLOADS_DIR = path.join(RUNTIME_DIR, "uploads", "generated");
const MAX_REFERENCE_IMAGE_BYTES = 12 * 1024 * 1024;
const MAX_SAVED_IMAGE_BYTES = 20 * 1024 * 1024;
const ALLOWED_PUBLIC_IMAGE_EXTENSIONS = [".png", ".jpg", ".jpeg", ".webp", ".gif"];
const generateLogger = createLogger("api.generate", { route: "/api/generate" });

function toLogDetails(payload?: unknown): Record<string, unknown> | undefined {
  if (payload === undefined) return undefined;
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    return payload as Record<string, unknown>;
  }
  return { value: payload };
}

function debugLog(message: string, payload?: unknown) {
  if (DEBUG_API_LOGS) {
    void generateLogger.info("debug", message, toLogDetails(payload));
  }
}

function debugWarn(message: string, payload?: unknown) {
  if (DEBUG_API_LOGS) {
    void generateLogger.warn("warn", message, toLogDetails(payload));
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

async function saveImageToLocal(imageUrl: string): Promise<{ filename: string; localUrl: string }> {
  if (imageUrl.startsWith("data:image/")) {
    const match = imageUrl.match(/^data:(image\/[a-z0-9.+-]+);base64,(.+)$/i);
    if (!match) {
      throw new Error("Invalid generated image data URL");
    }

    const mimeType = match[1].toLowerCase();
    const base64 = match[2];
    const buffer = Buffer.from(base64, "base64");
    if (buffer.length === 0) {
      throw new Error("Generated image payload is empty");
    }
    if (buffer.length > MAX_SAVED_IMAGE_BYTES) {
      throw new Error("Generated image is too large to store");
    }

    const extension = mimeType.includes("jpeg")
      ? "jpg"
      : mimeType.includes("webp")
        ? "webp"
        : mimeType.includes("gif")
          ? "gif"
          : "png";
    const filename = createStoredImageName(extension);
    const filepath = path.join(GENERATED_UPLOADS_DIR, filename);

    await mkdir(GENERATED_UPLOADS_DIR, { recursive: true });
    await writeFile(filepath, buffer);

    debugLog("Stored generated image locally", {
      status: 200,
      sizeBytes: buffer.length,
      fileName: filename,
      source: "data-url",
    });

    return {
      filename,
      localUrl: buildRuntimeAssetUrl(`uploads/generated/${filename}`),
    };
  }

  const parsedUrl = new URL(imageUrl);
  if (!["http:", "https:"].includes(parsedUrl.protocol)) {
    throw new Error("Unsupported image URL protocol");
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 120000);
    
    const response = await fetch(imageUrl, { signal: controller.signal });
    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`Failed to fetch image: ${response.status} ${response.statusText}`);
    }

    const contentLength = Number(response.headers.get("content-length") || "0");
    if (Number.isFinite(contentLength) && contentLength > MAX_SAVED_IMAGE_BYTES) {
      throw new Error("Generated image is too large to store");
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    if (buffer.length === 0) {
      throw new Error("Generated image payload is empty");
    }
    if (buffer.length > MAX_SAVED_IMAGE_BYTES) {
      throw new Error("Generated image is too large to store");
    }

    const contentType = (response.headers.get("content-type") || "").toLowerCase();
    const extension = contentType.includes("image/jpeg")
      ? "jpg"
      : contentType.includes("image/webp")
        ? "webp"
        : contentType.includes("image/gif")
          ? "gif"
          : "png";
    const filename = createStoredImageName(extension);
    const filepath = path.join(GENERATED_UPLOADS_DIR, filename);

    await mkdir(GENERATED_UPLOADS_DIR, { recursive: true });
    await writeFile(filepath, buffer);

    debugLog("Stored generated image locally", {
      status: response.status,
      sizeBytes: buffer.length,
      fileName: filename,
    });

    return {
      filename,
      localUrl: buildRuntimeAssetUrl(`uploads/generated/${filename}`),
    };
  } catch (error) {
    void generateLogger.error("save_image.error", "Error saving generated image", {
      error: serializeError(error),
      sourceKind: imageUrl.startsWith("data:image/") ? "data-url" : "remote-url",
    });
    throw error;
  }
}

async function saveImagesToLocal(imageUrls: string[]): Promise<Array<{ filename: string; localUrl: string }>> {
  const validUrls = Array.isArray(imageUrls) ? imageUrls.filter((url) => typeof url === "string" && url.length > 0) : [];
  if (validUrls.length === 0) {
    return [];
  }

  return Promise.all(validUrls.map((imageUrl) => saveImageToLocal(imageUrl)));
}

const AGENT_MODEL = "gemini-3.1-flash-lite-preview-thinking-medium";
const IMAGE_MODEL = "gemini-2.5-flash-image";
const DEFAULT_IMAGE_SIZES = ["2048x2048", "1024x1024", "4096x4096", "1024x1792", "1792x1024"];
const ALLOWED_ASPECT_RATIOS = new Set([
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

type GenerateIntent = "auto" | "image" | "chat";

type SupplierChatContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

type SupplierChatMessage = {
  role: "user" | "assistant" | "system";
  content: string | SupplierChatContentPart[];
};

function sanitizeModelKey(model: string): string {
  return model.toUpperCase().replace(/[^A-Z0-9]+/g, "_");
}

function parseSizeAllowlist(raw?: string): string[] {
  if (!raw) return [];
  return Array.from(
    new Set(
      raw
        .split(",")
        .map((part) => part.trim())
        .filter((part) => /^\d+x\d+$/i.test(part))
    )
  );
}

function resolveImageSize(requested: unknown, model: string): string {
  const modelEnvKey = `IMAGE_SIZE_ALLOWLIST_${sanitizeModelKey(model)}`;
  const modelAllowlist = parseSizeAllowlist(process.env[modelEnvKey]);
  const globalAllowlist = parseSizeAllowlist(process.env.IMAGE_SIZE_ALLOWLIST);
  const allowlist = modelAllowlist.length > 0
    ? modelAllowlist
    : globalAllowlist.length > 0
      ? globalAllowlist
      : DEFAULT_IMAGE_SIZES;

  const requestedSize = typeof requested === "string" ? requested.trim() : "";
  if (!requestedSize) return allowlist[0] || DEFAULT_IMAGE_SIZES[0];
  if (allowlist.includes(requestedSize)) return requestedSize;

  debugWarn("Unsupported image size for current allowlist, fallback to default", {
    requestedSize,
    allowlist,
    model,
  });
  return allowlist[0] || DEFAULT_IMAGE_SIZES[0];
}

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

function normalizeAspectRatio(input: unknown): string {
  const raw = typeof input === "string" ? input.trim() : "";
  if (!raw) return "";
  return ALLOWED_ASPECT_RATIOS.has(raw) ? raw : "";
}

function aspectRatioFromSize(size?: string): string {
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
  return ALLOWED_ASPECT_RATIOS.has(ratio) ? ratio : "1:1";
}

const IMAGE_HINTS = ["画", "生图", "生成图片", "海报", "logo", "封面", "插画", "渲染", "视觉稿"];
const CHAT_HINTS = ["解释", "分析", "总结", "翻译", "改写", "代码", "报错", "优化"];

function resolveIntent(
  intent: unknown,
  text: string,
  hasReferenceImages: boolean
): { intent: "image" | "chat"; ambiguous: boolean; prompt: string } {
  const raw = typeof text === "string" ? text.trim() : "";
  const mode = intent === "image" || intent === "chat" || intent === "auto" ? intent : "auto";

  if (raw.startsWith("/img")) {
    return { intent: "image", ambiguous: false, prompt: raw.replace(/^\/img\s*/i, "").trim() || raw };
  }
  if (raw.startsWith("/chat")) {
    return { intent: "chat", ambiguous: false, prompt: raw.replace(/^\/chat\s*/i, "").trim() || raw };
  }

  if (mode === "image") {
    return { intent: "image", ambiguous: false, prompt: raw };
  }

  if (mode === "chat") {
    return { intent: "chat", ambiguous: false, prompt: raw };
  }

  if (hasReferenceImages) {
    return { intent: "image", ambiguous: false, prompt: raw };
  }

  const normalized = raw.toLowerCase();
  const imageHit = IMAGE_HINTS.some((keyword) => normalized.includes(keyword.toLowerCase()));
  const chatHit = CHAT_HINTS.some((keyword) => normalized.includes(keyword.toLowerCase()));

  if (imageHit && !chatHit) {
    return { intent: "image", ambiguous: false, prompt: raw };
  }

  if (chatHit && !imageHit) {
    return { intent: "chat", ambiguous: false, prompt: raw };
  }

  return { intent: "chat", ambiguous: true, prompt: raw };
}

function loadSkillContent(skillId: string): string | null {
  try {
    const skillPath = path.join(process.cwd(), "skills", skillId, "SKILL.md");
    if (fs.existsSync(skillPath)) {
      return fs.readFileSync(skillPath, "utf-8");
    }
    return null;
  } catch (error) {
    void generateLogger.error("skill.load_error", "Error loading skill content", {
      skillId,
      error: serializeError(error),
    });
    return null;
  }
}

function normalizeChatReferenceImage(
  input: string,
): string | null {
  if (typeof input !== "string" || !input.trim()) {
    return null;
  }

  if (input.startsWith("data:image/")) {
    return input;
  }

  if (input.startsWith("http://") || input.startsWith("https://")) {
    return input;
  }

  if (input.startsWith("/")) {
    const filePath = resolveLocalAssetPath(input, {
      runtimeDir: RUNTIME_DIR,
      publicDir: PUBLIC_DIR,
      allowedExtensions: LOCAL_ASSET_ALLOWED_EXTENSIONS,
    });
    if (!filePath || !fs.existsSync(filePath)) {
      return null;
    }

    const stats = fs.statSync(filePath);
    if (!stats.isFile() || stats.size > MAX_REFERENCE_IMAGE_BYTES) {
      return null;
    }

    const ext = path.extname(filePath).toLowerCase();
    const mimeType = ext === ".jpg" || ext === ".jpeg"
      ? "image/jpeg"
      : ext === ".webp"
        ? "image/webp"
          : ext === ".gif"
            ? "image/gif"
            : "image/png";
    const base64 = fs.readFileSync(filePath).toString("base64");
    return `data:${mimeType};base64,${base64}`;
  }

  return null;
}

function attachImagesToLatestUserMessage(
  messages: SupplierChatMessage[],
  imageUrls: string[]
): SupplierChatMessage[] {
  if (imageUrls.length === 0) {
    return messages;
  }

  const lastUserIndex = [...messages]
    .map((msg, index) => ({ msg, index }))
    .reverse()
    .find(({ msg }) => msg.role === "user")
    ?.index;

  if (lastUserIndex === undefined) {
    return messages;
  }

  const target = messages[lastUserIndex];
  const currentContent = target.content;
  const text = typeof currentContent === "string"
    ? currentContent
    : currentContent
        .filter((part) => part.type === "text")
        .map((part) => part.text)
        .join("\n");

  const imageParts: SupplierChatContentPart[] = imageUrls.map((url) => ({
    type: "image_url",
    image_url: { url },
  }));

  const patched: SupplierChatMessage = {
    ...target,
    content: [{ type: "text", text }, ...imageParts],
  };

  const next = [...messages];
  next[lastUserIndex] = patched;
  return next;
}

export async function POST(request: NextRequest) {
  const reqId = createRequestId("gen");
  const startedAt = Date.now();
  const requestLogger = createLogger("api.generate", {
    route: "/api/generate",
    requestId: reqId,
  });

  const logResponse = async (status: number, extra?: Record<string, unknown>) => {
    if (!DEBUG_API_LOGS) {
      return;
    }

    const level = status >= 500 ? "error" : status >= 400 ? "warn" : "info";
    const payload = {
      status,
      durationMs: Date.now() - startedAt,
      ...(extra || {}),
    };

    if (level === "error") {
      await requestLogger.error("request.response", "Generate API response completed with server error", payload);
      return;
    }

    if (level === "warn") {
      await requestLogger.warn("request.response", "Generate API response completed with client error", payload);
      return;
    }

    await requestLogger.info("request.response", "Generate API response completed", payload);
  };

  try {
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") {
      await logResponse(400, { reason: "invalid_json" });
      return NextResponse.json({ status: "error", error: "Invalid JSON body" }, { status: 400 });
    }

    const { messages: incomingMessages, size, aspect_ratio, n, reference_images, reference_labels, skill, intent, model, executionMode } = body as {
      messages: Array<{ role: "user" | "assistant" | "system"; content: string }>;
      size?: string;
      aspect_ratio?: string;
      n?: number;
      reference_images?: string[];
      reference_labels?: string[];
      skill?: string;
      intent?: GenerateIntent;
      model?: string;
      executionMode?: "sync" | "async";
      stream?: boolean;
    };

    if (DEBUG_API_LOGS) {
      await requestLogger.info("request.start", "Generate API request started", {
        method: request.method,
        messageCount: Array.isArray(incomingMessages) ? incomingMessages.length : 0,
        hasReferenceImages: Array.isArray(reference_images) && reference_images.length > 0,
        skill: typeof skill === "string" ? skill : null,
        intent: intent || "auto",
        model: typeof model === "string" ? model : null,
        executionMode: executionMode === "async" ? "async" : "sync",
      });
    }

    if (!incomingMessages || !Array.isArray(incomingMessages)) {
      await logResponse(400, { reason: "messages_required" });
      return NextResponse.json({ status: 'error', error: "Messages are required" }, { status: 400 });
    }

    let messages: SupplierChatMessage[] = [];
    const hasReferenceImages = Array.isArray(reference_images) && reference_images.length > 0;
    const userMessageTexts = incomingMessages
      .filter((msg) => msg.role === "user" && typeof msg.content === "string")
      .map((msg) => msg.content);
    const latestRawUserMessage = [...userMessageTexts].reverse()[0] || "";
    
    if (skill) {
      const skillContent = loadSkillContent(skill);
      if (skillContent) {
        if (incomingMessages.length > 0 && incomingMessages[0].role === 'user') {
          incomingMessages[0].content = skillContent + "\n\n" + incomingMessages[0].content;
        } else {
          incomingMessages.unshift({ role: 'user', content: skillContent });
        }
        debugLog("Loaded requested skill content", { reqId, skill });
      }
    }

    if (skill === 'brand' && hasReferenceImages) {
      const referenceContextHint =
        "【重要上下文】用户已提供 logo 参考图，请基于该 logo 继续品牌流程。禁止回复‘未提供 logo’或要求重复上传。";
      if (incomingMessages.length > 0 && incomingMessages[0].role === 'user') {
        incomingMessages[0].content = `${referenceContextHint}\n\n${incomingMessages[0].content}`;
      } else {
        incomingMessages.unshift({ role: 'user', content: referenceContextHint });
      }
    }

    if (skill === "brand") {
      const choiceProtocolHint =
        "【交互协议】当需要用户确认下一步时，必须在回复末尾输出一个且仅一个结构化选择块，格式为 <<skill_choice>>{...}<</skill_choice>>。JSON 必须包含 id/title/message/options 字段；options 为 2-3 个对象数组，每项必须包含 label 与 submitText。除这个代码块外，正文保持正常可读文本。品牌简报结束后 options 固定为“进入 VI 指南”和“跳过 VI 直接生成物料”；VI 指南结束后 options 固定为“开始生成品牌延展物料”和“先调整 VI”。";
      if (incomingMessages.length > 0 && incomingMessages[0].role === "user") {
        incomingMessages[0].content = `${choiceProtocolHint}\n\n${incomingMessages[0].content}`;
      } else {
        incomingMessages.unshift({ role: "user", content: choiceProtocolHint });
      }

      const skipViPattern = /(跳过\s*vi|不需要\s*vi|无需\s*vi|先不做\s*vi|暂不做\s*vi)/i;
      const requestViPattern = /(制作|生成|输出|补充|继续|需要|开始|做|重做).{0,8}(vi\s*指南|vi指南|视觉识别指南|视觉识别)|\bvi\s*指南\b|视觉识别指南|视觉识别/i;
      const hasSkipViInHistory = userMessageTexts.some((text) => skipViPattern.test(text));
      const isExplicitlyRequestingViNow = requestViPattern.test(latestRawUserMessage);

      if (hasSkipViInHistory && !isExplicitlyRequestingViNow) {
        const skipViHint =
          "【流程约束】用户已明确选择跳过 VI 指南。当前仅可继续品牌策略简报或品牌延展物料，不要主动输出 VI 指南内容。只有当用户再次明确提出“制作 VI 指南”时才恢复该步骤。";
        if (incomingMessages.length > 0 && incomingMessages[0].role === "user") {
          incomingMessages[0].content = `${skipViHint}\n\n${incomingMessages[0].content}`;
        } else {
          incomingMessages.unshift({ role: "user", content: skipViHint });
        }
      }
    }
    
    for (const msg of incomingMessages) {
      if (msg.role === 'user' || msg.role === 'assistant') {
        messages.push({ role: msg.role, content: msg.content });
      }
    }

    const latestUserContent = [...messages].reverse().find((msg) => msg.role === "user")?.content;
    const latestUserMessage = typeof latestUserContent === "string"
      ? latestUserContent
      : Array.isArray(latestUserContent)
        ? latestUserContent
            .filter((part) => part.type === "text")
            .map((part) => part.text)
            .join("\n")
        : "";
    const resolved = resolveIntent(intent, latestUserMessage, hasReferenceImages);

    debugLog("Resolved generation intent", {
      reqId,
      requestedIntent: intent || "auto",
      resolvedIntent: resolved.intent,
      ambiguous: resolved.ambiguous,
    });

    const resolvedExecutionMode = executionMode === "async" ? "async" : "sync";

    if (resolved.intent === "chat" && hasReferenceImages) {
      const normalizedChatImages = reference_images
        .map((img) => normalizeChatReferenceImage(img))
        .filter((img): img is string => !!img);

      if (normalizedChatImages.length > 0) {
        messages = attachImagesToLatestUserMessage(messages, normalizedChatImages);
        debugLog("Attached normalized reference images to chat message", {
          reqId,
          count: normalizedChatImages.length,
          skill: skill || null,
        });
      }
    }

    if (resolved.intent === "image" && hasReferenceImages) {
      const resolvedImageModel = resolveImageCardModel(model, IMAGE_MODEL);
      const imageSize = resolveImageSize(size, resolvedImageModel);
      const requestedAspectRatio = normalizeAspectRatio(aspect_ratio);
      const resolvedAspectRatio = requestedAspectRatio || aspectRatioFromSize(imageSize);
      const normalizedReferenceImages = reference_images
        .map((img) => normalizeChatReferenceImage(img))
        .filter((img): img is string => !!img);
      const usesImageEditsApi = shouldUseImageEditsApi(resolvedImageModel, normalizedReferenceImages.length);
      const referenceResponseMode = usesImageEditsApi ? "image_edit" : "image_generate";
      const referenceResultMode = usesImageEditsApi ? "image_edit" : "generate";

      if (normalizedReferenceImages.length === 0) {
        await logResponse(400, { mode: referenceResponseMode, reason: "no_valid_reference_images" });
        return NextResponse.json(
          {
            status: "error",
            error: usesImageEditsApi
              ? "Edits failed: no valid reference images after normalization"
              : "Image generation failed: no valid reference images after normalization",
          },
          { status: 400 }
        );
      }

      const referenceLabels = Array.isArray(reference_labels) && reference_labels.length === normalizedReferenceImages.length
        ? reference_labels
        : normalizedReferenceImages.map((_, index) => `image${index + 1}`);

      debugLog("Routing request to image generation flow with references", {
        reqId,
        generationMode: usesImageEditsApi ? "image_edit" : "image_generate_with_references",
        requestedAspectRatio: requestedAspectRatio || null,
        referenceCount: normalizedReferenceImages.length,
        model: resolvedImageModel,
        imageSize,
      });
      debugLog("Dispatching image supplier task with references", {
        reqId,
        n: n || 1,
        referenceCount: normalizedReferenceImages.length,
        resolvedImageModel,
        resolvedAspectRatio: resolvedAspectRatio,
        imageSize,
        supplierEndpointMode: referenceResponseMode,
      });

      let imageResult;
      try {
        imageResult = await runImageTask({
          model: resolvedImageModel,
          prompt: resolved.prompt,
          images: normalizedReferenceImages,
          size: imageSize,
          aspect_ratio: resolvedAspectRatio,
          n: n || 1,
          executionMode: resolvedExecutionMode,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown edits error";
        debugLog("Image supplier task with references failed", {
          reqId,
          ...getErrorDiagnostics(error),
        });
        const errorMeta =
          error instanceof ImageGenerationError
            ? {
                failureClass: error.failureClass,
                isRetryable: error.isRetryable,
                retryAttempt: error.retryAttempt,
              }
            : undefined;
        const normalizedMessage = message.toLowerCase();
        if (
          normalizedMessage.includes("aspect_ratio") ||
          normalizedMessage.includes("size") ||
          normalizedMessage.includes("ratio unsupported")
        ) {
          throw new ImageGenerationError(
            "Image task failed: ratio unsupported",
            error instanceof ImageGenerationError ? error.statusCode : 502,
            errorMeta
          );
        }
        throw new ImageGenerationError(
          `Image task failed: ${message}`,
          error instanceof ImageGenerationError ? error.statusCode : 502,
          errorMeta
        );
      }

      if (!imageResult.data || imageResult.data.length === 0) {
        await logResponse(500, { mode: referenceResponseMode, reason: "no_image_data" });
        return NextResponse.json(
          {
            status: "error",
            error: usesImageEditsApi ? "Edits failed: no image data returned" : "No image data returned",
          },
          { status: 500 }
        );
      }

      debugLog("Image supplier returned outputs for reference-based generation", {
        reqId,
        dataCount: imageResult.data.length,
        urlPresencePreview: imageResult.data.slice(0, 2).map((entry) => typeof entry?.url === "string" && entry.url.length > 0),
      });

      const savedImages = await saveImagesToLocal(imageResult.data.map((entry) => entry.url));
      const primarySavedImage = savedImages[0];
      debugLog("Saved reference-based generation outputs locally", {
        reqId,
        savedCount: savedImages.length,
        savedFiles: savedImages.map((image) => image.filename),
      });

      await logResponse(200, { mode: referenceResponseMode, skill: skill || null });
      return NextResponse.json({
        status: "completed",
        result: {
          type: "image",
          ...imageResult,
          model: resolvedImageModel,
          mode: referenceResultMode,
          analyzedPrompt: resolved.prompt,
          referenceLabels,
          savedFile: primarySavedImage?.filename,
          localUrl: primarySavedImage?.localUrl,
          outputs: savedImages,
        },
      });
    }

    if (resolved.intent === "image") {
      const resolvedImageModel = resolveImageCardModel(model, IMAGE_MODEL);
      const requestedSize = typeof size === "string" ? size : "";
      const imageSize = resolveImageSize(size, resolvedImageModel);
      const requestedAspectRatio = normalizeAspectRatio(aspect_ratio);
      const resolvedAspectRatio = requestedAspectRatio || aspectRatioFromSize(imageSize);
      debugLog("Resolved image generation dimensions", {
        reqId,
        requestedSize,
        requestedAspectRatio: requestedAspectRatio || null,
        resolvedAspectRatio,
      });
      let actualSize = imageSize;
      let imageResult;
      const shouldUseExactSizeApi = shouldUseExactImageSizeApi(resolvedImageModel, imageSize);
      const fallbackSizes = shouldUseExactSizeApi ? [imageSize] : resolveImageGenerationFallbackSizes(imageSize);
      debugLog("Dispatching image generate supplier task", {
        reqId,
        n: n || 1,
        resolvedImageModel,
        requestedSize,
        resolvedAspectRatio,
        fallbackSizes,
        shouldUseExactSizeApi,
      });
      let lastError: unknown = null;

      for (let index = 0; index < fallbackSizes.length; index += 1) {
        const candidateSize = fallbackSizes[index];

        try {
          imageResult = await runImageTask({
            model: resolvedImageModel,
            prompt: resolved.prompt,
            size: candidateSize,
            aspect_ratio: resolvedAspectRatio,
            n: n || 1,
            executionMode: resolvedExecutionMode,
          });
          actualSize = candidateSize;
          lastError = null;
          break;
        } catch (error) {
          lastError = error;
          const canRetryWithLowerSize =
            index < fallbackSizes.length - 1 &&
            error instanceof ImageGenerationError &&
            [429, 502, 503, 504].includes(error.statusCode || 0);

          if (!canRetryWithLowerSize) {
            throw error;
          }

          const nextSize = fallbackSizes[index + 1];
          debugWarn(`Generate at ${candidateSize} failed, fallback to ${nextSize}`, {
            reqId,
            reason: error.message,
          });
        }
      }

      if (!imageResult && lastError) {
        throw lastError;
      }

      if (!imageResult.data || imageResult.data.length === 0) {
        await requestLogger.error("image.empty_result", "No image data in generation result", {
          mode: "image_generate",
        });
        await logResponse(500, { mode: "image_generate", reason: "no_image_data" });
        return NextResponse.json({ status: "error", error: "No image data returned" }, { status: 500 });
      }

      debugLog("Image generate supplier returned outputs", {
        reqId,
        dataCount: imageResult.data.length,
        urlPresencePreview: imageResult.data.slice(0, 2).map((entry) => typeof entry?.url === "string" && entry.url.length > 0),
      });

      const savedImages = await saveImagesToLocal(imageResult.data.map((entry) => entry.url));
      const primarySavedImage = savedImages[0];
      debugLog("Saved image generate outputs locally", {
        reqId,
        savedCount: savedImages.length,
        savedFiles: savedImages.map((image) => image.filename),
      });

      await logResponse(200, { mode: "image_generate", skill: skill || null });
      return NextResponse.json({
        status: "completed",
        result: {
          type: "image",
          ...imageResult,
          model: resolvedImageModel,
          mode: "generate",
          requestedSize: imageSize,
          actualSize,
          analyzedPrompt: resolved.prompt,
          referenceLabels: [],
          savedFile: primarySavedImage?.filename,
          localUrl: primarySavedImage?.localUrl,
          outputs: savedImages,
        },
      });
    }

    if (body.stream === true) {
      const resolvedChatModel = resolveTextPanelChatModel(model, AGENT_MODEL);
      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        async start(controller) {
          try {
            for await (const event of chatStream({
              model: resolvedChatModel,
              messages,
              signal: request.signal,
              stream: true,
            })) {
              controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
            }
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : "Unknown stream error";
            controller.enqueue(encoder.encode(`${JSON.stringify({ type: "error", error: errorMessage })}\n`));
          } finally {
            controller.close();
          }
        },
      });

      await logResponse(200, { mode: "chat", stream: true, skill: skill || null });

      return new NextResponse(stream, {
        headers: {
          "Content-Type": "application/x-ndjson; charset=utf-8",
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive",
        },
      });
    }

    const resolvedChatModel = resolveTextPanelChatModel(model, AGENT_MODEL);
    const chatResult = await chat({
      model: resolvedChatModel,
      messages,
      signal: request.signal,
    });

    const finalContent = chatResult.choices[0]?.message?.content || "";
    const reasoningContent = chatResult.choices[0]?.message?.reasoning_content || "";

    await logResponse(200, { mode: "chat", stream: false, skill: skill || null });
    return NextResponse.json({
      status: 'completed',
      result: {
        type: 'chat',
        content: finalContent,
        reasoningContent,
        model: resolvedChatModel,
      }
    });

  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    const errorStack = error instanceof Error ? error.stack : "";
    
    const statusCode = error instanceof ImageGenerationError && error.statusCode
      ? error.statusCode
      : 500;
    const failureClass = error instanceof ImageGenerationError && error.failureClass
      ? error.failureClass
      : "unknown";
    const isRetryable = error instanceof ImageGenerationError ? Boolean(error.isRetryable) : false;
    const retryAttempt = error instanceof ImageGenerationError && typeof error.retryAttempt === "number"
      ? error.retryAttempt
      : null;

    await requestLogger.error("request.error", "Generate API error", {
      statusCode,
      failureClass,
      isRetryable,
      retryAttempt,
      error: serializeError(error),
      ...getErrorDiagnostics(error),
    });

    await logResponse(statusCode, {
      mode: "error",
      error: errorMessage,
      failureClass,
      isRetryable,
      retryAttempt,
    });

    return NextResponse.json({
      status: 'error',
      error: errorMessage,
      failureClass: error instanceof ImageGenerationError ? error.failureClass : "unknown",
      stack: process.env.NODE_ENV === 'development' ? errorStack : undefined,
    }, { status: statusCode });
  }
}
