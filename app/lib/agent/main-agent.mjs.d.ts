import type { AgentPlannerReferenceContext } from './execution-planner.types';

export type MainAgentMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string | Array<
    | { type: 'text'; text: string }
    | { type: 'image_url'; image_url: { url: string } }
  >;
};

export const MAIN_AGENT_SYSTEM_PROMPT: string;
export const MAIN_AGENT_LOOP_SYSTEM_PROMPT: string;
export const FAILED_TASK_RECOVERY_SYSTEM_PROMPT: string;
export function buildFailedTaskRecoveryMessages(input?: Record<string, unknown>): MainAgentMessage[];

export function buildMainAgentMessages(input?: {
  messages?: Array<{ role: 'user' | 'assistant'; content: string }>;
  canvasContext?: Record<string, unknown>;
  referenceImages?: string[];
  referenceContext?: AgentPlannerReferenceContext;
  resolvedBrief?: string;
  executionPlan?: Record<string, unknown>;
}): MainAgentMessage[];

export function buildMainAgentLoopMessages(input?: {
  messages?: Array<{ role: 'user' | 'assistant'; content: string }>;
  referenceImages?: string[];
  referenceContext?: AgentPlannerReferenceContext;
  manifests?: Array<Record<string, unknown>>;
  manualSkillId?: string | null;
  lockedSkillId?: string | null;
  pendingTask?: Record<string, unknown> | null;
  recentFailedTask?: Record<string, unknown> | null;
  memory?: Record<string, unknown> | null;
  contextEntities?: Array<Record<string, unknown>>;
  canvasContext?: Record<string, unknown> | null;
  imageOptions?: Record<string, unknown> | null;
  imagePlanning?: Record<string, unknown> | null;
  agentAnalysis?: Record<string, unknown> | null;
  contextUnlocked?: boolean;
  contextScopes?: string[];
  recoveryState?: Record<string, unknown> | null;
}): MainAgentMessage[];
