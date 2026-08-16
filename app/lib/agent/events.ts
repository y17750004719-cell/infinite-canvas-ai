import type { AgentContextEntity, AgentProposal } from './context-reference.types';
import type {
  AgentExecutionPlan,
  AgentPlannerModelCandidate,
  AgentPlannerModelSelection,
  AgentTaskContract,
} from './execution-planner.types';

export type AgentIntent = 'chat' | 'image' | 'skill_action';

export type AgentConversationMemory = {
  version: 1;
  recentRawConversation: Array<{ role: 'user' | 'assistant'; content: string }>;
  rollingSummary: string;
  facts: string[];
  preferences: string[];
  activeTask: {
    status: 'idle' | 'planning' | 'awaiting_confirmation' | 'executing' | 'completed' | 'failed';
    summary: string;
    taskId?: string;
  } | null;
  recentReferencedAssetIds: string[];
  updatedAt: number;
};

export type AgentVisualSummary = {
  version: 1;
  references: Array<{
    referenceId: string;
    description: string;
    salientSubjects: string[];
    visibleText: string[];
  }>;
};

export type AgentRecoveryRecord = {
  version: 1;
  taskId: string;
  runId: string;
  topicId: string;
  sourceUserMessageId: string;
  status: 'failed' | 'cancelled';
  resumeRoute: 'main_agent' | 'image_planner' | 'local_delivery' | null;
  intent: 'chat' | 'vision_analysis' | 'image' | 'skill_action' | null;
  originalRequest: string;
  failure: {
    stage: string;
    kind: 'cancelled' | 'timeout' | 'transport' | 'upstream_http' | 'protocol' | 'validation' | 'permission' | 'resource' | 'capability' | 'unknown';
    message: string;
    retryability: 'retryable' | 'requires_change' | 'unknown';
  };
  skillId: string | null;
  imageOperation?: 'generate' | 'edit';
  targetReferenceId?: string;
  contextEntityIds: string[];
  visualReferenceIds: string[];
  visualSummary?: AgentVisualSummary;
  taskSnapshot?: AgentTaskSnapshot;
  mainAgentLoop?: {
    transcript: unknown[];
    pendingCall?: {
      id: string;
      name: string;
      args: Record<string, unknown>;
      batch?: Array<{ id: string; name: string; args: Record<string, unknown> }>;
    };
    budgets: {
      turnsUsed: number;
      toolCallsUsed: number;
      budgetedToolCallsUsed: number;
      mutationToolCallsUsed: number;
    };
    selectedSkillId?: string | null;
    skillRead?: boolean;
    contextScopes?: Array<'conversation' | 'project'>;
  };
  completedAssetCount: number;
  createdAt: number;
};

export type AgentProgressStepId =
  | 'routing'
  | 'agent_analysis'
  | 'image_operation'
  | 'image_context'
  | 'image_skill'
  | 'image_brief'
  | 'image_prompt'
  | 'image_contract'
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
  skillId: string | null;
  skillRead: boolean;
};

export type AgentClarificationOption = {
  id: string;
  label: string;
  answer: string;
  description?: string;
};

export type AgentClarificationState = {
  taskId: string;
  sourceUserMessageId?: string;
  operationId?: string;
  skillSource?: 'manual_ui' | 'explicit_text' | 'user_confirmation' | 'recovery' | 'manual' | 'auto' | null;
  skillRead?: boolean;
  lastSequence?: number;
  intent: 'chat' | 'image' | 'skill_action';
  skillId?: string;
  originalRequest: string;
  workingBrief: string;
  askedDimensions: string[];
  answers: Array<{ dimension: string; question: string; answer: string }>;
  referenceImages?: string[];
  imageOperation?: 'generate' | 'edit';
  targetReferenceId?: string;
  visualSummary?: AgentVisualSummary;
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
  plannerCandidates?: AgentPlannerModelCandidate[];
  plannerSelection?: AgentPlannerModelSelection;
  plannerFailure?: {
    reason: AgentPlannerFailureReason;
    retryMode: 'replan';
    failedAt: number;
  };
  recoveryRecord?: AgentRecoveryRecord;
  recoveryMode?: 'fill_missing' | 'redo_all';
  mainAgentLoop?: {
    transcript: unknown[];
    pendingCall?: {
      id: string;
      name: string;
      args: Record<string, unknown>;
      batch?: Array<{ id: string; name: string; args: Record<string, unknown> }>;
    };
    budgets: {
      turnsUsed: number;
      toolCallsUsed: number;
      budgetedToolCallsUsed: number;
      mutationToolCallsUsed: number;
    };
    memoryPatches?: Record<string, unknown>[];
    selectedSkillId?: string | null;
    skillRead?: boolean;
    contextScopes?: Array<'conversation' | 'project'>;
  };
  agentAnalysis?: AgentAnalysisSnapshot;
  imagePlanning?: AgentImagePlanningSnapshot;
};

export type AgentClarificationRequest = {
  id: string;
  taskId: string;
  question: string;
  dimension: string;
  options: AgentClarificationOption[];
  allowCustom: boolean;
  allowProceed: boolean;
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
  sourceTaskId?: string;
  sourceVersionId?: string;
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

export type AgentImagePlanningStage =
  | 'routing'
  | 'image_planner'
  | 'execution';

export type AgentImagePlanningSnapshot = {
  version: 4;
  taskId: string;
  runId: string;
  sourceUserMessageId: string;
  originalRequest: string;
  resolvedRequirement: string | null;
  revision: number;
  currentStage: AgentImagePlanningStage;
  stages: Record<string, {
    status: 'pending' | 'in_progress' | 'completed' | 'awaiting_input' | 'failed' | 'skipped';
    repairCount: number;
    completedAt?: number;
  }>;
  decision: 'chat' | 'generate' | 'edit' | null;
  operation: 'generate' | 'edit' | null;
  targetReferenceId: string | null;
  referenceIds: string[];
  contextEntityIds: string[];
  outputCount: number;
  aspectRatio: string;
  promptFormat: 'text' | 'json-text';
  deliveryMode: 'single' | 'variants' | 'series' | 'composite' | null;
  panelCount: number | null;
  skill: {
    id: string;
    source: 'manual_ui' | 'explicit_text' | 'user_confirmation' | 'recovery';
    read: boolean;
    contentHash?: string;
    manifest: {
      executionMode?: 'agent_loop' | 'image_pipeline';
      promptStyle?: 'text' | 'json-text';
      aspectRatio?: string;
      allowedTools: string[];
      planningGuidance?: string;
      generationContract?: string;
    };
  } | null;
  imagegenContext: {
    host: { id: 'imagegen'; contentHash: string };
    visualSkill: { id: string; contentHash: string } | null;
  } | null;
  executionPlan?: Record<string, unknown> | null;
  abandonedAt: number | null;
  failure: {
    stage: AgentImagePlanningStage;
    kind: string;
    message: string;
    failedAt: number;
  } | null;
};

export type AgentAnalysisCheckpoint = {
  objective: string;
  currentUnderstanding: {
    goal: string;
    expectedResult: string;
    domain: 'chat' | 'image' | 'skill_action' | 'other';
  };
  evidence: Array<{ sourceId: string; conclusion: string }>;
  workingAssumptions: Array<{
    id: string;
    statement: string;
    confidence: 'high' | 'medium' | 'low';
  }>;
  constraints: string[];
  unresolvedQuestions: Array<{
    dimension: string;
    reason: string;
    resolvableBy: 'analysis' | 'context' | 'user';
  }>;
  nextFocus: string;
};

export type AgentAnalysisSnapshot = {
  version: 1;
  taskId: string;
  runId: string;
  originalRequest: string;
  status: 'analyzing' | 'awaiting_input' | 'ready' | 'failed' | 'abandoned';
  checkpointCount: number;
  currentObjective: string | null;
  lockedFacts: {
    uiMode: 'agent' | 'image' | 'chat';
    selectedSkillId: string | null;
    explicitReferenceIds: string[];
    userDecisions: Array<{ dimension: string; answer: string }>;
    operation?: 'generate' | 'edit';
  };
  workingState: {
    currentUnderstanding: AgentAnalysisCheckpoint['currentUnderstanding'] | null;
    evidence: AgentAnalysisCheckpoint['evidence'];
    assumptions: AgentAnalysisCheckpoint['workingAssumptions'];
    constraints: string[];
    unresolvedQuestions: AgentAnalysisCheckpoint['unresolvedQuestions'];
    nextFocus: string | null;
  };
  checkpoints: Array<AgentAnalysisCheckpoint & { index: number }>;
  repairCount: number;
};

export type AgentTaskSnapshot = {
  topicId: string;
  taskId: string;
  contractVersion: number;
  contract?: AgentTaskContract;
  agentAnalysis?: AgentAnalysisSnapshot;
  imagePlanning?: AgentImagePlanningSnapshot;
  editBaseVersionId?: string | null;
  latestBatchId?: string | null;
  activeVersions: Array<{
    referenceId: string;
    batchId: string;
    slotId: string;
    versionId: string;
    assetUrl?: string;
    plannerPreviewSrc?: string;
    naturalWidth?: number;
    naturalHeight?: number;
    model?: string;
    itemId?: string;
    index?: number;
    label?: string;
    promptTrace?: AgentPromptTrace;
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

export type AgentActivityDelta = {
  type: 'agent_activity_delta';
  activityId: string;
  delta: string;
  model?: string;
};

export type AgentActivityCommit = {
  type: 'agent_activity_commit';
  activityId: string;
  disposition: 'commentary' | 'final';
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
  | { type: 'skill_selected'; skillId: string; label: string; source: 'manual_ui' | 'explicit_text' | 'user_confirmation' | 'recovery' | 'manual' | 'auto' }
  | { type: 'active_skill_changed'; skill: { id: string; label: string } | null }
  | {
      type: 'image_parameters_locked';
      parameters: {
        outputCount: number;
        aspectRatio: string;
        deliveryMode: 'single' | 'variants' | 'series' | 'composite';
        panelCount?: number;
      };
    }
  | {
      type: 'clarification_required';
      message: string;
      request: AgentClarificationRequest;
      state: AgentClarificationState;
    }
  | { type: 'prompt_optimization_start' }
  | { type: 'prompt_optimization_done'; summary: string; optimized: boolean }
  | {
      type: 'image_prompts_ready';
      index: number;
      label: string;
      prompt: string;
      compilation?: {
        skillId: string | null;
        skillLabel: string | null;
        skillRead: boolean;
        plannerProviderId: string | null;
        plannerModel: string;
        referenceCount: number;
        visualReferencesUsed: boolean;
        durationMs: number;
        compiledAt: number;
      };
    }
  | { type: 'tool_start'; toolCallId: string; toolName: string }
  | { type: 'tool_update'; toolCallId: string; message: string }
  | { type: 'tool_result'; toolCallId: string; result: unknown }
  | AgentActivityDelta
  | AgentActivityCommit
  | { type: 'assistant_delta'; delta: string; channel?: 'content' | 'reasoning'; model?: string }
  | { type: 'agent_memory_updated'; memory: AgentConversationMemory }
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
  | { type: 'agent_task_checkpoint'; taskSnapshot: AgentTaskSnapshot }
  | { type: 'agent_done'; stopReason: string; taskSnapshot?: AgentTaskSnapshot }
  | {
      type: 'agent_error';
      stage: string;
      message: string;
      reason?: AgentPlannerFailureReason;
      retryable?: boolean;
      recoveryRecord?: AgentRecoveryRecord;
    };
