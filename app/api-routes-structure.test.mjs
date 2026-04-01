import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillJobsRouteSource = fs.readFileSync(
  path.join(__dirname, 'api', 'skills', 'jobs', 'route.ts'),
  'utf8'
);

test('skill jobs route guards invalid JSON bodies before job creation', () => {
  assert.equal(
    skillJobsRouteSource.includes('const body = await request.json().catch(() => null);'),
    true
  );
  assert.equal(
    skillJobsRouteSource.includes("return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400, headers: NO_STORE_HEADERS });"),
    true
  );
});
