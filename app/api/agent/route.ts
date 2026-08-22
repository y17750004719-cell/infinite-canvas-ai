import { NextRequest, NextResponse } from 'next/server';
import { createHash, randomUUID } from 'node:crypto';
import { POST as generatePost } from '../generate/route';
import { chat, chatStream } from '../../lib/api-client';
import {
  resolveAgentConversationIntent,
  resolveImageDeliveryPlan,
} from '../../lib/agent/prompt-optimizer.mjs';
import {
  listSkillManifests,
  loadSkillContent,
  IMAGEGEN_HOST_SKILL_ID,
  resolveExplicitSkillDirective,
} from '../../lib/agent/skill-registry.mjs';
import {
  buildFailedTaskRecoveryMessages,
  buildMainAgentLoopMessages,
  buildMainAgentMessages,
} from '../../lib/agent/main-agent.mjs';
import {
  createAgentRecoveryRecord,
  normalizeAgentRecoveryRecord,
} from '../../lib/agent/recovery.mjs';
import { normalizeAgentVisualSummary } from '../../lib/agent/visual-summary.mjs';
import { normalizeAgentConversationMemory } from '../../lib/chat-message-persistence.mjs';
import {
  assembleMainAgentImageExecutionPlan,
  buildAgentTaskContract,
  executionPlanToBrief,
  executionPlanToImageDeliveryPlan,
} from '../../lib/agent/execution-planner.mjs';
import {
  abandonImagePlanning,
  completeImagePlanningStage,
  failImagePlanningStage,
  restoreImagePlanningSnapshot,
  rewindImagePlanning,
  setImagePlanningStage,
} from '../../lib/agent/image-planning.mjs';
import {
  applyAgentAnalysisCheckpoint,
  createAgentAnalysisSnapshot,
  recordAgentUserDecision,
  restoreAgentAnalysisSnapshot,
} from '../../lib/agent/agent-analysis.mjs';
import {
  applyClarificationResponse,
  resolveImageOperationResponse,
  resolveBriefClarification,
  shouldAskClarification,
} from '../../lib/agent/brief-clarifier.mjs';
import {
  createAgentProgressTracker,
  createAgentToolResultEvents,
  createAgentToolResultViews,
  startAgentImageGenerationHeartbeat,
} from '../../lib/agent/agent-loop.mjs';
import { runZFlowAgentBrain } from '../../lib/agent/pi-agent-runtime.mjs';
import {
  registerActiveAgentRun,
  settleActiveAgentRun,
  takeActiveAgentRunInputs,
  updateActiveAgentRun,
} from '../../lib/agent/active-run-registry.mjs';
import { requireOriginalAsset } from '../../lib/agent/original-asset.mjs';
import {
  claimConfirmationContinuation,
  fingerprintProviderModel,
  hashEnvelopeValue,
  resolveConfirmationImageIdentity,
  resolveRemainingConfirmationTaskIdentities,
} from '../../lib/agent/confirmation-continuation.mjs';
import {
  createAgentToolRegistry,
  executeAgentTool,
  getAgentModelTools,
  validateAgentToolArguments,
} from '../../lib/agent/tool-registry.mjs';
import { createSkillJob, getSkillJob, toJobSummary } from '../../lib/skill-jobs';
import { readProviderRegistry } from '../../lib/provider-config.mjs';
import {
  listAlternativeProviderModelSelections,
  resolveProviderModelSelection,
} from '../../lib/provider-model-selection.mjs';
import { createLogger } from '../../lib/logger';
import { buildProviderImageOptionProfiles } from '../../lib/image-provider-option-profiles.mjs';
import {
  AGENT_DEFAULT_IMAGE_OPTIONS,
  AGENT_MAX_IMAGE_BATCH_COUNT,
  buildAgentImageGenerationRequests,
  extractAgentImageCount,
  normalizeAgentImageCount,
  parseAgentImageCountNumber,
  resolveAgentImageBatchContinuation,
  resolveAgentImageCountDecision,
} from '../../lib/agent/image-options.mjs';
import {
  buildCanvasImageGenerationFailureMessage,
  resolveCanvasImageTaskExecutionMode,
  settleCanvasImageGenerationRequests,
} from '../../lib/workspace-session-view.mjs';
import {
  compileExecutionBrief,
  isReferentialShorthand,
  parseAgentProposalBlock,
  resolveContextReference,
} from '../../lib/agent/context-reference.mjs';
import type {
  AgentContextEntity,
  AgentContextResolution,
  ExecutionBrief,
} from '../../lib/agent/context-reference.types';
import type {
  AgentExecutionPlan,
  AgentImageTask,
  AgentPlanPresentation,
  AgentPlannerModelCandidate,
  AgentPlannerSourceDetail,
  AgentTaskContract,
} from '../../lib/agent/execution-planner.types';
import type {
  AgentClarificationRequest,
  AgentClarificationState,
  AgentEvent,
  AgentIntent,
  AgentProgressPhase,
  AgentProgressStatus,
  AgentProgressStepId,
  AgentConversationMemory,
  AgentPromptTrace,
  AgentRecoveryRecord,
  AgentImagePlanningSnapshot,
  AgentImagePlanningStage,
  AgentAnalysisSnapshot,
} from '../../lib/agent/events';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_AGENT_TURNS = 8;
const MAX_TOOL_CALLS = 6;
const MAX_MAIN_AGENT_TURNS = 12;
const MAX_MAIN_AGENT_TOOL_CALLS = 6;
const CONFIRMATION_TTL_MS = 10 * 60 * 1000;
const encoder = new TextEncoder();

function summarizePlannerNormalizations(fields: unknown) {
  const normalizedFields = Array.isArray(fields)
    ? fields.filter((field): field is string => typeof field === 'string')
    : [];
  return {
    generationContractNormalizedCount: normalizedFields.filter((field) => (
      field === 'generation.prompt' || /^generation\.items\[\d+\]\.prompt$/.test(field)
    )).length,
    executionToolNormalized: normalizedFields.includes('execution.tool'),
  };
}

function summarizePromptQuality(prompt: unknown) {
  const value = typeof prompt === 'string' ? prompt : '';
  const lines = value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const normalizedLines = lines.map((line) => line.toLowerCase().replace(/\s+/g, ' '));
  return {
    characterCount: value.length,
    paragraphCount: value.split(/\n\s*\n/).filter((paragraph) => paragraph.trim()).length,
    duplicateLineCount: normalizedLines.length - new Set(normalizedLines).size,
    containsLegacyMandatoryContract: /Mandatory image task contract|Output contract:/i.test(value),
  };
}

function hasOnlyImageOperationAmbiguity(validationErrors: unknown) {
  const entries = Array.isArray(validationErrors) ? validationErrors : [];
  return entries.length > 0 && entries.every((entry) => {
    if (!entry || typeof entry !== 'object') return false;
    const issue = entry as { code?: unknown; path?: unknown };
    return issue.code === 'operation_mismatch'
      && ['imageTask.targetReferenceId', 'imageTask.sourceReferenceId']
        .includes(String(issue.path || ''));
  });
}

function createPlannerModelSwitchClarification(
  taskId: string,
  providers: Awaited<ReturnType<typeof readProviderRegistry>>['providers'],
  currentProviderId: string | undefined,
  currentModel: string,
  remainingCandidates?: AgentPlannerModelCandidate[],
) {
  const plannerCandidates = remainingCandidates
    ? remainingCandidates.filter((candidate) => (
        candidate.providerId !== currentProviderId || candidate.model !== currentModel
      )).slice(0, 3)
    : listAlternativeProviderModelSelections({
        providers,
        currentProviderId,
        currentModel,
        limit: 3,
      }).map((candidate, index) => ({ ...candidate, id: `planner-model-${index + 1}` }));
  if (plannerCandidates.length === 0) return null;
  const currentProvider = providers.find((provider) => provider.id === currentProviderId);
  const currentLabel = [currentProvider?.name || currentProviderId, currentModel].filter(Boolean).join(' / ');
  const question = `${currentLabel || '当前 Planner'} 连接超时、中断或能力不匹配。请选择另一个模型重新规划。`;
  const request: AgentClarificationRequest = {
    id: randomUUID(),
    taskId,
    question,
    dimension: 'planner_model_switch',
    options: plannerCandidates.map((candidate) => ({
      id: candidate.id,
      label: `${candidate.providerName} / ${candidate.model}`,
      answer: `使用 ${candidate.providerName} 的 ${candidate.model} 重新规划当前任务。`,
      description: '保留原始需求、Skill、稳定引用和已缓存的视觉摘要。',
    })),
    allowCustom: true,
    allowProceed: true,
  };
  return { request, plannerCandidates };
}

type AgentImagePromptCompilation = {
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

type AgentSkillSource = 'manual_ui' | 'explicit_text' | 'user_confirmation' | 'recovery' | 'manual' | 'auto';

type AgentPublicProgress = {
  activeLabel?: string;
  completedLabel?: string;
  completionSummary?: string;
  failedLabel?: string;
  promptPreparation?: Omit<AgentPublicProgress, 'promptPreparation'>;
};

const isExplicitSkillSource = (source: AgentSkillSource | null | undefined) => Boolean(source && source !== 'auto');

type ConfirmationRecord = {
  version?: 1;
  confirmationId?: string;
  runId?: string;
  status: 'pending' | 'executing' | 'completed';
  operationId: string;
  skillSource: AgentSkillSource | null;
  lastSequence: number;
  progressToolCallId?: string;
  skillId: string | null;
  toolName: string;
  toolArgs: Record<string, unknown>;
  allowedTools: string[];
  userMessage: string;
  referenceImages: string[];
  canvasContext?: Record<string, unknown>;
  imageOptions?: AgentRequestBody['imageOptions'];
  imageCountSource?: AgentImageCountSource;
  promptOptimized?: boolean;
  promptCompilation?: AgentImagePromptCompilation;
  requestedTotalImageCount?: number;
  imageBatchPlan?: AgentImageBatchPlan;
  nextConfirmationId?: string;
  imageBatchMode?: AgentImageBatchMode;
  imageDeliveryPlan?: ImageDeliveryPlan;
  generationItems?: AgentImageGenerationItem[];
  remainingGenerationItems?: AgentImageGenerationItem[];
  generationBrief?: string;
  executionBrief?: ExecutionBrief;
  imageTask?: AgentImageTask;
  visualContext?: AgentExecutionPlan['visualContext'];
  presentation?: AgentPlanPresentation;
  publicProgress?: AgentPublicProgress;
  topicId?: string;
  taskId?: string;
  contractVersion?: number;
  taskContract?: AgentTaskContract;
  pendingTaskIdentities?: AgentPendingAssetIdentity[];
  remainingTaskIdentities?: AgentPendingAssetIdentity[];
  completedTaskIdentities?: AgentPendingAssetIdentity[];
  sourceTaskId?: string | null;
  sourceVersionId?: string | null;
  editBaseVersionId?: string | null;
  referenceContext?: AgentRuntimeReferenceContext;
  resolvedProviderId?: string;
  resolvedModel?: string;
  providerModelFingerprint?: string;
  resolvedImageProviderId?: string;
  resolvedImageModel?: string;
  imageProviderModelFingerprint?: string;
  systemPrompt?: string;
  piTranscript?: unknown[];
  assistantToolCallIds?: string[];
  progressSequence?: number;
  pendingToolCall?: {
    id: string;
    name: string;
    args: Record<string, unknown>;
    argsHash: string;
    batch: Array<{ id: string; name: string; args: Record<string, unknown> }>;
  };
  budgets?: {
    turnsUsed: number;
    toolCallsUsed: number;
    mutationToolCallsUsed: number;
    maxTurns: number;
    maxToolCalls: number;
  };
  expiresAt: number;
  execution?: Promise<Record<string, unknown>>;
  result?: Record<string, unknown>;
};

type AgentImageCountSource = 'clarification' | 'prompt' | 'interface' | 'default' | 'batch';
type AgentImageBatchMode = 'series' | 'variants' | 'composite';
type ImageDeliveryPlan = ReturnType<typeof resolveImageDeliveryPlan>;
type SkillSelectionMethod = 'manual_ui' | 'manual_text' | 'model' | 'user_choice' | 'none';

type AgentImageGenerationItem = {
  id: string;
  index: number;
  label: string;
  subject: string;
  prompt: string;
};

type AgentImageBatchPlan = {
  totalCount: number;
  completedCount: number;
  remainingCount: number;
  batchSize: number;
};

type AgentPendingAssetIdentity = {
  referenceId: string;
  batchId: string;
  slotId: string;
  versionId: string;
  parentVersionId?: string;
  assetUrl?: string;
  plannerPreviewSrc?: string;
  naturalWidth?: number;
  naturalHeight?: number;
  model?: string;
  itemId?: string;
  index?: number;
  label?: string;
  promptTrace?: AgentPromptTrace;
};

type AgentTaskSnapshot = {
  topicId: string;
  taskId: string;
  contractVersion: number;
  contract?: AgentTaskContract;
  agentAnalysis?: AgentAnalysisSnapshot;
  imagePlanning?: AgentImagePlanningSnapshot;
  editBaseVersionId?: string | null;
  latestBatchId?: string | null;
  activeVersions: AgentPendingAssetIdentity[];
};

type AgentRuntimeReferenceContext = {
  references: Array<{
    id: string;
    src: string;
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
    sourceTaskId?: string;
    sourceVersionId?: string;
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

const agentGlobals = globalThis as unknown as {
  __agentConfirmationStore?: Map<string, ConfirmationRecord>;
  __agentClarificationSubmissionStore?: Map<string, number>;
};
const confirmationStore = agentGlobals.__agentConfirmationStore || new Map<string, ConfirmationRecord>();
agentGlobals.__agentConfirmationStore = confirmationStore;
const clarificationSubmissionStore = agentGlobals.__agentClarificationSubmissionStore || new Map<string, number>();
agentGlobals.__agentClarificationSubmissionStore = clarificationSubmissionStore;

function resolveAgentImageCardReferences({
  referenceContext,
  referenceImages = [],
  imageTask,
}: {
  referenceContext?: AgentRuntimeReferenceContext;
  referenceImages?: string[];
  imageTask?: AgentImageTask;
}) {
  const contextualPreviews = (referenceContext?.references || [])
    .filter((reference) => reference.id && reference.src)
    .map((reference) => ({ id: reference.id, src: reference.src, label: reference.label }));
  const contextualSources = new Set(contextualPreviews.map((reference) => reference.src));
  const extraPreviews = referenceImages
    .filter((src) => typeof src === 'string' && src.trim() && !contextualSources.has(src))
    .map((src, index) => ({
      id: `runtime-reference-${index + 1}`,
      src,
      label: `image${contextualPreviews.length + index + 1}`,
    }));
  const linkedImagePreviews = [...contextualPreviews, ...extraPreviews];
  const referenceIds = imageTask
    ? [
        ...(imageTask.targetReferenceId ? [imageTask.targetReferenceId] : []),
        ...imageTask.supportingReferenceIds,
        ...extraPreviews.map((reference) => reference.id),
      ]
    : undefined;
  const previewById = new Map(linkedImagePreviews.map((reference) => [reference.id, reference]));
  const orderedLinkedImagePreviews = referenceIds
    ? referenceIds.flatMap((referenceId) => {
        const preview = previewById.get(referenceId);
        return preview ? [preview] : [];
      })
    : linkedImagePreviews;
  return {
    linkedImagePreviews,
    referenceIds,
    orderedReferenceImages: orderedLinkedImagePreviews.map((reference) => reference.src),
  };
}

function normalizeAgentRuntimeReferenceContext(value: unknown): AgentRuntimeReferenceContext | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const input = value as Record<string, unknown>;
  const references: AgentRuntimeReferenceContext['references'] = (Array.isArray(input.references) ? input.references : []).flatMap((entry): AgentRuntimeReferenceContext['references'] => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return [];
    const reference = entry as Record<string, unknown>;
    const id = typeof reference.id === 'string' ? reference.id.trim() : '';
    const src = typeof reference.src === 'string' ? reference.src.trim() : '';
    const plannerPreviewSrc = typeof reference.plannerPreviewSrc === 'string' ? reference.plannerPreviewSrc.trim() : '';
    const label = typeof reference.label === 'string' ? reference.label.trim() : '';
    const source: AgentRuntimeReferenceContext['references'][number]['source'] | null = reference.source === 'upload' || reference.source === 'history' || reference.source === 'canvas'
      ? reference.source
      : null;
    const role: AgentRuntimeReferenceContext['references'][number]['role'] | null = reference.role === 'edit_target' || reference.role === 'annotation_bundle' || reference.role === 'region_target'
      ? reference.role
      : reference.role === 'reference'
        ? 'reference'
        : null;
    if (!id || !src || !label || !source || !role) return [];
    if (role === 'region_target' && reference.confirmationStatus !== 'confirmed') return [];
    return [{
      id,
      src,
      ...(plannerPreviewSrc ? { plannerPreviewSrc } : {}),
      label,
      source,
      role,
      ...(typeof reference.canvasItemId === 'string' && reference.canvasItemId.trim()
        ? { canvasItemId: reference.canvasItemId.trim() }
        : {}),
      ...(Number.isFinite(reference.annotationCount) && Number(reference.annotationCount) > 0
        ? { annotationCount: Math.floor(Number(reference.annotationCount)) }
        : {}),
      ...(typeof reference.regionId === 'string' && reference.regionId.trim() ? { regionId: reference.regionId.trim() } : {}),
      ...(typeof reference.candidateId === 'string' && reference.candidateId.trim() ? { candidateId: reference.candidateId.trim() } : {}),
      ...(reference.confirmationStatus === 'confirmed' ? { confirmationStatus: 'confirmed' as const } : { confirmationStatus: 'pending' as const }),
      ...(Array.isArray(reference.aliases) ? { aliases: reference.aliases.filter((value): value is string => typeof value === 'string' && Boolean(value.trim())).map((value) => value.trim()).slice(0, 6) } : {}),
      ...(typeof reference.description === 'string' && reference.description.trim() ? { description: reference.description.trim().slice(0, 240) } : {}),
      ...(reference.confidence === 'high' || reference.confidence === 'medium' || reference.confidence === 'low' ? { confidence: reference.confidence } : {}),
      ...(source === 'history' && typeof reference.sourceTaskId === 'string' && reference.sourceTaskId.trim()
        ? { sourceTaskId: reference.sourceTaskId.trim() }
        : {}),
      ...(source === 'history' && typeof reference.sourceVersionId === 'string' && reference.sourceVersionId.trim()
        ? { sourceVersionId: reference.sourceVersionId.trim() }
        : {}),
      ...(normalizeRuntimePoint(reference.targetPoint) ? { targetPoint: normalizeRuntimePoint(reference.targetPoint)! } : {}),
      ...(normalizeRuntimeBox(reference.targetBox) ? { targetBox: normalizeRuntimeBox(reference.targetBox)! } : {}),
    }];
  }).slice(0, 14);
  const knownIds = new Set(references.map((reference) => reference.id));
  const composerSegments: AgentRuntimeReferenceContext['composerSegments'] = (Array.isArray(input.composerSegments) ? input.composerSegments : []).flatMap((entry): AgentRuntimeReferenceContext['composerSegments'] => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return [];
    const segment = entry as Record<string, unknown>;
    if (segment.type === 'text' && typeof segment.text === 'string') {
      return [{ type: 'text' as const, text: segment.text }];
    }
    if (segment.type === 'reference' && typeof segment.referenceId === 'string' && knownIds.has(segment.referenceId)) {
      return [{ type: 'reference' as const, referenceId: segment.referenceId }];
    }
    return [];
  }).slice(0, 64);
  const evidenceImages: NonNullable<AgentRuntimeReferenceContext['evidenceImages']> = (Array.isArray(input.evidenceImages) ? input.evidenceImages : []).flatMap((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return [];
    const evidence = entry as Record<string, unknown>;
    const id = typeof evidence.id === 'string' ? evidence.id.trim() : '';
    const referenceId = typeof evidence.referenceId === 'string' ? evidence.referenceId.trim() : '';
    const src = typeof evidence.src === 'string' ? evidence.src.trim() : '';
    const parent = references.find((reference) => reference.id === referenceId);
    if (!id || !parent || !src || (evidence.kind !== 'annotation_composite' && evidence.kind !== 'region_crop')) return [];
    if (evidence.kind === 'region_crop' && parent.role !== 'region_target') return [];
    return [{ id, referenceId, src, kind: evidence.kind as 'annotation_composite' | 'region_crop' }];
  }).slice(0, 14);
  return references.length > 0 || composerSegments.length > 0 || evidenceImages.length > 0
    ? { references, composerSegments, ...(evidenceImages.length > 0 ? { evidenceImages } : {}) }
    : undefined;
}

function runtimeReferenceId(src: string): string {
  return `runtime-reference:${createHash('sha256').update(src).digest('hex').slice(0, 16)}`;
}

function normalizeRuntimePoint(value: unknown): { x: number; y: number } | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const point = value as Record<string, unknown>;
  const x = Number(point.x);
  const y = Number(point.y);
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : undefined;
}

function normalizeRuntimeBox(value: unknown): { x: number; y: number; width: number; height: number } | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const box = value as Record<string, unknown>;
  const x = Number(box.x);
  const y = Number(box.y);
  const width = Number(box.width);
  const height = Number(box.height);
  return [x, y, width, height].every(Number.isFinite) ? { x, y, width, height } : undefined;
}

function buildCanonicalAgentReferenceContext({
  referenceContext,
  referenceImages,
  canvasContext,
}: {
  referenceContext?: AgentRuntimeReferenceContext;
  referenceImages: string[];
  canvasContext?: Record<string, unknown>;
}): AgentRuntimeReferenceContext | undefined {
  const references = [...(referenceContext?.references || [])];
  const composerSegments = [...(referenceContext?.composerSegments || [])];
  const evidenceImages = [...(referenceContext?.evidenceImages || [])];
  const knownSources = new Set(references.map((reference) => reference.src));
  const knownEvidenceSources = new Set(evidenceImages.map((evidence) => evidence.src));
  const annotationContext = canvasContext?.annotationContext && typeof canvasContext.annotationContext === 'object'
    ? canvasContext.annotationContext as Record<string, unknown>
    : undefined;
  const compositePreviewUrl = typeof annotationContext?.compositePreviewUrl === 'string'
    ? annotationContext.compositePreviewUrl.trim()
    : '';
  const targetImage = annotationContext?.targetImage && typeof annotationContext.targetImage === 'object'
    ? annotationContext.targetImage as Record<string, unknown>
    : undefined;
  const targetCanvasItemId = typeof targetImage?.id === 'string' ? targetImage.id.trim() : '';
  const annotationParent = references.find((reference) => (
    reference.role === 'annotation_bundle'
    || Boolean(targetCanvasItemId && reference.canvasItemId === targetCanvasItemId)
  ));

  if (compositePreviewUrl && annotationParent && !knownEvidenceSources.has(compositePreviewUrl)) {
    evidenceImages.push({
      id: `${annotationParent.id}:annotation-composite`,
      referenceId: annotationParent.id,
      src: compositePreviewUrl,
      kind: 'annotation_composite',
    });
    knownEvidenceSources.add(compositePreviewUrl);
  }

  for (const [index, rawSrc] of referenceImages.entries()) {
    const src = typeof rawSrc === 'string' ? rawSrc.trim() : '';
    if (!src || knownSources.has(src) || knownEvidenceSources.has(src)) continue;
    const id = runtimeReferenceId(src);
    references.push({
      id,
      src,
      label: `image${references.length + index + 1}`,
      source: 'upload',
      role: 'reference',
    });
    knownSources.add(src);
  }

  return normalizeAgentRuntimeReferenceContext({ references, composerSegments, evidenceImages });
}

type AgentRequestBody = {
  runId?: string;
  operationId?: string;
  topicId?: string;
  messages?: Array<{ id?: string; role: 'user' | 'assistant'; content: string }>;
  sourceUserMessageId?: string;
  sourceAssistantMessageId?: string;
  recoveryTaskId?: string;
  activeSkillId?: string;
  intent?: 'chat' | 'image';
  referenceImages?: string[];
  referenceContext?: AgentRuntimeReferenceContext;
  contextEntities?: AgentContextEntity[];
  selectedContextEntityIds?: string[];
  agentMemory?: AgentConversationMemory;
  recentFailedTask?: AgentRecoveryRecord | Record<string, unknown>;
  executionBrief?: ExecutionBrief;
  canvasContext?: Record<string, unknown>;
  chatOptions?: {
    providerId?: string;
    model?: string;
  };
  imageOptions?: {
    providerId?: string;
    model?: string;
    aspectRatio?: string;
    aspectRatioLocked?: boolean;
    size?: string;
    quality?: string;
    count?: number;
    autoConfirm?: boolean;
  };
  confirmation?: { confirmationId?: string; toolName?: string };
  clarificationState?: AgentClarificationState;
  clarificationRequest?: AgentClarificationRequest;
  clarificationResponse?: {
    requestId?: string;
    selectedOptionId?: string;
    customText?: string;
    proceedWithCurrent?: boolean;
    retry?: boolean;
    retryMode?: 'replan';
  };
};

function writeEvent(controller: ReadableStreamDefaultController, event: AgentEvent) {
  controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
}

function getLatestUserMessage(messages: AgentRequestBody['messages']) {
  return [...(messages || [])].reverse().find((message) => message.role === 'user')?.content?.trim() || '';
}

function normalizeRecentFailedTask(
  value: AgentRequestBody['recentFailedTask'],
  messages: AgentRequestBody['messages'],
) {
  if (!value || typeof value !== 'object') return null;
  const normalized = normalizeAgentRecoveryRecord(value);
  if (normalized) {
    const sourceExists = (messages || []).some((message) => message.id === normalized.sourceUserMessageId)
      || (messages || []).some((message) => message.role === 'user' && message.content.trim().slice(0, 4000) === normalized.originalRequest);
    return sourceExists
      ? { ...normalized, resumeRoute: normalized.resumeRoute === 'image_planner' ? 'main_agent' : normalized.resumeRoute }
      : null;
  }
  const legacy = value as Record<string, unknown>;
  const id = typeof legacy.id === 'string' ? legacy.id.trim().slice(0, 200) : '';
  const originalRequest = typeof legacy.originalRequest === 'string'
    ? legacy.originalRequest.trim().slice(0, 4000)
    : '';
  if (!id || !originalRequest || !['failed', 'cancelled'].includes(String(legacy.status || ''))) return null;
  const matchesHistory = (messages || []).some((message) => (
    message.role === 'user' && message.content.trim().slice(0, 4000) === originalRequest
  ));
  if (!matchesHistory) return null;
  const source = (messages || []).findLast((message) => message.role === 'user' && message.content.trim().slice(0, 4000) === originalRequest);
  return createAgentRecoveryRecord({
    taskId: id,
    runId: id,
    topicId: 'default',
    sourceUserMessageId: source?.id || `legacy-${id}`,
    status: legacy.status === 'cancelled' ? 'cancelled' : 'failed',
    resumeRoute: 'main_agent',
    intent: ['chat', 'image', 'skill_action'].includes(String(legacy.intent || '')) ? legacy.intent : null,
    originalRequest,
    failureStage: typeof legacy.failureStage === 'string' ? legacy.failureStage : 'unknown',
    failureMessage: typeof legacy.failureMessage === 'string' ? legacy.failureMessage : '任务未完成',
    skillId: typeof legacy.skillId === 'string' ? legacy.skillId : null,
    contextEntityIds: legacy.contextEntityIds,
    visualReferenceIds: legacy.contextEntityIds,
  });
}

function hasExplicitImagegenContextTranscript(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const transcript = (value as { transcript?: unknown }).transcript;
  return Array.isArray(transcript) && transcript.some((message) => (
    message
    && typeof message === 'object'
    && (message as { role?: unknown }).role === 'toolResult'
    && (message as { toolName?: unknown }).toolName === 'read_imagegen_context'
  ));
}

const INTERNAL_IMAGE_PLACEHOLDER_PATTERN = /\[(?:Generated image[^\]]*omitted from chat history|聊天记录中省略了代理生成的图像)\]/gi;
const UNBACKED_EXECUTION_CLAIM_PATTERN = /(?:(?:图片|图像|封面|海报|视觉稿|任务|素材)[^。！!\n]{0,18}(?:已(?:经)?|正在)[^。！!\n]{0,12}(?:启动|开始|提交|生成|制作|出图)|(?:已(?:经)?|现已|正在)[^。！!\n]{0,8}为(?:您|你)[^。！!\n]{0,12}(?:启动|开始|提交|生成|制作|出图)|已(?:经)?(?:启动|开始|提交)(?:生成|制作|出图))/i;

function sanitizeAgentResponseContent(content: string, hasMutationEvidence: boolean) {
  const cleaned = String(content || '')
    .replace(INTERNAL_IMAGE_PLACEHOLDER_PATTERN, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (
    hasMutationEvidence
    || !UNBACKED_EXECUTION_CLAIM_PATTERN.test(cleaned)
    || /(?:尚未|还未|没有|并未|未实际)(?:[^。！!\n]{0,8})(?:启动|开始|生成)/i.test(cleaned)
  ) {
    return cleaned;
  }
  const proposal = cleaned.replace(UNBACKED_EXECUTION_CLAIM_PATTERN, '建议按以下方向生成');
  return `生成尚未实际启动。${proposal ? `\n\n${proposal}` : ''}\n\n请确认是否按当前方向开始生成，或补充你希望调整的主体与场景。`;
}

function mergeTopicMemory(
  previous: AgentConversationMemory | undefined,
  patch: Record<string, unknown> | undefined,
  messages: AgentRequestBody['messages'],
): AgentConversationMemory {
  const current = normalizeAgentConversationMemory(previous) || {
    version: 1 as const,
    recentRawConversation: [],
    rollingSummary: '',
    facts: [],
    preferences: [],
    activeTask: null,
    recentReferencedAssetIds: [],
    updatedAt: Date.now(),
  };
  const candidate = patch && typeof patch === 'object' ? patch : {};
  const newestUnique = (currentValues: string[], nextValues: unknown[], limit: number) => Array.from(new Set([
    ...currentValues,
    ...nextValues.filter((value): value is string => typeof value === 'string').map((value) => value.trim()).filter(Boolean),
  ])).slice(-limit);
  const merged = {
    ...current,
    ...(typeof candidate.rollingSummary === 'string' ? { rollingSummary: candidate.rollingSummary } : {}),
    ...(Array.isArray(candidate.facts) ? { facts: newestUnique(current.facts, candidate.facts, 24) } : {}),
    ...(Array.isArray(candidate.preferences) ? { preferences: newestUnique(current.preferences, candidate.preferences, 16) } : {}),
    ...(Object.hasOwn(candidate, 'activeTask') ? { activeTask: candidate.activeTask } : {}),
    ...(Array.isArray(candidate.recentReferencedAssetIds)
      ? { recentReferencedAssetIds: newestUnique(current.recentReferencedAssetIds, candidate.recentReferencedAssetIds, 20) }
      : {}),
    recentRawConversation: (Array.isArray(messages) ? messages : []).slice(-20),
    updatedAt: Date.now(),
  };
  return (normalizeAgentConversationMemory(merged) || current) as AgentConversationMemory;
}

function generatedAssetsFromResult(payload: any) {
  const result = payload?.result || {};
  if (Array.isArray(result.outputs) && result.outputs.length > 0) {
    return result.outputs
      .filter((item: any) => typeof item?.localUrl === 'string' || typeof item?.url === 'string')
      .map((item: any) => ({
        src: item.localUrl || item.url,
        naturalWidth: item.naturalWidth,
        naturalHeight: item.naturalHeight,
      }));
  }
  const src = result.localUrl || result.data?.[0]?.url;
  return typeof src === 'string' ? [{ src }] : [];
}

function enrichGeneratedAssetEvents(events: unknown[], payload: any): unknown[] {
  const outputs = Array.isArray(payload?.result?.outputs) ? payload.result.outputs : [];
  return events.map((event: any) => {
    if (event?.type !== 'client_action' || event.action?.type !== 'add_generated_assets') return event;
    return {
      ...event,
      action: {
        ...event.action,
        ...(typeof payload?.taskId === 'string' ? { taskId: payload.taskId } : {}),
        ...(positiveInteger(payload?.contractVersion) ? { contractVersion: positiveInteger(payload.contractVersion)! } : {}),
        ...(typeof payload?.batchId === 'string' ? { batchId: payload.batchId } : {}),
        ...(typeof payload?.sourceTaskId === 'string' ? { sourceTaskId: payload.sourceTaskId } : {}),
        ...(typeof payload?.sourceVersionId === 'string' ? { sourceVersionId: payload.sourceVersionId } : {}),
        assets: event.action.assets.map((asset: Record<string, unknown>, index: number) => ({
          ...asset,
          ...(typeof outputs[index]?.slotId === 'string' ? { slotId: outputs[index].slotId } : {}),
          ...(typeof outputs[index]?.versionId === 'string' ? { versionId: outputs[index].versionId } : {}),
          ...(typeof outputs[index]?.parentVersionId === 'string' ? { parentVersionId: outputs[index].parentVersionId } : {}),
          ...(typeof outputs[index]?.plannerPreviewSrc === 'string' ? { plannerPreviewSrc: outputs[index].plannerPreviewSrc } : {}),
        })),
      },
    };
  });
}

function pruneConfirmationStore(now = Date.now()) {
  for (const [id, record] of confirmationStore) {
    if (record.expiresAt <= now) confirmationStore.delete(id);
  }
}

function pruneClarificationSubmissionStore(now = Date.now()) {
  for (const [key, expiresAt] of clarificationSubmissionStore) {
    if (expiresAt <= now) clarificationSubmissionStore.delete(key);
  }
}

function positiveInteger(value: unknown) {
  const count = Number(value);
  return Number.isFinite(count) && count > 0 ? Math.floor(count) : null;
}

function reserveTaskExecution(
  contract: AgentTaskContract,
  imageTask: AgentImageTask | undefined,
  outputCount: number,
  referenceContext?: AgentRuntimeReferenceContext,
  existingTaskId?: string | null,
): {
  taskId: string;
  contractVersion: number;
  contract: AgentTaskContract;
  latestBatchId: string | null;
  identities: AgentPendingAssetIdentity[];
  sourceTaskId: string | null;
  sourceVersionId: string | null;
  editBaseVersionId: string | null;
} {
  const taskId = existingTaskId || randomUUID();
  const contractVersion = 1;
  if (contract.execution.kind !== 'image_pipeline') {
    return {
      taskId,
      contractVersion,
      contract,
      latestBatchId: null,
      identities: [],
      sourceTaskId: null,
      sourceVersionId: null,
      editBaseVersionId: null,
    };
  }
  const batchId = randomUUID();
  const sourceReferenceId = imageTask?.operation === 'edit'
    ? imageTask.targetReferenceId
    : imageTask?.sourceReferenceId;
  const sourceReference = sourceReferenceId
    ? referenceContext?.references.find((reference) => reference.id === sourceReferenceId)
    : undefined;
  const parentVersionId = sourceReference?.sourceVersionId;
  const editBaseVersionId = imageTask?.operation === 'edit' ? parentVersionId || null : null;
  const identities = Array.from({ length: outputCount }, () => {
    const slotId = randomUUID();
    return {
      referenceId: `task-slot:${slotId}`,
      batchId,
      slotId,
      versionId: randomUUID(),
      ...(parentVersionId ? { parentVersionId } : {}),
    };
  });
  return {
    taskId,
    contractVersion,
    contract,
    latestBatchId: batchId,
    identities,
    sourceTaskId: sourceReference?.sourceTaskId || null,
    sourceVersionId: sourceReference?.sourceVersionId || null,
    editBaseVersionId,
  };
}

function describeImageDelivery(plan: ImageDeliveryPlan, count: number) {
  if (plan.mode === 'composite') {
    return `${count} 张${plan.panelCount ? `每张由 ${plan.panelCount} 个画面组成的` : ''}多宫格图片`;
  }
  if (plan.mode === 'series') return `${count} 张内容不同、风格统一的系列图片`;
  return `${count} 张同一 Brief 的随机变体`;
}

function parseClarifiedImageCount(value: unknown) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) return null;
  const parsed = extractAgentImageCount(text);
  if ((parsed.status === 'resolved' || parsed.status === 'overflow') && parsed.count) return parsed.count;
  const standalone = text.match(/^\s*(\d{1,4}|[零〇一二两三四五六七八九十百]+|[a-z-]+)\s*(?:张|幅|期|版|款|个|images?|covers?|versions?)?\s*$/i);
  return standalone ? parseAgentImageCountNumber(standalone[1]) : null;
}

function updateClarifiedExecutionPlan(
  state: AgentClarificationState,
  { count, mode, panelCount }: { count?: number; mode?: AgentImageBatchMode; panelCount?: number },
) {
  if (!state.executionPlan) return state;
  const nextCount = positiveInteger(count) || state.executionPlan.delivery.outputCount;
  const nextMode = mode || (state.executionPlan.delivery.mode === 'single' ? 'variants' : state.executionPlan.delivery.mode);
  const existingItems = state.executionPlan.delivery.items || [];
  const items = nextMode === 'series'
    ? Array.from({ length: nextCount }, (_, index) => existingItems[index] || {
        index: index + 1,
        label: `Series item ${index + 1}`,
        subject: state.executionPlan?.brief.subject || 'requested subject',
        variation: state.executionPlan?.delivery.variationAxes.join(', ') || 'distinct composition',
      })
    : [];
  return {
    ...state,
    executionPlan: {
      ...state.executionPlan,
      delivery: {
        ...state.executionPlan.delivery,
        mode: nextMode,
        outputCount: nextCount,
        panelCount: nextMode === 'composite' ? positiveInteger(panelCount) || state.executionPlan.delivery.panelCount : null,
        items,
      },
    },
  };
}

function applyImageCountClarificationState(
  state: AgentClarificationState,
  request: AgentClarificationRequest,
  response: NonNullable<AgentRequestBody['clarificationResponse']>,
) {
  if (request.dimension === 'image_delivery_scope') {
    const selectedOptionId = typeof response.selectedOptionId === 'string' ? response.selectedOptionId : '';
    if (selectedOptionId === 'single_composite') {
      return updateClarifiedExecutionPlan({
        ...state,
        resolvedImageCount: 1,
        resolvedImageCountSource: 'clarification' as const,
        resolvedImageDeliveryMode: 'composite' as const,
      }, { count: 1, mode: 'composite', panelCount: state.resolvedImagePanelCount });
    }
    if (selectedOptionId === 'separate_outputs') {
      const count = Math.max(2, ...(state.pendingImageCountCandidates || [state.requestedImageCountTotal || 2]));
      return updateClarifiedExecutionPlan({
        ...state,
        resolvedImageCount: count,
        requestedImageCountTotal: count,
        resolvedImageCountSource: 'clarification' as const,
        resolvedImageDeliveryMode: 'variants' as const,
        resolvedImagePanelCount: undefined,
      }, { count, mode: 'variants' });
    }
    return state;
  }
  if (!request.dimension.startsWith('output_count')) return state;
  const selectedOptionId = typeof response.selectedOptionId === 'string' ? response.selectedOptionId : '';
  const requestedTotal = positiveInteger(state.requestedImageCountTotal);
  if (selectedOptionId === 'split_batches' && requestedTotal) {
    return {
      ...state,
      resolvedImageCount: AGENT_MAX_IMAGE_BATCH_COUNT,
      resolvedImageCountSource: 'batch' as const,
      imageBatchPlan: {
        totalCount: requestedTotal,
        completedCount: 0,
        remainingCount: requestedTotal,
        batchSize: AGENT_MAX_IMAGE_BATCH_COUNT,
      },
    };
  }
  if (selectedOptionId === 'first_batch') {
    return updateClarifiedExecutionPlan({
      ...state,
      resolvedImageCount: AGENT_MAX_IMAGE_BATCH_COUNT,
      resolvedImageCountSource: 'clarification' as const,
      requestedImageCountTotal: AGENT_MAX_IMAGE_BATCH_COUNT,
      imageBatchPlan: undefined,
    }, { count: AGENT_MAX_IMAGE_BATCH_COUNT });
  }
  const optionCount = selectedOptionId.startsWith('count_')
    ? positiveInteger(selectedOptionId.slice('count_'.length))
    : null;
  const customCount = parseClarifiedImageCount(response.customText);
  const resolvedCount = customCount || optionCount;
  if (!resolvedCount) return state;
  return updateClarifiedExecutionPlan({
    ...state,
    resolvedImageCount: resolvedCount,
    resolvedImageCountSource: 'clarification' as const,
    requestedImageCountTotal: resolvedCount,
    imageBatchPlan: undefined,
  }, { count: resolvedCount });
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null) as AgentRequestBody | null;
  if (!body || !Array.isArray(body.messages)) {
    return NextResponse.json({ error: 'Messages are required' }, { status: 400 });
  }
  const hasUnconfirmedRegion = [
    body.referenceContext,
    body.clarificationState?.referenceContext,
  ].some((referenceContext) => (
    Array.isArray(referenceContext?.references)
    && referenceContext.references.some((reference) => (
      reference?.role === 'region_target' && reference.confirmationStatus !== 'confirmed'
    ))
  ));
  if (hasUnconfirmedRegion) {
    return NextResponse.json({ error: 'Region targets must be explicitly confirmed before sending' }, { status: 400 });
  }
  // Treat the client-provided reference context as untrusted runtime data. Keep
  // only the fields needed by the planner/execution bridge and drop malformed
  // or unknown references before any downstream use.
  const runtimeReferenceContext = normalizeAgentRuntimeReferenceContext(body.referenceContext);

  const runId = typeof body.runId === 'string' && body.runId.trim()
    ? body.runId.trim()
    : `agent-${Date.now()}`;
  const topicId = typeof body.topicId === 'string' && body.topicId.trim() ? body.topicId.trim() : 'default';
  const latestUserMessage = getLatestUserMessage(body.messages);
  if (!latestUserMessage) {
    return NextResponse.json({ error: 'A user message is required' }, { status: 400 });
  }
  const plannerShadowMode = false;
  const plannerAuthoritative = true;
  const conversationIntent = plannerAuthoritative
    ? { intent: 'chat' as const, brief: latestUserMessage, inherited: false, needsDirectionConfirmation: false }
    : resolveAgentConversationIntent(
        body.messages,
        Boolean(body.referenceImages?.length),
      );
  const contextEntities = Array.isArray(body.contextEntities)
    ? body.contextEntities.filter((entity) => entity && typeof entity.id === 'string').slice(-200)
    : [];
  const knownContextEntityIds = new Set(contextEntities.map((entity) => entity.id));
  const knownVisualReferenceIds = new Set([
    ...knownContextEntityIds,
    ...(runtimeReferenceContext?.references || []).map((reference) => reference.id),
  ]);
  const normalizedRecentFailedTask = normalizeRecentFailedTask(body.recentFailedTask, body.messages)
    || normalizeAgentRecoveryRecord(body.clarificationState?.recoveryRecord);
  const recentFailedTask = normalizedRecentFailedTask
    && (normalizedRecentFailedTask.topicId === topicId || normalizedRecentFailedTask.topicId === 'default')
    ? {
        ...normalizedRecentFailedTask,
        contextEntityIds: normalizedRecentFailedTask.contextEntityIds.filter((id) => knownContextEntityIds.has(id)),
        visualReferenceIds: normalizedRecentFailedTask.visualReferenceIds.filter((id) => knownVisualReferenceIds.has(id)),
      }
    : null;
  const requestedRecoveryTaskId = typeof body.recoveryTaskId === 'string' ? body.recoveryTaskId.trim().slice(0, 200) : '';
  if (requestedRecoveryTaskId && requestedRecoveryTaskId !== recentFailedTask?.taskId) {
    return NextResponse.json({ error: 'Recovery task is unknown, resolved, or belongs to another Topic' }, { status: 400 });
  }
  let selectedContextEntityIds = Array.isArray(body.selectedContextEntityIds)
    ? body.selectedContextEntityIds.filter((id): id is string => typeof id === 'string').slice(0, 64)
    : [];
  const initialBriefSource = conversationIntent.brief || latestUserMessage;
  const rawUserCountResolution = plannerAuthoritative
    ? { status: 'none' as const, source: 'default' as const, candidates: [] as number[], count: undefined, matchedText: undefined }
    : extractAgentImageCount(latestUserMessage);
  const briefCountResolution = initialBriefSource === latestUserMessage
    ? rawUserCountResolution
    : extractAgentImageCount(initialBriefSource);
  const explicitBatchCountResolution = rawUserCountResolution.status !== 'none'
    ? rawUserCountResolution
    : briefCountResolution;
  const rawUserDeliveryPlan = plannerAuthoritative
    ? { mode: 'variants' as const, outputCount: 1, promptCount: 1, panelCount: undefined, variationAxes: [], evidence: [], confidence: 'low' as const, requiresClarification: false }
    : resolveImageDeliveryPlan(latestUserMessage, rawUserCountResolution.count || 1);
  const briefDeliveryPlan = initialBriefSource === latestUserMessage || plannerAuthoritative
    ? rawUserDeliveryPlan
    : resolveImageDeliveryPlan(initialBriefSource, briefCountResolution.count || 1);
  const initialDeliveryPlan = rawUserDeliveryPlan.evidence.length > 0 ? rawUserDeliveryPlan : briefDeliveryPlan;
  const explicitBatchImageRequest = !plannerAuthoritative && !body.activeSkillId
    && (
      conversationIntent.intent === 'image'
    )
    && initialDeliveryPlan.outputCount > 1;
  const shouldResolveInitialContext = !plannerAuthoritative && (
    !explicitBatchImageRequest
    || selectedContextEntityIds.length > 0
    || isReferentialShorthand(latestUserMessage)
  );
  const initialContextResolution = plannerAuthoritative
    ? { status: 'none' as const, detected: false, confidence: 'none' as const, candidates: [], entityIds: [] }
    : shouldResolveInitialContext
    ? resolveContextReference({
        userMessage: latestUserMessage,
        entities: contextEntities,
        selectedEntityIds: selectedContextEntityIds,
      })
    : { status: 'none' as const, detected: false, confidence: 'none' as const, candidates: [], entityIds: [] };
  const initialExecutionBrief = initialContextResolution.status === 'resolved'
    ? compileExecutionBrief({ userMessage: latestUserMessage, contextResolution: initialContextResolution })
    : compileExecutionBrief({
        userMessage: body.executionBrief?.plainText || initialBriefSource,
        contextResolution: { status: 'none', detected: false, confidence: 'none', candidates: [], entityIds: [] },
      });
  const contextLogger = createLogger('api.agent.context', {
    source: 'server',
    route: '/api/agent',
    requestId: runId,
    topicId,
  });

  let skillManifests;
  try {
    skillManifests = await listSkillManifests();
    if (body.activeSkillId && !skillManifests.some((manifest) => manifest.id === body.activeSkillId)) {
      throw new Error(`Unknown skill: ${body.activeSkillId}`);
    }
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Invalid skill' }, { status: 400 });
  }
  const providers = (await readProviderRegistry()).providers;
  const providerImageOptionProfiles = buildProviderImageOptionProfiles(providers);
  const requestedInterfaceImageCount = normalizeAgentImageCount(body.imageOptions?.count);
  const requestedChatModel = body.chatOptions?.model || process.env.AGENT_CHAT_MODEL || undefined;
  const requestedChatProviderId = body.chatOptions?.providerId || process.env.AGENT_CHAT_PROVIDER_ID;
  const hasReferenceInput = (
    (Array.isArray(body.referenceImages) && body.referenceImages.some((value) => typeof value === 'string' && value.trim()))
    || (Array.isArray(body.referenceContext?.references) && body.referenceContext.references.some((reference) => typeof reference?.src === 'string' && reference.src.trim()))
  );
  const imagePlanningRequest = body.intent === 'image' || Boolean(body.activeSkillId) || hasReferenceInput;
  const hasExplicitChatSelection = Boolean(body.chatOptions?.providerId || body.chatOptions?.model);
  const resolvedChatSelection = resolveProviderModelSelection({
    providers,
    purpose: 'chat',
    requestedProviderId: requestedChatProviderId,
    requestedModel: requestedChatModel,
    allowFallback: !hasExplicitChatSelection,
    excludeUnavailable: true,
  });
  if (!resolvedChatSelection.model || !resolvedChatSelection.providerId) {
    return NextResponse.json({
      error: 'No enabled chat provider and model are configured',
      reason: 'model_unavailable',
      retryable: false,
    }, { status: 400 });
  }
  const resolvedChatProvider = providers.find((provider) => provider.id === resolvedChatSelection.providerId) || null;
  const resolvedChatModelMetadata = {
    ...(resolvedChatProvider || {}),
  };
  const isRetryablePlannerProviderError = (error: unknown) => {
    const candidate = error as { statusCode?: unknown; cause?: { code?: unknown } };
    const statusCode = Number(candidate?.statusCode);
    const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
    const causeCode = typeof candidate?.cause?.code === 'string' ? candidate.cause.code.toUpperCase() : '';
    return statusCode === 524
      || message.includes('no enabled channel for model')
      || causeCode === 'EPIPE'
      || message.includes('write epipe')
      || message === 'fetch failed';
  };
  // Main Agent lifetime is bounded by provider completion, protocol budgets, or user cancellation.
  const runSignal = request.signal;
  registerActiveAgentRun(runId);
  const stream = new ReadableStream({
    async start(controller) {
      let toolCalls = 0;
      let turns = 0;
      let skillSource: AgentSkillSource | null = body.activeSkillId ? 'manual_ui' : null;
      let intent: 'chat' | 'image' | 'skill_action' = 'chat';
      let selectedSkill = body.activeSkillId
        ? skillManifests.find((manifest) => manifest.id === body.activeSkillId) || null
        : null;
      let skillSelectionMethod: SkillSelectionMethod = body.activeSkillId ? 'manual_ui' : 'none';
      let skillCandidateIds: string[] = [];
      let skillContent = '';
      let imagegenHostContent = '';
      let contextResolution = structuredClone(initialContextResolution) as AgentContextResolution;
      let executionBriefData = structuredClone(initialExecutionBrief) as ExecutionBrief;
      let executionBrief = executionBriefData.plainText;
      let executionReferenceImages = [...(body.referenceImages || [])];
      let activeClarificationState = body.clarificationState
        ? structuredClone(body.clarificationState)
        : null;
      if (activeClarificationState?.referenceContext) {
        activeClarificationState.referenceContext = normalizeAgentRuntimeReferenceContext(
          activeClarificationState.referenceContext,
        );
      }
      if (executionReferenceImages.length === 0 && activeClarificationState?.referenceImages?.length) {
        executionReferenceImages = [...activeClarificationState.referenceImages];
      }
      let stagedMainAgentMemoryPatches = Array.isArray(activeClarificationState?.mainAgentLoop?.memoryPatches)
        ? structuredClone(activeClarificationState.mainAgentLoop.memoryPatches)
        : [];
      let runReferenceContext = buildCanonicalAgentReferenceContext({
        referenceContext: runtimeReferenceContext || activeClarificationState?.referenceContext,
        referenceImages: executionReferenceImages,
        canvasContext: body.canvasContext,
      });
      let resumedClarification = false;
      let proceedWithCurrentBrief = false;
      let clarificationSubmissionKey: string | null = null;
      let requestedImageCount = requestedInterfaceImageCount;
      let requestedTotalImageCount = requestedImageCount;
      let requestedImageCountSource: AgentImageCountSource = requestedImageCount > 1 ? 'interface' : 'default';
      let imageBatchPlan: AgentImageBatchPlan | undefined;
      let imageDeliveryPlan: ImageDeliveryPlan = {
        ...initialDeliveryPlan,
        ...(activeClarificationState?.resolvedImageDeliveryMode
          ? {
              mode: activeClarificationState.resolvedImageDeliveryMode,
              panelCount: activeClarificationState.resolvedImageDeliveryMode === 'composite'
                ? activeClarificationState.resolvedImagePanelCount
                : undefined,
            }
          : {}),
      };
      const legacyExecutionPlanDetected = Boolean(
        activeClarificationState?.executionPlan
        && Number((activeClarificationState.executionPlan as any).version) !== 4,
      );
      if (legacyExecutionPlanDetected && activeClarificationState) {
        activeClarificationState.executionPlan = undefined;
      }
      let executionPlan: AgentExecutionPlan | null = activeClarificationState?.executionPlan || null;
      let lockedImageToolArgs: Record<string, unknown> | null = null;
      if (executionPlan?.generation?.aspectRatio) {
        body.imageOptions = { ...body.imageOptions, aspectRatio: executionPlan.generation.aspectRatio };
      }
      let executionPlanSource: 'model' | 'fallback' | null = executionPlan ? 'model' : null;
      let executionPlanSourceDetail: AgentPlannerSourceDetail | null = executionPlan ? 'tool_call' : null;
      let executionKind: AgentExecutionPlan['execution']['kind'] | null = executionPlan?.execution.kind || null;
      let frontDoorResult: {
        route: 'chat' | 'vision_analysis' | 'planner';
        skillId: string | null;
        confidence: 'high' | 'medium' | 'low';
      } | null = null;
      let promptCompilation: AgentImagePromptCompilation | undefined;
      let taskExecutionReservation: ReturnType<typeof reserveTaskExecution> | null = null;
      let completedTaskIdentities: AgentPendingAssetIdentity[] = [];
      let taskSnapshot: AgentTaskSnapshot | undefined;
      let recoveryBaseRecord: AgentRecoveryRecord | null = null;
      let imageOperation: 'generate' | 'edit' | null = activeClarificationState?.imageOperation
        || null;
      let targetReferenceId: string | null = activeClarificationState?.targetReferenceId
        || null;
      if (imageOperation) intent = 'image';
      let mainAgentFailureCheckpoint: AgentRecoveryRecord['mainAgentLoop'] | undefined;
      let imagePlanning: AgentImagePlanningSnapshot | null = null;
      let agentAnalysis: AgentAnalysisSnapshot | null = activeClarificationState?.agentAnalysis
        || recoveryBaseRecord?.taskSnapshot?.agentAnalysis
        || null;
      let writeImagePlanningCheckpoint = () => {};
      let writeAgentAnalysisCheckpoint = () => {};
      let plannerVisualSummary = activeClarificationState?.visualSummary || null;
      let preserveRecoveryRecordOnFailure = false;
      let recoveryTaskIdForExecution: string | null = null;
      let recoveryMode: 'fill_missing' | 'redo_all' | null = null;
      let recoveryRevisionMessage = '';
      const getTaskExecutionReservation = (runtime?: {
        kind: AgentExecutionPlan['execution']['kind'];
        tool: string;
        imageTask?: AgentImageTask;
        outputCount?: number;
      }) => {
        if (taskExecutionReservation) return taskExecutionReservation;
        if (!executionPlan && !runtime) return null;
        const contract = executionPlan
          ? buildAgentTaskContract(executionPlan)
          : {
              intent,
              skillId: selectedSkill?.id || null,
              brief: {
                deliverable: executionBrief,
                subject: executionBrief,
                style: [],
                literalCopy: [],
                constraints: [],
              },
              delivery: {
                mode: imageDeliveryPlan.mode as AgentTaskContract['delivery']['mode'],
                outputCount: runtime?.outputCount || 1,
                panelCount: imageDeliveryPlan.panelCount || null,
                variationAxes: imageDeliveryPlan.variationAxes || [],
                sharedInvariants: [],
                distinctPerItem: [],
                items: [],
              },
              ...(runtime?.imageTask ? { imageTask: structuredClone(runtime.imageTask) } : {}),
              generation: null,
              execution: {
                kind: runtime!.kind,
                requiresConfirmation: false,
                tool: runtime!.tool,
              },
            } satisfies AgentTaskContract;
        taskExecutionReservation = reserveTaskExecution(
          contract,
          executionPlan?.imageTask || runtime?.imageTask,
          executionPlan?.delivery.outputCount || runtime?.outputCount || 1,
          runReferenceContext,
          recoveryTaskIdForExecution,
        );
        const reservation = taskExecutionReservation;
        taskSnapshot = {
          topicId,
          taskId: reservation.taskId,
          contractVersion: reservation.contractVersion,
          contract: structuredClone(reservation.contract),
          latestBatchId: reservation.latestBatchId,
          editBaseVersionId: reservation.editBaseVersionId,
          activeVersions: [],
          ...(imagePlanning ? { imagePlanning: structuredClone(imagePlanning) } : {}),
        };
        writeEvent(controller, { type: 'agent_task_checkpoint', taskSnapshot: structuredClone(taskSnapshot), ...progressTracker.stamp() });
        return reservation;
      };
      const recordSucceededTaskIdentities = (identities: AgentPendingAssetIdentity[]) => {
        const reservation = getTaskExecutionReservation();
        if (!reservation || identities.length === 0) return;
        const succeededSlots = new Map(identities.map((identity) => [identity.slotId, identity]));
        const activeVersions: AgentTaskSnapshot['activeVersions'] = [];
        completedTaskIdentities = [
          ...completedTaskIdentities.filter((identity) => !succeededSlots.has(identity.slotId)),
          ...identities,
        ];
        activeVersions.push(...completedTaskIdentities.map((identity) => structuredClone(identity)));
        taskSnapshot = {
          topicId,
          taskId: reservation.taskId,
          contractVersion: reservation.contractVersion,
          contract: structuredClone(reservation.contract),
          editBaseVersionId: reservation.editBaseVersionId,
          latestBatchId: reservation.latestBatchId,
          activeVersions,
          ...(agentAnalysis ? { agentAnalysis: structuredClone(agentAnalysis) } : {}),
          ...(imagePlanning ? { imagePlanning: structuredClone(imagePlanning) } : {}),
        };
        writeEvent(controller, { type: 'agent_task_checkpoint', taskSnapshot: structuredClone(taskSnapshot), ...progressTracker.stamp() });
      };
      const writeAgentDone = (stopReason: string) => writeEvent(controller, {
        type: 'agent_done',
        stopReason,
        ...(taskSnapshot ? { taskSnapshot: structuredClone(taskSnapshot) } : {}),
        ...progressTracker.stamp(),
      });
      const sourceUserMessageId = typeof body.sourceUserMessageId === 'string' && body.sourceUserMessageId.trim()
        ? body.sourceUserMessageId.trim().slice(0, 200)
        : [...body.messages].reverse().find((message) => message.role === 'user')?.id || `user-${runId}`;
      const rootTaskId = () => recoveryBaseRecord?.taskId || activeClarificationState?.taskId || taskSnapshot?.taskId || runId;
      const rootSourceUserMessageId = () => recoveryBaseRecord?.sourceUserMessageId
        || activeClarificationState?.sourceUserMessageId
        || sourceUserMessageId;
      const rootOriginalRequest = () => recoveryBaseRecord?.originalRequest
        || activeClarificationState?.originalRequest
        || latestUserMessage;
      const buildRecoveryRecord = ({
        stage,
        message,
        reason,
        retryable,
        status = 'failed',
        resumeRoute,
      }: {
        stage: string;
        message: string;
        reason?: string;
        retryable?: boolean;
        status?: 'failed' | 'cancelled';
        resumeRoute?: AgentRecoveryRecord['resumeRoute'];
      }) => {
        const previousSnapshot = recoveryBaseRecord?.taskSnapshot;
        const nextSnapshot = taskSnapshot;
        const recoverySnapshot = !nextSnapshot?.activeVersions.length && previousSnapshot
          ? previousSnapshot
          : recoveryMode === 'fill_missing' && previousSnapshot && nextSnapshot
            ? {
                ...nextSnapshot,
                activeVersions: Array.from(new Map([
                  ...previousSnapshot.activeVersions,
                  ...nextSnapshot.activeVersions,
                ].map((version) => [version.slotId || version.versionId, version])).values()),
              }
            : nextSnapshot || previousSnapshot;
        return createAgentRecoveryRecord({
        taskId: rootTaskId(),
        runId,
        topicId,
        sourceUserMessageId: rootSourceUserMessageId(),
        status,
        resumeRoute: resumeRoute === undefined
          ? stage === 'local_delivery'
            ? 'local_delivery'
            : intent === 'image' || intent === 'skill_action' || frontDoorResult?.route === 'planner'
              ? 'main_agent'
              : recoveryBaseRecord?.resumeRoute || 'main_agent'
          : resumeRoute,
        intent: intent || recoveryBaseRecord?.intent,
        originalRequest: rootOriginalRequest(),
        failureStage: stage,
        failureReason: reason,
        failureMessage: message,
        retryability: retryable === true ? 'retryable' : retryable === false ? 'requires_change' : undefined,
        skillId: selectedSkill?.id || recoveryBaseRecord?.skillId || null,
        imageOperation: imageOperation || undefined,
        targetReferenceId: targetReferenceId || undefined,
        contextEntityIds: selectedContextEntityIds.length > 0
          ? selectedContextEntityIds
          : recoveryBaseRecord?.contextEntityIds || [],
        visualReferenceIds: runReferenceContext?.references.length
          ? runReferenceContext.references.map((reference) => reference.id)
          : recoveryBaseRecord?.visualReferenceIds || [],
        visualSummary: plannerVisualSummary || recoveryBaseRecord?.visualSummary,
        taskSnapshot: recoverySnapshot,
        mainAgentLoop: mainAgentFailureCheckpoint,
        completedAssetCount: Math.max(
          recoverySnapshot?.activeVersions.length || completedTaskIdentities.length,
          recoveryBaseRecord?.completedAssetCount || 0,
        ),
        }) as AgentRecoveryRecord;
      };
      let topicMemory = normalizeAgentConversationMemory(body.agentMemory);
      const updateTopicMemory = (patch: Record<string, unknown>) => {
        topicMemory = mergeTopicMemory(topicMemory, patch, body.messages);
        writeEvent(controller, { type: 'agent_memory_updated', memory: topicMemory });
        return topicMemory;
      };
      const commitMainAgentMemory = (patch?: Record<string, unknown>) => {
        for (const stagedPatch of stagedMainAgentMemoryPatches) {
          topicMemory = mergeTopicMemory(topicMemory, stagedPatch, body.messages);
        }
        stagedMainAgentMemoryPatches = [];
        if (patch) topicMemory = mergeTopicMemory(topicMemory, patch, body.messages);
        if (topicMemory) writeEvent(controller, { type: 'agent_memory_updated', memory: topicMemory });
        return topicMemory;
      };
      const confirmationTaskIdentity = () => {
        const reservation = getTaskExecutionReservation();
        return reservation ? {
          topicId,
          taskId: reservation.taskId,
          contractVersion: reservation.contractVersion,
          taskContract: structuredClone(reservation.contract),
          pendingTaskIdentities: structuredClone(reservation.identities),
          completedTaskIdentities: structuredClone(completedTaskIdentities),
          sourceTaskId: reservation.sourceTaskId,
          sourceVersionId: reservation.sourceVersionId,
          editBaseVersionId: reservation.editBaseVersionId,
        } : {};
      };
      const progressTracker = createAgentProgressTracker({
        runId,
        operationId: typeof body.operationId === 'string' && body.operationId.trim() ? body.operationId.trim().slice(0, 200) : runId,
        emit: (event) => writeEvent(controller, event as AgentEvent),
      });
      const getExternalSteeringMessages = () => takeActiveAgentRunInputs(runId, 'steer');
      const getExternalFollowUpMessages = () => takeActiveAgentRunInputs(runId, 'follow_up');
      const writeInteractionEvent = (event: AgentEvent) => writeEvent(controller, {
        ...event,
        ...progressTracker.stamp(),
      } as AgentEvent);
      const writeToolStartEvent = (toolCallId: string, toolName: string) => writeEvent(controller, {
        type: 'tool_start',
        toolCallId,
        toolName,
        ...progressTracker.stamp(),
      });
      const writeProgress = (input: {
        stepId: AgentProgressStepId;
        phase: AgentProgressPhase;
        status: AgentProgressStatus;
        label: string;
        toolCallId?: string;
        toolName?: string;
        detail?: string;
        completionSummary?: string;
      }) => progressTracker.update(input);
      const publicProgressByToolCallId = new Map<string, AgentPublicProgress>();
      let imagePublicProgress: AgentPublicProgress | undefined;
      const normalizePublicProgress = (value: unknown): AgentPublicProgress | undefined => {
        if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
        const raw = value as Record<string, unknown>;
        const text = (key: string, maxLength: number) => typeof raw[key] === 'string'
          ? raw[key].trim().slice(0, maxLength)
          : '';
        const progress = {
          activeLabel: text('activeLabel', 120),
          completedLabel: text('completedLabel', 120),
          completionSummary: text('completionSummary', 500),
          failedLabel: text('failedLabel', 120),
        };
        if (!Object.values(progress).some(Boolean)) return undefined;
        const promptPreparation = normalizePublicProgress(raw.promptPreparation);
        return promptPreparation ? { ...progress, promptPreparation } : progress;
      };
      const rememberToolPublicProgress = (toolCallId: string, toolName: string, args: unknown) => {
        const progress = normalizePublicProgress((args as Record<string, unknown> | undefined)?.publicProgress);
        if (!progress || !toolCallId) return undefined;
        publicProgressByToolCallId.set(toolCallId, progress);
        if (toolName === 'generate_image') imagePublicProgress = progress;
        return progress;
      };
      const copyToolPublicProgress = (
        toolCallId: string,
        progress: AgentPublicProgress | undefined,
        toolName = '',
      ) => {
        if (!toolCallId || !progress) return;
        publicProgressByToolCallId.set(toolCallId, progress);
        if (toolName === 'generate_image') imagePublicProgress = progress;
      };
      let emittedIntent: AgentIntent | null = null;
      const emitIntentResolved = (nextIntent: AgentIntent) => {
        if (emittedIntent === nextIntent) return;
        emittedIntent = nextIntent;
        writeEvent(controller, { type: 'intent_resolved', intent: nextIntent });
      };
      const ensureSelectedSkillContent = async () => {
        if (!selectedSkill || skillContent) return skillContent;
        skillContent = await loadSkillContent(selectedSkill.id);
        return skillContent;
      };
      const ensureImagegenHostContent = async () => {
        if (imagegenHostContent) return imagegenHostContent;
        imagegenHostContent = await loadSkillContent(IMAGEGEN_HOST_SKILL_ID, { includeInternal: true });
        return imagegenHostContent;
      };
      const summarizePublicToolResult = (value: unknown) => {
        if (typeof value === 'string') return value.trim().slice(0, 600);
        if (!value || typeof value !== 'object' || Array.isArray(value)) return '';
        const result = value as Record<string, unknown>;
        for (const key of ['summary', 'message', 'detail', 'status']) {
          const candidate = result[key];
          if (typeof candidate === 'string' && candidate.trim()) return candidate.trim().slice(0, 600);
        }
        if (Array.isArray(result.assets)) return `已返回 ${result.assets.length} 个结果。`;
        if (typeof result.total === 'number') return `共处理 ${result.total} 项。`;
        return '';
      };
      let activitySequence = 0;
      let currentActivity: { activityId: string; text: string; sequence?: number; timestampMs?: number } | null = null;
      let finalAssistantTextEmitted = false;
      let hasMutationEvidence = false;
      const handledAssistantTurnKeys = new Set<string>();
      const handledAssistantMessages = new WeakSet<object>();
      const appendActivityText = (activityId: string, delta: string) => {
        if (!delta) return;
        const stamp = currentActivity?.sequence
          ? { sequence: currentActivity.sequence, timestampMs: currentActivity.timestampMs }
          : progressTracker.stamp();
        currentActivity = {
          activityId,
          text: `${currentActivity?.text || ''}${delta}`,
          ...stamp,
        };
        writeEvent(controller, {
          type: 'agent_activity_delta',
          activityId,
          delta,
          model: resolvedChatSelection.model,
          ...stamp,
        });
      };
      const commitCurrentActivity = (message: any, disposition?: 'commentary' | 'final') => {
        const fullText = Array.isArray(message?.content)
          ? message.content.filter((part: any) => part?.type === 'text').map((part: any) => part.text || '').join('')
          : '';
        if (!currentActivity && !fullText) return;
        const activityId = currentActivity?.activityId || `${runId}-activity-${++activitySequence}`;
        if (fullText && (currentActivity?.text || '').length < fullText.length) {
          appendActivityText(activityId, fullText.slice(currentActivity?.text.length || 0));
        }
        if (currentActivity?.text) {
          writeEvent(controller, {
            type: 'agent_activity_commit',
            activityId,
            disposition: disposition || (message?.stopReason === 'error' || message?.stopReason === 'aborted' ? 'commentary' : 'final'),
            ...(currentActivity.sequence ? { sequence: currentActivity.sequence, timestampMs: currentActivity.timestampMs } : progressTracker.stamp()),
          });
        }
        currentActivity = null;
      };
      const emitFinalAssistantMessage = (message: any) => {
        if (finalAssistantTextEmitted) return;
        const fullText = Array.isArray(message?.content)
          ? message.content.filter((part: any) => part?.type === 'text').map((part: any) => part.text || '').join('')
          : '';
        if (!fullText.trim()) return;
        const proposal = parseAgentProposalBlock(fullText);
        const safeContent = sanitizeAgentResponseContent(proposal.cleanContent, hasMutationEvidence);
        if (proposal.proposal) writeEvent(controller, { type: 'proposal_presented', proposal: proposal.proposal });
        if (safeContent) {
          writeEvent(controller, {
            type: 'assistant_delta',
            delta: safeContent,
            channel: 'content',
            model: resolvedChatSelection.model,
            ...progressTracker.stamp(),
          });
        }
        finalAssistantTextEmitted = true;
      };
      const handleAssistantTurnComplete = ({ message, disposition }: { message: any; disposition?: 'commentary' | 'final' }) => {
        if (message && typeof message === 'object' && handledAssistantMessages.has(message)) return;
        if (message && typeof message === 'object') handledAssistantMessages.add(message);
        const calls = Array.isArray(message?.content)
          ? message.content.filter((part: any) => part?.type === 'toolCall')
          : [];
        const textContent = calls.length === 0
          ? Array.isArray(message?.content)
            ? message.content.filter((part: any) => part?.type === 'text').map((part: any) => part.text || '').join('')
            : ''
          : '';
        const turnKey = calls.length > 0
          ? `tool:${calls.map((call: any) => call.id).join(':')}`
          : `final:${message?.timestamp || currentActivity?.activityId || ''}:${textContent}`;
        if (handledAssistantTurnKeys.has(turnKey)) return;
        handledAssistantTurnKeys.add(turnKey);
        commitCurrentActivity(message, disposition || 'commentary');
        if ((disposition || 'commentary') === 'final') emitFinalAssistantMessage(message);
      };
      const writeToolUpdateEvent = (id: string, message: string) => writeEvent(controller, {
        type: 'tool_update',
        toolCallId: id,
        message,
        ...progressTracker.stamp(),
      } as AgentEvent);
      const writeToolResultEvent = (id: string, name: string, result: unknown, isError = false) => writeEvent(controller, {
        type: 'tool_result',
        toolCallId: id,
        toolName: name,
        result,
        isError,
        ...progressTracker.stamp(),
      } as AgentEvent);
      const noteToolResult = (name: string, isError = false) => {
        if (!isError && ['generate_image', 'start_skill_job'].includes(name)) hasMutationEvidence = true;
      };
      const writeStampedAgentEvent = (event: any) => {
        const lifecycle = new Set(['tool_start', 'tool_update', 'tool_result', 'assistant_delta', 'agent_activity_delta', 'agent_activity_commit', 'agent_done']);
        writeEvent(controller, lifecycle.has(event?.type) ? { ...event, ...progressTracker.stamp() } : event);
      };
      const emitMainAgentEvent = (event: any) => {
        if (event?.type === 'message_start' && event.message?.role === 'assistant') {
          currentActivity = { activityId: `${runId}-activity-${++activitySequence}`, text: '' };
          return;
        }
        if (event?.type === 'message_update' && event.assistantMessageEvent?.type === 'text_delta') {
          const activityId = currentActivity?.activityId || `${runId}-activity-${++activitySequence}`;
          appendActivityText(activityId, String(event.assistantMessageEvent.delta || ''));
          return;
        }
        if (event?.type !== 'turn_end' || event.message?.role !== 'assistant') return;
        const hasToolCall = Array.isArray(event.message.content)
          && event.message.content.some((part: any) => part?.type === 'toolCall');
        if (hasToolCall && !currentActivity) return;
        handleAssistantTurnComplete({ message: event.message, disposition: hasToolCall ? 'commentary' : 'final' });
      };
      const writeToolProgress = (
        toolName: string,
        status: 'pending' | 'active' | 'waiting' | 'completed' | 'failed',
        toolCallId: string,
        detail = '',
      ) => {
        updateActiveAgentRun(runId, {
          phase: status === 'waiting' ? 'waiting' : status === 'active' ? 'executing' : 'reasoning',
          nonInterruptible: status === 'active' && (toolName === 'generate_image' || toolName === 'start_skill_job'),
        });
        const publicProgress = publicProgressByToolCallId.get(toolCallId);
        const definitions: Record<string, {
          stepId: AgentProgressStepId;
          phase: AgentProgressPhase;
        }> = {
          generate_image: {
            stepId: 'generate_image',
            phase: 'generating',
          },
          get_canvas_context: {
            stepId: 'canvas_context',
            phase: 'reading',
          },
          get_conversation_memory: {
            stepId: 'tool',
            phase: 'reading',
          },
          list_project_context: {
            stepId: 'tool',
            phase: 'reading',
          },
          read_context_entity: {
            stepId: 'tool',
            phase: 'reading',
          },
          load_visual_reference: {
            stepId: 'tool',
            phase: 'reading',
          },
          update_conversation_memory: {
            stepId: 'tool',
            phase: 'executing',
          },
          read_relevant_context: {
            stepId: 'tool',
            phase: 'reading',
          },
          start_image_planning: {
            stepId: 'image_operation',
            phase: 'analyzing',
          },
          resolve_failed_task_recovery: {
            stepId: 'routing',
            phase: 'resuming',
          },
          request_main_agent_context: {
            stepId: 'tool',
            phase: 'reading',
          },
          classify_image_operation: {
            stepId: 'routing',
            phase: 'analyzing',
          },
          read_imagegen_context: {
            stepId: 'skill_loading',
            phase: 'loading',
          },
          submit_image_execution_plan: {
            stepId: 'tool',
            phase: 'planning',
          },
          request_context_selection: {
            stepId: 'tool',
            phase: 'waiting_input',
          },
          start_skill_job: {
            stepId: 'skill_job',
            phase: 'starting',
          },
          get_skill_job: {
            stepId: 'skill_job',
            phase: 'checking',
          },
        };
        const definition = definitions[toolName] || {
          stepId: 'tool',
          phase: 'executing',
        };
        const toolLabel = ({
          generate_image: '生成图片',
          read_context_entity: '读取上下文',
          read_relevant_context: '读取相关上下文',
          read_imagegen_context: '读取图片生成上下文',
          load_visual_reference: '加载视觉参考',
          start_skill_job: '启动 Skill 任务',
          get_skill_job: '检查 Skill 任务',
        } as Record<string, string>)[toolName] || toolName.replaceAll('_', ' ');
        const fallbackLabel = status === 'pending'
          ? `准备${toolLabel}`
          : status === 'waiting'
            ? `等待确认后${toolLabel}`
            : status === 'completed'
              ? `${toolLabel}已完成`
              : status === 'failed'
                ? `${toolLabel}失败`
                : `正在${toolLabel}`;
        const label = status === 'completed'
          ? publicProgress?.completedLabel || fallbackLabel
          : status === 'failed'
            ? publicProgress?.failedLabel || fallbackLabel
            : status === 'active'
              ? publicProgress?.activeLabel || fallbackLabel
              : fallbackLabel;
        writeProgress({
          stepId: definition.stepId,
          phase: definition.phase,
          status,
          label,
          toolCallId,
          toolName,
          ...(detail ? { detail } : {}),
          ...(status === 'completed' && publicProgress?.completionSummary ? { completionSummary: publicProgress.completionSummary } : {}),
        });
        if (status === 'active' && contextResolution.status === 'resolved') {
          void contextLogger.info('context.execution', 'Resolved context entered tool execution', {
            toolName,
            entityIds: contextResolution.entityIds,
          });
        }
      };
      const writeToolUpdate = ({ id, name, partialResult }: { id: string; name: string; partialResult: unknown }) => {
        const detail = summarizePublicToolResult(partialResult);
        writeToolUpdateEvent(id, detail);
        if (detail) writeToolProgress(name, 'active', id, detail);
      };
      const writePromptPreparationProgress = (
        status: 'active' | 'completed' | 'failed',
        toolCallId?: string,
      ) => {
        const progress = (toolCallId ? publicProgressByToolCallId.get(toolCallId) : undefined)
          || imagePublicProgress;
        const promptPreparation = progress?.promptPreparation;
        const label = status === 'completed'
          ? promptPreparation?.completedLabel || '最终图片提示词已准备'
          : status === 'failed'
            ? promptPreparation?.failedLabel || '最终图片提示词准备失败'
            : promptPreparation?.activeLabel || '正在准备最终图片提示词';
        writeProgress({
          stepId: 'prompt_optimization',
          phase: 'optimizing',
          status,
          label,
          ...(toolCallId ? { toolCallId, toolName: 'generate_image' } : {}),
          ...(status === 'completed' && promptPreparation?.completionSummary ? { completionSummary: promptPreparation.completionSummary } : {}),
        });
      };
      const generateImagePayload = async (
        sourcePrompt: string,
        imageOptions = body.imageOptions,
        referenceImages = body.referenceImages,
        generationPrompt = sourcePrompt,
        countMetadata?: { source?: AgentImageCountSource; totalCount?: number; promptOptimized?: boolean },
        generationItems: AgentImageGenerationItem[] = [],
        streamOptions?: { enabled?: boolean; toolCallId?: string },
        deliveryPlan?: ImageDeliveryPlan,
        imageTask: AgentImageTask | undefined = executionPlan?.imageTask,
        visualContext: AgentExecutionPlan['visualContext'] | undefined = executionPlan?.visualContext,
        presentation: AgentPlanPresentation | undefined = executionPlan?.presentation,
        referenceContext: AgentRuntimeReferenceContext | undefined = runReferenceContext,
        resolvedImageSelectionOverride?: { providerId: string; model: string },
      ) => {
        const outputSourceReferenceId = imageTask?.operation === 'edit'
          ? imageTask.targetReferenceId
          : imageTask?.sourceReferenceId;
        let executionReferenceContext = referenceContext;
        if (imageTask?.operation === 'edit') {
          const originalAsset = requireOriginalAsset({
            targetReferenceId: imageTask.targetReferenceId,
            references: referenceContext?.references,
          });
          const taskOriginal = 'versionId' in originalAsset ? originalAsset : null;
          const runtimeOriginal = 'id' in originalAsset ? originalAsset : null;
          const originalSrc = originalAsset.src;
          const targetReferenceId = imageTask.targetReferenceId || taskOriginal?.referenceId;
          if (!targetReferenceId) throw new Error('missing_original_asset');
          const references = [...(referenceContext?.references || [])];
          const targetIndex = references.findIndex((reference) => reference.id === targetReferenceId);
          const targetReference = {
            id: targetReferenceId,
            src: originalSrc,
            label: taskOriginal?.label || runtimeOriginal?.label || 'edit target',
            source: taskOriginal ? 'history' as const : runtimeOriginal?.source || 'upload' as const,
            role: 'edit_target' as const,
            ...(runtimeOriginal?.source === 'history' && runtimeOriginal.sourceTaskId ? { sourceTaskId: runtimeOriginal.sourceTaskId } : {}),
            ...(runtimeOriginal?.source === 'history' && runtimeOriginal.sourceVersionId ? { sourceVersionId: runtimeOriginal.sourceVersionId } : {}),
          };
          if (targetIndex >= 0) references[targetIndex] = { ...references[targetIndex], ...targetReference };
          else references.push(targetReference);
          executionReferenceContext = {
            references,
            composerSegments: referenceContext?.composerSegments || [],
            ...(referenceContext?.evidenceImages ? { evidenceImages: referenceContext.evidenceImages } : {}),
          };
        }
        const finalGenerationPrompt = String(generationPrompt || '').trim();
        if (!finalGenerationPrompt) throw new Error('Planner returned an empty image prompt');
        const payloadOutputCount = normalizeAgentImageCount(imageOptions?.count);
        const payloadDeliveryPlan = deliveryPlan
          || (executionPlan
            ? executionPlanToImageDeliveryPlan(executionPlan) as ImageDeliveryPlan
            : resolveImageDeliveryPlan(sourcePrompt, payloadOutputCount));
        const taskReservation = getTaskExecutionReservation({
          kind: 'image_pipeline',
          tool: 'generate_image',
          imageTask,
          outputCount: positiveInteger(countMetadata?.totalCount) || payloadOutputCount,
        });
        const payloadBatchMode = payloadDeliveryPlan.mode;
        const effectiveGenerationItems: AgentImageGenerationItem[] = generationItems.length
          ? generationItems
            : payloadOutputCount > 1
              ? Array.from({ length: payloadOutputCount }, (_, index) => ({
                  id: `${payloadBatchMode}-${index + 1}`,
                  index: index + 1,
                  label: payloadBatchMode === 'composite' ? `多宫格 ${index + 1}` : `变体 ${index + 1}`,
                  subject: payloadBatchMode === 'composite' ? 'composite image' : 'image variant',
                  prompt: finalGenerationPrompt,
                }))
              : [];
        if (payloadBatchMode === 'series' && payloadOutputCount > 1 && effectiveGenerationItems.length !== payloadOutputCount) {
          throw new Error(`未能形成完整的 ${payloadOutputCount} 期系列生成计划，请重试。`);
        }
        const resolvedImageSelection = resolveProviderModelSelection({
          providers,
          purpose: 'image',
          requestedProviderId: resolvedImageSelectionOverride?.providerId || imageOptions?.providerId,
          requestedModel: resolvedImageSelectionOverride?.model || imageOptions?.model,
        });
        if (!resolvedImageSelection.providerId || !resolvedImageSelection.model) {
          throw new Error('No enabled image provider and model are configured');
        }
        const resolvedProvider = providers.find((provider) => provider.id === resolvedImageSelection.providerId);
        const allowedModelIds = Array.isArray(resolvedProvider?.imageModels)
          ? resolvedProvider.imageModels
          : [resolvedImageSelection.model];
        const resolvedReferences = resolveAgentImageCardReferences({
          referenceContext: executionReferenceContext,
          referenceImages,
          imageTask,
        });
        const { options: resolvedImageOptions, requests } = buildAgentImageGenerationRequests({
          prompt: sourcePrompt,
          generationPrompt: finalGenerationPrompt,
          generationPrompts: effectiveGenerationItems.map((item) => item.prompt),
          linkedImagePreviews: resolvedReferences.linkedImagePreviews,
          referenceIds: resolvedReferences.referenceIds,
          providerId: resolvedImageSelection.providerId,
          modelId: resolvedImageSelection.model,
          allowedModelIds,
          providerImageOptionProfiles,
          contractAspectRatio: executionPlan?.generation?.aspectRatio,
          selectedAspectRatio: imageOptions?.aspectRatio,
          requestedSize: imageOptions?.size,
          requestedQuality: imageOptions?.quality,
          requestedCount: imageOptions?.count,
        });
        if (requests.length === 0) throw new Error('Image generation request is empty');
        if (requests.length !== payloadOutputCount) {
          throw new Error(`图片请求数量不一致：要求 ${payloadOutputCount} 张，实际创建 ${requests.length} 个任务。`);
        }
        if (requests.some((request) => Number(request?.n) !== 1)) {
          throw new Error('批量图片请求必须拆分为独立的 n:1 任务。');
        }
        const heartbeatToolCallId = streamOptions?.toolCallId;
        const imageProgress = (heartbeatToolCallId ? publicProgressByToolCallId.get(heartbeatToolCallId) : undefined)
          || imagePublicProgress;
        writePromptPreparationProgress('active', heartbeatToolCallId);
        requests.forEach((request, index) => {
          const prompt = request.messages?.[0]?.content;
          if (typeof prompt !== 'string' || !prompt) {
            throw new Error(`图片 ${index + 1} 的最终提示词为空。`);
          }
          writeEvent(controller, {
            type: 'image_prompts_ready',
            index,
            label: effectiveGenerationItems[index]?.label || `图片 ${index + 1}`,
            prompt,
            ...(heartbeatToolCallId ? {
              toolCallId: heartbeatToolCallId,
              completedLabel: imageProgress?.promptPreparation?.completedLabel,
              completionSummary: imageProgress?.promptPreparation?.completionSummary,
            } : {}),
            ...progressTracker.stamp(),
            ...(promptCompilation ? { compilation: promptCompilation } : {}),
          });
        });
        writePromptPreparationProgress('completed', heartbeatToolCallId);
        void contextLogger.info('image.requests_built', 'Agent image requests built', {
          requestedCount: payloadOutputCount,
          actualRequestCount: requests.length,
          countSource: countMetadata?.source || 'default',
          deliveryMode: payloadDeliveryPlan.mode,
          panelCount: payloadDeliveryPlan.panelCount || null,
          promptCount: effectiveGenerationItems.length || 1,
          imageOperation: imageTask?.operation || 'generate',
          editTargetReferenceId: imageTask?.targetReferenceId || null,
          streamed: streamOptions?.enabled === true && requests.length > 1,
          promptQuality: requests.map((request) => summarizePromptQuality(request.messages?.[0]?.content)),
        });
        const executionMode = resolveCanvasImageTaskExecutionMode({
          modelId: resolvedImageSelection.model,
          size: resolvedImageOptions.size,
          count: resolvedImageOptions.count,
        });
        const streamIncrementally = streamOptions?.enabled === true && requests.length > 1;
        const promptWasOptimized = countMetadata?.promptOptimized ?? false;
        const promptTraceForRequest = (requestIndex: number) => ({
          sourcePrompt,
          finalPrompt: String(requests[requestIndex]?.messages?.[0]?.content || ''),
          optimized: promptWasOptimized,
          operation: imageTask?.operation || 'generate' as const,
          targetReferenceId: imageTask?.targetReferenceId || null,
          skillId: promptCompilation?.skillId || null,
          skillRead: promptCompilation?.skillRead || false,
        });
        let streamedSettled = 0;
        let streamedSucceeded = 0;
        let streamedFailed = 0;
        let streamedPresentationSent = false;
        if (heartbeatToolCallId) {
          writeToolProgress('generate_image', 'active', heartbeatToolCallId);
        }
        const stopImageGenerationHeartbeat = heartbeatToolCallId
          ? startAgentImageGenerationHeartbeat({
          onPulse: () => {
            writeToolProgress('generate_image', 'active', heartbeatToolCallId);
          },
        })
          : () => {};
        let taskResults: PromiseSettledResult<any>[];
        try {
          taskResults = await settleCanvasImageGenerationRequests({
            requests,
            executionMode,
            runTask: async (requestBody: Record<string, unknown>) => {
            const generationRequest = new NextRequest(new URL('/api/generate', request.url), {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'x-z-flow-image-planner': '1',
              },
              signal: runSignal,
              body: JSON.stringify({
                ...requestBody,
                skill: selectedSkill?.id || null,
                cancelWithRequest: true,
              }),
            });
            const generationResponse = await generatePost(generationRequest);
            const generationPayload = await generationResponse.json().catch(() => null);
            if (!generationResponse.ok || generationPayload?.status !== 'completed') {
              throw new Error(generationPayload?.error || `Image generation failed (${generationResponse.status})`);
            }
            return generationPayload;
          },
            onSettled: streamIncrementally
            ? (result: PromiseSettledResult<any>, requestIndex: number) => {
                streamedSettled += 1;
                if (result.status === 'rejected') {
                  streamedFailed += 1;
                } else {
                  const assets = generatedAssetsFromResult(result.value);
                  if (assets.length > 0) {
                    streamedSucceeded += 1;
                    const item = effectiveGenerationItems[requestIndex];
                    const identity = taskReservation?.identities[requestIndex];
                    if (identity) recordSucceededTaskIdentities([{
                      ...identity,
                      assetUrl: assets[0]?.src,
                      plannerPreviewSrc: assets[0]?.src,
                      naturalWidth: assets[0]?.naturalWidth,
                      naturalHeight: assets[0]?.naturalHeight,
                      model: resolvedImageSelection.model,
                      itemId: item?.id,
                      index: requestIndex,
                      label: item?.label,
                      promptTrace: promptTraceForRequest(requestIndex),
                    }]);
                    writeEvent(controller, {
                      type: 'client_action',
                      action: {
                        type: 'add_generated_assets',
                        runId,
                        model: resolvedImageSelection.model,
                        providerId: resolvedImageSelection.providerId,
                        ...(taskReservation ? {
                          taskId: taskReservation.taskId,
                          contractVersion: taskReservation.contractVersion,
                          ...(identity?.batchId ? { batchId: identity.batchId } : {}),
                        } : {}),
                        ...(outputSourceReferenceId ? { sourceReferenceId: outputSourceReferenceId } : {}),
                        ...(taskReservation?.sourceTaskId ? { sourceTaskId: taskReservation.sourceTaskId } : {}),
                        ...(taskReservation?.sourceVersionId ? { sourceVersionId: taskReservation.sourceVersionId } : {}),
                        assets: assets.map((asset) => ({
                          src: asset.src,
                          naturalWidth: asset.naturalWidth,
                          naturalHeight: asset.naturalHeight,
                          model: resolvedImageSelection.model,
                          ...(item?.id ? { itemId: item.id } : {}),
                          index: item?.index || requestIndex + 1,
                          label: item?.label || `图片 ${requestIndex + 1}`,
                          promptTrace: promptTraceForRequest(requestIndex),
                          ...(identity ? {
                            slotId: identity.slotId,
                            versionId: identity.versionId,
                            ...(identity.parentVersionId ? { parentVersionId: identity.parentVersionId } : {}),
                            plannerPreviewSrc: asset.src,
                          } : {}),
                        })),
                        batch: {
                          total: requests.length,
                          settled: streamedSettled,
                          succeeded: streamedSucceeded,
                          failed: streamedFailed,
                        },
                        ...(!streamedPresentationSent && presentation
                          ? {
                              presentation: {
                                title: presentation.title,
                                summary: presentation.completionSummary,
                                operation: imageTask?.operation || 'generate',
                              },
                            }
                          : {}),
                      },
                    });
                    streamedPresentationSent = true;
                  } else {
                    streamedFailed += 1;
                  }
                }
                if (streamOptions?.toolCallId) {
                  writeProgress({
                    stepId: 'generate_image',
                    phase: 'generating',
                    status: 'active',
                    label: `正在生成图片（${streamedSettled}/${requests.length}）`,
                    toolCallId: streamOptions.toolCallId,
                    toolName: 'generate_image',
                  });
                }
              }
              : undefined,
          });
        } finally {
          stopImageGenerationHeartbeat();
        }
        const usableTaskResults = taskResults.map((result: PromiseSettledResult<any>) => (
          result.status === 'fulfilled'
            ? { result, assets: generatedAssetsFromResult(result.value) }
            : { result, assets: [] }
        ));
        const successfulPayloads = usableTaskResults.flatMap(({ result, assets }) => (
          result.status === 'fulfilled' && assets.length > 0 ? [result.value] : []
        ));
        const requestFailureCount = requests.length - successfulPayloads.length;
        const succeededItemIds = usableTaskResults.flatMap(({ assets }, index) => (
          assets.length > 0 && effectiveGenerationItems[index]?.id
            ? [effectiveGenerationItems[index].id]
            : []
        ));
        const failedItemIds = usableTaskResults.flatMap(({ assets }, index) => (
          assets.length === 0 && effectiveGenerationItems[index]?.id
            ? [effectiveGenerationItems[index].id]
            : []
        ));
        if (successfulPayloads.length === 0) {
          const firstFailure = taskResults.find((result: PromiseSettledResult<any>) => result.status === 'rejected');
          throw firstFailure?.status === 'rejected'
            ? firstFailure.reason
            : new Error('Image generation returned no usable outputs');
        }
        const assets = usableTaskResults.flatMap(({ assets: requestAssets }, requestIndex) => (
          requestAssets.map((asset) => ({
            ...asset,
            promptTrace: promptTraceForRequest(requestIndex),
            ...(taskReservation?.identities[requestIndex] ? {
              slotId: taskReservation.identities[requestIndex].slotId,
              versionId: taskReservation.identities[requestIndex].versionId,
              ...(taskReservation.identities[requestIndex].parentVersionId
                ? { parentVersionId: taskReservation.identities[requestIndex].parentVersionId }
                : {}),
              plannerPreviewSrc: asset.src,
            } : {}),
          }))
        ));
        if (assets.length === 0) throw new Error('Image generation returned no usable assets');
        recordSucceededTaskIdentities(usableTaskResults.flatMap(({ assets: requestAssets }, requestIndex) => {
          const identity = taskReservation?.identities[requestIndex];
          const asset = requestAssets[0];
          const item = effectiveGenerationItems[requestIndex];
          return asset && identity ? [{
            ...identity,
            assetUrl: asset.src,
            plannerPreviewSrc: asset.plannerPreviewSrc || asset.src,
            naturalWidth: asset.naturalWidth,
            naturalHeight: asset.naturalHeight,
            model: resolvedImageSelection.model,
            itemId: item?.id,
            index: requestIndex,
            label: item?.label,
            promptTrace: asset.promptTrace,
          }] : [];
        }));
        const partialFailureMessage = buildCanvasImageGenerationFailureMessage({
          requestedCount: requests.length,
          completedCount: successfulPayloads.length,
          requestFailureCount,
        });
        const payload = {
          status: 'completed',
          result: {
            type: 'image',
            outputs: assets.map((asset) => ({
              localUrl: asset.src,
              naturalWidth: asset.naturalWidth,
              naturalHeight: asset.naturalHeight,
              promptTrace: asset.promptTrace,
              ...(asset.slotId ? { slotId: asset.slotId } : {}),
              ...(asset.versionId ? { versionId: asset.versionId } : {}),
              ...(asset.parentVersionId ? { parentVersionId: asset.parentVersionId } : {}),
              ...(asset.plannerPreviewSrc ? { plannerPreviewSrc: asset.plannerPreviewSrc } : {}),
            })),
          },
          optimized: promptWasOptimized,
          requestStats: {
            requested: requests.length,
            succeeded: successfulPayloads.length,
            failed: requestFailureCount,
            ...(effectiveGenerationItems.length ? { succeededItemIds, failedItemIds } : {}),
          },
          partialFailureMessage,
          ...(outputSourceReferenceId ? { sourceReferenceId: outputSourceReferenceId } : {}),
          ...(taskReservation?.sourceTaskId ? { sourceTaskId: taskReservation.sourceTaskId } : {}),
          ...(taskReservation?.sourceVersionId ? { sourceVersionId: taskReservation.sourceVersionId } : {}),
          ...(taskReservation ? {
            taskId: taskReservation.taskId,
            contractVersion: taskReservation.contractVersion,
            ...(taskReservation.latestBatchId ? { batchId: taskReservation.latestBatchId } : {}),
          } : {}),
          streamedAssets: streamIncrementally && streamedSucceeded > 0,
          resolvedImageOptions: {
            providerId: resolvedImageSelection.providerId,
            model: resolvedImageSelection.model,
            ...resolvedImageOptions,
            requestedCount: positiveInteger(countMetadata?.totalCount) || resolvedImageOptions.count,
            countSource: countMetadata?.source || 'default',
            deliveryMode: payloadDeliveryPlan.mode,
            panelCount: payloadDeliveryPlan.panelCount,
          },
          ...(presentation
            ? {
                presentation: {
                  title: presentation.title,
                  summary: requestFailureCount > 0
                    ? `${presentation.completionSummary} 实际完成 ${successfulPayloads.length}/${requests.length} 张。`
                    : presentation.completionSummary,
                  operation: imageTask?.operation || 'generate',
                },
              }
            : {}),
        };
        return payload;
      };
      const writeResolvedImageOptionUpdate = (toolCallId: string, result: any) => {
        const resolvedOptions = result?.resolvedImageOptions;
        const updates = [];
        if (resolvedOptions?.ratioFallback) {
          updates.push(`当前模型不支持 ${resolvedOptions.requestedAspectRatio}，已使用 ${resolvedOptions.aspectRatio}`);
        }
        if (resolvedOptions?.sizeFallback) {
          updates.push(`当前模型不支持 ${resolvedOptions.requestedSize}，已使用 ${resolvedOptions.size}`);
        }
        if (resolvedOptions?.qualityFallback) {
          updates.push(`当前模型不支持 ${resolvedOptions.requestedQuality} 质量，已使用 ${resolvedOptions.quality}`);
        }
        if (result?.partialFailureMessage) updates.push(result.partialFailureMessage);
        for (const message of updates) {
          writeEvent(controller, { type: 'tool_update', toolCallId, message, ...progressTracker.stamp() });
        }
      };
      const writeImageCompletionSummary = (result: any) => {
        const presentation = result?.presentation;
        const requestStats = result?.requestStats;
        const succeeded = Number.isFinite(requestStats?.succeeded) ? Math.max(0, requestStats.succeeded) : 0;
        const failed = Number.isFinite(requestStats?.failed) ? Math.max(0, requestStats.failed) : 0;
        if (!presentation?.title || !presentation?.summary || succeeded <= 0) return;
        const summary = String(presentation.summary).includes('画布')
          ? String(presentation.summary)
          : `${String(presentation.summary)} 结果已添加到画布。`;
        writeEvent(controller, {
          type: 'agent_completion_summary',
          runId,
          title: String(presentation.title),
          summary,
          operation: presentation.operation === 'edit' ? 'edit' : 'generate',
          succeeded,
          failed,
          addedToCanvas: true,
        });
      };
      try {
        writeEvent(controller, { type: 'agent_start', runId, ...progressTracker.stamp() });
        const requestedConfirmationId = body.confirmation?.confirmationId;
        if (requestedConfirmationId) {
          pruneConfirmationStore();
          const confirmationRecord = confirmationStore.get(requestedConfirmationId);
          if (!confirmationRecord || confirmationRecord.expiresAt <= Date.now()) {
            confirmationStore.delete(requestedConfirmationId);
            throw new Error('Confirmation expired; request a new confirmation');
          }
          promptCompilation = confirmationRecord.promptCompilation
            ? structuredClone(confirmationRecord.promptCompilation)
            : undefined;
          const confirmedToolRegistry = createAgentToolRegistry({ createSkillJob, getSkillJob });
          const confirmedTool = confirmedToolRegistry.get(confirmationRecord.toolName);
          if (!confirmedTool) throw new Error(`Unknown tool: ${confirmationRecord.toolName}`);
          validateAgentToolArguments(confirmedTool.parameters, confirmationRecord.toolArgs, confirmationRecord.toolName);
          claimConfirmationContinuation({
            record: confirmationRecord,
            requestedToolName: body.confirmation?.toolName,
            userMessage: latestUserMessage,
            providers,
          });
          if (
            confirmationRecord.taskId
            && confirmationRecord.contractVersion
            && confirmationRecord.taskContract
          ) {
            if (confirmationRecord.topicId && confirmationRecord.topicId !== topicId) {
              throw new Error('Confirmation does not match this topic');
            }
            taskExecutionReservation = {
              taskId: confirmationRecord.taskId,
              contractVersion: confirmationRecord.contractVersion,
              contract: structuredClone(confirmationRecord.taskContract),
              latestBatchId: confirmationRecord.pendingTaskIdentities?.[0]?.batchId || null,
              identities: structuredClone(confirmationRecord.pendingTaskIdentities || []),
              sourceTaskId: confirmationRecord.sourceTaskId || null,
              sourceVersionId: confirmationRecord.sourceVersionId || null,
              editBaseVersionId: confirmationRecord.editBaseVersionId || null,
            };
            completedTaskIdentities = structuredClone(confirmationRecord.completedTaskIdentities || []);
            taskSnapshot = {
              topicId,
              taskId: confirmationRecord.taskId,
              contractVersion: confirmationRecord.contractVersion,
              contract: structuredClone(confirmationRecord.taskContract),
              editBaseVersionId: confirmationRecord.editBaseVersionId || null,
              latestBatchId: null,
              activeVersions: [],
            };
          }
          progressTracker.resume({
            operationId: confirmationRecord.operationId,
            lastSequence: confirmationRecord.lastSequence,
          });
          skillSource = confirmationRecord.skillSource;
          selectedSkill = confirmationRecord.skillId
            ? skillManifests.find((manifest) => manifest.id === confirmationRecord.skillId) || null
            : null;
          if (confirmationRecord.skillId && !selectedSkill) throw new Error('Confirmed skill is no longer available');
          executionBriefData = confirmationRecord.executionBrief || compileExecutionBrief({
            userMessage: confirmationRecord.generationBrief || confirmationRecord.userMessage,
          });
          executionBrief = executionBriefData.plainText;
          intent = confirmationRecord.toolName === 'generate_image' ? 'image' : 'skill_action';
          emitIntentResolved(intent);
          if (selectedSkill) {
            writeEvent(controller, {
              type: 'skill_selected',
              skillId: selectedSkill.id,
              label: selectedSkill.name,
              source: skillSource || 'recovery',
            });
          }
          const toolCallId = confirmationRecord.progressToolCallId
            || `${runId}-${confirmationRecord.toolName}-confirmed`;
          copyToolPublicProgress(toolCallId, confirmationRecord.publicProgress, confirmationRecord.toolName);
          writeToolProgress(confirmationRecord.toolName, 'active', toolCallId);
          writeToolStartEvent(toolCallId, confirmationRecord.toolName);
          if (!confirmationRecord.execution && !confirmationRecord.result) {
            confirmationRecord.execution = (async () => {
              if (confirmationRecord.toolName === 'generate_image') {
                const prompt = typeof confirmationRecord.toolArgs.prompt === 'string'
                  ? confirmationRecord.toolArgs.prompt
                  : confirmationRecord.generationBrief || confirmationRecord.userMessage;
                return generateImagePayload(
                  confirmationRecord.generationBrief || confirmationRecord.userMessage,
                  confirmationRecord.imageOptions,
                  confirmationRecord.referenceImages,
                  prompt,
                  {
                    source: confirmationRecord.imageCountSource,
                    totalCount: confirmationRecord.requestedTotalImageCount,
                    promptOptimized: confirmationRecord.promptOptimized,
                  },
                  confirmationRecord.generationItems || [],
                  {
                    enabled: (confirmationRecord.generationItems?.length || confirmationRecord.imageOptions?.count || 1) > 1,
                    toolCallId,
                  },
                  confirmationRecord.imageDeliveryPlan,
                  confirmationRecord.imageTask,
                  confirmationRecord.visualContext,
                  confirmationRecord.presentation,
                  confirmationRecord.referenceContext,
                  confirmationRecord.resolvedImageProviderId && confirmationRecord.resolvedImageModel
                    ? { providerId: confirmationRecord.resolvedImageProviderId, model: confirmationRecord.resolvedImageModel }
                    : undefined,
                );
              }
              const rawResult = await executeAgentTool(
                confirmedToolRegistry,
                confirmationRecord.toolName,
                confirmationRecord.toolArgs,
                {
                  allowedTools: confirmationRecord.allowedTools,
                  confirmed: true,
                  canvasContext: confirmationRecord.canvasContext,
                },
              );
              if (confirmationRecord.toolName === 'start_skill_job') {
                const job = rawResult as ReturnType<typeof createSkillJob>;
                return {
                  ...toJobSummary(job),
                  items: job.items.map((item) => ({ key: item.key, name: item.name, status: item.status })),
                };
              }
              return rawResult as Record<string, unknown>;
            })();
          }
          let result = confirmationRecord.result;
          if (!result) {
            try {
              result = await confirmationRecord.execution!;
            } catch (error) {
              confirmationRecord.execution = undefined;
              confirmationRecord.status = 'completed';
              throw error;
            }
          }
          confirmationRecord.result = result;
          confirmationRecord.execution = undefined;
          confirmationRecord.status = 'completed';
          if (confirmationRecord.toolName === 'generate_image') {
            writeResolvedImageOptionUpdate(toolCallId, result);
          }
          writeToolProgress(confirmationRecord.toolName, 'completed', toolCallId);
          for (const event of enrichGeneratedAssetEvents(createAgentToolResultEvents({
            source: 'confirmed',
            runId,
            toolCallId,
            toolName: confirmationRecord.toolName,
            rawResult: result,
            includeAssets: !(result as any)?.streamedAssets,
          }), result)) writeStampedAgentEvent(event);
          if (confirmationRecord.toolName === 'generate_image') {
            writeImageCompletionSummary(result);
          }
          updateTopicMemory({
            activeTask: {
              status: 'completed',
              summary: confirmationRecord.presentation?.completionSummary
                || `${confirmationRecord.toolName} completed.`,
              ...(confirmationRecord.taskId ? { taskId: confirmationRecord.taskId } : {}),
            },
            recentReferencedAssetIds: confirmationRecord.executionBrief?.resolvedEntityIds || [],
          });
          if (confirmationRecord.toolName === 'generate_image' && confirmationRecord.generationItems?.length) {
            const requestStats = (result as any)?.requestStats || {};
            const continuation = resolveAgentImageBatchContinuation({
              currentItems: confirmationRecord.generationItems,
              remainingItems: confirmationRecord.remainingGenerationItems,
              failedItemIds: Array.isArray(requestStats.failedItemIds) ? requestStats.failedItemIds : [],
            });
            if (continuation.pendingCount > 0) {
              const totalCount = positiveInteger(confirmationRecord.requestedTotalImageCount)
                || confirmationRecord.generationItems.length + (confirmationRecord.remainingGenerationItems?.length || 0);
              const completedCount = Math.max(0, totalCount - continuation.pendingCount);
              const nextItems = continuation.nextItems;
              const identityByItemId = new Map([
                ...(confirmationRecord.generationItems || []).map((item, index) => [item.id, confirmationRecord.pendingTaskIdentities?.[index]] as const),
                ...(confirmationRecord.remainingGenerationItems || []).map((item, index) => [item.id, confirmationRecord.remainingTaskIdentities?.[index]] as const),
              ]);
              const nextIdentities = nextItems.flatMap((item) => identityByItemId.get(item.id) || []);
              const remainingIdentities = continuation.remainingItems.flatMap((item) => identityByItemId.get(item.id) || []);
              const nextConfirmationId = confirmationRecord.nextConfirmationId || randomUUID();
              confirmationRecord.nextConfirmationId = nextConfirmationId;
              if (!confirmationStore.has(nextConfirmationId)) {
                const checkpoint = progressTracker.snapshot();
                confirmationStore.set(nextConfirmationId, {
                  ...confirmationRecord,
                  confirmationId: nextConfirmationId,
                  status: 'pending',
                  operationId: checkpoint.operationId,
                  lastSequence: checkpoint.lastSequence,
                  progressSequence: checkpoint.lastSequence,
                  progressToolCallId: `${checkpoint.operationId}-generate-image-batch-${completedCount + 1}`,
                  imageOptions: { ...structuredClone(confirmationRecord.imageOptions || {}), count: nextItems.length },
                  imageCountSource: 'batch',
                  requestedTotalImageCount: totalCount,
                  generationItems: structuredClone(nextItems),
                  remainingGenerationItems: structuredClone(continuation.remainingItems),
                  pendingTaskIdentities: structuredClone(nextIdentities),
                  remainingTaskIdentities: structuredClone(remainingIdentities),
                  completedTaskIdentities: structuredClone(completedTaskIdentities),
                  imageBatchPlan: {
                    totalCount,
                    completedCount,
                    remainingCount: continuation.pendingCount,
                    batchSize: AGENT_MAX_IMAGE_BATCH_COUNT,
                  },
                  nextConfirmationId: undefined,
                  execution: undefined,
                  result: undefined,
                  expiresAt: Date.now() + CONFIRMATION_TTL_MS,
                });
              }
              const succeeded = positiveInteger(requestStats.succeeded) || 0;
              const failed = positiveInteger(requestStats.failed) || 0;
              writeInteractionEvent({
                type: 'confirmation_required',
                request: {
                  confirmationId: nextConfirmationId,
                  toolName: 'generate_image',
                  message: `本批成功 ${succeeded} 张${failed ? `、失败 ${failed} 张` : ''}，还需生成 ${continuation.pendingCount} 张。下一批将生成 ${nextItems.length} 张，确认后继续。`,
                },
              });
              writeAgentDone('awaiting_confirmation');
              return;
            }
          }
          if (confirmationRecord.toolName === 'generate_image' && confirmationRecord.imageBatchPlan) {
            const succeeded = positiveInteger((result as any)?.requestStats?.succeeded)
              || generatedAssetsFromResult(result).length;
            const completedCount = Math.min(
              confirmationRecord.imageBatchPlan.totalCount,
              confirmationRecord.imageBatchPlan.completedCount + succeeded,
            );
            const remainingCount = Math.max(0, confirmationRecord.imageBatchPlan.totalCount - completedCount);
            if (remainingCount > 0) {
              const nextBatchPlan: AgentImageBatchPlan = {
                ...confirmationRecord.imageBatchPlan,
                completedCount,
                remainingCount,
              };
              const nextCount = Math.min(nextBatchPlan.batchSize, remainingCount);
              const queuedTaskIdentities = resolveRemainingConfirmationTaskIdentities({
                pendingTaskIdentities: confirmationRecord.pendingTaskIdentities,
                remainingTaskIdentities: confirmationRecord.remainingTaskIdentities,
                completedTaskIdentities,
              });
              const nextIdentities = queuedTaskIdentities.slice(0, nextCount);
              const nextConfirmationId = confirmationRecord.nextConfirmationId || randomUUID();
              confirmationRecord.nextConfirmationId = nextConfirmationId;
              if (!confirmationStore.has(nextConfirmationId)) {
                const checkpoint = progressTracker.snapshot();
                confirmationStore.set(nextConfirmationId, {
                  ...confirmationRecord,
                  confirmationId: nextConfirmationId,
                  status: 'pending',
                  operationId: checkpoint.operationId,
                  lastSequence: checkpoint.lastSequence,
                  progressSequence: checkpoint.lastSequence,
                  progressToolCallId: `${checkpoint.operationId}-generate-image-batch-${completedCount + 1}`,
                  imageOptions: { ...structuredClone(confirmationRecord.imageOptions || {}), count: nextCount },
                  imageCountSource: 'batch',
                  requestedTotalImageCount: nextBatchPlan.totalCount,
                  pendingTaskIdentities: structuredClone(nextIdentities),
                  remainingTaskIdentities: structuredClone(queuedTaskIdentities.slice(nextCount)),
                  completedTaskIdentities: structuredClone(completedTaskIdentities),
                  imageBatchPlan: nextBatchPlan,
                  nextConfirmationId: undefined,
                  execution: undefined,
                  result: undefined,
                  expiresAt: Date.now() + CONFIRMATION_TTL_MS,
                });
              }
              const failed = positiveInteger((result as any)?.requestStats?.failed) || 0;
              writeInteractionEvent({
                type: 'confirmation_required',
                request: {
                  confirmationId: nextConfirmationId,
                  toolName: 'generate_image',
                  message: `本批成功 ${succeeded} 张${failed ? `、失败 ${failed} 张` : ''}，还需生成 ${remainingCount} 张。下一批将生成 ${nextCount} 张，确认后继续。`,
                },
              });
              writeAgentDone('awaiting_confirmation');
              return;
            }
          }
          if (
            confirmationRecord.version === 1
            && confirmationRecord.piTranscript
            && confirmationRecord.pendingToolCall
            && confirmationRecord.resolvedProviderId
            && confirmationRecord.resolvedModel
          ) {
            const continuationRegistry = createAgentToolRegistry({
              createSkillJob,
              getSkillJob,
              generateImage: async (args: Record<string, unknown>, context: { toolCallId?: string }) => {
                const prompt = typeof args.prompt === 'string' && args.prompt.trim()
                  ? args.prompt.trim()
                  : confirmationRecord.generationBrief || confirmationRecord.userMessage;
                return generateImagePayload(
                  confirmationRecord.generationBrief || confirmationRecord.userMessage,
                  confirmationRecord.imageOptions,
                  confirmationRecord.referenceImages,
                  prompt,
                  {
                    source: confirmationRecord.imageCountSource,
                    totalCount: confirmationRecord.requestedTotalImageCount,
                    promptOptimized: confirmationRecord.promptOptimized,
                  },
                  confirmationRecord.generationItems || [],
                  { toolCallId: context.toolCallId },
                  confirmationRecord.imageDeliveryPlan,
                  confirmationRecord.imageTask,
                  confirmationRecord.visualContext,
                  confirmationRecord.presentation,
                  confirmationRecord.referenceContext,
                  confirmationRecord.resolvedImageProviderId && confirmationRecord.resolvedImageModel
                    ? { providerId: confirmationRecord.resolvedImageProviderId, model: confirmationRecord.resolvedImageModel }
                    : undefined,
                );
              },
            });
            const continuationRawResults = new Map<string, unknown>();
            const continuationResult = await runZFlowAgentBrain({
              messages: [],
              systemPrompt: confirmationRecord.systemPrompt,
              providerId: confirmationRecord.resolvedProviderId,
              model: confirmationRecord.resolvedModel,
              modelMetadata: providers.find((provider) => provider.id === confirmationRecord.resolvedProviderId),
              tools: getAgentModelTools(continuationRegistry, confirmationRecord.allowedTools).map((tool) => {
                const registryTool = continuationRegistry.get(tool.function.name);
                const requiresConfirmation = registryTool?.requiresConfirmation === true
                  || (tool.function.name === 'generate_image' && Number(confirmationRecord.imageOptions?.count) > 1);
                return {
                  ...tool,
                  readOnly: registryTool?.readOnly === true,
                  requiresConfirmation,
                  ...(requiresConfirmation ? { confirmationMessage: `确认后执行 ${tool.function.name}` } : {}),
                };
              }),
              maxTurns: confirmationRecord.budgets?.maxTurns || MAX_AGENT_TURNS,
              maxToolCalls: confirmationRecord.budgets?.maxToolCalls || MAX_TOOL_CALLS,
              signal: runSignal,
              chatStream,
              continuation: {
                transcript: confirmationRecord.piTranscript,
                pendingCall: confirmationRecord.pendingToolCall,
                toolResult: createAgentToolResultViews(confirmationRecord.toolName, result),
                budgets: confirmationRecord.budgets,
              },
              executeTool: async (toolName, args, context) => {
                const rawResult = await executeAgentTool(continuationRegistry, toolName, args, {
                  allowedTools: confirmationRecord.allowedTools,
                  confirmed: false,
                  canvasContext: confirmationRecord.canvasContext,
                  toolCallId: context.toolCallId,
                });
                continuationRawResults.set(String(context.toolCallId || ''), rawResult);
                return { ...rawResult as Record<string, unknown>, ...createAgentToolResultViews(toolName, rawResult) };
              },
              onEvent: emitMainAgentEvent,
              onAssistantTurnComplete: handleAssistantTurnComplete,
              onToolPending: ({ id, name, args }: any) => {
                rememberToolPublicProgress(id, name, args);
                writeToolProgress(name, 'pending', id);
              },
              onToolStart: ({ id, name, args }: any) => {
                rememberToolPublicProgress(id, name, args);
                writeToolProgress(name, 'active', id);
                writeToolStartEvent(id, name);
              },
              onToolUpdate: writeToolUpdate,
              onToolResult: ({ id, name, result: publicResult, rawResult: runtimeRawResult, isError }: any) => {
                const rawResult = continuationRawResults.get(id) ?? runtimeRawResult ?? publicResult;
                noteToolResult(name, isError);
                for (const event of enrichGeneratedAssetEvents(createAgentToolResultEvents({
                  source: 'loop',
                  runId,
                  toolCallId: id,
                  toolName: name,
                  rawResult,
                }), rawResult)) writeStampedAgentEvent(event);
                writeToolProgress(name, isError ? 'failed' : 'completed', id, summarizePublicToolResult(publicResult));
              },
            });
            if (continuationResult.stopReason === 'error' || continuationResult.stopReason === 'aborted') {
              throw new Error(continuationResult.errorMessage || (continuationResult.stopReason === 'aborted' ? 'Agent run aborted' : 'Agent provider failed'));
            }
            if (continuationResult.stopReason === 'budget_exceeded') {
              progressTracker.settleActive('failed', '工具调用预算已用尽');
              writeEvent(controller, {
                type: 'agent_error',
                stage: 'budget',
                message: '工具调用预算已用尽，请缩小任务范围后重试',
                recoveryRecord: buildRecoveryRecord({ stage: 'budget', message: '工具调用预算已用尽，请缩小任务范围后重试' }),
                ...progressTracker.stamp(),
              });
              return;
            }
            if (continuationResult.stopReason === 'confirmation_required') {
              const nextConfirmationId = randomUUID();
              const nextToolCallId = String(continuationResult.confirmation?.toolCallId || `${runId}-confirmation`);
              const nextToolName = String(continuationResult.confirmation?.toolName || confirmationRecord.toolName);
              const nextArgs = continuationResult.confirmation?.arguments && typeof continuationResult.confirmation.arguments === 'object'
                ? continuationResult.confirmation.arguments as Record<string, unknown>
                : {};
              const nextBatch = Array.isArray(continuationResult.confirmation?.batch)
                ? continuationResult.confirmation.batch as Array<{ id: string; name: string; args: Record<string, unknown> }>
                : [{ id: nextToolCallId, name: nextToolName, args: nextArgs }];
              if (nextToolName === 'generate_image' && !confirmationRecord.remainingTaskIdentities?.length) {
                throw new Error('Task identity allocation is exhausted');
              }
              const nextImageIdentity = resolveConfirmationImageIdentity({
                providers,
                toolName: nextToolName,
                requestedProviderId: confirmationRecord.imageOptions?.providerId,
                requestedModel: confirmationRecord.imageOptions?.model,
              });
              const checkpoint = progressTracker.snapshot();
              confirmationStore.set(nextConfirmationId, {
                ...confirmationRecord,
                ...nextImageIdentity,
                confirmationId: nextConfirmationId,
                runId,
                status: 'pending',
                operationId: checkpoint.operationId,
                lastSequence: checkpoint.lastSequence,
                progressToolCallId: nextToolCallId,
                toolName: nextToolName,
                toolArgs: structuredClone(nextArgs),
                publicProgress: normalizePublicProgress(nextArgs.publicProgress),
                piTranscript: structuredClone(continuationResult.transcript),
                assistantToolCallIds: nextBatch.map((call) => call.id),
                progressSequence: checkpoint.lastSequence,
                pendingToolCall: {
                  id: nextToolCallId,
                  name: nextToolName,
                  args: structuredClone(nextArgs),
                  argsHash: hashEnvelopeValue(nextArgs),
                  batch: structuredClone(nextBatch),
                },
                budgets: {
                  turnsUsed: continuationResult.turns,
                  toolCallsUsed: continuationResult.toolCalls,
                  mutationToolCallsUsed: continuationResult.mutationToolCalls,
                  maxTurns: confirmationRecord.budgets?.maxTurns || MAX_AGENT_TURNS,
                  maxToolCalls: confirmationRecord.budgets?.maxToolCalls || MAX_TOOL_CALLS,
                },
                execution: undefined,
                result: undefined,
                expiresAt: Date.now() + CONFIRMATION_TTL_MS,
              });
              copyToolPublicProgress(nextToolCallId, normalizePublicProgress(nextArgs.publicProgress), nextToolName);
              writeToolProgress(nextToolName, 'waiting', nextToolCallId);
              writeInteractionEvent({
                type: 'confirmation_required',
                request: {
                  confirmationId: nextConfirmationId,
                  toolName: nextToolName,
                  message: String(continuationResult.confirmation?.message || '此操作需要你的确认。'),
                },
              });
              writeAgentDone('awaiting_confirmation');
              return;
            }
            const continuedProposal = parseAgentProposalBlock(continuationResult.content);
            const safeContinuedContent = sanitizeAgentResponseContent(
              continuedProposal.cleanContent,
              continuationResult.mutationToolCalls > 0,
            );
            if (continuedProposal.proposal) {
              writeEvent(controller, { type: 'proposal_presented', proposal: continuedProposal.proposal });
            }
            if (safeContinuedContent && !finalAssistantTextEmitted) {
              writeEvent(controller, {
                type: 'assistant_delta',
                delta: safeContinuedContent,
                channel: 'content',
                model: confirmationRecord.resolvedModel,
              });
            }
            writeAgentDone(continuationResult.stopReason);
            return;
          }
          writeAgentDone('confirmed_tool_completed');
          return;
        }
        if (activeClarificationState?.operationId) {
          progressTracker.resume({
            operationId: activeClarificationState.operationId,
            lastSequence: activeClarificationState.lastSequence,
          });
          skillSource = activeClarificationState.skillSource ?? skillSource;
        }
        const isSkillSelectionResponse = Boolean(
          body.clarificationResponse
          && body.clarificationRequest?.dimension === 'skill_selection'
          && activeClarificationState,
        );
        const explicitSkillDirective = isSkillSelectionResponse
          ? null
          : resolveExplicitSkillDirective(latestUserMessage, skillManifests);
        let activeSkillChange: { id: string; label: string } | null | undefined;

        if (explicitSkillDirective?.type === 'clear') {
          selectedSkill = null;
          skillSource = null;
          skillSelectionMethod = 'manual_text';
          activeSkillChange = null;
        } else if (explicitSkillDirective?.type === 'select') {
          selectedSkill = explicitSkillDirective.manifest;
          skillSource = 'explicit_text';
          skillSelectionMethod = 'manual_text';
          skillCandidateIds = [selectedSkill.id];
          activeSkillChange = { id: selectedSkill.id, label: selectedSkill.name };
        } else if (isSkillSelectionResponse) {
          const selectedOptionId = String(body.clarificationResponse?.selectedOptionId || '').trim();
          const permittedIds = new Set((body.clarificationRequest?.options || []).map((option) => option.id));
          skillCandidateIds = [...permittedIds].filter((id) => id !== 'no_skill');
          if (!selectedOptionId || !permittedIds.has(selectedOptionId)) {
            throw new Error('Skill selection response does not match the pending request');
          }
          if (selectedOptionId === 'no_skill') {
            selectedSkill = null;
            skillSource = null;
            activeSkillChange = null;
            if (activeClarificationState) {
              delete activeClarificationState.skillId;
              activeClarificationState.skillSource = null;
            }
          } else {
            selectedSkill = skillManifests.find((manifest) => manifest.id === selectedOptionId) || null;
            if (!selectedSkill) throw new Error('The selected skill is no longer available; please restart the request');
            skillSource = 'user_confirmation';
            activeSkillChange = { id: selectedSkill.id, label: selectedSkill.name };
            if (activeClarificationState) {
              activeClarificationState.skillId = selectedSkill.id;
              activeClarificationState.skillSource = skillSource;
            }
          }
          skillSelectionMethod = 'user_choice';
        } else {
          const activeUiSkill = body.activeSkillId
            ? skillManifests.find((manifest) => manifest.id === body.activeSkillId) || null
            : null;
          if (activeUiSkill) {
            selectedSkill = activeUiSkill;
            skillSource = 'manual_ui';
            skillSelectionMethod = 'manual_ui';
            skillCandidateIds = [selectedSkill.id];
          } else if (activeClarificationState) {
            selectedSkill = activeClarificationState.skillId
              ? skillManifests.find((manifest) => manifest.id === activeClarificationState?.skillId) || null
              : null;
            if (activeClarificationState.skillId && !selectedSkill) {
              throw new Error('The selected skill is no longer available; please restart the request');
            }
            skillSource = selectedSkill ? activeClarificationState.skillSource || 'manual_ui' : null;
            skillSelectionMethod = selectedSkill
              ? activeClarificationState.skillSource === 'auto' ? 'model' : 'manual_ui'
              : 'none';
            skillCandidateIds = selectedSkill ? [selectedSkill.id] : [];
          } else {
            selectedSkill = null;
            skillSource = null;
            skillCandidateIds = [];
            skillSelectionMethod = 'none';
          }
        }

        if (activeSkillChange !== undefined) {
          writeEvent(controller, { type: 'active_skill_changed', skill: activeSkillChange });
        }
        void contextLogger.info('skill.selection_input', 'Explicit Skill state prepared for Main Agent Loop', {
          method: skillSelectionMethod,
          selectedSkillId: selectedSkill?.id || null,
          candidateIds: skillCandidateIds,
          skillContentLength: skillContent.length,
        });
        const mainAgentStartedAt = Date.now();
        const allowedSkillIds = new Set(skillManifests.map((manifest) => manifest.id));
        const contextEntityById = new Map(contextEntities.map((entity) => [entity.id, entity]));
        const runtimeReferenceById = new Map((runReferenceContext?.references || []).map((reference) => [reference.id, reference]));
        const validateContextIds = (ids: unknown, source: 'context' | 'visual') => {
          const values = Array.isArray(ids) ? ids.map((id) => String(id).trim()).filter(Boolean) : [];
          for (const id of values) {
            const valid = source === 'context'
              ? contextEntityById.has(id)
              : contextEntityById.has(id) || runtimeReferenceById.has(id);
            if (!valid) throw new Error(`Unknown ${source} reference: ${id}`);
          }
          return Array.from(new Set(values));
        };
        const cropMessagesToRecoverySource = (record: AgentRecoveryRecord) => {
          const sourceIndex = body.messages.findIndex((message) => message.id === record.sourceUserMessageId);
          const fallbackIndex = body.messages.findIndex((message) => (
            message.role === 'user' && message.content.trim().slice(0, 4000) === record.originalRequest
          ));
          const endIndex = sourceIndex >= 0 ? sourceIndex : fallbackIndex;
          const history = endIndex >= 0 ? body.messages.slice(0, endIndex + 1) : [];
          if (history.at(-1)?.role === 'user' && history.at(-1)?.content.trim() === record.originalRequest) return history;
          return [...history, { id: record.sourceUserMessageId, role: 'user' as const, content: record.originalRequest }];
        };
        let mainAgentInputMessages = body.messages;
        let mainAgentReferenceImages = body.referenceImages || [];
        let mainAgentReferenceContext = runtimeReferenceContext;
        const initiallyAttachedVisualIds = new Set(
          (mainAgentReferenceContext?.references || []).map((reference) => reference.id),
        );
        const loadedVisualReferenceIds = new Set(initiallyAttachedVisualIds);
        let plannerHistoryMessages = body.messages;

        const handleFailedTask = (record: AgentRecoveryRecord, args: Record<string, unknown>) => {
          const action = String(args.action || '');
          if (action === 'inspect') {
            return {
              modelResult: {
                taskId: record.taskId,
                failureStage: record.failure.stage,
                failureMessage: record.failure.message,
                originalRequest: record.originalRequest.slice(0, 1200),
              },
              publicResult: { inspected: true },
            };
          }
          if (!['resume', 'continue_current_request'].includes(action)) {
            throw new Error('失败任务操作无效');
          }
          const route = action === 'resume' ? record.resumeRoute : null;
          if (action === 'resume' && !route) throw new Error('保存的任务没有可用恢复阶段');
          const skillId = action === 'resume'
            ? record.taskSnapshot?.imagePlanning?.skill?.id || record.skillId || null
            : null;
          if (skillId && !allowedSkillIds.has(skillId)) throw new Error(`恢复任务使用的 Skill 已不可用：${skillId}`);
          return {
            terminate: true,
            type: 'recovery_resolution',
            taskId: record.taskId,
            decision: action,
            route,
            skillId,
            revision: typeof args.revision === 'string' ? args.revision.trim().slice(0, 4000) : '',
            modelResult: { accepted: true },
            publicResult: { accepted: true },
          };
        };

        const runRecoveryGate = async (
          record: AgentRecoveryRecord,
        ) => {
          const recoveryRegistry = createAgentToolRegistry({
            handleFailedTask: async (args: Record<string, unknown>) => handleFailedTask(record, args),
          });
          const recoveryTools = getAgentModelTools(recoveryRegistry, ['handle_failed_task']);
          const result = await runZFlowAgentBrain({
            messages: (buildFailedTaskRecoveryMessages as any)({
              userMessage: latestUserMessage,
              recoveryRecord: record,
            }),
            providerId: resolvedChatSelection.providerId!,
            model: resolvedChatSelection.model!,
            modelMetadata: resolvedChatModelMetadata,
            tools: recoveryTools,
            toolChoice: 'auto',
            maxTurns: 2,
            maxToolCalls: 1,
            signal: runSignal,
            chatStream,
            executeTool: async (toolName, args, context) => {
              try {
                return await executeAgentTool(recoveryRegistry, toolName, args, {
                  allowedTools: ['handle_failed_task'],
                  confirmed: false,
                  toolCallId: context.toolCallId,
                });
              } catch (error) {
                return {
                  terminate: true,
                  type: 'recovery_entry_error',
                  message: error instanceof Error ? error.message : '失败任务操作无效',
                  modelResult: { accepted: false },
                  publicResult: { accepted: false },
                };
              }
            },
            onEvent: emitMainAgentEvent,
            onAssistantTurnComplete: handleAssistantTurnComplete,
            onToolPending: ({ id, name, args }: any) => {
              rememberToolPublicProgress(id, name, args);
              writeToolProgress(name, 'pending', id);
            },
            onToolStart: ({ id, name, args }: any) => {
              rememberToolPublicProgress(id, name, args);
              writeToolProgress(name, 'active', id);
              writeToolStartEvent(id, name);
            },
            onToolUpdate: writeToolUpdate,
            onToolResult: ({ id, name, result, isError }: any) => {
              noteToolResult(name, isError);
              writeToolResultEvent(id, name, result, isError);
              writeToolProgress(name, isError ? 'failed' : 'completed', id, summarizePublicToolResult(result));
            },
          });
          if (result.terminal?.type === 'recovery_resolution') return result.terminal as Record<string, unknown>;
          if (result.terminal?.type === 'recovery_entry_error') {
            throw new Error(`失败任务处理失败：${String(result.terminal.message || '参数无效')}`);
          }
          const directResponse = String(result.content || '').trim();
          if (directResponse && !finalAssistantTextEmitted) {
            return {
              decision: 'direct_response',
              content: directResponse,
              confidence: 'high',
            };
          }
          throw new Error('失败任务入口未返回有效结果，请重试');
        };

        const recoveryRecord = recentFailedTask as AgentRecoveryRecord | null;
        const recoveryLockedSkillId = recoveryRecord?.taskSnapshot?.imagePlanning?.skill?.id
          || recoveryRecord?.skillId
          || null;
        let recoveryResolution: Record<string, unknown> | null = null;
        if (recoveryRecord && body.clarificationRequest?.dimension === 'recovery_scope' && body.clarificationResponse) {
          const selectedMode = body.clarificationResponse.selectedOptionId;
          if (!['fill_missing', 'redo_all'].includes(selectedMode || '')) throw new Error('Recovery scope selection is invalid');
          recoveryMode = selectedMode as 'fill_missing' | 'redo_all';
          if (activeClarificationState) activeClarificationState.recoveryMode = recoveryMode;
          recoveryResolution = {
            decision: 'resume',
            route: recoveryRecord.resumeRoute,
            skillId: recoveryLockedSkillId,
            confidence: 'high',
          };
        } else if (recoveryRecord && requestedRecoveryTaskId) {
          recoveryResolution = recoveryRecord.resumeRoute ? {
                decision: 'resume',
                route: recoveryRecord.resumeRoute,
                skillId: recoveryLockedSkillId,
              } : await runRecoveryGate(recoveryRecord);
        } else if (
          recoveryRecord
          && !body.confirmation
          && !body.clarificationResponse
          && body.intent !== 'image'
          && selectedSkill?.executionMode !== 'image_pipeline'
        ) {
          recoveryResolution = await runRecoveryGate(recoveryRecord);
        }

        if (recoveryRecord && recoveryResolution?.decision === 'direct_response') {
          writeEvent(controller, {
            type: 'assistant_delta',
            delta: String(recoveryResolution.content || ''),
            channel: 'content',
            model: resolvedChatSelection.model,
          });
          writeAgentDone('completed');
          return;
        }

        if (recoveryRecord && recoveryResolution?.decision === 'continue_current_request') {
          recoveryBaseRecord = null;
          imageOperation = null;
          targetReferenceId = null;
          preserveRecoveryRecordOnFailure = false;
        }
        if (recoveryRecord && recoveryResolution?.decision === 'resume') {
          recoveryBaseRecord = recoveryRecord;
          preserveRecoveryRecordOnFailure = false;
          recoveryTaskIdForExecution = recoveryRecord.taskId;
          writeProgress({
            stepId: 'routing',
            phase: 'resuming',
            status: 'completed',
            label: recoveryResolution.route === 'main_agent' ? '已定位上次任务，正在继续分析' : '已定位上次任务，正在重新规划',
          });
          void contextLogger.info('task.resumed', 'Agent resumed the latest failed root task', {
            taskId: recoveryRecord.taskId,
            runId,
            sourceRunId: recoveryRecord.runId,
            skillId: recoveryResolution.skillId || recoveryRecord.skillId || null,
            route: recoveryResolution.route,
          });
          imageOperation = recoveryRecord.imageOperation || imageOperation;
          targetReferenceId = recoveryRecord.targetReferenceId || targetReferenceId;
          recoveryRevisionMessage = typeof recoveryResolution.revision === 'string'
            ? recoveryResolution.revision.trim()
            : '';
          if (recoveryResolution.skillId) {
            selectedSkill = skillManifests.find((manifest) => manifest.id === recoveryResolution.skillId) || null;
            if (!selectedSkill) throw new Error('Recovery Skill is no longer enabled');
            skillSource = 'recovery';
            skillSelectionMethod = 'none';
            skillCandidateIds = [selectedSkill.id];
          } else {
            selectedSkill = null;
            skillSource = null;
            skillSelectionMethod = 'none';
            skillCandidateIds = [];
          }
          if (recoveryRecord.completedAssetCount > 0 && recoveryResolution.route === 'main_agent' && !recoveryMode) {
            const request: AgentClarificationRequest = {
              id: randomUUID(),
              taskId: recoveryRecord.taskId,
              question: `上次已有 ${recoveryRecord.completedAssetCount} 个素材完成，这次要如何继续？`,
              dimension: 'recovery_scope',
              options: [
                { id: 'fill_missing', label: '只补齐未完成项', answer: '只生成缺失的素材，保留已完成结果。' },
                { id: 'redo_all', label: '全部重做', answer: '忽略已完成结果，重新生成完整任务。' },
              ],
              allowCustom: false,
              allowProceed: false,
            };
            const checkpoint = progressTracker.snapshot();
            writeInteractionEvent({
              type: 'clarification_required',
              message: request.question,
              request,
              state: {
                taskId: recoveryRecord.taskId,
                sourceUserMessageId: recoveryRecord.sourceUserMessageId,
                operationId: checkpoint.operationId,
                skillSource,
                lastSequence: checkpoint.lastSequence,
                intent: recoveryRecord.intent === 'skill_action' ? 'skill_action' : 'image',
                ...(recoveryRecord.skillId ? { skillId: recoveryRecord.skillId, skillRead: false } : {}),
                originalRequest: recoveryRecord.originalRequest,
                workingBrief: recoveryRecord.originalRequest,
                askedDimensions: ['recovery_scope'],
                answers: [],
                recoveryRecord,
              },
            });
            writeAgentDone('recovery_scope_required');
            return;
          }
          plannerHistoryMessages = cropMessagesToRecoverySource(recoveryRecord);
          if (recoveryRevisionMessage) {
            const revisionSource = [...body.messages].reverse().find((message) => message.role === 'user');
            plannerHistoryMessages.push({
              id: revisionSource?.id || `revision-${runId}`,
              role: 'user',
              content: recoveryRevisionMessage,
            });
          }
          const recoveredReferenceContext = recoveryRecord.visualReferenceIds.length > 0
            ? normalizeAgentRuntimeReferenceContext({
                references: recoveryRecord.visualReferenceIds.map((id) => {
                  const runtimeReference = runtimeReferenceById.get(id);
                  const entity = contextEntityById.get(id);
                  const src = runtimeReference?.src || entity?.assetUrl || entity?.referenceImageUrls?.[0];
                  if (!src) throw new Error(`Visual reference is unavailable: ${id}`);
                  return runtimeReference || {
                    id,
                    src,
                    label: entity?.label || id,
                    source: entity?.kind === 'canvas_item' ? 'canvas' : 'history',
                    role: 'reference',
                  };
                }),
                composerSegments: [
                  { type: 'text', text: recoveryRecord.originalRequest },
                  ...recoveryRecord.visualReferenceIds.map((referenceId) => ({ type: 'reference' as const, referenceId })),
                ],
              })
            : undefined;
          if (recoveryResolution.route === 'main_agent') {
            mainAgentInputMessages = plannerHistoryMessages;
            mainAgentReferenceImages = body.referenceImages?.length
              ? body.referenceImages
              : recoveredReferenceContext?.references.map((reference) => reference.src) || [];
            mainAgentReferenceContext = runtimeReferenceContext || recoveredReferenceContext;
          } else if (recoveryResolution.route === 'local_delivery') {
            const versions = recoveryRecord.taskSnapshot?.activeVersions || [];
            const assets = versions.flatMap((version) => {
              const entity = contextEntityById.get(version.referenceId);
              const src = version.assetUrl || entity?.assetUrl || entity?.referenceImageUrls?.[0];
              return src ? [{
                src,
                slotId: version.slotId,
                versionId: version.versionId,
                plannerPreviewSrc: version.plannerPreviewSrc,
                naturalWidth: version.naturalWidth,
                naturalHeight: version.naturalHeight,
                model: version.model,
                itemId: version.itemId,
                index: version.index,
                label: version.label,
                promptTrace: version.promptTrace,
              }] : [];
            });
            if (assets.length === 0) throw new Error('已生成素材不再可读取，无法重新交付');
            writeEvent(controller, {
              type: 'client_action',
              action: { type: 'add_generated_assets', runId, taskId: recoveryRecord.taskId, assets },
            });
            writeAgentDone('local_delivery_recovered');
            return;
          } else {
            mainAgentInputMessages = plannerHistoryMessages;
            mainAgentReferenceImages = [];
            mainAgentReferenceContext = runtimeReferenceContext || recoveredReferenceContext;
          }
        }
        const selectedImageOperationResponse = body.clarificationRequest?.dimension === 'image_operation'
          ? resolveImageOperationResponse(body.clarificationResponse)
          : null;
        if (selectedImageOperationResponse) {
          imageOperation = selectedImageOperationResponse;
          intent = 'image';
          if (imageOperation === 'generate') targetReferenceId = null;
        }
        const restoredMainAgentLoop = activeClarificationState?.mainAgentLoop || recoveryBaseRecord?.mainAgentLoop;
        const mainAgentLoopState = {
          contextRequested: Boolean(restoredMainAgentLoop?.contextScopes?.length),
          contextScopes: new Set<'conversation' | 'project'>(restoredMainAgentLoop?.contextScopes || []),
          selectedSkillId: selectedSkill?.id || null,
          skillRead: hasExplicitImagegenContextTranscript(restoredMainAgentLoop),
        };
        const relevantContextCandidateIds = new Set<string>();
        const planningSkillSource: 'manual_ui' | 'explicit_text' | 'user_confirmation' | 'recovery' | null = selectedSkill
          ? recoveryBaseRecord?.skillId === selectedSkill.id
            ? 'recovery'
            : skillSelectionMethod === 'manual_text'
              ? 'explicit_text'
              : skillSelectionMethod === 'user_choice'
                ? 'user_confirmation'
                : 'manual_ui'
          : null;
        const planningPromptFormat: 'text' | 'json-text' = selectedSkill?.promptStyle === 'json-text'
          ? 'json-text'
          : 'text';
        const imagePlanningDefaults = {
          taskId: rootTaskId(),
          runId,
          sourceUserMessageId: rootSourceUserMessageId(),
          originalRequest: rootOriginalRequest(),
          referenceIds: [...runtimeReferenceById.keys()],
          outputCount: recoveryBaseRecord?.taskSnapshot?.imagePlanning?.outputCount || requestedImageCount,
          aspectRatio: body.imageOptions?.aspectRatio || selectedSkill?.aspectRatio || AGENT_DEFAULT_IMAGE_OPTIONS.aspectRatio,
          promptFormat: planningPromptFormat,
          deliveryMode: null,
          panelCount: null,
          skill: selectedSkill && planningSkillSource ? {
            id: selectedSkill.id,
            source: planningSkillSource,
            read: mainAgentLoopState.skillRead,
            manifest: {
              executionMode: selectedSkill.executionMode,
              promptStyle: selectedSkill.promptStyle,
              aspectRatio: selectedSkill.aspectRatio,
              allowedTools: [...selectedSkill.allowedTools],
              planningGuidance: selectedSkill.planningGuidance,
              generationContract: selectedSkill.generationContract,
            },
          } : null,
        };
        const savedImagePlanning = activeClarificationState?.imagePlanning || recoveryBaseRecord?.taskSnapshot?.imagePlanning;
        imagePlanning = savedImagePlanning
          ? restoreImagePlanningSnapshot(savedImagePlanning, imagePlanningDefaults)
          : selectedImageOperationResponse
            ? restoreImagePlanningSnapshot(null, imagePlanningDefaults)
            : null;
        if (imagePlanning) {
          imagePlanning.runId = activeClarificationState?.imagePlanning?.runId || runId;
          if (!savedImagePlanning) {
            imagePlanning.referenceIds = [...runtimeReferenceById.keys()];
            imagePlanning.skill = imagePlanningDefaults.skill;
          } else if (imagePlanning.skill && !mainAgentLoopState.skillRead) {
            imagePlanning.skill.read = false;
          }
          if (imageOperation && imagePlanning.currentStage === 'routing') {
            imagePlanning.decision = imageOperation;
            imagePlanning.operation = imageOperation;
          }
          if (!executionPlan && imagePlanning.executionPlan) {
            executionPlan = structuredClone(imagePlanning.executionPlan) as unknown as AgentExecutionPlan;
            executionPlanSource = 'model';
            executionPlanSourceDetail = 'tool_call';
            executionKind = executionPlan.execution.kind;
            imageDeliveryPlan = executionPlanToImageDeliveryPlan(executionPlan) as ImageDeliveryPlan;
          }
        }
        const analysisDefaults = {
          taskId: rootTaskId(),
          runId,
          originalRequest: rootOriginalRequest(),
          uiMode: body.intent === 'image' || body.intent === 'chat' ? body.intent : 'agent',
          selectedSkillId: selectedSkill?.id || null,
          explicitReferenceIds: [...runtimeReferenceById.keys()],
          ...(imageOperation ? { operation: imageOperation } : {}),
        };
        const savedAgentAnalysis = activeClarificationState?.agentAnalysis || recoveryBaseRecord?.taskSnapshot?.agentAnalysis;
        agentAnalysis = savedAgentAnalysis ? restoreAgentAnalysisSnapshot(savedAgentAnalysis, analysisDefaults) : null;
        if (agentAnalysis && body.clarificationResponse && body.clarificationRequest) {
          const answer = body.clarificationResponse.customText
            || body.clarificationRequest.options.find((option) => option.id === body.clarificationResponse?.selectedOptionId)?.answer
            || '';
          if (answer) recordAgentUserDecision(agentAnalysis, body.clarificationRequest.dimension, answer);
        }
        writeAgentAnalysisCheckpoint = () => {
          if (!agentAnalysis) return;
          const previous = taskSnapshot || recoveryBaseRecord?.taskSnapshot;
          taskSnapshot = {
            topicId,
            taskId: agentAnalysis.taskId,
            contractVersion: previous?.contractVersion || 1,
            ...(previous?.contract ? { contract: structuredClone(previous.contract) } : {}),
            ...(imagePlanning ? { imagePlanning: structuredClone(imagePlanning) } : previous?.imagePlanning ? { imagePlanning: structuredClone(previous.imagePlanning) } : {}),
            ...(previous?.editBaseVersionId !== undefined ? { editBaseVersionId: previous.editBaseVersionId } : {}),
            ...(previous?.latestBatchId !== undefined ? { latestBatchId: previous.latestBatchId } : {}),
            activeVersions: structuredClone(previous?.activeVersions || []),
            agentAnalysis: structuredClone(agentAnalysis),
          };
          writeEvent(controller, { type: 'agent_task_checkpoint', taskSnapshot: structuredClone(taskSnapshot), ...progressTracker.stamp() });
        };
        writeImagePlanningCheckpoint = () => {
          if (!imagePlanning) return;
          const previous = taskSnapshot || recoveryBaseRecord?.taskSnapshot;
          taskSnapshot = {
            topicId,
            taskId: imagePlanning.taskId,
            contractVersion: previous?.contractVersion || 1,
            ...(previous?.contract ? { contract: structuredClone(previous.contract) } : {}),
            ...(previous?.editBaseVersionId !== undefined ? { editBaseVersionId: previous.editBaseVersionId } : {}),
            ...(previous?.latestBatchId !== undefined ? { latestBatchId: previous.latestBatchId } : {}),
            activeVersions: structuredClone(previous?.activeVersions || []),
            ...(agentAnalysis ? { agentAnalysis: structuredClone(agentAnalysis) } : {}),
            imagePlanning: structuredClone(imagePlanning),
          };
          writeEvent(controller, { type: 'agent_task_checkpoint', taskSnapshot: structuredClone(taskSnapshot), ...progressTracker.stamp() });
          void contextLogger.info('image_planning.checkpoint', 'Saved image planning checkpoint', {
            taskId: imagePlanning.taskId,
            runId: imagePlanning.runId,
            stage: imagePlanning.currentStage,
            skillId: imagePlanning.skill?.id || null,
            operation: imagePlanning.operation,
            revision: imagePlanning.revision,
          });
        };
        if (imagePlanning) writeImagePlanningCheckpoint();
        const loadImagegenContext = async ({ allowExisting = false, source = 'runtime' }: {
          allowExisting?: boolean;
          source?: 'runtime' | 'model';
        } = {}) => {
          if (mainAgentLoopState.skillRead && !allowExisting) throw new Error('ImageGen context may be read only once per task');
          const hostContent = await ensureImagegenHostContent();
          const hostContentHash = createHash('sha256').update(hostContent).digest('hex');
          const visualContent = selectedSkill ? await ensureSelectedSkillContent() : '';
          const visualContentHash = visualContent ? createHash('sha256').update(visualContent).digest('hex') : '';
          const savedContext = imagePlanning?.imagegenContext;
          if (savedContext?.host?.contentHash && savedContext.host.contentHash !== hostContentHash) {
            throw new Error('The ImageGen host Skill changed after this task was created');
          }
          if (savedContext?.visualSkill?.contentHash && savedContext.visualSkill.contentHash !== visualContentHash) {
            throw new Error('The locked visual Skill changed after this task was created');
          }
          if (!imagePlanning) imagePlanning = restoreImagePlanningSnapshot(null, imagePlanningDefaults);
          mainAgentLoopState.skillRead = true;
          imagePlanning.imagegenContext = {
            host: { id: IMAGEGEN_HOST_SKILL_ID, contentHash: hostContentHash },
            visualSkill: selectedSkill ? { id: selectedSkill.id, contentHash: visualContentHash } : null,
          };
          if (imagePlanning.skill && selectedSkill) {
            imagePlanning.skill.read = true;
            imagePlanning.skill.contentHash = visualContentHash;
          }
          writeImagePlanningCheckpoint();
          void contextLogger.info('imagegen.context_read', 'Runtime loaded the ImageGen host and locked visual Skill', {
            source,
            hostContentLength: hostContent.length,
            hostContentHash,
            visualSkillId: selectedSkill?.id || null,
            visualContentLength: visualContent.length,
            visualContentHash: visualContentHash || null,
          });
          return {
            hostSkill: { id: IMAGEGEN_HOST_SKILL_ID, content: hostContent, contentHash: hostContentHash },
            visualSkill: selectedSkill ? { id: selectedSkill.id, content: visualContent, contentHash: visualContentHash } : null,
          };
        };
        const mainAgentRegistry = createAgentToolRegistry({
          readImagegenContext: async () => {
            emitIntentResolved('image');
            const context = await loadImagegenContext({ source: 'model' });
            return {
              modelResult: context,
              publicResult: {
                hostSkill: { id: context.hostSkill.id, contentHash: context.hostSkill.contentHash },
                visualSkill: context.visualSkill
                  ? { id: context.visualSkill.id, contentHash: context.visualSkill.contentHash }
                  : null,
              },
            };
          },
          generateImage: async (args: Record<string, unknown>, context: { publicProgress?: unknown }) => {
            const operation = String(args.operation || '');
            if (operation !== 'generate' && operation !== 'edit') throw new Error('图片操作必须是 generate 或 edit');
            const prompt = String(args.prompt || '').trim();
            if (!prompt) throw new Error('最终图片提示词不能为空');
            const publicProgress = normalizePublicProgress(context.publicProgress);
            const referenceIds = Array.from(new Set(
              (Array.isArray(args.referenceIds) ? args.referenceIds : []).map((value) => String(value).trim()).filter(Boolean),
            ));
            if (referenceIds.some((id) => !runtimeReferenceById.has(id))) {
              throw new Error('图片引用已失效，请重新选择后重试');
            }
            const requestedTargetReferenceId = typeof args.targetReferenceId === 'string'
              ? args.targetReferenceId.trim()
              : '';
            if (operation === 'edit' && (!requestedTargetReferenceId || !referenceIds.includes(requestedTargetReferenceId))) {
              throw new Error('编辑任务必须锁定一个已选参考图作为目标');
            }
            if (operation === 'generate' && requestedTargetReferenceId) {
              throw new Error('生成任务不能指定编辑目标');
            }
            const outputCount = positiveInteger(args.outputCount) || imagePlanningDefaults.outputCount || 1;
            const deliveryMode = ['single', 'variants', 'series', 'composite'].includes(String(args.deliveryMode || ''))
              ? String(args.deliveryMode) as 'single' | 'variants' | 'series' | 'composite'
              : outputCount > 1 ? 'variants' : 'single';
            const panelCount = deliveryMode === 'composite'
              ? Math.max(2, positiveInteger(args.panelCount) || 2)
              : null;
            const requestedAspectRatio = typeof args.aspectRatio === 'string' ? args.aspectRatio : '';
            const aspectRatio = requestedAspectRatio || imagePlanningDefaults.aspectRatio || selectedSkill?.aspectRatio || AGENT_DEFAULT_IMAGE_OPTIONS.aspectRatio;
            const generationItems = (Array.isArray(args.items) ? args.items : [])
              .map((item, index) => ({
                index: index + 1,
                label: `系列 ${index + 1}`,
                prompt: String((item as Record<string, unknown>)?.prompt || '').trim(),
              }))
              .filter((item) => item.prompt);
            if (deliveryMode === 'series' && generationItems.length !== outputCount) {
              throw new Error(`系列生成需要 ${outputCount} 条逐项提示词`);
            }

            imageOperation = operation;
            targetReferenceId = operation === 'edit' ? requestedTargetReferenceId : null;
            intent = 'image';
            lockedImageToolArgs = {
              operation,
              prompt,
              referenceIds: [...referenceIds],
              targetReferenceId,
              outputCount,
              aspectRatio,
              deliveryMode,
              panelCount,
              items: generationItems.map((item) => ({ prompt: item.prompt })),
            };
            emitIntentResolved('image');
            imagePlanningDefaults.outputCount = outputCount;
            imagePlanningDefaults.aspectRatio = aspectRatio;
            imagePlanningDefaults.deliveryMode = deliveryMode;
            imagePlanningDefaults.panelCount = panelCount;
            requestedTotalImageCount = outputCount;
            requestedImageCount = Math.min(outputCount, AGENT_MAX_IMAGE_BATCH_COUNT);
            requestedImageCountSource = 'prompt';
            body.imageOptions = { ...body.imageOptions, aspectRatio };
            if (!imagePlanning) imagePlanning = restoreImagePlanningSnapshot(null, imagePlanningDefaults);
            imagePlanning.decision = operation;
            imagePlanning.operation = operation;
            imagePlanning.targetReferenceId = targetReferenceId;
            imagePlanning.referenceIds = referenceIds;
            imagePlanning.outputCount = outputCount;
            imagePlanning.aspectRatio = aspectRatio;
            imagePlanning.deliveryMode = deliveryMode;
            imagePlanning.panelCount = panelCount;
            imagePlanning.resolvedRequirement = prompt;

            const directPlan: AgentExecutionPlan = {
              version: 4,
              intent: 'image',
              skillId: selectedSkill?.id || null,
              confidence: 'high',
              needsClarification: false,
              clarification: null,
              contextReferences: referenceIds,
              visualContext: {
                references: referenceIds.map((referenceId) => {
                  const reference = runtimeReferenceById.get(referenceId);
                  return {
                    referenceId,
                    summary: String(reference?.description || reference?.label || referenceId),
                    salientSubjects: [],
                    visibleText: [],
                    styleAndComposition: '',
                    inferredRole: referenceId === targetReferenceId ? 'edit_target' : 'content_reference',
                  };
                }),
                targetSelectionReason: null,
                targetSelectionConfidence: null,
              },
              imageTask: {
                operation,
                targetReferenceId,
                supportingReferenceIds: referenceIds.filter((referenceId) => referenceId !== targetReferenceId),
                instruction: prompt,
                mustChange: [],
                mustPreserve: [],
              },
              presentation: {
                title: publicProgress?.completedLabel || (operation === 'edit' ? '图片编辑' : '图片生成'),
                completionSummary: publicProgress?.completionSummary || (operation === 'edit' ? '图片编辑完成。' : '图片生成完成。'),
              },
              brief: { deliverable: 'image', subject: prompt, style: [], literalCopy: [], constraints: [] },
              delivery: {
                mode: deliveryMode,
                outputCount,
                panelCount,
                variationAxes: [],
                sharedInvariants: [],
                distinctPerItem: [],
                items: generationItems.map((item) => ({
                  index: item.index,
                  label: item.label,
                  subject: item.label,
                  variation: item.label,
                })),
              },
              generation: { aspectRatio, promptFormat: 'text', prompt, items: generationItems },
              execution: { kind: 'image_pipeline', requiresConfirmation: false, tool: 'generate_image' },
            };
            executionPlan = directPlan;
            executionPlanSource = 'model';
            executionPlanSourceDetail = 'tool_call';
            executionKind = 'image_pipeline';
            imageDeliveryPlan = {
              mode: deliveryMode === 'single' ? 'variants' : deliveryMode,
              outputCount,
              promptCount: deliveryMode === 'series' ? outputCount : 1,
              panelCount: deliveryMode === 'composite' ? panelCount || 2 : 0,
              variationAxes: [],
              evidence: ['direct_tool'],
              confidence: 'high',
              requiresClarification: false,
            };
            executionBriefData = {
              version: 1,
              originalRequest: prompt,
              resolvedEntityIds: referenceIds,
              resolvedLabels: referenceIds
                .map((referenceId) => runtimeReferenceById.get(referenceId)?.label)
                .filter((label): label is string => Boolean(label)),
              plainText: prompt,
              mustPreserve: [],
              referenceImageUrls: [],
              canvasItemIds: [],
            };
            executionBrief = prompt;
            imagePlanning.executionPlan = structuredClone(directPlan) as unknown as Record<string, unknown>;
            completeImagePlanningStage(imagePlanning, 'routing', 'execution');
            completeImagePlanningStage(imagePlanning, 'execution');
            writeImagePlanningCheckpoint();
            writeEvent(controller, {
              type: 'image_parameters_locked',
              parameters: { outputCount, aspectRatio, deliveryMode, ...(panelCount ? { panelCount } : {}) },
            });
            writeProgress({
              stepId: 'routing',
              phase: 'analyzing',
              status: 'completed',
              label: operation === 'edit' ? '已识别为编辑原图' : '已识别为生成新图',
            });
            return {
              terminate: true,
              type: 'image_execution_plan',
              plan: directPlan,
              modelResult: { accepted: true },
              publicResult: { accepted: true },
            };
          },
          getConversationMemory: async () => ({
            modelResult: {
              memory: normalizeAgentConversationMemory(body.agentMemory) || null,
              recentMessages: body.messages.slice(-20),
            },
            publicResult: { loaded: true },
          }),
          listProjectContext: async () => ({
            modelResult: {
              entities: contextEntities.slice(-80).map((entity) => ({
                id: entity.id,
                kind: entity.kind,
                label: entity.label,
                aliases: entity.aliases || [],
                summary: entity.summary || '',
                selected: entity.selected === true,
                createdAt: entity.createdAt || null,
              })),
              total: contextEntities.length,
              truncated: contextEntities.length > 80,
              omitted: Math.max(0, contextEntities.length - 80),
            },
            publicResult: { total: contextEntities.length, truncated: contextEntities.length > 80 },
          }),
          readContextEntity: async (id: string) => {
            const entity = contextEntityById.get(id);
            if (!entity) throw new Error(`Unknown context entity: ${id}`);
            return {
              modelResult: {
                id: entity.id,
                kind: entity.kind,
                label: entity.label,
                aliases: entity.aliases || [],
                summary: entity.summary || '',
                brief: entity.brief,
                selected: entity.selected === true,
                hasVisual: Boolean(entity.assetUrl || entity.referenceImageUrls?.length),
              },
              publicResult: { id: entity.id, kind: entity.kind, label: entity.label },
            };
          },
          loadVisualReference: async (ids: string[]) => {
            const validatedIds = validateContextIds(ids, 'visual');
            if (validatedIds.length === 0 || validatedIds.length > 4) throw new Error('load_visual_reference requires 1 to 4 stable IDs');
            if (validatedIds.some((id) => initiallyAttachedVisualIds.has(id))) {
              throw new Error('The requested visual reference is already attached to the current Main Agent turn');
            }
            const visualReferences = validatedIds.map((id) => {
              const runtimeReference = runtimeReferenceById.get(id);
              const entity = contextEntityById.get(id);
              const src = runtimeReference?.src || entity?.assetUrl || entity?.referenceImageUrls?.[0];
              if (!src) throw new Error(`Visual reference is unavailable: ${id}`);
              return { id, label: runtimeReference?.label || entity?.label || id, src };
            });
            validatedIds.forEach((id) => loadedVisualReferenceIds.add(id));
            if (imagePlanning) {
              for (const visualReference of visualReferences) {
                if (runtimeReferenceById.has(visualReference.id)) continue;
                const entity = contextEntityById.get(visualReference.id);
                const reference = {
                  id: visualReference.id,
                  src: visualReference.src,
                  label: visualReference.label,
                  source: entity?.kind === 'canvas_item' ? 'canvas' as const : 'history' as const,
                  role: 'reference' as const,
                };
                runReferenceContext.references.push(reference);
                runtimeReferenceById.set(reference.id, reference);
              }
              imagePlanning.referenceIds = [...runtimeReferenceById.keys()];
              writeImagePlanningCheckpoint();
            }
            return {
              modelResult: { loaded: visualReferences.map(({ id, label }) => ({ id, label })) },
              publicResult: { loadedIds: visualReferences.map((reference) => reference.id) },
              visualReferences,
            };
          },
          updateConversationMemory: async (patch: Record<string, unknown>) => {
            if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
              throw new Error('update_conversation_memory requires a memoryPatch object');
            }
            // Validate and bound through the same normalizer used for persisted topic memory,
            // but keep the mutation staged until the loop resolves successfully.
            const normalized = normalizeAgentConversationMemory(
              mergeTopicMemory(topicMemory, patch, body.messages),
            );
            if (!normalized) throw new Error('Invalid conversation memory patch');
            stagedMainAgentMemoryPatches.push(structuredClone(patch));
            return {
              type: 'memory_staged',
              modelResult: { accepted: true },
              publicResult: { accepted: true },
            };
          },
          readRelevantContext: async (args: Record<string, unknown>) => {
            const scope = String(args.scope || '');
            void contextLogger.info('main_agent.context_requested', 'Main Agent requested bounded context', {
              taskId: agentAnalysis?.taskId || null,
              runId,
              checkpoint: agentAnalysis?.checkpointCount || 0,
              scope,
              skillId: selectedSkill?.id || null,
              operation: imageOperation,
              exit: 'context',
            });
            const query = typeof args.query === 'string' ? args.query.trim().toLowerCase().slice(0, 300) : '';
            const requestedIds = new Set(
              (Array.isArray(args.ids) ? args.ids : []).map((id) => String(id).trim()).filter(Boolean),
            );
            if (scope === 'conversation') {
              mainAgentLoopState.contextRequested = true;
              mainAgentLoopState.contextScopes.add('conversation');
              return {
                modelResult: {
                  memory: normalizeAgentConversationMemory(body.agentMemory) || null,
                  messages: body.messages.slice(-20).map((message) => ({
                    id: message.id,
                    role: message.role,
                    content: message.content.slice(0, 1200),
                  })),
                },
                publicResult: { scope, loaded: true },
              };
            }
            const candidates = contextEntities.filter((entity) => {
              if (scope === 'canvas' && entity.kind !== 'canvas_item') return false;
              if (requestedIds.size > 0 && !requestedIds.has(entity.id)) return false;
              if (!query) return true;
              return [entity.id, entity.label, entity.summary, ...(entity.aliases || [])]
                .some((value) => String(value || '').toLowerCase().includes(query));
            }).slice(-40);
            relevantContextCandidateIds.clear();
            candidates.forEach((entity) => relevantContextCandidateIds.add(entity.id));
            if (scope === 'project' || scope === 'canvas') {
              mainAgentLoopState.contextRequested = true;
              mainAgentLoopState.contextScopes.add('project');
            }
            return {
              modelResult: {
                scope,
                entities: candidates.map((entity) => ({
                  id: entity.id,
                  kind: entity.kind,
                  label: entity.label,
                  summary: String(entity.summary || '').slice(0, 800),
                  aliases: (entity.aliases || []).slice(0, 6),
                  hasVisual: Boolean(entity.assetUrl || entity.referenceImageUrls?.length),
                })),
                ...(scope === 'canvas' ? {
                  canvas: {
                    itemCount: Number((body.canvasContext as any)?.itemCount) || 0,
                    selectedItemIds: Array.isArray((body.canvasContext as any)?.selectedItemIds)
                      ? (body.canvasContext as any).selectedItemIds.slice(0, 40)
                      : [],
                  },
                } : {}),
              },
              publicResult: { scope, count: candidates.length },
            };
          },
          submitAgentAnalysisCheckpoint: async (args: Record<string, unknown>) => {
            if (!agentAnalysis) agentAnalysis = createAgentAnalysisSnapshot(analysisDefaults) as AgentAnalysisSnapshot;
            const checkpoint = applyAgentAnalysisCheckpoint(agentAnalysis, args);
            writeAgentAnalysisCheckpoint();
            writeProgress({
              stepId: 'agent_analysis',
              phase: 'analyzing',
              status: 'completed',
              label: '正在深入分析',
            });
            void contextLogger.info('main_agent.analysis_checkpoint', 'Saved Main Agent analysis checkpoint', {
              taskId: agentAnalysis.taskId,
              runId: agentAnalysis.runId,
              checkpoint: agentAnalysis.checkpointCount,
              skillId: agentAnalysis.lockedFacts.selectedSkillId,
              operation: agentAnalysis.lockedFacts.operation || null,
              exit: 'analysis_checkpoint',
            });
            return {
              terminate: true,
              type: 'agent_analysis_checkpoint',
              checkpoint,
              modelResult: { accepted: true, checkpointCount: agentAnalysis.checkpointCount },
              publicResult: { accepted: true },
            };
          },
          requestUserDecision: async (args: Record<string, unknown>) => {
            const options = Array.isArray(args.options) ? args.options : [];
            const optionIds = new Set(options.map((option: any) => String(option?.id || '').trim()).filter(Boolean));
            const recommendedOptionId = String(args.recommendedOptionId || '').trim();
            if (!optionIds.has(recommendedOptionId)) throw new Error('recommendedOptionId must match one option');
            if (!agentAnalysis) agentAnalysis = createAgentAnalysisSnapshot(analysisDefaults) as AgentAnalysisSnapshot;
            agentAnalysis.status = 'awaiting_input';
            if (imagePlanning) setImagePlanningStage(imagePlanning, imagePlanning.currentStage, 'awaiting_input');
            writeAgentAnalysisCheckpoint();
            if (imagePlanning) writeImagePlanningCheckpoint();
            void contextLogger.info('main_agent.user_decision_requested', 'Main Agent paused for a user decision', {
              taskId: agentAnalysis.taskId,
              runId: agentAnalysis.runId,
              checkpoint: agentAnalysis.checkpointCount,
              scope: args.scope,
              skillId: agentAnalysis.lockedFacts.selectedSkillId,
              operation: agentAnalysis.lockedFacts.operation || null,
              exit: 'user_decision',
            });
            return {
              confirmationRequired: true,
              message: String(args.question || ''),
              candidates: options,
              clarification: args,
            };
          },
          startImagePlanning: async (args: Record<string, unknown>) => {
            const operation = String(args.operation || '');
            if (operation !== 'generate' && operation !== 'edit') throw new Error('图片操作必须是 generate 或 edit');
            if (imageOperation && operation !== imageOperation) throw new Error('图片操作与已锁定任务不一致');
            const requestedParameters = args.requestedParameters && typeof args.requestedParameters === 'object'
              ? args.requestedParameters as Record<string, unknown>
              : {};
            const readiness = args.readiness && typeof args.readiness === 'object'
              ? args.readiness as Record<string, unknown>
              : {};
            const readinessGoal = String(readiness.goal || '').trim();
            const blockingUnknowns = Array.isArray(readiness.blockingUnknowns) ? readiness.blockingUnknowns : [];
            if (!readinessGoal || blockingUnknowns.length > 0) throw new Error('图片任务尚未满足结构化执行条件');
            const readinessTargetIds = validateContextIds(readiness.targetIds, 'visual');
            if (operation === 'edit' && readinessTargetIds.length !== 1) throw new Error('编辑任务必须锁定一个可用目标');
            const modelOutputCount = positiveInteger(requestedParameters.outputCount) || imagePlanningDefaults.outputCount || 1;
            const uiAspectRatio = body.imageOptions?.aspectRatioLocked === true && body.imageOptions?.aspectRatio && body.imageOptions.aspectRatio !== 'auto'
              ? body.imageOptions.aspectRatio
              : '';
            const modelAspectRatio = typeof requestedParameters.aspectRatio === 'string'
              ? requestedParameters.aspectRatio
              : '';
            const deliveryMode = ['single', 'variants', 'series', 'composite'].includes(String(requestedParameters.deliveryMode || ''))
              ? String(requestedParameters.deliveryMode) as 'single' | 'variants' | 'series' | 'composite'
              : modelOutputCount > 1 ? 'variants' : 'single';
            const panelCount = deliveryMode === 'composite'
              ? Math.max(2, positiveInteger(requestedParameters.panelCount) || 2)
              : null;
            imagePlanningDefaults.outputCount = modelOutputCount;
            imagePlanningDefaults.aspectRatio = uiAspectRatio || modelAspectRatio || AGENT_DEFAULT_IMAGE_OPTIONS.aspectRatio;
            imagePlanningDefaults.deliveryMode = deliveryMode;
            imagePlanningDefaults.panelCount = panelCount;
            if (!imagePlanning) imagePlanning = restoreImagePlanningSnapshot(null, imagePlanningDefaults);
            if (imagePlanning.currentStage !== 'routing') throw new Error('图片规划已经启动');
            imageOperation = operation;
            targetReferenceId = operation === 'edit' ? readinessTargetIds[0] : null;
            intent = 'image';
            imagePlanning.decision = operation;
            imagePlanning.operation = operation;
            imagePlanning.outputCount = modelOutputCount;
            imagePlanning.aspectRatio = imagePlanningDefaults.aspectRatio;
            imagePlanning.deliveryMode = deliveryMode;
            imagePlanning.panelCount = panelCount;
            imagePlanning.targetReferenceId = targetReferenceId;
            imagePlanning.resolvedRequirement = [
              readinessGoal,
              ...((Array.isArray(readiness.constraints) ? readiness.constraints : []).map((value) => String(value).trim()).filter(Boolean)),
              ...((Array.isArray(readiness.resolvedAmbiguities) ? readiness.resolvedAmbiguities : []).map((value) => String(value).trim()).filter(Boolean)),
            ].join('\n');
            if (readinessTargetIds.length > 0) {
              imagePlanning.referenceIds = Array.from(new Set([...imagePlanning.referenceIds, ...readinessTargetIds]));
            }
            if (agentAnalysis) {
              agentAnalysis.status = 'ready';
              agentAnalysis.lockedFacts.operation = operation;
            }
            writeImagePlanningCheckpoint();
            writeEvent(controller, {
              type: 'image_parameters_locked',
              parameters: {
                outputCount: imagePlanning.outputCount,
                aspectRatio: imagePlanning.aspectRatio,
                deliveryMode,
                ...(panelCount ? { panelCount } : {}),
              },
            });
            writeProgress({
              stepId: 'routing',
              phase: 'analyzing',
              status: 'completed',
              label: operation === 'edit' ? '已识别为编辑原图' : '已识别为生成新图',
            });
            void contextLogger.info('image_operation.locked', 'Main Agent started image planning', {
              taskId: imagePlanning.taskId,
              runId,
              skillId: selectedSkill?.id || null,
              operation,
            });
            void contextLogger.info('main_agent.execution_ready', 'Main Agent declared image execution readiness', {
              taskId: imagePlanning.taskId,
              runId,
              checkpoint: agentAnalysis?.checkpointCount || 0,
              scope: 'image',
              skillId: selectedSkill?.id || null,
              operation,
              exit: 'start_image_planning',
            });
            return {
              terminate: true,
              type: 'image_planning_started',
              modelResult: { operation },
              publicResult: { operation },
            };
          },
          rewindAgentAnalysis: async (args: Record<string, unknown>) => {
            const requestedStage = String(args.stage || '');
            if (!['analysis', 'routing'].includes(requestedStage)) {
              throw new Error('回退阶段无效');
            }
            if (!agentAnalysis) agentAnalysis = createAgentAnalysisSnapshot(analysisDefaults) as AgentAnalysisSnapshot;
            agentAnalysis.runId = runId;
            agentAnalysis.status = 'analyzing';
            if (requestedStage === 'analysis') {
              agentAnalysis.currentObjective = String(args.reason || '').trim() || null;
              agentAnalysis.workingState = {
                currentUnderstanding: null,
                evidence: [],
                assumptions: [],
                constraints: [],
                unresolvedQuestions: [],
                nextFocus: null,
              };
            } else {
              if (!imagePlanning) throw new Error('当前任务没有可回退的图片阶段');
              rewindImagePlanning(imagePlanning, requestedStage as AgentImagePlanningStage, runId);
              writeImagePlanningCheckpoint();
            }
            writeAgentAnalysisCheckpoint();
            void contextLogger.info('main_agent.analysis_rewound', 'Rewound task from a model-selected stage', {
              taskId: agentAnalysis.taskId,
              runId,
              stage: requestedStage,
              skillId: agentAnalysis.lockedFacts.selectedSkillId,
              operation: agentAnalysis.lockedFacts.operation || imagePlanning?.operation || null,
              changedRequirements: args.changedRequirements,
            });
            return {
              terminate: true,
              type: 'agent_analysis_rewound',
              stage: requestedStage,
              modelResult: { accepted: true, stage: requestedStage },
              publicResult: { accepted: true },
            };
          },
          requestMainAgentContext: async (args: Record<string, unknown>) => {
            if (mainAgentLoopState.contextRequested) throw new Error('Main Agent context can be unlocked only once per loop');
            const scopes = Array.from(new Set(
              (Array.isArray(args.scopes) ? args.scopes : [])
                .map((scope) => String(scope))
                .filter((scope): scope is 'conversation' | 'project' => scope === 'conversation' || scope === 'project'),
            ));
            if (scopes.length === 0) throw new Error('At least one Main Agent context scope is required');
            mainAgentLoopState.contextRequested = true;
            scopes.forEach((scope) => mainAgentLoopState.contextScopes.add(scope));
            return {
              modelResult: { unlockedScopes: scopes },
              publicResult: { unlockedScopes: scopes },
            };
          },
          requestImageClarification: async (args: Record<string, unknown>) => {
            const stage = String(args.stage || '') as AgentImagePlanningStage;
            if (!imagePlanning || stage !== imagePlanning.currentStage) {
              throw new Error('Clarification stage does not match the current image planning stage');
            }
            setImagePlanningStage(imagePlanning, stage, 'awaiting_input');
            writeImagePlanningCheckpoint();
            return {
              confirmationRequired: true,
              message: String(args.question || ''),
              candidates: Array.isArray(args.options) ? args.options : [],
              clarification: args,
            };
          },
          submitImageExecutionPlan: async (args: Record<string, unknown>) => {
            const contextEntityIds = validateContextIds(args.contextEntityIds, 'context');
            const visualReferenceIds = validateContextIds(args.visualReferenceIds, 'visual');
            for (const referenceId of visualReferenceIds) {
              if (!loadedVisualReferenceIds.has(referenceId)) {
                throw new Error(`Visual reference must be loaded before it can be used in an image contract: ${referenceId}`);
              }
              if (runtimeReferenceById.has(referenceId)) continue;
              const entity = contextEntityById.get(referenceId);
              const src = entity?.assetUrl || entity?.referenceImageUrls?.[0];
              if (!entity || !src) throw new Error(`Visual reference is unavailable: ${referenceId}`);
              const reference = {
                id: referenceId,
                src,
                label: entity.label,
                source: entity.kind === 'canvas_item' ? 'canvas' as const : 'history' as const,
                role: 'reference' as const,
              };
              runReferenceContext.references.push(reference);
              runtimeReferenceById.set(referenceId, reference);
            }
            const assembled = assembleMainAgentImageExecutionPlan(args, {
              manifest: selectedSkill,
              lockedSkillId: selectedSkill?.id || null,
              readSkillId: mainAgentLoopState.skillRead ? selectedSkill?.id || null : null,
              lockedImageOperation: imageOperation,
              lockedTargetReferenceId: targetReferenceId,
              referenceIds: [...runtimeReferenceById.keys()],
              userMessage: recoveryBaseRecord?.originalRequest || latestUserMessage,
            });
            if (!assembled.plan) {
              void contextLogger.warn('image_contract.failed', 'Main Agent image contract failed local validation', {
                validationErrors: assembled.validationErrors,
                mutationBlocked: true,
              });
              throw new Error(assembled.validationErrors.map((entry: any) => entry.message).join(' '));
            }
            selectedContextEntityIds.splice(0, selectedContextEntityIds.length, ...contextEntityIds);
            plannerVisualSummary = normalizeAgentVisualSummary(args.visualSummary, visualReferenceIds);
            void contextLogger.info('image_contract.submitted', 'Main Agent image contract passed local validation', {
              skillId: selectedSkill?.id || null,
              intent: assembled.plan.intent,
              outputCount: assembled.plan.delivery.outputCount,
              visualReferenceCount: visualReferenceIds.length,
            });
            return {
              terminate: true,
              type: 'image_execution_plan',
              route: 'planner',
              plan: assembled.plan,
              modelResult: { accepted: true },
              publicResult: { accepted: true },
            };
          },
          requestContextSelection: async (args: Record<string, unknown>) => {
            const candidates = Array.isArray(args.candidates) ? args.candidates.slice(0, 4) : [];
            if (candidates.length < 2) throw new Error('At least two context candidates are required');
            const normalizedCandidates = candidates.map((candidate) => {
              const value = candidate as { id?: unknown; label?: unknown; kind?: unknown };
              const id = String(value.id || '').trim();
              const entity = contextEntityById.get(id);
              if (!entity || !relevantContextCandidateIds.has(id)) throw new Error(`Unknown context candidate: ${id}`);
              return { id, label: entity.label, kind: entity.kind };
            });
            return {
              confirmationRequired: true,
              message: String(args.question || '').trim(),
              candidates: normalizedCandidates,
            };
          },
        });
        // Image prompts are now submitted directly by the Main Agent. Legacy
        // terminal-contract checkpoints re-enter that tool instead of reviving
        // the former v4 contract submission path.
        const terminalContractResume = false;
        const analysisCheckpointResume = recoveryBaseRecord?.failure.stage === 'analysis'
          && recoveryBaseRecord.resumeRoute === 'main_agent'
          && Boolean(recoveryBaseRecord.mainAgentLoop)
          && Boolean(agentAnalysis);
        if (analysisCheckpointResume && agentAnalysis) agentAnalysis.status = 'analyzing';
        if (terminalContractResume) {
          void contextLogger.info('image_contract.retry_forced', 'Retry resumed at the image contract checkpoint', {
            taskId: rootTaskId(), runId, skillId: selectedSkill?.id || null, imageOperation,
          });
        }
        const standardMainAgentToolNames = [
          'read_relevant_context',
          'submit_agent_analysis_checkpoint',
          'request_user_decision',
        ];
        const imageExecutionToolName = () => (
          !mainAgentLoopState.skillRead ? 'read_imagegen_context' : 'generate_image'
        );
        const mainAgentInitialToolNames = terminalContractResume
          ? ['submit_image_execution_plan']
          : [...standardMainAgentToolNames, imageExecutionToolName()];
        const resolveMainAgentToolNames = () => {
          if (terminalContractResume) return ['submit_image_execution_plan'];
          return [
            ...standardMainAgentToolNames.filter((name) => (
              name !== 'submit_agent_analysis_checkpoint' || (agentAnalysis?.checkpointCount || 0) < 3
            )),
            imageExecutionToolName(),
            ...(recoveryRevisionMessage ? ['rewind_agent_analysis'] : []),
            ...(relevantContextCandidateIds.size >= 2 ? ['request_context_selection'] : []),
            ...(mainAgentLoopState.contextScopes.has('project') ? ['load_visual_reference'] : []),
          ];
        };
        const mainAgentToolNames = [
          ...standardMainAgentToolNames,
          'read_imagegen_context',
          'generate_image',
          'rewind_agent_analysis',
          'request_context_selection',
          'load_visual_reference',
          ...(terminalContractResume ? ['submit_image_execution_plan'] : []),
        ];
        const mainAgentTools = getAgentModelTools(mainAgentRegistry, mainAgentToolNames);
        const buildLoopMessages = () => buildMainAgentLoopMessages({
          messages: mainAgentInputMessages,
          referenceImages: mainAgentReferenceImages,
          referenceContext: mainAgentReferenceContext,
          manifests: selectedSkill ? [selectedSkill] : [],
          manualSkillId: isExplicitSkillSource(skillSource) ? selectedSkill?.id || null : null,
          lockedSkillId: selectedSkill?.id || null,
          pendingTask: activeClarificationState ? {
            taskId: activeClarificationState.taskId,
            intent: activeClarificationState.intent,
            skillId: activeClarificationState.skillId || null,
            imageOperation,
            targetReferenceId,
          } : null,
          memory: normalizeAgentConversationMemory(body.agentMemory) || null,
          contextEntities,
          canvasContext: body.canvasContext,
          imageOptions: body.imageOptions,
          imagePlanning,
          agentAnalysis,
          contextUnlocked: mainAgentLoopState.contextRequested,
          contextScopes: [...mainAgentLoopState.contextScopes],
          recoveryState: recoveryBaseRecord ? {
            taskId: recoveryBaseRecord.taskId,
            originalRequest: recoveryBaseRecord.originalRequest,
            skillId: recoveryBaseRecord.skillId,
            imageOperation,
            targetReferenceId,
          } : null,
        });
        const selectedContextResponse = body.clarificationRequest?.dimension === 'context_reference'
          && typeof body.clarificationResponse?.selectedOptionId === 'string'
          ? body.clarificationResponse.selectedOptionId
          : '';
        const confirmedSkillResponse = body.clarificationRequest?.dimension === 'skill_selection'
          && typeof body.clarificationResponse?.selectedOptionId === 'string'
          ? body.clarificationResponse.selectedOptionId
          : '';
        const savedMainAgentLoop = activeClarificationState?.mainAgentLoop || recoveryBaseRecord?.mainAgentLoop;
        const selectedUserDecisionAnswer = savedMainAgentLoop?.pendingCall?.name === 'request_user_decision'
          && body.clarificationResponse
          ? body.clarificationResponse.customText
            || body.clarificationRequest?.options.find((option) => option.id === body.clarificationResponse?.selectedOptionId)?.answer
            || ''
          : '';
        if (
          savedMainAgentLoop
          && body.clarificationRequest?.dimension === 'context_reference'
          && !selectedContextResponse
        ) {
          throw new Error('Context selection requires choosing one of the listed references');
        }
        if (savedMainAgentLoop && selectedContextResponse) {
          const permittedIds = new Set((body.clarificationRequest?.options || []).map((option) => option.id));
          if (!permittedIds.has(selectedContextResponse) || !contextEntityById.has(selectedContextResponse)) {
            throw new Error('Context selection response does not match the pending Main Agent request');
          }
          if (imageOperation === 'edit') targetReferenceId = selectedContextResponse;
        }
        if (savedMainAgentLoop && confirmedSkillResponse) {
          if (confirmedSkillResponse !== savedMainAgentLoop.selectedSkillId || confirmedSkillResponse !== selectedSkill?.id) {
            throw new Error('Skill selection response does not match the pending Main Agent request');
          }
        }
        /* Retained only as migration history; the active flow is the background Image Planner below.
        const runLegacyStagedImagePlanning = async () => {
          if (!imagePlanning) throw new Error('Image planning state is unavailable');
          let transcript = savedMainAgentLoop?.transcript || [];
          let budgets = savedMainAgentLoop?.budgets;
          let pendingContinuation = ['request_image_clarification', 'request_user_decision'].includes(savedMainAgentLoop?.pendingCall?.name || '')
            && body.clarificationResponse
            ? {
                pendingCall: savedMainAgentLoop.pendingCall,
                toolResult: {
                  modelResult: {
                    selectedOptionId: body.clarificationResponse.selectedOptionId || null,
                    answer: body.clarificationResponse.customText
                      || body.clarificationRequest?.options.find((option) => option.id === body.clarificationResponse?.selectedOptionId)?.answer
                      || '',
                    proceedWithCurrent: body.clarificationResponse.proceedWithCurrent === true,
                  },
                  publicResult: { accepted: true },
                },
              }
            : null;
          const stageProgress = (stage: AgentImagePlanningStage, status: AgentProgressStatus) => {
            const mapping: Record<AgentImagePlanningStage, { stepId: AgentProgressStepId; phase: AgentProgressPhase; label: string }> = {
              routing: { stepId: 'image_operation', phase: 'analyzing', label: '正在锁定图片任务参数' },
              compilation: { stepId: 'image_prompt', phase: 'optimizing', label: '正在编译最终生图提示词' },
              local_finalization: { stepId: 'image_contract', phase: 'planning', label: '正在整理生图合同' },
            };
            const item = mapping[stage];
            writeProgress({ ...item, status });
            const eventName = status === 'active'
              ? 'image_planning.stage_started'
              : status === 'completed'
                ? 'image_planning.stage_completed'
                : status === 'failed'
                  ? 'image_planning.stage_failed'
                  : null;
            if (eventName) void contextLogger.info(eventName, 'Image planning stage changed', {
              taskId: imagePlanning!.taskId,
              runId: imagePlanning!.runId,
              stage,
              skillId: imagePlanning!.skill?.id || null,
              operation: imagePlanning!.operation,
            });
          };
          const stageTools = (stage: AgentImagePlanningStage) => {
            if (stage === 'routing') return ['start_image_planning', 'request_user_decision'];
            if (stage === 'compilation') return ['submit_image_compilation'];
            return [];
          };
          while (true) {
            const stage = imagePlanning.currentStage;
            if (stage === 'compilation' && selectedSkill && !mainAgentLoopState.skillRead) {
              try {
                await loadLockedSelectedSkill({ allowExisting: true, source: 'runtime' });
              } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                failImagePlanningStage(imagePlanning, 'compilation', message, 'validation');
                writeImagePlanningCheckpoint();
                stageProgress('compilation', 'failed');
                throw new Error('已选 Skill 加载失败，任务状态已保留，可继续重试');
              }
            }
            if (selectedSkill && mainAgentLoopState.skillRead && !skillContent) {
              await loadLockedSelectedSkill({ allowExisting: true, source: 'runtime' });
            }
            if (stage === 'local_finalization') {
              stageProgress(stage, 'active');
              try {
                const lockedPlanningManifest = selectedSkill && imagePlanning.skill
                  ? { ...selectedSkill, ...imagePlanning.skill.manifest, id: imagePlanning.skill.id }
                  : selectedSkill;
                const draft = buildImageExecutionDraft(imagePlanning);
                const assembled = assembleMainAgentImageExecutionPlan(draft, {
                  manifest: lockedPlanningManifest,
                  lockedSkillId: selectedSkill?.id || null,
                  readSkillId: mainAgentLoopState.skillRead ? selectedSkill?.id || null : null,
                  lockedImageOperation: imagePlanning.operation,
                  lockedTargetReferenceId: imagePlanning.targetReferenceId,
                  referenceIds: [...runtimeReferenceById.keys()],
                  userMessage: imagePlanning.originalRequest,
                });
                if (!assembled.plan) {
                  const failedStage = mapImagePlanningValidationStage(assembled.validationErrors) as AgentImagePlanningStage;
                  rewindImagePlanning(imagePlanning, failedStage, runId);
                  void contextLogger.warn('image_planning.rewind', 'Rewound image planning after local validation', {
                    taskId: imagePlanning.taskId,
                    runId: imagePlanning.runId,
                    stage: failedStage,
                    skillId: imagePlanning.skill?.id || null,
                    operation: imagePlanning.operation,
                    revision: imagePlanning.revision,
                  });
                  failImagePlanningStage(
                    imagePlanning,
                    failedStage,
                    assembled.validationErrors.map((entry: any) => entry.message).join(' '),
                  );
                  writeImagePlanningCheckpoint();
                  void contextLogger.warn('image_planning.finalization_failed', 'Local image contract assembly failed', {
                    taskId: imagePlanning.taskId, runId, stage: failedStage,
                    skillId: selectedSkill?.id || null, operation: imagePlanning.operation,
                    validationErrors: assembled.validationErrors,
                  });
                  throw new Error('图像合同整理未完成，任务状态已保留，可继续重试');
                }
                completeImagePlanningStage(imagePlanning, 'local_finalization');
                writeImagePlanningCheckpoint();
                stageProgress(stage, 'completed');
                return {
                  stopReason: 'completed',
                  terminal: { type: 'image_execution_plan', plan: assembled.plan },
                  transcript,
                  turns: budgets?.turnsUsed || 0,
                  toolCalls: budgets?.toolCallsUsed || 0,
                  budgetedToolCalls: budgets?.budgetedToolCallsUsed || 0,
                  mutationToolCalls: budgets?.mutationToolCallsUsed || 0,
                };
              } catch (error) {
                if (!imagePlanning.failure) {
                  failImagePlanningStage(
                    imagePlanning,
                    'local_finalization',
                    error instanceof Error ? error.message : String(error),
                    'unknown',
                  );
                  writeImagePlanningCheckpoint();
                }
                mainAgentFailureCheckpoint = {
                  transcript,
                  budgets: budgets || {
                    turnsUsed: 0,
                    toolCallsUsed: 0,
                    budgetedToolCallsUsed: 0,
                    mutationToolCallsUsed: 0,
                  },
                  selectedSkillId: selectedSkill?.id || null,
                  skillRead: mainAgentLoopState.skillRead,
                  contextScopes: [...mainAgentLoopState.contextScopes],
                };
                stageProgress(stage, 'failed');
                throw error;
              }
            }
            const allowedStageTools = stageTools(stage);
            if (allowedStageTools.length === 0) throw new Error(`Unsupported image planning stage: ${stage}`);
            stageProgress(stage, 'active');
            for (let attempt = 0; attempt < 2; attempt += 1) {
              const result: any = await runZFlowAgentBrain({
                messages: buildLoopMessages(),
                providerId: resolvedChatSelection.providerId!,
                model: resolvedChatSelection.model!,
                modelMetadata: resolvedChatModelMetadata,
                tools: mainAgentTools,
                toolChoice: 'required',
                initialToolNames: allowedStageTools,
                getNextTurnToolNames: () => stageTools(imagePlanning!.currentStage),
                maxTurns: MAX_MAIN_AGENT_TURNS,
                maxToolCalls: MAX_MAIN_AGENT_TOOL_CALLS,
                repairInvalidTerminalToolsOnce: allowedStageTools.filter((name) => (
                  !['read_relevant_context', 'load_visual_reference'].includes(name)
                )),
                signal: runSignal,
                chatStream,
                executeTool: async (toolName, args, context) => {
                  void contextLogger.info('image_planning.tool_call', 'Main Agent called an image planning stage tool', {
                    taskId: imagePlanning!.taskId, runId, stage, toolName,
                    skillId: selectedSkill?.id || null, operation: imagePlanning!.operation,
                  });
                  try {
                    return await executeAgentTool(mainAgentRegistry, toolName, args, {
                      allowedTools: stageTools(imagePlanning!.currentStage),
                      confirmed: false,
                      canvasContext: body.canvasContext,
                      toolCallId: context.toolCallId,
                    });
                  } catch (error) {
                    void contextLogger.warn('image_planning.tool_validation_failed', 'Image planning tool call was rejected', {
                      taskId: imagePlanning!.taskId,
                      runId,
                      stage,
                      toolName,
                      skillId: selectedSkill?.id || null,
                      operation: imagePlanning!.operation,
                      error: error instanceof Error ? error.message : String(error),
                    });
                    throw error;
                  }
                },
                ...(transcript.length > 0 ? {
                  continuation: {
                    transcript,
                    ...(pendingContinuation || {}),
                    resumeMessage: JSON.stringify({
                      instruction: pendingContinuation
                        ? 'Continue the current stage using the user answer. Call one available stage tool.'
                        : 'Continue the saved image task. Call one available stage tool.',
                      userRevision: recoveryRevisionMessage || null,
                      currentStage: stage,
                      locked: {
                        operation: imagePlanning.operation,
                        targetReferenceId: imagePlanning.targetReferenceId,
                        referenceIds: imagePlanning.referenceIds,
                        outputCount: imagePlanning.outputCount,
                        aspectRatio: imagePlanning.aspectRatio,
                      },
                    }),
                    budgets,
                  },
                } : {}),
                onEvent: emitMainAgentEvent,
                onAssistantTurnComplete: handleAssistantTurnComplete,
                onToolPending: ({ id, name, args }) => {
                  rememberToolPublicProgress(id, name, args);
                  writeToolProgress(name, 'pending', id);
                },
                onToolStart: ({ id, name, args }) => {
                  rememberToolPublicProgress(id, name, args);
                  writeToolProgress(name, 'active', id);
                  writeToolStartEvent(id, name);
                },
                onToolUpdate: writeToolUpdate,
                onToolResult: ({ id, name, result, isError }) => {
                  noteToolResult(name, isError);
                  writeToolResultEvent(id, name, result, isError);
                  writeToolProgress(name, isError ? 'failed' : 'completed', id, summarizePublicToolResult(result));
                },
              });
              const routingAdvancedToCompilation = stage === 'routing'
                && imagePlanning.currentStage === 'compilation';
              // Compilation receives only runtime-locked facts, not routing's visual interpretation.
              transcript = routingAdvancedToCompilation ? [] : structuredClone(result.transcript || transcript);
              budgets = {
                turnsUsed: result.turns,
                toolCallsUsed: result.toolCalls,
                budgetedToolCallsUsed: result.budgetedToolCalls,
                mutationToolCallsUsed: result.mutationToolCalls,
              };
              pendingContinuation = null;
              if (result.stopReason === 'confirmation_required' && ['request_image_clarification', 'request_user_decision'].includes(result.confirmation?.toolName || '')) {
                const clarification = result.confirmation.arguments || result.confirmation.clarification || {};
                const recommendedOptionId = String(clarification.recommendedOptionId || '');
                const request: AgentClarificationRequest = {
                  id: randomUUID(),
                  taskId: imagePlanning.taskId,
                  question: String(clarification.question || result.confirmation.message || ''),
                  dimension: String(clarification.dimension || stage),
                  options: (Array.isArray(clarification.options) ? clarification.options : []).map((option: any) => ({
                    id: String(option.id || ''),
                    label: `${String(option.label || '')}${String(option.id || '') === recommendedOptionId ? '（推荐）' : ''}`,
                    answer: String(option.answer || ''),
                    description: String(option.description || ''),
                  })),
                  allowCustom: true,
                  allowProceed: true,
                };
                const checkpoint = progressTracker.snapshot();
                writeInteractionEvent({
                  type: 'clarification_required',
                  message: request.question,
                  request,
                  state: {
                    taskId: imagePlanning.taskId,
                    sourceUserMessageId: imagePlanning.sourceUserMessageId,
                    operationId: checkpoint.operationId,
                    skillSource,
                    lastSequence: checkpoint.lastSequence,
                    intent: 'image',
                    ...(selectedSkill ? { skillId: selectedSkill.id, skillRead: mainAgentLoopState.skillRead } : {}),
                    originalRequest: imagePlanning.originalRequest,
                    workingBrief: imagePlanning.originalRequest,
                    askedDimensions: [request.dimension],
                    answers: [],
                    referenceImages: executionReferenceImages,
                    ...(runReferenceContext ? { referenceContext: structuredClone(runReferenceContext) } : {}),
                    ...(plannerVisualSummary ? { visualSummary: structuredClone(plannerVisualSummary) } : {}),
                    imageOperation: imagePlanning.operation || undefined,
                    targetReferenceId: imagePlanning.targetReferenceId || undefined,
                    imagePlanning: structuredClone(imagePlanning),
                    ...(agentAnalysis ? { agentAnalysis: structuredClone(agentAnalysis) } : {}),
                    mainAgentLoop: {
                      transcript,
                      pendingCall: {
                        id: String(result.confirmation.toolCallId || ''),
                        name: String(result.confirmation.toolName || ''),
                        args: structuredClone(result.confirmation.arguments || {}),
                        ...(Array.isArray(result.confirmation.batch) ? { batch: structuredClone(result.confirmation.batch) } : {}),
                      },
                      budgets,
                      memoryPatches: structuredClone(stagedMainAgentMemoryPatches),
                      selectedSkillId: selectedSkill?.id || null,
                      skillRead: mainAgentLoopState.skillRead,
                      contextScopes: [...mainAgentLoopState.contextScopes],
                    },
                  },
                });
                writeAgentDone('clarification_required');
                return null;
              }
              if (result.terminal && result.stopReason === 'completed') {
                if (imagePlanning.failure?.stage === stage) {
                  stageProgress(stage, 'failed');
                  throw new Error(imagePlanning.failure.message);
                }
                stageProgress(stage, 'completed');
                break;
              }
              if (attempt === 0) {
                incrementImagePlanningRepair(imagePlanning, stage);
                writeImagePlanningCheckpoint();
                void contextLogger.warn('image_planning.stage_repair', 'Retrying one invalid image planning stage result', {
                  taskId: imagePlanning.taskId, runId, stage,
                  skillId: selectedSkill?.id || null, operation: imagePlanning.operation,
                  error: result.errorMessage || 'required stage tool was not called',
                });
                continue;
              }
              const failureMessage = result.errorMessage
                || '当前聊天模型未完成该阶段所需的结构化工具调用';
              failImagePlanningStage(imagePlanning, stage, failureMessage, result.stopReason === 'completed' ? 'capability' : 'validation');
              writeImagePlanningCheckpoint();
              stageProgress(stage, 'failed');
              mainAgentFailureCheckpoint = {
                transcript,
                budgets,
                selectedSkillId: selectedSkill?.id || null,
                skillRead: mainAgentLoopState.skillRead,
                contextScopes: [...mainAgentLoopState.contextScopes],
              };
              throw new Error('图像规划阶段未完成，任务状态已保留，可继续重试');
            }
          }
        };
        */
        let loopResult: any;
        let rerunMainAgent: ((continuationOverride?: Record<string, unknown>) => Promise<any>) | null = null;
        if (executionPlan) {
          loopResult = {
            stopReason: 'completed',
            terminal: { type: 'image_execution_plan', plan: executionPlan },
            transcript: [], turns: 0, toolCalls: 0, budgetedToolCalls: 0, mutationToolCalls: 0,
          };
        } else {
          if (imagePlanning && !recoveryRevisionMessage && imagePlanning.currentStage !== 'routing') {
            rewindImagePlanning(imagePlanning, 'routing', runId);
            writeImagePlanningCheckpoint();
          }
          const runMainAgentOnce = async (continuationOverride?: Record<string, unknown>) => runZFlowAgentBrain({
          messages: buildLoopMessages(),
          providerId: resolvedChatSelection.providerId!,
          model: resolvedChatSelection.model!,
          modelMetadata: resolvedChatModelMetadata,
          tools: mainAgentTools,
          toolChoice: terminalContractResume
            ? { type: 'function', function: { name: 'submit_image_execution_plan' } }
            : 'auto',
          initialToolNames: continuationOverride || savedMainAgentLoop ? resolveMainAgentToolNames() : mainAgentInitialToolNames,
          getNextTurnToolNames: () => resolveMainAgentToolNames(),
          requireInitialTool: '',
          maxTurns: MAX_MAIN_AGENT_TURNS,
          maxToolCalls: MAX_MAIN_AGENT_TOOL_CALLS,
          reserveClosingTurn: true,
          getExternalSteeringMessages,
          getExternalFollowUpMessages,
          repairInvalidTerminalToolOnce: terminalContractResume ? 'submit_image_execution_plan' : '',
          repairInvalidTerminalToolsOnce: terminalContractResume
            ? []
            : ['submit_agent_analysis_checkpoint', 'request_user_decision', 'generate_image', 'rewind_agent_analysis'],
          terminalToolContext: {
            imageOperation,
            targetReferenceId,
            skillId: selectedSkill?.id || null,
            skillRead: mainAgentLoopState.skillRead,
            visualReferenceIds: [...runtimeReferenceById.keys()],
            aspectRatio: body.imageOptions?.aspectRatio || selectedSkill?.aspectRatio || null,
            outputCount: recoveryBaseRecord?.taskSnapshot?.contract?.delivery?.outputCount || requestedImageCount,
            clarification: null,
            requiredTopLevelFields: [
              'decision', 'confidence', 'clarification', 'contextEntityIds', 'visualReferenceIds',
              'visualSummary', 'referenceRoles', 'targetSelectionReason', 'targetSelectionConfidence',
              'imageTask', 'brief', 'delivery', 'generation',
            ],
            forbiddenTopLevelFields: ['version'],
          },
          requireTerminalTool: terminalContractResume ? 'submit_image_execution_plan' : '',
          getRequiredTerminalToolName: imagePlanningRequest
            ? () => mainAgentLoopState.skillRead ? 'generate_image' : ''
            : undefined,
          signal: runSignal,
          chatStream,
          executeTool: async (toolName, args, context) => {
            void contextLogger.info('main_agent.tool_call', 'Main Agent called an internal tool', { toolName });
            return executeAgentTool(mainAgentRegistry, toolName, args, {
              allowedTools: resolveMainAgentToolNames(),
              confirmed: false,
              canvasContext: body.canvasContext,
              toolCallId: context.toolCallId,
            });
          },
          ...(continuationOverride ? { continuation: continuationOverride } : savedMainAgentLoop && (selectedContextResponse || confirmedSkillResponse || selectedImageOperationResponse || selectedUserDecisionAnswer || terminalContractResume || analysisCheckpointResume || recoveryRevisionMessage) ? {
            continuation: {
              transcript: savedMainAgentLoop.transcript,
              pendingCall: savedMainAgentLoop.pendingCall,
              ...(terminalContractResume ? {
                resumeMessage: JSON.stringify({
                  instruction: '只调用 submit_image_execution_plan 提交已保存任务的图像合同，不重新判断任务或读取 Skill。',
                  imageOperation,
                  targetReferenceId,
                  skillId: selectedSkill?.id || null,
                  skillRead: mainAgentLoopState.skillRead,
                  visualReferenceIds: recoveryBaseRecord?.visualReferenceIds || [],
                  aspectRatio: body.imageOptions?.aspectRatio || selectedSkill?.aspectRatio || null,
                  outputCount: recoveryBaseRecord?.taskSnapshot?.contract?.delivery?.outputCount || requestedImageCount,
                  clarification: null,
                  requiredTopLevelFields: [
                    'decision', 'confidence', 'clarification', 'contextEntityIds', 'visualReferenceIds',
                    'visualSummary', 'referenceRoles', 'targetSelectionReason', 'targetSelectionConfidence',
                    'imageTask', 'brief', 'delivery', 'generation',
                  ],
                  forbiddenTopLevelFields: ['version'],
                }),
              } : analysisCheckpointResume ? {
                resumeMessage: JSON.stringify({
                  instruction: '从保存的需求分析检查点继续。继承锁定事实和工作结论，不重新解释原始需求。',
                  checkpointCount: agentAnalysis?.checkpointCount || 0,
                  lockedFacts: agentAnalysis?.lockedFacts || null,
                  workingState: agentAnalysis?.workingState || null,
                }),
              } : recoveryRevisionMessage ? {
                resumeMessage: JSON.stringify({
                  instruction: '判断本次用户修订影响的最早阶段，并调用 rewind_agent_analysis。不得通过关键词规则猜测回退点。',
                  revision: recoveryRevisionMessage,
                  lockedFacts: agentAnalysis?.lockedFacts || null,
                  imagePlanning: imagePlanning || null,
                }),
              } : {}),
              toolResult: terminalContractResume
                ? undefined
                : analysisCheckpointResume
                  ? undefined
                : recoveryRevisionMessage
                  ? undefined
                : selectedUserDecisionAnswer
                  ? {
                      modelResult: { answer: selectedUserDecisionAnswer },
                      publicResult: { accepted: true },
                    }
                : confirmedSkillResponse
                ? {
                    modelResult: { skillId: confirmedSkillResponse, manifest: selectedSkill, content: skillContent },
                    publicResult: { skillId: confirmedSkillResponse, loaded: true },
                  }
                : selectedImageOperationResponse
                  ? {
                      modelResult: { imageOperation, targetReferenceId },
                      publicResult: { imageOperation, targetReferenceId },
                    }
                  : {
                    modelResult: { selectedContextEntityId: selectedContextResponse },
                    publicResult: { selectedContextEntityId: selectedContextResponse },
                  },
              budgets: savedMainAgentLoop.budgets,
            },
          } : {}),
          onAssistantTurnComplete: handleAssistantTurnComplete,
          onToolUpdate: writeToolUpdate,
          onToolPending: ({ id, name, args }) => {
            rememberToolPublicProgress(id, name, args);
            writeToolProgress(name, 'pending', id);
          },
          onToolStart: ({ id, name, args }) => {
            rememberToolPublicProgress(id, name, args);
            if (name !== 'generate_image') writeToolProgress(name, 'active', id);
            writeToolStartEvent(id, name);
          },
          onToolResult: ({ id, name, result, isError }) => {
            noteToolResult(name, isError);
            writeToolResultEvent(id, name, result, isError);
            if (name !== 'generate_image') writeToolProgress(name, isError ? 'failed' : 'completed', id, summarizePublicToolResult(result));
          },
          onEvent: emitMainAgentEvent,
          });
          rerunMainAgent = runMainAgentOnce;
          loopResult = await runMainAgentOnce();
          while (loopResult.terminal?.type === 'agent_analysis_checkpoint') {
            const checkpointCount = agentAnalysis?.checkpointCount || 0;
            loopResult = await runMainAgentOnce({
              transcript: structuredClone(loopResult.transcript || []),
              resumeMessage: JSON.stringify({
                instruction: checkpointCount >= 3
                  ? '主动分析额度已用完。现在直接回答、读取必要上下文、请求用户决定或进入领域入口。'
                  : '继续当前需求分析。继承已保存结论，不要重复分析。',
                checkpointCount,
                lockedFacts: agentAnalysis?.lockedFacts || null,
                workingState: agentAnalysis?.workingState || null,
              }),
              budgets: {
                turnsUsed: loopResult.turns,
                toolCallsUsed: loopResult.toolCalls,
                budgetedToolCallsUsed: loopResult.budgetedToolCalls,
                mutationToolCallsUsed: loopResult.mutationToolCalls,
              },
            });
          }
        }
        if (loopResult.terminal?.type === 'agent_analysis_rewound' && imagePlanning) {
          if (!rerunMainAgent) throw new Error('Main Agent retry is unavailable');
          rewindImagePlanning(imagePlanning, 'routing', runId);
          writeImagePlanningCheckpoint();
          loopResult = await rerunMainAgent({
            transcript: structuredClone(loopResult.transcript || []),
            resumeMessage: JSON.stringify({ instruction: '基于已锁定事实调用 generate_image，提交最终 Prompt。' }),
            budgets: {
              turnsUsed: loopResult.turns,
              toolCallsUsed: loopResult.toolCalls,
              budgetedToolCallsUsed: loopResult.budgetedToolCalls,
              mutationToolCallsUsed: loopResult.mutationToolCalls,
            },
          });
        }
        if (loopResult.stopReason === 'budget_exceeded' || loopResult.stopReason === 'error' || loopResult.stopReason === 'aborted') {
          if (loopResult.failureStage === 'terminal_contract' || terminalContractResume) {
            mainAgentFailureCheckpoint = {
              transcript: structuredClone(loopResult.transcript || savedMainAgentLoop?.transcript || []),
              budgets: {
                turnsUsed: loopResult.turns,
                toolCallsUsed: loopResult.toolCalls,
                budgetedToolCallsUsed: loopResult.budgetedToolCalls,
                mutationToolCallsUsed: loopResult.mutationToolCalls,
              },
              selectedSkillId: selectedSkill?.id || null,
              skillRead: mainAgentLoopState.skillRead,
              contextScopes: [...mainAgentLoopState.contextScopes],
            };
            void contextLogger.warn('image_contract.checkpoint_saved', 'Image contract checkpoint saved for retry', {
              taskId: rootTaskId(),
              runId,
              providerId: resolvedChatSelection.providerId,
              model: resolvedChatSelection.model,
              skillId: selectedSkill?.id || null,
              imageOperation,
              stopReason: loopResult.stopReason,
              failureStage: loopResult.failureStage || 'terminal_contract',
              errorMessage: loopResult.errorMessage || null,
              toolCalls: loopResult.toolCalls,
              turns: loopResult.turns,
            });
            throw new Error('图像合同未完成，任务状态已保留，可继续重试');
          }
          void contextLogger.warn('main_agent.loop_failed', 'Main Agent Loop failed closed', {
            durationMs: Date.now() - mainAgentStartedAt,
            stopReason: loopResult.stopReason,
            error: loopResult.errorMessage || null,
            mutationBlocked: true,
          });
          if (agentAnalysis) {
            agentAnalysis.status = 'failed';
            agentAnalysis.repairCount += 1;
            writeAgentAnalysisCheckpoint();
            mainAgentFailureCheckpoint = {
              transcript: structuredClone(loopResult.transcript || savedMainAgentLoop?.transcript || []),
              budgets: {
                turnsUsed: loopResult.turns,
                toolCallsUsed: loopResult.toolCalls,
                budgetedToolCallsUsed: loopResult.budgetedToolCalls,
                mutationToolCallsUsed: loopResult.mutationToolCalls,
              },
              selectedSkillId: selectedSkill?.id || null,
              skillRead: mainAgentLoopState.skillRead,
              contextScopes: [...mainAgentLoopState.contextScopes],
            };
            void contextLogger.warn('main_agent.analysis_failed', 'Main Agent analysis failed after its repair turn', {
              taskId: agentAnalysis.taskId,
              runId,
              checkpoint: agentAnalysis.checkpointCount,
              scope: body.intent || 'agent',
              skillId: selectedSkill?.id || null,
              operation: imageOperation,
              exit: loopResult.stopReason,
            });
          }
          const loopFailureMessage = /Provider did not call required tool/i.test(loopResult.errorMessage || '')
            ? '当前聊天模型不支持图像任务所需的强制工具调用，请切换支持工具调用的模型后重试'
            : loopResult.errorMessage || 'Main Agent Loop failed';
          throw new Error(agentAnalysis
            ? '需求分析未完成，任务状态已保留，可继续重试'
            : loopResult.stopReason === 'budget_exceeded'
            ? 'Main Agent 上下文读取预算已用尽，请缩小范围后重试'
            : loopFailureMessage);
        }
        if (loopResult.stopReason === 'confirmation_required' && loopResult.confirmation?.toolName === 'request_user_decision') {
          const clarification = loopResult.confirmation.arguments || loopResult.confirmation.clarification || {};
          const recommendedOptionId = String(clarification.recommendedOptionId || '');
          const request: AgentClarificationRequest = {
            id: randomUUID(),
            taskId: agentAnalysis?.taskId || rootTaskId(),
            question: String(clarification.question || loopResult.confirmation.message || ''),
            dimension: String(clarification.dimension || 'general'),
            options: (Array.isArray(clarification.options) ? clarification.options : []).map((option: any) => ({
              id: String(option.id || ''),
              label: `${String(option.label || '')}${String(option.id || '') === recommendedOptionId ? '（推荐）' : ''}`,
              answer: String(option.answer || ''),
              description: String(option.description || ''),
            })),
            allowCustom: true,
            allowProceed: false,
          };
          const checkpoint = progressTracker.snapshot();
          writeInteractionEvent({
            type: 'clarification_required',
            message: request.question,
            request,
            state: {
              taskId: request.taskId,
              sourceUserMessageId: rootSourceUserMessageId(),
              operationId: checkpoint.operationId,
              skillSource,
              lastSequence: checkpoint.lastSequence,
              intent: imagePlanning || body.intent === 'image' ? 'image' : 'chat',
              ...(selectedSkill ? { skillId: selectedSkill.id, skillRead: mainAgentLoopState.skillRead } : {}),
              originalRequest: rootOriginalRequest(),
              workingBrief: rootOriginalRequest(),
              askedDimensions: [request.dimension],
              answers: [],
              referenceImages: executionReferenceImages,
              ...(runReferenceContext ? { referenceContext: structuredClone(runReferenceContext) } : {}),
              ...(imageOperation ? { imageOperation } : {}),
              ...(targetReferenceId ? { targetReferenceId } : {}),
              ...(agentAnalysis ? { agentAnalysis: structuredClone(agentAnalysis) } : {}),
              ...(imagePlanning ? { imagePlanning: structuredClone(imagePlanning) } : {}),
              mainAgentLoop: {
                transcript: structuredClone(loopResult.transcript),
                pendingCall: {
                  id: String(loopResult.confirmation.toolCallId || ''),
                  name: 'request_user_decision',
                  args: structuredClone(clarification),
                  ...(Array.isArray(loopResult.confirmation.batch) ? { batch: structuredClone(loopResult.confirmation.batch) } : {}),
                },
                budgets: {
                  turnsUsed: loopResult.turns,
                  toolCallsUsed: loopResult.toolCalls,
                  budgetedToolCallsUsed: loopResult.budgetedToolCalls,
                  mutationToolCallsUsed: loopResult.mutationToolCalls,
                },
                memoryPatches: structuredClone(stagedMainAgentMemoryPatches),
                selectedSkillId: selectedSkill?.id || null,
                skillRead: mainAgentLoopState.skillRead,
                contextScopes: [...mainAgentLoopState.contextScopes],
              },
            },
          });
          writeProgress({ stepId: 'agent_analysis', phase: 'waiting_input', status: 'waiting', label: '等待你选择' });
          writeAgentDone('user_decision_required');
          return;
        }
        if (loopResult.stopReason === 'confirmation_required' && loopResult.confirmation?.toolName === 'request_context_selection') {
          const candidates = Array.isArray(loopResult.confirmation.candidates) ? loopResult.confirmation.candidates : [];
          const taskId = rootTaskId();
          const pausedIntent = activeClarificationState?.intent
            || recoveryBaseRecord?.intent
            || (selectedSkill || body.intent === 'image' ? 'image' : 'chat');
          const request: AgentClarificationRequest = {
            id: randomUUID(),
            taskId,
            question: String(loopResult.confirmation.message || '请选择要使用的历史图片。'),
            dimension: 'context_reference',
            options: candidates.map((candidate: any) => ({
              id: String(candidate.id),
              label: String(candidate.label),
              answer: `选择上下文实体 ${candidate.id}`,
              description: String(candidate.kind),
            })),
            allowCustom: false,
            allowProceed: false,
          };
          const checkpoint = progressTracker.snapshot();
          writeInteractionEvent({
            type: 'clarification_required',
            message: request.question,
            request,
            state: {
              taskId,
              sourceUserMessageId: rootSourceUserMessageId(),
              operationId: checkpoint.operationId,
              skillSource,
              lastSequence: checkpoint.lastSequence,
              intent: pausedIntent === 'skill_action' ? 'skill_action' : pausedIntent === 'image' ? 'image' : 'chat',
              ...(selectedSkill ? { skillId: selectedSkill.id, skillRead: mainAgentLoopState.skillRead } : {}),
              ...(imageOperation ? { imageOperation } : {}),
              ...(targetReferenceId ? { targetReferenceId } : {}),
              originalRequest: rootOriginalRequest(),
              workingBrief: activeClarificationState?.workingBrief || rootOriginalRequest(),
              askedDimensions: ['context_reference'],
              answers: [],
              contextCandidates: candidates.map((candidate: any) => contextEntityById.get(String(candidate.id))).filter(Boolean),
              mainAgentLoop: {
                transcript: structuredClone(loopResult.transcript),
                pendingCall: {
                  id: String(loopResult.confirmation.toolCallId || ''),
                  name: String(loopResult.confirmation.toolName || ''),
                  args: (loopResult.confirmation.arguments && typeof loopResult.confirmation.arguments === 'object')
                    ? structuredClone(loopResult.confirmation.arguments as Record<string, unknown>)
                    : {},
                  ...(Array.isArray(loopResult.confirmation.batch)
                    ? { batch: structuredClone(loopResult.confirmation.batch) }
                    : {}),
                },
                budgets: {
                  turnsUsed: loopResult.turns,
                  toolCallsUsed: loopResult.toolCalls,
                  budgetedToolCallsUsed: loopResult.budgetedToolCalls,
                  mutationToolCallsUsed: loopResult.mutationToolCalls,
                },
                memoryPatches: structuredClone(stagedMainAgentMemoryPatches),
                selectedSkillId: mainAgentLoopState.selectedSkillId,
                skillRead: mainAgentLoopState.skillRead,
                contextScopes: [...mainAgentLoopState.contextScopes],
              },
            },
          });
          void contextLogger.info('main_agent.loop_paused', 'Main Agent Loop paused for context selection', {
            taskId,
            runId,
            skillId: selectedSkill?.id || null,
            candidateIds: candidates.map((candidate: any) => candidate.id),
          });
          writeAgentDone('context_reference_required');
          return;
        }
        const terminal = loopResult.terminal as any;
        if (!terminal && !String(loopResult.content || '').trim()) {
          throw new Error('Main Agent returned an empty response');
        }
        if (!terminal) {
          intent = 'chat';
          const proposal = parseAgentProposalBlock(loopResult.content || '');
          emitIntentResolved(intent);
          commitMainAgentMemory();
          if (proposal.proposal) writeEvent(controller, { type: 'proposal_presented', proposal: proposal.proposal });
          void contextLogger.info('main_agent.loop_resolved', 'Main Agent Loop returned a final answer', {
            durationMs: Date.now() - mainAgentStartedAt,
            route: 'chat',
            turns: loopResult.turns,
            toolCalls: loopResult.toolCalls,
          });
          void contextLogger.info('main_agent.first_exit', 'Main Agent selected a direct response', {
            taskId: agentAnalysis?.taskId || null,
            runId,
            checkpoint: agentAnalysis?.checkpointCount || 0,
            scope: body.intent || 'agent',
            skillId: selectedSkill?.id || null,
            operation: imageOperation,
            exit: 'text',
            localSemanticRoutingHits: 0,
          });
          writeAgentDone('completed');
          return;
        }
        if (terminal.type !== 'image_execution_plan' || !terminal.plan) {
          throw new Error(`Main Agent returned unsupported terminal control: ${terminal.type || 'unknown'}`);
        }
        const plannerUserMessage = recoveryBaseRecord?.originalRequest || latestUserMessage;
        executionPlan = terminal.plan as AgentExecutionPlan;
        if (executionPlan.generation?.aspectRatio) {
          body.imageOptions = { ...body.imageOptions, aspectRatio: executionPlan.generation.aspectRatio };
        }
        executionPlanSource = 'model';
        executionPlanSourceDetail = 'tool_call';
        executionKind = executionPlan.execution.kind;
        imageDeliveryPlan = executionPlanToImageDeliveryPlan(executionPlan) as ImageDeliveryPlan;
        executionBriefData = executionPlanToBrief(executionPlan, plannerUserMessage, contextEntities) as ExecutionBrief;
        executionBrief = executionBriefData.plainText;
        executionReferenceImages = Array.from(new Set([
          ...executionReferenceImages,
          ...executionBriefData.referenceImageUrls,
        ]));
        executionReferenceImages = resolveAgentImageCardReferences({
          referenceContext: runReferenceContext,
          referenceImages: executionReferenceImages,
          imageTask: executionPlan.imageTask,
        }).orderedReferenceImages;
        intent = executionPlan.intent === 'skill_action' ? 'skill_action' : 'image';
        frontDoorResult = {
          route: 'planner',
          skillId: executionPlan.skillId,
          confidence: executionPlan.confidence,
        };
        selectedSkill = executionPlan.skillId
          ? skillManifests.find((manifest) => manifest.id === executionPlan?.skillId) || null
          : null;
        skillSource = selectedSkill ? skillSource || (body.activeSkillId ? 'manual_ui' : 'recovery') : null;
        const referenced = executionPlan.contextReferences
          .map((id) => contextEntities.find((entity) => entity.id === id))
          .filter((entity): entity is AgentContextEntity => Boolean(entity));
        contextResolution = referenced.length > 0
          ? {
              status: 'resolved',
              detected: true,
              confidence: executionPlan.confidence === 'low' ? 'medium' : 'high',
              candidates: referenced,
              entityIds: referenced.map((entity) => entity.id),
            }
          : { status: 'none', detected: false, confidence: 'none', candidates: [], entityIds: [] };
        promptCompilation = executionPlan.generation ? {
          skillId: selectedSkill?.id || null,
          skillLabel: selectedSkill?.name || null,
          skillRead: mainAgentLoopState.skillRead,
          plannerProviderId: resolvedChatSelection.providerId || null,
          plannerModel: resolvedChatSelection.model,
          referenceCount: runReferenceContext?.references.length || 0,
          visualReferencesUsed: Boolean(executionPlan.visualContext?.references.length),
          durationMs: Date.now() - mainAgentStartedAt,
          compiledAt: Date.now(),
        } : undefined;
        commitMainAgentMemory({
          activeTask: { status: 'planning', summary: plannerUserMessage.slice(0, 1000) },
          recentReferencedAssetIds: executionPlan.visualContext?.references.map((reference) => reference.referenceId) || [],
        });
        void contextLogger.info('main_agent.loop_resolved', 'Main Agent submitted an image execution contract', {
          durationMs: Date.now() - mainAgentStartedAt,
          skillId: executionPlan.skillId,
          intent: executionPlan.intent,
          executionKind: executionPlan.execution.kind,
          executionTool: executionPlan.execution.tool,
          outputCount: executionPlan.delivery.outputCount,
          visualReferenceCount: executionPlan.visualContext?.references.length || 0,
          turns: loopResult.turns,
          toolCalls: loopResult.toolCalls,
        });
        if (executionPlan.needsClarification && executionPlan.clarification) {
          const taskId = rootTaskId();
          const request: AgentClarificationRequest = {
            id: randomUUID(),
            taskId,
            question: executionPlan.clarification.question,
            dimension: executionPlan.clarification.dimension,
            options: executionPlan.clarification.options,
            allowCustom: true,
            allowProceed: true,
          };
          writeProgress({ stepId: 'clarification', phase: 'waiting_input', status: 'waiting', label: '等待补充关键信息' });
          const checkpoint = progressTracker.snapshot();
          writeInteractionEvent({
            type: 'clarification_required',
            message: request.question,
            request,
            state: {
              taskId,
              sourceUserMessageId: rootSourceUserMessageId(),
              operationId: checkpoint.operationId,
              skillSource,
              lastSequence: checkpoint.lastSequence,
              intent: executionPlan.intent === 'skill_action' ? 'skill_action' : 'image',
              ...(selectedSkill ? { skillId: selectedSkill.id, skillRead: mainAgentLoopState.skillRead } : {}),
              originalRequest: rootOriginalRequest(),
              workingBrief: executionBrief,
              askedDimensions: [],
              answers: [],
              referenceImages: executionReferenceImages,
              ...(runReferenceContext ? { referenceContext: structuredClone(runReferenceContext) } : {}),
              ...(plannerVisualSummary ? { visualSummary: structuredClone(plannerVisualSummary) } : {}),
              requestedImageCountTotal: executionPlan.delivery.outputCount,
              resolvedImageCount: executionPlan.delivery.outputCount,
              resolvedImageCountSource: 'prompt',
              resolvedImageDeliveryMode: executionPlan.delivery.mode === 'single' ? 'variants' : executionPlan.delivery.mode,
              resolvedImagePanelCount: executionPlan.delivery.panelCount || undefined,
              executionPlan: structuredClone(executionPlan),
            },
          });
          void contextLogger.info('main_agent.loop_paused', 'Main Agent Loop paused for task clarification', {
            taskId,
            runId,
            skillId: selectedSkill?.id || null,
            dimension: request.dimension,
          });
          writeAgentDone('clarification_required');
          return;
        }
        if (!body.clarificationResponse && contextResolution.detected) {
          if (contextResolution.status === 'resolved') {
            executionBriefData = executionPlan
              ? executionPlanToBrief(executionPlan, plannerUserMessage, contextEntities) as ExecutionBrief
              : compileExecutionBrief({ userMessage: plannerUserMessage, contextResolution });
            executionBrief = executionBriefData.plainText;
            executionReferenceImages = Array.from(new Set([
              ...executionReferenceImages,
              ...executionBriefData.referenceImageUrls,
            ]));
            const resolvedIntent = contextResolution.candidates[0]?.intent;
            if (!executionPlan && (resolvedIntent === 'image' || resolvedIntent === 'skill_action')) intent = resolvedIntent;
            const labels = contextResolution.candidates.map((candidate) => candidate.label).filter(Boolean);
            writeEvent(controller, {
              type: 'context_resolved',
              status: 'resolved',
              confidence: contextResolution.confidence === 'medium' ? 'medium' : 'high',
              entityIds: contextResolution.entityIds,
              labels,
              kind: contextResolution.candidates[0]?.kind || 'context',
            });
            writeEvent(controller, {
              type: 'brief_compiled',
              resolvedEntityIds: executionBriefData.resolvedEntityIds,
              summary: labels.join('、') || '已整合当前需求',
              mustPreserveCount: executionBriefData.mustPreserve.length,
            });
            void contextLogger.info('context.resolved', 'Agent context reference resolved', {
              status: contextResolution.status,
              confidence: contextResolution.confidence,
              entityIds: contextResolution.entityIds,
              kinds: contextResolution.candidates.map((candidate) => candidate.kind),
            });
          } else {
            const candidates = contextResolution.candidates.slice(0, 4);
            const taskId = rootTaskId();
            const request: AgentClarificationRequest = {
              id: randomUUID(),
              taskId,
              question: candidates.length > 0
                ? '我找到了多个可能的引用，请确认你想使用哪一个。'
                : '我无法确定你引用的是哪个方案、图片或画布对象，请补充名称或重新选择。',
              dimension: 'context_reference',
              options: candidates.map((candidate) => ({
                id: candidate.id,
                label: candidate.label,
                answer: candidate.brief,
                description: candidate.summary,
              })),
              allowCustom: true,
              allowProceed: true,
            };
            writeProgress({ stepId: 'context_resolution', phase: 'resolving', status: 'waiting', label: '等待确认引用对象' });
            const checkpoint = progressTracker.snapshot();
            writeInteractionEvent({
              type: 'clarification_required',
              message: request.question,
              request,
              state: {
                taskId,
                sourceUserMessageId: rootSourceUserMessageId(),
                operationId: checkpoint.operationId,
                skillSource,
                lastSequence: checkpoint.lastSequence,
                intent: candidates.every((candidate) => candidate.intent === 'skill_action') ? 'skill_action' : 'image',
                ...(selectedSkill ? { skillId: selectedSkill.id, skillRead: mainAgentLoopState.skillRead } : {}),
                originalRequest: rootOriginalRequest(),
                workingBrief: plannerUserMessage,
                askedDimensions: [],
                answers: [],
                referenceImages: executionReferenceImages,
                ...(runReferenceContext ? { referenceContext: structuredClone(runReferenceContext) } : {}),
                contextCandidates: candidates,
              },
            });
            writeAgentDone('context_reference_required');
            void contextLogger.info('context.waiting', 'Agent context reference requires user input', {
              status: contextResolution.status,
              confidence: contextResolution.confidence,
              candidateIds: candidates.map((candidate) => candidate.id),
            });
            return;
          }
        }
        let routingDecision = null;
        if (body.clarificationResponse && activeClarificationState && body.clarificationRequest) {
          const applied = applyClarificationResponse({
            state: activeClarificationState,
            request: body.clarificationRequest,
            response: body.clarificationResponse,
          });
          if (!applied) throw new Error('Clarification response does not match the pending request');
          pruneClarificationSubmissionStore();
          const nextClarificationSubmissionKey = `${activeClarificationState.taskId}:${body.clarificationResponse.requestId}`;
          if (clarificationSubmissionStore.has(nextClarificationSubmissionKey)) {
            throw new Error('Clarification response has already been submitted');
          }
          clarificationSubmissionStore.set(nextClarificationSubmissionKey, Date.now() + CONFIRMATION_TTL_MS);
          clarificationSubmissionKey = nextClarificationSubmissionKey;
          activeClarificationState = applyImageCountClarificationState(
            applied.state,
            body.clarificationRequest,
            body.clarificationResponse,
          );
          executionBrief = activeClarificationState.workingBrief || activeClarificationState.originalRequest;
          executionReferenceImages = [...(activeClarificationState.referenceImages || executionReferenceImages)];
          const savedClarificationLoop = activeClarificationState.mainAgentLoop;
          const handledByResumedMainAgent = savedClarificationLoop
            && ['context_reference', 'skill_selection'].includes(body.clarificationRequest.dimension);
          if (
            plannerAuthoritative
            && !handledByResumedMainAgent
            && (
              body.clarificationRequest.dimension === 'planner_failure'
              || body.clarificationRequest.dimension === 'planner_model_switch'
              || body.clarificationRequest.dimension === 'image_operation'
              || body.clarificationRequest.dimension === 'recovery_scope'
              || legacyExecutionPlanDetected
              || activeClarificationState.executionPlan?.needsClarification === true
            )
          ) {
            mainAgentInputMessages = [{
              id: activeClarificationState.taskId,
              role: 'user',
              content: activeClarificationState.originalRequest,
            }];
          }
          const selectedContextEntity = body.clarificationRequest.dimension === 'context_reference'
            ? [...(activeClarificationState.contextCandidates || []), ...contextEntities]
                .find((entity) => entity.id === body.clarificationResponse?.selectedOptionId)
            : null;
          if (selectedContextEntity) {
            contextResolution = {
              status: 'resolved',
              detected: true,
              confidence: 'high',
              candidates: [selectedContextEntity],
              entityIds: [selectedContextEntity.id],
            };
            executionBriefData = compileExecutionBrief({ userMessage: latestUserMessage, contextResolution });
            executionBrief = executionBriefData.plainText;
            executionReferenceImages = Array.from(new Set([
              ...executionReferenceImages,
              ...executionBriefData.referenceImageUrls,
            ]));
            writeEvent(controller, {
              type: 'context_resolved',
              status: 'resolved',
              confidence: 'high',
              entityIds: [selectedContextEntity.id],
              labels: [selectedContextEntity.label],
              kind: selectedContextEntity.kind,
            });
          } else if (executionPlan) {
            executionBriefData = executionPlanToBrief(executionPlan, latestUserMessage, contextEntities) as ExecutionBrief;
            executionBrief = executionBriefData.plainText;
          } else {
            executionBriefData = compileExecutionBrief({ userMessage: executionBrief });
          }
          proceedWithCurrentBrief = applied.proceedWithCurrent;
          resumedClarification = true;
          writeProgress({ stepId: 'clarification', phase: 'resuming', status: 'completed', label: '补充信息已应用' });
          intent = activeClarificationState.intent;
          selectedSkill = activeClarificationState.skillId
            ? skillManifests.find((manifest) => manifest.id === activeClarificationState?.skillId) || null
            : selectedSkill;
          if (activeClarificationState.skillId && !selectedSkill) {
            throw new Error('The selected skill is no longer available; please restart the request');
          }
          if (selectedSkill && !skillSource) skillSource = activeClarificationState.skillSource || (body.activeSkillId ? 'manual_ui' : 'recovery');
        } else {
          routingDecision = executionPlan
            ? {
                version: 1,
                intent: executionPlan.intent === 'analysis' ? 'chat' as const : executionPlan.intent,
                skillId: executionPlan.skillId,
                confidence: executionPlan.confidence === 'high' ? 1 : executionPlan.confidence === 'medium' ? 0.7 : 0.4,
                needsClarification: executionPlan.needsClarification,
                clarificationQuestion: executionPlan.clarification?.question,
                source: executionPlanSource || 'fallback',
              }
            : frontDoorResult
            ? {
                version: 1,
                intent: 'image' as const,
                skillId: frontDoorResult.skillId,
                confidence: frontDoorResult.confidence === 'high' ? 1 : frontDoorResult.confidence === 'medium' ? 0.7 : 0.4,
                needsClarification: false,
                source: 'main_agent',
              }
            : explicitBatchImageRequest
            ? {
                version: 1,
                intent: 'image' as const,
                skillId: null,
                confidence: 1,
                needsClarification: false,
                source: 'deterministic_batch',
              }
            : null;
          if (!selectedSkill && executionPlan?.skillId) {
            selectedSkill = skillManifests.find((manifest) => manifest.id === executionPlan.skillId) || null;
            skillSource = selectedSkill ? 'recovery' : null;
          }
          const resolvedContextIntent = contextResolution.status === 'resolved'
            ? contextResolution.candidates[0]?.intent
            : null;
          const routedIntent = executionPlan
            ? routingDecision.intent
            : selectedSkill?.executionMode === 'image_pipeline'
            && conversationIntent.intent === 'image'
            ? 'image'
            : resolvedContextIntent === 'image' || resolvedContextIntent === 'skill_action'
            ? resolvedContextIntent
            : conversationIntent.inherited
              ? conversationIntent.intent
              : routingDecision.intent;
          intent = routedIntent === 'image' && selectedSkill && !selectedSkill.allowedTools.includes('generate_image')
            ? 'chat'
            : routedIntent;
        }
        const selectedSkillMayExecute = Boolean(selectedSkill?.allowedTools?.some(
          (toolName) => toolName === 'generate_image' || toolName === 'start_skill_job'
        ));
        const selectedSkillExecutionRequest = !plannerAuthoritative && selectedSkillMayExecute
          && (
            conversationIntent.inherited
            || (
              /(生成|制作|设计|开始执行|开始制作|输出|出图)/i.test(executionBrief)
              && !/(信息收集|访谈|分析|解释|点评|总结)/i.test(executionBrief)
            )
          );
        if (!plannerAuthoritative && !executionPlan && intent === 'chat' && selectedSkillExecutionRequest) {
          intent = 'skill_action';
        }
        void contextLogger.info('image_contract.resolved', 'Main Agent image contract route resolved', {
          decisionSource: executionPlanSource || routingDecision?.source || null,
          skillSelectionMethod,
          skillCandidateIds,
              skillContentLength: skillContent.length,
          sourceDetail: executionPlanSourceDetail,
          plannerConfidence: executionPlan?.confidence || null,
          conversationIntent: conversationIntent.intent,
          frontDoorRoute: frontDoorResult?.route || null,
          finalIntent: intent,
          selectedSkillId: selectedSkill?.id || null,
          explicitBatchImageRequest,
          requestedCount: explicitBatchCountResolution.count || null,
          countCandidates: explicitBatchCountResolution.candidates || [],
          countStatus: explicitBatchCountResolution.status,
          rawCount: rawUserCountResolution.count || null,
          rawCountStatus: rawUserCountResolution.status,
          briefCount: briefCountResolution.count || null,
          briefCountStatus: briefCountResolution.status,
          deliveryMode: imageDeliveryPlan.mode,
          deliveryOutputCount: imageDeliveryPlan.outputCount,
          panelCount: imageDeliveryPlan.panelCount || null,
          deliveryEvidence: imageDeliveryPlan.evidence,
          contextResolutionSkipped: !shouldResolveInitialContext,
        });
        emitIntentResolved(intent);
        if (selectedSkill) {
          writeEvent(controller, {
            type: 'skill_selected',
            skillId: selectedSkill.id,
            label: selectedSkill.name,
            source: skillSource || 'recovery',
          });
        }
        if (intent === 'chat' && routingDecision?.needsClarification && routingDecision.clarificationQuestion) {
          writeProgress({ stepId: 'clarification', phase: 'waiting_input', status: 'waiting', label: '等待补充关键信息' });
          writeEvent(controller, {
            type: 'assistant_delta',
            delta: routingDecision.clarificationQuestion,
            channel: 'content',
            model: resolvedChatSelection.model,
          });
          writeAgentDone('clarification_required');
          return;
        }

        // Main Agent has already compiled and submitted the image contract; local code only resolves delivery and executes it.
        const shouldResolveImageCount = intent === 'image'
          || Boolean(selectedSkill?.allowedTools?.includes('generate_image'));
        if (shouldResolveImageCount) {
          if (executionPlan) {
            imageDeliveryPlan = executionPlanToImageDeliveryPlan(executionPlan) as ImageDeliveryPlan;
          } else {
            const rawPlan = resolveImageDeliveryPlan(latestUserMessage, requestedImageCount);
            const briefPlan = resolveImageDeliveryPlan(executionBrief, requestedImageCount);
            imageDeliveryPlan = rawPlan.evidence.length > 0 ? rawPlan : briefPlan;
          }
          if (activeClarificationState?.resolvedImageDeliveryMode) {
            imageDeliveryPlan = {
              ...imageDeliveryPlan,
              mode: activeClarificationState.resolvedImageDeliveryMode,
              panelCount: activeClarificationState.resolvedImageDeliveryMode === 'composite'
                ? activeClarificationState.resolvedImagePanelCount
                : undefined,
              requiresClarification: false,
            };
          }
          if (imageDeliveryPlan.requiresClarification) {
            const taskId = rootTaskId();
            const candidates = [...new Set((explicitBatchCountResolution.candidates || [])
              .map((candidate) => positiveInteger(candidate))
              .filter((candidate): candidate is number => Boolean(candidate)))];
            const requestedTotal = Math.max(2, ...candidates);
            const question = '你同时要求多张独立图片和全部放进一张图，需确认最终交付形式。';
            const checkpoint = progressTracker.snapshot();
            const state: AgentClarificationState = {
              ...(activeClarificationState || {
                taskId,
                sourceUserMessageId: rootSourceUserMessageId(),
                intent: intent === 'skill_action' ? 'skill_action' : 'image',
                ...(selectedSkill ? { skillId: selectedSkill.id, skillRead: mainAgentLoopState.skillRead } : {}),
                originalRequest: rootOriginalRequest(),
                workingBrief: executionBrief,
                askedDimensions: [],
                answers: [],
                referenceImages: executionReferenceImages,
                ...(runReferenceContext ? { referenceContext: structuredClone(runReferenceContext) } : {}),
              }),
              taskId,
              operationId: checkpoint.operationId,
              skillSource,
              lastSequence: checkpoint.lastSequence,
              requestedImageCountTotal: requestedTotal,
              pendingImageCountCandidates: candidates,
              resolvedImagePanelCount: imageDeliveryPlan.panelCount,
              ...(executionPlan ? { executionPlan: structuredClone(executionPlan) } : {}),
            };
            const request: AgentClarificationRequest = {
              id: randomUUID(),
              taskId,
              question,
              dimension: 'image_delivery_scope',
              options: [
                {
                  id: 'separate_outputs',
                  label: `生成 ${requestedTotal} 张独立图片`,
                  answer: `生成 ${requestedTotal} 个独立图片文件。`,
                  description: '每张图片单独生成和返回。',
                },
                {
                  id: 'single_composite',
                  label: '生成 1 张多宫格图片',
                  answer: '把多个画面组合在一个图片文件中。',
                  description: '只返回一张包含多个画面的图片。',
                },
              ],
              allowCustom: true,
              allowProceed: true,
            };
            writeProgress({ stepId: 'clarification', phase: 'waiting_input', status: 'waiting', label: '等待确认图片交付形式' });
            writeInteractionEvent({ type: 'clarification_required', message: question, request, state });
            writeAgentDone('image_delivery_scope_required');
            return;
          }
          const countResolution = resolveAgentImageCountDecision({
            prompt: executionBrief,
            rawPrompt: latestUserMessage,
            plannedCount: imageDeliveryPlan.evidence.length > 0 ? imageDeliveryPlan.outputCount : undefined,
            interfaceCount: body.imageOptions?.count,
            clarifiedCount: activeClarificationState?.resolvedImageCount,
            clarifiedSource: activeClarificationState?.resolvedImageCountSource,
            batchPlan: activeClarificationState?.imageBatchPlan,
            proceedWithCurrent: proceedWithCurrentBrief,
          });
          void contextLogger.info('image.count_resolved', 'Agent image count resolved', {
            status: countResolution.status,
            count: countResolution.count || null,
            totalCount: countResolution.totalCount || null,
            source: countResolution.source,
            matchedText: countResolution.matchedText || null,
            deliveryMode: imageDeliveryPlan.mode,
            panelCount: imageDeliveryPlan.panelCount || null,
            deliveryEvidence: imageDeliveryPlan.evidence,
          });
          if (countResolution.status === 'ambiguous' || countResolution.status === 'overflow') {
            const taskId = rootTaskId();
            const candidates = [...new Set((countResolution.candidates || [])
              .map((candidate) => positiveInteger(candidate))
              .filter((candidate): candidate is number => Boolean(candidate)))];
            const requestedTotal = positiveInteger(countResolution.totalCount || countResolution.count)
              || candidates[0]
              || AGENT_DEFAULT_IMAGE_OPTIONS.count;
            const isOverflow = countResolution.status === 'overflow';
            const options = isOverflow
              ? [
                  {
                    id: 'first_batch',
                    label: `先生成 ${AGENT_MAX_IMAGE_BATCH_COUNT} 张`,
                    answer: `本次只生成前 ${AGENT_MAX_IMAGE_BATCH_COUNT} 张。`,
                    description: '生成单批上限数量，不自动继续剩余图片。',
                  },
                  {
                    id: 'split_batches',
                    label: '拆分多批',
                    answer: `将 ${requestedTotal} 张拆成每批最多 ${AGENT_MAX_IMAGE_BATCH_COUNT} 张，每批单独确认。`,
                    description: '只有成功生成的图片才计入完成数量。',
                  },
                ]
              : [...new Set([...candidates, AGENT_DEFAULT_IMAGE_OPTIONS.count])]
                  .slice(0, 4)
                  .map((count) => ({
                    id: `count_${count}`,
                    label: `${count} 张`,
                    answer: `本次交付数量为 ${count} 张。`,
                    description: count === AGENT_DEFAULT_IMAGE_OPTIONS.count
                      ? '按单张图片理解。'
                      : `按 ${count} 个独立图片交付。`,
                  }));
            const question = isOverflow
              ? `你要求生成 ${requestedTotal} 张图片，当前单批最多 ${AGENT_MAX_IMAGE_BATCH_COUNT} 张。你希望怎么处理？`
              : `我检测到多个可能的交付数量${candidates.length ? `（${candidates.join('、')} 张）` : ''}，请确认本次要生成多少张图片。`;
            writeProgress({ stepId: 'clarification', phase: 'waiting_input', status: 'waiting', label: '等待确认交付数量' });
            const checkpoint = progressTracker.snapshot();
            const state: AgentClarificationState = {
              ...(activeClarificationState || {
                taskId,
                sourceUserMessageId: rootSourceUserMessageId(),
                intent: intent === 'skill_action' ? 'skill_action' : 'image',
                ...(selectedSkill ? { skillId: selectedSkill.id, skillRead: mainAgentLoopState.skillRead } : {}),
                originalRequest: rootOriginalRequest(),
                workingBrief: executionBrief,
                askedDimensions: [],
                answers: [],
                referenceImages: executionReferenceImages,
                ...(runReferenceContext ? { referenceContext: structuredClone(runReferenceContext) } : {}),
              }),
              taskId,
              operationId: checkpoint.operationId,
              skillSource,
              lastSequence: checkpoint.lastSequence,
              ...(selectedSkill ? { skillId: selectedSkill.id, skillRead: mainAgentLoopState.skillRead } : {}),
              requestedImageCountTotal: requestedTotal,
              pendingImageCountCandidates: candidates,
              ...(executionPlan ? { executionPlan: structuredClone(executionPlan) } : {}),
            };
            const request: AgentClarificationRequest = {
              id: randomUUID(),
              taskId,
              question,
              dimension: isOverflow ? 'output_count_batching' : 'output_count_ambiguity',
              options,
              allowCustom: true,
              allowProceed: true,
            };
            writeInteractionEvent({ type: 'clarification_required', message: question, request, state });
            writeAgentDone('output_count_required');
            return;
          }
          requestedImageCount = countResolution.count;
          requestedTotalImageCount = countResolution.totalCount || countResolution.count;
          requestedImageCountSource = countResolution.source as AgentImageCountSource;
          imageDeliveryPlan = {
            ...imageDeliveryPlan,
            outputCount: requestedTotalImageCount,
            promptCount: imageDeliveryPlan.mode === 'series' ? requestedTotalImageCount : 1,
          };
          imageBatchPlan = countResolution.batchPlan
            ? structuredClone(countResolution.batchPlan)
            : undefined;
        }
        const shouldRunClarifier = (intent === 'image' || intent === 'skill_action')
          && !executionPlan;

        if (shouldRunClarifier && !proceedWithCurrentBrief) {
          writeProgress({ stepId: 'clarification', phase: 'analyzing', status: 'active', label: '正在检查需求完整性' });
          const clarificationState: AgentClarificationState = activeClarificationState || {
            taskId: rootTaskId(),
            sourceUserMessageId: rootSourceUserMessageId(),
            operationId: progressTracker.snapshot().operationId,
            skillSource,
            lastSequence: progressTracker.snapshot().lastSequence,
            intent: intent === 'skill_action' ? 'skill_action' : 'image',
            ...(selectedSkill ? { skillId: selectedSkill.id, skillRead: mainAgentLoopState.skillRead } : {}),
            originalRequest: rootOriginalRequest(),
            workingBrief: executionBrief,
            askedDimensions: [],
            answers: [],
            referenceImages: executionReferenceImages,
            ...(runReferenceContext ? { referenceContext: structuredClone(runReferenceContext) } : {}),
            ...(plannerVisualSummary ? { visualSummary: structuredClone(plannerVisualSummary) } : {}),
            ...(executionPlan ? { executionPlan: structuredClone(executionPlan) } : {}),
          };
          const clarification = await resolveBriefClarification({
            userMessage: executionBrief,
            intent: clarificationState.intent,
            skillContent,
            referenceImageCount: executionReferenceImages.length,
            state: clarificationState,
            requireCreativeDirectionConfirmation: conversationIntent.needsDirectionConfirmation,
            providerId: resolvedChatSelection.providerId || undefined,
            model: resolvedChatSelection.model,
            signal: runSignal,
            chatFn: chat,
          });

          if (clarification.failed || !clarification.result) {
            const failedState = {
              ...clarificationState,
              workingBrief: clarification.fallbackBrief || clarificationState.workingBrief,
            };
            const failedRequest: AgentClarificationRequest = {
              id: randomUUID(),
              taskId: failedState.taskId,
              question: '暂时无法确认需求是否完整，你可以重新分析，或按当前信息开始制作。',
              dimension: 'clarifier_failure',
              options: [],
              allowCustom: true,
              allowProceed: true,
              failed: true,
            };
            writeProgress({ stepId: 'clarification', phase: 'waiting_input', status: 'waiting', label: '等待补充需求信息' });
            const failedCheckpoint = progressTracker.snapshot();
            const resumableFailedState: AgentClarificationState = {
              ...failedState,
              operationId: failedCheckpoint.operationId,
              skillSource,
              lastSequence: failedCheckpoint.lastSequence,
            };
            writeInteractionEvent({
              type: 'clarification_required',
              message: failedRequest.question,
              request: failedRequest,
              state: resumableFailedState,
            });
            writeAgentDone('clarification_failed');
            return;
          }

          executionBrief = clarification.result.workingBrief;
          if (shouldAskClarification({
            result: clarification.result,
            userMessage: clarificationState.workingBrief || clarificationState.originalRequest,
            askedDimensions: clarificationState.askedDimensions,
            referenceImageCount: executionReferenceImages.length,
            requireCreativeDirectionConfirmation: conversationIntent.needsDirectionConfirmation,
          })) {
            const nextState: AgentClarificationState = {
              ...clarificationState,
              workingBrief: clarification.result.workingBrief,
            };
            const clarificationRequest: AgentClarificationRequest = {
              id: randomUUID(),
              taskId: nextState.taskId,
              question: clarification.result.question!,
              dimension: clarification.result.ambiguity!.dimension,
              options: clarification.result.options || [],
              allowCustom: true,
              allowProceed: true,
            };
            writeProgress({ stepId: 'clarification', phase: 'waiting_input', status: 'waiting', label: '等待补充需求信息' });
            const clarificationCheckpoint = progressTracker.snapshot();
            const resumableNextState: AgentClarificationState = {
              ...nextState,
              operationId: clarificationCheckpoint.operationId,
              skillSource,
              lastSequence: clarificationCheckpoint.lastSequence,
            };
            writeInteractionEvent({
              type: 'clarification_required',
              message: clarificationRequest.question,
              request: clarificationRequest,
              state: resumableNextState,
            });
            writeAgentDone('clarification_required');
            return;
          }
          writeProgress({ stepId: 'clarification', phase: 'analyzing', status: 'completed', label: '需求信息已确认' });
        } else if (resumedClarification && proceedWithCurrentBrief) {
          writeProgress({ stepId: 'clarification', phase: 'resuming', status: 'completed', label: '已按当前信息继续' });
        }

        const shouldUseImagePipeline = executionKind
          ? executionKind === 'image_pipeline'
          : intent === 'image' && (!selectedSkill || selectedSkill.executionMode === 'image_pipeline');
        if (shouldUseImagePipeline) {
          const availableReferenceIds = new Set((runReferenceContext?.references || []).map((reference) => reference.id));
          const imageTask = executionPlan?.imageTask;
          const presentation = executionPlan?.presentation;
          const generation = executionPlan?.version === 4 ? executionPlan.generation : null;
          const invalidExecutablePlan = !executionPlan
            || executionPlan.version !== 4
            || executionPlan.intent !== 'image'
            || executionPlan.execution.kind !== 'image_pipeline'
            || executionPlan.execution.tool !== 'generate_image'
            || !imageTask
            || !presentation
            || !generation;
          const invalidEditPlan = imageTask?.operation === 'edit' && (
            !imageTask.targetReferenceId
            || !availableReferenceIds.has(imageTask.targetReferenceId)
            || imageTask.supportingReferenceIds.includes(imageTask.targetReferenceId)
            || Boolean(imageTask.sourceReferenceId)
          );
          const invalidGenerateSource = imageTask?.operation === 'generate' && Boolean(imageTask.sourceReferenceId)
            && (!availableReferenceIds.has(imageTask.sourceReferenceId!)
              || !imageTask.supportingReferenceIds.includes(imageTask.sourceReferenceId!));
          const referencedTaskWithoutRoles = Boolean(runReferenceContext?.references.length) && !imageTask;
          if (invalidExecutablePlan || invalidEditPlan || invalidGenerateSource || referencedTaskWithoutRoles) {
            const message = '模型未能形成可安全执行的图片计划，系统已在生图前停止。请重新规划当前请求。';
            const failedTaskId = rootTaskId();
            const failedRequest: AgentClarificationRequest = {
              id: randomUUID(),
              taskId: failedTaskId,
              question: message,
              dimension: 'planner_failure',
              options: [],
              allowCustom: true,
              allowProceed: true,
              failed: true,
            };
            const failedCheckpoint = progressTracker.snapshot();
            writeProgress({ stepId: 'agent_analysis', phase: 'analyzing', status: 'failed', label: '图片计划校验失败，已停止执行' });
            writeInteractionEvent({
              type: 'clarification_required',
              message,
              request: failedRequest,
              state: {
                taskId: failedTaskId,
                sourceUserMessageId: rootSourceUserMessageId(),
                operationId: failedCheckpoint.operationId,
                skillSource,
                lastSequence: failedCheckpoint.lastSequence,
                intent: 'image',
                ...(selectedSkill ? { skillId: selectedSkill.id, skillRead: mainAgentLoopState.skillRead } : {}),
                originalRequest: rootOriginalRequest(),
                workingBrief: activeClarificationState?.workingBrief || rootOriginalRequest(),
                askedDimensions: [],
                answers: [],
                referenceImages: [...executionReferenceImages],
                ...(runReferenceContext ? { referenceContext: structuredClone(runReferenceContext) } : {}),
                plannerFailure: {
                  reason: 'invalid_plan',
                  retryMode: 'replan',
                  failedAt: Date.now(),
                },
              },
            });
            writeEvent(controller, {
              type: 'agent_error',
              stage: 'planning',
              message,
              reason: 'invalid_plan',
              retryable: false,
              recoveryRecord: buildRecoveryRecord({
                stage: 'planning',
                message,
                reason: 'invalid_plan',
                retryable: false,
                resumeRoute: 'main_agent',
              }),
              ...progressTracker.stamp(),
            });
            writeAgentDone('planner_failed');
            return;
          }
          turns += 1;
          const refinedDeliveryPlan = executionPlan
            ? executionPlanToImageDeliveryPlan(executionPlan) as ImageDeliveryPlan
            : resolveImageDeliveryPlan(executionBrief, requestedTotalImageCount);
          if (!activeClarificationState?.resolvedImageDeliveryMode) {
            imageDeliveryPlan = {
              ...refinedDeliveryPlan,
              outputCount: requestedTotalImageCount,
              promptCount: refinedDeliveryPlan.mode === 'series' ? requestedTotalImageCount : 1,
            };
          }
          const imageBatchMode = imageDeliveryPlan.mode as AgentImageBatchMode;
          const finalGenerationPrompt = generation!.prompt;
          const plannerGenerationItems = generation!.items.map((item, index) => ({
            ...item,
            subject: executionPlan?.delivery.items[index]?.subject || item.label,
          }));
          const plannerSeriesItems = executionPlan?.delivery?.items || [];
          const allGenerationItems: AgentImageGenerationItem[] = requestedTotalImageCount > 1
            ? imageBatchMode === 'series'
              ? (plannerGenerationItems.length > 0 ? plannerGenerationItems : plannerSeriesItems).map((item: any) => ({
                  id: `series-${item.index}`,
                  index: item.index,
                  label: item.label || `系列 ${item.index}`,
                  subject: item.subject || 'series item',
                  prompt: item.prompt || finalGenerationPrompt,
                }))
              : Array.from({ length: requestedTotalImageCount }, (_, index) => ({
                  id: `${imageBatchMode}-${index + 1}`,
                  index: index + 1,
                  label: imageBatchMode === 'composite' ? `多宫格 ${index + 1}` : `变体 ${index + 1}`,
                  subject: imageBatchMode === 'composite' ? 'composite image' : 'image variant',
                  prompt: finalGenerationPrompt,
                }))
            : [];
          if (requestedTotalImageCount > 1 && allGenerationItems.length !== requestedTotalImageCount) {
            throw new Error(`系列生成计划数量不完整：需要 ${requestedTotalImageCount} 项。`);
          }
          const imageToolArgs = lockedImageToolArgs || {
            operation: imageTask?.operation,
            prompt: finalGenerationPrompt,
            referenceIds: [...(executionPlan?.contextReferences || [])],
            targetReferenceId: imageTask?.targetReferenceId || null,
            outputCount: requestedTotalImageCount,
            aspectRatio: generation!.aspectRatio,
            deliveryMode: executionPlan?.delivery.mode || 'single',
            panelCount: executionPlan?.delivery.panelCount || null,
            items: allGenerationItems.map((item) => ({ prompt: item.prompt })),
          };
          if (requestedTotalImageCount > 1) {
            void contextLogger.info('image.batch_plan', 'Agent image batch plan resolved', {
              mode: imageBatchMode,
              requestedCount: requestedTotalImageCount,
              itemCount: allGenerationItems.length,
              uniquePromptCount: new Set(allGenerationItems.map((item) => item.prompt)).size,
              subjects: imageBatchMode === 'series'
                ? allGenerationItems.map((item) => item.subject)
                : [],
            });
          }
          const requiresImageConfirmation = (
            (requestedImageCount > 1 && body.imageOptions?.autoConfirm !== true)
            || executionPlan?.execution.requiresConfirmation === true
          );
          if (requiresImageConfirmation) {
            const previewPromptEntries = allGenerationItems.length > 0
              ? allGenerationItems
              : [{ id: 'image-1', index: 1, label: '图片 1', subject: 'image', prompt: finalGenerationPrompt }];
            const progressToolCallId = `${runId}-generate-image-confirmation`;
            copyToolPublicProgress(progressToolCallId, imagePublicProgress, 'generate_image');
            writePromptPreparationProgress('active', progressToolCallId);
            previewPromptEntries.forEach((item, index) => writeEvent(controller, {
              type: 'image_prompts_ready',
              index,
              label: item.label || `图片 ${index + 1}`,
              prompt: item.prompt,
              toolCallId: progressToolCallId,
              completedLabel: imagePublicProgress?.promptPreparation?.completedLabel,
              completionSummary: imagePublicProgress?.promptPreparation?.completionSummary,
              ...progressTracker.stamp(),
              ...(promptCompilation ? { compilation: promptCompilation } : {}),
            }));
            writePromptPreparationProgress('completed', progressToolCallId);
            const generationItems = allGenerationItems.slice(0, requestedImageCount);
            const resolvedImageSelection = resolveProviderModelSelection({
              providers,
              purpose: 'image',
              requestedProviderId: body.imageOptions?.providerId,
              requestedModel: body.imageOptions?.model,
            });
            if (!resolvedImageSelection.providerId || !resolvedImageSelection.model) {
              throw new Error('No enabled image provider and model are configured');
            }
            const resolvedImageProvider = providers.find((provider) => provider.id === resolvedImageSelection.providerId);
            const confirmationId = randomUUID();
            writeToolProgress('generate_image', 'waiting', progressToolCallId);
            const confirmationCheckpoint = progressTracker.snapshot();
            const confirmationTaskReservation = getTaskExecutionReservation({
              kind: 'image_pipeline',
              tool: 'generate_image',
              imageTask: executionPlan?.imageTask,
              outputCount: requestedTotalImageCount,
            });
            confirmationStore.set(confirmationId, {
              ...confirmationTaskIdentity(),
              version: 1,
              confirmationId,
              status: 'pending',
              operationId: confirmationCheckpoint.operationId,
              skillSource,
              lastSequence: confirmationCheckpoint.lastSequence,
              progressSequence: confirmationCheckpoint.lastSequence,
              progressToolCallId,
              skillId: selectedSkill?.id || null,
              toolName: 'generate_image',
              toolArgs: structuredClone(imageToolArgs),
              pendingToolCall: {
                id: progressToolCallId,
                name: 'generate_image',
                args: structuredClone(imageToolArgs),
                argsHash: hashEnvelopeValue(imageToolArgs),
                batch: [{ id: progressToolCallId, name: 'generate_image', args: structuredClone(imageToolArgs) }],
              },
              resolvedImageProviderId: resolvedImageSelection.providerId,
              resolvedImageModel: resolvedImageSelection.model,
              imageProviderModelFingerprint: fingerprintProviderModel(
                resolvedImageProvider as unknown as Record<string, unknown>,
                resolvedImageSelection.model,
                'image',
              ),
              allowedTools: ['generate_image'],
              userMessage: latestUserMessage,
              generationBrief: executionBrief,
              executionBrief: structuredClone(executionBriefData),
              imageTask: executionPlan?.imageTask ? structuredClone(executionPlan.imageTask) : undefined,
              visualContext: executionPlan?.visualContext ? structuredClone(executionPlan.visualContext) : undefined,
              presentation: executionPlan?.presentation ? structuredClone(executionPlan.presentation) : undefined,
              publicProgress: imagePublicProgress ? structuredClone(imagePublicProgress) : undefined,
              referenceContext: runReferenceContext ? structuredClone(runReferenceContext) : undefined,
              referenceImages: [...executionReferenceImages],
              canvasContext: body.canvasContext ? structuredClone(body.canvasContext) : undefined,
              imageOptions: { ...structuredClone(body.imageOptions || {}), count: requestedImageCount },
              imageCountSource: requestedImageCountSource,
              promptOptimized: false,
              promptCompilation: promptCompilation ? structuredClone(promptCompilation) : undefined,
              requestedTotalImageCount,
              imageBatchPlan: imageBatchPlan ? structuredClone(imageBatchPlan) : undefined,
              imageBatchMode,
              imageDeliveryPlan: structuredClone(imageDeliveryPlan),
              generationItems: structuredClone(generationItems),
              remainingGenerationItems: structuredClone(allGenerationItems.slice(generationItems.length)),
              pendingTaskIdentities: structuredClone(confirmationTaskReservation?.identities.slice(0, requestedImageCount) || []),
              remainingTaskIdentities: structuredClone(confirmationTaskReservation?.identities.slice(requestedImageCount) || []),
              expiresAt: Date.now() + CONFIRMATION_TTL_MS,
            });
            writeInteractionEvent({
              type: 'confirmation_required',
              request: {
                confirmationId,
                toolName: 'generate_image',
                message: imageBatchPlan
                  ? `本次将生成首批 ${requestedImageCount} 张图片，总目标 ${requestedTotalImageCount} 张，确认后继续。`
                  : `本次将生成 ${describeImageDelivery(imageDeliveryPlan, requestedImageCount)}，确认后继续。`,
              },
            });
            writeAgentDone('awaiting_confirmation');
            return;
          }

          if (toolCalls >= MAX_TOOL_CALLS || turns > MAX_AGENT_TURNS) {
            throw new Error('Agent run budget exceeded');
          }
          toolCalls += 1;
          const toolCallId = `${runId}-generate-image-1`;
          copyToolPublicProgress(toolCallId, imagePublicProgress, 'generate_image');
          writeToolProgress('generate_image', 'active', toolCallId);
          writeToolStartEvent(toolCallId, 'generate_image');

          const toolRegistry = createAgentToolRegistry({
            generateImage: async (_args: Record<string, unknown>, context: { toolCallId?: string }) => generateImagePayload(
              executionBrief,
              body.imageOptions,
              executionReferenceImages,
              finalGenerationPrompt,
              {
                source: requestedImageCountSource,
                totalCount: requestedTotalImageCount,
                promptOptimized: false,
              },
              allGenerationItems,
              { toolCallId: context.toolCallId },
              imageDeliveryPlan,
            ),
          });
          const generationPayload = await executeAgentTool(toolRegistry, 'generate_image', imageToolArgs, {
            allowedTools: selectedSkill?.allowedTools || ['generate_image', 'get_canvas_context'],
            canvasContext: body.canvasContext,
            toolCallId,
          }) as any;
          const assets = generatedAssetsFromResult(generationPayload);
          if (assets.length === 0) throw new Error('Image generation returned no usable assets');
          writeResolvedImageOptionUpdate(toolCallId, generationPayload);
          writeToolProgress('generate_image', 'completed', toolCallId);
          for (const event of enrichGeneratedAssetEvents(createAgentToolResultEvents({
            source: 'direct',
            runId,
            toolCallId,
            toolName: 'generate_image',
            rawResult: generationPayload,
          }), generationPayload)) writeStampedAgentEvent(event);
          writeImageCompletionSummary(generationPayload);
          updateTopicMemory({
            activeTask: { status: 'completed', summary: executionPlan.presentation?.completionSummary || 'Image delivery completed.' },
            recentReferencedAssetIds: executionPlan.contextReferences,
          });
          writeAgentDone('image_generated');
          return;
        }

        if (executionPlan) {
          if (executionPlan.execution.tool !== 'start_skill_job') {
            throw new Error(`Unsupported deterministic image execution tool: ${executionPlan.execution.tool}`);
          }
          const skillType = selectedSkill?.id;
          if (skillType !== 'logo' && skillType !== 'brand') {
            throw new Error('Skill job requires a supported locked Skill');
          }
          const confirmationId = randomUUID();
          const progressToolCallId = `${runId}-start-skill-job-confirmation`;
          const checkpoint = progressTracker.snapshot();
          const reservation = getTaskExecutionReservation({
            kind: executionPlan.execution.kind,
            tool: 'start_skill_job',
            outputCount: 1,
          });
          confirmationStore.set(confirmationId, {
            ...confirmationTaskIdentity(),
            version: 1,
            confirmationId,
            status: 'pending',
            operationId: checkpoint.operationId,
            skillSource,
            lastSequence: checkpoint.lastSequence,
            progressToolCallId,
            skillId: selectedSkill.id,
            toolName: 'start_skill_job',
            toolArgs: { skillType, payload: { brief: executionBrief } },
            allowedTools: ['start_skill_job'],
            userMessage: latestUserMessage,
            generationBrief: executionBrief,
            executionBrief: structuredClone(executionBriefData),
            referenceImages: [...executionReferenceImages],
            referenceContext: structuredClone(runReferenceContext),
            canvasContext: body.canvasContext ? structuredClone(body.canvasContext) : undefined,
            ...(reservation ? { taskId: reservation.taskId, contractVersion: reservation.contractVersion, taskContract: reservation.contract } : {}),
            expiresAt: Date.now() + CONFIRMATION_TTL_MS,
          });
          writeToolProgress('start_skill_job', 'waiting', progressToolCallId);
          writeInteractionEvent({
            type: 'confirmation_required',
            request: {
              confirmationId,
              toolName: 'start_skill_job',
              message: '确认后启动已验证的 Skill 任务。',
            },
          });
          writeAgentDone('awaiting_confirmation');
          return;
        }

        turns += 1;
        const chatMessages = buildMainAgentMessages({
          messages: body.messages,
          canvasContext: body.canvasContext,
          referenceImages: executionReferenceImages,
          referenceContext: runReferenceContext,
          resolvedBrief: executionPlan || shouldRunClarifier ? executionBrief : undefined,
          executionPlan: executionPlan || undefined,
        });
        const model = resolvedChatSelection.model!;
        const skillAllowedTools = selectedSkill?.allowedTools || [];
        const allowedTools = executionPlan
          ? skillAllowedTools.filter((toolName) => (
              toolName === executionPlan?.execution.tool
              || toolName === 'get_canvas_context'
            ))
          : skillAllowedTools;
        const toolRegistry = createAgentToolRegistry({
          createSkillJob,
          getSkillJob,
          generateImage: async (args: Record<string, unknown>, context: { toolCallId?: string }) => {
            const prompt = typeof args.prompt === 'string' && args.prompt.trim()
              ? args.prompt.trim()
              : executionBrief;
            return generateImagePayload(
              executionBrief,
              body.imageOptions,
              executionReferenceImages,
              prompt,
              { source: requestedImageCountSource, totalCount: requestedTotalImageCount },
              [],
              { toolCallId: context.toolCallId },
              imageDeliveryPlan,
            );
          },
        });
        const modelTools = getAgentModelTools(toolRegistry, allowedTools).map((tool) => {
          const registryTool = toolRegistry.get(tool.function.name);
          const requiresConfirmation = registryTool?.requiresConfirmation === true
            || (tool.function.name === 'generate_image' && requestedImageCount > 1);
          return {
            ...tool,
            readOnly: registryTool?.readOnly === true,
            requiresConfirmation,
            ...(requiresConfirmation ? {
              confirmationMessage: tool.function.name === 'generate_image'
                ? imageBatchPlan
                  ? `本次将生成首批 ${requestedImageCount} 张图片，总目标 ${requestedTotalImageCount} 张，确认后继续。`
                  : `本次将生成 ${describeImageDelivery(imageDeliveryPlan, requestedImageCount)}，确认后继续。`
                : `确认后执行 ${tool.function.name}`,
            } : {}),
          };
        });
        // Only Planner routes may expose mutation/read tools to the main loop.
        // Chat and visual analysis remain explicitly tool-free, even when a
        // Skill is selected for context injection.
        const routeAllowsTools = Boolean(executionPlan) || frontDoorResult?.route === 'planner';
        if (routeAllowsTools && modelTools.length > 0) {
          const rawToolResults = new Map<string, unknown>();
          const loopResult = await runZFlowAgentBrain({
            messages: chatMessages,
            providerId: resolvedChatSelection.providerId,
            model,
            modelMetadata: resolvedChatModelMetadata,
            tools: modelTools,
            maxTurns: MAX_AGENT_TURNS,
            maxToolCalls: MAX_TOOL_CALLS,
            signal: runSignal,
            chatStream,
            executeTool: async (toolName, args, context) => {
              if (toolName === 'generate_image' && requestedImageCount > 1) {
                return {
                  confirmationRequired: true,
                  toolName,
                  message: imageBatchPlan
                    ? `本次将生成首批 ${requestedImageCount} 张图片，总目标 ${requestedTotalImageCount} 张，确认后继续。`
                    : `本次将生成 ${describeImageDelivery(imageDeliveryPlan, requestedImageCount)}，确认后继续。`,
                };
              }
              if (toolRegistry.get(toolName)?.readOnly !== true) {
                getTaskExecutionReservation({
                  kind: toolName === 'generate_image'
                    ? 'image_pipeline'
                    : toolName === 'start_skill_job'
                      ? 'skill_job'
                      : 'agent_loop',
                  tool: toolName,
                  imageTask: executionPlan?.imageTask,
                  outputCount: toolName === 'generate_image' ? requestedTotalImageCount : 1,
                });
              }
              const rawResult = await executeAgentTool(toolRegistry, toolName, args, {
                allowedTools,
                confirmed: false,
                canvasContext: body.canvasContext,
                toolCallId: context.toolCallId,
              });
              rawToolResults.set(context.toolCallId, rawResult);
              const views = createAgentToolResultViews(toolName, rawResult);
              return { ...rawResult as Record<string, unknown>, ...views };
            },
            onEvent: emitMainAgentEvent,
            onAssistantTurnComplete: handleAssistantTurnComplete,
            requireMutationTool: executionPlan
              ? Boolean(executionPlan.execution.tool)
              : intent === 'image' || intent === 'skill_action',
            onToolPending: ({ id, name, args }) => {
              rememberToolPublicProgress(id, name, args);
              writeToolProgress(name, 'pending', id);
            },
            onToolStart: ({ id, name, args }) => {
              rememberToolPublicProgress(id, name, args);
              writeToolProgress(name, 'active', id);
              writeToolStartEvent(id, name);
            },
            onToolUpdate: writeToolUpdate,
            onToolResult: ({ id, name, result, rawResult: runtimeRawResult, isError }) => {
              const rawResult = rawToolResults.get(id) ?? runtimeRawResult;
              noteToolResult(name, isError);
              if (name === 'generate_image') {
                writeResolvedImageOptionUpdate(id, rawResult);
              }
              for (const event of enrichGeneratedAssetEvents(createAgentToolResultEvents({
                source: 'loop',
                runId,
                toolCallId: id,
                toolName: name,
                rawResult: rawResult ?? result,
              }), rawResult ?? result)) writeStampedAgentEvent(event);
              if (name === 'generate_image') {
                writeImageCompletionSummary(rawResult ?? result);
              }
              writeToolProgress(name, isError ? 'failed' : 'completed', id, summarizePublicToolResult(result));
            },
          });
          if (loopResult.stopReason === 'error' || loopResult.stopReason === 'aborted') {
            throw new Error(loopResult.errorMessage || (loopResult.stopReason === 'aborted' ? 'Agent run aborted' : 'Agent provider failed'));
          }
          if (loopResult.stopReason === 'budget_exceeded') {
            progressTracker.settleActive('failed', '工具调用预算已用尽');
            writeEvent(controller, {
              type: 'agent_error',
              stage: 'budget',
              message: '工具调用预算已用尽，请缩小任务范围后重试',
              recoveryRecord: buildRecoveryRecord({ stage: 'budget', message: '工具调用预算已用尽，请缩小任务范围后重试' }),
              ...progressTracker.stamp(),
            });
            return;
          }
          if (loopResult.stopReason === 'execution_required') {
            const taskId = rootTaskId();
            const request: AgentClarificationRequest = {
              id: randomUUID(),
              taskId,
              question: '生成尚未实际启动。是否按当前方向开始生成？',
              dimension: 'execution_confirmation',
              options: [
                {
                  id: 'confirm_execution',
                  label: '按当前方向生成',
                  answer: '确认按当前方向开始生成，并立即调用可用的生成工具。',
                  description: '保持当前 Brief，真实启动生成。',
                },
                {
                  id: 'revise_direction',
                  label: '先调整方向',
                  answer: '暂不生成，我要先调整主体、场景或其他关键方向。',
                  description: '可在下方补充需要修改的内容。',
                },
              ],
              allowCustom: true,
              allowProceed: true,
            };
            writeProgress({ stepId: 'clarification', phase: 'waiting_input', status: 'waiting', label: '等待确认真实启动生成' });
            const checkpoint = progressTracker.snapshot();
            writeInteractionEvent({
              type: 'clarification_required',
              message: request.question,
              request,
              state: {
                taskId,
                sourceUserMessageId: rootSourceUserMessageId(),
                operationId: checkpoint.operationId,
                skillSource,
                lastSequence: checkpoint.lastSequence,
                intent: intent === 'skill_action' ? 'skill_action' : 'image',
                ...(selectedSkill ? { skillId: selectedSkill.id, skillRead: mainAgentLoopState.skillRead } : {}),
                originalRequest: rootOriginalRequest(),
                workingBrief: executionBrief,
                askedDimensions: [],
                answers: [],
                referenceImages: executionReferenceImages,
                ...(runReferenceContext ? { referenceContext: structuredClone(runReferenceContext) } : {}),
              },
            });
            writeAgentDone('awaiting_user_intent');
            return;
          }
          if (loopResult.stopReason === 'confirmation_required') {
            const confirmationId = randomUUID();
            const progressToolCallId = String(loopResult.confirmation?.toolCallId || `${runId}-confirmation`);
            const confirmationToolName = String(loopResult.confirmation?.toolName || 'start_skill_job');
            const pendingArgs = (loopResult.confirmation?.arguments && typeof loopResult.confirmation.arguments === 'object')
              ? loopResult.confirmation.arguments as Record<string, unknown>
              : {};
            const pendingBatch = Array.isArray(loopResult.confirmation?.batch)
              ? loopResult.confirmation.batch.map((call: any) => ({
                  id: String(call?.id || ''),
                  name: String(call?.name || ''),
                  args: call?.args && typeof call.args === 'object' ? call.args as Record<string, unknown> : {},
                })).filter((call: { id: string; name: string }) => call.id && call.name)
              : [{
                  id: progressToolCallId,
                  name: String(loopResult.confirmation?.toolName || 'start_skill_job'),
                  args: pendingArgs,
                }];
            const selectedProvider = providers.find((provider) => provider.id === resolvedChatSelection.providerId);
            const resolvedImageSelection = confirmationToolName === 'generate_image'
              ? resolveProviderModelSelection({
                  providers,
                  purpose: 'image',
                  requestedProviderId: body.imageOptions?.providerId,
                  requestedModel: body.imageOptions?.model,
                })
              : null;
            if (confirmationToolName === 'generate_image' && (!resolvedImageSelection?.providerId || !resolvedImageSelection.model)) {
              throw new Error('No enabled image provider and model are configured');
            }
            const resolvedImageProvider = confirmationToolName === 'generate_image'
              ? providers.find((provider) => provider.id === resolvedImageSelection?.providerId)
              : null;
            const loopConfirmationTaskReservation = getTaskExecutionReservation({
              kind: confirmationToolName === 'generate_image'
                ? 'image_pipeline'
                : confirmationToolName === 'start_skill_job'
                  ? 'skill_job'
                  : 'agent_loop',
              tool: confirmationToolName,
              imageTask: executionPlan?.imageTask,
              outputCount: confirmationToolName === 'generate_image' ? requestedTotalImageCount : 1,
            });
            const confirmationPublicProgress = normalizePublicProgress(pendingArgs.publicProgress);
            copyToolPublicProgress(progressToolCallId, confirmationPublicProgress, confirmationToolName);
            writeToolProgress(
              String(loopResult.confirmation?.toolName || 'start_skill_job'),
              'waiting',
              progressToolCallId,
            );
            const confirmationCheckpoint = progressTracker.snapshot();
            confirmationStore.set(confirmationId, {
              ...confirmationTaskIdentity(),
              version: 1,
              confirmationId,
              runId,
              status: 'pending',
              operationId: confirmationCheckpoint.operationId,
              skillSource,
              lastSequence: confirmationCheckpoint.lastSequence,
              progressToolCallId,
              skillId: selectedSkill?.id || null,
              toolName: confirmationToolName,
              toolArgs: pendingArgs,
              publicProgress: confirmationPublicProgress,
              allowedTools: [...allowedTools],
              userMessage: latestUserMessage,
              generationBrief: executionBrief,
              executionBrief: structuredClone(executionBriefData),
              imageTask: executionPlan?.imageTask ? structuredClone(executionPlan.imageTask) : undefined,
              visualContext: executionPlan?.visualContext ? structuredClone(executionPlan.visualContext) : undefined,
              presentation: executionPlan?.presentation ? structuredClone(executionPlan.presentation) : undefined,
              referenceContext: runReferenceContext ? structuredClone(runReferenceContext) : undefined,
              referenceImages: [...executionReferenceImages],
              canvasContext: body.canvasContext ? structuredClone(body.canvasContext) : undefined,
              imageOptions: { ...structuredClone(body.imageOptions || {}), count: requestedImageCount },
              imageCountSource: requestedImageCountSource,
              promptCompilation: promptCompilation ? structuredClone(promptCompilation) : undefined,
              requestedTotalImageCount,
              imageBatchPlan: imageBatchPlan ? structuredClone(imageBatchPlan) : undefined,
              imageDeliveryPlan: structuredClone(imageDeliveryPlan),
              ...(confirmationToolName === 'generate_image' ? {
                pendingTaskIdentities: structuredClone(
                  loopConfirmationTaskReservation?.identities.slice(0, requestedImageCount) || [],
                ),
                remainingTaskIdentities: structuredClone(
                  loopConfirmationTaskReservation?.identities.slice(requestedImageCount) || [],
                ),
              } : {}),
              resolvedProviderId: resolvedChatSelection.providerId,
              resolvedModel: model,
              providerModelFingerprint: fingerprintProviderModel(selectedProvider as unknown as Record<string, unknown>, model),
              ...(confirmationToolName === 'generate_image' ? {
                resolvedImageProviderId: resolvedImageSelection?.providerId,
                resolvedImageModel: resolvedImageSelection?.model,
                imageProviderModelFingerprint: fingerprintProviderModel(
                  resolvedImageProvider as unknown as Record<string, unknown>,
                  resolvedImageSelection?.model || '',
                  'image',
                ),
              } : {}),
              systemPrompt: chatMessages
                .filter((message) => message.role === 'system' && typeof message.content === 'string')
                .map((message) => message.content)
                .join('\n\n'),
              piTranscript: structuredClone(loopResult.transcript),
              assistantToolCallIds: pendingBatch.map((call) => call.id),
              progressSequence: confirmationCheckpoint.lastSequence,
              pendingToolCall: {
                id: progressToolCallId,
                name: String(loopResult.confirmation?.toolName || 'start_skill_job'),
                args: structuredClone(pendingArgs),
                argsHash: hashEnvelopeValue(pendingArgs),
                batch: structuredClone(pendingBatch),
              },
              budgets: {
                turnsUsed: loopResult.turns,
                toolCallsUsed: loopResult.toolCalls,
                mutationToolCallsUsed: loopResult.mutationToolCalls,
                maxTurns: MAX_AGENT_TURNS,
                maxToolCalls: MAX_TOOL_CALLS,
              },
              expiresAt: Date.now() + CONFIRMATION_TTL_MS,
            });
            writeInteractionEvent({
              type: 'confirmation_required',
              request: {
                confirmationId,
                toolName: String(loopResult.confirmation?.toolName || 'start_skill_job'),
                message: String(loopResult.confirmation?.message || '此操作需要你的确认。'),
              },
            });
            writeAgentDone('awaiting_confirmation');
            return;
          }
          const loopProposal = parseAgentProposalBlock(loopResult.content);
          const safeLoopContent = sanitizeAgentResponseContent(
            loopProposal.cleanContent,
            loopResult.mutationToolCalls > 0,
          );
          if (loopProposal.proposal) {
            writeEvent(controller, { type: 'proposal_presented', proposal: loopProposal.proposal });
          }
          if (safeLoopContent && !finalAssistantTextEmitted) {
            writeEvent(controller, {
              type: 'assistant_delta',
              delta: safeLoopContent,
              channel: 'content',
              model,
            });
          }
          writeAgentDone(loopResult.stopReason);
          return;
        }
        let streamedContent = '';
        for await (const event of chatStream({
          providerId: resolvedChatSelection.providerId || undefined,
          model,
          messages: chatMessages,
          signal: runSignal,
          stream: true,
        })) {
          if (event.type === 'delta' && event.channel === 'content' && event.content) {
            streamedContent += event.content;
          }
        }
        const streamedProposal = parseAgentProposalBlock(streamedContent);
        const safeStreamedContent = sanitizeAgentResponseContent(streamedProposal.cleanContent, false);
        if (streamedProposal.proposal) {
          writeEvent(controller, { type: 'proposal_presented', proposal: streamedProposal.proposal });
        }
        if (safeStreamedContent) {
          writeEvent(controller, {
            type: 'assistant_delta',
            delta: safeStreamedContent,
            channel: 'content',
            model,
          });
        }
        writeAgentDone('completed');
      } catch (error) {
        if (clarificationSubmissionKey) {
          clarificationSubmissionStore.delete(clarificationSubmissionKey);
        }
        const aborted = request.signal.aborted;
        if (aborted && imagePlanning && !imagePlanning.abandonedAt) {
          abandonImagePlanning(imagePlanning);
          writeImagePlanningCheckpoint();
        }
        const failureStage = aborted
          ? 'cancelled'
          : imagePlanning?.failure?.stage
            || (agentAnalysis?.status === 'failed' ? 'analysis' : null)
            || (mainAgentFailureCheckpoint ? 'main_agent' : null)
            || executionKind || (
              intent === 'image'
              || body.intent === 'image'
              || selectedSkill?.executionMode === 'image_pipeline'
              || imageOperation
                ? 'image_pipeline'
                : 'chat'
            );
        const failureMessage = aborted
          ? '运行已取消'
          : imagePlanning?.failure?.message
            || (agentAnalysis?.status === 'failed' ? '需求分析未完成，任务状态已保留，可继续重试' : '')
            || (mainAgentFailureCheckpoint ? '图像规划未完成，任务状态已保留，可继续重试' : '')
            || (error instanceof Error ? error.message : 'Agent run failed');
        const recoveryRecord = preserveRecoveryRecordOnFailure && recoveryBaseRecord
          ? recoveryBaseRecord
          : buildRecoveryRecord({
              stage: failureStage,
              message: failureMessage,
              status: aborted ? 'cancelled' : 'failed',
              ...(imagePlanning ? { retryable: true } : {}),
              ...(mainAgentFailureCheckpoint ? { resumeRoute: 'main_agent' } : {}),
            });
        progressTracker.settleActive(
          'failed',
          aborted ? '运行已取消' : '运行失败',
        );
        writeEvent(controller, {
          type: 'agent_error',
          stage: failureStage,
          providerId: resolvedChatSelection.providerId,
          model: resolvedChatSelection.model,
          message: failureMessage,
          ...(isRetryablePlannerProviderError(error) ? { reason: 'transport', retryable: true } : {}),
          recoveryRecord,
          ...progressTracker.stamp(),
        });
      } finally {
        settleActiveAgentRun(runId);
        controller.close();
      }
    },
  });

  return new NextResponse(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}
