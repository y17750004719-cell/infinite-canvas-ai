export interface AgentDefaultImageOptions {
  size: string;
  aspectRatio: string;
  quality: string;
  count: number;
}

export interface ResolvedAgentImageOptions extends AgentDefaultImageOptions {
  requestedSize: string;
  sizeFallback: boolean;
  requestedAspectRatio: string;
  ratioSource: 'prompt' | 'selected' | 'default';
  ratioFallback: boolean;
  requestedQuality: string;
  qualityFallback: boolean;
  requestSize?: string;
  requestSizes?: string[];
}

export const AGENT_DEFAULT_IMAGE_OPTIONS: Readonly<AgentDefaultImageOptions>;

export function extractExplicitImageAspectRatio(input?: string): string | null;

export function normalizeAgentImageCount(requestedCount?: number): number;

export function resolveAgentImageOptions(input?: {
  prompt?: string;
  selectedAspectRatio?: string;
  requestedSize?: string;
  requestedQuality?: string;
  requestedCount?: number;
  providerId?: string;
  modelId?: string;
  providerImageOptionProfiles?: Record<string, unknown>;
}): ResolvedAgentImageOptions;

export function buildAgentImageGenerationRequests(input?: {
  prompt?: string;
  generationPrompt?: string;
  referenceImages?: string[];
  providerId?: string;
  modelId?: string;
  allowedModelIds?: string[];
  providerImageOptionProfiles?: Record<string, unknown>;
  selectedAspectRatio?: string;
  requestedSize?: string;
  requestedQuality?: string;
  requestedCount?: number;
}): {
  options: ResolvedAgentImageOptions;
  requests: Array<Record<string, unknown>>;
};
