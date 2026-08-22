function parseArguments(argumentsText) {
  try {
    const parsed = JSON.parse(argumentsText || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function normalizeToolCallId(value, index) {
  return typeof value === 'string' && value.trim()
    ? value
    : `gemini-tool-${index + 1}`;
}

export function isSyntheticGeminiToolCallId(value) {
  return typeof value === 'string' && /^gemini-tool-\d+$/.test(value);
}

function canonicalizeGeminiPart(part) {
  if (!part || typeof part !== 'object' || Array.isArray(part)) return null;
  const normalized = { ...part };
  if (normalized.thoughtSignature === undefined && typeof normalized.thought_signature === 'string') {
    normalized.thoughtSignature = normalized.thought_signature;
  }
  delete normalized.thought_signature;
  if (normalized.inlineData === undefined && normalized.inline_data && typeof normalized.inline_data === 'object') {
    normalized.inlineData = {
      ...normalized.inline_data,
      ...(normalized.inline_data.mimeType === undefined && typeof normalized.inline_data.mime_type === 'string'
        ? { mimeType: normalized.inline_data.mime_type }
        : {}),
    };
    delete normalized.inlineData.mime_type;
  }
  delete normalized.inline_data;
  if (normalized.fileData === undefined && normalized.file_data && typeof normalized.file_data === 'object') {
    normalized.fileData = { ...normalized.file_data };
    delete normalized.file_data;
  }
  if (normalized.functionCall && typeof normalized.functionCall === 'object') {
    normalized.functionCall = { ...normalized.functionCall };
  }
  return normalized;
}

function hasGeminiPartData(part) {
  return Boolean(
    (typeof part?.text === 'string' && part.text.length > 0)
      || part?.functionCall
      || part?.functionResponse
      || part?.inlineData
      || part?.fileData
      || part?.executableCode
      || part?.codeExecutionResult,
  );
}

export function normalizeGeminiParts(parts) {
  const result = [];
  for (const input of Array.isArray(parts) ? parts : []) {
    const part = canonicalizeGeminiPart(input);
    if (!part) continue;
    if (!hasGeminiPartData(part)) {
      const previous = result.at(-1);
      if (previous && typeof part.thoughtSignature === 'string') previous.thoughtSignature = part.thoughtSignature;
      if (previous && part.thought === true) previous.thought = true;
      continue;
    }
    result.push(part);
  }
  return result;
}

export function replayGeminiParts(parts, sourceModel, model) {
  const normalized = normalizeGeminiParts(parts);
  if (normalized.length === 0) return null;
  if (sourceModel && model && sourceModel === model) return normalized;
  return normalized.map((part) => {
    const { thoughtSignature: _thoughtSignature, thought, ...rest } = part;
    return thought === true && typeof rest.text === 'string'
      ? rest
      : { ...rest };
  });
}

export function geminiToolCallToPart(toolCall) {
  const args = parseArguments(toolCall?.function?.arguments);
  const id = normalizeToolCallId(toolCall?.id, 0);
  return {
    functionCall: {
      name: toolCall?.function?.name,
      args,
      ...(toolCall?.id && !isSyntheticGeminiToolCallId(id) ? { id } : {}),
    },
    ...(typeof toolCall?.thoughtSignature === 'string'
      ? { thoughtSignature: toolCall.thoughtSignature }
      : {}),
  };
}

export function extractGeminiToolCalls(parts) {
  return normalizeGeminiParts(parts).flatMap((part, index) => (
    part?.functionCall?.name
      ? [{
          id: normalizeToolCallId(part.functionCall.id, index),
          type: 'function',
          ...(typeof part.thoughtSignature === 'string'
            ? { thoughtSignature: part.thoughtSignature }
            : {}),
          function: {
            name: part.functionCall.name,
            arguments: JSON.stringify(part.functionCall.args || {}),
          },
        }]
      : []
  ));
}
