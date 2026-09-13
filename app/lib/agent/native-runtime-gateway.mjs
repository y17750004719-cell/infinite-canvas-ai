import { runNativeAgentTurn } from './native-agent-service.ts';
import { invalidateNativeCodexHost, invalidateNativeCodexHostScope } from './native-codex-host.mjs';
import { routeAgentRecovery } from './agent-recovery-routing-service.mjs';
import { CODEX_MAIN_SNAPSHOT } from './codex-main-snapshot.mjs';
import { createNativeCollaborationGateway } from './native-collaboration-gateway.mjs';

/**
 * Application boundary for Codex Main's thread/turn runtime. Business tools
 * stay outside this module; this gateway only owns runtime invocation and
 * invalidation when the Native process or RPC becomes unsafe to reuse.
 */
export async function runCodexMainTurn(input) {
  let sideEffectStarted = false;
  let attempt = 0;
  const executeTool = async (...args) => {
    sideEffectStarted = true;
    return input.executeTool(...args);
  };
  const run = () => runNativeAgentTurn({ ...input, executeTool });
  let result = await run();
  while (result?.status === 'failed' && attempt === 0) {
    const failure = result.error || {
      code: result.code,
      message: result.message,
      retryable: result.retryable,
      outcomeUnknown: result.outcomeUnknown,
    };
    const recovered = await routeAgentRecovery({
      run,
      error: failure,
      sideEffectStarted,
      attempt,
      invalidate: () => invalidateNativeCodexHostScope({ provider: input.provider, ownerId: 'local' }),
    });
    if (!recovered.recovered) break;
    result = recovered.result;
    attempt += 1;
  }
  return result;
}

export async function invalidateCodexMainHost(host) {
  return invalidateNativeCodexHost(host);
}

export async function invalidateCodexMainHostScope(input) {
  return invalidateNativeCodexHostScope(input);
}

export const initialize = (input) => runNativeAgentTurn({ ...input, lifecycle: 'initialize' });
export async function startThread(input = {}) {
  if (typeof input.startThread === 'function') return input.startThread(input);
  if (input.client?.request) return input.client.request('thread/start', input.params || input.threadParams || {});
  return { threadId: input.nativeThreadId || input.threadId, reused: false };
}
export async function resumeThread(input = {}) {
  if (typeof input.resumeThread === 'function') return input.resumeThread(input);
  if (input.client?.request) return input.client.request('thread/resume', input.params || input.threadParams || { threadId: input.nativeThreadId || input.threadId });
  return { threadId: input.nativeThreadId || input.threadId, reused: true };
}
export const startTurn = runCodexMainTurn;
export const runTurn = runCodexMainTurn;
export const steerTurn = (input) => input?.steer?.(input);
export const interruptTurn = (input) => input?.interrupt?.(input);
export const invalidateHost = invalidateCodexMainHostScope;

export function createCollaborationGateway(input = {}) {
  return createNativeCollaborationGateway({ client: input.client, methods: input.methods, timeoutMs: input.timeoutMs });
}

export const spawnNativeAgent = (input = {}) => createCollaborationGateway(input).spawnAgent(input.params || input);
export const sendNativeAgentInput = (input = {}) => createCollaborationGateway(input).sendInput(input.params || input);
export const waitNativeAgent = (input = {}) => createCollaborationGateway(input).wait(input.params || input);
export const closeNativeAgent = (input = {}) => createCollaborationGateway(input).closeAgent(input.params || input);
export const interruptNativeAgent = (input = {}) => createCollaborationGateway(input).interruptAgent(input.params || input);
export const listNativeAgents = (input = {}) => createCollaborationGateway(input).listAgents(input.params || input);

export function codexMainRuntimeMetadata() {
  return {
    sourceCommit: CODEX_MAIN_SNAPSHOT.sourceCommit,
    wireApi: CODEX_MAIN_SNAPSHOT.wireApi,
    protocolSchema: CODEX_MAIN_SNAPSHOT.protocolSchema,
    dynamicToolMethod: CODEX_MAIN_SNAPSHOT.dynamicToolMethod,
  };
}
