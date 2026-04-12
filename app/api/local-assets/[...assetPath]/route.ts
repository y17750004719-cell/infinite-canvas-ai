import { NextRequest, NextResponse } from 'next/server';
import { readFile, stat } from 'node:fs/promises';

import {
  inferLocalAssetContentType,
  LOCAL_ASSET_ALLOWED_EXTENSIONS,
  resolveLocalAssetPathFromRouteSegments,
} from '../../../lib/local-assets.mjs';

export const runtime = 'nodejs';

const NO_STORE_HEADERS = {
  'Cache-Control': 'no-store',
};

export async function GET(
  _request: NextRequest,
  { params }: { params: { assetPath?: string[] } }
) {
  const assetPath = params?.assetPath;
  if (!Array.isArray(assetPath) || assetPath.length === 0) {
    return NextResponse.json({ error: 'Asset path is required' }, { status: 400 });
  }

  const resolvedPath = resolveLocalAssetPathFromRouteSegments(assetPath, {
    allowedExtensions: LOCAL_ASSET_ALLOWED_EXTENSIONS,
  });

  if (!resolvedPath) {
    return NextResponse.json({ error: 'Unsupported asset path' }, { status: 400 });
  }

  const fileStat = await stat(resolvedPath).catch(() => null);
  if (!fileStat?.isFile()) {
    return NextResponse.json({ error: 'Asset not found' }, { status: 404 });
  }

  const contentType = inferLocalAssetContentType(resolvedPath);
  if (!contentType) {
    return NextResponse.json({ error: 'Unsupported asset path' }, { status: 400 });
  }

  const buffer = await readFile(resolvedPath);

  return new NextResponse(buffer, {
    headers: {
      ...NO_STORE_HEADERS,
      'Content-Type': contentType,
      'Content-Length': String(buffer.length),
    },
  });
}
