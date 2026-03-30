import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const apiClientSource = fs.readFileSync(path.join(__dirname, 'api-client.ts'), 'utf8');

test('api-client routes Gemini official image requests through the requested model path', () => {
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

test('api-client recognizes Gemini 3.1 Flash Image as an official image model', () => {
  assert.equal(apiClientSource.includes('SUPPORTED_GEMINI_OFFICIAL_IMAGE_MODELS'), true);
  assert.equal(apiClientSource.includes('"gemini-3.1-flash-image-preview"'), true);
  assert.equal(apiClientSource.includes('isGeminiOfficialImageModel(request.model)'), true);
});

test('api-client keeps official Gemini image request formatting for 1K 2K and 4K outputs', () => {
  assert.equal(apiClientSource.includes('resolveGeminiOfficialImageSize'), true);
  assert.equal(apiClientSource.includes('imageSize'), true);
  assert.equal(apiClientSource.includes('responseModalities'), true);
  assert.equal(apiClientSource.includes('inlineData'), true);
});

test('api-client no longer hardcodes the Pro image model as the only official route', () => {
  assert.equal(
    apiClientSource.includes('const GEMINI_OFFICIAL_IMAGE_MODEL = "gemini-3-pro-image-preview";'),
    false
  );
  assert.equal(
    apiClientSource.includes('model: GEMINI_OFFICIAL_IMAGE_MODEL'),
    false
  );
});
