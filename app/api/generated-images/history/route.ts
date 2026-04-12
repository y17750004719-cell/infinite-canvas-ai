import path from 'node:path';
import { NextResponse } from 'next/server';

import { listGeneratedImageArchiveEntries } from '../../../lib/generated-image-history-archive.mjs';

export const runtime = 'nodejs';

const NO_STORE_HEADERS = {
  'Cache-Control': 'no-store',
};

export async function GET() {
  try {
    const entries = await listGeneratedImageArchiveEntries({
      directoryPath: path.join(process.cwd(), 'runtime', 'uploads', 'generated'),
    });

    return NextResponse.json({ entries }, { headers: NO_STORE_HEADERS });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to load generated image history';
    return NextResponse.json({ error: message }, { status: 500, headers: NO_STORE_HEADERS });
  }
}
