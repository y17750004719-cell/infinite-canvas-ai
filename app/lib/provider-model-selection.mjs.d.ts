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
  baseUrl?: string;
  protocol?: string;
  imageRequestMode?: string;
  imageGenerationEndpoint?: string;
  imageEditEndpoint?: string;
  modelProtocols?: Record<string, string>;
  modelCapabilities?: Record<string, unknown>;
}

export interface ProviderModelSelection {
  providerId: string | null;
  model: string | null;
  fallback: boolean;
  reason: ProviderModelSelectionReason;
}

export interface ResolvedProviderSelection extends ProviderModelSelection {
  providerName: string | null;
  baseUrl: string | null;
  protocol: string | null;
  capability: ProviderModelPurpose;
  providerFingerprint: string;
  modelFingerprint: string;
  enabled: boolean;
  validated: boolean;
}

export function resolveProviderModelSelection(options?: {
  providers?: ProviderModelSelectionProvider[];
  purpose?: ProviderModelPurpose;
  requestedProviderId?: string;
  requestedModel?: string;
  allowFallback?: boolean;
}): ProviderModelSelection;

export function fingerprintProviderSelection(
  provider: ProviderModelSelectionProvider,
  model: string,
  purpose?: ProviderModelPurpose,
): string;

export function resolveProviderSelection(options?: {
  providers?: ProviderModelSelectionProvider[];
  purpose?: ProviderModelPurpose;
  requestedProviderId?: string;
  requestedModel?: string;
  allowFallback?: boolean;
  requiresToolCalling?: boolean;
  requiresRequiredToolChoice?: boolean;
  excludeUnavailable?: boolean;
  onDiagnostic?: (event: Record<string, unknown>) => void;
}): ResolvedProviderSelection;
