import path from 'node:path';
import { readdir, readFile, stat } from 'node:fs/promises';

import { getImageDimensionsFromBuffer } from './image-metadata.mjs';
import { extractGeneratedImageTimestampFromFilename } from './generated-image-history.mjs';

const SUPPORTED_ARCHIVE_IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif']);

function isSupportedGeneratedImageFile(filename) {
  return SUPPORTED_ARCHIVE_IMAGE_EXTENSIONS.has(path.extname(filename).toLowerCase());
}

function buildArchiveEntryId(filename) {
  return `archive:${filename}`;
}

export async function listGeneratedImageArchiveEntries({
  directoryPath,
  publicPathPrefix = '/api/local-assets/uploads/generated',
} = /** @type {{ directoryPath?: string, publicPathPrefix?: string }} */ ({})) {
  if (typeof directoryPath !== 'string' || directoryPath.length === 0) {
    return [];
  }

  let directoryEntries;
  try {
    directoryEntries = await readdir(directoryPath, { withFileTypes: true });
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return [];
    }
    throw error;
  }

  const archiveEntries = await Promise.all(
    directoryEntries
      .filter((entry) => entry.isFile() && isSupportedGeneratedImageFile(entry.name))
      .map(async (entry) => {
        const filePath = path.join(directoryPath, entry.name);
        const fileStat = await stat(filePath);

        let naturalWidth;
        let naturalHeight;
        try {
          const buffer = await readFile(filePath);
          const dimensions = getImageDimensionsFromBuffer(buffer);
          naturalWidth = dimensions?.naturalWidth;
          naturalHeight = dimensions?.naturalHeight;
        } catch {
          naturalWidth = undefined;
          naturalHeight = undefined;
        }

        return {
          id: buildArchiveEntryId(entry.name),
          src: `${publicPathPrefix}/${entry.name}`,
          createdAt: extractGeneratedImageTimestampFromFilename(entry.name) ?? Math.round(fileStat.mtimeMs),
          source: 'archive',
          naturalWidth,
          naturalHeight,
        };
      })
  );

  return archiveEntries.sort((a, b) => {
    if (b.createdAt !== a.createdAt) {
      return b.createdAt - a.createdAt;
    }

    return String(b.id).localeCompare(String(a.id));
  });
}
