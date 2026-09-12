import { getSupportedImageSizeOptions } from './image-model-capabilities.mjs';

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

function createDefaultModelProfile(modelId) {
  const normalizedModelId = normalizeText(modelId);
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
