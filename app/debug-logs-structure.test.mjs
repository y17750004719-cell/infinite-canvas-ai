import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const clientRouteSource = fs.readFileSync(
  path.join(__dirname, 'api', 'debug', 'logs', 'client', 'route.ts'),
  'utf8'
);
const debugLogsPageSource = fs.readFileSync(
  path.join(__dirname, 'debug', 'logs', 'page.tsx'),
  'utf8'
);

test('client debug logs route only accepts local development access and validates JSON input', () => {
  assert.equal(clientRouteSource.includes('isLocalLogAccessAllowed()'), true);
  assert.equal(clientRouteSource.includes('status: 403'), true);
  assert.equal(clientRouteSource.includes('const body = await request.json().catch(() => null);'), true);
  assert.equal(clientRouteSource.includes('typeof body.message !== "string"'), true);
  assert.equal(clientRouteSource.includes('typeof body.pageUrl !== "string"'), true);
  assert.equal(clientRouteSource.includes('await logger.error('), true);
  assert.equal(clientRouteSource.includes('return new NextResponse(null, { status: 204 });'), true);
});

test('debug logs page reads the current startup log file and points old logs to the local directory', () => {
  assert.equal(debugLogsPageSource.includes('isLocalLogAccessAllowed()'), true);
  assert.equal(debugLogsPageSource.includes('getCurrentStartupSession()'), true);
  assert.equal(debugLogsPageSource.includes('searchParams?: Promise<SearchParams>'), true);
  assert.equal(debugLogsPageSource.includes('const resolvedSearchParams = await searchParams;'), true);
  assert.equal(debugLogsPageSource.includes('await readLogEntries({'), true);
  assert.equal(debugLogsPageSource.includes('const level ='), true);
  assert.equal(debugLogsPageSource.includes('const source ='), true);
  assert.equal(debugLogsPageSource.includes('const q ='), true);
  assert.equal(debugLogsPageSource.includes('startupId: startupSession.startupId'), true);
  assert.equal(debugLogsPageSource.includes('旧启动日志请到'), true);
  assert.equal(debugLogsPageSource.includes('日志查看仅在本地开发环境开放'), true);
});
