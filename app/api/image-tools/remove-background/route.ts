import { NextRequest, NextResponse } from 'next/server';
import path from 'node:path';

import { createStoredImageName } from '../../../lib/api-security.mjs';
import { writeImageFileWithCanvasLods } from '../../../lib/canvas-image-lod-server.mjs';
import { buildRuntimeAssetUrl } from '../../../lib/local-assets.mjs';
import {
  createDownloadFailureDiagnostics,
  createReferencePreview,
  createSupplierProxyErrorMessage,
  createSupplierResponseDiagnostics,
  getReferenceHost,
  parseSupplierPayload,
} from '../../../lib/background-removal-diagnostics.mjs';
import { getImageDimensionsFromBuffer } from '../../../lib/image-metadata.mjs';
import { createLogger, createRequestId, serializeError } from '../../../lib/logger';
import {
  createRecraftBackgroundRemovalRequest,
  extractRecraftBackgroundRemovalUrl,
} from '../../../lib/recraft-background-removal.mjs';

export const runtime = 'nodejs';

const LOG_ALL_REQUESTS = process.env.LOG_ALL_REQUESTS !== '0';
const GENERATED_UPLOADS_DIR = path.join(process.cwd(), 'runtime', 'uploads', 'generated');
const MAX_RESULT_BYTES = 20 * 1024 * 1024;

type StageError = Error & {
  failedStage?: string;
  diagnostics?: Record<string, unknown>;
};

function getErrorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function createStageError(
  message: string,
  failedStage: string,
  diagnostics?: Record<string, unknown>
): StageError {
  const error = new Error(message) as StageError;
  error.failedStage = failedStage;
  if (diagnostics) {
    error.diagnostics = diagnostics;
  }
  return error;
}

function getFailedStage(error: unknown) {
  return typeof error === 'object' &&
    error !== null &&
    'failedStage' in error &&
    typeof error.failedStage === 'string'
    ? error.failedStage
    : undefined;
}

function inferExtension(fileReference, contentType = '') {
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

async function downloadBackgroundRemovalResult(fileReference) {
  const parsedUrl = new URL(fileReference);
  if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
    throw new Error('Background removal returned an unsupported file reference');
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 120000);

  try {
    const response = await fetch(parsedUrl, { signal: controller.signal });
    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      throw createStageError(
        `Background removal download failed: ${response.status} ${response.statusText}`,
        'download_result',
        createDownloadFailureDiagnostics({
          fileReference,
          response,
          bodyText: errorText,
        })
      );
    }

    const contentLength = Number(response.headers.get('content-length') || '0');
    if (Number.isFinite(contentLength) && contentLength > MAX_RESULT_BYTES) {
      throw new Error('Background removal result is too large to store');
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    if (!buffer.length) {
      throw new Error('Background removal returned an empty file');
    }
    if (buffer.length > MAX_RESULT_BYTES) {
      throw new Error('Background removal result is too large to store');
    }

    return {
      buffer,
      extension: inferExtension(fileReference, response.headers.get('content-type') || ''),
      contentType: response.headers.get('content-type') || '',
      contentLength: Number.isFinite(contentLength) && contentLength > 0 ? contentLength : buffer.length,
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function POST(request: NextRequest) {
  const startedAt = Date.now();
  const requestId = createRequestId('bg-remove');
  const logger = createLogger('api.image-tools.remove-background', {
    route: '/api/image-tools/remove-background',
    requestId,
  });
  let sourceItemId: string | null = null;

  try {
    const body = await request.json().catch(() => null);
    const imageUrl = typeof body?.imageUrl === 'string' ? body.imageUrl.trim() : '';
    sourceItemId = typeof body?.sourceItemId === 'string' ? body.sourceItemId : null;

    if (LOG_ALL_REQUESTS) {
      await logger.info('request.start', 'Background removal request started', {
        method: 'POST',
        sourceItemId,
        imageUrlPreview: createReferencePreview(imageUrl),
        requestOrigin: request.nextUrl.origin,
      });
    }

    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const supplierRequest = await createRecraftBackgroundRemovalRequest({
      imageUrl,
      publicDir: path.join(process.cwd(), 'public'),
      requestOrigin: request.nextUrl.origin,
    });

    if (LOG_ALL_REQUESTS) {
      await logger.info('supplier.dispatch', 'Dispatching background removal task', {
        sourceItemId,
        endpoint: supplierRequest.endpoint,
        upstreamHost: getReferenceHost(supplierRequest.endpoint),
        sourceMeta: supplierRequest.sourceMeta,
        ...supplierRequest.sourceMeta,
      });
    }

    const supplierResponse = await fetch(supplierRequest.endpoint, {
      method: 'POST',
      headers: supplierRequest.headers,
      body: supplierRequest.body,
    });

    const supplierBodyText = await supplierResponse.text().catch(() => '');
    const parsedSupplierPayload = parseSupplierPayload(
      supplierBodyText,
      supplierResponse.headers.get('content-type') || ''
    );
    const supplierDiagnostics = createSupplierResponseDiagnostics({
      response: supplierResponse,
      bodyText: supplierBodyText,
      payload: parsedSupplierPayload.payload,
    });

    if (!supplierResponse.ok) {
      await logger.error('supplier.error', 'Background removal supplier returned an error response', {
        sourceItemId,
        ...supplierDiagnostics,
      });
      throw createStageError(
        createSupplierProxyErrorMessage({
          host: getReferenceHost(supplierRequest.endpoint),
          failedStage: 'supplier.error',
          payload: parsedSupplierPayload.payload,
          fallbackMessage: supplierBodyText || supplierResponse.statusText,
        }),
        'supplier.error',
        supplierDiagnostics
      );
    }

    if (!parsedSupplierPayload.ok) {
      if (parsedSupplierPayload.errorStage === 'supplier.parse_error') {
        await logger.error('supplier.parse_error', 'Background removal supplier returned a non-JSON response', {
          sourceItemId,
          ...supplierDiagnostics,
        });

        throw createStageError(
          'Background removal supplier returned a non-JSON response',
          'supplier.parse_error',
          supplierDiagnostics
        );
      }

      await logger.error(
        'supplier.payload_invalid',
        'Background removal supplier payload did not include an image URL',
        {
          sourceItemId,
          ...supplierDiagnostics,
        }
      );

      throw createStageError(
        'No background removal image URL returned',
        'supplier.payload_invalid',
        supplierDiagnostics
      );
    }

    const supplierImageUrl = extractRecraftBackgroundRemovalUrl(parsedSupplierPayload.payload);

    if (LOG_ALL_REQUESTS) {
      await logger.info('supplier.response', 'Background removal supplier returned image URL', {
        sourceItemId,
        status: supplierDiagnostics.status,
        traceIds: supplierDiagnostics.traceIds,
        imageUrlPreview: supplierImageUrl.slice(0, 160),
      });
    }

    if (LOG_ALL_REQUESTS) {
      await logger.info('result.download_start', 'Downloading background removal result file', {
        sourceItemId,
        fileReferencePreview: createReferencePreview(supplierImageUrl),
        host: getReferenceHost(supplierImageUrl),
      });
    }

    let resultFile;
    try {
      resultFile = await downloadBackgroundRemovalResult(supplierImageUrl);
    } catch (error) {
      const diagnostics =
        typeof error === 'object' &&
        error !== null &&
        'diagnostics' in error &&
        error.diagnostics &&
        typeof error.diagnostics === 'object'
          ? error.diagnostics
          : {
              failedStage: 'download_result',
              fileReferencePreview: createReferencePreview(supplierImageUrl),
              host: getReferenceHost(supplierImageUrl),
            };

      await logger.error('result.download_error', 'Background removal result download failed', {
        sourceItemId,
        ...diagnostics,
      });
      throw error;
    }

    if (LOG_ALL_REQUESTS) {
      await logger.info('result.download_success', 'Background removal result file downloaded', {
        sourceItemId,
        sizeBytes: resultFile.buffer.length,
        contentType: resultFile.contentType,
        extension: resultFile.extension,
      });
    }

    const filename = createStoredImageName(resultFile.extension);
    await writeImageFileWithCanvasLods({
      filePath: path.join(GENERATED_UPLOADS_DIR, filename),
      relativeAssetPath: `uploads/generated/${filename}`,
      buffer: resultFile.buffer,
    });

    const dimensions = getImageDimensionsFromBuffer(resultFile.buffer);

    if (LOG_ALL_REQUESTS) {
      await logger.info('request.success', 'Background removal request completed', {
        status: 200,
        sourceItemId,
        fileName: filename,
        sizeBytes: resultFile.buffer.length,
        durationMs: Date.now() - startedAt,
      });
    }

    return NextResponse.json({
      success: true,
      url: buildRuntimeAssetUrl(`uploads/generated/${filename}`),
      naturalWidth: dimensions?.naturalWidth,
      naturalHeight: dimensions?.naturalHeight,
    });
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
        sourceItemId,
        failedStage: 'invalid_input',
        durationMs: Date.now() - startedAt,
      });
    } else {
      await logger.error('request.error', 'Background removal request failed', {
        status,
        sourceItemId,
        failedStage: getFailedStage(error) || 'request.error',
        error: serializeError(error),
        durationMs: Date.now() - startedAt,
      });
    }

    return NextResponse.json({ error: message }, { status });
  }
}
