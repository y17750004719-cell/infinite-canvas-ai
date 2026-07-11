import { NextResponse } from 'next/server';
import { listSkillManifests } from '../../lib/agent/skill-registry.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const skills = await listSkillManifests();
  return NextResponse.json({ skills }, {
    headers: { 'Cache-Control': 'no-store' },
  });
}
