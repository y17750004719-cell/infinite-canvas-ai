export type AgentRunStepStatus = 'pending' | 'active' | 'waiting' | 'completed' | 'failed';
export type AgentRunOutcome = 'running' | 'waiting' | 'completed' | 'warning' | 'failed' | 'cancelled';
export type AgentRunIntent = 'chat' | 'image' | 'skill_action';
export type AgentRunStepKind = 'status' | 'tool' | 'commentary' | 'execution' | 'interaction';

export interface AgentLifecycleIdentity {
  taskId: string;
  operationId: string;
  runId: string;
  sequence: number;
  timestampMs: number;
}

/** Lifecycle events use this identity. */
export type StrictAgentLifecycleEvent =
  | (AgentLifecycleIdentity & { type: 'agent_start' })
  | (AgentLifecycleIdentity & { type: 'progress_update'; stepId?: string; phase?: string; status?: AgentRunStepStatus; label?: string; detail?: unknown })
  | (AgentLifecycleIdentity & { type: 'tool_start'; toolCallId: string; toolName: string })
  | (AgentLifecycleIdentity & { type: 'tool_update'; toolCallId: string; message: string })
  | (AgentLifecycleIdentity & { type: 'tool_result'; toolCallId: string; toolName?: string; result?: unknown; isError?: boolean })
  | (AgentLifecycleIdentity & { type: 'assistant_delta'; delta: string; channel?: 'content' | 'reasoning'; model?: string })
  | (AgentLifecycleIdentity & { type: 'agent_activity_delta'; activityId: string; delta: string; model?: string })
  | (AgentLifecycleIdentity & { type: 'agent_activity_commit'; activityId: string; disposition: 'commentary' | 'final' })
  | (AgentLifecycleIdentity & { type: 'confirmation_required'; request?: Record<string, unknown> })
  | (AgentLifecycleIdentity & { type: 'clarification_required'; request?: Record<string, unknown>; message?: string })
  | (AgentLifecycleIdentity & { type: 'agent_task_checkpoint'; taskSnapshot?: unknown })
  | (AgentLifecycleIdentity & { type: 'agent_completion_summary'; summary?: string })
  | (AgentLifecycleIdentity & { type: 'agent_done'; stopReason?: string })
  | (AgentLifecycleIdentity & { type: 'agent_error'; message?: string; retryable?: boolean; code?: 'invalid_reference' | 'invalid_tool_arguments' | 'invalid_plan' | 'terminal_contract' | 'provider_unavailable' | 'provider_http' | 'provider_timeout' | 'transport' | 'budget_exceeded' })
  | (AgentLifecycleIdentity & { type: 'agent_cancelled'; message?: string });

export type AgentItemStatus = 'in_progress' | 'waiting' | 'completed' | 'failed' | 'declined' | 'cancelled';
export type AgentItemType = 'agent_message' | 'commentary' | 'reasoning_summary' | 'tool_call' | 'skill' | 'image_generation' | 'approval' | 'clarification' | 'asset_delivery' | 'error';

export interface AgentRunProgressStep {
  stepId: string;
  sequence?: number;
  timestampMs?: number;
  lastUpdateSequence?: number;
  /** Sequence of the authoritative tool result; later progress cannot reopen it. */
  toolResultSequence?: number;
  activityId?: string;
  interactionId?: string;
  interactionType?: 'clarification' | 'confirmation';
  kind?: AgentRunStepKind;
  itemId?: string;
  turnId?: string;
  itemType?: AgentItemType;
  itemStatus?: AgentItemStatus;
  parentItemId?: string;
  commentaryItemId?: string;
  executionId?: string;
  retryability?: 'retryable' | 'requires_change' | 'unknown';
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
  taskId: string;
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
  | StrictAgentLifecycleEvent
  | { type: 'agent_start'; taskId?: string; runId?: string; operationId?: string; sequence?: number; timestampMs?: number }
  | {
      type: 'tool_start';
      toolCallId: string;
      toolName: string;
      itemId?: string;
      executionId?: string;
      parentItemId?: string;
      taskId?: string;
      runId?: string;
      operationId?: string;
      sequence?: number;
      timestampMs?: number;
    }
  | {
      type: 'tool_update';
      toolCallId: string;
      message: string;
      itemId?: string;
      executionId?: string;
      parentItemId?: string;
      taskId?: string;
      runId?: string;
      operationId?: string;
      sequence?: number;
      timestampMs?: number;
    }
  | {
      type: 'tool_result';
      toolCallId: string;
      toolName?: string;
      result?: unknown;
      isError?: boolean;
      itemId?: string;
      executionId?: string;
      parentItemId?: string;
      taskId?: string;
      retryability?: 'retryable' | 'requires_change' | 'unknown';
      runId?: string;
      operationId?: string;
      sequence?: number;
      timestampMs?: number;
    }
  | {
      type: 'progress_update';
      taskId?: string;
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
      itemId?: string;
      executionId?: string;
      parentItemId?: string;
      retryability?: 'retryable' | 'requires_change' | 'unknown';
      detail?: unknown;
    }
  | { type: 'assets_pending'; count: number; taskId?: string; operationId?: string; runId?: string; sequence?: number; timestampMs?: number; origin?: 'server' | 'client' }
  | { type: 'assets_progress'; total: number; succeeded: number; failed: number; sequence?: number; timestampMs?: number; origin?: 'server' | 'client' }
  | { type: 'assets_settled'; succeeded: number; failed: number; sequence?: number; timestampMs?: number; origin?: 'server' | 'client' }
  | { type: 'agent_completion_summary'; taskId?: string; runId?: string; operationId?: string; summary?: string; sequence?: number; timestampMs?: number }
  | { type: 'agent_done'; taskId?: string; runId?: string; operationId?: string; sequence?: number; timestampMs?: number }
  | { type: 'agent_error'; taskId?: string; runId?: string; operationId?: string; sequence?: number; timestampMs?: number; message?: string; retryable?: boolean; code?: string }
  | { type: 'agent_cancelled'; taskId?: string; runId?: string; operationId?: string; sequence?: number; timestampMs?: number }
  | { type: 'agent_activity_delta'; taskId?: string; runId?: string; operationId?: string; activityId: string; delta: string; model?: string; sequence?: number; timestampMs?: number }
  | { type: 'agent_activity_commit'; taskId?: string; runId?: string; operationId?: string; activityId: string; disposition: 'commentary' | 'final'; sequence?: number; timestampMs?: number }
  | {
      type: 'image_prompts_ready';
      index: number;
      label: string;
      prompt: string;
      promptHash?: string;
      completedLabel?: string;
      completionSummary?: string;
      toolCallId?: string;
      runId?: string;
      sequence?: number;
      timestampMs?: number;
    }
  | { type: 'interaction_submitted'; interactionId: string; interactionType: 'clarification' | 'confirmation'; label: string; sequence?: number; timestampMs?: number }
  | { type: 'confirmation_submitted'; toolName?: string; sequence?: number; timestampMs?: number }
  | { type: 'confirmation_required'; taskId?: string; runId?: string; operationId?: string; request?: { confirmationId?: string; toolName?: string; message?: string; taskId?: string; operationId?: string; expectedSequence?: number }; itemId?: string; parentItemId?: string; sequence?: number; timestampMs?: number }
  | { type: 'clarification_required'; taskId?: string; runId?: string; operationId?: string; message?: string; request?: { id?: string; taskId?: string; operationId?: string; lastSequence?: number; question?: string; toolName?: string }; itemId?: string; parentItemId?: string; sequence?: number; timestampMs?: number }
  | { type: 'intent_resolved'; intent: 'chat' | 'image' | 'skill_action' }
  | { type: 'skill_selected'; skillId: string; label: string; sequence?: number; timestampMs?: number; runId?: string }
  | { type: 'active_skill_changed'; skill: { id: string; label: string } | null; sequence?: number; timestampMs?: number; runId?: string }
  | { type: string; [key: string]: unknown };
