import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const layoutSource = fs.readFileSync(path.join(__dirname, 'layout.tsx'), 'utf8');

test('root layout mounts the global client error reporter', () => {
  assert.equal(layoutSource.includes("import ClientErrorReporter from './components/ClientErrorReporter';"), true);
  assert.equal(layoutSource.includes('<ClientErrorReporter />'), true);
});
