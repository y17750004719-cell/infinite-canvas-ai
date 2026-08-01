import type { AgentContextEntity, AgentProposal } from './context-reference.types';
import type { AgentExecutionPlan, AgentTaskContract } from './execution-planner.types';

export type AgentIntent = 'chat' | 'image' | 'skill_action';

export type AgentProgressStepId =
  | 'routing'
  | 'context_resolution'
  | 'clarification'
  | 'skill_loading'
  | 'prompt_optimization'
  | 'generate_image'
  | 'canvas_context'
  | 'skill_job'
  | 'tool'
  | 'composing';

export type AgentProgressPhase =
  | 'routing'
  | 'resolving'
  | 'resuming'
  | 'analyzing'
  | 'waiting_input'
  | 'loading'
  | 'optimizing'
  | 'generating'
  | 'reading'
  | 'starting'
  | 'checking'
  | 'executing'
  | 'planning'
  | 'responding';

export type AgentProgressStatus = 'active' | 'waiting' | 'completed' | 'failed';

export type AgentPlannerFailureReason =
  | 'timeout'
  | 'transport'
  | 'invalid_reference'
  | 'invalid_context'
  | 'invalid_plan'
  | 'vision_unsupported'
  | 'vision_unavailable';

export type AgentPromptTrace = {
  sourcePrompt: string;
  finalPrompt: string;
  optimized: boolean;
  operation: 'generate' | 'edit';
  targetReferenceId: string | null;
};

export type AgentClarificationOption = {
  id: string;
  label: string;
  answer: string;
  description?: string;
};

export type AgentClarificationState = {
  taskId: string;
  operationId?: string;
  skillSource?: 'manual' | 'auto' | null;
  lastSequence?: number;
  intent: 'image' | 'skill_action';
  skillId?: string;
  originalRequest: string;
  workingBrief: string;
  askedDimensions: string[];
  answers: Array<{ dimension: string; question: string; answer: string }>;
  referenceImages?: string[];
  referenceContext?: {
    references: Array<{
      id: string;
      src: string;
      label: string;
      source: 'upload' | 'history' | 'canvas';
      canvasItemId?: string;
      role: 'reference' | 'edit_target' | 'annotation_bundle' | 'region_target';
      annotationCount?: number;
      regionId?: string;
      candidateId?: string;
      confirmationStatus?: 'pending' | 'confirmed';
      aliases?: string[];
      description?: string;
      confidence?: 'high' | 'medium' | 'low';
      targetPoint?: { x: number; y: number };
      targetBox?: { x: number; y: number; width: number; height: number };
    }>;
    composerSegments: Array<
      | { type: 'text'; text: string }
      | { type: 'reference'; referenceId: string }
    >;
    evidenceImages?: Array<{
      id: string;
      referenceId: string;
      src: string;
      kind: 'annotation_composite' | 'region_crop';
    }>;
  };
  contextCandidates?: AgentContextEntity[];
  resolvedImageCount?: number;
  resolvedImageCountSource?: 'clarification' | 'prompt' | 'interface' | 'default' | 'batch';
  requestedImageCountTotal?: number;
  pendingImageCountCandidates?: number[];
  resolvedImageDeliveryMode?: 'variants' | 'series' | 'composite';
  resolvedImagePanelCount?: number;
  imageBatchPlan?: {
    totalCount: number;
    completedCount: number;
    remainingCount: number;
    batchSize: number;
  };
  executionPlan?: AgentExecutionPlan;
  plannerFailure?: {
    reason: AgentPlannerFailureReason;
    retryMode: 'replan';
    failedAt: number;
  };
};

export type AgentClarificationRequest = {
  id: string;
  taskId: string;
  question: string;
  dimension: string;
  options: AgentClarificationOption[];
  allowCustom: true;
  allowProceed: true;
  failed?: boolean;
};

export type AgentClientAction = {
  type: 'add_generated_assets';
  runId: string;
  model?: string;
  providerId?: string;
  taskId?: string;
  contractVersion?: number;
  batchId?: string;
  sourceReferenceId?: string;
  presentation?: {
    title: string;
    summary: string;
    operation: 'generate' | 'edit';
  };
  assets: Array<{
    src: string;
    naturalWidth?: number;
    naturalHeight?: number;
    model?: string;
    itemId?: string;
    index?: number;
    label?: string;
    promptTrace?: AgentPromptTrace;
    slotId?: string;
    versionId?: string;
    parentVersionId?: string;
    plannerPreviewSrc?: string;
  }>;
  batch?: { total: number; settled: number; succeeded: number; failed: number };
};

export type AgentTaskSnapshot = {
  topicId: string;
  taskId: string;
  contractVersion: number;
  contract: AgentTaskContract;
  editBaseVersionId?: string | null;
  latestBatchId?: string | null;
  activeVersions: Array<{
    referenceId: string;
    batchId: string;
    slotId: string;
    versionId: string;
  }>;
};

export type AgentProgressUpdate = {
  type: 'progress_update';
  version: 1;
  runId: string;
  operationId: string;
  sequence: number;
  timestampMs?: number;
  stepId: AgentProgressStepId;
  phase: AgentProgressPhase;
  status: AgentProgressStatus;
  label: string;
  toolCallId?: string;
  toolName?: string;
};

export type AgentEvent =
  | { type: 'agent_start'; runId: string }
  | AgentProgressUpdate
  | { type: 'routing_start' }
  | { type: 'intent_resolved'; intent: AgentIntent }
  | { type: 'proposal_presented'; proposal: AgentProposal }
  | {
      type: 'context_resolved';
      status: 'resolved';
      confidence: 'high' | 'medium';
      entityIds: string[];
      labels: string[];
      kind: string;
    }
  | { type: 'brief_compiled'; resolvedEntityIds: string[]; summary: string; mustPreserveCount: number }
  | { type: 'skill_selected'; skillId: string; label: string; source: 'manual' | 'auto' }
  | {
      type: 'clarification_required';
      message: string;
      request: AgentClarificationRequest;
      state: AgentClarificationState;
    }
  | { type: 'prompt_optimization_start' }
  | { type: 'prompt_optimization_done'; summary: string; optimized: boolean }
  | { type: 'tool_start'; toolCallId: string; toolName: string }
  | { type: 'tool_update'; toolCallId: string; message: string }
  | { type: 'tool_result'; toolCallId: string; result: unknown }
  | { type: 'assistant_delta'; delta: string; channel?: 'content' | 'reasoning'; model?: string }
  | { type: 'client_action'; action: AgentClientAction }
  | {
      type: 'agent_completion_summary';
      runId: string;
      title: string;
      summary: string;
      operation: 'generate' | 'edit';
      succeeded: number;
      failed: number;
      addedToCanvas: boolean;
    }
  | { type: 'confirmation_required'; request: { confirmationId: string; toolName: string; message: string } }
  | { type: 'agent_done'; stopReason: string; taskSnapshot?: AgentTaskSnapshot }
  | {
      type: 'agent_error';
      stage: string;
      message: string;
      reason?: AgentPlannerFailureReason;
      retryable?: boolean;
    };
