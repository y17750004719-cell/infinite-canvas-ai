import type { AgentPlannerReferenceContext } from './execution-planner.types';

export type MainAgentMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string | Array<
    | { type: 'text'; text: string }
    | { type: 'image_url'; image_url: { url: string } }
  >;
};

export const MAIN_AGENT_SYSTEM_PROMPT: string;
export const MAIN_AGENT_FRONT_DOOR_SYSTEM_PROMPT: string;

export type MainAgentFrontDoorResult = {
  route: 'chat' | 'vision_analysis' | 'planner';
  skillId: string | null;
  confidence: 'high' | 'medium' | 'low';
  answer: string | null;
  reason?: string;
  repairAttempted?: boolean;
};

export function buildMainAgentFrontDoorMessages(input?: {
  messages?: Array<{ role: 'user' | 'assistant'; content: string }>;
  referenceImages?: string[];
  referenceContext?: AgentPlannerReferenceContext;
  manifests?: Array<Record<string, unknown>>;
  manualSkillId?: string | null;
  pendingTask?: Record<string, unknown> | null;
}): MainAgentMessage[];

export function parseMainAgentFrontDoorResult(
  raw: string,
  allowedSkillIds?: string[],
): MainAgentFrontDoorResult | null;

export function resolveMainAgentFrontDoor(input?: {
  messages?: Array<{ role: 'user' | 'assistant'; content: string }>;
  referenceImages?: string[];
  referenceContext?: AgentPlannerReferenceContext;
  manifests?: Array<Record<string, unknown>>;
  manualSkillId?: string | null;
  pendingTask?: Record<string, unknown> | null;
  providerId?: string;
  model?: string;
  signal?: AbortSignal;
  chatFn?: (request: Record<string, unknown>) => Promise<Record<string, unknown>>;
}): Promise<MainAgentFrontDoorResult>;

export function buildMainAgentMessages(input?: {
  messages?: Array<{ role: 'user' | 'assistant'; content: string }>;
  canvasContext?: Record<string, unknown>;
  referenceImages?: string[];
  referenceContext?: AgentPlannerReferenceContext;
  resolvedBrief?: string;
  executionPlan?: Record<string, unknown>;
}): MainAgentMessage[];
