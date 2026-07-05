export type ProviderConfigSource = 'runtime' | 'env';
export type ProviderProtocol = 'openai' | 'gemini';
export type ImageRequestMode = 'openai' | 'openai-json';
export type ProviderImageApiKeyScope = 'all' | 'gemini' | 'gpt';

export interface ProviderImageApiKey {
  id: string;
  apiKey: string;
  scope: ProviderImageApiKeyScope;
}

export interface ProviderImageApiKeyView extends ProviderImageApiKey {
  hasApiKey: boolean;
  maskedApiKey: string;
}

export interface WorkspaceApiProvider {
  id: string;
  name: string;
  baseUrl: string;
  protocol: ProviderProtocol;
  imageRequestMode: ImageRequestMode;
  imageGenerationEndpoint: string;
  imageEditEndpoint: string;
  enabled: boolean;
  primary: boolean;
  imageModels: string[];
  chatModels: string[];
  apiKey: string;
  imageApiKeys: ProviderImageApiKey[];
  updatedAt: string;
}

export interface ProviderRuntimeConfig {
  providerId: string;
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
  providerId: string;
  baseUrl: string;
  apiKey: string;
  hasApiKey: boolean;
  maskedApiKey: string;
  source: ProviderConfigSource;
  updatedAt?: string;
}

export interface ProviderRegistryResult {
  providers: WorkspaceApiProvider[];
  source: ProviderConfigSource;
  path: string;
}

export interface ProviderRegistryViewProvider {
  id: string;
  name: string;
  baseUrl: string;
  protocol: ProviderProtocol;
  imageRequestMode: ImageRequestMode;
  imageGenerationEndpoint: string;
  imageEditEndpoint: string;
  enabled: boolean;
  primary: boolean;
  imageModels: string[];
  chatModels: string[];
  apiKey: string;
  imageApiKeys: ProviderImageApiKeyView[];
  hasApiKey: boolean;
  maskedApiKey: string;
  source: ProviderConfigSource;
  updatedAt?: string;
}

export interface ProviderRegistryView {
  providers: ProviderRegistryViewProvider[];
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

export function providerEndpointUrl(provider: WorkspaceApiProvider, key: 'imageGenerationEndpoint' | 'imageEditEndpoint', defaultPath: string): string;

export function getPrimaryProvider(providers: WorkspaceApiProvider[]): WorkspaceApiProvider | null;

export function getProviderById(providers: WorkspaceApiProvider[], providerId?: string): WorkspaceApiProvider | null;

export function readProviderRegistry(options?: {
  runtimeDir?: string;
  env?: Record<string, string | undefined>;
  readFileImpl?: (path: string, encoding: string) => Promise<string>;
}): Promise<ProviderRegistryResult>;

export function updateProviderRegistry(
  providersInput: Array<Partial<WorkspaceApiProvider> & { baseUrl: string }>,
  options?: {
    runtimeDir?: string;
    mkdirImpl?: (path: string, options: { recursive: true }) => Promise<unknown>;
    writeFileImpl?: (path: string, data: string, encoding: string) => Promise<unknown>;
  }
): Promise<ProviderRegistryResult>;

export function readProviderConfig(options?: {
  runtimeDir?: string;
  env?: Record<string, string | undefined>;
  readFileImpl?: (path: string, encoding: string) => Promise<string>;
}): Promise<ProviderRuntimeConfigResult>;

export function updateProviderConfig(
  input: {
    providerId?: string;
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

export function toProviderRegistryView(result: ProviderRegistryResult): ProviderRegistryView;
