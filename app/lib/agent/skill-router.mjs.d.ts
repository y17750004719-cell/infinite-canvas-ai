import type { SkillManifest } from './skill-registry.mjs';

export interface AgentRoutingDecision {
  version: 1;
  route: 'chat' | 'vision_analysis' | 'planner';
  intent: 'chat' | 'image' | 'skill_action';
  skillId: string | null;
  confidence: 'high' | 'medium' | 'low';
  needsClarification: boolean;
  clarificationQuestion?: string;
  reason?: string;
  source?: 'model' | 'manual_locked' | 'router_failed';
}

export interface SkillCandidateSummary {
  id: string;
  name: string;
  description: string;
  triggerHints: string[];
}

export function buildSkillRouterMessages(input: {
  userMessage: string;
  candidates: SkillCandidateSummary[];
  messages?: Array<{ role: 'user' | 'assistant'; content: string }>;
  activeSkillId?: string | null;
  hasReferenceImages?: boolean;
  referenceMetadata?: Array<{ id?: string; label?: string; role?: string; source?: string }>;
  hasPendingConfirmation?: boolean;
}): Array<{ role: 'system' | 'user'; content: string }>;
export function parseAgentRoutingDecision(raw: string, allowedSkillIds?: string[]): AgentRoutingDecision | null;
export function routeAgentRequest(input: {
  userMessage: string;
  manifests: SkillManifest[];
  manualSkillId?: string;
  messages?: Array<{ role: 'user' | 'assistant'; content: string }>;
  hasReferenceImages?: boolean;
  referenceMetadata?: Array<{ id?: string; label?: string; role?: string; source?: string }>;
  hasPendingConfirmation?: boolean;
  routerModel?: string;
  providerId?: string;
  signal?: AbortSignal;
  chatFn?: (request: unknown) => Promise<unknown>;
}): Promise<AgentRoutingDecision>;
