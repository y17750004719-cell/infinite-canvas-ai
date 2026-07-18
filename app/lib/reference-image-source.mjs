import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

import {
  inferLocalAssetContentType,
  LOCAL_ASSET_ALLOWED_EXTENSIONS,
  resolveLocalAssetPath,
} from './local-assets.mjs';

export class ReferenceImageUnavailableError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.name = 'ReferenceImageUnavailableError';
    this.code = 'REFERENCE_IMAGE_UNAVAILABLE';
    this.failureClass = 'payload';
    this.isRetryable = false;
    this.statusCode = statusCode;
  }
}

export const DEFAULT_MAX_CHAT_REFERENCE_IMAGE_BYTES = 12 * 1024 * 1024;
export const DEFAULT_MAX_CHAT_REFERENCE_TOTAL_BYTES = 24 * 1024 * 1024;

function dataImageBytes(input) {
  const match = typeof input === 'string'
    ? input.match(/^data:(image\/[a-z0-9.+-]+);base64,([a-z0-9+/=\s]+)$/i)
    : null;
  if (!match) {
    throw new ReferenceImageUnavailableError('Reference image data URL is invalid');
  }
  const bytes = Buffer.from(match[2].replace(/\s+/g, ''), 'base64');
  if (bytes.length === 0) {
    throw new ReferenceImageUnavailableError('Reference image is empty');
  }
  return { bytes, mimeType: match[1].toLowerCase() };
}

export async function materializeChatMessageImages(messages, options = {}) {
  const maxImageBytes = Number.isFinite(options.maxImageBytes)
    ? Math.max(1, Math.floor(options.maxImageBytes))
    : DEFAULT_MAX_CHAT_REFERENCE_IMAGE_BYTES;
  const maxTotalBytes = Number.isFinite(options.maxTotalBytes)
    ? Math.max(maxImageBytes, Math.floor(options.maxTotalBytes))
    : DEFAULT_MAX_CHAT_REFERENCE_TOTAL_BYTES;
  const readLocal = options.readLocalReferenceImageImpl || readLocalReferenceImage;
  const cached = new Map();
  let localImageCount = 0;
  let totalImageBytes = 0;

  const materialize = async (input) => {
    if (cached.has(input)) return cached.get(input);
    let result;
    if (typeof input !== 'string' || !input.trim()) {
      throw new ReferenceImageUnavailableError('Reference image URL is invalid');
    }
    if (input.startsWith('http://') || input.startsWith('https://')) {
      result = input;
    } else if (input.startsWith('data:image/')) {
      const { bytes } = dataImageBytes(input);
      if (bytes.length > maxImageBytes) {
        throw new ReferenceImageUnavailableError('Reference image exceeds the analysis size limit', 413);
      }
      totalImageBytes += bytes.length;
      if (totalImageBytes > maxTotalBytes) {
        throw new ReferenceImageUnavailableError('Reference images exceed the total analysis size limit', 413);
      }
      result = input;
    } else if (input.startsWith('/')) {
      const { bytes, mimeType } = await readLocal(input, options);
      if (bytes.length > maxImageBytes) {
        throw new ReferenceImageUnavailableError('Reference image exceeds the analysis size limit', 413);
      }
      totalImageBytes += bytes.length;
      if (totalImageBytes > maxTotalBytes) {
        throw new ReferenceImageUnavailableError('Reference images exceed the total analysis size limit', 413);
      }
      localImageCount += 1;
      result = `data:${mimeType};base64,${Buffer.from(bytes).toString('base64')}`;
    } else {
      throw new ReferenceImageUnavailableError('Reference image URL is invalid');
    }
    cached.set(input, result);
    return result;
  };

  const normalizedMessages = [];
  for (const message of Array.isArray(messages) ? messages : []) {
    if (!Array.isArray(message?.content)) {
      normalizedMessages.push(message);
      continue;
    }
    const content = [];
    for (const part of message.content) {
      if (part?.type !== 'image_url') {
        content.push(part);
        continue;
      }
      content.push({
        ...part,
        image_url: {
          ...part.image_url,
          url: await materialize(part.image_url?.url),
        },
      });
    }
    normalizedMessages.push({ ...message, content });
  }

  return {
    messages: normalizedMessages,
    localImageCount,
    totalImageBytes,
  };
}

export async function readLocalReferenceImage(input, options = {}) {
  if (typeof input !== 'string' || !input.startsWith('/')) {
    throw new ReferenceImageUnavailableError('Reference image path is invalid');
  }

  const resolvedPath = resolveLocalAssetPath(input, {
    runtimeDir: options.runtimeDir || path.join(process.cwd(), 'runtime'),
    publicDir: options.publicDir || path.join(process.cwd(), 'public'),
    allowedExtensions: LOCAL_ASSET_ALLOWED_EXTENSIONS,
  });
  if (!resolvedPath) {
    throw new ReferenceImageUnavailableError('Unsupported local reference image path');
  }

  const fileStat = await stat(resolvedPath).catch(() => null);
  if (!fileStat?.isFile()) {
    throw new ReferenceImageUnavailableError('Local reference image was not found', 404);
  }
  const mimeType = inferLocalAssetContentType(resolvedPath);
  if (!mimeType) {
    throw new ReferenceImageUnavailableError('Local reference image format is not supported');
  }
  const bytes = await readFile(resolvedPath);
  if (bytes.length === 0) {
    throw new ReferenceImageUnavailableError('Local reference image is empty');
  }

  return { bytes, mimeType, resolvedPath };
}
