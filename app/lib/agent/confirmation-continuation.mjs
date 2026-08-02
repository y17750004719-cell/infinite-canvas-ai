import { createHash } from 'node:crypto';
import { resolveProviderModelSelection } from '../provider-model-selection.mjs';

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

export function hashEnvelopeValue(value) {
  return createHash('sha256').update(stableJson(value)).digest('hex');
}

export function fingerprintProviderModel(provider, model, purpose = 'chat') {
  if (!provider) return '';
  return hashEnvelopeValue({
    id: provider.id,
    enabled: provider.enabled !== false,
    protocol: provider.protocol,
    baseUrl: provider.baseUrl,
    chatCompletionsPath: provider.chatCompletionsPath,
    purpose,
    models: purpose === 'image' ? provider.imageModels : provider.chatModels,
    modelProtocols: provider.modelProtocols,
    ...(purpose === 'image' ? {
      imageRequestMode: provider.imageRequestMode,
      imageGenerationEndpoint: provider.imageGenerationEndpoint,
      imageEditEndpoint: provider.imageEditEndpoint,
    } : {}),
    model,
  });
}

export function resolveConfirmationImageIdentity({ providers, toolName, requestedProviderId, requestedModel }) {
  if (toolName !== 'generate_image') {
    return {
      resolvedImageProviderId: undefined,
      resolvedImageModel: undefined,
      imageProviderModelFingerprint: undefined,
    };
  }
  const selection = resolveProviderModelSelection({
    providers,
    purpose: 'image',
    requestedProviderId,
    requestedModel,
  });
  if (!selection.providerId || !selection.model) {
    throw new Error('No enabled image provider and model are configured');
  }
  const provider = providers.find((candidate) => candidate.id === selection.providerId);
  return {
    resolvedImageProviderId: selection.providerId,
    resolvedImageModel: selection.model,
    imageProviderModelFingerprint: fingerprintProviderModel(provider, selection.model, 'image'),
  };
}

export function resolveRemainingConfirmationTaskIdentities({
  pendingTaskIdentities = [],
  remainingTaskIdentities = [],
  completedTaskIdentities = [],
}) {
  const completedSlotIds = new Set(completedTaskIdentities.map((identity) => identity.slotId));
  return [
    ...pendingTaskIdentities.filter((identity) => !completedSlotIds.has(identity.slotId)),
    ...remainingTaskIdentities,
  ];
}

function assertPinnedProviderModel({ providers, purpose, providerId, model, fingerprint }) {
  if (!providerId || !model || !fingerprint) {
    throw new Error('Confirmation continuation envelope is invalid');
  }
  const exactSelection = resolveProviderModelSelection({
    providers,
    purpose,
    requestedProviderId: providerId,
    requestedModel: model,
  });
  const exactProvider = providers.find((provider) => provider.id === providerId);
  if (
    exactSelection.reason !== 'exact'
    || exactSelection.providerId !== providerId
    || exactSelection.model !== model
    || fingerprintProviderModel(exactProvider, model, purpose) !== fingerprint
  ) {
    throw new Error('Confirmed provider and model are no longer enabled with the same configuration');
  }
}

export function claimConfirmationContinuation({ record, requestedToolName, userMessage, providers, now = Date.now() }) {
  if (!record || record.expiresAt <= now) throw new Error('Confirmation expired; request a new confirmation');
  if (requestedToolName !== record.toolName || record.userMessage !== userMessage) {
    throw new Error('Confirmation does not match this request');
  }
  if (record.status && record.status !== 'pending') throw new Error('Confirmation has already been submitted');
  if (record.version === 1) {
    if (
      !record.pendingToolCall
      || record.pendingToolCall.name !== record.toolName
      || record.pendingToolCall.argsHash !== hashEnvelopeValue(record.toolArgs)
    ) {
      throw new Error('Confirmation continuation envelope is invalid');
    }
    const hasChatSelection = record.resolvedProviderId || record.resolvedModel || record.providerModelFingerprint;
    const hasImageSelection = record.resolvedImageProviderId || record.resolvedImageModel || record.imageProviderModelFingerprint;
    if (!hasChatSelection && !hasImageSelection) throw new Error('Confirmation continuation envelope is invalid');
    if (hasChatSelection) assertPinnedProviderModel({
      providers,
      purpose: 'chat',
      providerId: record.resolvedProviderId,
      model: record.resolvedModel,
      fingerprint: record.providerModelFingerprint,
    });
    if (hasImageSelection) assertPinnedProviderModel({
      providers,
      purpose: 'image',
      providerId: record.resolvedImageProviderId,
      model: record.resolvedImageModel,
      fingerprint: record.imageProviderModelFingerprint,
    });
  }
  record.status = 'executing';
  return record;
}
