import { NextResponse } from 'next/server';
import { listThreads } from '../../../lib/agent/thread-journal.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try { return NextResponse.json({ threads: await listThreads() }); }
  catch (error: any) { return NextResponse.json({ error: error?.message || 'Unable to list threads', code: error?.code || 'thread_list_failed' }, { status: error?.statusCode || 500 }); }
}
