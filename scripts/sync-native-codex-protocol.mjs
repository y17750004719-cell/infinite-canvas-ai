import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import { dirname, resolve, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { inspectNativeCodexSource, nativeCodexLock } from './native-codex-preflight.mjs';

const sourceRoot = process.argv[2] && resolve(process.argv[2]);
if (!sourceRoot) throw new Error('Usage: node scripts/sync-native-codex-protocol.mjs <pinned-source-root>');
const { protocolRoot } = inspectNativeCodexSource(sourceRoot);
const destination = resolve(dirname(fileURLToPath(import.meta.url)), '../app/lib/agent/native-codex-protocol');
const pending = [
  'InitializeParams.ts', 'v2/ThreadStartParams.ts', 'v2/ThreadResumeParams.ts', 'v2/TurnStartParams.ts',
  'v2/ThreadStartResponse.ts', 'v2/TurnStartResponse.ts', 'v2/DynamicToolCallParams.ts',
  'v2/DynamicToolCallResponse.ts', 'v2/RawResponseItemCompletedNotification.ts',
  'v2/RawResponseCompletedNotification.ts', 'v2/AgentMessageDeltaNotification.ts',
];
const copied = new Set();
while (pending.length) {
  const name = pending.pop();
  if (copied.has(name)) continue;
  const path = resolve(protocolRoot, name);
  const within = relative(protocolRoot, path);
  if (within.startsWith('..') || isAbsolute(within)) throw new Error('protocol_import_escaped_source');
  const content = await readFile(path, 'utf8');
  for (const entry of ts.preProcessFile(content).importedFiles) {
    if (!entry.fileName.startsWith('.')) throw new Error('protocol_external_import');
    pending.push(relative(protocolRoot, resolve(dirname(path), `${entry.fileName.replace(/\.js$/, '')}.ts`)));
  }
  const target = resolve(destination, name);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, content);
  copied.add(name);
}
await copyFile(resolve(sourceRoot, 'LICENSE'), resolve(destination, 'LICENSE'));
await writeFile(resolve(destination, 'source.json'), `${JSON.stringify({ sourceCommit: nativeCodexLock.sourceCommit, files: [...copied].sort() }, null, 2)}\n`);
console.log(`Copied ${copied.size} generated protocol files from ${nativeCodexLock.sourceCommit}`);
