import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(here, 'api-client.ts'), 'utf8');

test('image routing is selected from configured provider protocol', () => {
  assert.match(source, /resolveConfiguredProviderProtocol\(provider, model\)/);
  assert.match(source, /if \(protocol === "gemini"\)/);
  assert.match(source, /if \(protocol === "openai" \|\| protocol === "responses"\)/);
  assert.doesNotMatch(source, /SUPPORTED_(?:GEMINI|OPENAI_COMPATIBLE)_IMAGE_MODELS/);
  assert.doesNotMatch(source, /function isGptImage2Model/);
  assert.doesNotMatch(source, /function isOpenAiCompatibleImageModel/);
});

test('OpenAI-compatible image payload is protocol-shaped', () => {
  assert.match(source, /resolveOpenAiImageSizeForAspectRatio\(request\.size, requestedAspectRatio\)/);
  assert.doesNotMatch(source, /requestBody\.aspect_ratio/);
  assert.doesNotMatch(source, /formData\.set\("aspect_ratio"/);
  assert.match(source, /requestBody\.size = imageSize/);
  assert.match(source, /request\.n/);
});

test('Gemini image payload always carries native image configuration', () => {
  assert.match(source, /imageConfig\.aspectRatio = aspectRatio/);
  assert.match(source, /imageConfig\.imageSize = imageSize/);
  assert.match(source, /responseModalities: \["TEXT", "IMAGE"\]/);
});

test('unknown image protocol fails before provider request and is non-retryable', () => {
  assert.match(source, /provider_protocol_unsupported/);
  assert.match(source, /failureStage: "provider_selection"/);
  assert.match(source, /isRetryable: false/);
});

test('legacy model-name routing and image fallback branches are absent', () => {
  assert.doesNotMatch(source, /resolveImageCapabilityModelId/);
  assert.doesNotMatch(source, /mirrorsInfiniteCanvasGptImage2TextToImage/);
  assert.doesNotMatch(source, /getGptImage2SizeValidationError/);
});

test('provider failures retain structured diagnostics and timeout policy', () => {
  assert.match(source, /providerId\?: string/);
  assert.match(source, /endpointHost\?: string/);
  assert.match(source, /failureStage\?: string/);
  assert.match(source, /outcomeUnknown\?: boolean/);
  assert.match(source, /PRODUCTION_TIMEOUT_MS/);
});
