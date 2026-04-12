import { NextRequest, NextResponse } from 'next/server';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createStoredImageName, parseImageDataUrl } from '../../lib/api-security.mjs';
import { buildRuntimeAssetUrl } from '../../lib/local-assets.mjs';
import { createLogger, createRequestId, serializeError } from '../../lib/logger';

const LOG_ALL_REQUESTS = process.env.LOG_ALL_REQUESTS !== '0';
const MAX_UPLOAD_BYTES = 12 * 1024 * 1024;

export async function POST(request: NextRequest) {
  const startedAt = Date.now();
  const requestId = createRequestId('upload');
  const logger = createLogger('api.upload', {
    route: '/api/upload',
    requestId,
  });
  try {
    if (LOG_ALL_REQUESTS) {
      await logger.info('request.start', 'Upload request started', { method: 'POST' });
    }
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      await logger.warn('request.invalid_json', 'Upload request received invalid JSON body', {
        method: 'POST',
        status: 400,
        reason: 'invalid_json',
        durationMs: Date.now() - startedAt,
      });
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }
    const { imageData } = body;

    const parsedImage = parseImageDataUrl(imageData, {
      maxBytes: MAX_UPLOAD_BYTES,
    });

    const uploadsDir = path.join(process.cwd(), 'runtime', 'uploads');
    await mkdir(uploadsDir, { recursive: true });

    const newFileName = createStoredImageName(parsedImage.extension);
    const filePath = path.join(uploadsDir, newFileName);

    await writeFile(filePath, parsedImage.buffer);

    const url = buildRuntimeAssetUrl(`uploads/${newFileName}`);

    if (LOG_ALL_REQUESTS) {
      await logger.info('request.success', 'Upload request stored image locally', {
        method: 'POST',
        status: 200,
        fileName: newFileName,
        sizeBytes: parsedImage.buffer.length,
        durationMs: Date.now() - startedAt,
      });
    }

    return NextResponse.json({
      success: true,
      url,
      fileName: newFileName,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Upload failed';
    const isInputError =
      message === 'Image data is required' ||
      message === 'Invalid image data URL' ||
      message === 'Image payload is empty' ||
      message === 'Image payload is too large' ||
      message.startsWith('Unsupported image type:') ||
      message === 'Image payload does not match the declared image type';

    if (isInputError) {
      await logger.warn('request.invalid_input', `Upload request rejected: ${message}`, {
        method: 'POST',
        status: 400,
        reason: message,
        durationMs: Date.now() - startedAt,
      });
      return NextResponse.json({ error: message }, { status: 400 });
    }

    await logger.error('request.error', 'Upload request failed', {
      method: 'POST',
      status: 500,
      error: serializeError(error),
      durationMs: Date.now() - startedAt,
    });
    return NextResponse.json(
      { error: 'Upload failed' },
      { status: 500 }
    );
  }
}
