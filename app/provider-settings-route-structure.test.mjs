import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const routePath = path.join(__dirname, 'api', 'settings', 'provider', 'route.ts');
const providersRoutePath = path.join(__dirname, 'api', 'settings', 'providers', 'route.ts');
const testConnectionRoutePath = path.join(__dirname, 'api', 'settings', 'providers', 'test-connection', 'route.ts');
const probeAsyncRoutePath = path.join(__dirname, 'api', 'settings', 'providers', 'probe-async', 'route.ts');
const fetchModelsRoutePath = path.join(__dirname, 'api', 'settings', 'providers', 'fetch-models', 'route.ts');
const providerModelsPath = path.join(__dirname, 'lib', 'provider-models.ts');

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

test('multi-provider settings route exposes provider registry GET/PUT handlers', () => {
  assert.equal(fs.existsSync(providersRoutePath), true);

  const routeSource = fs.readFileSync(providersRoutePath, 'utf8');
  assert.equal(routeSource.includes("export const runtime = 'nodejs';"), true);
  assert.equal(routeSource.includes("export const dynamic = 'force-dynamic';"), true);
  assert.equal(routeSource.includes('export async function GET()'), true);
  assert.equal(routeSource.includes('export async function PUT(request: NextRequest)'), true);
  assert.equal(routeSource.includes('readProviderRegistry'), true);
  assert.equal(routeSource.includes('updateProviderRegistry'), true);
  assert.equal(routeSource.includes('toProviderRegistryView'), true);
  assert.equal(routeSource.includes("Providers are required"), true);
});

test('provider connection test route supports openai and gemini model probes with protocol-specific headers', () => {
  assert.equal(fs.existsSync(testConnectionRoutePath), true);

  const routeSource = fs.readFileSync(testConnectionRoutePath, 'utf8');
  assert.equal(routeSource.includes("export async function POST(request: NextRequest)"), true);
  assert.equal(routeSource.includes('fetchProviderModels'), true);
  assert.equal(routeSource.includes('imageRequestMode'), true);
  assert.equal(routeSource.includes('modelCount'), true);
});

test('provider fetch-models route exposes categorized upstream models without saving them directly', () => {
  assert.equal(fs.existsSync(fetchModelsRoutePath), true);
  assert.equal(fs.existsSync(providerModelsPath), true);

  const routeSource = fs.readFileSync(fetchModelsRoutePath, 'utf8');
  const helperSource = fs.readFileSync(providerModelsPath, 'utf8');
  assert.equal(routeSource.includes("export async function POST(request: NextRequest)"), true);
  assert.equal(routeSource.includes('fetchProviderModels'), true);
  assert.equal(routeSource.includes('allModels'), true);
  assert.equal(routeSource.includes('updateProviderRegistry'), false);
  assert.equal(helperSource.includes('upstreamModelsUrl'), true);
  assert.equal(helperSource.includes('classifyModel'), true);
  assert.equal(helperSource.includes("'x-goog-api-key': apiKey"), true);
  assert.equal(helperSource.includes('Authorization: `Bearer ${apiKey.replace(/^Bearer\\s+/i, \'\')}`'), true);
});

test('provider async probe route keeps async probing scoped to openai-compatible providers', () => {
  assert.equal(fs.existsSync(probeAsyncRoutePath), true);

  const routeSource = fs.readFileSync(probeAsyncRoutePath, 'utf8');
  assert.equal(routeSource.includes("export async function POST(request: NextRequest)"), true);
  assert.equal(routeSource.includes('openAiTaskProbeUrl'), true);
  assert.equal(routeSource.includes('/images/tasks/healthcheck_probe_do_not_submit'), true);
  assert.equal(routeSource.includes('Gemini 官方接口不使用 OpenAI 兼容异步任务端点'), true);
});
