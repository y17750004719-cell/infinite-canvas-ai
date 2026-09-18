import test from 'node:test';
import assert from 'node:assert/strict';
import { createAgentResponseLifecycle } from './agent-response-lifecycle.mjs';

test('response finalization flushes before settling and closing', async () => {
  const calls = [];
  const lifecycle = createAgentResponseLifecycle({
    flush: async () => calls.push('flush'),
    settle: () => calls.push('settle'),
    close: () => calls.push('close'),
  });
  assert.deepEqual(await lifecycle.finalize(), { finalized: true });
  assert.deepEqual(calls, ['flush', 'settle', 'close']);
  assert.deepEqual(await lifecycle.finalize(), { finalized: false });
  assert.deepEqual(calls, ['flush', 'settle', 'close']);
});

test('flush failures do not skip run settlement or stream close', async () => {
  const calls = [];
  const errors = [];
  const lifecycle = createAgentResponseLifecycle({
    flush: async () => { calls.push('flush'); throw new Error('sink failed'); },
    settle: () => calls.push('settle'),
    close: () => calls.push('close'),
    onError: (error, stage) => errors.push([error.message, stage]),
  });
  const result = await lifecycle.finalize();
  assert.equal(result.finalized, true);
  assert.equal(result.flushError.message, 'sink failed');
  assert.deepEqual(calls, ['flush', 'settle', 'close']);
  assert.deepEqual(errors, [['sink failed', 'flush']]);
});

