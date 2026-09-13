import { NextRequest } from 'next/server';
import { handleGet as handleRuntimeGet, handlePost as handleRuntimePost } from './agent-request-runtime';

/**
 * HTTP orchestration boundary for /api/agent.
 *
 * Native execution, interaction state, recovery, event projection and image
 * side effects live behind the runtime services. Keeping this adapter small
 * makes the compatibility and transport contract independently auditable.
 */
export function handlePost(request: NextRequest) {
  return handleRuntimePost(request);
}

export function handleGet(request: NextRequest) {
  return handleRuntimeGet(request);
}
