import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const routeSource = fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), 'api/settings/providers/xiaomi/oauth/callback/route.ts'),
  'utf8'
);

test('Xiaomi browser callback accepts the official state-less u redirect', () => {
  assert.equal(routeSource.includes("if (!code) throw new Error('Xiaomi callback is missing encrypted code');"), true);
  assert.equal(routeSource.includes("if (!state || !code)"), false);
});
