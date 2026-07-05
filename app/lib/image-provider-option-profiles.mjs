import { getSupportedImageSizeOptions, normalizeImageModelCapabilityId } from './image-model-capabilities.mjs';

const DEFAULT_ASPECT_RATIO_IDS = [
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
  '1:4',
  '4:1',
  '1:8',
  '8:1',
];

export const DEFAULT_IMAGE_CARD_QUALITY_OPTIONS = [
  { id: 'auto', label: 'Auto' },
  { id: 'high', label: 'High' },
  { id: 'medium', label: 'Medium' },
  { id: 'low', label: 'Low' },
];

const COMFLY_PROVIDER_ID = 'comfly';
const COMFLY_DEFAULT_GPT_IMAGE_2_ASPECT_RATIOS = ['1:1', '3:2', '2:3', '16:9', '9:16', '4:3', '3:4'];
const COMFLY_DEFAULT_GPT_IMAGE_2_SIZE_TO_ASPECTS = {
  '1024x1024': ['1:1', '3:2', '2:3', '16:9', '9:16', '4:3', '3:4'],
  '2048x2048': ['1:1', '3:2', '2:3', '16:9', '9:16', '4:3', '3:4'],
  '4096x4096': ['16:9', '9:16', '4:3', '3:4'],
};
const COMFLY_DEFAULT_GPT_IMAGE_2_RESOLVED_SIZES = {
  '1024x1024': {
    '1:1': '1024x1024',
    '3:2': '1536x1024',
    '2:3': '1024x1536',
    '16:9': '1280x720',
    '9:16': '720x1280',
    '4:3': '1344x1008',
    '3:4': '1008x1344',
  },
  '2048x2048': {
    '1:1': '2048x2048',
    '3:2': '2048x1360',
    '2:3': '1360x2048',
    '16:9': '2048x1152',
    '9:16': '1152x2048',
    '4:3': '2048x1536',
    '3:4': '1536x2048',
  },
  '4096x4096': {
    '16:9': '3840x2160',
    '9:16': '2160x3840',
    '4:3': '3264x2448',
    '3:4': '2448x3264',
  },
};
function normalizeText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function cloneSizeOptions(sizeOptions) {
  return Array.isArray(sizeOptions)
    ? sizeOptions.map((option) => ({ ...option }))
    : [];
}

function cloneQualityOptions(qualityOptions) {
  return Array.isArray(qualityOptions)
    ? qualityOptions.map((option) => ({ ...option }))
    : [];
}

function cloneEnabledAspectRatiosBySize(enabledAspectRatiosBySize) {
  if (!enabledAspectRatiosBySize || typeof enabledAspectRatiosBySize !== 'object') {
    return {};
  }

  return Object.fromEntries(
    Object.entries(enabledAspectRatiosBySize).map(([sizeId, aspectRatios]) => [
      sizeId,
      Array.isArray(aspectRatios) ? [...aspectRatios] : [],
    ])
  );
}

function cloneResolvedSizesBySizeAndAspect(resolvedSizesBySizeAndAspect) {
  if (!resolvedSizesBySizeAndAspect || typeof resolvedSizesBySizeAndAspect !== 'object') {
    return {};
  }

  return Object.fromEntries(
    Object.entries(resolvedSizesBySizeAndAspect).map(([sizeId, aspectRatios]) => [
      sizeId,
      aspectRatios && typeof aspectRatios === 'object' ? { ...aspectRatios } : {},
    ])
  );
}

function cloneModelProfile(profile) {
  return {
    aspectRatios: Array.isArray(profile?.aspectRatios) ? [...profile.aspectRatios] : [...DEFAULT_ASPECT_RATIO_IDS],
    sizeOptions: cloneSizeOptions(profile?.sizeOptions),
    qualityOptions: cloneQualityOptions(profile?.qualityOptions),
    enabledAspectRatiosBySize: cloneEnabledAspectRatiosBySize(profile?.enabledAspectRatiosBySize),
    resolvedSizesBySizeAndAspect: cloneResolvedSizesBySizeAndAspect(profile?.resolvedSizesBySizeAndAspect),
  };
}

function createComflyDefaultGptImage2Profile() {
  return cloneModelProfile({
    aspectRatios: COMFLY_DEFAULT_GPT_IMAGE_2_ASPECT_RATIOS,
    sizeOptions: getSupportedImageSizeOptions('gpt-image-2'),
    qualityOptions: [
      { id: 'auto', label: 'Auto' },
      { id: 'low', label: 'Low' },
      { id: 'medium', label: 'Medium' },
      { id: 'high', label: 'High' },
    ],
    enabledAspectRatiosBySize: COMFLY_DEFAULT_GPT_IMAGE_2_SIZE_TO_ASPECTS,
    resolvedSizesBySizeAndAspect: COMFLY_DEFAULT_GPT_IMAGE_2_RESOLVED_SIZES,
  });
}

function createDefaultModelProfile(modelId) {
  const normalizedModelId = normalizeText(modelId);
  if (normalizeImageModelCapabilityId(normalizedModelId) === 'gpt-image-2') {
    return createComflyDefaultGptImage2Profile();
  }
  return {
    aspectRatios: [...DEFAULT_ASPECT_RATIO_IDS],
    sizeOptions: cloneSizeOptions(getSupportedImageSizeOptions(normalizedModelId)),
    qualityOptions: cloneQualityOptions(DEFAULT_IMAGE_CARD_QUALITY_OPTIONS),
    enabledAspectRatiosBySize: {},
    resolvedSizesBySizeAndAspect: {},
  };
}

export function buildProviderImageOptionProfiles(providers = []) {
  const profiles = {};
  for (const provider of Array.isArray(providers) ? providers : []) {
    const providerId = normalizeText(provider?.id);
    if (!providerId) continue;

    const modelIds = Array.isArray(provider?.imageModels) ? provider.imageModels : [];
    const modelProfiles = {};

    for (const modelId of modelIds) {
      const normalizedModelId = normalizeText(modelId);
      if (!normalizedModelId || modelProfiles[normalizedModelId]) continue;

      modelProfiles[normalizedModelId] = createDefaultModelProfile(normalizedModelId);
    }

    profiles[providerId] = {
      providerId,
      models: modelProfiles,
    };
  }

  if (!profiles[COMFLY_PROVIDER_ID]) {
    profiles[COMFLY_PROVIDER_ID] = {
      providerId: COMFLY_PROVIDER_ID,
      models: {},
    };
  }

  if (!profiles[COMFLY_PROVIDER_ID].models['gpt-image-2']) {
    profiles[COMFLY_PROVIDER_ID].models['gpt-image-2'] = createComflyDefaultGptImage2Profile();
  }

  return profiles;
}

export function getProviderModelOptionProfile(providerId, modelId, providerImageOptionProfiles = {}) {
  const normalizedProviderId = normalizeText(providerId);
  const normalizedModelId = normalizeText(modelId);
  if (
    normalizedProviderId &&
    normalizedModelId &&
    providerImageOptionProfiles?.[normalizedProviderId]?.models?.[normalizedModelId]
  ) {
    return cloneModelProfile(providerImageOptionProfiles[normalizedProviderId].models[normalizedModelId]);
  }

  return createDefaultModelProfile(normalizedModelId);
}

export function getProviderModelAspectRatios(providerId, modelId, providerImageOptionProfiles = {}) {
  return getProviderModelOptionProfile(providerId, modelId, providerImageOptionProfiles).aspectRatios;
}

export function getProviderModelQualityOptions(providerId, modelId, providerImageOptionProfiles = {}) {
  return getProviderModelOptionProfile(providerId, modelId, providerImageOptionProfiles).qualityOptions;
}

export function getProviderModelSizeOptions(providerId, modelId, providerImageOptionProfiles = {}) {
  return getProviderModelOptionProfile(providerId, modelId, providerImageOptionProfiles).sizeOptions;
}

export function getEnabledProviderModelAspectRatios(providerId, modelId, sizeId, providerImageOptionProfiles = {}) {
  const normalizedSizeId = normalizeText(sizeId);
  const profile = getProviderModelOptionProfile(providerId, modelId, providerImageOptionProfiles);
  const enabledAspectRatios = profile.enabledAspectRatiosBySize[normalizedSizeId];
  if (Array.isArray(enabledAspectRatios) && enabledAspectRatios.length > 0) {
    return [...enabledAspectRatios];
  }
  return [...profile.aspectRatios];
}

export function normalizeProviderModelAspectRatioForSize(
  providerId,
  modelId,
  sizeId,
  aspectRatio,
  providerImageOptionProfiles = {},
  fallbackAspectRatio = '1:1'
) {
  const normalizedAspectRatio = normalizeText(aspectRatio);
  const enabledAspectRatios = getEnabledProviderModelAspectRatios(
    providerId,
    modelId,
    sizeId,
    providerImageOptionProfiles
  );

  if (normalizedAspectRatio && enabledAspectRatios.includes(normalizedAspectRatio)) {
    return normalizedAspectRatio;
  }

  if (enabledAspectRatios.includes(fallbackAspectRatio)) {
    return fallbackAspectRatio;
  }

  return enabledAspectRatios[0] || fallbackAspectRatio;
}

export function resolveProviderModelRequestedSize(providerId, modelId, sizeId, aspectRatio, providerImageOptionProfiles = {}) {
  const normalizedSizeId = normalizeText(sizeId);
  const resolvedAspectRatio = normalizeProviderModelAspectRatioForSize(
    providerId,
    modelId,
    normalizedSizeId,
    aspectRatio,
    providerImageOptionProfiles
  );
  const profile = getProviderModelOptionProfile(providerId, modelId, providerImageOptionProfiles);
  return (
    profile.resolvedSizesBySizeAndAspect?.[normalizedSizeId]?.[resolvedAspectRatio] ||
    normalizedSizeId
  );
}
