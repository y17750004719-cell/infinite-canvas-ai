import fs from 'node:fs';
import path from 'node:path';

import { resolvePublicAssetPath } from './api-security.mjs';

export const LOCAL_ASSET_ROUTE_PREFIX = '/api/local-assets';
export const LOCAL_ASSET_ALLOWED_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp', '.gif'];

const EXTENSION_TO_MIME_TYPE = new Map([
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.webp', 'image/webp'],
  ['.gif', 'image/gif'],
]);

function normalizePathInput(inputPath) {
  if (typeof inputPath !== 'string' || !inputPath.startsWith('/')) {
    return null;
  }

  const withoutQuery = inputPath.split(/[?#]/, 1)[0];
  try {
    return decodeURIComponent(withoutQuery);
  } catch {
    return null;
  }
}

function normalizeRelativeRuntimePath(inputPath) {
  if (typeof inputPath !== 'string') {
    return null;
  }

  const normalized = inputPath.replace(/^\/+/, '').trim();
  if (!normalized) {
    return null;
  }

  return normalized;
}

export function getRuntimeDir({ runtimeDir } = {}) {
  return runtimeDir || path.join(process.cwd(), 'runtime');
}

export function buildRuntimeAssetUrl(relativePath) {
  const normalized = normalizeRelativeRuntimePath(relativePath);
  if (!normalized) {
    throw new Error('A runtime asset path is required');
  }

  return `${LOCAL_ASSET_ROUTE_PREFIX}/${normalized}`;
}

export function inferLocalAssetContentType(filePath) {
  return EXTENSION_TO_MIME_TYPE.get(path.extname(filePath).toLowerCase()) || null;
}

function resolveRuntimeAssetPath(relativePath, { runtimeDir, allowedExtensions } = {}) {
  const normalized = normalizeRelativeRuntimePath(relativePath);
  if (!normalized) {
    return null;
  }

  const normalizedSegments = normalized.split('/').filter(Boolean);
  if (normalizedSegments.length === 0 || normalizedSegments[0] !== 'uploads') {
    return null;
  }

  const root = path.resolve(getRuntimeDir({ runtimeDir }));
  const resolvedPath = path.resolve(root, normalized);

  if (resolvedPath !== root && !resolvedPath.startsWith(`${root}${path.sep}`)) {
    return null;
  }

  const extension = path.extname(resolvedPath).toLowerCase();
  if (Array.isArray(allowedExtensions) && allowedExtensions.length > 0 && !allowedExtensions.includes(extension)) {
    return null;
  }

  return resolvedPath;
}

export function resolveLocalAssetPathFromRouteSegments(assetPathSegments, options = {}) {
  if (!Array.isArray(assetPathSegments) || assetPathSegments.length === 0) {
    return null;
  }

  const relativePath = assetPathSegments
    .filter((segment) => typeof segment === 'string' && segment.length > 0)
    .join('/');

  return resolveRuntimeAssetPath(relativePath, options);
}

export function resolveLocalAssetPath(inputPath, { runtimeDir, publicDir, allowedExtensions } = {}) {
  const normalizedInput = normalizePathInput(inputPath);
  if (!normalizedInput) {
    return null;
  }

  if (normalizedInput.startsWith(`${LOCAL_ASSET_ROUTE_PREFIX}/`)) {
    const relativePath = normalizedInput.slice(`${LOCAL_ASSET_ROUTE_PREFIX}/`.length);
    return resolveRuntimeAssetPath(relativePath, { runtimeDir, allowedExtensions });
  }

  return resolvePublicAssetPath(normalizedInput, { publicDir, allowedExtensions });
}

export function resolveLocalAssetDataUrl(inputPath, options = {}) {
  const resolvedPath = resolveLocalAssetPath(inputPath, options);
  if (!resolvedPath || !fs.existsSync(resolvedPath)) {
    return null;
  }

  const fileStat = fs.statSync(resolvedPath);
  if (!fileStat.isFile()) {
    return null;
  }

  const mimeType = inferLocalAssetContentType(resolvedPath);
  if (!mimeType) {
    return null;
  }

  const buffer = fs.readFileSync(resolvedPath);
  if (!buffer.length) {
    return null;
  }

  return `data:${mimeType};base64,${buffer.toString('base64')}`;
}
