import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const routePath = path.join(__dirname, 'api', 'settings', 'provider', 'route.ts');

test('provider settings route exists and exposes GET/PUT handlers on node runtime', () => {
  assert.equal(fs.existsSync(routePath), true);

  const routeSource = fs.readFileSync(routePath, 'utf8');
  assert.equal(routeSource.includes("export const runtime = 'nodejs';"), true);
  assert.equal(routeSource.includes("export const dynamic = 'force-dynamic';"), true);
  assert.equal(routeSource.includes('export async function GET()'), true);
  assert.equal(routeSource.includes('export async function PUT(request: NextRequest)'), true);
  assert.equal(routeSource.includes('readProviderConfig'), true);
  assert.equal(routeSource.includes('updateProviderConfig'), true);
});

test('provider settings route guards invalid JSON bodies before updates', () => {
  const routeSource = fs.readFileSync(routePath, 'utf8');

  assert.equal(routeSource.includes('const body = await request.json().catch(() => null);'), true);
  assert.equal(routeSource.includes("return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });"), true);
});
