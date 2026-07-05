const RAW_PAYLOAD_PREVIEW_LIMIT = 1200;
const TEXT_PREVIEW_LIMIT = 240;
const IMAGE_SAFETY_FINISH_REASONS = new Set(['IMAGE_SAFETY', 'IMAGE_PROHIBITED_CONTENT']);

function truncateString(value, maxLength) {
  if (typeof value !== 'string' || !value) {
    return '';
  }

  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength)} [TRUNCATED ${value.length - maxLength} chars]`;
}

function collectCandidateParts(payload) {
  if (!payload || typeof payload !== 'object' || !Array.isArray(payload.candidates)) {
    return [];
  }

  return payload.candidates.flatMap((candidate) => {
    if (
      !candidate ||
      typeof candidate !== 'object' ||
      !candidate.content ||
      typeof candidate.content !== 'object' ||
      !Array.isArray(candidate.content.parts)
    ) {
      return [];
    }

    return candidate.content.parts.filter((part) => part && typeof part === 'object');
  });
}

function getPartType(part) {
  if (!part || typeof part !== 'object') {
    return null;
  }

  if ('inlineData' in part || 'inline_data' in part) return 'inlineData';
  if ('text' in part) return 'text';

  const [firstKey] = Object.keys(part);
  return firstKey || null;
}

function inferImageMimeTypeFromBase64(data) {
  if (typeof data !== 'string' || !data.trim()) {
    return '';
  }

  const buffer = Buffer.from(data, 'base64');
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return 'image/png';
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg';
  }
  if (buffer.length >= 6 && buffer.toString('ascii', 0, 6).startsWith('GIF8')) {
    return 'image/gif';
  }
  if (
    buffer.length >= 12 &&
    buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return 'image/webp';
  }
  return '';
}

function resolveInlineImageMimeType(inlineData, data) {
  const inferredMimeType = inferImageMimeTypeFromBase64(data);
  if (inferredMimeType) {
    return inferredMimeType;
  }

  const declaredMimeType =
    typeof inlineData.mimeType === 'string'
      ? inlineData.mimeType
      : typeof inlineData.mime_type === 'string'
        ? inlineData.mime_type
        : '';
  const normalizedMimeType = declaredMimeType.trim().toLowerCase();
  return normalizedMimeType.startsWith('image/') ? normalizedMimeType : 'image/png';
}

function getRawPayloadPreview(payload) {
  try {
    return truncateString(JSON.stringify(payload), RAW_PAYLOAD_PREVIEW_LIMIT);
  } catch {
    return '[UNSERIALIZABLE_PAYLOAD]';
  }
}

export function extractGeminiImageOutputs(payload) {
  const outputs = [];

  const visit = (value, depth = 0) => {
    if (depth > 8 || value == null) return;

    if (Array.isArray(value)) {
      value.forEach((entry) => visit(entry, depth + 1));
      return;
    }

    if (typeof value !== 'object') {
      return;
    }

    const record = value;
    const inlineData =
      record.inlineData && typeof record.inlineData === 'object'
        ? record.inlineData
        : record.inline_data && typeof record.inline_data === 'object'
          ? record.inline_data
          : null;

    if (inlineData) {
      const data = typeof inlineData.data === 'string' ? inlineData.data : '';
      const mimeType = resolveInlineImageMimeType(inlineData, data);
      if (mimeType.startsWith('image/') && data) {
        outputs.push({
          url: `data:${mimeType};base64,${data}`,
        });
      }
    }

    Object.values(record).forEach((entry) => visit(entry, depth + 1));
  };

  visit(payload);
  return outputs;
}

export function summarizeGeminiImagePayload(payload) {
  const record = payload && typeof payload === 'object' ? payload : {};
  const candidates = Array.isArray(record.candidates) ? record.candidates : [];
  const parts = collectCandidateParts(record);
  const finishReasons = candidates
    .map((candidate) =>
      candidate && typeof candidate === 'object' && typeof candidate.finishReason === 'string'
        ? candidate.finishReason
        : ''
    )
    .filter(Boolean);
  const promptFeedback =
    record.promptFeedback && typeof record.promptFeedback === 'object'
      ? record.promptFeedback
      : null;
  const promptBlockReason =
    promptFeedback && typeof promptFeedback.blockReason === 'string'
      ? promptFeedback.blockReason
      : null;
  const promptSafetyRatings =
    promptFeedback && Array.isArray(promptFeedback.safetyRatings)
      ? promptFeedback.safetyRatings
      : [];
  const candidateSafetyRatings = candidates.flatMap((candidate) =>
    candidate && typeof candidate === 'object' && Array.isArray(candidate.safetyRatings)
      ? candidate.safetyRatings
      : []
  );
  const textParts = parts
    .map((part) => (typeof part.text === 'string' ? part.text.trim() : ''))
    .filter(Boolean);
  const partTypes = Array.from(
    new Set(
      parts
        .map((part) => getPartType(part))
        .filter(Boolean)
    )
  );

  return {
    candidateCount: candidates.length,
    finishReasons,
    promptBlockReason,
    promptSafetyRatings,
    candidateSafetyRatings,
    partTypes,
    hasInlineData: partTypes.includes('inlineData'),
    hasText: textParts.length > 0,
    textPreview: truncateString(textParts.join('\n'), TEXT_PREVIEW_LIMIT) || null,
    responseId: typeof record.responseId === 'string' ? record.responseId : null,
    modelVersion: typeof record.modelVersion === 'string' ? record.modelVersion : null,
    usageMetadata:
      record.usageMetadata && typeof record.usageMetadata === 'object'
        ? record.usageMetadata
        : null,
    rawPayloadPreview: getRawPayloadPreview(record),
  };
}

export function classifyGeminiImagePayload(summary) {
  if (!summary || typeof summary !== 'object') {
    return 'unsupported_payload_shape';
  }

  if (summary.promptBlockReason) {
    return 'prompt_blocked';
  }

  if (!summary.candidateCount) {
    return 'empty_candidates';
  }

  if (Array.isArray(summary.finishReasons) && summary.finishReasons.includes('NO_IMAGE')) {
    return 'finish_reason_no_image';
  }

  if (
    Array.isArray(summary.finishReasons) &&
    summary.finishReasons.some((reason) => IMAGE_SAFETY_FINISH_REASONS.has(reason))
  ) {
    return 'image_safety_blocked';
  }

  if (summary.hasText && !summary.hasInlineData) {
    return 'candidate_text_only';
  }

  return 'unsupported_payload_shape';
}

export function buildGeminiNoImageErrorMessage(classification) {
  switch (classification) {
    case 'prompt_blocked':
      return 'Gemini official image blocked by prompt feedback';
    case 'finish_reason_no_image':
      return 'Gemini official image finished without image output';
    case 'image_safety_blocked':
      return 'Gemini official image blocked by image safety policy';
    case 'candidate_text_only':
      return 'Gemini official image returned text instead of image';
    case 'empty_candidates':
      return 'Gemini official image returned empty candidates';
    default:
      return 'Gemini official image returned an unsupported payload shape';
  }
}
