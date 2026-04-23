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
    routeSource.includes('failureClass: error instanceof ImageGenerationError ? error.failureClass : "unknown",'),
    true
  );
  assert.equal(
    routeSource.includes('const errorMeta ='),
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
    routeSource.includes('import { getImageModelCapability } from "../../lib/image-model-capabilities.mjs";'),
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
    routeSource.includes(': !capability.supportsAspectRatio && capabilityAllowlist.length > 0'),
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
