import { createHash } from 'node:crypto';
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

function stableSerialize(value) {
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableSerialize(item)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/**
 * Create a non-secret identity for the provider/model capability snapshot.
 * API keys and auth headers are deliberately excluded.
 */
export function fingerprintProviderSelection(provider, model, purpose = 'chat') {
  if (!provider || !normalizeText(model)) return '';
  const payload = {
    id: normalizeText(provider.id),
    name: normalizeText(provider.name),
    enabled: provider.enabled !== false,
    baseUrl: normalizeText(provider.baseUrl),
    protocol: effectiveProviderProtocol(provider, model),
    purpose,
    model: normalizeText(model),
    models: getPurposeModels(provider, purpose),
    modelProtocols: provider.modelProtocols || {},
    capabilities: provider.modelCapabilities?.[model] || null,
    ...(purpose === 'image' ? {
      imageRequestMode: normalizeText(provider.imageRequestMode),
      imageGenerationEndpoint: normalizeText(provider.imageGenerationEndpoint),
      imageEditEndpoint: normalizeText(provider.imageEditEndpoint),
    } : {}),
  };
  return createHash('sha256').update(stableSerialize(payload)).digest('hex');
}

function emitSelectionDiagnostic(onDiagnostic, event, details) {
  if (typeof onDiagnostic !== 'function') return;
  try {
    onDiagnostic({ event, ...details });
  } catch {
    // Diagnostics must never make provider selection fail.
  }
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

/**
 * Resolve an immutable, request-safe provider selection snapshot. The legacy
 * resolver above remains intentionally unchanged for compatibility callers.
 */
export function resolveProviderSelection({ onDiagnostic, ...options } = {}) {
  const purpose = options.purpose === 'image' ? 'image' : 'chat';
  const selection = resolveProviderModelSelection({ ...options, purpose });
  const providers = Array.isArray(options.providers) ? options.providers : [];
  const provider = providers.find((candidate) => normalizeText(candidate?.id) === selection.providerId) || null;
  const capabilities = provider && selection.model
    ? resolveProviderModelCapabilities(provider, selection.model)
    : null;
  const enabled = Boolean(provider && provider.enabled !== false);
  const validated = Boolean(
    enabled
      && selection.providerId
      && selection.model
      && getPurposeModels(provider, purpose).includes(selection.model)
      && (!options.excludeUnavailable || capabilities?.available !== false)
      && (!options.requiresToolCalling || capabilities?.supportsToolCalling)
      && (!options.requiresRequiredToolChoice || capabilities?.supportsRequiredToolChoice),
  );
  const providerFingerprint = provider && selection.model
    ? fingerprintProviderSelection(provider, selection.model, purpose)
    : '';
  const resolved = Object.freeze({
    providerId: selection.providerId,
    providerName: normalizeText(provider?.name) || selection.providerId || null,
    baseUrl: normalizeText(provider?.baseUrl) || null,
    model: selection.model,
    protocol: provider && selection.model ? effectiveProviderProtocol(provider, selection.model) : null,
    capability: purpose,
    providerFingerprint,
    modelFingerprint: providerFingerprint,
    enabled,
    validated,
    fallback: selection.fallback,
    reason: selection.reason,
  });
  emitSelectionDiagnostic(onDiagnostic, validated ? 'provider.selection.resolved' : 'provider.selection.rejected', {
    providerId: resolved.providerId,
    model: resolved.model,
    protocol: resolved.protocol,
    capability: resolved.capability,
    providerFingerprint: resolved.providerFingerprint,
    reason: resolved.reason,
    validated: resolved.validated,
  });
  if (!validated && provider && selection.model) {
    emitSelectionDiagnostic(onDiagnostic, 'provider.capability.mismatch', {
      providerId: resolved.providerId,
      model: resolved.model,
      protocol: resolved.protocol,
      capability: resolved.capability,
      providerFingerprint: resolved.providerFingerprint,
      reason: resolved.reason,
    });
  }
  return resolved;
}
