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

  if ('inlineData' in part) return 'inlineData';
  if ('text' in part) return 'text';

  const [firstKey] = Object.keys(part);
  return firstKey || null;
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
        : null;

    if (inlineData) {
      const mimeType = typeof inlineData.mimeType === 'string' ? inlineData.mimeType : 'image/png';
      const data = typeof inlineData.data === 'string' ? inlineData.data : '';
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
