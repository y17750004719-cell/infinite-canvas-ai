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
    completionSummary?: string;
    toolCallId?: string;
    toolName?: string;
    itemId?: string;
    executionId?: string;
    parentItemId?: string;
    retryability?: 'retryable' | 'requires_change' | 'unknown';
    detail?: string;
  }): AgentProgressUpdate;
  stamp(): { sequence: number; timestampMs: number; runId: string; operationId: string };
  completeItem(itemId: string): void;
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

export function startAgentImageGenerationHeartbeat(input?: {
  intervalMs?: number;
  now?: () => number;
  onPulse?: (elapsedMs: number) => void;
  setIntervalFn?: (callback: () => void, intervalMs: number) => unknown;
  clearIntervalFn?: (timer: unknown) => void;
}): () => void;
import type {
  AgentClientAction,
  AgentProgressPhase,
  AgentProgressStatus,
  AgentProgressStepId,
  AgentProgressUpdate,
} from './events';
