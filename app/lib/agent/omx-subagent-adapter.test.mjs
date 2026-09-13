import test from 'node:test';
import assert from 'node:assert/strict';
import { buildWorkerPrompt, collectOmxSubtaskResults, createOmxSubtasks, runOmxSubtasks, startOmxSubtasks } from './omx-subagent-adapter.mjs';

test('creates bounded readonly subtask specs', () => {
  const tasks = createOmxSubtasks({ taskId: 'parent', runId: 'run', requests: [{ role: 'reviewer', prompt: 'inspect' }, { role: 'invalid', prompt: 'explore' }] });
  assert.equal(tasks.length, 2); assert.equal(tasks[0].readonly, true); assert.equal(tasks[1].role, 'explorer');
});

test('isolates subtask failures while collecting results', async () => {
  const tasks = createOmxSubtasks({ taskId: 'parent', runId: 'run', requests: [{ id: 'ok', role: 'reviewer', prompt: 'ok' }, { id: 'bad', role: 'verifier', prompt: 'bad' }] });
  const results = await runOmxSubtasks({ subtasks: tasks, executor: async (task) => { if (task.id === 'bad') throw new Error('timeout'); return { summary: 'passed', evidence: [{ source: 'test', detail: 'ok' }] }; } });
  assert.deepEqual(results.map((result) => result.status), ['completed', 'failed']);
});

test('starts native workers with bounded prompts and collects results', async () => {
  const tasks = createOmxSubtasks({ taskId: 'parent', runId: 'run', requests: [{ id: 'review', role: 'reviewer', prompt: 'inspect the diff' }] });
  const calls = [];
  const gateway = {
    spawnAgent: async (input) => { calls.push(input); return { childThreadId: 'thread-child', childTaskId: 'task-child', childRunId: 'run-child', status: 'running' }; },
    wait: async () => ({ status: 'completed', summary: 'clean', evidence: [{ source: 'file.ts:1', detail: 'ok' }] }),
  };
  const handles = await startOmxSubtasks({ workflowId: 'code_review', objective: 'review', parentTaskId: 'parent', parentRunId: 'run', subtasks: tasks, gateway });
  assert.match(calls[0].prompt, /read-only/); assert.match(buildWorkerPrompt({ workflowId: 'code_review', parentTaskId: 'parent', parentRunId: 'run', objective: 'review', subtask: tasks[0] }), /do not spawn agents/);
  const results = await collectOmxSubtaskResults({ handles, gateway });
  assert.equal(results[0].status, 'completed');
});
