import { resolvePublicAssetPath } from './api-security.mjs';

const ALLOWED_PUBLIC_IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp', '.gif'];

function normalizeOrigin(value) {
  if (typeof value !== 'string' || value.length === 0) {
    return '';
  }

  try {
    return new URL(value).origin;
  } catch {
    return '';
  }
}

export function resolveBackgroundRemovalSource(imageUrl, { publicDir, requestOrigin } = {}) {
  const normalizedInput = typeof imageUrl === 'string' ? imageUrl.trim() : '';
  if (!normalizedInput) {
    throw new Error('Image URL is required');
  }

  if (normalizedInput.startsWith('/')) {
    const localPath = resolvePublicAssetPath(normalizedInput, {
      publicDir,
      allowedExtensions: ALLOWED_PUBLIC_IMAGE_EXTENSIONS,
    });

    if (!localPath) {
      throw new Error('Invalid image URL');
    }

    return {
      kind: 'local',
      value: localPath,
    };
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(normalizedInput);
  } catch {
    throw new Error('Invalid image URL');
  }

  if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
    throw new Error('Invalid image URL');
  }

  const normalizedOrigin = normalizeOrigin(requestOrigin);
  if (normalizedOrigin && parsedUrl.origin === normalizedOrigin) {
    const localPath = resolvePublicAssetPath(parsedUrl.pathname, {
      publicDir,
      allowedExtensions: ALLOWED_PUBLIC_IMAGE_EXTENSIONS,
    });

    if (!localPath) {
      throw new Error('Invalid image URL');
    }

    return {
      kind: 'local',
      value: localPath,
    };
  }

  return {
    kind: 'remote',
    value: parsedUrl.toString(),
  };
}

function extractFileCandidate(value) {
  if (!value) {
    return null;
  }

  if (typeof value === 'string' && value.length > 0) {
    return value;
  }

  if (Array.isArray(value)) {
    for (const entry of value) {
      const candidate = extractFileCandidate(entry);
      if (candidate) {
        return candidate;
      }
    }

    return null;
  }

  if (typeof value === 'object') {
    if (typeof value.url === 'string' && value.url.length > 0) {
      return value.url;
    }

    if (typeof value.path === 'string' && value.path.length > 0) {
      return value.path;
    }

    if ('data' in value) {
      return extractFileCandidate(value.data);
    }
  }

  return null;
}

export function extractBackgroundRemovalFileResult(result) {
  const candidate = extractFileCandidate(result);
  if (!candidate) {
    throw new Error('No background removal file returned');
  }

  return candidate;
}

export function getImageDimensionsFromBuffer(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 10) {
    return null;
  }

  if (
    buffer.length >= 24 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47
  ) {
    return {
      naturalWidth: buffer.readUInt32BE(16),
      naturalHeight: buffer.readUInt32BE(20),
    };
  }

  if (buffer.length >= 10 && buffer.toString('ascii', 0, 3) === 'GIF') {
    return {
      naturalWidth: buffer.readUInt16LE(6),
      naturalHeight: buffer.readUInt16LE(8),
    };
  }

  return null;
}
