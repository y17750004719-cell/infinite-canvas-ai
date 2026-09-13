import { NextRequest } from 'next/server';
import { handleGet, handlePost } from '../../lib/agent/agent-request-controller';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Thin HTTP boundary; orchestration lives in the agent controller/services. */
export function POST(request: NextRequest) {
  return handlePost(request);
}

export function GET(request: NextRequest) {
  return handleGet(request);
}
