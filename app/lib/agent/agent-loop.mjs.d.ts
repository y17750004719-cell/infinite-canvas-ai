export interface AgentLoopResult {
  content: string;
  reasoningContent: string;
  turns: number;
  toolCalls: number;
  mutationToolCalls: number;
  stopReason: 'completed' | 'confirmation_required' | 'execution_required';
  confirmation?: Record<string, unknown>;
}

export function runAgentLoop(input: {
  messages: unknown[];
  tools: unknown[];
  modelFn: (request: { messages: unknown[]; tools: unknown[] }) => Promise<unknown>;
  executeTool: (name: string, args: Record<string, unknown>, context: { toolCallId: string }) => Promise<unknown>;
  isReadOnlyTool?: (name: string) => boolean;
  requireMutationTool?: boolean;
  maxTurns?: number;
  maxToolCalls?: number;
  onToolStart?: (event: { id: string; name: string; args: Record<string, unknown> }) => void | Promise<void>;
  onToolResult?: (event: { id: string; name: string; result: unknown }) => void | Promise<void>;
  serializeToolResultForModel?: (name: string, result: unknown) => unknown | Promise<unknown>;
  serializeToolResultForPublic?: (name: string, result: unknown) => unknown | Promise<unknown>;
}): Promise<AgentLoopResult>;

export function createAgentToolResultViews(toolName: string, rawResult: unknown): {
  modelResult: Record<string, unknown>;
  publicResult: Record<string, unknown>;
};

export function createAgentProgressTracker(input: {
  runId: string;
  operationId?: string;
  lastSequence?: number;
  emit?: (event: AgentProgressUpdate) => void;
}): {
  update(input: {
    stepId: AgentProgressStepId;
    phase: AgentProgressPhase;
    status: AgentProgressStatus;
    label: string;
    toolCallId?: string;
    toolName?: string;
  }): AgentProgressUpdate;
  resume(input: { operationId?: string; lastSequence?: number }): void;
  settleActive(status?: Exclude<AgentProgressStatus, 'active'>, label?: string): void;
  snapshot(): { operationId: string; lastSequence: number };
};

export function createAgentToolResultEvents(input: {
  source?: 'direct' | 'loop' | 'confirmed';
  runId: string;
  toolCallId: string;
  toolName: string;
  rawResult: unknown;
  includeAssets?: boolean;
}): Array<
  | { type: 'tool_result'; toolCallId: string; result: Record<string, unknown> }
  | { type: 'client_action'; action: AgentClientAction }
>;
import type {
  AgentClientAction,
  AgentProgressPhase,
  AgentProgressStatus,
  AgentProgressStepId,
  AgentProgressUpdate,
} from './events';
