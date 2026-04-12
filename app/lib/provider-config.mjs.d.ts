export type ProviderId = 'comfly' | 'gpt-best' | 'custom';
export type ProviderConfigSource = 'runtime' | 'env';

export interface ProviderRuntimeConfig {
  providerId: ProviderId;
  baseUrl: string;
  apiKey: string;
  updatedAt: string;
}

export interface ProviderRuntimeConfigResult {
  config: ProviderRuntimeConfig;
  source: ProviderConfigSource;
  path: string;
}

export interface ProviderRuntimeConfigView {
  providerId: ProviderId;
  baseUrl: string;
  hasApiKey: boolean;
  maskedApiKey: string;
  source: ProviderConfigSource;
  updatedAt?: string;
}

export class ProviderConfigError extends Error {
  statusCode: number;
}

export function resolveProviderRequestTargets(baseUrl: string): {
  baseUrl: string;
  openAiBaseUrl: string;
  geminiBaseUrl: string;
  recraftBaseUrl: string;
};

export function readProviderConfig(options?: {
  runtimeDir?: string;
  env?: Record<string, string | undefined>;
  readFileImpl?: (path: string, encoding: string) => Promise<string>;
}): Promise<ProviderRuntimeConfigResult>;

export function updateProviderConfig(
  input: {
    providerId?: ProviderId | string;
    baseUrl?: string;
    apiKey?: string;
  },
  options?: {
    runtimeDir?: string;
    env?: Record<string, string | undefined>;
    mkdirImpl?: (path: string, options: { recursive: true }) => Promise<unknown>;
    writeFileImpl?: (path: string, data: string, encoding: string) => Promise<unknown>;
  }
): Promise<ProviderRuntimeConfigResult>;

export function toProviderConfigView(result: ProviderRuntimeConfigResult): ProviderRuntimeConfigView;
