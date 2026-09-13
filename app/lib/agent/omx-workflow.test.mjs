import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { advanceOmxWorkflow, cancelOmxWorkflow, getOmxWorkflow, startOmxWorkflow } from './omx-workflow.mjs';

const task = `omx-test-${Date.now()}`;
test('workflow lifecycle is persisted and verification completes it', async () => {
  const started = await startOmxWorkflow({ taskId: task, objective: 'review', workflowId: 'code_review', runId: `run-${Date.now()}` });
  assert.equal(started.status, 'running');
  await advanceOmxWorkflow({ taskId: task, runId: started.runId, event: { type: 'subtask_started', id: 'reviewer-1', role: 'reviewer' } });
  await advanceOmxWorkflow({ taskId: task, runId: started.runId, event: { type: 'subtask_result', id: 'reviewer-1', summary: 'clean' } });
  const completed = await advanceOmxWorkflow({ taskId: task, runId: started.runId, event: { type: 'verification_result', passed: true, commands: ['npm test'], summary: 'passed' } });
  assert.equal(completed.status, 'completed');
  assert.equal((await getOmxWorkflow(task)).verification.passed, true);
  await fs.rm(path.join(process.cwd(), 'runtime', 'omx-workflows', task), { recursive: true, force: true });
});

test('stale identity and cancellation are safe', async () => {
  const id = `omx-cancel-${Date.now()}`;
  const started = await startOmxWorkflow({ taskId: id, objective: 'cancel', workflowId: 'plan' });
  await assert.rejects(() => advanceOmxWorkflow({ taskId: id, runId: 'wrong', event: { type: 'phase', phase: 'x' } }), /identity mismatch/);
  const cancelled = await cancelOmxWorkflow(id, started.runId);
  assert.equal(cancelled.status, 'cancelled');
  await fs.rm(path.join(process.cwd(), 'runtime', 'omx-workflows', id), { recursive: true, force: true });
});
