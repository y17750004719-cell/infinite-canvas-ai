/**
 * Immutable request context shared by the agent runtime services.
 * Keeping this shape small prevents services from reaching into controller
 * closures or creating a second state store.
 */
export function createAgentRuntimeContext(input = {}) {
  const context = {
    sessionId: String(input.sessionId || ''),
    threadId: String(input.threadId || input.sessionId || ''),
    turnId: String(input.turnId || ''),
    taskId: String(input.taskId || ''),
    operationId: String(input.operationId || ''),
    runId: String(input.runId || ''),
    providerFingerprint: input.providerFingerprint || null,
    contractVersion: input.contractVersion == null ? null : String(input.contractVersion),
    abortSignal: input.abortSignal || null,
  };
  return Object.freeze(context);
}

export function withTurnContext(context, input = {}) {
  return createAgentRuntimeContext({ ...context, ...input });
}
