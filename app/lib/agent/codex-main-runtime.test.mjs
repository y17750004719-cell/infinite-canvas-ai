import test from 'node:test';
import assert from 'node:assert/strict';
import { CODEX_MAIN_SNAPSHOT, isCodexMainSnapshot } from './codex-main-snapshot.mjs';
import { validateApplicationToolName, isApplicationImageTool } from './application-tool-dispatcher.mjs';

test('Codex Main snapshot is explicit and manual', () => {
  assert.equal(CODEX_MAIN_SNAPSHOT.wireApi, 'responses');
  assert.equal(CODEX_MAIN_SNAPSHOT.sourceCommit, '53c542d944c705f3a66780a19223223bee57cbb6');
  assert.ok(CODEX_MAIN_SNAPSHOT.supportedRequests.includes('turn/start'));
  assert.equal(isCodexMainSnapshot(CODEX_MAIN_SNAPSHOT), true);
});

test('application dispatcher only permits registered tools and rejects native capabilities', () => {
  assert.deepEqual(validateApplicationToolName('generate_image', ['generate_image']), {
    ok: true, requestedTool: 'generate_image', allowedTools: ['generate_image'],
  });
  const rejected = validateApplicationToolName('image_generation', ['generate_image']);
  assert.equal(rejected.ok, false);
  assert.equal(rejected.error.code, 'native_capability_disabled');
  assert.equal(rejected.error.retryable, false);
  assert.equal(isApplicationImageTool('generate_image'), true);
});
