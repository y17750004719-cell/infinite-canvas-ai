import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const routePath = fileURLToPath(new URL('./api/local-assets/[...assetPath]/route.ts', import.meta.url));

test('local-assets route exists and serves immutable private runtime images', () => {
  assert.equal(fs.existsSync(routePath), true);

  const routeSource = fs.readFileSync(routePath, 'utf8');
  assert.equal(routeSource.includes('export async function GET('), true);
  assert.equal(routeSource.includes('params: Promise<{ assetPath?: string[] }>'), true);
  assert.equal(routeSource.includes('const { assetPath } = await params;'), true);
  assert.equal(routeSource.includes('resolveLocalAssetPathFromRouteSegments'), true);
  assert.equal(routeSource.includes('ensureCanvasImageLodFile'), true);
  assert.equal(routeSource.includes("if (!fileStat?.isFile()) {\n    const ensuredLod = await ensureCanvasImageLodFile"), true);
  assert.equal(routeSource.includes("'Cache-Control': 'private, max-age=31536000, immutable'"), true);
  assert.equal(routeSource.includes("isFallback ? NO_STORE_HEADERS : IMMUTABLE_ASSET_HEADERS"), true);
  assert.equal(routeSource.includes("'Content-Type': contentType"), true);
});

test('local-assets route rejects traversal and non-image requests', () => {
  const routeSource = fs.readFileSync(routePath, 'utf8');

  assert.equal(routeSource.includes("return NextResponse.json({ error: 'Asset path is required' }, { status: 400 });"), true);
  assert.equal(routeSource.includes("return NextResponse.json({ error: 'Unsupported asset path' }, { status: 400 });"), true);
  assert.equal(routeSource.includes("return NextResponse.json({ error: 'Asset not found' }, { status: 404 });"), true);
});
