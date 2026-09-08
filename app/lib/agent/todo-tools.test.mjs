import test from 'node:test';
import assert from 'node:assert/strict';

import { createTodoTools, validateTodoItems } from './todo-tools.mjs';

const context = {
  threadId: 'thread-1', turnId: 'turn-1', taskId: 'task-1', operationId: 'op-1',
  runId: 'run-1', itemId: 'todo-1', expectedSequence: 4, approval: { status: 'approved' },
};

test('todo_read reads the durable thread state through the injected journal reader', async () => {
  const tools = createTodoTools({
    readThread: async (threadId) => ({ state: { threadId, todoItems: [{ id: 'a', content: 'Read', status: 'pending' }] } }),
    appendThreadEvent: async () => assert.fail('read must not append'),
    authorizeTodoUpdate: async () => assert.fail('read must not authorize'),
  });
  assert.deepEqual(await tools.todo_read.execute({}, { threadId: 'thread-1' }), {
    items: [{ id: 'a', content: 'Read', status: 'pending' }],
  });
});

test('todo_update authorizes first and appends a completed todo_list event', async () => {
  const calls = [];
  const tools = createTodoTools({
    readThread: async () => ({ state: { todoItems: [] } }),
    authorizeTodoUpdate: async (request) => { calls.push(['authorize', request]); return { status: 'consumed' }; },
    appendThreadEvent: async (threadId, event) => { calls.push(['append', threadId, event]); return { ...event, sequence: 5 }; },
  });
  const result = await tools.todo_update.execute({ items: [{ id: ' a ', content: ' Ship ', status: 'completed' }] }, context);
  assert.equal(calls[0][0], 'authorize');
  assert.equal(calls[1][0], 'append');
  assert.deepEqual(calls[0][1].parameters, { items: [{ id: 'a', content: 'Ship', status: 'completed' }] });
  assert.equal(calls[1][2].type, 'item.completed');
  assert.equal(calls[1][2].itemType, 'todo_list');
  assert.deepEqual(result.items, [{ id: 'a', content: 'Ship', status: 'completed' }]);
  assert.equal(result.event.sequence, 5);
});

test('todo_update performs no journal write when approval is stale', async () => {
  let writes = 0;
  const stale = Object.assign(new Error('stale'), { statusCode: 409, code: 'stale_operation' });
  const tools = createTodoTools({
    readThread: async () => ({ state: { todoItems: [] } }),
    authorizeTodoUpdate: async () => { throw stale; },
    appendThreadEvent: async () => { writes += 1; },
  });
  await assert.rejects(() => tools.todo_update.execute({ items: [] }, context), { statusCode: 409, code: 'stale_operation' });
  assert.equal(writes, 0);
});

test('todo item validation rejects duplicate ids, unknown fields, and invalid status', () => {
  assert.throws(() => validateTodoItems([
    { id: 'a', content: 'One', status: 'pending' },
    { id: 'a', content: 'Two', status: 'completed' },
  ]), /unique/);
  assert.throws(() => validateTodoItems([{ id: 'a', content: 'One', status: 'pending', secret: 'x' }]), /not allowed/);
  assert.throws(() => validateTodoItems([{ id: 'a', content: 'One', status: 'unknown' }]), /invalid/);
});
