import path from 'node:path';
import { readFile } from 'node:fs/promises';

import { LOCAL_ASSET_ALLOWED_EXTENSIONS, resolveLocalAssetPath } from './local-assets.mjs';
import { createReferencePreview } from './background-removal-diagnostics.mjs';
import { readProviderConfig, resolveProviderRequestTargets } from './provider-config.mjs';

const DEFAULT_BACKGROUND_REMOVAL_BASE_URL = 'https://gpt-best.cn';
const MAX_SOURCE_BYTES = 20 * 1024 * 1024;
const EXTENSION_TO_MIME_TYPE = new Map([
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.webp', 'image/webp'],
  ['.gif', 'image/gif'],
]);

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

function resolveBackgroundRemovalBaseUrl(overrideBaseUrl) {
  const rawValue =
    (typeof overrideBaseUrl === 'string' && overrideBaseUrl.trim()) ||
    process.env.COMFLY_API_URL ||
    process.env.GPT_BEST_BASE_URL ||
    DEFAULT_BACKGROUND_REMOVAL_BASE_URL;

  const trimmed = String(rawValue).trim().replace(/\/+$/, '');
  return trimmed;
}

export function resolveBackgroundRemovalEndpoints(overrideBaseUrl) {
  const configuredBaseUrl = resolveBackgroundRemovalBaseUrl(overrideBaseUrl);
  const runtimeBaseUrl = configuredBaseUrl.endsWith('/v1')
    ? configuredBaseUrl.slice(0, -3)
    : configuredBaseUrl;
  const runtimeEndpoint = `${runtimeBaseUrl}/recraft/v1/images/removeBackground`;
  const candidateEndpoints = Array.from(
    new Set([
      runtimeEndpoint,
      `${configuredBaseUrl}/recraft/v1/images/removeBackground`,
    ])
  );

  return {
    runtimeEndpoint,
    candidateEndpoints,
  };
}

function resolveBackgroundRemovalApiKey(overrideApiKey) {
  const apiKey =
    (typeof overrideApiKey === 'string' && overrideApiKey.trim()) ||
    process.env.COMFLY_API_KEY ||
    process.env.GPT_BEST_API_KEY ||
    '';

  if (!apiKey) {
    throw new Error('Please set COMFLY_API_KEY or GPT_BEST_API_KEY in .env.local');
  }

  return apiKey;
}

function inferMimeType(fileName, fallbackMimeType = 'image/png') {
  const extension = path.extname(fileName || '').toLowerCase();
  return EXTENSION_TO_MIME_TYPE.get(extension) || fallbackMimeType;
}

export function resolveBackgroundRemovalSource(imageUrl, { runtimeDir, publicDir, requestOrigin } = {}) {
  const normalizedInput = typeof imageUrl === 'string' ? imageUrl.trim() : '';
  if (!normalizedInput) {
    throw new Error('Image URL is required');
  }

  if (normalizedInput.startsWith('/')) {
    const localPath = resolveLocalAssetPath(normalizedInput, {
      runtimeDir,
      publicDir,
      allowedExtensions: LOCAL_ASSET_ALLOWED_EXTENSIONS,
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
    const localPath = resolveLocalAssetPath(parsedUrl.pathname, {
      runtimeDir,
      publicDir,
      allowedExtensions: LOCAL_ASSET_ALLOWED_EXTENSIONS,
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

async function sourceToUploadFile(
  source,
  {
    fetchImpl = fetch,
    readFileImpl = readFile,
    signal,
  } = {}
) {
  if (!source || typeof source !== 'object') {
    throw new Error('Invalid background removal source');
  }

  if (source.kind === 'local') {
    const buffer = await readFileImpl(source.value);
    if (!buffer.length) {
      throw new Error('Background removal source image is empty');
    }
    if (buffer.length > MAX_SOURCE_BYTES) {
      throw new Error('Background removal source image is too large');
    }

    const fileName = path.basename(source.value) || 'input.png';
    const mimeType = inferMimeType(fileName);
    return {
      blob: new Blob([buffer], { type: mimeType }),
      fileName,
      mimeType,
      sizeBytes: buffer.length,
    };
  }

  const response = await fetchImpl(source.value, { signal });
  if (!response.ok) {
    throw new Error(`Failed to fetch reference image: ${response.status} ${response.statusText}`);
  }

  const contentLength = Number(response.headers.get('content-length') || '0');
  if (Number.isFinite(contentLength) && contentLength > MAX_SOURCE_BYTES) {
    throw new Error('Background removal source image is too large');
  }

  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  if (!buffer.length) {
    throw new Error('Background removal source image is empty');
  }
  if (buffer.length > MAX_SOURCE_BYTES) {
    throw new Error('Background removal source image is too large');
  }

  const parsedUrl = new URL(source.value);
  const fileName = path.basename(parsedUrl.pathname) || 'input.png';
  const contentType = response.headers.get('content-type') || inferMimeType(fileName);

  return {
    blob: new Blob([buffer], { type: contentType }),
    fileName,
    mimeType: contentType,
    sizeBytes: buffer.length,
  };
}

function createSourceReferencePreview(source, imageUrl) {
  const preview = createReferencePreview(imageUrl);
  if (source?.kind !== 'local') {
    return preview;
  }

  if (preview.startsWith('http://') || preview.startsWith('https://')) {
    try {
      return new URL(preview).pathname || '/';
    } catch {
      return preview;
    }
  }

  return preview;
}

export async function createRecraftBackgroundRemovalRequest({
  imageUrl,
  runtimeDir,
  publicDir,
  requestOrigin,
  apiKey,
  baseUrl,
  signal,
  fetchImpl,
  readFileImpl,
} = {}) {
  const source = resolveBackgroundRemovalSource(imageUrl, {
    runtimeDir,
    publicDir,
    requestOrigin,
  });
  const uploadFile = await sourceToUploadFile(source, {
    fetchImpl,
    readFileImpl,
    signal,
  });

  const formData = new FormData();
  formData.append('file', uploadFile.blob, uploadFile.fileName);
  formData.append('response_format', 'url');
  const providerConfig =
    typeof baseUrl === 'string' && baseUrl.trim() && typeof apiKey === 'string' && apiKey.trim()
      ? null
      : await readProviderConfig({ runtimeDir });
  const resolvedBaseUrl =
    (typeof baseUrl === 'string' && baseUrl.trim()) ||
    providerConfig?.config.baseUrl ||
    '';
  const resolvedApiKey =
    (typeof apiKey === 'string' && apiKey.trim()) ||
    providerConfig?.config.apiKey ||
    '';
  const providerTargets = resolveProviderRequestTargets(resolvedBaseUrl);
  const endpoints = resolveBackgroundRemovalEndpoints(providerTargets.recraftBaseUrl);

  return {
    endpoint: endpoints.runtimeEndpoint,
    headers: {
      Authorization: `Bearer ${resolveBackgroundRemovalApiKey(resolvedApiKey)}`,
    },
    body: formData,
    sourceMeta: {
      sourceKind: source.kind,
      sourceFileName: uploadFile.fileName,
      sourceMimeType: uploadFile.mimeType,
      sourceSizeBytes: uploadFile.sizeBytes,
      sourceRefPreview: createSourceReferencePreview(source, imageUrl),
      responseFormat: 'url',
    },
  };
}

export function extractRecraftBackgroundRemovalUrl(payload) {
  const url =
    payload &&
    typeof payload === 'object' &&
    payload.image &&
    typeof payload.image === 'object' &&
    typeof payload.image.url === 'string'
      ? payload.image.url.trim()
      : '';

  if (!url) {
    throw new Error('No background removal image URL returned');
  }

  return url;
}
