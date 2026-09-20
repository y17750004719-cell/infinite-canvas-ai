import test from 'node:test';
import assert from 'node:assert/strict';
import { CODEX_MAIN_SNAPSHOT } from './codex-main-snapshot.mjs';
import { validateApplicationToolName, isApplicationImageTool, APPLICATION_TOOL_CAPABILITY_SNAPSHOT } from './application-tool-dispatcher.mjs';
import { assertNativeCapabilitySnapshot } from './native-codex-host.mjs';
import fs from 'node:fs';
import path from 'node:path';

test('Codex Main snapshot is explicit and manual', () => {
  assert.equal(CODEX_MAIN_SNAPSHOT.wireApi, 'responses');
  assert.equal(CODEX_MAIN_SNAPSHOT.sourceCommit, '53c542d944c705f3a66780a19223223bee57cbb6');
  assert.ok(CODEX_MAIN_SNAPSHOT.supportedRequests.includes('turn/start'));
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

test('exec is rejected as an unregistered tool and application capability snapshot is enforced', () => {
  const rejected = validateApplicationToolName('exec', ['generate_image']);
  assert.equal(rejected.error.code, 'tool_not_allowed');
  assert.equal(rejected.error.retryable, false);
  assert.deepEqual(assertNativeCapabilitySnapshot({ wireApi: 'responses', ...APPLICATION_TOOL_CAPABILITY_SNAPSHOT }), {
    wireApi: 'responses', ...APPLICATION_TOOL_CAPABILITY_SNAPSHOT,
  });
  assert.throws(() => assertNativeCapabilitySnapshot({ wireApi: 'responses', ...APPLICATION_TOOL_CAPABILITY_SNAPSHOT, codeModeEnabled: true }), /native_capability_mismatch/);
});

test('Native runtime gateway delegates retry decisions to recovery routing', () => {
  const source = fs.readFileSync(path.resolve(import.meta.dirname, 'native-runtime-gateway.mjs'), 'utf8');
  assert.doesNotMatch(source, /recoverNativeStreamDisconnect|while\s*\(/);
  assert.match(source, /return runNativeAgentTurn\(input\)/);
});
