import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const controllerSource = fs.readFileSync(path.join(__dirname, 'hooks/useWorkspaceSessionController.ts'), 'utf8');

test('workspace session controller wraps setSessions so sessionsRef stays current before the next render', () => {
  assert.equal(controllerSource.includes("import { resolveStateUpdate } from '../lib/state-update.mjs';"), true);
  assert.equal(controllerSource.includes("const [sessions, setSessionsState] = useState<ProjectSession[]>([]);"), true);
  assert.equal(controllerSource.includes("const setSessions = useCallback((value: SetStateAction<ProjectSession[]>) => {"), true);
  assert.equal(controllerSource.includes('const nextSessions = resolveStateUpdate(value, sessionsRef.current);'), true);
  assert.equal(controllerSource.includes('sessionsRef.current = nextSessions;'), true);
  assert.equal(controllerSource.includes('setSessionsState(nextSessions);'), true);
});

test('workspace session recovery keeps journal-backed active runs across refresh', () => {
  assert.match(controllerSource, /Running turns are journal-backed/);
  assert.doesNotMatch(controllerSource, /activeAgentRun: undefined/);
});

test('workspace session controller immediately persists sessions migrated to schema v4', () => {
  assert.match(controllerSource, /savedSessions\[index\]\?\.schemaVersion !== 5/);
  assert.match(controllerSource, /migratedSessions\.map\(\(session\) => upsertSession\(session\)\)/);
  assert.match(controllerSource, /Promise\.allSettled/);
});
