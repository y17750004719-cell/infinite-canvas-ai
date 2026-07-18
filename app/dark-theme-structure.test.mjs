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

test('assistant messages stay transparent while user messages keep filled bubbles without outlines', () => {
  assert.match(globalsSource, /:root \{[\s\S]*--workspace-message-user-bg: #f1f1ef;/);
  assert.match(globalsSource, /:root \{[\s\S]*--workspace-message-user-fg: #262626;/);
  assert.match(globalsSource, /\[data-workspace-theme="dark"\] \{[\s\S]*--workspace-message-user-bg: #343434;/);
  assert.match(globalsSource, /\[data-workspace-theme="dark"\] \{[\s\S]*--workspace-message-user-fg: #f5f5f5;/);
  assert.match(globalsSource, /\.workspace-message-assistant \{\s*border: 0;\s*background: transparent;/);
  assert.match(globalsSource, /\.workspace-message-user \{\s*border: 0;\s*background: var\(--workspace-message-user-bg\);/);
});

test('light theme text overrides include the portaled chat panel', () => {
  assert.match(
    globalsSource,
    /\[data-workspace-theme="light"\] :is\(\.workspace-editor-shell, \.workspace-chat-panel\) \.text-zinc-200/
  );
  assert.match(
    globalsSource,
    /\[data-workspace-theme="light"\] :is\(\.workspace-editor-shell, \.workspace-chat-panel\) \.text-zinc-500/
  );
});
