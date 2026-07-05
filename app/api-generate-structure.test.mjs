import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const routeSource = fs.readFileSync(path.join(__dirname, 'api', 'generate', 'route.ts'), 'utf8');

test('generate route keeps exact-size image card requests on a single requested size instead of silently downgrading', () => {
  assert.equal(
    routeSource.includes('shouldUseExactImageSizeApi'),
    true
  );
  assert.equal(
    routeSource.includes('const shouldUseExactSizeApi = shouldUseExactImageSizeApi(resolvedImageModel, imageSize);'),
    true
  );
  assert.equal(
    routeSource.includes('const fallbackSizes = shouldUseExactSizeApi ? [imageSize] : resolveImageGenerationFallbackSizes(imageSize);'),
    true
  );
});

test('generate route derives reference image mode from the supplier protocol instead of hardcoding image_edit for every referenced request', () => {
  assert.equal(
    routeSource.includes('shouldUseImageEditsApi'),
    true
  );
  assert.equal(
    routeSource.includes('const referenceResponseMode = usesImageEditsApi ? "image_edit" : "image_generate";'),
    true
  );
  assert.equal(
    routeSource.includes('const referenceResultMode = usesImageEditsApi ? "image_edit" : "generate";'),
    true
  );
});

test('generate route saves and returns every successful generated image output instead of only the first one', () => {
  assert.equal(
    routeSource.includes('const savedImages = await saveImagesToLocal(imageResult.data.map((entry) => entry.url));'),
    true
  );
  assert.equal(
    routeSource.includes('outputs: savedImages,'),
    true
  );
});

test('generate route accepts request-level provider routing fields and forwards them to supplier calls', () => {
  assert.equal(routeSource.includes('providerId?: string;'), true);
  assert.equal(routeSource.includes('imageProviderId?: string;'), true);
  assert.equal(routeSource.includes('chatProviderId?: string;'), true);
  assert.equal(routeSource.includes('providerId: imageProviderId || providerId,'), true);
  assert.equal(routeSource.includes('providerId: chatProviderId || providerId,'), true);
  assert.equal(routeSource.includes('imageProviderId: typeof imageProviderId === "string" ? imageProviderId : null,'), true);
  assert.equal(routeSource.includes('chatProviderId: typeof chatProviderId === "string" ? chatProviderId : null,'), true);
});

test('generate route decouples image supplier calls from the incoming request signal and returns failure classification metadata', () => {
  assert.equal(
    routeSource.includes('executionMode: resolvedExecutionMode,\n          signal: request.signal,'),
    false
  );
  assert.equal(
    routeSource.includes('executionMode: resolvedExecutionMode,\n            signal: request.signal,'),
    false
  );
  assert.equal(
    routeSource.includes('buildGenerateRouteErrorMeta'),
    true
  );
  assert.equal(
    routeSource.includes('const routeErrorMeta = buildGenerateRouteErrorMeta(error, ImageGenerationError);'),
    true
  );
  assert.equal(
    routeSource.includes('failureClass: error.failureClass,'),
    true
  );
  assert.equal(
    routeSource.includes('isRetryable: error.isRetryable,'),
    true
  );
  assert.equal(
    routeSource.includes('retryAttempt: error.retryAttempt,'),
    true
  );
});

test('generate route uses model capability size allowlists for gpt-image-2 and skips derived aspect ratios for size-only models', () => {
  assert.equal(
    routeSource.includes('getImageModelCapability'),
    true
  );
  assert.equal(
    routeSource.includes('from "../../lib/image-model-capabilities.mjs";'),
    true
  );
  assert.equal(
    routeSource.includes('function filterAllowlistByModelCapabilities(allowlist: string[], capabilityAllowlist: string[]): string[] {'),
    true
  );
  assert.equal(
    routeSource.includes('const capabilityAllowlist = getImageModelCapability(model).supportedSizes;'),
    false
  );
  assert.equal(
    routeSource.includes('const capability = getImageModelCapability(model);'),
    true
  );
  assert.equal(
    routeSource.includes('const capabilityAllowlist = capability.supportedSizes;'),
    true
  );
  assert.equal(
    routeSource.includes('supportsImageModelExactSize'),
    true
  );
  assert.equal(
    routeSource.includes('const modelAllowlist = filterAllowlistByModelCapabilities('),
    true
  );
  assert.equal(
    routeSource.includes('const globalAllowlist = filterAllowlistByModelCapabilities('),
    true
  );
  assert.equal(
    routeSource.includes(': capabilityAllowlist.length > 0'),
    true
  );
  assert.equal(
    routeSource.includes('if (supportsImageModelExactSize(model, requestedSize)) return requestedSize;'),
    true
  );
  assert.equal(
    routeSource.includes('const supportsAspectRatio = getImageModelCapability(resolvedImageModel).supportsAspectRatio;'),
    true
  );
  assert.equal(
    routeSource.includes('const resolvedAspectRatio = supportsAspectRatio ? (requestedAspectRatio || aspectRatioFromSize(imageSize)) : "";'),
    true
  );
  assert.equal(
    routeSource.includes('aspect_ratio: resolvedAspectRatio || undefined,'),
    true
  );
  assert.equal(
    routeSource.includes('quality: typeof quality === "string" ? quality : undefined,'),
    true
  );
});

test('generate route preserves resolved non-square gpt-image-2 sizes instead of downgrading them to square tiers', () => {
  assert.equal(
    routeSource.includes('if (supportsImageModelExactSize(model, requestedSize)) return requestedSize;'),
    true
  );
  assert.equal(
    routeSource.includes('debugWarn("Unsupported image size for current allowlist, fallback to default"'),
    true
  );
});

test('generate route keeps provider-returned gpt-image-2 variants on the gpt-image-2 capability path', () => {
  assert.equal(
    routeSource.includes('from "../../lib/generate-request-flow.mjs";'),
    true
  );
  assert.equal(
    routeSource.includes('const resolvedImageModel = resolveGenerateImageModelFromAllowedModels(model, allowedProviderModelIds);'),
    true
  );
});

test('generate route preserves provider-saved Gemini image variants instead of falling back to the static default model', () => {
  assert.equal(
    routeSource.includes('const allowedProviderModelIds = new Set<string>('),
    true
  );
  assert.equal(
    routeSource.includes('enabledProviders.flatMap((provider) =>'),
    true
  );
  assert.equal(
    routeSource.includes('provider.imageModels'),
    true
  );
  assert.equal(
    routeSource.includes('const resolvedImageModel = resolveGenerateImageModelFromAllowedModels(model, allowedProviderModelIds);'),
    true
  );
});

test('generate route validates returned image dimensions against the requested gpt-image-2 size before returning success', () => {
  assert.equal(
    routeSource.includes('getImageDimensionsFromBuffer'),
    true
  );
  assert.equal(
    routeSource.includes('SUPPLIER_IMAGE_SIZE_MISMATCH'),
    true
  );
  assert.equal(
    routeSource.includes('供应商未按请求尺寸返回图片'),
    true
  );
  assert.equal(
    routeSource.includes('requestedSize'),
    true
  );
  assert.equal(
    routeSource.includes('actualWidth'),
    true
  );
  assert.equal(
    routeSource.includes('actualHeight'),
    true
  );
});
