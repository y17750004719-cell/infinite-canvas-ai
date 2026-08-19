import assert from 'node:assert/strict';
import test from 'node:test';
import {
  enqueueActiveAgentRunInput,
  registerActiveAgentRun,
  settleActiveAgentRun,
  takeActiveAgentRunInputs,
  updateActiveAgentRun,
} from './active-run-registry.mjs';

test('non-interruptible execution defers steering until the current result is retained', () => {
  const runId = 'registry-test-image';
  registerActiveAgentRun(runId);
  updateActiveAgentRun(runId, { phase: 'executing', nonInterruptible: true });

  assert.deepEqual(enqueueActiveAgentRunInput(runId, { delivery: 'steer', input: '把背景调亮' }), {
    accepted: true,
    delivery: 'follow_up',
    phase: 'executing',
  });
  assert.equal(takeActiveAgentRunInputs(runId, 'steer').length, 0);
  assert.equal(takeActiveAgentRunInputs(runId, 'follow_up')[0].content[0].text, '把背景调亮');
  settleActiveAgentRun(runId);
});

test('queued input preserves reference labels and data images for the Pi turn', () => {
  const runId = 'registry-test-reference';
  registerActiveAgentRun(runId);
  enqueueActiveAgentRunInput(runId, {
    delivery: 'steer',
    input: '按这张图调整',
    referenceContext: { references: [{ id: 'canvas-1', label: '主视觉', role: 'reference', src: 'data:image/png;base64,AA==' }] },
  });
  const message = takeActiveAgentRunInputs(runId, 'steer')[0];
  assert.match(message.content[0].text, /主视觉/);
  assert.deepEqual(message.content[1], { type: 'image', mimeType: 'image/png', data: 'AA==' });
  settleActiveAgentRun(runId);
});
