export const IMAGE_SIZE_OPTIONS = [
  { id: '1024x1024', label: '1K', imageSize: '1K' },
  { id: '2048x2048', label: '2K', imageSize: '2K' },
  { id: '4096x4096', label: '4K', imageSize: '4K' },
];

const DEFAULT_IMAGE_MODEL_CAPABILITY = {
  supportsAspectRatio: true,
  supportedSizes: IMAGE_SIZE_OPTIONS.map((option) => option.id),
  requestModelBySize: {},
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
};

export function getImageModelCapability(modelId) {
  const normalizedModelId = typeof modelId === 'string' ? modelId.trim() : '';
  return IMAGE_MODEL_CAPABILITIES[normalizedModelId] || DEFAULT_IMAGE_MODEL_CAPABILITY;
}

export function getSupportedImageSizeOptions(modelId) {
  const capability = getImageModelCapability(modelId);
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

export function getImageSizeLabel(sizeId) {
  return IMAGE_SIZE_OPTIONS.find((option) => option.id === sizeId)?.label || sizeId;
}

export function getGeminiImageSizeEnum(sizeId) {
  return IMAGE_SIZE_OPTIONS.find((option) => option.id === sizeId)?.imageSize || '1K';
}
