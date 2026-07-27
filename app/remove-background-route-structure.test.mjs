import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const routePath = fileURLToPath(new URL('./api/image-tools/remove-background/route.ts', import.meta.url));

test('remove-background route exists again and guards invalid JSON bodies', () => {
  assert.equal(fs.existsSync(routePath), true);

  const routeSource = fs.readFileSync(routePath, 'utf8');
  assert.equal(routeSource.includes('const body = await request.json().catch(() => null);'), true);
  assert.equal(routeSource.includes("return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });"), true);
});

test('remove-background route uses the Recraft helper and returns runtime generated asset urls', () => {
  const routeSource = fs.readFileSync(routePath, 'utf8');

  assert.equal(routeSource.includes('createRecraftBackgroundRemovalRequest'), true);
  assert.equal(routeSource.includes('extractRecraftBackgroundRemovalUrl'), true);
  assert.equal(routeSource.includes("'runtime', 'uploads', 'generated'"), true);
  assert.equal(routeSource.includes('url: buildRuntimeAssetUrl(`uploads/generated/${filename}`)'), true);
  assert.equal(routeSource.includes('naturalWidth: dimensions?.naturalWidth'), true);
  assert.equal(routeSource.includes('naturalHeight: dimensions?.naturalHeight'), true);
});

test('remove-background route logs supplier and download diagnostics with explicit failure stages', () => {
  const routeSource = fs.readFileSync(routePath, 'utf8');

  assert.equal(routeSource.includes("'supplier.error'"), true);
  assert.equal(routeSource.includes("'supplier.parse_error'"), true);
  assert.equal(routeSource.includes("'supplier.payload_invalid'"), true);
  assert.equal(routeSource.includes("'result.download_start'"), true);
  assert.equal(routeSource.includes("'result.download_error'"), true);
  assert.equal(routeSource.includes("'result.download_success'"), true);
  assert.equal(routeSource.includes('failedStage'), true);
  assert.equal(routeSource.includes('supplierRequest.sourceMeta'), true);
});

test('remove-background route maps upstream supplier errors to an explicit COMFLY proxy message', () => {
  const routeSource = fs.readFileSync(routePath, 'utf8');

  assert.equal(routeSource.includes('createSupplierProxyErrorMessage'), true);
  assert.equal(routeSource.includes("'supplier.error'"), true);
  assert.equal(routeSource.includes('getReferenceHost(supplierRequest.endpoint)'), true);
});
