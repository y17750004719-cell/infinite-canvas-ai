import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const apiClientSource = fs.readFileSync(path.join(__dirname, 'api-client.ts'), 'utf8');

test('api-client keeps the Gemini official image helper available as a non-default path', () => {
  assert.equal(
    apiClientSource.includes('const endpoint = `${getGeminiOfficialApiBaseUrl()}/v1beta/models/${model}:generateContent`;'),
    true
  );
  assert.equal(
    apiClientSource.includes('endpoint: `/v1beta/models/${request.model}:generateContent`'),
    true
  );
  assert.equal(
    apiClientSource.includes('model: request.model'),
    true
  );
});

test('api-client prioritizes the exact-size image helper before supplier edits or generations', () => {
  assert.equal(
    apiClientSource.includes('export function shouldUseExactImageSizeApi(model?: string, size?: string): boolean {'),
    true
  );
  assert.equal(
    apiClientSource.includes('if (shouldUseExactImageSizeApi(request.model, request.size)) {'),
    true
  );
  assert.equal(
    apiClientSource.includes('return generateGeminiOfficialImage({'),
    true
  );
  assert.equal(
    apiClientSource.includes('if (shouldUseImageEditsApi(request.model, images.length)) {'),
    true
  );
  assert.equal(
    apiClientSource.includes('return editImage({'),
    true
  );
});

test('api-client recognizes gemini-3.1 flash image as an exact-size capable Gemini image model', () => {
  assert.equal(apiClientSource.includes('SUPPORTED_GEMINI_OFFICIAL_IMAGE_MODELS'), true);
  assert.equal(
    apiClientSource.includes('"gemini-3.1-flash-image-preview"'),
    true
  );
  assert.equal(
    apiClientSource.includes('return normalizedModel.length > 0 && SUPPORTED_GEMINI_OFFICIAL_IMAGE_MODELS.has(normalizedModel);'),
    true
  );
  assert.equal(
    apiClientSource.includes('SUPPORTED_GEMINI_OFFICIAL_IMAGE_MODELS.has(normalizedModel)'),
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

test('api-client uses a dedicated configurable timeout for async unified image submit while keeping sync submit at 120 seconds', () => {
  assert.equal(
    apiClientSource.includes('const asyncImageSubmitTimeoutMs = parsePositiveInt(process.env.COMFLY_ASYNC_IMAGE_SUBMIT_TIMEOUT_MS, 600000);'),
    true
  );
  assert.equal(
    apiClientSource.includes('const submitTimeoutMs = executionMode === "async" ? asyncImageSubmitTimeoutMs : 120000;'),
    true
  );
  assert.equal(
    apiClientSource.includes('const timeoutId = setTimeout(() => controller.abort(), submitTimeoutMs);'),
    true
  );
});

test('api-client treats nano-banana-2 as a supplier aspect-ratio image model without routing it through the Gemini official helper', () => {
  assert.equal(apiClientSource.includes('const SUPPLIER_ASPECT_RATIO_IMAGE_MODELS = new Set(['), true);
  assert.equal(apiClientSource.includes('"nano-banana-2"'), true);
  assert.equal(apiClientSource.includes('function usesSupplierAspectRatioImageModel(model?: string): boolean {'), true);
  assert.equal(apiClientSource.includes('const usesAspectRatioParam = usesSupplierAspectRatioImageModel(request.model);'), true);
  assert.equal(apiClientSource.includes('if (usesAspectRatioParam) {'), true);
});

test('api-client sends supplier generations reference images in the image field and keeps edits reserved for explicit models', () => {
  assert.equal(
    apiClientSource.includes('const SUPPLIER_IMAGE_EDITS_MODELS = new Set(['),
    true
  );
  assert.equal(
    apiClientSource.includes('requestBody.image = request.reference_images;'),
    true
  );
  assert.equal(
    apiClientSource.includes('if (request.model === "nano-banana-2") {'),
    true
  );
  assert.equal(
    apiClientSource.includes('formData.append("image_size", request.size.trim());'),
    true
  );
});

test('api-client exposes nano-banana-2 in the available model catalog', () => {
  assert.equal(
    apiClientSource.includes('{ id: "nano-banana-2", name: "Nano Banana 2", provider: "Google" }'),
    true
  );
});

test('api-client extracts nested supplier fail_reason for async image task failures', () => {
  assert.equal(
    apiClientSource.includes('typeof payload.data === "object"'),
    true
  );
  assert.equal(
    apiClientSource.includes('fail_reason'),
    true
  );
  assert.equal(
    apiClientSource.includes('extractAsyncTaskFailureMessage('),
    true
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
