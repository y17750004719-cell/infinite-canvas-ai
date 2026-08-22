import { effectiveProviderProtocol } from './provider-protocol.mjs';

function normalizeText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function getPurposeModels(provider, purpose) {
  const values = purpose === 'image' ? provider?.imageModels : provider?.chatModels;
  return Array.isArray(values)
    ? values.map(normalizeText).filter(Boolean)
    : [];
}

function normalizeCapabilityInput(value) {
  return Array.isArray(value) ? value.map(normalizeText).filter(Boolean) : [];
}

export function resolveProviderModelCapabilities(provider, model) {
  const providerId = normalizeText(provider?.id).toLowerCase();
  const modelId = normalizeText(model);
  const lowerModel = modelId.toLowerCase();
  const configured = provider?.modelCapabilities?.[modelId];
  const providerName = normalizeText(provider?.name).toLowerCase();
  const providerBaseUrl = normalizeText(provider?.baseUrl).toLowerCase();
  const configuredInput = normalizeCapabilityInput(configured?.input || configured?.input_modalities);
  const protocol = effectiveProviderProtocol(provider, modelId);
  const isAudioModel = /(^|[-_])(asr|tts|speech|voice|audio)([-_]|$)/.test(lowerModel);
  const isXiaomiModel = providerId === 'xiaomi' || lowerModel.startsWith('mimo-');
  const isBeeApiProvider = providerId === 'provider-2'
    || providerId === 'beeapi'
    || providerName.includes('beeapi')
    || providerBaseUrl.includes('beeapi');
  const supportsVision = configuredInput.length > 0
    ? configuredInput.includes('image')
    : protocol === 'gemini';
  const supportsToolCalling = configured?.supportsToolCalling !== undefined
    ? configured.supportsToolCalling === true
    : !isAudioModel;
  const supportsRequiredToolChoice = configured?.supportsRequiredToolChoice !== undefined
    ? configured.supportsRequiredToolChoice === true
    : supportsToolCalling && !isXiaomiModel;
  const available = configured?.available !== undefined
    ? configured.available !== false
    : !(isBeeApiProvider && lowerModel === 'gpt-5.6');

  return {
    input: supportsVision ? ['text', 'image'] : ['text'],
    supportsVision,
    supportsToolCalling,
    supportsRequiredToolChoice,
    available,
  };
}

function candidateMeetsRequirements(provider, model, options = {}) {
  const capabilities = resolveProviderModelCapabilities(provider, model);
  if (options.requiresToolCalling && !capabilities.supportsToolCalling) return false;
  if (options.requiresRequiredToolChoice && !capabilities.supportsRequiredToolChoice) return false;
  if (options.excludeUnavailable && !capabilities.available) return false;
  return true;
}

/**
 * @param {{
 *   providers?: Array<{ id?: string, name?: string, enabled?: boolean, primary?: boolean, chatModels?: string[], modelProtocols?: Record<string, string>, modelCapabilities?: Record<string, unknown> }>,
 *   currentProviderId?: string,
 *   currentModel?: string,
 *   limit?: number,
 *   requiresToolCalling?: boolean,
 *   requiresRequiredToolChoice?: boolean,
 *   excludeUnavailable?: boolean,
 * }} [options]
 */
export function listAlternativeProviderModelSelections({
  providers,
  currentProviderId,
  currentModel,
  limit = 3,
  requiresToolCalling = false,
  requiresRequiredToolChoice = false,
  excludeUnavailable = false,
} = {}) {
  const providerId = normalizeText(currentProviderId);
  const model = normalizeText(currentModel);
  const maxResults = Math.min(4, Math.max(1, Number(limit) || 3));
  const enabledProviders = (Array.isArray(providers) ? providers : [])
    .filter((provider) => provider && provider.enabled !== false)
    .map((provider, index) => ({ provider, index }))
    .sort((left, right) => Number(Boolean(right.provider.primary)) - Number(Boolean(left.provider.primary)) || left.index - right.index)
    .map(({ provider }) => provider);
  const results = [];
  for (const provider of enabledProviders) {
    for (const candidateModel of getPurposeModels(provider, 'chat')) {
      if (normalizeText(provider.id) === providerId && candidateModel === model) continue;
      if (!candidateMeetsRequirements(provider, candidateModel, {
        requiresToolCalling,
        requiresRequiredToolChoice,
        excludeUnavailable,
      })) continue;
      results.push({
        providerId: normalizeText(provider.id),
        providerName: normalizeText(provider.name) || normalizeText(provider.id),
        model: candidateModel,
      });
      if (results.length >= maxResults) return results;
    }
  }
  return results;
}

/**
 * @param {{
 *   providers?: Array<{ id?: string, name?: string, enabled?: boolean, primary?: boolean, chatModels?: string[], imageModels?: string[], protocol?: string, modelProtocols?: Record<string, string>, modelCapabilities?: Record<string, unknown> }>,
 *   purpose?: 'chat' | 'image',
 *   requestedProviderId?: string,
 *   requestedModel?: string,
 *   allowFallback?: boolean,
 *   requiresToolCalling?: boolean,
 *   requiresRequiredToolChoice?: boolean,
 *   excludeUnavailable?: boolean,
 * }} [options]
 */
export function resolveProviderModelSelection({
  providers,
  purpose,
  requestedProviderId,
  requestedModel,
  allowFallback = true,
  requiresToolCalling = false,
  requiresRequiredToolChoice = false,
  excludeUnavailable = false,
} = {}) {
  const requirements = {
    requiresToolCalling,
    requiresRequiredToolChoice,
    excludeUnavailable,
  };
  const enabledProviders = Array.isArray(providers)
    ? providers.filter((provider) => provider && provider.enabled !== false)
    : [];
  const providerId = normalizeText(requestedProviderId);
  const model = normalizeText(requestedModel);
  const requestedProvider = enabledProviders.find((provider) => normalizeText(provider.id) === providerId);

  if (requestedProvider && model && getPurposeModels(requestedProvider, purpose).includes(model)
    && candidateMeetsRequirements(requestedProvider, model, requirements)) {
    return { providerId: requestedProvider.id, model, fallback: false, reason: 'exact' };
  }

  if (!allowFallback) {
    return {
      providerId: null,
      model: null,
      fallback: false,
      reason: 'no_capable_provider',
    };
  }

  const requestedProviderFirstModel = getPurposeModels(requestedProvider, purpose)
    .find((candidateModel) => candidateMeetsRequirements(requestedProvider, candidateModel, requirements));
  if (requestedProvider && requestedProviderFirstModel) {
    return {
      providerId: requestedProvider.id,
      model: requestedProviderFirstModel,
      fallback: true,
      reason: 'requested_provider_first_model',
    };
  }

  if (model) {
    const modelProvider = enabledProviders.find((provider) => (
      getPurposeModels(provider, purpose).includes(model)
      && candidateMeetsRequirements(provider, model, requirements)
    ));
    if (modelProvider) {
      return {
        providerId: modelProvider.id,
        model,
        fallback: true,
        reason: 'requested_model_other_provider',
      };
    }
  }

  const primaryProvider = enabledProviders.find((provider) => provider.primary);
  const primaryModel = getPurposeModels(primaryProvider, purpose)
    .find((candidateModel) => candidateMeetsRequirements(primaryProvider, candidateModel, requirements));
  if (primaryProvider && primaryModel) {
    return {
      providerId: primaryProvider.id,
      model: primaryModel,
      fallback: true,
      reason: 'primary_provider_first_model',
    };
  }

  const firstCapableProvider = enabledProviders.find((provider) => getPurposeModels(provider, purpose)
    .some((candidateModel) => candidateMeetsRequirements(provider, candidateModel, requirements)));
  if (firstCapableProvider) {
    const firstCapableModel = getPurposeModels(firstCapableProvider, purpose)
      .find((candidateModel) => candidateMeetsRequirements(firstCapableProvider, candidateModel, requirements));
    return {
      providerId: firstCapableProvider.id,
      model: firstCapableModel,
      fallback: true,
      reason: 'first_capable_provider',
    };
  }

  return {
    providerId: null,
    model: null,
    fallback: true,
    reason: 'no_capable_provider',
  };
}
