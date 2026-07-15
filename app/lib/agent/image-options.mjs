import {
  getProviderModelQualityOptions,
  normalizeProviderModelAspectRatioForSize,
} from '../image-provider-option-profiles.mjs';
import {
  buildAsyncImageTaskRequests,
  resolveImageCardSize,
} from '../workspace-session-view.mjs';

export const AGENT_DEFAULT_IMAGE_OPTIONS = Object.freeze({
  size: '2048x2048',
  aspectRatio: '3:4',
  quality: 'auto',
  count: 1,
});

const EXPLICIT_ASPECT_RATIO_IDS = new Set([
  '1:1',
  '9:16',
  '16:9',
  '2:3',
  '3:2',
  '4:3',
  '3:4',
  '4:5',
  '5:4',
  '21:9',
  '9:21',
  '1:4',
  '4:1',
  '1:8',
  '8:1',
]);

export function extractExplicitImageAspectRatio(input) {
  const text = typeof input === 'string' ? input : '';
  const matches = [...text.matchAll(/(\d{1,2})\s*(?::|：|比)\s*(\d{1,2})/g)];
  for (let index = matches.length - 1; index >= 0; index -= 1) {
    const width = Number(matches[index][1]);
    const height = Number(matches[index][2]);
    const normalized = `${width}:${height}`;
    if (EXPLICIT_ASPECT_RATIO_IDS.has(normalized)) return normalized;
  }
  return null;
}

export function normalizeAgentImageCount(requestedCount) {
  const numericCount = Number(requestedCount);
  return Number.isFinite(numericCount) && numericCount > 0
    ? Math.min(9, Math.max(1, Math.floor(numericCount)))
    : AGENT_DEFAULT_IMAGE_OPTIONS.count;
}

export function resolveAgentImageOptions({
  prompt,
  selectedAspectRatio,
  requestedSize,
  requestedQuality,
  requestedCount,
  providerId,
  modelId,
  providerImageOptionProfiles = {},
} = {}) {
  const promptAspectRatio = extractExplicitImageAspectRatio(prompt);
  const normalizedSelectedAspectRatio = typeof selectedAspectRatio === 'string' && selectedAspectRatio.trim() && selectedAspectRatio !== 'auto'
    ? selectedAspectRatio.trim()
    : '';
  const requestedAspectRatio = promptAspectRatio
    || normalizedSelectedAspectRatio
    || AGENT_DEFAULT_IMAGE_OPTIONS.aspectRatio;
  const ratioSource = promptAspectRatio
    ? 'prompt'
    : normalizedSelectedAspectRatio
      ? 'selected'
      : 'default';
  const normalizedRequestedSize = typeof requestedSize === 'string' && requestedSize.trim()
    ? requestedSize.trim()
    : AGENT_DEFAULT_IMAGE_OPTIONS.size;
  const size = resolveImageCardSize(
    modelId,
    normalizedRequestedSize,
    AGENT_DEFAULT_IMAGE_OPTIONS.size,
    providerId,
    providerImageOptionProfiles
  );
  const aspectRatio = normalizeProviderModelAspectRatioForSize(
    providerId,
    modelId,
    size,
    requestedAspectRatio,
    providerImageOptionProfiles,
    AGENT_DEFAULT_IMAGE_OPTIONS.aspectRatio
  );
  const qualityOptions = getProviderModelQualityOptions(
    providerId,
    modelId,
    providerImageOptionProfiles
  );
  const normalizedRequestedQuality = typeof requestedQuality === 'string' && requestedQuality.trim()
    ? requestedQuality.trim()
    : AGENT_DEFAULT_IMAGE_OPTIONS.quality;
  const quality = qualityOptions.find((option) => option.id === normalizedRequestedQuality)?.id
    || qualityOptions[0]?.id
    || AGENT_DEFAULT_IMAGE_OPTIONS.quality;
  const count = normalizeAgentImageCount(requestedCount);

  return {
    size,
    aspectRatio,
    quality,
    count,
    requestedSize: normalizedRequestedSize,
    sizeFallback: size !== normalizedRequestedSize,
    requestedAspectRatio,
    ratioSource,
    ratioFallback: aspectRatio !== requestedAspectRatio,
    requestedQuality: normalizedRequestedQuality,
    qualityFallback: quality !== normalizedRequestedQuality,
  };
}

/** @param {Record<string, any>} input */
export function buildAgentImageGenerationRequests(input = {}) {
  const {
    prompt,
    generationPrompt,
    referenceImages = [],
    providerId,
    modelId,
    allowedModelIds,
    providerImageOptionProfiles = {},
    selectedAspectRatio,
    requestedSize,
    requestedQuality,
    requestedCount,
  } = input;
  const options = resolveAgentImageOptions({
    prompt,
    selectedAspectRatio,
    requestedSize,
    requestedQuality,
    requestedCount,
    providerId,
    modelId,
    providerImageOptionProfiles,
  });
  const linkedImagePreviews = (Array.isArray(referenceImages) ? referenceImages : [])
    .filter((src) => typeof src === 'string' && src.trim())
    .map((src, index) => ({
      id: `agent-reference-${index + 1}`,
      src,
      label: `image${index + 1}`,
    }));
  const requests = buildAsyncImageTaskRequests({
    input: typeof generationPrompt === 'string' && generationPrompt.trim()
      ? generationPrompt.trim()
      : typeof prompt === 'string'
        ? prompt.trim()
        : '',
    linkedImagePreviews,
    modelId,
    allowedModelIds,
    fallbackModel: modelId,
    imageProviderId: providerId,
    providerImageOptionProfiles,
    size: options.size,
    quality: options.quality,
    count: options.count,
    aspectRatio: options.aspectRatio,
  });

  const requestSizes = [...new Set(
    requests
      .map((request) => typeof request?.size === 'string' ? request.size.trim() : '')
      .filter(Boolean)
  )];

  return {
    options: {
      ...options,
      requestSize: requestSizes.length === 1 ? requestSizes[0] : undefined,
      requestSizes,
    },
    requests,
  };
}
