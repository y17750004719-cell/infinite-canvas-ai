import type { AgentReferenceContext } from './context-reference.types';

export type MainAgentMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string | Array<
    | { type: 'text'; text: string }
    | { type: 'image_url'; image_url: { url: string } }
  >;
};

export const MAIN_AGENT_SKILL_BYTE_BUDGET: number;
export function boundSkillContent(content: string, maxBytes?: number): {
  content: string;
  originalBytes: number;
  injectedBytes: number;
  truncated: boolean;
};

export const MAIN_AGENT_SYSTEM_PROMPT: string;
export const MAIN_AGENT_LOOP_SYSTEM_PROMPT: string;
export const FAILED_TASK_RECOVERY_SYSTEM_PROMPT: string;
export function buildFailedTaskRecoveryMessages(input?: Record<string, unknown>): MainAgentMessage[];

export function buildMainAgentMessages(input?: {
  messages?: Array<{ role: 'user' | 'assistant'; content: string }>;
  canvasContext?: Record<string, unknown>;
  referenceImages?: string[];
  referenceContext?: AgentReferenceContext;
  resolvedBrief?: string;
  lockedSkillId?: string | null;
  skillContent?: string;
  imagegenHostContent?: string;
  imagegenHostPath?: string;
  skillPath?: string;
  manifests?: Array<Record<string, unknown>>;
}): MainAgentMessage[];

export function buildMainAgentLoopMessages(input?: {
  messages?: Array<{ role: 'user' | 'assistant'; content: string }>;
  referenceImages?: string[];
  referenceContext?: AgentReferenceContext;
  manifests?: Array<Record<string, unknown>>;
  manualSkillId?: string | null;
  lockedSkillId?: string | null;
  skillContent?: string;
  imagegenHostContent?: string;
  imagegenHostPath?: string;
  skillPath?: string;
  pendingTask?: Record<string, unknown> | null;
  recentFailedTask?: Record<string, unknown> | null;
  memory?: Record<string, unknown> | null;
  contextEntities?: Array<Record<string, unknown>>;
  canvasContext?: Record<string, unknown> | null;
  imageOptions?: Record<string, unknown> | null;
  agentAnalysis?: Record<string, unknown> | null;
  contextUnlocked?: boolean;
  contextScopes?: string[];
  recoveryState?: Record<string, unknown> | null;
}): MainAgentMessage[];
