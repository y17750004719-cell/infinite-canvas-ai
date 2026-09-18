import { runNativeAgentTurn } from './native-agent-service.ts';

/**
 * Application boundary for Codex Main's thread/turn runtime. Business tools
 * stay outside this module; this gateway only invokes one Native turn.
 */
export async function runCodexMainTurn(input) {
  // The request stream service owns retry policy and context rotation.
  // The gateway executes exactly one Native turn and returns its result.
  return runNativeAgentTurn(input);
}

export const runTurn = runCodexMainTurn;
