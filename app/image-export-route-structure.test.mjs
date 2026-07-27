import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const routePath = fileURLToPath(new URL('./api/image-tools/export/route.ts', import.meta.url));

test('image export route exists and validates the src query parameter', () => {
  assert.equal(fs.existsSync(routePath), true);

  const routeSource = fs.readFileSync(routePath, 'utf8');
  assert.equal(routeSource.includes('export async function GET(request: NextRequest)'), true);
  assert.equal(routeSource.includes("const sourceUrl = request.nextUrl.searchParams.get('src')?.trim() || '';"), true);
  assert.equal(routeSource.includes("return NextResponse.json({ error: 'Image source is required' }, { status: 400 });"), true);
});

test('image export route resolves local runtime and legacy assets with image-only validation', () => {
  const routeSource = fs.readFileSync(routePath, 'utf8');

  assert.equal(routeSource.includes('resolveLocalAssetPath(sourceUrl,'), true);
  assert.equal(routeSource.includes('LOCAL_ASSET_ALLOWED_EXTENSIONS'), true);
  assert.equal(routeSource.includes("return NextResponse.json({ error: 'Unsupported image source' }, { status: 400 });"), true);
});

test('image export route supports remote fetch downloads with limits and attachment headers', () => {
  const routeSource = fs.readFileSync(routePath, 'utf8');

  assert.equal(routeSource.includes("if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {"), true);
  assert.equal(routeSource.includes('const controller = new AbortController();'), true);
  assert.equal(routeSource.includes('const contentLength = Number(response.headers.get('), true);
  assert.equal(routeSource.includes("return new NextResponse(buffer, {"), true);
  assert.equal(routeSource.includes("'Content-Disposition': `attachment; filename=\"${filename}\"`"), true);
  assert.equal(routeSource.includes("'Cache-Control': 'no-store'"), true);
});
