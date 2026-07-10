import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [pageSource, globalsSource, workspacesSource, workspaceDetailSource] = await Promise.all([
  readFile(new URL('./page.tsx', import.meta.url), 'utf8'),
  readFile(new URL('./globals.css', import.meta.url), 'utf8'),
  readFile(new URL('./workspaces/page.tsx', import.meta.url), 'utf8'),
  readFile(new URL('./workspaces/[id]/page.tsx', import.meta.url), 'utf8'),
]);

test('dark workspace uses 90% black as its deepest solid surface', () => {
  assert.equal(pageSource.includes("appBg: '#1a1a1a'"), true);
  assert.equal(pageSource.includes("portFill: '#1a1a1a'"), true);
  assert.equal(globalsSource.includes('--workspace-page-bg: #1a1a1a;'), true);
  assert.equal(globalsSource.includes('--workspace-editor-bg: #1a1a1a;'), true);
  assert.equal(globalsSource.includes('background: #fff;'), false);
});

test('dark-capable workspace controls do not hard-code white surfaces', () => {
  assert.equal(pageSource.includes('data-canvas-bottom-toolbar="true"\n        className={`workspace-bottom-toolbar'), true);
  assert.equal(workspacesSource.includes('bg-white/90'), false);
  assert.equal(workspaceDetailSource.includes('bg-white/90'), false);
});
