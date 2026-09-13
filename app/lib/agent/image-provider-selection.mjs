import { resolveProviderModelSelection } from '../provider-model-selection.mjs';

/**
 * Resolve image provider/model admission at the image boundary. Keeping this
 * independent from the Next route makes the selection contract testable in
 * isolation and reusable by agent and direct image execution.
 * @param {{providers?: Array<Record<string, unknown>>, requestedProviderId?: string, requestedModel?: string, allowFallback?: boolean}} options
 * @returns {{selection: {providerId: string, model: string, fallback: boolean, reason: string}, provider: Record<string, unknown>|null, allowedModelIds: string[]}}
 */
export function resolveImageExecutionSelection({
  providers,
  requestedProviderId,
  requestedModel,
  allowFallback = true,
} = {}) {
  const selection = resolveProviderModelSelection({
    providers,
    purpose: 'image',
    requestedProviderId,
    requestedModel,
    allowFallback,
  });
  if (!selection.providerId || !selection.model) {
    throw new Error('No enabled image provider and model are configured');
  }
  const provider = (Array.isArray(providers) ? providers : [])
    .find((candidate) => candidate?.id === selection.providerId) || null;
  const allowedModelIds = Array.isArray(provider?.imageModels) && provider.imageModels.length > 0
    ? provider.imageModels
    : [selection.model];
  return { selection, provider, allowedModelIds };
}
