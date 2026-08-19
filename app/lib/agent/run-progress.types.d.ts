export type AgentRunStepStatus = 'pending' | 'active' | 'waiting' | 'completed' | 'failed';
export type AgentRunOutcome = 'running' | 'waiting' | 'completed' | 'warning' | 'failed' | 'cancelled';
export type AgentRunIntent = 'chat' | 'image' | 'skill_action';
export type AgentRunStepKind = 'status' | 'tool' | 'commentary' | 'execution' | 'interaction';

export interface AgentRunProgressStep {
  stepId: string;
  sequence?: number;
  timestampMs?: number;
  lastUpdateSequence?: number;
  activityId?: string;
  interactionId?: string;
  interactionType?: 'clarification' | 'confirmation';
  kind?: AgentRunStepKind;
  phase: string;
  status: AgentRunStepStatus;
  label: string;
  commentary?: string;
  completionSummary?: string;
  tool?: string | { name?: string; label?: string };
  toolCallId?: string;
  toolName?: string;
  detail?: unknown;
  startedAt?: number;
  completedAt?: number;
  runId?: string;
}

export interface AgentRunAttempt {
  runId: string;
  startedAt: number;
  endedAt?: number;
}

export interface AgentRunProgress {
  timelineVersion?: 2;
  runId: string;
  operationId: string;
  intent: AgentRunIntent | null;
  lastSequence: number;
  runStartedAt?: number;
  runEndedAt?: number;
  attempts?: AgentRunAttempt[];
  steps: AgentRunProgressStep[];
  agentDone: boolean;
  terminalFailed: boolean;
  terminalCancelled?: boolean;
  assets: {
    expected: number;
    settled: number;
    succeeded: number;
    failed: number;
  };
  outcome: AgentRunOutcome;
}

export function getAgentProgressElapsedMs(step: AgentRunProgressStep, now?: number): number | null;
export function getAgentRunElapsedMs(progress: AgentRunProgress, now?: number): number;

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
      completionSummary?: string;
      toolCallId?: string;
      toolName?: string;
      detail?: unknown;
    }
  | { type: 'assets_pending'; count: number; sequence?: number; timestampMs?: number }
  | { type: 'assets_progress'; total: number; succeeded: number; failed: number; sequence?: number; timestampMs?: number }
  | { type: 'assets_settled'; succeeded: number; failed: number; sequence?: number; timestampMs?: number }
  | { type: 'agent_done'; runId?: string; sequence?: number; timestampMs?: number }
  | { type: 'agent_error'; runId?: string; sequence?: number; timestampMs?: number }
  | { type: 'agent_cancelled'; runId?: string; sequence?: number; timestampMs?: number }
  | { type: 'agent_activity_delta'; runId?: string; activityId: string; delta: string; model?: string; sequence?: number; timestampMs?: number }
  | { type: 'agent_activity_commit'; runId?: string; activityId: string; disposition: 'commentary' | 'final'; sequence?: number; timestampMs?: number }
  | {
      type: 'image_prompts_ready';
      index: number;
      label: string;
      prompt: string;
      completedLabel?: string;
      completionSummary?: string;
      toolCallId?: string;
      runId?: string;
      sequence?: number;
      timestampMs?: number;
    }
  | { type: 'interaction_submitted'; interactionId: string; interactionType: 'clarification' | 'confirmation'; label: string; sequence?: number; timestampMs?: number }
  | { type: 'confirmation_submitted'; toolName?: string; sequence?: number; timestampMs?: number }
  | { type: 'confirmation_required'; request?: { confirmationId?: string; toolName?: string; message?: string }; sequence?: number; timestampMs?: number }
  | { type: 'clarification_required'; message?: string; request?: { id?: string; question?: string; toolName?: string }; sequence?: number; timestampMs?: number }
  | { type: 'intent_resolved'; intent: 'chat' | 'image' | 'skill_action' }
  | { type: string; [key: string]: unknown };
