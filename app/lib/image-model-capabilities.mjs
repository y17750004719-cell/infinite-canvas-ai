export const IMAGE_SIZE_OPTIONS = [
  { id: '1024x1024', label: '1K', imageSize: '1K' },
  { id: '2048x2048', label: '2K', imageSize: '2K' },
  { id: '4096x4096', label: '4K', imageSize: '4K' },
];

const GPT_IMAGE_2_SIZE_OPTIONS = [
  { id: '1024x1024', label: '1024×1024', imageSize: '1024x1024' },
  { id: '1536x1024', label: '1536×1024', imageSize: '1536x1024' },
  { id: '1024x1536', label: '1024×1536', imageSize: '1024x1536' },
  { id: '2048x2048', label: '2048×2048', imageSize: '2048x2048' },
  { id: '2048x1152', label: '2048×1152', imageSize: '2048x1152' },
  { id: '3840x2160', label: '3840×2160', imageSize: '3840x2160' },
  { id: '2160x3840', label: '2160×3840', imageSize: '2160x3840' },
];

const DEFAULT_IMAGE_MODEL_CAPABILITY = {
  supportsAspectRatio: true,
  supportedSizes: IMAGE_SIZE_OPTIONS.map((option) => option.id),
  requestModelBySize: {},
  sizeOptions: undefined,
};

export const IMAGE_MODEL_CAPABILITIES = {
  'gemini-3.1-flash-image-preview': {
    supportsAspectRatio: true,
    supportedSizes: IMAGE_SIZE_OPTIONS.map((option) => option.id),
    requestModelBySize: {
      '1024x1024': 'gemini-3.1-flash-image-preview',
      '2048x2048': 'gemini-3.1-flash-image-preview',
      '4096x4096': 'gemini-3.1-flash-image-preview-4k',
    },
  },
  'gemini-2.5-flash-image': {
    supportsAspectRatio: true,
    supportedSizes: IMAGE_SIZE_OPTIONS.map((option) => option.id),
    requestModelBySize: {
      '1024x1024': 'gemini-2.5-flash-image',
      '2048x2048': 'gemini-2.5-flash-image',
      '4096x4096': 'gemini-2.5-flash-image',
    },
  },
  'gemini-3-pro-image-preview': {
    supportsAspectRatio: true,
    supportedSizes: IMAGE_SIZE_OPTIONS.map((option) => option.id),
    requestModelBySize: {
      '1024x1024': 'gemini-3-pro-image-preview',
      '2048x2048': 'gemini-3-pro-image-preview',
      '4096x4096': 'gemini-3-pro-image-preview',
    },
  },
  'gpt-image-2': {
    supportsAspectRatio: false,
    supportedSizes: GPT_IMAGE_2_SIZE_OPTIONS.map((option) => option.id),
    requestModelBySize: {
      '1024x1024': 'gpt-image-2',
      '1536x1024': 'gpt-image-2',
      '1024x1536': 'gpt-image-2',
      '2048x2048': 'gpt-image-2',
      '2048x1152': 'gpt-image-2',
      '3840x2160': 'gpt-image-2',
      '2160x3840': 'gpt-image-2',
    },
    sizeOptions: GPT_IMAGE_2_SIZE_OPTIONS,
  },
};

export function getImageModelCapability(modelId) {
  const normalizedModelId = typeof modelId === 'string' ? modelId.trim() : '';
  return IMAGE_MODEL_CAPABILITIES[normalizedModelId] || DEFAULT_IMAGE_MODEL_CAPABILITY;
}

export function getSupportedImageSizeOptions(modelId) {
  const capability = getImageModelCapability(modelId);
  if (Array.isArray(capability.sizeOptions) && capability.sizeOptions.length > 0) {
    return capability.sizeOptions;
  }
  const allowedSizeIds = new Set(capability.supportedSizes);
  return IMAGE_SIZE_OPTIONS.filter((option) => allowedSizeIds.has(option.id));
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

export function supportsImageModelImageSizeConfig(modelId) {
  const normalizedModelId = typeof modelId === 'string' ? modelId.trim() : '';
  return getSupportedImageSizeOptions(normalizedModelId).length > 0;
}

export function resolveImageRequestModel(modelId, requestedSize) {
  const normalizedModelId = typeof modelId === 'string' ? modelId.trim() : '';
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
