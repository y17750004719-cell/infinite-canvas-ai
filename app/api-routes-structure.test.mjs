import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
test('legacy skill job API routes are removed', () => {
  assert.equal(fs.existsSync(path.join(__dirname, 'api', 'skills', 'jobs', 'route.ts')), false);
  assert.equal(fs.existsSync(path.join(__dirname, 'api', 'skills', 'jobs', '[jobId]', 'route.ts')), false);
});

test('workspace error boundary and build version diagnostics are wired', () => {
  const layout = fs.readFileSync(path.join(__dirname, 'layout.tsx'), 'utf8');
  const boundary = fs.readFileSync(path.join(__dirname, 'components', 'WorkspaceErrorBoundary.tsx'), 'utf8');
  const reporter = fs.readFileSync(path.join(__dirname, 'components', 'ClientErrorReporter.tsx'), 'utf8');
  const config = fs.readFileSync(path.join(__dirname, '..', 'next.config.js'), 'utf8');
  assert.match(layout, /WorkspaceErrorBoundary/);
  assert.match(boundary, /componentDidCatch/);
  assert.match(boundary, /页面需要刷新/);
  assert.match(reporter, /NEXT_PUBLIC_BUILD_VERSION/);
  assert.match(config, /NEXT_PUBLIC_BUILD_VERSION/);
});
