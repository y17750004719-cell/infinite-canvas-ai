function normalizeText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function getPurposeModels(provider, purpose) {
  const values = purpose === 'image' ? provider?.imageModels : provider?.chatModels;
  return Array.isArray(values)
    ? values.map(normalizeText).filter(Boolean)
    : [];
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
