import { mkdir, rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

import {
  CANVAS_IMAGE_RESOURCE_WIDTHS,
  getCanvasImageLodRelativePath,
  parseCanvasImageLodRelativePath,
} from './canvas-image-working-set.mjs';
import {
  buildRuntimeAssetUrl,
  getRuntimeDir,
  LOCAL_ASSET_ALLOWED_EXTENSIONS,
  resolveLocalAssetPathFromRouteSegments,
} from './local-assets.mjs';

const WEBP_QUALITY = 72;

const resolveRuntimeRelativePath = (relativePath, runtimeDir) => {
  const resolvedPath = resolveLocalAssetPathFromRouteSegments(relativePath.split('/'), {
    runtimeDir: getRuntimeDir({ runtimeDir }),
    allowedExtensions: LOCAL_ASSET_ALLOWED_EXTENSIONS,
  });
  if (!resolvedPath) throw new Error('Invalid canvas image LOD path');
  return resolvedPath;
};

async function writeCanvasImageLod({ sourcePath, lodPath, resourceWidth }) {
  await mkdir(path.dirname(lodPath), { recursive: true });
  const temporaryPath = `${lodPath}.${process.pid}-${Math.random().toString(36).slice(2)}.tmp`;

  await sharp(sourcePath, { animated: false, failOn: 'none' })
    .rotate()
    .resize({ width: resourceWidth, withoutEnlargement: true })
    .webp({ quality: WEBP_QUALITY, effort: 1 })
    .toFile(temporaryPath);
  await rename(temporaryPath, lodPath);
}

export async function generateCanvasImageLods({
  sourcePath,
  relativeAssetPath,
  runtimeDir,
  widths = CANVAS_IMAGE_RESOURCE_WIDTHS,
}) {
  const sourceUrl = buildRuntimeAssetUrl(relativeAssetPath);
  const generated = [];

  for (const resourceWidth of widths) {
    const lodRelativePath = getCanvasImageLodRelativePath(sourceUrl, resourceWidth);
    if (!lodRelativePath) continue;

    const lodPath = resolveRuntimeRelativePath(lodRelativePath, runtimeDir);
    await writeCanvasImageLod({ sourcePath, lodPath, resourceWidth });
    generated.push(lodRelativePath);
  }

  return generated;
}

export async function writeImageFileWithCanvasLods({
  filePath,
  relativeAssetPath,
  buffer,
  runtimeDir = undefined,
}) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, buffer);
  await generateCanvasImageLods({ sourcePath: filePath, relativeAssetPath, runtimeDir });
}

export async function ensureCanvasImageLodFile({ relativeLodPath, runtimeDir = undefined }) {
  const parsed = parseCanvasImageLodRelativePath(relativeLodPath);
  if (!parsed) return null;

  const lodPath = resolveRuntimeRelativePath(relativeLodPath, runtimeDir);
  const existingStat = await stat(lodPath).catch(() => null);
  if (existingStat?.isFile()) {
    return { filePath: lodPath, fallbackFilePath: null };
  }

  const originalSegments = parsed.originalRelativePath.split('/');
  const originalPath = resolveLocalAssetPathFromRouteSegments(originalSegments, {
    runtimeDir,
    allowedExtensions: LOCAL_ASSET_ALLOWED_EXTENSIONS,
  });
  const originalStat = originalPath ? await stat(originalPath).catch(() => null) : null;
  if (!originalPath || !originalStat?.isFile()) return null;

  try {
    await writeCanvasImageLod({
      sourcePath: originalPath,
      lodPath,
      resourceWidth: parsed.resourceWidth,
    });
    return { filePath: lodPath, fallbackFilePath: null };
  } catch {
    return { filePath: originalPath, fallbackFilePath: originalPath };
  }
}
