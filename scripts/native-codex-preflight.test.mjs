import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { inspectNativeCodexSource, nativeCodexLock, sha256File } from './native-codex-preflight.mjs';

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'native-codex-preflight-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const protocol = join(root, nativeCodexLock.protocolSource);
  mkdirSync(join(protocol, 'v2'), { recursive: true });
  for (const name of ['ClientRequest.ts', 'ServerNotification.ts', 'v2/ThreadStartParams.ts', 'v2/TurnStartParams.ts']) {
    writeFileSync(join(protocol, name), '// Generated schema fixture\n');
  }
  return root;
}

test('preflight accepts only the pinned clean source and checked-in protocol', (t) => {
  const root = fixture(t);
  const command = (_name, args) => args[0] === 'rev-parse' ? nativeCodexLock.sourceCommit : '';
  assert.equal(inspectNativeCodexSource(root, command).sourceCommit, nativeCodexLock.sourceCommit);
});

test('a different revision cannot silently replace the pinned runtime', (t) => {
  assert.throws(() => inspectNativeCodexSource(fixture(t), () => 'different'), /native_source_revision_mismatch/);
});

test('uncommitted source changes cannot masquerade as the pinned runtime', (t) => {
  const command = (_name, args) => args[0] === 'rev-parse' ? nativeCodexLock.sourceCommit : ' M file.rs';
  assert.throws(() => inspectNativeCodexSource(fixture(t), command), /native_source_dirty/);
});

test('missing generated protocol prevents integration', (t) => {
  const root = fixture(t);
  rmSync(join(root, nativeCodexLock.protocolSource, 'v2/TurnStartParams.ts'));
  const command = (_name, args) => args[0] === 'rev-parse' ? nativeCodexLock.sourceCommit : '';
  assert.throws(() => inspectNativeCodexSource(root, command), /native_protocol_source_missing/);
});

test('binary digest is SHA-256 of exact bytes', (t) => {
  const file = join(fixture(t), 'binary');
  writeFileSync(file, 'abc');
  assert.equal(sha256File(file), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});
