import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

import { parseImageDataUrl } from '../api-security.mjs';
import {
  buildRuntimeAssetUrl,
  getRuntimeDir,
  inferLocalAssetContentType,
  LOCAL_ASSET_ALLOWED_EXTENSIONS,
  resolveLocalAssetPath,
} from '../local-assets.mjs';
export { normalizeSessionVisualAssets } from './session-visual-asset-metadata.mjs';

export const SESSION_VISUAL_ASSET_MAX_BYTES = 12 * 1024 * 1024;
export const SESSION_VISUAL_ASSET_DIRECTORY = 'uploads/session-assets';
// Keep pathological dimensions from consuming excessive memory in downstream
// providers while allowing normal high-resolution canvas assets.
export const SESSION_VISUAL_ASSET_MAX_DIMENSION = 16384;
export const SESSION_VISUAL_ASSET_MAX_PIXELS = 100_000_000;

export class SessionVisualAssetError extends Error {
  constructor(message, code = 'SESSION_ASSET_SNAPSHOT_FAILED', { cause, isRetryable = true } = {}) {
    super(message, { cause });
    this.name = 'SessionVisualAssetError';
    this.code = code;
    this.isRetryable = isRetryable;
  }
}

const MIME_TO_EXTENSION = new Map([
  ['image/png', 'png'],
  ['image/jpeg', 'jpg'],
  ['image/webp', 'webp'],
  ['image/gif', 'gif'],
]);

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function sessionDirectoryHash(sessionId) {
  const value = text(sessionId);
  if (!value) throw new Error('sessionId is required');
  return createHash('sha256').update(value).digest('hex');
}

function sourceValue(source) {
  if (typeof source === 'string') return source.trim();
  if (!source || typeof source !== 'object') return '';
  return text(source.durableSrc) || text(source.src) || text(source.assetUrl) || text(source.originalSrc);
}

function sourceKind(source, url) {
  if (source && typeof source === 'object' && ['upload', 'canvas', 'generated'].includes(source.source)) return source.source;
  if (url.startsWith('data:image/')) return 'upload';
  return 'canvas';
}

function validateImageBytes(bytes, mimeType) {
  const extension = MIME_TO_EXTENSION.get(mimeType);
  if (!extension) throw new Error(`Unsupported image type: ${mimeType || 'unknown'}`);
  const dataUrl = `data:${mimeType};base64,${Buffer.from(bytes).toString('base64')}`;
  const parsed = parseImageDataUrl(dataUrl, { maxBytes: SESSION_VISUAL_ASSET_MAX_BYTES });
  return parsed;
}

async function validateDecodedImage(bytes) {
  let metadata;
  try {
    metadata = await sharp(bytes, { failOn: 'error', animated: false }).metadata();
  } catch (cause) {
    const error = new Error('Image could not be decoded', { cause });
    error.code = 'image_decode_failed';
    throw error;
  }
  const width = Number(metadata.width);
  const height = Number(metadata.height);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1
    || width > SESSION_VISUAL_ASSET_MAX_DIMENSION
    || height > SESSION_VISUAL_ASSET_MAX_DIMENSION
    || width * height > SESSION_VISUAL_ASSET_MAX_PIXELS) {
    const error = new Error('Image dimensions are invalid or exceed the supported limit');
    error.code = 'image_dimension_invalid';
    throw error;
  }
  return { width, height };
}

async function readSource(source, options) {
  const input = sourceValue(source);
  if (!input) throw new Error('Image source is required');
  if (input.startsWith('data:')) {
    const parsed = parseImageDataUrl(input, { maxBytes: SESSION_VISUAL_ASSET_MAX_BYTES });
    const dimensions = await validateDecodedImage(parsed.buffer);
    return { ...parsed, ...dimensions, originalSrc: input };
  }
  if (input.startsWith('http://') || input.startsWith('https://')) {
    const fetchImpl = options.fetchImpl || globalThis.fetch;
    if (typeof fetchImpl !== 'function') throw new Error('Remote image fetching is unavailable');
    const response = await fetchImpl(input);
    if (!response.ok) throw new Error(`Remote image request failed (${response.status})`);
    const mimeType = text(response.headers.get('content-type')).split(';', 1)[0].toLowerCase();
    if (!MIME_TO_EXTENSION.has(mimeType)) throw new Error(`Unsupported image type: ${mimeType || 'unknown'}`);
    const declaredLength = Number(response.headers.get('content-length'));
    if (Number.isFinite(declaredLength) && declaredLength > SESSION_VISUAL_ASSET_MAX_BYTES) {
      throw new Error('Image payload is too large');
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    const parsed = validateImageBytes(bytes, mimeType);
    const dimensions = await validateDecodedImage(parsed.buffer);
    return { ...parsed, ...dimensions, originalSrc: input };
  }
  if (!input.startsWith('/')) throw new Error('Image source must be a local path, data URL, or HTTP URL');
  const filePath = resolveLocalAssetPath(input, {
    runtimeDir: options.runtimeDir,
    publicDir: options.publicDir,
    allowedExtensions: LOCAL_ASSET_ALLOWED_EXTENSIONS,
  });
  if (!filePath) throw new Error('Unsupported local image path');
  const fileStat = await stat(filePath).catch(() => null);
  if (!fileStat?.isFile()) throw new Error('Local image was not found');
  if (fileStat.size > SESSION_VISUAL_ASSET_MAX_BYTES) throw new Error('Image payload is too large');
  const bytes = await readFile(filePath);
  const mimeType = inferLocalAssetContentType(filePath);
  const parsed = validateImageBytes(bytes, mimeType);
  const dimensions = await validateDecodedImage(parsed.buffer);
  return { ...parsed, ...dimensions, originalSrc: input };
}

function assetRelativePath(sessionHash, contentHash, extension) {
  return `${SESSION_VISUAL_ASSET_DIRECTORY}/${sessionHash}/${contentHash}.${extension}`;
}

export async function materializeSessionVisualAsset({ sessionId, source, existingAsset, runtimeDir, publicDir, fetchImpl } = {}) {
  const resolvedRuntimeDir = getRuntimeDir({ runtimeDir });
  const sessionHash = sessionDirectoryHash(sessionId);
  if (existingAsset?.durableSrc && existingAsset.sessionId === text(sessionId)) {
    const existingBytes = await readSessionVisualAsset(existingAsset, { runtimeDir: resolvedRuntimeDir, publicDir });
    if (existingBytes) return { ...existingAsset, sessionId: text(sessionId) };
  }
  let image;
  try {
    image = await readSource(source || existingAsset?.originalSrc, { runtimeDir: resolvedRuntimeDir, publicDir, fetchImpl });
  } catch (error) {
    const sourceErrorCode = error?.code === 'image_decode_failed'
      ? 'image_decode_failed'
      : error?.code === 'image_dimension_invalid'
        ? 'image_dimension_invalid'
        : undefined;
    throw new SessionVisualAssetError(
      existingAsset ? 'Session visual asset is unavailable' : 'Unable to snapshot session visual asset',
      existingAsset ? 'SESSION_ASSET_UNAVAILABLE' : (sourceErrorCode || 'SESSION_ASSET_SNAPSHOT_FAILED'),
      { cause: error, isRetryable: !existingAsset }
    );
  }
  const contentHash = createHash('sha256').update(image.buffer).digest('hex');
  if (existingAsset?.contentHash && existingAsset.contentHash.toLowerCase() !== contentHash) {
    throw new SessionVisualAssetError('Session visual asset content changed', 'SESSION_ASSET_UNAVAILABLE', { isRetryable: false });
  }
  const relativePath = assetRelativePath(sessionHash, contentHash, image.extension);
  const filePath = path.join(resolvedRuntimeDir, relativePath);
  await mkdir(path.dirname(filePath), { recursive: true });
  try {
    await stat(filePath);
  } catch {
    await writeFile(filePath, image.buffer, { flag: 'wx' }).catch(async (error) => {
      if (error.code !== 'EEXIST') throw error;
    });
  }
  const sourceObject = source && typeof source === 'object' ? source : {};
  const durableOriginalSrc = image.originalSrc.startsWith('data:') ? undefined : image.originalSrc;
  return {
    id: `session-asset:${sessionHash}:${contentHash}`,
    sessionId: text(sessionId),
    durableSrc: buildRuntimeAssetUrl(relativePath),
    previewSrc: text(sourceObject.previewSrc) || undefined,
    ...(durableOriginalSrc ? { originalSrc: durableOriginalSrc } : {}),
    contentHash,
    mimeType: image.mimeType,
    byteSize: image.buffer.length,
    naturalWidth: image.width,
    naturalHeight: image.height,
    source: sourceKind(sourceObject, image.originalSrc),
    sourceReferenceId: text(sourceObject.sourceReferenceId) || text(sourceObject.referenceId) || undefined,
    taskId: text(sourceObject.taskId) || undefined,
    batchId: text(sourceObject.batchId) || undefined,
    versionId: text(sourceObject.versionId) || undefined,
    createdAt: Date.now(),
  };
}

export async function readSessionVisualAsset(asset, { runtimeDir, publicDir } = {}) {
  const src = text(asset?.durableSrc) || text(asset?.src);
  if (!src) return null;
  const filePath = resolveLocalAssetPath(src, {
    runtimeDir: getRuntimeDir({ runtimeDir }),
    publicDir,
    allowedExtensions: LOCAL_ASSET_ALLOWED_EXTENSIONS,
  });
  if (!filePath) return null;
  const fileStat = await stat(filePath).catch(() => null);
  if (!fileStat?.isFile() || fileStat.size > SESSION_VISUAL_ASSET_MAX_BYTES) return null;
  return readFile(filePath);
}

export async function isSessionVisualAssetAvailable(asset, options = {}) {
  return Boolean(await readSessionVisualAsset(asset, options));
}

export async function removeSessionVisualAssets(sessionId, { runtimeDir } = {}) {
  const root = path.join(getRuntimeDir({ runtimeDir }), SESSION_VISUAL_ASSET_DIRECTORY, sessionDirectoryHash(sessionId));
  await rm(root, { recursive: true, force: true });
  return root;
}
