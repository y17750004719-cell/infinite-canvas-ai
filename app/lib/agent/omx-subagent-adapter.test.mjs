import test from 'node:test';
import assert from 'node:assert/strict';
import { createOmxSubtasks, runOmxSubtasks } from './omx-subagent-adapter.mjs';

test('creates bounded readonly subtask specs', () => {
  const tasks = createOmxSubtasks({ taskId: 'parent', runId: 'run', requests: [{ role: 'reviewer', prompt: 'inspect' }, { role: 'invalid', prompt: 'explore' }] });
  assert.equal(tasks.length, 2); assert.equal(tasks[0].readonly, true); assert.equal(tasks[1].role, 'explorer');
});

test('isolates subtask failures while collecting results', async () => {
  const tasks = createOmxSubtasks({ taskId: 'parent', runId: 'run', requests: [{ id: 'ok', role: 'reviewer', prompt: 'ok' }, { id: 'bad', role: 'verifier', prompt: 'bad' }] });
  const results = await runOmxSubtasks({ subtasks: tasks, executor: async (task) => { if (task.id === 'bad') throw new Error('timeout'); return { summary: 'passed', evidence: [{ source: 'test', detail: 'ok' }] }; } });
  assert.deepEqual(results.map((result) => result.status), ['completed', 'failed']);
});
