import fs from 'node:fs';
import path from 'node:path';

const ALLOWED_IMAGE_TYPES = new Map([
  ['image/png', 'png'],
  ['image/jpeg', 'jpg'],
  ['image/webp', 'webp'],
  ['image/gif', 'gif'],
]);
const EXTENSION_TO_MIME_TYPE = new Map([
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.webp', 'image/webp'],
  ['.gif', 'image/gif'],
]);

function isPng(buffer) {
  return (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  );
}

function isJpeg(buffer) {
  return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
}

function isGif(buffer) {
  return (
    buffer.length >= 6 &&
    buffer.toString('ascii', 0, 6).startsWith('GIF8')
  );
}

function isWebp(buffer) {
  return (
    buffer.length >= 12 &&
    buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'WEBP'
  );
}

function matchesMimeSignature(buffer, mimeType) {
  if (mimeType === 'image/png') return isPng(buffer);
  if (mimeType === 'image/jpeg') return isJpeg(buffer);
  if (mimeType === 'image/gif') return isGif(buffer);
  if (mimeType === 'image/webp') return isWebp(buffer);
  return false;
}

export function parseImageDataUrl(value, { maxBytes }) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error('Image data is required');
  }

  if (!value.startsWith('data:')) {
    throw new Error('Invalid image data URL');
  }

  const separator = ';base64,';
  const separatorIndex = value.indexOf(separator);
  if (separatorIndex <= 'data:'.length) {
    throw new Error('Invalid image data URL');
  }

  const mimeType = value.slice('data:'.length, separatorIndex).toLowerCase();
  const extension = ALLOWED_IMAGE_TYPES.get(mimeType);
  if (!extension) {
    throw new Error(`Unsupported image type: ${mimeType}`);
  }

  const rawBase64 = value.slice(separatorIndex + separator.length);
  let base64 = '';
  for (const char of rawBase64) {
    if (char === ' ' || char === '\n' || char === '\r' || char === '\t') {
      continue;
    }
    const code = char.charCodeAt(0);
    const isBase64Char =
      (code >= 65 && code <= 90) ||
      (code >= 97 && code <= 122) ||
      (code >= 48 && code <= 57) ||
      char === '+' ||
      char === '/' ||
      char === '=';
    if (!isBase64Char) {
      throw new Error('Invalid image data URL');
    }
    base64 += char;
  }

  const buffer = Buffer.from(base64, 'base64');
  if (!buffer.length) {
    throw new Error('Image payload is empty');
  }

  if (Number.isFinite(maxBytes) && maxBytes > 0 && buffer.length > maxBytes) {
    throw new Error('Image payload is too large');
  }

  if (!matchesMimeSignature(buffer, mimeType)) {
    throw new Error('Image payload does not match the declared image type');
  }

  return {
    buffer,
    mimeType,
    extension,
  };
}

export function createStoredImageName(extension, { now = Date.now(), randomSuffix } = {}) {
  const safeExtension = String(extension || '').replace(/[^a-z0-9]+/gi, '').toLowerCase();
  if (!safeExtension) {
    throw new Error('A safe image extension is required');
  }

  const suffix = randomSuffix || Math.random().toString(36).slice(2, 8);
  return `img-${now}-${suffix}.${safeExtension}`;
}

function normalizeAssetPath(inputPath) {
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

export function resolvePublicAssetPath(inputPath, { publicDir, allowedExtensions } = {}) {
  const normalizedInput = normalizeAssetPath(inputPath);
  if (!normalizedInput) {
    return null;
  }

  const root = path.resolve(publicDir || path.join(process.cwd(), 'public'));
  const relativePath = normalizedInput.replace(/^\/+/, '');
  const resolvedPath = path.resolve(root, relativePath);

  if (resolvedPath !== root && !resolvedPath.startsWith(`${root}${path.sep}`)) {
    return null;
  }

  const extension = path.extname(resolvedPath).toLowerCase();
  if (Array.isArray(allowedExtensions) && allowedExtensions.length > 0 && !allowedExtensions.includes(extension)) {
    return null;
  }

  return resolvedPath;
}

export function resolvePublicAssetDataUrl(inputPath, options = {}) {
  const resolvedPath = resolvePublicAssetPath(inputPath, options);
  if (!resolvedPath || !fs.existsSync(resolvedPath)) {
    return null;
  }

  const fileStat = fs.statSync(resolvedPath);
  if (!fileStat.isFile()) {
    return null;
  }

  const extension = path.extname(resolvedPath).toLowerCase();
  const mimeType = EXTENSION_TO_MIME_TYPE.get(extension);
  if (!mimeType) {
    return null;
  }

  const buffer = fs.readFileSync(resolvedPath);
  if (!buffer.length) {
    return null;
  }

  return `data:${mimeType};base64,${buffer.toString('base64')}`;
}
