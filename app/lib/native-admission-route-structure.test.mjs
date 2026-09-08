import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const source = fs.readFileSync(path.resolve('app/api/settings/providers/validate-model/route.ts'), 'utf8');

test('native admission validation is server-owned and fail-closed', () => {
  assert.match(source, /readProviderRegistry/);
  assert.match(source, /effectiveProviderProtocol/);
  assert.match(source, /protocol_not_responses/);
  assert.match(source, /\/responses/);
  assert.match(source, /model-compatibility\.json/);
  assert.match(source, /configFingerprint/);
  assert.match(source, /providerUnauthorized|provider_unauthorized/);
  assert.doesNotMatch(source, /body\?\.apiKey|body\?\.baseUrl/);
});
