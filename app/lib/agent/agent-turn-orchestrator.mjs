/**
 * Owns the small adapter between the request controller and the Native
 * Responses turn. The controller still supplies application-owned callbacks;
 * this module owns Native invocation and result normalization.
 */
export async function runAgentTurn({
  runTurn = runNativeRuntimeTurn,
  request,
  startKeepalive,
}) {
  const stopKeepalive = typeof startKeepalive === 'function'
    ? startKeepalive()
    : null;
  try {
    const nativeResult = await runTurn({
      ...request,
    });
    return {
      stopReason: nativeResult.pendingConfirmation
        ? 'confirmation_required'
        : nativeResult.status === 'completed' ? 'completed' : nativeResult.status,
      errorMessage: nativeResult.error?.message,
      failureCode: nativeResult.error?.code,
      retryable: nativeResult.error?.retryable,
      confirmation: nativeResult.pendingConfirmation,
      terminal: request.hasImageResult ? { type: 'image_execution_completed' } : null,
      content: nativeResult.text,
      text: nativeResult.text,
      turns: 1,
      toolCalls: request.toolCallCount || 0,
      budgetedToolCalls: request.toolCallCount || 0,
      mutationToolCalls: request.hasImageResult ? 1 : 0,
      transcript: [],
    };
  } finally {
    stopKeepalive?.();
  }
}
import { runTurn as runNativeRuntimeTurn } from './native-runtime-gateway.mjs';
