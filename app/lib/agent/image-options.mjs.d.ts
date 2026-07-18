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
export const AGENT_MAX_IMAGE_BATCH_COUNT: number;

export function extractExplicitImageAspectRatio(input?: string): string | null;
export function parseAgentImageCountNumber(value?: string): number | null;
export function extractAgentImageFileCounts(input?: string): Array<{ count: number; matchedText: string }>;
export function extractAgentImageCount(input?: string): {
  status: 'none' | 'resolved' | 'ambiguous' | 'overflow';
  count?: number;
  source: 'prompt' | 'default';
  candidates: number[];
  matchedText?: string;
  reason?: string;
};
export function resolveAgentImageCountDecision(input?: {
  prompt?: string;
  rawPrompt?: string;
  plannedCount?: number;
  interfaceCount?: number;
  clarifiedCount?: number;
  clarifiedSource?: 'clarification' | 'prompt' | 'interface' | 'default' | 'batch';
  batchPlan?: { totalCount: number; completedCount: number; remainingCount: number; batchSize: number };
  proceedWithCurrent?: boolean;
}): {
  status: 'resolved' | 'ambiguous' | 'overflow';
  count?: number;
  totalCount?: number;
  source: 'clarification' | 'prompt' | 'interface' | 'default' | 'batch';
  candidates: number[];
  matchedText?: string;
  reason?: string;
  batchPlan?: { totalCount: number; completedCount: number; remainingCount: number; batchSize: number };
};

export function normalizeAgentImageCount(requestedCount?: number): number;

export function resolveAgentImageBatchContinuation<T extends { id: string }>(input?: {
  currentItems?: T[];
  remainingItems?: T[];
  failedItemIds?: string[];
  batchSize?: number;
}): { pendingCount: number; nextItems: T[]; remainingItems: T[] };

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
  generationPrompts?: string[];
  linkedImagePreviews?: Array<{
    id: string;
    src: string;
    label: string;
    alt?: string;
  }>;
  referenceIds?: string[];
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
