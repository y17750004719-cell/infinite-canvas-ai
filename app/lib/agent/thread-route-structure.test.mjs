import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const read = (file) => fs.readFileSync(path.resolve(import.meta.dirname, '../../api/agent', file), 'utf8');
const readController = () => fs.readFileSync(path.resolve(import.meta.dirname, 'agent-request-runtime.ts'), 'utf8');
const readReplay = () => fs.readFileSync(path.resolve(import.meta.dirname, 'thread-replay-service.mjs'), 'utf8');

test('agent thread status route exposes replay cursors', () => {
  const source = `${readController()}\n${readReplay()}`;
  assert.match(source, /export async function handleGet/);
  assert.match(source, /afterSequence/);
  assert.match(source, /beforeSequence/);
  assert.match(source, /queryThread/);
});

test('agent controller uses the journal facade instead of storage functions', () => {
  const source = readController();
  assert.match(source, /createThreadJournalService/);
  assert.match(source, /threadJournalService/);
  assert.doesNotMatch(source, /import\s*\{[^}]*\b(?:appendThreadEvent|loadThread|updateThreadState|consumeThreadInputs)\b[^}]*\}\s*from ['"]\.\/thread-journal-service/);
});

test('thread management routes expose list, fork, archive and unarchive operations', () => {
  assert.match(read('threads/route.ts'), /listThreads/);
  const detail = read('threads/[threadId]/route.ts');
  assert.match(detail, /forkThread/);
  assert.match(detail, /action === 'archive'/);
  assert.match(detail, /action === 'unarchive'/);
});
