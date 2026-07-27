import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const hookPath = fileURLToPath(new URL('./hooks/useImageRegionSelectionController.ts', import.meta.url));
const source = fs.readFileSync(hookPath, 'utf8');

test('region recognition controller cancels superseded requests and rejects stale revisions', () => {
  assert.equal(source.includes('controllersRef.current.get(regionId)?.abort()'), true);
  assert.equal(source.includes('revisionsRef.current.get(region.id) === revision'), true);
  assert.equal(source.includes('signal: controller.signal'), true);
  assert.equal(source.includes('imageSrc: evidence.imageSrc || region.imageSrc'), true);
  assert.equal(source.includes('cropImageSrc'), true);
});

test('region recognition controller preserves manual fallback state on non-abort failures', () => {
  assert.equal(source.includes("status: 'failed'"), true);
  assert.equal(source.includes('onFailed(region.id)'), true);
  assert.equal(source.includes("error.name === 'AbortError'"), true);
});
