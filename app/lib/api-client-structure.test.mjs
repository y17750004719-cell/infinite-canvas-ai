import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const apiClientSource = fs.readFileSync(path.join(__dirname, 'api-client.ts'), 'utf8');

test('api-client resolves supplier endpoints from the runtime provider config instead of module-scoped env constants', () => {
  assert.equal(
    apiClientSource.includes('import { readProviderConfig, resolveProviderRequestTargets } from "./provider-config.mjs";'),
    true
  );
  assert.equal(apiClientSource.includes('const API_URL ='), false);
  assert.equal(apiClientSource.includes('const API_KEY ='), false);
  assert.equal(apiClientSource.includes('const providerConfig = await readProviderConfig();'), true);
  assert.equal(apiClientSource.includes('const providerTargets = resolveProviderRequestTargets(providerConfig.config.baseUrl);'), true);
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
    apiClientSource.includes('if (shouldUseExactImageSizeApi(normalizedModel, request.size)) {'),
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
    apiClientSource.includes('if (isGeminiOfficialImageModel(normalizedModel)) {'),
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
    apiClientSource.includes('return normalizedModel.length > 0 && SUPPORTED_OPENAI_COMPATIBLE_IMAGE_MODELS.has(normalizedModel);'),
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

test('api-client restores async submit and task polling for gpt-image-2 on the OpenAI compatible path', () => {
  assert.equal(
    apiClientSource.includes('const executionMode = request.executionMode === "async" ? "async" : "sync";'),
    true
  );
  assert.equal(
    apiClientSource.includes('? `${getOpenAiCompatibleImageApiBaseUrl(providerTargets)}/images/generations?async=true`'),
    true
  );
  assert.equal(
    apiClientSource.includes(': `${getOpenAiCompatibleImageApiBaseUrl(providerTargets)}/images/generations`;'),
    true
  );
  assert.equal(
    apiClientSource.includes('async function pollOpenAiCompatibleImageTask('),
    true
  );
  assert.equal(
    apiClientSource.includes('const endpoint = `${getOpenAiCompatibleImageApiBaseUrl(providerTargets)}/images/tasks/${taskId}`;'),
    true
  );
  assert.equal(
    apiClientSource.includes('const taskId = extractTaskId(payload as AsyncImageTaskSubmitResponse);'),
    true
  );
  assert.equal(
    apiClientSource.includes('return pollOpenAiCompatibleImageTask({'),
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
    apiClientSource.includes('const asyncImageSubmitTimeoutMs = parsePositiveInt(process.env.COMFLY_ASYNC_IMAGE_SUBMIT_TIMEOUT_MS, 600000);'),
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
    apiClientSource.includes('? `${getOpenAiCompatibleImageApiBaseUrl(providerTargets)}/images/generations?async=true`'),
    true
  );
  assert.equal(
    apiClientSource.includes(': `${getOpenAiCompatibleImageApiBaseUrl(providerTargets)}/images/generations`;'),
    true
  );
  assert.equal(
    apiClientSource.includes('mode: "openai_compatible_image"'),
    true
  );
  assert.equal(
    apiClientSource.includes('requestBody.image = referenceImages;'),
    true
  );
  assert.equal(
    apiClientSource.includes('const supportsAspectRatio = getImageModelCapability(model).supportsAspectRatio;'),
    true
  );
  assert.equal(
    apiClientSource.includes('requestBody.quality = request.quality.trim();'),
    true
  );
  assert.equal(
    apiClientSource.includes('if (supportsAspectRatio && aspectRatio) {'),
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
    apiClientSource.includes('function isGeminiOfficialTextModel(model?: string): boolean {'),
    true
  );
  assert.equal(
    apiClientSource.includes('? `${getGeminiOfficialApiBaseUrl(providerTargets)}/v1beta/models/${model}:generateContent`'),
    true
  );
  assert.equal(
    apiClientSource.includes('? `${getGeminiOfficialApiBaseUrl(providerTargets)}/v1beta/models/${model}:streamGenerateContent?alt=sse`'),
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
