import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const routeSource = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'api', 'generate', 'route.ts'), 'utf8');

test('generate route forwards protocol-neutral image parameters to the shared adapter', () => {
  assert.equal(routeSource.includes('aspect_ratio?: string;'), true);
  assert.equal(routeSource.includes('size: imageSize,'), true);
  assert.equal(routeSource.includes('aspect_ratio: resolvedAspectRatio || undefined,'), true);
});

test('generate route derives reference mode from supplier protocol', () => {
  assert.equal(routeSource.includes('shouldUseImageEditsApi'), true);
  assert.equal(routeSource.includes('referenceResponseMode'), true);
  assert.equal(routeSource.includes('referenceResultMode'), true);
});

test('generate route saves all successful image outputs', () => {
  assert.equal(routeSource.includes('saveImagesToLocal(imageResult.data.map'), true);
  assert.equal(routeSource.includes('outputs: savedImages,'), true);
});

test('generate route preserves structured failure metadata', () => {
  assert.equal(routeSource.includes('buildGenerateRouteErrorMeta'), true);
  assert.equal(routeSource.includes('failureCode: error.failureCode'), true);
  assert.equal(routeSource.includes('outcomeUnknown: error.outcomeUnknown'), true);
});

test('generate route does not select protocol from model names', () => {
  assert.equal(routeSource.includes('isGptImage2Model'), false);
  assert.equal(routeSource.includes('isOpenAiCompatibleImageModel'), false);
  assert.equal(routeSource.includes('model capability size allowlist'), false);
});

test('generate route keeps supplier dimensions and result-unknown classification', () => {
  assert.equal(routeSource.includes('getImageDimensionsFromBuffer'), true);
  assert.equal(routeSource.includes('provider_result_unknown'), true);
});
