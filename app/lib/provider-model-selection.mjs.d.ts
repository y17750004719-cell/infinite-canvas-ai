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
  name?: string;
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

export interface AlternativeProviderModelSelection {
  providerId: string;
  providerName: string;
  model: string;
}

export function listAlternativeProviderModelSelections(options?: {
  providers?: ProviderModelSelectionProvider[];
  currentProviderId?: string;
  currentModel?: string;
  limit?: number;
}): AlternativeProviderModelSelection[];

export function resolveProviderModelSelection(options?: {
  providers?: ProviderModelSelectionProvider[];
  purpose?: ProviderModelPurpose;
  requestedProviderId?: string;
  requestedModel?: string;
}): ProviderModelSelection;
