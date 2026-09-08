import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const nativeCodexLock = JSON.parse(readFileSync(new URL('./native-codex-lock.json', import.meta.url), 'utf8'));

export function inspectNativeCodexSource(sourceRoot, command = execFileSync) {
  const root = resolve(sourceRoot);
  const head = command('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  if (head !== nativeCodexLock.sourceCommit) throw new Error('native_source_revision_mismatch');
  const changes = command('git', ['status', '--porcelain', '--untracked-files=all'], { cwd: root, encoding: 'utf8' }).trim();
  if (changes) throw new Error('native_source_dirty');
  const protocolRoot = resolve(root, nativeCodexLock.protocolSource);
  for (const name of ['ClientRequest.ts', 'ServerNotification.ts', 'v2/ThreadStartParams.ts', 'v2/TurnStartParams.ts']) {
    if (!existsSync(resolve(protocolRoot, name))) throw new Error('native_protocol_source_missing');
  }
  return { sourceCommit: head, protocolRoot, license: nativeCodexLock.license };
}

export function sha256File(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const sourceRoot = process.argv[2];
    if (!sourceRoot) throw new Error('Usage: node scripts/native-codex-preflight.mjs <source-root>');
    console.log(JSON.stringify(inspectNativeCodexSource(sourceRoot), null, 2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
