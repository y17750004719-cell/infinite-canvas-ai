import { NextRequest, NextResponse } from 'next/server';
import { readFile, stat } from 'node:fs/promises';

import { ensureCanvasImageLodFile } from '../../../lib/canvas-image-lod-server.mjs';
import {
  inferLocalAssetContentType,
  LOCAL_ASSET_ALLOWED_EXTENSIONS,
  resolveLocalAssetPathFromRouteSegments,
} from '../../../lib/local-assets.mjs';

export const runtime = 'nodejs';

const IMMUTABLE_ASSET_HEADERS = {
  'Cache-Control': 'private, max-age=31536000, immutable',
};
const NO_STORE_HEADERS = { 'Cache-Control': 'no-store' };

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ assetPath?: string[] }> }
) {
  const { assetPath } = await params;
  if (!Array.isArray(assetPath) || assetPath.length === 0) {
    return NextResponse.json({ error: 'Asset path is required' }, { status: 400 });
  }

  const resolvedPath = resolveLocalAssetPathFromRouteSegments(assetPath, {
    allowedExtensions: LOCAL_ASSET_ALLOWED_EXTENSIONS,
  });

  if (!resolvedPath) {
    return NextResponse.json({ error: 'Unsupported asset path' }, { status: 400 });
  }

  let responsePath = resolvedPath;
  let fileStat = await stat(responsePath).catch(() => null);
  let isFallback = false;
  if (!fileStat?.isFile()) {
    const ensuredLod = await ensureCanvasImageLodFile({ relativeLodPath: assetPath.join('/') });
    if (ensuredLod) {
      responsePath = ensuredLod.filePath;
      fileStat = await stat(responsePath).catch(() => null);
      isFallback = Boolean(ensuredLod.fallbackFilePath);
    }
  }
  if (!fileStat?.isFile()) {
    return NextResponse.json({ error: 'Asset not found' }, { status: 404 });
  }

  const contentType = inferLocalAssetContentType(responsePath);
  if (!contentType) {
    return NextResponse.json({ error: 'Unsupported asset path' }, { status: 400 });
  }

  const buffer = await readFile(responsePath);

  return new NextResponse(buffer, {
    headers: {
      ...(isFallback ? NO_STORE_HEADERS : IMMUTABLE_ASSET_HEADERS),
      'Content-Type': contentType,
      'Content-Length': String(buffer.length),
    },
  });
}
