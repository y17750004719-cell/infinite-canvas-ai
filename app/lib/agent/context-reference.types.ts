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
