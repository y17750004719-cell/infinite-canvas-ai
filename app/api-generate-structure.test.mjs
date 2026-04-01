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
