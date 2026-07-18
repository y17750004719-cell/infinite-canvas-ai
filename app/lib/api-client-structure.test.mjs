import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const apiClientSource = fs.readFileSync(path.join(__dirname, 'api-client.ts'), 'utf8');
const generateRouteSource = fs.readFileSync(path.join(__dirname, '../api/generate/route.ts'), 'utf8');

test('api-client resolves supplier endpoints from the multi-provider runtime registry instead of module-scoped env constants', () => {
  assert.equal(
    apiClientSource.includes('effectiveProviderProtocol'),
    true
  );
  assert.equal(apiClientSource.includes('const API_URL ='), false);
  assert.equal(apiClientSource.includes('const API_KEY ='), false);
  assert.equal(apiClientSource.includes('const providerRegistry = await readProviderRegistry();'), true);
  assert.equal(apiClientSource.includes('const provider = getProviderById(providerRegistry.providers, providerId);'), true);
  assert.equal(apiClientSource.includes('const providerTargets = resolveProviderRequestTargets(provider.baseUrl);'), true);
  assert.equal(apiClientSource.includes('providerEndpointUrl(transportProvider, "imageGenerationEndpoint", "/v1/images/generations")'), true);
  assert.equal(apiClientSource.includes('providerEndpointUrl(transportProvider, "imageEditEndpoint", "/v1/images/edits")'), true);
});

test('api-client uses Infinite-Canvas style per-model protocol overrides instead of Gemini name guessing', () => {
  assert.equal(apiClientSource.includes('effectiveProviderProtocol(provider, model)'), true);
  assert.equal(
    apiClientSource.includes('const protocol = provider.protocol === "gemini" || isGeminiModelFamily(model)'),
    false
  );
  assert.equal(apiClientSource.includes('const protocol = effectiveProviderProtocol(provider, model);'), true);
});

test('api-client uses protocol-specific auth headers and accepts request-level provider ids', () => {
  assert.equal(apiClientSource.includes('providerId?: string;'), true);
  assert.equal(apiClientSource.includes('"x-goog-api-key": apiKey'), true);
  assert.equal(apiClientSource.includes('Authorization: bearerAuthorizationHeader(apiKey)'), true);
  assert.equal(apiClientSource.includes('providerId: request.providerId,'), true);
  assert.equal(apiClientSource.includes('provider.imageRequestMode === "openai-json"'), true);
  assert.equal(apiClientSource.includes('response_format: "url"'), true);
});

test('api-client selects scoped image api keys from effective protocol only', () => {
  assert.equal(apiClientSource.includes('function resolveProviderApiKey('), true);
  assert.equal(apiClientSource.includes('purpose === "chat"'), true);
  assert.equal(apiClientSource.includes('const imageApiKeys = Array.isArray(provider.imageApiKeys)'), true);
  assert.equal(apiClientSource.includes('for (const imageApiKey of imageApiKeys)'), true);
  assert.equal(apiClientSource.includes('imageApiKey.scope === "all"'), true);
  assert.equal(apiClientSource.includes('imageApiKey.apiKey'), true);
  assert.equal(apiClientSource.includes('imageApiKey.scope === "gemini" && protocol === "gemini"'), true);
  assert.equal(apiClientSource.includes('imageApiKey.scope === "gpt" && protocol === "openai"'), true);
  assert.equal(apiClientSource.includes('isGeminiModelFamily(model)'), false);
  assert.equal(apiClientSource.includes('isGptImageModelFamily(model)'), false);
  assert.equal(apiClientSource.includes('const apiKey = resolveProviderApiKey({'), true);
});

test('api-client keeps the Gemini official image helper available as a non-default path', () => {
  assert.equal(
    apiClientSource.includes('const endpoint = `${getGeminiOfficialApiBaseUrl(providerTargets)}/v1beta/models/${resolvedRequestModel}:generateContent`;'),
    true
  );
  assert.equal(
    apiClientSource.includes('endpoint: `/v1beta/models/${resolvedRequestModel}:generateContent`'),
    true
  );
  assert.equal(
    apiClientSource.includes('normalizedModel: model'),
    true
  );
  assert.equal(
    apiClientSource.includes('resolvedRequestModel'),
    true
  );
});

test('api-client keeps Gemini native image routing behind the official helper path and supports gemini-3.1 flash image as a live request model', () => {
  assert.equal(
    apiClientSource.includes('export function shouldUseExactImageSizeApi(model?: string, size?: string): boolean {'),
    true
  );
  assert.equal(
    apiClientSource.includes('return generateGeminiOfficialImage({'),
    true
  );
  const supportedGeminiSection = apiClientSource.match(/const SUPPORTED_GEMINI_OFFICIAL_IMAGE_MODELS = new Set\(\[(.*?)\]\);/s)?.[1] || '';
  assert.equal(supportedGeminiSection.includes('"gemini-2.5-flash-image"'), true);
  assert.equal(supportedGeminiSection.includes('"gemini-3-pro-image-preview"'), true);
  assert.equal(supportedGeminiSection.includes('"gemini-3.1-flash-image-preview"'), true);
  assert.equal(
    apiClientSource.includes('if (protocol === "gemini" && isGeminiOfficialImageModel(normalizedModel)) {'),
    true
  );
  assert.equal(
    apiClientSource.includes('return editImage({'),
    false
  );
});

test('api-client keeps gemini-3.1 flash image preview as an official Gemini image request model', () => {
  assert.equal(apiClientSource.includes('SUPPORTED_GEMINI_OFFICIAL_IMAGE_MODELS'), true);
  const supportedGeminiSection = apiClientSource.match(/const SUPPORTED_GEMINI_OFFICIAL_IMAGE_MODELS = new Set\(\[(.*?)\]\);/s)?.[1] || '';
  assert.equal(supportedGeminiSection.includes('"gemini-2.5-flash-image"'), true);
  assert.equal(supportedGeminiSection.includes('"gemini-3.1-flash-image-preview"'), true);
  assert.equal(
    apiClientSource.includes('return normalizedModel.length > 0 && SUPPORTED_GEMINI_OFFICIAL_IMAGE_MODELS.has(normalizedModel);'),
    true
  );
});

test('api-client also supports gpt-image-2 through the OpenAI compatible image path', () => {
  const supportedOpenAiCompatibleSection =
    apiClientSource.match(/const SUPPORTED_OPENAI_COMPATIBLE_IMAGE_MODELS = new Set\(\[(.*?)\]\);/s)?.[1] || '';
  assert.equal(supportedOpenAiCompatibleSection.includes('"gpt-image-2"'), true);
  assert.equal(
    apiClientSource.includes('function isOpenAiCompatibleImageModel(model?: string): boolean {'),
    true
  );
  assert.equal(
    apiClientSource.includes('return normalizedModel.length > 0;'),
    true
  );
  assert.equal(
    apiClientSource.includes('if (isOpenAiCompatibleImageModel(normalizedModel)) {'),
    true
  );
  assert.equal(
    apiClientSource.includes('return generateOpenAiCompatibleImage({'),
    true
  );
});

test('api-client normalizes provider-returned gpt-image-2 variants before routing image requests', () => {
  assert.equal(
    apiClientSource.includes('normalizeImageModelCapabilityId(model)'),
    true
  );
  assert.equal(
    apiClientSource.includes('import { getGeminiImageSizeEnum, getImageModelCapability, normalizeImageModelCapabilityId, resolveImageRequestModel'),
    true
  );
});

test('api-client uses opportunistic task polling for OpenAI compatible images without async submit URLs', () => {
  assert.equal(
    apiClientSource.includes('const asyncImageSubmitTimeoutMs = parsePositiveInt(process.env.COMFLY_ASYNC_IMAGE_SUBMIT_TIMEOUT_MS, 1800000);'),
    true
  );
  assert.equal(
    apiClientSource.includes('const asyncImagePollTimeoutMs = parsePositiveInt(process.env.COMFLY_ASYNC_POLL_TIMEOUT_MS, 1800000);'),
    true
  );
  assert.equal(
    apiClientSource.includes('const asyncImagePollIntervalMs = parsePositiveInt(process.env.COMFLY_ASYNC_POLL_INTERVAL_MS, 2000);'),
    true
  );
  assert.equal(
    apiClientSource.includes('const requestedExecutionMode = request.executionMode === "async" ? "async" : "sync";'),
    true
  );
  assert.equal(
    apiClientSource.includes('const executionMode = (mirrorsInfiniteCanvasGptImage2TextToImage || usesImageEditsApi) ? "sync" : requestedExecutionMode;'),
    true
  );
  assert.equal(
    apiClientSource.includes('const endpointPath = usesImageEditsApi ? "/images/edits" : "/images/generations";'),
    true
  );
  assert.equal(
    apiClientSource.includes('const baseEndpoint = usesImageEditsApi ? imageEditUrl : imageGenerationUrl;'),
    true
  );
  assert.equal(
    apiClientSource.includes('const endpoint = baseEndpoint;'),
    true
  );
  assert.equal(apiClientSource.includes('usesAsyncSubmit'), false);
  assert.equal(apiClientSource.includes('?async=true'), false);
  assert.equal(
    apiClientSource.includes('async function pollOpenAiCompatibleImageTask('),
    true
  );
  assert.equal(
    apiClientSource.includes('const endpoint = `${taskBaseUrl}/images/tasks/${taskId}`;'),
    true
  );
  assert.equal(
    apiClientSource.includes('const taskId = extractOptionalTaskId(payload);'),
    true
  );
  assert.equal(
    apiClientSource.includes('const timeoutId = setTimeout(() => controller.abort(), asyncImageSubmitTimeoutMs);'),
    true
  );
  assert.equal(
    apiClientSource.includes('signal: controller.signal,'),
    true
  );
  assert.equal(
    apiClientSource.includes('timeoutMs: asyncImageSubmitTimeoutMs'),
    true
  );
  assert.equal(
    apiClientSource.includes('return pollOpenAiCompatibleImageTask({'),
    true
  );
  assert.equal(
    apiClientSource.includes('export function shouldUseImageEditsApi(model?: string, referenceImageCount = 0): boolean {'),
    true
  );
  assert.equal(
    apiClientSource.includes('referenceImageCount > 0'),
    true
  );
  assert.equal(
    apiClientSource.includes('const shouldSendTopLevelResponseFormat = !usesImageEditsApi && provider.imageRequestMode !== "openai-json" && !mirrorsInfiniteCanvasGptImage2TextToImage;'),
    true
  );
  assert.equal(
    apiClientSource.includes('requestBody.response_format = request.response_format || "url";'),
    true
  );
});

test('api-client keeps non-gpt-image-2 generations JSON with top-level response_format and real quality', () => {
  assert.equal(
    apiClientSource.includes('if (imageQuality) {\n    requestBody.quality = imageQuality;\n  }'),
    false
  );
  assert.equal(
    apiClientSource.includes('if (imageQuality && provider.imageRequestMode !== "openai-json") {\n    requestBody.quality = imageQuality;\n  }'),
    true
  );
  assert.equal(
    apiClientSource.includes('const shouldSendTopLevelResponseFormat = !usesImageEditsApi && provider.imageRequestMode !== "openai-json" && !mirrorsInfiniteCanvasGptImage2TextToImage;'),
    true
  );
  assert.equal(
    apiClientSource.includes('requestBody.response_format = request.response_format || "url";'),
    true
  );
  assert.equal(
    apiClientSource.includes('const endpointPath = usesImageEditsApi ? "/images/edits" : "/images/generations";'),
    true
  );
});

test('api-client mirrors Infinite-Canvas for default OpenAI gpt-image-2 text-to-image requests', () => {
  assert.equal(
    apiClientSource.includes('api.86gamestore.com'),
    false
  );
  assert.equal(
    apiClientSource.includes('const mirrorsInfiniteCanvasGptImage2TextToImage ='),
    true
  );
  assert.equal(
    apiClientSource.includes('provider.imageRequestMode === "openai" &&\n    isGptImage2Model(model) &&\n    referenceImages.length === 0;'),
    true
  );
  assert.equal(
    apiClientSource.includes('const executionMode = (mirrorsInfiniteCanvasGptImage2TextToImage || usesImageEditsApi) ? "sync" : requestedExecutionMode;'),
    true
  );
  assert.equal(
    apiClientSource.includes('const requestedImageQuality = typeof request.quality === "string" ? request.quality.trim().toLowerCase() : "";'),
    true
  );
  assert.equal(
    apiClientSource.includes('const imageQuality = ["low", "medium", "high"].includes(requestedImageQuality) ? requestedImageQuality : null;'),
    true
  );
  assert.equal(
    apiClientSource.includes('&& !mirrorsInfiniteCanvasGptImage2TextToImage;'),
    true
  );
});

test('api-client polls sync OpenAI-compatible image responses when the provider returns a task id', () => {
  assert.equal(
    apiClientSource.includes('function extractOptionalTaskId(input: unknown, depth = 0): string | null {'),
    true
  );
  for (const fieldName of ['"task_id"', '"taskId"', '"submit_id"', '"video_id"', '"videoId"']) {
    assert.equal(apiClientSource.includes(fieldName), true, `${fieldName} should be accepted as a task id field`);
  }
  assert.equal(apiClientSource.includes('id.trim().toLowerCase().startsWith("task")'), true);
  assert.equal(
    apiClientSource.includes('return extractOptionalTaskId(payload.data, depth + 1);'),
    true
  );
  assert.equal(
    apiClientSource.includes('if (taskId) {\n        return pollOpenAiCompatibleImageTask({'),
    true
  );
});

test('api-client image payload parsing avoids spread push recursion for nested arrays', () => {
  assert.equal(
    apiClientSource.includes('nested.push(...toImageEntries('),
    false
  );
  assert.equal(
    apiClientSource.includes('for (const entry of toImageEntries(item, depth + 1)) {\n        nested.push(entry);\n      }'),
    true
  );
});

test('generate route saves generated data URLs through the shared non-recursive parser', () => {
  assert.equal(
    generateRouteSource.includes('import { createStoredImageName, parseImageDataUrl } from "../../lib/api-security.mjs";'),
    true
  );
  assert.equal(
    generateRouteSource.includes('const parsed = parseImageDataUrl(imageUrl, { maxBytes: MAX_SAVED_IMAGE_BYTES });'),
    true
  );
  assert.equal(
    generateRouteSource.includes('imageUrl.match(/^data:'),
    false
  );
});

test('api-client keeps openai-json mode on generations and sends response_format inside extra_body only', () => {
  assert.equal(
    apiClientSource.includes('if (provider.imageRequestMode === "openai-json") {'),
    true
  );
  assert.equal(
    apiClientSource.includes('requestBody.extra_body = {'),
    true
  );
  assert.equal(
    apiClientSource.includes('response_format: request.response_format || "url",'),
    true
  );
  assert.equal(
    apiClientSource.includes('if (referenceImages.length > 0) {\n      (requestBody.extra_body as Record<string, unknown>).image = referenceImages;\n    }'),
    true
  );
  assert.equal(
    apiClientSource.includes('if (imageQuality && provider.imageRequestMode !== "openai-json") {\n    requestBody.quality = imageQuality;\n  }'),
    true
  );
});

test('api-client mirrors Infinite-Canvas fallback requests for OpenAI-compatible image routes', () => {
  assert.equal(apiClientSource.includes('function imagesApiUnsupportedText(text: string): boolean {'), true);
  assert.equal(apiClientSource.includes('response = await postImageRequest(\n            imageEditUrl,'), true);
  assert.equal(apiClientSource.includes('const buildEditsFallbackPayload = async () => {'), true);
  assert.equal(apiClientSource.includes('const referenceBlobs = await Promise.all(referenceImages.map((image) => referenceToBlob(image, request.signal)));'), true);
  assert.equal(apiClientSource.includes('formData.append("image", blob, `reference-${index + 1}.${mimeTypeToFileExtension(mimeType)}`);'), true);
  assert.equal(apiClientSource.includes('} else if (usesImageEditsApi && !isGptImage2Model(model)) {'), true);
  assert.equal(apiClientSource.includes('response = await postImageRequest(\n            imageGenerationUrl,'), true);
  assert.equal(apiClientSource.includes('image: referenceImages,'), true);
  assert.equal(apiClientSource.includes('n: 1,'), true);
});

test('api-client keeps image edits synchronous and recognizes Infinite-Canvas task statuses', () => {
  assert.equal(
    apiClientSource.includes('const endpoint = baseEndpoint;'),
    true
  );
  for (const statusName of ['"SUCCESSFUL"', '"SUCCEED"', '"COMPLETE"', '"OK"', '"READY"']) {
    assert.equal(apiClientSource.includes(statusName), true, `${statusName} should be accepted as a success task status`);
  }
  for (const statusName of ['"FAIL"', '"ERRORED"', '"REJECTED"', '"EXPIRED"']) {
    assert.equal(apiClientSource.includes(statusName), true, `${statusName} should be accepted as a failure task status`);
  }
  assert.equal(apiClientSource.includes('if (IMAGE_TASK_FAILURE_STATUSES.has(taskStatus)) {'), true);
  assert.equal(apiClientSource.includes('if (IMAGE_TASK_SUCCESS_STATUSES.has(status)) {'), true);
  assert.equal(apiClientSource.includes('if (IMAGE_TASK_FAILURE_STATUSES.has(status)) {'), true);
});

test('api-client retries retryable OpenAI-compatible image transport failures once', () => {
  assert.equal(
    apiClientSource.includes('for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {'),
    true
  );
  assert.equal(
    apiClientSource.includes('Retrying retryable OpenAI compatible image transport failure'),
    true
  );
  assert.equal(
    apiClientSource.includes('if (failureState.isRetryable && attempt < maxAttempts) {'),
    true
  );
});

test('api-client parses common OpenAI compatible image2 task output field names', () => {
  assert.equal(apiClientSource.includes('const IMAGE_ENTRY_URL_KEYS = ['), true);
  for (const fieldName of [
    '"url"',
    '"image_url"',
    '"imageUrl"',
    '"file_url"',
    '"fileUrl"',
    '"output_url"',
    '"outputUrl"',
    '"result_url"',
    '"resultUrl"',
    '"download_url"',
    '"downloadUrl"',
    '"asset_url"',
    '"assetUrl"',
  ]) {
    assert.equal(apiClientSource.includes(fieldName), true, `${fieldName} should be accepted as an image URL field`);
  }
  assert.equal(apiClientSource.includes('const IMAGE_ENTRY_NESTED_KEYS = ['), true);
  assert.equal(apiClientSource.includes('"urls"'), true);
  assert.equal(apiClientSource.includes('"outputs"'), true);
  assert.equal(apiClientSource.includes('"results"'), true);
  assert.equal(apiClientSource.includes('"items"'), true);
  assert.equal(apiClientSource.includes('"files"'), true);
  assert.equal(apiClientSource.includes('"candidates"'), true);
  assert.equal(apiClientSource.includes('"inlineData"'), true);
  assert.equal(apiClientSource.includes('normalizeImageEntryUrl'), true);
  assert.equal(apiClientSource.includes('trimmed.startsWith("/assets/")'), true);
  assert.equal(apiClientSource.includes('trimmed.startsWith("/output/")'), true);
  assert.equal(apiClientSource.includes('data:image/png;base64,'), true);
  assert.equal(apiClientSource.includes('data:image/jpeg;base64,'), true);
  assert.equal(apiClientSource.includes('const IMAGE_ENTRY_BASE64_KEYS = ["b64_json", "base64", "image_base64", "imageBase64"] as const;'), true);
  assert.equal(apiClientSource.includes('obj.type === "image_generation_call"'), true);
});

test('api-client logs payload key summaries when async image2 tasks succeed without parsed images', () => {
  assert.equal(apiClientSource.includes('summarizePayloadKeys(payload)'), true);
  assert.equal(
    apiClientSource.includes('"供应商任务成功，但返回体未识别到图片地址"'),
    true
  );
});

test('api-client keeps official Gemini image request formatting for 1K 2K and 4K outputs', () => {
  assert.equal(apiClientSource.includes('resolveGeminiOfficialImageSize'), true);
  assert.equal(apiClientSource.includes('imageSize'), true);
  assert.equal(apiClientSource.includes('responseModalities'), true);
  assert.equal(apiClientSource.includes('extractGeminiImageOutputs'), true);
});

test('api-client exact-size routing stays scoped to explicit 1K 2K and 4K requests', () => {
  assert.equal(
    apiClientSource.includes('const EXACT_IMAGE_SIZE_REQUEST_SIZES = new Set(['),
    true
  );
  assert.equal(
    apiClientSource.includes('"1024x1024"'),
    true
  );
  assert.equal(
    apiClientSource.includes('"2048x2048"'),
    true
  );
  assert.equal(
    apiClientSource.includes('"4096x4096"'),
    true
  );
});

test('api-client uses a fixed 120 second timeout for Gemini official image submit requests', () => {
  assert.equal(
    apiClientSource.includes('const asyncImageSubmitTimeoutMs = parsePositiveInt(process.env.COMFLY_ASYNC_IMAGE_SUBMIT_TIMEOUT_MS, 1800000);'),
    true
  );
  assert.equal(
    apiClientSource.includes('const timeoutMs = 120000;'),
    true
  );
  assert.equal(
    apiClientSource.includes('const timeoutId = setTimeout(() => controller.abort(), timeoutMs);'),
    true
  );
});

test('api-client decouples Gemini image supplier fetches from the outer request signal and retries retryable socket disconnects once', () => {
  assert.equal(
    apiClientSource.includes('request.signal?.addEventListener("abort", onAbort);'),
    false
  );
  assert.equal(
    apiClientSource.includes('request.signal?.removeEventListener("abort", onAbort);'),
    false
  );
  assert.equal(
    apiClientSource.includes('const maxAttempts = 2;'),
    true
  );
  assert.equal(
    apiClientSource.includes('function classifyGeminiImageTransportFailure(error: unknown): {'),
    true
  );
  assert.equal(
    apiClientSource.includes('causeCode === "UND_ERR_SOCKET"'),
    true
  );
  assert.equal(
    apiClientSource.includes('causeCode === "ECONNRESET"'),
    true
  );
  assert.equal(
    apiClientSource.includes('causeMessage?.includes("other side closed")'),
    true
  );
  assert.equal(
    apiClientSource.includes('causeMessage?.includes("client network socket disconnected before secure tls connection was established")'),
    true
  );
  assert.equal(
    apiClientSource.includes('if (failureState.isRetryable && attempt < maxAttempts) {'),
    true
  );
});

test('api-client annotates Gemini image failures with failureClass retryability and retryAttempt metadata', () => {
  assert.equal(
    apiClientSource.includes('failureClass?: "transport" | "timeout" | "upstream_http" | "payload" | "unknown";'),
    true
  );
  assert.equal(
    apiClientSource.includes('retryAttempt?: number;'),
    true
  );
  assert.equal(
    apiClientSource.includes('failureClass: failureState.failureClass'),
    true
  );
  assert.equal(
    apiClientSource.includes('isRetryable: failureState.isRetryable'),
    true
  );
  assert.equal(
    apiClientSource.includes('retryAttempt: attempt'),
    true
  );
});

test('api-client sends Gemini native reference images as inline_data parts and not as OpenAI-style image fields', () => {
  assert.equal(apiClientSource.includes('inline_data'), true);
  assert.equal(apiClientSource.includes('mime_type'), true);
  assert.equal(apiClientSource.includes('contents:'), true);
  assert.equal(apiClientSource.includes('requestBody.image = request.reference_images;'), false);
});

test('api-client maps square pixel sizes to Gemini imageSize tiers and sends them only for gemini-3-pro-image-preview', () => {
  assert.equal(
    apiClientSource.includes('function resolveGeminiOfficialImageSize(size?: string): "1K" | "2K" | "4K" {'),
    true
  );
  assert.equal(
    apiClientSource.includes('if (longestEdge >= 4096) {'),
    true
  );
  assert.equal(
    apiClientSource.includes('if (longestEdge >= 2048) {'),
    true
  );
  assert.equal(
    apiClientSource.includes('function supportsGeminiImageSizeConfig(model?: string): boolean {'),
    true
  );
  assert.equal(
    apiClientSource.includes('imageConfig.imageSize = imageSize;'),
    true
  );
  assert.equal(
    apiClientSource.includes('if (supportsGeminiImageSizeConfig(model)) {'),
    true
  );
});

test('api-client also sends Gemini official imageSize config for gemini-2.5 flash image requests', () => {
  assert.equal(
    apiClientSource.includes('return supportsImageModelImageSizeConfig(normalizedModel);'),
    true
  );
  assert.equal(
    apiClientSource.includes('from "./image-model-capabilities.mjs";'),
    true
  );
  assert.equal(
    apiClientSource.includes('supportsImageModelImageSizeConfig'),
    true
  );
});

test('api-client resolves the 4k gemini request model variant before building the supplier endpoint', () => {
  assert.equal(
    apiClientSource.includes('const resolvedRequestModel = resolveImageRequestModel(model, request.size);'),
    true
  );
  assert.equal(
    apiClientSource.includes('`/v1beta/models/${resolvedRequestModel}:generateContent`'),
    true
  );
  assert.equal(
    apiClientSource.includes('resolvedRequestModel: resolvedRequestModel'),
    true
  );
});

test('api-client no longer keeps nano-banana compatibility mappings in the Gemini-only image path', () => {
  assert.equal(
    apiClientSource.includes('function normalizeImageRequestModel(model?: string): string {'),
    true
  );
  assert.equal(
    apiClientSource.includes('return "gemini-2.5-flash-image";'),
    false
  );
  assert.equal(
    apiClientSource.includes('nano-banana-2'),
    false
  );
  assert.equal(
    apiClientSource.includes('const normalizedModel = normalizeImageRequestModel(model);'),
    true
  );
});

test('api-client no longer includes Fal queue response parsing for removed image models', () => {
  assert.equal(
    apiClientSource.includes('request_id'),
    false
  );
  assert.equal(
    apiClientSource.includes('status_url'),
    false
  );
});

test('api-client protocol logs expose Gemini request-mode diagnostics without Fal image modes', () => {
  assert.equal(
    apiClientSource.includes('mode: "gemini_official_image"'),
    true
  );
  assert.equal(
    apiClientSource.includes('mode: "fal_nano_banana_generate"'),
    false
  );
  assert.equal(
    apiClientSource.includes('mode: "fal_nano_banana_edit"'),
    false
  );
  assert.equal(
    apiClientSource.includes('mode: "fal_nano_banana_result"'),
    false
  );
  assert.equal(
    apiClientSource.includes('requestedModel'),
    true
  );
  assert.equal(
    apiClientSource.includes('normalizedModel'),
    true
  );
});

test('api-client exposes 4Z documented image request models in the available model catalog', () => {
  assert.equal(
    apiClientSource.includes('{ id: "gemini-2.5-flash-image", name: "Gemini 2.5 Flash Image", provider: "Google" }'),
    true
  );
  assert.equal(
    apiClientSource.includes('{ id: "gemini-3.1-flash-image-preview", name: "Gemini 3.1 Flash Image", provider: "Google" }'),
    true
  );
  assert.equal(
    apiClientSource.includes('Nano Banana'),
    false
  );
  assert.equal(
    apiClientSource.includes('{ id: "gemini-3-pro-image-preview", name: "Gemini 3 Pro (Image)", provider: "Google" }'),
    true
  );
  assert.equal(
    apiClientSource.includes('{ id: "gpt-image-2", name: "GPT Image 2", provider: "OpenAI" }'),
    true
  );
});

test('api-client builds an OpenAI compatible image request body with image references for gpt-image-2', () => {
  assert.equal(
    apiClientSource.includes('const usesImageEditsApi = provider.imageRequestMode === "openai-json"'),
    true
  );
  assert.equal(
    apiClientSource.includes('const formData = new FormData();'),
    true
  );
  assert.equal(
    apiClientSource.includes('formData.append("image", blob, `reference-${index + 1}.${mimeTypeToFileExtension(mimeType)}`);'),
    true
  );
  assert.equal(
    apiClientSource.includes('mode: "openai_compatible_image"'),
    true
  );
  assert.equal(
    apiClientSource.includes('if (!usesImageEditsApi && referenceImages.length > 0) {'),
    true
  );
  assert.equal(
    apiClientSource.includes('requestBody.image = referenceImages;') ||
      apiClientSource.includes('image: referenceImages,'),
    true
  );
  assert.equal(
    apiClientSource.includes('const supportsAspectRatio = getImageModelCapability(model).supportsAspectRatio;'),
    true
  );
  assert.equal(
    apiClientSource.includes('formData.set("quality", imageQuality);'),
    true
  );
  assert.equal(
    apiClientSource.includes('requestBody.quality = imageQuality;'),
    true
  );
  assert.equal(
    apiClientSource.includes('if (supportsAspectRatio && aspectRatio) {'),
    true
  );
  assert.equal(
    apiClientSource.includes('formData.set("aspect_ratio", aspectRatio);'),
    true
  );
  assert.equal(
    apiClientSource.includes('requestBody.aspect_ratio = aspectRatio;'),
    true
  );
  assert.equal(
    apiClientSource.includes('const outputs = toImageEntries(payload);'),
    true
  );
});

test('api-client no longer relies on generic /images/tasks fail_reason parsing for image task failures', () => {
  assert.equal(apiClientSource.includes('function extractAsyncTaskFailureMessage('), false);
  assert.equal(apiClientSource.includes('fail_reason'), false);
});

test('api-client no longer converts local edit inputs into absolute URLs for removed Fal image models', () => {
  assert.equal(
    apiClientSource.includes('function toAbsoluteImageUrl('),
    false
  );
  assert.equal(
    apiClientSource.includes('requestOrigin'),
    false
  );
});

test('api-client builds reusable supplier request diagnostics with host retry and elapsed fields', () => {
  assert.equal(
    apiClientSource.includes('function getEndpointHost(endpoint: string): string | null {'),
    true
  );
  assert.equal(
    apiClientSource.includes('function buildSupplierRequestDiagnostics({'),
    true
  );
  assert.equal(
    apiClientSource.includes('host: getEndpointHost(endpoint)'),
    true
  );
  assert.equal(
    apiClientSource.includes('retryCount: Math.max(0, attempt - 1)'),
    true
  );
  assert.equal(
    apiClientSource.includes('retriesRemaining: Math.max(0, maxAttempts - attempt)'),
    true
  );
  assert.equal(
    apiClientSource.includes('elapsedMs: Math.max(0, Date.now() - requestStartedAt)'),
    true
  );
});

test('api-client logs supplier transport diagnostics for Gemini image and chat fetch failures', () => {
  assert.equal(
    apiClientSource.includes('mode: "gemini_official_image"'),
    true
  );
  assert.equal(
    apiClientSource.includes('mode: "chat"'),
    true
  );
  assert.equal(
    apiClientSource.includes('mode: "chat_stream"'),
    true
  );
  assert.equal(
    apiClientSource.includes('...buildSupplierRequestDiagnostics({'),
    true
  );
});

test('api-client routes Gemini text models through official generateContent and streamGenerateContent endpoints', () => {
  assert.equal(
    apiClientSource.includes('const isGeminiModel = protocol === "gemini";'),
    true
  );
  assert.equal(
    apiClientSource.includes('? `${getGeminiOfficialApiBaseUrl(providerTargets)}/v1beta/models/${model}:generateContent`'),
    true
  );
  assert.equal(
    apiClientSource.includes('convertChatMessagesToGeminiRequest'),
    true
  );
});

test('api-client converts Gemini chat messages and image parts into official contents/inline_data payloads', () => {
  assert.equal(
    apiClientSource.includes('systemInstruction'),
    true
  );
  assert.equal(
    apiClientSource.includes('role: msg.role === "assistant" ? ("model" as const) : ("user" as const)'),
    true
  );
  assert.equal(
    apiClientSource.includes('type: "image_url"'),
    false
  );
  assert.equal(
    apiClientSource.includes('inline_data'),
    true
  );
});

test('api-client materializes local chat images before both Gemini and OpenAI-compatible transport', () => {
  assert.equal(apiClientSource.includes('materializeChatMessageImages'), true);
  assert.equal(apiClientSource.includes('const requestMessages = materialized.messages'), true);
  assert.equal(apiClientSource.includes('messages: requestMessages'), true);
  assert.equal(apiClientSource.includes('convertChatMessagesToGeminiRequest(requestMessages'), true);
  assert.equal(apiClientSource.includes('localImageCount: materialized.localImageCount'), true);
  assert.equal(apiClientSource.includes('referenceImageBytes: materialized.totalImageBytes'), true);
});

test('api-client adds Gemini no-image payload summaries and explicit failure classification', () => {
  assert.equal(
    apiClientSource.includes('summarizeGeminiImagePayload'),
    true
  );
  assert.equal(
    apiClientSource.includes('classifyGeminiImagePayload'),
    true
  );
  assert.equal(
    apiClientSource.includes('buildGeminiNoImageErrorMessage'),
    true
  );
  assert.equal(
    apiClientSource.includes('rawPayloadPreview'),
    true
  );
  assert.equal(
    apiClientSource.includes('finishReasons'),
    true
  );
  assert.equal(
    apiClientSource.includes('promptBlockReason'),
    true
  );
});
