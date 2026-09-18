import { createTodoTools } from './todo-tools.mjs';

export function createAgentTodoExecutor({ threadJournal }) {
  return async (args, context = {}) => {
    const tools = createTodoTools({
      readThread: (threadId) => threadJournal.loadThread(threadId),
      appendThreadEvent: threadJournal.appendThreadEvent,
      authorizeTodoUpdate: async () => {
        if (context.confirmed !== true) {
          throw Object.assign(new Error('todo_update requires a single-use approval'), { statusCode: 409, code: 'approval_required' });
        }
        return { status: 'consumed', confirmationId: context.confirmationId || null };
      },
    });
    return tools.todo_update.execute(args, {
      ...context,
      threadId: context.threadId || context.sessionId,
      expectedSequence: Number.isSafeInteger(context.expectedSequence)
        ? context.expectedSequence
        : Number.isSafeInteger(context.lastSequence) ? context.lastSequence : 0,
    });
  };
}
