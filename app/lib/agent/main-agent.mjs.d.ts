export type MainAgentMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string | Array<
    | { type: 'text'; text: string }
    | { type: 'image_url'; image_url: { url: string } }
  >;
};

export const MAIN_AGENT_SYSTEM_PROMPT: string;

export function buildMainAgentMessages(input?: {
  messages?: Array<{ role: 'user' | 'assistant'; content: string }>;
  skillContent?: string;
  canvasContext?: Record<string, unknown>;
  referenceImages?: string[];
  resolvedBrief?: string;
  executionPlan?: Record<string, unknown>;
}): MainAgentMessage[];
