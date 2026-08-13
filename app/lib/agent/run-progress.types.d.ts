export type AgentRunStepStatus = 'active' | 'waiting' | 'completed' | 'failed';
export type AgentRunOutcome = 'running' | 'waiting' | 'completed' | 'warning' | 'failed' | 'cancelled';
export type AgentRunIntent = 'chat' | 'image' | 'skill_action';
export type AgentRunStepKind = 'status' | 'commentary' | 'tool';

export interface AgentRunProgressStep {
  stepId: string;
  activityId?: string;
  kind?: AgentRunStepKind;
  phase: string;
  status: AgentRunStepStatus;
  label: string;
  commentary?: string;
  tool?: string | { name?: string; label?: string };
  toolCallId?: string;
  toolName?: string;
  startedAt?: number;
  completedAt?: number;
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

export function getAgentProgressElapsedMs(step: AgentRunProgressStep, now?: number): number | null;

export type AgentRunProgressEvent =
  | {
      type: 'progress_update';
      runId?: string;
      operationId?: string;
      sequence?: number;
      timestampMs?: number;
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
  | { type: 'agent_cancelled' }
  | { type: 'agent_activity_delta'; activityId: string; delta: string; model?: string }
  | { type: 'agent_activity_commit'; activityId: string; disposition: 'commentary' | 'final' }
  | { type: 'confirmation_submitted'; toolName?: string }
  | { type: 'intent_resolved'; intent: 'chat' | 'image' | 'skill_action' }
  | { type: string; [key: string]: unknown };
