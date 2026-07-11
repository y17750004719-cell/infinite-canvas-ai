export type ProviderModelPurpose = 'chat' | 'image';

export type ProviderModelSelectionReason =
  | 'exact'
  | 'requested_provider_first_model'
  | 'requested_model_other_provider'
  | 'primary_provider_first_model'
  | 'first_capable_provider'
  | 'no_capable_provider';

export interface ProviderModelSelectionProvider {
  id?: string;
  enabled?: boolean;
  primary?: boolean;
  chatModels?: string[];
  imageModels?: string[];
}

export interface ProviderModelSelection {
  providerId: string | null;
  model: string | null;
  fallback: boolean;
  reason: ProviderModelSelectionReason;
}

export function resolveProviderModelSelection(options?: {
  providers?: ProviderModelSelectionProvider[];
  purpose?: ProviderModelPurpose;
  requestedProviderId?: string;
  requestedModel?: string;
}): ProviderModelSelection;
