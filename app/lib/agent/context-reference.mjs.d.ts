export interface AgentProposalOption {
  id: string;
  entityId: string;
  index: number;
  label: string;
  aliases: string[];
  summary?: string;
  brief: string;
  mustPreserve: string[];
  referenceImageUrls: string[];
  canvasItemIds: string[];
}

export interface AgentProposal {
  version: 1;
  id: string;
  title: string;
  intent: 'image' | 'skill_action' | 'chat';
  requiresSelection: boolean;
  options: AgentProposalOption[];
}

export interface AgentContextEntity {
  id: string;
  groupId?: string;
  kind: 'proposal_option' | 'generated_image' | 'reference_image' | 'canvas_item' | 'task';
  intent: 'image' | 'skill_action' | 'chat';
  label: string;
  index?: number;
  aliases?: string[];
  summary?: string;
  brief: string;
  mustPreserve?: string[];
  assetUrl?: string;
  referenceImageUrls?: string[];
  canvasItemIds?: string[];
  sourceMessageId?: string;
  createdAt?: number;
  lastResolvedAt?: number;
  selected?: boolean;
  x?: number;
  y?: number;
}

export interface AgentContextResolution {
  status: 'none' | 'resolved' | 'ambiguous' | 'missing';
  detected: boolean;
  confidence: 'none' | 'medium' | 'high';
  candidates: AgentContextEntity[];
  entityIds: string[];
}

export interface ExecutionBrief {
  version: 1;
  originalRequest: string;
  resolvedEntityIds: string[];
  resolvedLabels?: string[];
  plainText: string;
  mustPreserve: string[];
  referenceImageUrls: string[];
  canvasItemIds: string[];
}

export function parseAgentProposalBlock(content: string): { cleanContent: string; proposal: AgentProposal | null };
export function extractLegacyProposal(message: Record<string, unknown>): AgentProposal | null;
export function buildAgentContextEntities(input?: Record<string, unknown>): AgentContextEntity[];
export function resolveContextReference(input?: {
  userMessage?: string;
  entities?: AgentContextEntity[];
  selectedEntityIds?: string[];
}): AgentContextResolution;
export function compileExecutionBrief(input?: { userMessage?: string; contextResolution?: AgentContextResolution }): ExecutionBrief;
export function ensureOptimizedPromptCoverage(prompt: string, executionBrief?: ExecutionBrief): string;
export function isReferentialShorthand(value: string): boolean;
export const AGENT_PROPOSAL_MARKERS: { start: string; end: string };
