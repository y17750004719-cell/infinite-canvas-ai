import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const routePath = fileURLToPath(new URL('./api/local-assets/[...assetPath]/route.ts', import.meta.url));

test('local-assets route exists and serves runtime images with no-store headers', () => {
  assert.equal(fs.existsSync(routePath), true);

  const routeSource = fs.readFileSync(routePath, 'utf8');
  assert.equal(routeSource.includes('export async function GET('), true);
  assert.equal(routeSource.includes('params: Promise<{ assetPath?: string[] }>'), true);
  assert.equal(routeSource.includes('const { assetPath } = await params;'), true);
  assert.equal(routeSource.includes('resolveLocalAssetPathFromRouteSegments'), true);
  assert.equal(routeSource.includes("'Cache-Control': 'no-store'"), true);
  assert.equal(routeSource.includes("'Content-Type': contentType"), true);
});

test('local-assets route rejects traversal and non-image requests', () => {
  const routeSource = fs.readFileSync(routePath, 'utf8');

  assert.equal(routeSource.includes("return NextResponse.json({ error: 'Asset path is required' }, { status: 400 });"), true);
  assert.equal(routeSource.includes("return NextResponse.json({ error: 'Unsupported asset path' }, { status: 400 });"), true);
  assert.equal(routeSource.includes("return NextResponse.json({ error: 'Asset not found' }, { status: 404 });"), true);
});
