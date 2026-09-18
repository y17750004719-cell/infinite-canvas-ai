import type { AgentContextEntity, AgentProposal } from './context-reference.types';

export type AgentIntent = 'chat' | 'image' | 'skill_action';

export type AgentLifecycleIdentity = {
  threadId?: string;
  turnId?: string;
  taskId: string;
  operationId: string;
  runId: string;
  sequence: number;
  timestampMs: number;
};

export type CodexLifecycleEventType =
  | 'thread.started'
  | 'turn.started'
  | 'item.started'
  | 'item.updated'
  | 'item.completed'
  | 'turn.completed'
  | 'turn.failed'
  | 'error';

export type AgentUsage = {
  inputTokens: number | null;
  cachedInputTokens: number | null;
  outputTokens: number | null;
  reasoningOutputTokens: number | null;
  totalTokens: number | null;
  durationMs: number | null;
};

export type AgentConflictCode = 'stale_operation' | 'stale_sequence' | 'agent_run_settled' | 'invalid_identity';

export type AgentItemStatus =
  | 'in_progress'
  | 'waiting'
  | 'completed'
  | 'failed'
  | 'declined'
  | 'cancelled';

export type AgentItemType =
  | 'agent_message'
  | 'commentary'
  | 'reasoning_summary'
  | 'tool_call'
  | 'skill'
  | 'image_generation'
  | 'approval'
  | 'clarification'
  | 'asset_delivery'
  | 'error';

export type AgentItem = {
  itemId: string;
  turnId: string;
  type: AgentItemType;
  status: AgentItemStatus;
  sequence: number;
  parentItemId?: string;
  commentaryItemId?: string;
  toolCallId?: string;
  executionId?: string;
  title: string;
  summary?: string;
  detail?: string;
  startedAt?: number;
  completedAt?: number;
  retryability?: 'retryable' | 'requires_change' | 'unknown';
  providerMetadata?: {
    provider: string;
    sourceModel?: string;
    providerCallId?: string;
  };
};

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
  operationId?: string;
  lastSequence?: number;
  sessionId: string;
  sourceUserMessageId: string;
  status: 'failed' | 'cancelled';
  resumeRoute: 'main_agent' | 'local_delivery' | null;
  intent: 'chat' | 'vision_analysis' | 'image' | 'skill_action' | null;
  originalRequest: string;
  failure: {
    stage: string;
    kind: 'cancelled' | 'timeout' | 'transport' | 'upstream_http' | 'protocol' | 'validation' | 'permission' | 'resource' | 'capability' | 'unknown';
    message: string;
    retryability: 'retryable' | 'requires_change' | 'unknown';
  };
  skillId: string | null;
  skillContentHash?: string | null;
  imageOperation?: 'generate' | 'edit';
  assetId?: string;
  targetReferenceId?: string;
  contextEntityIds: string[];
  visualReferenceIds: string[];
  referenceContext?: {
    references: Array<{
      id: string;
      src: string;
      assetId?: string;
      originalSrc?: string;
      previewSrc?: string;
      label: string;
      source: 'upload' | 'history' | 'canvas';
      role: 'reference' | 'edit_target' | 'annotation_bundle' | 'region_target';
      canvasItemId?: string;
      regionId?: string;
      candidateId?: string;
      confirmationStatus?: 'pending' | 'confirmed';
      sourceTaskId?: string;
      sourceVersionId?: string;
      targetPoint?: { x: number; y: number };
      targetBox?: { x: number; y: number; width: number; height: number };
    }>;
    composerSegments: Array<{ type: 'text'; text: string } | { type: 'reference'; referenceId: string }>;
    evidenceImages?: Array<{ id: string; referenceId: string; src: string; kind: 'annotation_composite' | 'region_crop' }>;
  };
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
  toolCalls?: Array<{
    callId: string;
    attemptId: string;
    taskId: string;
    toolName: string;
    status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
    resultRef?: string | null;
    startedAt?: number;
    completedAt?: number;
  }>;
  completedAssetCount: number;
  createdAt: number;
};

export type AgentProgressStepId =
  | 'routing'
  | 'agent_analysis'
  | 'image_operation'
  | 'image_context'
  | 'image_skill'
  | 'image_prompt'
  | 'image_contract'
  | 'context_resolution'
  | 'clarification'
  | 'skill_loading'
  | 'generate_image'
  | 'canvas_context'
  | 'tool'
  | 'composing';

export type AgentProgressPhase =
  | 'routing'
  | 'resolving'
  | 'resuming'
  | 'analyzing'
  | 'waiting_input'
  | 'loading'
  | 'generating'
  | 'reading'
  | 'starting'
  | 'checking'
  | 'executing'
  | 'responding';

export type AgentProgressStatus = 'pending' | 'active' | 'waiting' | 'completed' | 'failed';

export type AgentPromptTrace = {
  sourcePrompt: string;
  finalPrompt: string;
  sourcePromptHash?: string;
  finalPromptHash?: string;
  supplierPromptHash?: string;
  optimized: boolean;
  operation: 'generate' | 'edit';
  targetReferenceId: string | null;
  skillId: string | null;
  skillRead: boolean;
};

export type AgentClarificationOption = {
  id: string;
  label: string;
  completionSummary?: string;
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
  skillContentHash?: string;
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
      assetId?: string;
      originalSrc?: string;
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
};

export type AgentClarificationRequest = {
  id: string;
  taskId: string;
  operationId?: string;
  lastSequence?: number;
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
  deliveryEventAt?: number;
  presentation?: {
    title: string;
    summary: string;
    operation: 'generate' | 'edit';
  };
  assets: Array<{
    src: string;
    assetId?: string;
    deliveryId?: string;
    originalSrc?: string;
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
    previewSrc?: string;
    providerReturnedAt?: number;
    locallyStoredAt?: number;
    deliveryEventAt?: number;
  }>;
  batch?: { total: number; settled: number; succeeded: number; failed: number };
} | {
  type: 'update_context_window';
  sessionId: string;
  compactedWindows: Array<Record<string, unknown>>;
  historyRevision?: number;
  userMessageRevision?: number;
  activeWindowRevision?: number;
  modelEvents?: Array<Record<string, unknown>>;
  activeContextWindow: {
    sessionId: string;
    startSequence: number;
    endSequence: number;
    compactCount: number;
    summaryVersion: number;
    estimatedTokens: number;
    model: string;
    contextWindow: number;
  };
} | {
  type: 'register_topic_visual_assets' | 'register_session_visual_assets';
  topicId?: string;
  sessionId?: string;
  assets: Array<{
    id: string;
    sessionId?: string;
    topicId?: string;
    durableSrc: string;
    previewSrc?: string;
    originalSrc?: string;
    contentHash: string;
    mimeType: string;
    byteSize: number;
    source: 'upload' | 'canvas' | 'generated';
    sourceReferenceId?: string;
    taskId?: string;
    batchId?: string;
    versionId?: string;
    createdAt: number;
  }>;
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
  sessionId: string;
  taskId: string;
  /** Operation identity is included in every current checkpoint. */
  operationId?: string;
  lastSequence?: number;
  contractVersion: number;
  contract?: any;
  agentAnalysis?: AgentAnalysisSnapshot;
  editBaseVersionId?: string | null;
  latestBatchId?: string | null;
  activeVersions: Array<{
    referenceId: string;
    batchId: string;
    slotId: string;
    versionId: string;
    assetUrl?: string;
    previewSrc?: string;
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
  taskId: string;
  type: 'progress_update';
  version: 1;
  runId: string;
  operationId: string;
  sequence: number;
  timestampMs: number;
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
  action?: string;
  agentTurnId?: string;
  parentTurnId?: string;
  modelSampleIndex?: number;
  nextSampleReason?: string;
  retryAttempt?: number;
  failureStage?: string;
  failureCode?: string;
};

export type AgentActivityDelta = {
  taskId: string;
  runId: string;
  operationId: string;
  sequence: number;
  timestampMs: number;
  type: 'agent_activity_delta';
  activityId: string;
  delta: string;
  model?: string;
};

export type AgentActivityCommit = {
  taskId: string;
  runId: string;
  operationId: string;
  sequence: number;
  timestampMs: number;
  type: 'agent_activity_commit';
  activityId: string;
  disposition: 'commentary' | 'final';
  commentaryKind?: 'model_task_description' | 'fallback' | 'result_summary';
};

export type AgentEvent =
  | {
      type: 'context_event';
      event: {
        eventId: string;
        sessionId: string;
        sequence: number;
        type: string;
        source: string;
        [key: string]: unknown;
      };
    }
  | (AgentLifecycleIdentity & { type: 'agent_start' })
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
      taskId: string;
      runId: string;
      operationId: string;
      itemId?: string;
      parentItemId?: string;
      sequence: number;
      timestampMs: number;
    }
  | {
      type: 'image_prompts_ready';
      index: number;
      label: string;
      prompt: string;
      promptHash?: string;
      completedLabel?: string;
      completionSummary?: string;
      toolCallId?: string;
      sequence?: number;
      timestampMs?: number;
    }
  | (AgentLifecycleIdentity & { type: 'tool_start'; toolCallId: string; toolName: string; itemId?: string; executionId?: string; parentItemId?: string; agentTurnId?: string; parentTurnId?: string; modelSampleIndex?: number; toolCallIndex?: number; toolCallsInTurn?: number; skipped?: boolean; nextSampleReason?: string })
  | (AgentLifecycleIdentity & { type: 'tool_update'; toolCallId: string; message: string; itemId?: string; executionId?: string; parentItemId?: string })
  | (AgentLifecycleIdentity & { type: 'tool_result'; toolCallId: string; toolName?: string; result: unknown; isError?: boolean; itemId?: string; executionId?: string; parentItemId?: string; retryability?: 'retryable' | 'requires_change' | 'unknown' })
  | AgentActivityDelta
  | AgentActivityCommit
  | (AgentLifecycleIdentity & { type: 'assistant_delta'; delta: string; channel?: 'content' | 'reasoning'; model?: string })
  | { type: 'agent_memory_updated'; memory: AgentConversationMemory }
  | { type: 'client_action'; action: AgentClientAction }
  | {
      type: 'agent_completion_summary';
      taskId: string;
      runId: string;
      operationId: string;
      sequence: number;
      timestampMs: number;
      title: string;
      summary: string;
      operation: 'generate' | 'edit';
      succeeded: number;
      failed: number;
      addedToCanvas: boolean;
    }
  | (AgentLifecycleIdentity & { type: 'confirmation_required'; request: { confirmationId: string; toolName: string; message: string; taskId: string; operationId: string; expectedSequence: number }; itemId?: string; parentItemId?: string })
  | (AgentLifecycleIdentity & { type: 'agent_task_checkpoint'; taskSnapshot: AgentTaskSnapshot })
  | (AgentLifecycleIdentity & { type: 'agent_done'; stopReason: string; taskSnapshot?: AgentTaskSnapshot })
  | {
      type: 'agent_error';
      taskId: string;
      runId: string;
      operationId: string;
      sequence: number;
      timestampMs: number;
      stage: string;
      providerId?: string | null;
      model?: string | null;
      message: string;
      code?: 'invalid_reference' | 'invalid_tool_arguments' | 'invalid_plan' | 'terminal_contract' | 'provider_unavailable' | 'provider_http' | 'provider_timeout' | 'transport' | 'budget_exceeded';
      reason?: string;
      retryable?: boolean;
      recoveryRecord?: AgentRecoveryRecord;
    }
  | (AgentLifecycleIdentity & { type: 'agent_cancelled'; message?: string });
