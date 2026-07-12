import type { SkillManifest } from './skill-registry.mjs';

export interface AgentRoutingDecision {
  version: 1;
  intent: 'chat' | 'image' | 'skill_action';
  skillId: string | null;
  confidence: number;
  needsClarification: boolean;
  clarificationQuestion?: string;
  source?: 'manual' | 'auto' | 'none';
}

export interface SkillCandidateSummary {
  id: string;
  name: string;
  description: string;
  triggerHints: string[];
}

export function filterSkillCandidates(userMessage: string, manifests: SkillManifest[], limit?: number): SkillCandidateSummary[];
export function buildSkillRouterMessages(input: {
  userMessage: string;
  candidates: SkillCandidateSummary[];
  hasReferenceImages?: boolean;
}): Array<{ role: 'system' | 'user'; content: string }>;
export function parseAgentRoutingDecision(raw: string, allowedSkillIds: string[]): AgentRoutingDecision | null;
export function routeAgentRequest(input: {
  userMessage: string;
  manifests: SkillManifest[];
  manualSkillId?: string;
  hasReferenceImages?: boolean;
  routerModel?: string;
  providerId?: string;
  signal?: AbortSignal;
  chatFn?: (request: unknown) => Promise<unknown>;
}): Promise<AgentRoutingDecision>;
