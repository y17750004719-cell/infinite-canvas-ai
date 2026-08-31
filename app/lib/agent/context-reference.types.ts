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

/** Runtime reference context shared by the Main Agent and image tools. */
export interface AgentReferenceContext {
  references: Array<{
    id: string;
    src?: string;
    previewSrc?: string;
    label: string;
    source: 'upload' | 'history' | 'canvas';
    canvasItemId?: string;
    role: 'reference' | 'edit_target' | 'annotation_bundle' | 'region_target';
    annotationCount?: number;
    regionId?: string;
    candidateId?: string;
    confirmationStatus?: 'pending' | 'confirmed';
    aliases?: string[];
    description?: string;
    confidence?: 'high' | 'medium' | 'low';
    targetPoint?: { x: number; y: number };
    targetBox?: { x: number; y: number; width: number; height: number };
  }>;
  composerSegments: Array<
    | { type: 'text'; text: string }
    | { type: 'reference'; referenceId: string }
  >;
  evidenceImages?: Array<{
    id: string;
    referenceId: string;
    src: string;
    kind: 'annotation_composite' | 'region_crop';
  }>;
}

export interface AgentActiveTaskVersion {
  referenceId: string;
  batchId: string;
  slotId: string;
  versionId: string;
  parentVersionId?: string;
  src: string;
  previewSrc?: string;
  label?: string;
}

/** Current Main Agent image execution contract. */
export interface AgentTaskContract {
  intent?: 'chat' | 'image' | 'skill_action';
  skillId?: string | null;
  delivery?: Record<string, unknown>;
  execution?: Record<string, unknown>;
  imageTask?: Record<string, unknown>;
  generation?: Record<string, unknown> | null;
  [key: string]: unknown;
}
