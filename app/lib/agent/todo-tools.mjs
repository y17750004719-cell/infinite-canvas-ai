const TODO_STATUSES = new Set(['pending', 'in_progress', 'completed']);

export const TODO_READ_TOOL = Object.freeze({
  name: 'todo_read',
  readOnly: true,
  requiresConfirmation: false,
  description: 'Read the current durable todo list for this thread.',
  parameters: { type: 'object', properties: {}, additionalProperties: false },
});

export const TODO_UPDATE_TOOL = Object.freeze({
  name: 'todo_update',
  readOnly: false,
  requiresConfirmation: true,
  description: 'Replace the current durable todo list after a single-use approval.',
  parameters: {
    type: 'object',
    properties: {
      items: {
        type: 'array', maxItems: 100,
        items: {
          type: 'object',
          properties: {
            id: { type: 'string', minLength: 1, maxLength: 200 },
            content: { type: 'string', minLength: 1, maxLength: 2000 },
            status: { type: 'string', enum: ['pending', 'in_progress', 'completed'] },
          },
          required: ['id', 'content', 'status'],
          additionalProperties: false,
        },
      },
    },
    required: ['items'],
    additionalProperties: false,
  },
});

function requiredString(value, field, maxLength) {
  if (typeof value !== 'string' || !value.trim()) throw new TypeError(`${field} is required`);
  const normalized = value.trim();
  if (normalized.length > maxLength) throw new TypeError(`${field} is too long`);
  return normalized;
}

export function validateTodoItems(value) {
  if (!Array.isArray(value)) throw new TypeError('items must be an array');
  if (value.length > 100) throw new TypeError('items must contain at most 100 entries');
  const ids = new Set();
  return value.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new TypeError(`items[${index}] must be an object`);
    const unexpected = Object.keys(item).find((key) => !['id', 'content', 'status'].includes(key));
    if (unexpected) throw new TypeError(`items[${index}].${unexpected} is not allowed`);
    const id = requiredString(item.id, `items[${index}].id`, 200);
    if (ids.has(id)) throw new TypeError(`items[${index}].id must be unique`);
    ids.add(id);
    const content = requiredString(item.content, `items[${index}].content`, 2000);
    if (!TODO_STATUSES.has(item.status)) throw new TypeError(`items[${index}].status is invalid`);
    return { id, content, status: item.status };
  });
}

function validateEmptyArguments(args) {
  if (!args || typeof args !== 'object' || Array.isArray(args) || Object.keys(args).length > 0) {
    throw new TypeError('todo_read arguments must be an empty object');
  }
}

function eventIdentity(context) {
  const result = {};
  for (const field of ['threadId', 'turnId', 'taskId', 'operationId', 'runId', 'itemId']) {
    result[field] = requiredString(context?.[field], field, 200);
  }
  if (!Number.isSafeInteger(context?.expectedSequence) || context.expectedSequence < 0) {
    throw new TypeError('expectedSequence must be a non-negative safe integer');
  }
  result.expectedSequence = context.expectedSequence;
  return result;
}

export function createTodoTools({ readThread, appendThreadEvent, authorizeTodoUpdate } = {}) {
  if (typeof readThread !== 'function') throw new TypeError('readThread is required');
  if (typeof appendThreadEvent !== 'function') throw new TypeError('appendThreadEvent is required');
  if (typeof authorizeTodoUpdate !== 'function') throw new TypeError('authorizeTodoUpdate is required');

  return {
    todo_read: {
      ...TODO_READ_TOOL,
      execute: async (args, context) => {
        validateEmptyArguments(args);
        const threadId = requiredString(context?.threadId, 'threadId', 200);
        const loaded = await readThread(threadId);
        const state = loaded?.state ?? loaded ?? {};
        return { items: validateTodoItems(Array.isArray(state.todoItems) ? state.todoItems : []) };
      },
    },
    todo_update: {
      ...TODO_UPDATE_TOOL,
      execute: async (args, context) => {
        if (!args || typeof args !== 'object' || Array.isArray(args) || Object.keys(args).some((key) => key !== 'items')) {
          throw new TypeError('todo_update arguments are invalid');
        }
        const items = validateTodoItems(args.items);
        const identity = eventIdentity(context);
        const authorization = await authorizeTodoUpdate({
          approval: context.approval,
          ...identity,
          toolName: 'todo_update',
          parameters: { items },
        });
        const event = await appendThreadEvent(identity.threadId, {
          type: 'item.completed',
          turnId: identity.turnId,
          taskId: identity.taskId,
          operationId: identity.operationId,
          runId: identity.runId,
          itemId: identity.itemId,
          itemType: 'todo_list',
          item: {
            type: 'todo_list',
            status: 'completed',
            title: 'Todo',
            items,
            updatedAt: Date.now(),
          },
        });
        return { items, event, authorization };
      },
    },
  };
}
