import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');
const script = fs.readFileSync(path.join(root, 'scripts/smoke-image-generation.mjs'), 'utf8');
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

test('image smoke is explicit, paid-test guarded, and uses the production image route', () => {
  assert.equal(packageJson.scripts['test:image-smoke'], 'node scripts/smoke-image-generation.mjs');
  assert.match(script, /IMAGE_SMOKE_CONFIRM/);
  assert.match(script, /IMAGE_SMOKE_PROVIDER_ID/);
  assert.match(script, /IMAGE_SMOKE_MODEL/);
  assert.match(script, /\/api\/generate/);
  assert.match(script, /x-z-flow-image-planner/);
  assert.match(script, /IMAGE_SMOKE_REFERENCE/);
  assert.match(script, /imageCount === 0/);
});
