import { NextRequest, NextResponse } from 'next/server';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

import { LOCAL_ASSET_ALLOWED_EXTENSIONS, resolveLocalAssetPath } from '../../../lib/local-assets.mjs';

export const runtime = 'nodejs';

const PUBLIC_DIR = path.join(process.cwd(), 'public');
const RUNTIME_DIR = path.join(process.cwd(), 'runtime');
const MAX_EXPORT_BYTES = 20 * 1024 * 1024;
const DEFAULT_CONTENT_TYPE = 'image/png';

function inferExtension(fileReference: string, contentType = ''): string {
  const normalizedType = contentType.toLowerCase();
  if (normalizedType.includes('image/jpeg')) return 'jpg';
  if (normalizedType.includes('image/webp')) return 'webp';
  if (normalizedType.includes('image/gif')) return 'gif';
  if (normalizedType.includes('image/png')) return 'png';

  const extension = path.extname(fileReference).replace(/^\./, '').toLowerCase();
  if (extension === 'jpg' || extension === 'jpeg' || extension === 'png' || extension === 'webp' || extension === 'gif') {
    return extension === 'jpeg' ? 'jpg' : extension;
  }

  return 'png';
}

function inferContentType(fileReference: string, contentType = ''): string {
  const normalizedType = contentType.trim().toLowerCase();
  if (normalizedType.startsWith('image/')) {
    return normalizedType;
  }

  const extension = inferExtension(fileReference, contentType);
  if (extension === 'jpg') return 'image/jpeg';
  if (extension === 'webp') return 'image/webp';
  if (extension === 'gif') return 'image/gif';
  return DEFAULT_CONTENT_TYPE;
}

function sanitizeFileNameSegment(value: string): string {
  return value.replace(/[\\/:*?"<>|]+/g, '-').trim();
}

function resolveDownloadFileName(fileReference: string, contentType = ''): string {
  const rawSegment = path.basename(fileReference.split(/[?#]/, 1)[0] || '');
  const sanitizedSegment = sanitizeFileNameSegment(rawSegment);
  if (sanitizedSegment) {
    return sanitizedSegment;
  }

  return `zo-image-${Date.now()}.${inferExtension(fileReference, contentType)}`;
}

async function loadLocalImageAsset(sourceUrl: string) {
  const resolvedPath = resolveLocalAssetPath(sourceUrl, {
    runtimeDir: RUNTIME_DIR,
    publicDir: PUBLIC_DIR,
    allowedExtensions: LOCAL_ASSET_ALLOWED_EXTENSIONS,
  });
  if (!resolvedPath) {
    return null;
  }

  const fileStat = await stat(resolvedPath).catch(() => null);
  if (!fileStat?.isFile()) {
    return null;
  }
  if (fileStat.size > MAX_EXPORT_BYTES) {
    throw new Error('Local image is too large to export');
  }

  const buffer = await readFile(resolvedPath);
  if (buffer.length > MAX_EXPORT_BYTES) {
    throw new Error('Local image is too large to export');
  }

  return {
    buffer,
    filename: resolveDownloadFileName(resolvedPath),
    contentType: inferContentType(resolvedPath),
    contentLength: buffer.length,
  };
}

async function downloadRemoteImage(sourceUrl: string) {
  const parsedUrl = new URL(sourceUrl);
  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
    throw new Error('Unsupported remote image protocol');
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 120000);

  try {
    const response = await fetch(parsedUrl, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`Remote image download failed: ${response.status} ${response.statusText}`);
    }

    const contentLength = Number(response.headers.get('content-length') || '0');
    if (Number.isFinite(contentLength) && contentLength > MAX_EXPORT_BYTES) {
      throw new Error('Remote image is too large to export');
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    if (!buffer.length) {
      throw new Error('Remote image export returned an empty file');
    }
    if (buffer.length > MAX_EXPORT_BYTES) {
      throw new Error('Remote image is too large to export');
    }

    const contentType = inferContentType(sourceUrl, response.headers.get('content-type') || '');

    return {
      buffer,
      filename: resolveDownloadFileName(parsedUrl.pathname, contentType),
      contentType,
      contentLength: Number.isFinite(contentLength) && contentLength > 0 ? contentLength : buffer.length,
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function GET(request: NextRequest) {
  const sourceUrl = request.nextUrl.searchParams.get('src')?.trim() || '';

  if (!sourceUrl) {
    return NextResponse.json({ error: 'Image source is required' }, { status: 400 });
  }

  try {
    if (sourceUrl.startsWith('/')) {
      const localAsset = await loadLocalImageAsset(sourceUrl);
      if (!localAsset) {
        return NextResponse.json({ error: 'Unsupported image source' }, { status: 400 });
      }

      const { buffer, filename, contentType, contentLength } = localAsset;
      return new NextResponse(buffer, {
        headers: {
          'Content-Type': contentType,
          'Content-Length': String(contentLength),
          'Content-Disposition': `attachment; filename="${filename}"`,
          'Cache-Control': 'no-store',
        },
      });
    }

    const { buffer, filename, contentType, contentLength } = await downloadRemoteImage(sourceUrl);

    return new NextResponse(buffer, {
      headers: {
        'Content-Type': contentType || DEFAULT_CONTENT_TYPE,
        'Content-Length': String(contentLength),
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    if (errorMessage === 'Unsupported remote image protocol' || errorMessage === 'Invalid URL') {
      return NextResponse.json({ error: 'Unsupported image source' }, { status: 400 });
    }

    return NextResponse.json({ error: 'Failed to export image' }, { status: 502 });
  }
}
