import test from 'node:test';
import assert from 'node:assert/strict';
import { handleManagementCommand } from './agent-management-service.mjs';

test('management commands use the injected journal facade and preserve NDJSON command items', async () => {
  const calls = [];
  const journal = {
    loadThread: async () => ({ state: { threadStatus: 'idle', turns: [], lastSequence: 0, todoItems: [] } }),
    appendThreadEvent: async (threadId, event) => {
      calls.push([threadId, event]);
      return { ...event, sequence: calls.length };
    },
    updateThreadState: async (_threadId, patch) => ({ threadStatus: 'idle', ...patch }),
  };
  const response = await handleManagementCommand('thread-1', { name: 'status', args: '', raw: '/status' }, { journal });
  assert.equal(response.status, 200);
  assert.equal(calls.length, 2);
  const rows = (await response.text()).trim().split('\n').map(JSON.parse);
  assert.deepEqual(rows.map((row) => row.type), ['item.started', 'item.completed']);
  assert.equal(rows[1].item.result.threadId, 'thread-1');
});
