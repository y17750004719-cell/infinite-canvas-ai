function normalizeText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function getPurposeModels(provider, purpose) {
  const values = purpose === 'image' ? provider?.imageModels : provider?.chatModels;
  return Array.isArray(values)
    ? values.map(normalizeText).filter(Boolean)
    : [];
}

/**
 * @param {{
 *   providers?: Array<{ id?: string, name?: string, enabled?: boolean, primary?: boolean, chatModels?: string[] }>,
 *   currentProviderId?: string,
 *   currentModel?: string,
 *   limit?: number,
 * }} [options]
 */
export function listAlternativeProviderModelSelections({
  providers,
  currentProviderId,
  currentModel,
  limit = 3,
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

export function resolveProviderModelSelection({
  providers,
  purpose,
  requestedProviderId,
  requestedModel,
} = {}) {
  const enabledProviders = Array.isArray(providers)
    ? providers.filter((provider) => provider && provider.enabled !== false)
    : [];
  const providerId = normalizeText(requestedProviderId);
  const model = normalizeText(requestedModel);
  const requestedProvider = enabledProviders.find((provider) => normalizeText(provider.id) === providerId);

  if (requestedProvider && model && getPurposeModels(requestedProvider, purpose).includes(model)) {
    return { providerId: requestedProvider.id, model, fallback: false, reason: 'exact' };
  }

  const requestedProviderFirstModel = getPurposeModels(requestedProvider, purpose)[0];
  if (requestedProvider && requestedProviderFirstModel) {
    return {
      providerId: requestedProvider.id,
      model: requestedProviderFirstModel,
      fallback: true,
      reason: 'requested_provider_first_model',
    };
  }

  if (model) {
    const modelProvider = enabledProviders.find((provider) => getPurposeModels(provider, purpose).includes(model));
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
  const primaryModel = getPurposeModels(primaryProvider, purpose)[0];
  if (primaryProvider && primaryModel) {
    return {
      providerId: primaryProvider.id,
      model: primaryModel,
      fallback: true,
      reason: 'primary_provider_first_model',
    };
  }

  const firstCapableProvider = enabledProviders.find((provider) => getPurposeModels(provider, purpose).length > 0);
  if (firstCapableProvider) {
    return {
      providerId: firstCapableProvider.id,
      model: getPurposeModels(firstCapableProvider, purpose)[0],
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
