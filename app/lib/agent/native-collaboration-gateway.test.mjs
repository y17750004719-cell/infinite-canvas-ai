import test from 'node:test';
import assert from 'node:assert/strict';
import { createNativeCollaborationGateway } from './native-collaboration-gateway.mjs';

test('gateway maps collaboration operations and enforces readonly workers', async () => {
  const calls = [];
  const gateway = createNativeCollaborationGateway({ client: { request: async (method, params) => { calls.push([method, params]); return { status: 'running' }; } } });
  await gateway.spawnAgent({ parentRunId: 'run', role: 'reviewer', readonly: false });
  await gateway.wait({ childRunId: 'child' });
  assert.equal(calls[0][0], 'collab/agent/start');
  assert.equal(calls[0][1].readonly, true);
  assert.equal(calls[1][0], 'collab/agent/wait');
});

test('gateway reports unsupported collaboration distinctly', async () => {
  const gateway = createNativeCollaborationGateway({ client: { request: async () => { throw Object.assign(new Error('missing'), { code: 'method_not_found' }); } } });
  await assert.rejects(() => gateway.listAgents({}), (error) => error.code === 'subagents_unavailable');
});
