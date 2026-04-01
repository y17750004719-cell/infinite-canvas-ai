import { NextRequest, NextResponse } from 'next/server';
import fs from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Client, handle_file } from '@gradio/client';
import { createStoredImageName } from '../../../lib/api-security.mjs';
import {
  createRetryableAsyncSingleton,
  extractBackgroundRemovalFileResult,
  getImageDimensionsFromBuffer,
  resolveBackgroundRemovalSource,
} from '../../../lib/background-removal.mjs';
import { createLogger, createRequestId, serializeError } from '../../../lib/logger';

export const runtime = 'nodejs';

const LOG_ALL_REQUESTS = process.env.LOG_ALL_REQUESTS !== '0';
const GENERATED_UPLOADS_DIR = path.join(process.cwd(), 'public', 'uploads', 'generated');
const MAX_RESULT_BYTES = 20 * 1024 * 1024;

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

const getBackgroundRemovalClient = createRetryableAsyncSingleton(() =>
  Client.connect(
    'not-lain/background-removal',
    process.env.HF_TOKEN ? ({ hf_token: process.env.HF_TOKEN } as any) : undefined
  )
);

function inferExtension(fileReference: string, contentType = '') {
  const normalizedType = contentType.toLowerCase();
  if (normalizedType.includes('image/jpeg')) return 'jpg';
  if (normalizedType.includes('image/webp')) return 'webp';
  if (normalizedType.includes('image/gif')) return 'gif';
  if (normalizedType.includes('image/png')) return 'png';

  const ext = path.extname(fileReference).replace(/^\./, '').toLowerCase();
  if (ext === 'jpg' || ext === 'jpeg' || ext === 'png' || ext === 'webp' || ext === 'gif') {
    return ext === 'jpeg' ? 'jpg' : ext;
  }

  return 'png';
}

async function readBackgroundRemovalResult(fileReference: string) {
  if (typeof fileReference !== 'string' || fileReference.length === 0) {
    throw new Error('Background removal returned an empty file reference');
  }

  if (fs.existsSync(fileReference)) {
    const buffer = await readFile(fileReference);
    if (buffer.length === 0) {
      throw new Error('Background removal returned an empty file');
    }

    return {
      buffer,
      extension: inferExtension(fileReference),
    };
  }

  const parsedUrl = new URL(fileReference);
  if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
    throw new Error('Background removal returned an unsupported file reference');
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 120000);
  try {
    const response = await fetch(parsedUrl, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`Background removal download failed: ${response.status} ${response.statusText}`);
    }

    const contentLength = Number(response.headers.get('content-length') || '0');
    if (Number.isFinite(contentLength) && contentLength > MAX_RESULT_BYTES) {
      throw new Error('Background removal result is too large to store');
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    if (buffer.length === 0) {
      throw new Error('Background removal returned an empty file');
    }
    if (buffer.length > MAX_RESULT_BYTES) {
      throw new Error('Background removal result is too large to store');
    }

    return {
      buffer,
      extension: inferExtension(fileReference, response.headers.get('content-type') || ''),
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function POST(request: NextRequest) {
  const startedAt = Date.now();
  const reqId = createRequestId('bg-remove');
  const logger = createLogger('api.image-tools.remove-background', {
    route: '/api/image-tools/remove-background',
    requestId: reqId,
  });

  try {
    if (LOG_ALL_REQUESTS) {
      await logger.info('request.start', 'Background removal request started', {
        method: 'POST',
      });
    }

    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      await logger.warn('request.invalid_json', 'Background removal request received invalid JSON body', {
        method: 'POST',
        status: 400,
      });
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const imageUrl = typeof body.imageUrl === 'string' ? body.imageUrl.trim() : '';
    const sourceItemId = typeof body.sourceItemId === 'string' ? body.sourceItemId : null;
    const source = resolveBackgroundRemovalSource(imageUrl, {
      publicDir: path.join(process.cwd(), 'public'),
      requestOrigin: request.nextUrl.origin,
    });

    if (LOG_ALL_REQUESTS) {
      await logger.info('supplier.dispatch', 'Dispatching background removal task', {
        sourceItemId,
        sourceKind: source.kind,
        sourceValuePreview: source.kind === 'local' ? path.basename(source.value) : source.value,
      });
    }

    const client = await getBackgroundRemovalClient();
    const prediction = await client.predict('/png', {
      f: handle_file(source.value),
    });
    const fileReference = extractBackgroundRemovalFileResult(prediction);

    if (LOG_ALL_REQUESTS) {
      await logger.info('supplier.response', 'Background removal supplier returned file reference', {
        fileReferencePreview: typeof fileReference === 'string' ? fileReference.slice(0, 160) : null,
      });
    }

    const resultFile = await readBackgroundRemovalResult(fileReference);
    await mkdir(GENERATED_UPLOADS_DIR, { recursive: true });

    const filename = createStoredImageName(resultFile.extension);
    const outputPath = path.join(GENERATED_UPLOADS_DIR, filename);
    await writeFile(outputPath, resultFile.buffer);

    const dimensions = getImageDimensionsFromBuffer(resultFile.buffer);
    const responseBody = {
      success: true,
      url: `/uploads/generated/${filename}`,
      naturalWidth: dimensions?.naturalWidth,
      naturalHeight: dimensions?.naturalHeight,
    };

    if (LOG_ALL_REQUESTS) {
      await logger.info('request.success', 'Background removal request completed', {
        status: 200,
        sourceItemId,
        sizeBytes: resultFile.buffer.length,
        fileName: filename,
        durationMs: Date.now() - startedAt,
      });
    }

    return NextResponse.json(responseBody);
  } catch (error) {
    const message = getErrorMessage(error);
    const status =
      message === 'Image URL is required' ||
      message === 'Invalid image URL'
        ? 400
        : 502;

    if (status === 400) {
      await logger.warn('request.invalid_input', `Background removal request rejected: ${message}`, {
        status,
        durationMs: Date.now() - startedAt,
      });
    } else {
      await logger.error('request.error', 'Background removal request failed', {
        status,
        error: serializeError(error),
        durationMs: Date.now() - startedAt,
      });
    }

    return NextResponse.json({ error: message }, { status });
  }
}
