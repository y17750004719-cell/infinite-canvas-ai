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

export const IMAGE_MODEL_CAPABILITIES = {
  'gemini-3.1-flash-image-preview': {
    supportsAspectRatio: true,
    requestSupportsAspectRatio: true,
    uiSupportsAspectRatio: true,
    supportedSizes: IMAGE_SIZE_OPTIONS.map((option) => option.id),
    requestModelBySize: {
      '1024x1024': 'gemini-3.1-flash-image-preview',
      '2048x2048': 'gemini-3.1-flash-image-preview',
      '4096x4096': 'gemini-3.1-flash-image-preview-4k',
    },
  },
  'gemini-2.5-flash-image': {
    supportsAspectRatio: true,
    requestSupportsAspectRatio: true,
    uiSupportsAspectRatio: true,
    supportedSizes: IMAGE_SIZE_OPTIONS.map((option) => option.id),
    requestModelBySize: {
      '1024x1024': 'gemini-2.5-flash-image',
      '2048x2048': 'gemini-2.5-flash-image',
      '4096x4096': 'gemini-2.5-flash-image',
    },
  },
  'gemini-3-pro-image-preview': {
    supportsAspectRatio: true,
    requestSupportsAspectRatio: true,
    uiSupportsAspectRatio: true,
    supportedSizes: IMAGE_SIZE_OPTIONS.map((option) => option.id),
    requestModelBySize: {
      '1024x1024': 'gemini-3-pro-image-preview',
      '2048x2048': 'gemini-3-pro-image-preview',
      '4096x4096': 'gemini-3-pro-image-preview',
    },
  },
  'gpt-image-2': {
    supportsAspectRatio: false,
    requestSupportsAspectRatio: false,
    uiSupportsAspectRatio: true,
    supportedSizes: IMAGE_SIZE_OPTIONS.map((option) => option.id),
    requestModelBySize: {
      '1024x1024': 'gpt-image-2',
      '2048x2048': 'gpt-image-2',
      '4096x4096': 'gpt-image-2',
    },
    sizeOptions: IMAGE_SIZE_OPTIONS,
  },
};

function normalizeGeminiImageProviderVariant(modelId) {
  const normalizedModelId = typeof modelId === 'string' ? modelId.trim() : '';
  if (/^gemini-3\.1-flash-image-preview(?:[-_](?:1k|2k|4k))?$/i.test(normalizedModelId)) {
    return 'gemini-3.1-flash-image-preview';
  }
  return normalizedModelId;
}

export function normalizeImageModelCapabilityId(modelId) {
  const normalizedModelId = normalizeGeminiImageProviderVariant(modelId);
  if (/^gpt-image-2(?:[-_].*)?$/i.test(normalizedModelId)) {
    return 'gpt-image-2';
  }
  return normalizedModelId;
}

export function getImageModelCapability(modelId) {
  const normalizedModelId = normalizeImageModelCapabilityId(modelId);
  return IMAGE_MODEL_CAPABILITIES[normalizedModelId] || DEFAULT_IMAGE_MODEL_CAPABILITY;
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

export function resolveImageSizeForAspectRatio(modelId, requestedSize, aspectRatio) {
  const normalizedModelId = normalizeImageModelCapabilityId(modelId);
  const normalizedRequestedSize = typeof requestedSize === 'string' ? requestedSize.trim() : '';
  const resolutionTier = normalizeImageResolutionTier(normalizedRequestedSize);
  if (normalizedModelId !== 'gpt-image-2' || !resolutionTier) {
    return normalizedRequestedSize;
  }

  const normalizedAspectRatio = normalizeImageAspectRatio(aspectRatio);
  const mappedSize = IMAGE_RESOLUTION_SIZE_MAP[normalizedAspectRatio]?.[resolutionTier];
  return mappedSize || customSizeForAspectRatio(resolutionTier, normalizedAspectRatio) || normalizedRequestedSize;
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

  const normalizedModelId = normalizeImageModelCapabilityId(modelId);
  if (normalizedModelId === 'gpt-image-2' && normalizeImageResolutionTier(normalizedRequestedSize)) {
    return true;
  }

  return getSupportedImageSizeOptions(normalizedModelId).some((option) => option.id === normalizedRequestedSize);
}

export function supportsImageModelExactSize(modelId, requestedSize) {
  const normalizedRequestedSize = typeof requestedSize === 'string' ? requestedSize.trim() : '';
  if (!normalizedRequestedSize) {
    return false;
  }

  const normalizedModelId = normalizeImageModelCapabilityId(modelId);
  if (normalizedModelId === 'gpt-image-2') {
    return Boolean(normalizedRequestedSize.match(/^\d+x\d+$/i) && normalizeImageResolutionTier(normalizedRequestedSize));
  }

  return supportsImageModelRequestedSize(normalizedModelId, normalizedRequestedSize);
}

export function getGptImage2SizeValidationError(size) {
  const normalizedSize = typeof size === 'string' ? size.trim() : '';
  const match = normalizedSize.match(/^(\d+)x(\d+)$/i);
  if (!match) {
    return '尺寸必须是类似 2048x1152 的 WxH 字符串';
  }

  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return '尺寸宽高必须是正整数';
  }

  if (width % 16 !== 0 || height % 16 !== 0) {
    return '尺寸宽高必须都是 16 的倍数';
  }

  const longestEdge = Math.max(width, height);
  const shortestEdge = Math.min(width, height);
  if (longestEdge > 3840) {
    return '尺寸最大边不能超过 3840px';
  }

  if (shortestEdge <= 0 || longestEdge / shortestEdge > 3) {
    return '尺寸长短边比例不能超过 3:1';
  }

  const pixels = width * height;
  if (pixels < 655360) {
    return '尺寸总像素不能小于 655360';
  }
  if (pixels > 8294400) {
    return '尺寸总像素不能大于 8294400';
  }

  return null;
}

export function isValidGptImage2Size(size) {
  return getGptImage2SizeValidationError(size) === null;
}

export function supportsImageModelImageSizeConfig(modelId) {
  const normalizedModelId = normalizeImageModelCapabilityId(modelId);
  return getSupportedImageSizeOptions(normalizedModelId).length > 0;
}

export function resolveImageRequestModel(modelId, requestedSize) {
  const requestedModelId = typeof modelId === 'string' ? modelId.trim() : '';
  const normalizedModelId = normalizeImageModelCapabilityId(requestedModelId);
  if (requestedModelId && requestedModelId !== normalizedModelId && normalizedModelId.startsWith('gemini-')) {
    return requestedModelId;
  }
  const normalizedSize = typeof requestedSize === 'string' ? requestedSize.trim() : '';
  const capability = getImageModelCapability(normalizedModelId);
  const mappedModelId =
    normalizedSize && capability.requestModelBySize && capability.requestModelBySize[normalizedSize]
      ? capability.requestModelBySize[normalizedSize]
      : normalizedModelId;

  return mappedModelId || normalizedModelId;
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
