import path from 'node:path';
import { readFile } from 'node:fs/promises';

import {
  extractRecraftBackgroundRemovalUrl,
  resolveBackgroundRemovalEndpoints,
} from '../app/lib/recraft-background-removal.mjs';

const API_KEY = process.env.COMFLY_API_KEY || process.env.GPT_BEST_API_KEY || '';
const BASE_URL = process.env.COMFLY_API_URL || process.env.GPT_BEST_BASE_URL || 'https://gpt-best.cn';
const MIME_TYPES = new Map([
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.webp', 'image/webp'],
  ['.gif', 'image/gif'],
]);
const BODY_PREVIEW_LIMIT = 600;

function inferMimeType(filePath) {
  return MIME_TYPES.get(path.extname(filePath).toLowerCase()) || 'application/octet-stream';
}

function truncate(value, maxLength = BODY_PREVIEW_LIMIT) {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized) {
    return '';
  }

  return normalized.length <= maxLength
    ? normalized
    : `${normalized.slice(0, maxLength)} [TRUNCATED ${normalized.length - maxLength} chars]`;
}

async function buildRequestBody(filePath) {
  const buffer = await readFile(filePath);
  const formData = new FormData();
  formData.append(
    'file',
    new Blob([buffer], { type: inferMimeType(filePath) }),
    path.basename(filePath)
  );
  formData.append('response_format', 'url');
  return formData;
}

async function probeEndpoint(endpoint, filePath) {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${API_KEY}`,
    },
    body: await buildRequestBody(filePath),
  });

  const bodyText = await response.text().catch(() => '');
  let payload = null;
  try {
    payload = bodyText ? JSON.parse(bodyText) : null;
  } catch {
    payload = null;
  }

  let imageUrl = null;
  try {
    imageUrl = extractRecraftBackgroundRemovalUrl(payload);
  } catch {
    imageUrl = null;
  }

  return {
    endpoint,
    status: response.status,
    statusText: response.statusText,
    contentType: response.headers.get('content-type') || '',
    bodyPreview: truncate(bodyText),
    hasImageUrl: typeof imageUrl === 'string' && imageUrl.length > 0,
    imageUrl,
  };
}

async function main() {
  const filePath = process.argv[2];
  if (!API_KEY) {
    throw new Error('Missing COMFLY_API_KEY or GPT_BEST_API_KEY');
  }
  if (!filePath) {
    throw new Error('Usage: node scripts/smoke-remove-background.mjs <local-image-path>');
  }

  const { runtimeEndpoint, candidateEndpoints } = resolveBackgroundRemovalEndpoints(BASE_URL);
  const results = [];

  for (const endpoint of candidateEndpoints) {
    results.push(await probeEndpoint(endpoint, filePath));
  }

  console.log(
    JSON.stringify(
      {
        baseUrl: BASE_URL,
        runtimeEndpoint,
        candidateEndpoints,
        filePath,
        results,
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(
    JSON.stringify(
      {
        error: error instanceof Error ? error.message : String(error),
      },
      null,
      2
    )
  );
  process.exitCode = 1;
});
