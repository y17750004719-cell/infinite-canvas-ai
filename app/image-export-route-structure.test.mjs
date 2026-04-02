import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const routePath = '/Volumes/ZO/ZO.DESIGN/app/api/image-tools/export/route.ts';

test('image export route exists and validates the src query parameter', () => {
  assert.equal(fs.existsSync(routePath), true);

  const routeSource = fs.readFileSync(routePath, 'utf8');
  assert.equal(routeSource.includes('export async function GET(request: NextRequest)'), true);
  assert.equal(routeSource.includes("const sourceUrl = request.nextUrl.searchParams.get('src')?.trim() || '';"), true);
  assert.equal(routeSource.includes("return NextResponse.json({ error: 'Image source is required' }, { status: 400 });"), true);
});

test('image export route resolves local public assets with image-only validation', () => {
  const routeSource = fs.readFileSync(routePath, 'utf8');

  assert.equal(routeSource.includes('resolvePublicAssetPath(sourceUrl,'), true);
  assert.equal(routeSource.includes("allowedExtensions: ['.png', '.jpg', '.jpeg', '.webp', '.gif']"), true);
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
