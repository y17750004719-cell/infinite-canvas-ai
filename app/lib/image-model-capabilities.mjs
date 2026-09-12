export const IMAGE_SIZE_OPTIONS = [
  { id: '1024x1024', label: '1K', imageSize: '1K' },
  { id: '2048x2048', label: '2K', imageSize: '2K' },
  { id: '4096x4096', label: '4K', imageSize: '4K' },
];

export const IMAGE_RESOLUTION_SIZE_MAP = {
  '1:1': { '1K': '1024x1024', '2K': '2048x2048', '4K': '4096x4096' },
  '2:3': { '1K': '1024x1536', '2K': '1360x2048', '4K': '2352x3520' },
  '3:2': { '1K': '1536x1024', '2K': '2048x1360', '4K': '3520x2352' },
  '9:16': { '1K': '720x1280', '2K': '1152x2048', '4K': '2160x3840' },
  '16:9': { '1K': '1280x720', '2K': '2048x1152', '4K': '3840x2160' },
  '3:4': { '1K': '1008x1344', '2K': '1536x2048', '4K': '2448x3264' },
  '4:3': { '1K': '1344x1008', '2K': '2048x1536', '4K': '3264x2448' },
  '4:5': { '1K': '816x1024', '2K': '1632x2048', '4K': '3264x4096' },
  '5:4': { '1K': '1024x816', '2K': '2048x1632', '4K': '4096x3264' },
  '9:21': { '1K': '544x1280', '2K': '880x2048', '4K': '1648x3840' },
  '21:9': { '1K': '1280x544', '2K': '2048x880', '4K': '3840x1648' },
};

const DEFAULT_IMAGE_MODEL_CAPABILITY = {
  supportsAspectRatio: true,
  requestSupportsAspectRatio: true,
  uiSupportsAspectRatio: true,
  supportedSizes: IMAGE_SIZE_OPTIONS.map((option) => option.id),
  requestModelBySize: {},
  sizeOptions: undefined,
};

// Kept as an empty registry-shaped export for callers that inspect capability
// metadata; runtime routing is exclusively protocol-driven.
export const IMAGE_MODEL_CAPABILITIES = Object.freeze({});

export function normalizeImageModelCapabilityId(modelId) {
  return typeof modelId === 'string' ? modelId.trim() : '';
}

export function getImageModelCapability(modelId) {
  return DEFAULT_IMAGE_MODEL_CAPABILITY;
}

export function imageModelSupportsAspectRatioUi(modelId) {
  const capability = getImageModelCapability(modelId);
  if (typeof capability.uiSupportsAspectRatio === 'boolean') {
    return capability.uiSupportsAspectRatio;
  }
  return capability.supportsAspectRatio !== false;
}

export function imageModelSupportsAspectRatioRequest(modelId) {
  const capability = getImageModelCapability(modelId);
  if (typeof capability.requestSupportsAspectRatio === 'boolean') {
    return capability.requestSupportsAspectRatio;
  }
  return capability.supportsAspectRatio !== false;
}

export function getSupportedImageSizeOptions(modelId) {
  const capability = getImageModelCapability(modelId);
  if (Array.isArray(capability.sizeOptions) && capability.sizeOptions.length > 0) {
    return capability.sizeOptions;
  }
  const allowedSizeIds = new Set(capability.supportedSizes);
  return IMAGE_SIZE_OPTIONS.filter((option) => allowedSizeIds.has(option.id));
}

export function normalizeImageResolutionTier(sizeOrTier) {
  const normalizedValue = typeof sizeOrTier === 'string' ? sizeOrTier.trim() : '';
  if (/^1k$/i.test(normalizedValue) || normalizedValue === '1024x1024') return '1K';
  if (/^2k$/i.test(normalizedValue) || normalizedValue === '2048x2048') return '2K';
  if (/^4k$/i.test(normalizedValue) || normalizedValue === '4096x4096') return '4K';
  const match = normalizedValue.match(/^(\d+)x(\d+)$/i);
  if (!match) return '';
  const width = Number(match[1]);
  const height = Number(match[2]);
  const longestEdge = Math.max(width, height);
  if (longestEdge >= 3840) return '4K';
  if (longestEdge >= 2048) return '2K';
  if (longestEdge >= 1024) return '1K';
  return '';
}

export function normalizeImageAspectRatio(value, fallbackValue = '1:1') {
  const normalizedValue = typeof value === 'string' ? value.trim() : '';
  if (!normalizedValue || normalizedValue === 'auto') return fallbackValue;
  return normalizedValue;
}

function gcd(a, b) {
  let x = Math.abs(Math.round(Number(a) || 0));
  let y = Math.abs(Math.round(Number(b) || 0));
  while (y) {
    const t = y;
    y = x % y;
    x = t;
  }
  return x || 1;
}

function customSizeForAspectRatio(resolutionTier, aspectRatio) {
  const normalizedAspectRatio = normalizeImageAspectRatio(aspectRatio);
  const match = normalizedAspectRatio.match(/^(\d+):(\d+)$/);
  if (!match) return '';
  const ratioWidth = Number(match[1]);
  const ratioHeight = Number(match[2]);
  if (!Number.isFinite(ratioWidth) || !Number.isFinite(ratioHeight) || ratioWidth <= 0 || ratioHeight <= 0) return '';
  const longSideByTier = { '1K': 1536, '2K': 2048, '4K': 3840 };
  const pixelLimitByTier = { '1K': 1572864, '2K': 4194304, '4K': 8294400 };
  const longSide = longSideByTier[resolutionTier] || 1024;
  const pixelLimit = pixelLimitByTier[resolutionTier] || longSide * longSide;
  const ratio = ratioWidth / ratioHeight;
  const rawWidth = ratio >= 1 ? longSide : Math.min(longSide * ratio, Math.sqrt(pixelLimit * ratio));
  const rawHeight = ratio >= 1 ? Math.min(longSide / ratio, Math.sqrt(pixelLimit / ratio)) : longSide;
  const width = Math.floor(rawWidth / 16) * 16;
  const height = Math.floor(rawHeight / 16) * 16;
  return `${Math.max(64, width)}x${Math.max(64, height)}`;
}

export function resolveOpenAiImageSizeForAspectRatio(requestedSize, aspectRatio) {
  const normalizedRequestedSize = typeof requestedSize === 'string' ? requestedSize.trim() : '';
  const resolutionTier = normalizeImageResolutionTier(normalizedRequestedSize);
  if (!resolutionTier) {
    return normalizedRequestedSize;
  }

  const normalizedAspectRatio = normalizeImageAspectRatio(aspectRatio);
  const mappedSize = IMAGE_RESOLUTION_SIZE_MAP[normalizedAspectRatio]?.[resolutionTier];
  return mappedSize || customSizeForAspectRatio(resolutionTier, normalizedAspectRatio) || normalizedRequestedSize;
}

export function resolveImageSizeForAspectRatio(_modelId, requestedSize, aspectRatio) {
  return resolveOpenAiImageSizeForAspectRatio(requestedSize, aspectRatio);
}

export function resolveSupportedImageSize(modelId, requestedSize, fallbackSize = IMAGE_SIZE_OPTIONS[1].id) {
  const supportedOptions = getSupportedImageSizeOptions(modelId);
  const supportedIds = new Set(supportedOptions.map((option) => option.id));
  const normalizedRequestedSize = typeof requestedSize === 'string' ? requestedSize.trim() : '';

  if (normalizedRequestedSize && supportedIds.has(normalizedRequestedSize)) {
    return normalizedRequestedSize;
  }

  if (supportedIds.has(fallbackSize)) {
    return fallbackSize;
  }

  return supportedOptions[0]?.id || fallbackSize;
}

export function supportsImageModelRequestedSize(modelId, requestedSize) {
  const normalizedRequestedSize = typeof requestedSize === 'string' ? requestedSize.trim() : '';
  if (!normalizedRequestedSize) {
    return false;
  }

  return getSupportedImageSizeOptions(modelId).some((option) => option.id === normalizedRequestedSize);
}

export function supportsImageModelExactSize(modelId, requestedSize) {
  const normalizedRequestedSize = typeof requestedSize === 'string' ? requestedSize.trim() : '';
  if (!normalizedRequestedSize) {
    return false;
  }

  return supportsImageModelRequestedSize(modelId, normalizedRequestedSize);
}

export function supportsImageModelImageSizeConfig(modelId) {
  return getSupportedImageSizeOptions(modelId).length > 0;
}

export function resolveImageRequestModel(modelId, requestedSize) {
  const requestedModelId = typeof modelId === 'string' ? modelId.trim() : '';
  return requestedModelId;
}

export function getImageSizeLabel(modelId, sizeId) {
  const normalizedModelId =
    typeof sizeId === 'undefined' ? undefined : typeof modelId === 'string' ? modelId.trim() : undefined;
  const normalizedSizeId =
    typeof sizeId === 'undefined'
      ? typeof modelId === 'string'
        ? modelId.trim()
        : ''
      : typeof sizeId === 'string'
        ? sizeId.trim()
        : '';

  const options = normalizedModelId ? getSupportedImageSizeOptions(normalizedModelId) : IMAGE_SIZE_OPTIONS;
  return options.find((option) => option.id === normalizedSizeId)?.label || normalizedSizeId;
}

export function getGeminiImageSizeEnum(sizeId) {
  return IMAGE_SIZE_OPTIONS.find((option) => option.id === sizeId)?.imageSize || '1K';
}
