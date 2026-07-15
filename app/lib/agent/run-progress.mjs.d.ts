export type AgentRunStepStatus = 'active' | 'waiting' | 'completed' | 'failed';
export type AgentRunOutcome = 'running' | 'waiting' | 'completed' | 'warning' | 'failed';
export type AgentRunIntent = 'chat' | 'image' | 'skill_action';

export interface AgentRunProgressStep {
  stepId: string;
  phase: string;
  status: AgentRunStepStatus;
  label: string;
  toolCallId?: string;
  toolName?: string;
}

export interface AgentRunProgress {
  runId: string;
  operationId: string;
  intent: AgentRunIntent | null;
  lastSequence: number;
  steps: AgentRunProgressStep[];
  agentDone: boolean;
  assets: {
    expected: number;
    settled: number;
    succeeded: number;
    failed: number;
  };
  outcome: AgentRunOutcome;
}

export type AgentRunProgressEvent =
  | {
      type: 'progress_update';
      runId?: string;
      operationId?: string;
      sequence?: number;
      stepId?: string;
      phase?: string;
      status?: AgentRunStepStatus;
      label?: string;
      toolCallId?: string;
      toolName?: string;
    }
  | { type: 'assets_pending'; count: number }
  | { type: 'assets_progress'; total: number; succeeded: number; failed: number }
  | { type: 'assets_settled'; succeeded: number; failed: number }
  | { type: 'agent_done' }
  | { type: 'agent_error' }
  | { type: 'intent_resolved'; intent: 'chat' | 'image' | 'skill_action' }
  | { type: string; [key: string]: unknown };

export function createInitialAgentRunProgress(runId: string): AgentRunProgress;

export function reduceAgentRunProgress(
  state: AgentRunProgress | null | undefined,
  event: AgentRunProgressEvent,
): AgentRunProgress | null;

export function shouldShowAgentRunProgress(state: AgentRunProgress | null | undefined): boolean;
