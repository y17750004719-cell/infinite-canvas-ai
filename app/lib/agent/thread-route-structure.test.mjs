import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const read = (file) => fs.readFileSync(path.resolve(import.meta.dirname, '../../api/agent', file), 'utf8');

test('agent thread status route exposes replay cursors', () => {
  const source = read('route.ts');
  assert.match(source, /export async function GET/);
  assert.match(source, /afterSequence/);
  assert.match(source, /beforeSequence/);
  assert.match(source, /queryThread/);
});

test('thread management routes expose list, fork, archive and unarchive operations', () => {
  assert.match(read('threads/route.ts'), /listThreads/);
  const detail = read('threads/[threadId]/route.ts');
  assert.match(detail, /forkThread/);
  assert.match(detail, /action === 'archive'/);
  assert.match(detail, /action === 'unarchive'/);
});
