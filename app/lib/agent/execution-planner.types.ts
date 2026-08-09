export interface AgentImageTask {
  operation: 'generate' | 'edit';
  targetReferenceId: string | null;
  sourceReferenceId?: string | null;
  supportingReferenceIds: string[];
  instruction: string;
  mustChange: string[];
  mustPreserve: string[];
  targetRegionIds?: string[];
}

export interface AgentPlanPresentation {
  title: string;
  completionSummary: string;
}

export interface AgentGenerationContract {
  promptFormat: 'text' | 'json-text';
  prompt: string;
  items: Array<{
    index: number;
    label: string;
    prompt: string;
  }>;
}

export type AgentVisualReferenceRole =
  | 'edit_target'
  | 'style_reference'
  | 'content_reference'
  | 'layout_reference'
  | 'unresolved';

export interface AgentVisualContext {
  references: Array<{
    referenceId: string;
    summary: string;
    salientSubjects: string[];
    visibleText: string[];
    styleAndComposition: string;
    inferredRole: AgentVisualReferenceRole;
  }>;
  targetSelectionReason: string | null;
  targetSelectionConfidence: 'high' | 'medium' | 'low' | null;
}

export interface AgentPlannerReference {
  id: string;
  src?: string;
  plannerPreviewSrc?: string;
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
}

export type AgentPlannerComposerSegment =
  | { type: 'text'; text: string }
  | { type: 'reference'; referenceId: string };

export interface AgentPlannerReferenceContext {
  references: AgentPlannerReference[];
  composerSegments: AgentPlannerComposerSegment[];
  evidenceImages?: Array<{
    id: string;
    referenceId: string;
    src: string;
    kind: 'annotation_composite' | 'region_crop';
  }>;
}

export interface AgentRegionSelection {
  regionId: string;
  imageItemId: string;
  point: { x: number; y: number };
  box?: { x: number; y: number; width: number; height: number };
  label: string;
  candidateId?: string;
  aliases?: string[];
  description?: string;
  confidence?: 'high' | 'medium' | 'low';
}

export interface AgentExecutionPlannerInput extends Record<string, unknown> {
  userMessage?: string;
  referenceContext?: AgentPlannerReferenceContext | null;
  lockedSkillId?: string | null;
  skillContent?: string;
  frontDoorDecision?: {
    route: 'planner';
    skillId: string | null;
    confidence: 'high' | 'medium' | 'low';
  } | null;
}

export interface AgentExecutionPlanValidationOptions extends Record<string, unknown> {
  referenceIds?: string[];
  regionIds?: string[];
  lockedSkillId?: string | null;
}

export interface AgentTaskContract {
  intent: AgentExecutionPlan['intent'];
  skillId: string | null;
  brief: AgentExecutionPlan['brief'];
  delivery: AgentExecutionPlan['delivery'];
  imageTask?: AgentImageTask;
  generation: AgentGenerationContract | null;
  execution: AgentExecutionPlan['execution'];
}

export interface AgentActiveTaskVersion {
  referenceId: string;
  batchId: string;
  slotId: string;
  versionId: string;
  parentVersionId?: string;
  src: string;
  plannerPreviewSrc: string;
  label?: string;
}

export interface AgentExecutionPlan {
  version: 4;
  intent: 'chat' | 'image' | 'skill_action' | 'analysis';
  skillId: string | null;
  confidence: 'high' | 'medium' | 'low';
  needsClarification: boolean;
  clarification: {
    dimension: string;
    question: string;
    reason?: string;
    options: Array<{ id: string; label: string; answer: string; description?: string }>;
  } | null;
  contextReferences: string[];
  visualContext?: AgentVisualContext;
  imageTask?: AgentImageTask;
  presentation?: AgentPlanPresentation;
  generation: AgentGenerationContract | null;
  brief: {
    deliverable: string;
    subject: string;
    style: string[];
    literalCopy: string[];
    constraints: string[];
  };
  delivery: {
    mode: 'single' | 'series' | 'variants' | 'composite';
    outputCount: number;
    panelCount: number | null;
    variationAxes: string[];
    sharedInvariants: string[];
    distinctPerItem: string[];
    items: Array<{
      index: number;
      label: string;
      subject: string;
      variation: string;
    }>;
  };
  execution: {
    kind: 'image_pipeline' | 'skill_job' | 'agent_loop' | 'none';
    requiresConfirmation: boolean;
    tool: string | null;
  };
}

export interface PlanValidationIssue {
  path: string;
  code: string;
  message: string;
}

export type AgentPlannerSourceDetail =
  | 'tool_call'
  | 'planner_failed';

export interface AgentPlannerAttemptDiagnostic {
  attempt: 1;
  providerId: string;
  model: string;
  durationMs: number;
  responseMode: 'tool_call' | 'text_json' | 'transport_error' | 'missing' | 'wrong_tool_call' | 'invalid_text';
  toolCallPresent: boolean;
  validationErrors: PlanValidationIssue[];
  normalizedFields: string[];
  error?: { name: string; message: string; code?: string };
}

export type AgentPlannerFailureReason =
  | 'timeout'
  | 'transport'
  | 'invalid_reference'
  | 'invalid_context'
  | 'invalid_plan'
  | 'vision_unsupported'
  | 'vision_unavailable';

export interface AgentPlannerResolution {
  plan: AgentExecutionPlan | null;
  source: 'model' | 'fallback';
  sourceDetail: AgentPlannerSourceDetail;
  error?: string;
  attempts: number;
  validationErrors: PlanValidationIssue[];
  normalizedFields: string[];
  repairAttempted: boolean;
  diagnostics: AgentPlannerAttemptDiagnostic[];
  failureReason?: AgentPlannerFailureReason;
  usage?: unknown;
}

export interface AgentPlannerModelSelection {
  providerId: string;
  model: string;
}

export interface AgentPlannerModelCandidate extends AgentPlannerModelSelection {
  id: string;
  providerName: string;
}
