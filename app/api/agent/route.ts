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
  buildAgentTaskContract,
  executionPlanToBrief,
  executionPlanToImageDeliveryPlan,
  planAgentExecutionRequest,
} from '../../lib/agent/execution-planner.mjs';
import {
  applyClarificationResponse,
  isPotentialDesignExecutionRequest,
  resolveBriefClarification,
  shouldAskClarification,
} from '../../lib/agent/brief-clarifier.mjs';
import {
  createAgentProgressTracker,
  createAgentToolResultEvents,
  createAgentToolResultViews,
} from '../../lib/agent/agent-loop.mjs';
import { runZFlowAgentBrain } from '../../lib/agent/pi-agent-runtime.mjs';
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
  AgentProgressPhase,
  AgentProgressStatus,
  AgentProgressStepId,
  AgentConversationMemory,
  AgentPromptTrace,
  AgentRecoveryRecord,
} from '../../lib/agent/events';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_AGENT_TURNS = 8;
const MAX_TOOL_CALLS = 6;
const MAX_MAIN_AGENT_TURNS = 12;
const MAX_MAIN_AGENT_TOOL_CALLS = 12;
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

function createImageOperationClarificationRequest(taskId: string): AgentClarificationRequest {
  return {
    id: randomUUID(),
    taskId,
    question: '这张参考图是用于生成一张新图，还是直接编辑原图？',
    dimension: 'image_operation',
    options: [
      {
        id: 'generate',
        label: '生成新图',
        answer: '使用参考图作为内容与构图来源，生成一张新图片。',
        description: '保留参考关系，但不把原图当作直接编辑目标。',
      },
      {
        id: 'edit',
        label: '编辑原图',
        answer: '直接编辑我提供的原图。',
        description: '把参考图作为必须保留和修改的编辑目标。',
      },
    ],
    allowCustom: true,
    allowProceed: true,
  };
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
  const question = `${currentLabel || '当前分析模型'} 不支持图片输入。请选择另一个模型重新分析。`;
  const request: AgentClarificationRequest = {
    id: randomUUID(),
    taskId,
    question,
    dimension: 'planner_model_switch',
    options: plannerCandidates.map((candidate) => ({
      id: candidate.id,
      label: `${candidate.providerName} / ${candidate.model}`,
      answer: `使用 ${candidate.providerName} 的 ${candidate.model} 重新分析当前图片。`,
      description: '确认后才会把当前图片发送给该供应商。',
    })),
    allowCustom: true,
    allowProceed: true,
  };
  return { request, plannerCandidates };
}

type AgentImagePromptCompilation = {
  skillId: string | null;
  skillLabel: string | null;
  plannerProviderId: string | null;
  plannerModel: string;
  referenceCount: number;
  visualReferencesUsed: boolean;
  durationMs: number;
  compiledAt: number;
};

type ConfirmationRecord = {
  version?: 1;
  confirmationId?: string;
  runId?: string;
  status: 'pending' | 'executing' | 'completed';
  operationId: string;
  skillSource: 'manual' | 'auto' | null;
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
  contract: AgentTaskContract;
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
  topicId?: string;
  messages?: Array<{ id?: string; role: 'user' | 'assistant'; content: string }>;
  sourceUserMessageId?: string;
  recoveryTaskId?: string;
  activeSkillId?: string;
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
    return sourceExists ? normalized : null;
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
    resumeRoute: legacy.intent === 'image' || legacy.intent === 'skill_action' ? 'image_planner' : 'main_agent',
    intent: ['chat', 'image', 'skill_action'].includes(String(legacy.intent || '')) ? legacy.intent : null,
    originalRequest,
    failureStage: typeof legacy.failureStage === 'string' ? legacy.failureStage : 'unknown',
    failureMessage: typeof legacy.failureMessage === 'string' ? legacy.failureMessage : '任务未完成',
    skillId: typeof legacy.skillId === 'string' ? legacy.skillId : null,
    contextEntityIds: legacy.contextEntityIds,
    visualReferenceIds: legacy.contextEntityIds,
  });
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
      || isPotentialDesignExecutionRequest(initialBriefSource)
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
  const resolvedChatSelection = resolveProviderModelSelection({
    providers,
    purpose: 'chat',
    requestedProviderId: body.chatOptions?.providerId || process.env.AGENT_CHAT_PROVIDER_ID,
    requestedModel: requestedChatModel,
  });
  if (!resolvedChatSelection.model || !resolvedChatSelection.providerId) {
    return NextResponse.json({ error: 'No enabled chat provider and model are configured' }, { status: 400 });
  }
  const configuredPlannerProviderId = process.env.AGENT_PLANNER_PROVIDER_ID?.trim() || '';
  const configuredPlannerModel = process.env.AGENT_PLANNER_MODEL?.trim() || '';
  if (Boolean(configuredPlannerProviderId) !== Boolean(configuredPlannerModel)) {
    return NextResponse.json({ error: 'AGENT_PLANNER_PROVIDER_ID and AGENT_PLANNER_MODEL must be configured together' }, { status: 500 });
  }
  const explicitPlannerSelection = configuredPlannerProviderId && configuredPlannerModel
    ? resolveProviderModelSelection({
        providers,
        purpose: 'chat',
        requestedProviderId: configuredPlannerProviderId,
        requestedModel: configuredPlannerModel,
      })
    : null;
  if (
    explicitPlannerSelection
    && (
      explicitPlannerSelection.reason !== 'exact'
      || explicitPlannerSelection.providerId !== configuredPlannerProviderId
      || explicitPlannerSelection.model !== configuredPlannerModel
    )
  ) {
    return NextResponse.json({ error: 'Configured Agent Planner provider and model are not an enabled registry pair' }, { status: 500 });
  }
  const plannerTimeoutMs = Math.min(1_800_000, Math.max(10_000, Number(process.env.AGENT_PLANNER_TIMEOUT_MS) || 1_800_000));

  // Main Agent lifetime is bounded by provider completion, protocol budgets, or user cancellation.
  const runSignal = request.signal;
  const stream = new ReadableStream({
    async start(controller) {
      let toolCalls = 0;
      let turns = 0;
      let skillSource: 'manual' | 'auto' | null = body.activeSkillId ? 'manual' : null;
      let intent: 'chat' | 'image' | 'skill_action' = 'chat';
      let selectedSkill = body.activeSkillId
        ? skillManifests.find((manifest) => manifest.id === body.activeSkillId) || null
        : null;
      let skillSelectionMethod: SkillSelectionMethod = body.activeSkillId ? 'manual_ui' : 'none';
      let skillCandidateIds: string[] = [];
      let skillContent = '';
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
      let recoveryBaseRecord = recentFailedTask as AgentRecoveryRecord | null;
      let plannerVisualSummary = activeClarificationState?.visualSummary || recoveryBaseRecord?.visualSummary || null;
      let preserveRecoveryRecordOnFailure = Boolean(recoveryBaseRecord);
      let recoveryTaskIdForExecution: string | null = null;
      let recoveryMode: 'fill_missing' | 'redo_all' | null = null;
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
        };
        writeEvent(controller, { type: 'agent_task_checkpoint', taskSnapshot: structuredClone(taskSnapshot) });
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
        };
        writeEvent(controller, { type: 'agent_task_checkpoint', taskSnapshot: structuredClone(taskSnapshot) });
      };
      const writeAgentDone = (stopReason: string) => writeEvent(controller, {
        type: 'agent_done',
        stopReason,
        ...(taskSnapshot ? { taskSnapshot: structuredClone(taskSnapshot) } : {}),
      });
      const sourceUserMessageId = typeof body.sourceUserMessageId === 'string' && body.sourceUserMessageId.trim()
        ? body.sourceUserMessageId.trim().slice(0, 200)
        : [...body.messages].reverse().find((message) => message.role === 'user')?.id || `user-${runId}`;
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
        taskId: taskSnapshot?.taskId || recoveryBaseRecord?.taskId || runId,
        runId,
        topicId,
        sourceUserMessageId: recoveryBaseRecord?.sourceUserMessageId || sourceUserMessageId,
        status,
        resumeRoute: resumeRoute === undefined
          ? stage === 'local_delivery'
            ? 'local_delivery'
            : intent === 'image' || intent === 'skill_action' || frontDoorResult?.route === 'planner'
              ? 'image_planner'
              : recoveryBaseRecord?.resumeRoute || 'main_agent'
          : resumeRoute,
        intent: intent || recoveryBaseRecord?.intent,
        originalRequest: recoveryBaseRecord?.originalRequest || activeClarificationState?.originalRequest || latestUserMessage,
        failureStage: stage,
        failureReason: reason,
        failureMessage: message,
        retryability: retryable === true ? 'retryable' : retryable === false ? 'requires_change' : undefined,
        skillId: selectedSkill?.id || recoveryBaseRecord?.skillId || null,
        contextEntityIds: selectedContextEntityIds.length > 0
          ? selectedContextEntityIds
          : recoveryBaseRecord?.contextEntityIds || [],
        visualReferenceIds: runReferenceContext?.references.length
          ? runReferenceContext.references.map((reference) => reference.id)
          : recoveryBaseRecord?.visualReferenceIds || [],
        visualSummary: plannerVisualSummary || recoveryBaseRecord?.visualSummary,
        taskSnapshot: recoverySnapshot,
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
        emit: (event) => writeEvent(controller, event as AgentEvent),
      });
      const writeProgress = (input: {
        stepId: AgentProgressStepId;
        phase: AgentProgressPhase;
        status: AgentProgressStatus;
        label: string;
        toolCallId?: string;
        toolName?: string;
      }) => progressTracker.update(input);
      const ensureSelectedSkillContent = async () => {
        if (!selectedSkill || selectedSkill.executionMode === 'image_pipeline' || skillContent) return skillContent;
        writeProgress({ stepId: 'skill_loading', phase: 'loading', status: 'active', label: `正在加载 ${selectedSkill.name}` });
        skillContent = await loadSkillContent(selectedSkill.id);
        writeProgress({ stepId: 'skill_loading', phase: 'loading', status: 'completed', label: `${selectedSkill.name} 已加载` });
        return skillContent;
      };
      const writeToolProgress = (
        toolName: string,
        status: 'active' | 'waiting' | 'completed' | 'failed',
        toolCallId: string,
      ) => {
        const definitions: Record<string, {
          stepId: AgentProgressStepId;
          phase: AgentProgressPhase;
          labels: Record<AgentProgressStatus, string>;
        }> = {
          generate_image: {
            stepId: 'generate_image',
            phase: 'generating',
            labels: { active: '正在生成图片', waiting: '等待确认生成图片', completed: '图片生成完成', failed: '图片生成失败' },
          },
          get_canvas_context: {
            stepId: 'canvas_context',
            phase: 'reading',
            labels: { active: '正在读取画布摘要', waiting: '等待读取画布', completed: '画布摘要读取完成', failed: '画布摘要读取失败' },
          },
          get_conversation_memory: {
            stepId: 'tool',
            phase: 'reading',
            labels: { active: '正在读取对话记忆', waiting: '等待读取对话记忆', completed: '对话记忆读取完成', failed: '对话记忆读取失败' },
          },
          list_project_context: {
            stepId: 'tool',
            phase: 'reading',
            labels: { active: '正在查看项目上下文', waiting: '等待项目上下文', completed: '项目上下文已读取', failed: '项目上下文读取失败' },
          },
          read_context_entity: {
            stepId: 'tool',
            phase: 'reading',
            labels: { active: '正在读取上下文实体', waiting: '等待上下文实体', completed: '上下文实体已读取', failed: '上下文实体读取失败' },
          },
          load_visual_reference: {
            stepId: 'tool',
            phase: 'reading',
            labels: { active: '正在加载视觉参考', waiting: '等待视觉参考', completed: '视觉参考已加载', failed: '视觉参考加载失败' },
          },
          update_conversation_memory: {
            stepId: 'tool',
            phase: 'executing',
            labels: { active: '正在暂存对话记忆', waiting: '等待暂存对话记忆', completed: '对话记忆更新待提交', failed: '对话记忆更新失败' },
          },
          resolve_failed_task_recovery: {
            stepId: 'routing',
            phase: 'resuming',
            labels: { active: '正在定位上次任务', waiting: '等待恢复任务', completed: '已定位上次任务', failed: '无法恢复上次任务' },
          },
          handoff_to_image_planner: {
            stepId: 'tool',
            phase: 'planning',
            labels: { active: '正在交给 Image Planner', waiting: '等待 Image Planner', completed: '已交给 Image Planner', failed: 'Image Planner 交接失败' },
          },
          request_context_selection: {
            stepId: 'tool',
            phase: 'waiting_input',
            labels: { active: '正在准备引用候选', waiting: '等待选择引用', completed: '引用候选已确认', failed: '引用候选准备失败' },
          },
          start_skill_job: {
            stepId: 'skill_job',
            phase: 'starting',
            labels: { active: '正在启动 Skill 任务', waiting: '等待确认 Skill 任务', completed: 'Skill 任务已启动', failed: 'Skill 任务启动失败' },
          },
          get_skill_job: {
            stepId: 'skill_job',
            phase: 'checking',
            labels: { active: '正在查询 Skill 任务', waiting: '等待查询 Skill 任务', completed: 'Skill 任务状态已更新', failed: 'Skill 任务查询失败' },
          },
        };
        const definition = definitions[toolName] || {
          stepId: 'tool',
          phase: 'executing',
          labels: { active: '正在执行工具', waiting: '等待确认工具', completed: '工具执行完成', failed: '工具执行失败' },
        };
        writeProgress({
          stepId: definition.stepId,
          phase: definition.phase,
          status,
          label: definition.labels[status],
          toolCallId,
          toolName,
        });
        if (status === 'active' && contextResolution.status === 'resolved') {
          void contextLogger.info('context.execution', 'Resolved context entered tool execution', {
            toolName,
            entityIds: contextResolution.entityIds,
          });
        }
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
            ...(promptCompilation ? { compilation: promptCompilation } : {}),
          });
        });
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
        });
        let streamedSettled = 0;
        let streamedSucceeded = 0;
        let streamedFailed = 0;
        let streamedPresentationSent = false;
        const taskResults = await settleCanvasImageGenerationRequests({
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
          writeEvent(controller, { type: 'tool_update', toolCallId, message });
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
        writeEvent(controller, { type: 'agent_start', runId });
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
          writeEvent(controller, { type: 'routing_start' });
          writeEvent(controller, { type: 'intent_resolved', intent });
          if (selectedSkill) {
            writeEvent(controller, {
              type: 'skill_selected',
              skillId: selectedSkill.id,
              label: selectedSkill.name,
              source: skillSource || 'auto',
            });
          }
          const toolCallId = confirmationRecord.progressToolCallId
            || `${runId}-${confirmationRecord.toolName}-confirmed`;
          writeToolProgress(confirmationRecord.toolName, 'active', toolCallId);
          writeEvent(controller, { type: 'tool_start', toolCallId, toolName: confirmationRecord.toolName });
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
          for (const event of enrichGeneratedAssetEvents(createAgentToolResultEvents({
            source: 'confirmed',
            runId,
            toolCallId,
            toolName: confirmationRecord.toolName,
            rawResult: result,
            includeAssets: !(result as any)?.streamedAssets,
          }), result)) writeEvent(controller, event as AgentEvent);
          if (confirmationRecord.toolName === 'generate_image') {
            writeImageCompletionSummary(result);
          }
          writeToolProgress(confirmationRecord.toolName, 'completed', toolCallId);
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
              writeEvent(controller, {
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
              writeEvent(controller, {
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
              generateImage: async (args: Record<string, unknown>) => {
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
                  undefined,
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
                });
                continuationRawResults.set(String(context.toolCallId || ''), rawResult);
                return { ...rawResult as Record<string, unknown>, ...createAgentToolResultViews(toolName, rawResult) };
              },
              onToolStart: ({ id, name }: any) => {
                writeToolProgress(name, 'active', id);
                writeEvent(controller, { type: 'tool_start', toolCallId: id, toolName: name });
              },
              onToolResult: ({ id, name, result: publicResult, rawResult: runtimeRawResult, isError }: any) => {
                const rawResult = continuationRawResults.get(id) ?? runtimeRawResult ?? publicResult;
                for (const event of enrichGeneratedAssetEvents(createAgentToolResultEvents({
                  source: 'loop',
                  runId,
                  toolCallId: id,
                  toolName: name,
                  rawResult,
                }), rawResult)) writeEvent(controller, event as AgentEvent);
                writeToolProgress(name, isError ? 'failed' : 'completed', id);
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
              writeToolProgress(nextToolName, 'waiting', nextToolCallId);
              writeEvent(controller, {
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
            if (safeContinuedContent) {
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
          skillSource = 'manual';
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
            skillSource = 'manual';
            activeSkillChange = { id: selectedSkill.id, label: selectedSkill.name };
            if (activeClarificationState) {
              activeClarificationState.skillId = selectedSkill.id;
              activeClarificationState.skillSource = 'manual';
            }
          }
          skillSelectionMethod = 'user_choice';
        } else {
          const activeUiSkill = body.activeSkillId
            ? skillManifests.find((manifest) => manifest.id === body.activeSkillId) || null
            : null;
          if (activeUiSkill) {
            selectedSkill = activeUiSkill;
            skillSource = 'manual';
            skillSelectionMethod = 'manual_ui';
            skillCandidateIds = [selectedSkill.id];
          } else if (activeClarificationState) {
            selectedSkill = activeClarificationState.skillId
              ? skillManifests.find((manifest) => manifest.id === activeClarificationState?.skillId) || null
              : null;
            if (activeClarificationState.skillId && !selectedSkill) {
              throw new Error('The selected skill is no longer available; please restart the request');
            }
            skillSource = selectedSkill ? activeClarificationState.skillSource || 'manual' : null;
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
          fullSkillInjected: Boolean(selectedSkill && skillContent),
          skillContentLength: skillContent.length,
        });
        writeEvent(controller, { type: 'routing_start' });
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
        let plannerHistoryMessages = body.messages;
        let forcedPlannerTerminal: Record<string, unknown> | null = null;

        const validateRecoveryResolution = (record: AgentRecoveryRecord, args: Record<string, unknown>) => {
          const decision = String(args.decision || '');
          const confidence = String(args.confidence || '');
          if (!['resume', 'continue_current_request', 'cannot_resume'].includes(decision)) {
            throw new Error('Recovery gate returned an invalid decision');
          }
          if (!['high', 'medium', 'low'].includes(confidence)) throw new Error('Recovery gate returned invalid confidence');
          const route = decision === 'resume' ? record.resumeRoute : null;
          if (decision === 'resume' && !route) throw new Error('Saved task has no valid recovery route');
          let skillId: string | null = null;
          if (decision === 'resume' && skillSource === 'manual') {
            skillId = selectedSkill?.id || null;
          } else if (decision === 'resume' && record.skillId) {
            skillId = record.skillId;
          }
          if (skillId && !allowedSkillIds.has(skillId)) throw new Error(`Recovery Skill is no longer enabled: ${skillId}`);
          return {
            terminate: true,
            type: 'recovery_resolution',
            taskId: record.taskId,
            decision,
            route,
            skillId,
            confidence,
            modelResult: { accepted: true },
            publicResult: { accepted: true },
          };
        };

        const runRecoveryGate = async (record: AgentRecoveryRecord) => {
          for (let attempt = 0; attempt < 2; attempt += 1) {
            const recoveryRegistry = createAgentToolRegistry({
              resolveFailedTaskRecovery: async (args: Record<string, unknown>) => validateRecoveryResolution(record, args),
            });
            const recoveryTools = getAgentModelTools(recoveryRegistry, ['resolve_failed_task_recovery']);
            const result = await runZFlowAgentBrain({
              messages: (buildFailedTaskRecoveryMessages as any)({
                userMessage: latestUserMessage,
                recoveryRecord: record,
                manifests: skillManifests,
                manualSkillId: skillSource === 'manual' ? selectedSkill?.id || null : null,
                repair: attempt === 1,
              }),
              providerId: resolvedChatSelection.providerId!,
              model: resolvedChatSelection.model!,
              modelMetadata: providers.find((provider) => provider.id === resolvedChatSelection.providerId),
              tools: recoveryTools,
              toolChoice: { type: 'function', function: { name: 'resolve_failed_task_recovery' } },
              maxTurns: 1,
              maxToolCalls: 0,
              signal: runSignal,
              chatStream,
              executeTool: (toolName, args, context) => executeAgentTool(recoveryRegistry, toolName, args, {
                allowedTools: ['resolve_failed_task_recovery'],
                confirmed: false,
                toolCallId: context.toolCallId,
              }),
            });
            if (result.terminal?.type === 'recovery_resolution') return result.terminal as Record<string, unknown>;
          }
          throw new Error('任务恢复判断未返回有效协议，已停止执行');
        };

        const recoveryRecord = recentFailedTask as AgentRecoveryRecord | null;
        let recoveryResolution: Record<string, unknown> | null = null;
        if (recoveryRecord && body.clarificationRequest?.dimension === 'recovery_scope' && body.clarificationResponse) {
          const selectedMode = body.clarificationResponse.selectedOptionId;
          if (!['fill_missing', 'redo_all'].includes(selectedMode || '')) throw new Error('Recovery scope selection is invalid');
          recoveryMode = selectedMode as 'fill_missing' | 'redo_all';
          if (activeClarificationState) activeClarificationState.recoveryMode = recoveryMode;
          recoveryResolution = {
            decision: 'resume',
            route: recoveryRecord.resumeRoute,
            skillId: skillSource === 'manual' ? selectedSkill?.id || null : recoveryRecord.skillId,
            confidence: 'high',
          };
        } else if (recoveryRecord && requestedRecoveryTaskId) {
          recoveryResolution = recoveryRecord.failure.retryability === 'requires_change'
            || (Boolean(recoveryRecord.skillId) && skillSource !== 'manual' && !allowedSkillIds.has(recoveryRecord.skillId!))
            ? { decision: 'cannot_resume', route: null, skillId: null, confidence: 'high' }
            : recoveryRecord.resumeRoute ? {
                decision: 'resume',
                route: recoveryRecord.resumeRoute,
                skillId: skillSource === 'manual' ? selectedSkill?.id || null : recoveryRecord.skillId,
                confidence: 'high',
              } : await runRecoveryGate(recoveryRecord);
        } else if (recoveryRecord && !body.confirmation && !body.clarificationResponse) {
          recoveryResolution = await runRecoveryGate(recoveryRecord);
        }

        if (recoveryRecord && recoveryResolution?.decision === 'cannot_resume') {
          const blocker = recoveryRecord.failure.message;
          writeEvent(controller, {
            type: 'assistant_delta',
            delta: `${blocker}\n\n请先修正失败原因后再重试。`,
            channel: 'content',
            model: resolvedChatSelection.model,
          });
          writeAgentDone('recovery_requires_change');
          return;
        }
        if (recoveryRecord && recoveryResolution?.decision === 'continue_current_request') {
          recoveryBaseRecord = null;
          preserveRecoveryRecordOnFailure = false;
        }
        if (recoveryRecord && recoveryResolution?.decision === 'resume') {
          preserveRecoveryRecordOnFailure = false;
          recoveryTaskIdForExecution = recoveryRecord.taskId;
          writeProgress({
            stepId: 'routing',
            phase: 'resuming',
            status: 'completed',
            label: recoveryResolution.route === 'main_agent' ? '已定位上次任务，正在继续分析' : '已定位上次任务，正在重新规划',
          });
          if (recoveryRecord.completedAssetCount > 0 && recoveryResolution.route === 'image_planner' && !recoveryMode) {
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
            writeEvent(controller, {
              type: 'clarification_required',
              message: request.question,
              request,
              state: {
                taskId: recoveryRecord.taskId,
                operationId: checkpoint.operationId,
                skillSource,
                lastSequence: checkpoint.lastSequence,
                intent: recoveryRecord.intent === 'skill_action' ? 'skill_action' : 'image',
                ...(recoveryRecord.skillId ? { skillId: recoveryRecord.skillId } : {}),
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
          if (recoveryResolution.route === 'main_agent') {
            mainAgentInputMessages = plannerHistoryMessages;
            mainAgentReferenceImages = [];
            mainAgentReferenceContext = undefined;
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
            const contextEntityIds = validateContextIds(recoveryRecord.contextEntityIds, 'context');
            const visualReferenceIds = validateContextIds(recoveryRecord.visualReferenceIds, 'visual');
            forcedPlannerTerminal = {
              type: 'planner_handoff',
              route: 'planner',
              skillId: recoveryResolution.skillId || null,
              confidence: recoveryResolution.confidence || 'high',
              contextEntityIds,
              visualReferenceIds,
              visualSummary: recoveryRecord.visualSummary || null,
              recoveryTaskId: recoveryRecord.taskId,
            };
          }
        }
        const mainAgentRegistry = createAgentToolRegistry({
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
          handoffToImagePlanner: async (args: Record<string, unknown>) => {
            const requestedResumeTaskId = typeof args.resumeTaskId === 'string' && args.resumeTaskId.trim()
              ? args.resumeTaskId.trim()
              : null;
            if (requestedResumeTaskId && requestedResumeTaskId !== recentFailedTask?.taskId) {
              throw new Error('Unknown failed task selected for Image Planner retry');
            }
            const resumedTask = requestedResumeTaskId ? recentFailedTask : null;
            let skillId = typeof args.skillId === 'string' && args.skillId.trim() ? args.skillId.trim() : null;
            if (skillSource === 'manual') skillId = selectedSkill?.id || null;
            if (skillSource !== 'manual' && resumedTask?.skillId && !allowedSkillIds.has(resumedTask.skillId)) {
              throw new Error(`Failed task Skill is no longer enabled: ${resumedTask.skillId}`);
            }
            if (skillSource !== 'manual' && resumedTask?.skillId && skillId && skillId !== resumedTask.skillId) {
              throw new Error('Image Planner retry cannot replace the failed task Skill');
            }
            if (skillSource !== 'manual' && resumedTask?.skillId) {
              skillId = resumedTask.skillId;
            }
            if (skillId && !allowedSkillIds.has(skillId)) throw new Error(`Unknown skill: ${skillId}`);
            if (args.confidence === 'low' && skillId && skillSource !== 'manual') {
              throw new Error('Low-confidence Main Agent handoff cannot select a Skill');
            }
            const restoredReferenceIds = resumedTask?.contextEntityIds || [];
            const restoredVisualReferenceIds = resumedTask?.visualReferenceIds || [];
            const contextEntityIds = validateContextIds([
              ...(Array.isArray(args.contextEntityIds) ? args.contextEntityIds : []),
              ...restoredReferenceIds,
            ], 'context');
            const visualReferenceIds = validateContextIds([
              ...(Array.isArray(args.visualReferenceIds) ? args.visualReferenceIds : []),
              ...restoredVisualReferenceIds,
            ], 'visual');
            if (visualReferenceIds.length > 4) throw new Error('Image Planner handoff supports at most 4 visual references');
            const visualSummary = normalizeAgentVisualSummary(
              resumedTask?.visualSummary || args.visualSummary,
              visualReferenceIds,
            );
            if (visualReferenceIds.length > 0 && !visualSummary) {
              throw new Error('Image Planner handoff requires one valid visual summary entry for every visual reference');
            }
            if (visualReferenceIds.length === 0 && args.visualSummary !== null) {
              throw new Error('Image Planner handoff cannot include a visual summary without visual references');
            }
            return {
              terminate: true,
              type: 'planner_handoff',
              route: 'planner',
              skillId,
              confidence: args.confidence,
              contextEntityIds,
              visualReferenceIds,
              visualSummary,
              resumeTaskId: requestedResumeTaskId,
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
              if (!entity) throw new Error(`Unknown context candidate: ${id}`);
              return { id, label: entity.label, kind: entity.kind };
            });
            return {
              confirmationRequired: true,
              message: String(args.question || '').trim(),
              candidates: normalizedCandidates,
            };
          },
        });
        const mainAgentToolNames = [
          'get_conversation_memory',
          'list_project_context',
          'read_context_entity',
          'load_visual_reference',
          'update_conversation_memory',
          'handoff_to_image_planner',
          'request_context_selection',
        ];
        const mainAgentTools = getAgentModelTools(mainAgentRegistry, mainAgentToolNames);
        const loopMessages = buildMainAgentLoopMessages({
          messages: mainAgentInputMessages,
          referenceImages: mainAgentReferenceImages,
          referenceContext: mainAgentReferenceContext,
          manifests: skillManifests,
          manualSkillId: skillSource === 'manual' ? selectedSkill?.id || null : null,
          pendingTask: activeClarificationState ? {
            taskId: activeClarificationState.taskId,
            intent: activeClarificationState.intent,
            skillId: activeClarificationState.skillId || null,
          } : null,
          memory: normalizeAgentConversationMemory(body.agentMemory) || null,
          contextEntities,
          canvasContext: body.canvasContext,
        });
        const selectedContextResponse = body.clarificationRequest?.dimension === 'context_reference'
          && typeof body.clarificationResponse?.selectedOptionId === 'string'
          ? body.clarificationResponse.selectedOptionId
          : '';
        const savedMainAgentLoop = activeClarificationState?.mainAgentLoop;
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
        }
        let activitySequence = 0;
        let currentActivity: { activityId: string; text: string } | null = null;
        const appendActivityText = (activityId: string, delta: string, maxLength = 1200) => {
          const remaining = maxLength - (currentActivity?.text.length || 0);
          if (remaining <= 0 || !delta) return;
          const boundedDelta = delta.slice(0, remaining);
          if (!boundedDelta) return;
          currentActivity = {
            activityId,
            text: `${currentActivity?.text || ''}${boundedDelta}`,
          };
          writeEvent(controller, {
            type: 'agent_activity_delta',
            activityId,
            delta: boundedDelta,
            model: resolvedChatSelection.model,
          });
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
          const activityId = currentActivity?.activityId || `${runId}-activity-${++activitySequence}`;
          const hasToolCall = Array.isArray(event.message.content)
            && event.message.content.some((part: any) => part?.type === 'toolCall');
          const failed = event.message.stopReason === 'error' || event.message.stopReason === 'aborted';
          const fullText = Array.isArray(event.message.content)
            ? event.message.content.filter((part: any) => part?.type === 'text').map((part: any) => part.text || '').join('')
            : '';
          if (fullText && (currentActivity?.text || '').length < fullText.length) {
            appendActivityText(
              activityId,
              fullText.slice(currentActivity?.text.length || 0),
              failed || hasToolCall ? 1200 : Number.POSITIVE_INFINITY,
            );
          }
          if (currentActivity?.text) {
            writeEvent(controller, {
              type: 'agent_activity_commit',
              activityId,
              disposition: failed || hasToolCall ? 'commentary' : 'final',
            });
          }
          currentActivity = null;
        };
        const loopResult: any = forcedPlannerTerminal ? {
          content: '',
          messages: [],
          transcript: [],
          turns: 0,
          toolCalls: 0,
          budgetedToolCalls: 0,
          mutationToolCalls: 0,
          stopReason: 'completed',
          terminal: forcedPlannerTerminal,
          rawResults: new Map(),
        } : await runZFlowAgentBrain({
          messages: loopMessages,
          providerId: resolvedChatSelection.providerId!,
          model: resolvedChatSelection.model!,
          modelMetadata: providers.find((provider) => provider.id === resolvedChatSelection.providerId),
          tools: mainAgentTools,
          maxTurns: MAX_MAIN_AGENT_TURNS,
          maxToolCalls: MAX_MAIN_AGENT_TOOL_CALLS,
          reserveClosingTurn: true,
          signal: runSignal,
          chatStream,
          executeTool: async (toolName, args, context) => {
            void contextLogger.info('main_agent.tool_call', 'Main Agent called an internal tool', { toolName });
            return executeAgentTool(mainAgentRegistry, toolName, args, {
              allowedTools: mainAgentToolNames,
              confirmed: false,
              canvasContext: body.canvasContext,
              toolCallId: context.toolCallId,
            });
          },
          ...(savedMainAgentLoop && selectedContextResponse ? {
            continuation: {
              transcript: savedMainAgentLoop.transcript,
              pendingCall: savedMainAgentLoop.pendingCall,
              toolResult: {
                modelResult: { selectedContextEntityId: selectedContextResponse },
                publicResult: { selectedContextEntityId: selectedContextResponse },
              },
              budgets: savedMainAgentLoop.budgets,
            },
          } : {}),
          onToolStart: ({ id, name }) => {
            writeToolProgress(name, 'active', id);
            writeEvent(controller, { type: 'tool_start', toolCallId: id, toolName: name });
          },
          onToolResult: ({ id, name, isError }) => writeToolProgress(name, isError ? 'failed' : 'completed', id),
          onEvent: emitMainAgentEvent,
        });
        if (loopResult.stopReason === 'budget_exceeded' || loopResult.stopReason === 'error' || loopResult.stopReason === 'aborted') {
          void contextLogger.warn('main_agent.loop_failed', 'Main Agent Loop failed closed', {
            durationMs: Date.now() - mainAgentStartedAt,
            stopReason: loopResult.stopReason,
            error: loopResult.errorMessage || null,
            mutationBlocked: true,
          });
          throw new Error(loopResult.stopReason === 'budget_exceeded'
            ? 'Main Agent 上下文读取预算已用尽，请缩小范围后重试'
            : loopResult.errorMessage || 'Main Agent Loop failed');
        }
        if (loopResult.stopReason === 'confirmation_required' && loopResult.confirmation?.toolName === 'request_context_selection') {
          const candidates = Array.isArray(loopResult.confirmation.candidates) ? loopResult.confirmation.candidates : [];
          const taskId = randomUUID();
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
          writeEvent(controller, {
            type: 'clarification_required',
            message: request.question,
            request,
            state: {
              taskId,
              operationId: checkpoint.operationId,
              skillSource,
              lastSequence: checkpoint.lastSequence,
              intent: 'chat',
              originalRequest: latestUserMessage,
              workingBrief: latestUserMessage,
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
              },
            },
          });
          void contextLogger.info('main_agent.loop_paused', 'Main Agent Loop paused for context selection', {
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
          writeEvent(controller, { type: 'intent_resolved', intent });
          commitMainAgentMemory();
          if (proposal.proposal) writeEvent(controller, { type: 'proposal_presented', proposal: proposal.proposal });
          void contextLogger.info('main_agent.loop_resolved', 'Main Agent Loop returned a final answer', {
            durationMs: Date.now() - mainAgentStartedAt,
            route: 'chat',
            turns: loopResult.turns,
            toolCalls: loopResult.toolCalls,
          });
          writeAgentDone('completed');
          return;
        }
        if (terminal.type !== 'planner_handoff') {
          throw new Error(`Main Agent returned unsupported terminal control: ${terminal.type || 'unknown'}`);
        }
        const resumedFailedTask = terminal.recoveryTaskId || terminal.resumeTaskId ? recentFailedTask : null;
        const plannerUserMessage = resumedFailedTask?.originalRequest || latestUserMessage;
        intent = resumedFailedTask?.intent === 'skill_action' ? 'skill_action' : 'image';
        frontDoorResult = {
          route: 'planner',
          skillId: terminal.skillId || null,
          confidence: terminal.confidence,
        };
        plannerVisualSummary = terminal.visualSummary || resumedFailedTask?.visualSummary || null;
        selectedContextEntityIds.splice(0, selectedContextEntityIds.length, ...terminal.contextEntityIds);
        for (const referenceId of terminal.visualReferenceIds) {
          if (runtimeReferenceById.has(referenceId)) continue;
          const entity = contextEntityById.get(referenceId);
          const src = entity?.assetUrl || entity?.referenceImageUrls?.[0];
          if (!entity || !src) throw new Error(`Visual reference is unavailable: ${referenceId}`);
          runReferenceContext.references.push({
            id: referenceId,
            src,
            label: entity.label,
            source: entity.kind === 'canvas_item' ? 'canvas' : 'history',
            role: 'reference',
          });
        }
        if (!selectedSkill && frontDoorResult.skillId) {
          selectedSkill = skillManifests.find((manifest) => manifest.id === frontDoorResult?.skillId) || null;
          if (!selectedSkill) throw new Error('Main Agent selected a Skill that is no longer enabled');
          skillSource = 'auto';
          skillSelectionMethod = 'model';
          skillCandidateIds = [selectedSkill.id];
        }
        if (selectedSkill) await ensureSelectedSkillContent();
        void contextLogger.info('main_agent.loop_resolved', 'Main Agent Loop handed off to Image Planner', {
          durationMs: Date.now() - mainAgentStartedAt,
          skillId: selectedSkill?.id || null,
          contextEntityIds: terminal.contextEntityIds,
          visualReferenceIds: terminal.visualReferenceIds,
          resumeTaskId: resumedFailedTask?.taskId || null,
          turns: loopResult.turns,
          toolCalls: loopResult.toolCalls,
        });
        if (
          !body.clarificationResponse
          && (!activeClarificationState || legacyExecutionPlanDetected)
          && plannerAuthoritative
          && frontDoorResult.route === 'planner'
        ) {
          const plannerStartedAt = Date.now();
          const plannerHasVisualReferences = Boolean(runReferenceContext?.references.length);
          const plannerSelection = explicitPlannerSelection || resolvedChatSelection;
          const plannerModel = plannerSelection.model;
          const plannerProviderId = plannerSelection.providerId || undefined;
          const plannerResult = await planAgentExecutionRequest({
            userMessage: legacyExecutionPlanDetected
              ? activeClarificationState?.workingBrief || activeClarificationState?.originalRequest || latestUserMessage
              : plannerUserMessage,
            messages: plannerHistoryMessages,
            recoveryContext: resumedFailedTask ? {
              mode: recoveryMode || 'redo_all',
              completedAssetCount: resumedFailedTask.completedAssetCount,
              taskSnapshot: resumedFailedTask.taskSnapshot || null,
            } : null,
            frontDoorDecision: {
              route: 'planner',
              skillId: frontDoorResult.skillId,
              confidence: frontDoorResult.confidence,
            },
            manifests: selectedSkill ? [selectedSkill] : [],
            contextEntities,
            selectedContextEntityIds,
            activeSkillId: skillSource === 'manual' ? selectedSkill?.id || null : null,
            lockedSkillId: selectedSkill?.id || null,
            visualSummary: plannerVisualSummary,
            hasReferenceImages: plannerHasVisualReferences,
            referenceContext: runReferenceContext,
            imageOptions: body.imageOptions,
            canvasContext: body.canvasContext,
            model: plannerModel,
            providerId: plannerProviderId,
            timeoutMs: plannerTimeoutMs,
            signal: runSignal,
            chatFn: chat,
          });
          plannerVisualSummary = plannerResult.visualSummary || plannerVisualSummary;
          if (plannerResult.plan?.intent === 'image') {
            promptCompilation = {
              skillId: selectedSkill?.id || null,
              skillLabel: selectedSkill?.name || null,
              plannerProviderId: plannerProviderId || null,
              plannerModel,
              referenceCount: runReferenceContext?.references.length || 0,
              visualReferencesUsed: plannerHasVisualReferences,
              durationMs: Date.now() - plannerStartedAt,
              compiledAt: Date.now(),
            };
          }
          if (plannerResult.plan) {
            commitMainAgentMemory({
              activeTask: { status: 'planning', summary: plannerUserMessage.slice(0, 1000) },
              recentReferencedAssetIds: terminal.visualReferenceIds,
            });
          }
          if (plannerShadowMode) {
            const shadowPlan = plannerResult.plan;
            void contextLogger.info('planner.shadow', 'Image Planner shadow result', {
              durationMs: Date.now() - plannerStartedAt,
              providerId: plannerProviderId || null,
              model: plannerModel,
              plannerRequestCount: plannerResult.attempts > 0 ? 1 : 0,
              userTextLength: plannerUserMessage.length,
              usage: plannerResult.usage || null,
              decisionSource: plannerResult.source,
              sourceDetail: plannerResult.sourceDetail,
              attempts: plannerResult.attempts,
              repairAttempted: plannerResult.repairAttempted,
              error: plannerResult.error || null,
              validationErrors: plannerResult.validationErrors || [],
              normalizedFields: plannerResult.normalizedFields || [],
              ...summarizePlannerNormalizations(plannerResult.normalizedFields),
              diagnostics: plannerResult.diagnostics || [],
              planSummary: shadowPlan ? {
                intent: shadowPlan.intent,
                skillId: shadowPlan.skillId,
                confidence: shadowPlan.confidence,
                executionKind: shadowPlan.execution.kind,
                executionTool: shadowPlan.execution.tool,
                deliveryMode: shadowPlan.delivery.mode,
                outputCount: shadowPlan.delivery.outputCount,
                panelCount: shadowPlan.delivery.panelCount,
                contextReferenceCount: shadowPlan.contextReferences.length,
                imageOperation: shadowPlan.imageTask?.operation || null,
                editTargetReferenceId: shadowPlan.imageTask?.targetReferenceId || null,
                visualReferenceCount: shadowPlan.visualContext?.references.length || 0,
                targetSelectionConfidence: shadowPlan.visualContext?.targetSelectionConfidence || null,
              } : null,
              legacy: {
                intent: conversationIntent.intent,
                skillId: null,
                deliveryMode: initialDeliveryPlan.mode,
                outputCount: initialDeliveryPlan.outputCount,
                contextStatus: initialContextResolution.status,
              },
              disagreements: {
                intent: shadowPlan ? (shadowPlan.intent === 'analysis' ? 'chat' : shadowPlan.intent) !== conversationIntent.intent : null,
                skill: shadowPlan ? Boolean(shadowPlan.skillId) : null,
                deliveryMode: shadowPlan ? (shadowPlan.delivery.mode === 'single' ? 'variants' : shadowPlan.delivery.mode) !== initialDeliveryPlan.mode : null,
                outputCount: shadowPlan ? shadowPlan.delivery.outputCount !== initialDeliveryPlan.outputCount : null,
              },
            });
          } else {
            if (!plannerResult.plan) {
              if (hasOnlyImageOperationAmbiguity(plannerResult.validationErrors)) {
                const taskId = randomUUID();
                const clarificationRequest = createImageOperationClarificationRequest(taskId);
                writeProgress({ stepId: 'routing', phase: 'planning', status: 'completed', label: '图片操作方式需要确认' });
                writeProgress({ stepId: 'clarification', phase: 'waiting_input', status: 'waiting', label: '等待确认生成或编辑方式' });
                const checkpoint = progressTracker.snapshot();
                writeEvent(controller, {
                  type: 'clarification_required',
                  message: clarificationRequest.question,
                  request: clarificationRequest,
                  state: {
                    taskId,
                    operationId: checkpoint.operationId,
                    skillSource,
                    lastSequence: checkpoint.lastSequence,
                    intent: 'image',
                    ...(selectedSkill ? { skillId: selectedSkill.id } : {}),
                    originalRequest: plannerUserMessage,
                    workingBrief: plannerUserMessage,
                    askedDimensions: [],
                    answers: [],
                    referenceImages: executionReferenceImages,
                    ...(runReferenceContext ? { referenceContext: structuredClone(runReferenceContext) } : {}),
                    ...(plannerVisualSummary ? { visualSummary: structuredClone(plannerVisualSummary) } : {}),
                  },
                });
                writeAgentDone('clarification_required');
                void contextLogger.info('planner.operation_ambiguous', 'Planner image operation requires user clarification', {
                  durationMs: Date.now() - plannerStartedAt,
                  providerId: plannerProviderId || null,
                  model: plannerModel,
                  validationErrors: plannerResult.validationErrors,
                  normalizedFields: plannerResult.normalizedFields || [],
                  visualReferenceCount: runReferenceContext?.references.length || 0,
                  mutationBlocked: true,
                });
                return;
              }
              const plannerFailureReason = plannerResult.failureReason || 'invalid_plan';
              const failedTaskId = randomUUID();
              const plannerModelSwitch = plannerFailureReason === 'vision_unsupported'
                ? createPlannerModelSwitchClarification(
                    failedTaskId,
                    providers,
                    plannerProviderId,
                    plannerModel,
                  )
                : null;
              const plannerFailureMessage = plannerFailureReason === 'timeout'
                ? 'Agent 分析超时，未生成有效执行计划。请重新分析。'
                : plannerFailureReason === 'transport'
                  ? 'Agent 分析连接中断，请重新分析。'
                : plannerFailureReason === 'invalid_reference'
                  ? '图片引用与当前任务不一致，请重新选择图片后分析。'
                  : plannerFailureReason === 'invalid_context'
                    ? 'Agent 混淆了图片引用和画布上下文，已停止执行。请重新分析。'
                  : plannerFailureReason === 'vision_unsupported'
                    ? '当前分析模型不支持图片输入，请切换模型后重新分析。'
                    : plannerFailureReason === 'vision_unavailable'
                      ? '引用图片无法读取，请重新选择图片后分析。'
                  : 'Agent 未能生成完整的执行计划，请重新分析。';
              void contextLogger.warn('planner.failed', 'Image Planner failed closed before execution', {
                durationMs: Date.now() - plannerStartedAt,
                providerId: plannerProviderId || null,
                model: plannerModel,
                plannerRequestCount: plannerResult.attempts > 0 ? 1 : 0,
                userTextLength: plannerUserMessage.length,
                decisionSource: plannerResult.source,
                sourceDetail: plannerResult.sourceDetail,
                attempts: plannerResult.attempts,
                repairAttempted: plannerResult.repairAttempted,
                failureReason: plannerFailureReason,
                error: plannerResult.error || null,
                validationErrors: plannerResult.validationErrors || [],
                normalizedFields: plannerResult.normalizedFields || [],
                ...summarizePlannerNormalizations(plannerResult.normalizedFields),
                diagnostics: plannerResult.diagnostics || [],
                visualReferenceCount: runReferenceContext?.references.length || 0,
                visualEvidenceCount: runReferenceContext?.evidenceImages?.length || 0,
                mutationBlocked: true,
              });
              if (plannerModelSwitch) {
                writeProgress({ stepId: 'routing', phase: 'waiting_input', status: 'waiting', label: '等待选择支持图片输入的分析模型' });
                const switchCheckpoint = progressTracker.snapshot();
                writeEvent(controller, {
                  type: 'clarification_required',
                  message: plannerModelSwitch.request.question,
                  request: plannerModelSwitch.request,
                  state: {
                    taskId: failedTaskId,
                    operationId: switchCheckpoint.operationId,
                    skillSource,
                    lastSequence: switchCheckpoint.lastSequence,
                    intent: 'image',
                    ...(selectedSkill ? { skillId: selectedSkill.id } : {}),
                    originalRequest: plannerUserMessage,
                    workingBrief: plannerUserMessage,
                    askedDimensions: [],
                    answers: [],
                    referenceImages: executionReferenceImages,
                    ...(runReferenceContext ? { referenceContext: structuredClone(runReferenceContext) } : {}),
                    ...(plannerVisualSummary ? { visualSummary: structuredClone(plannerVisualSummary) } : {}),
                    plannerCandidates: plannerModelSwitch.plannerCandidates,
                    plannerFailure: {
                      reason: plannerFailureReason,
                      retryMode: 'replan',
                      failedAt: Date.now(),
                    },
                  },
                });
                writeAgentDone('clarification_required');
                return;
              }
              writeProgress({ stepId: 'routing', phase: 'planning', status: 'failed', label: '需求规划失败，已停止执行' });
              const failedRequest: AgentClarificationRequest = {
                id: randomUUID(),
                taskId: failedTaskId,
                question: plannerFailureMessage,
                dimension: 'planner_failure',
                options: [],
                allowCustom: true,
                allowProceed: true,
                failed: true,
              };
              const failedCheckpoint = progressTracker.snapshot();
              writeEvent(controller, {
                type: 'clarification_required',
                message: plannerFailureMessage,
                request: failedRequest,
                state: {
                  taskId: failedTaskId,
                  operationId: failedCheckpoint.operationId,
                  skillSource,
                  lastSequence: failedCheckpoint.lastSequence,
                  intent: 'image',
                  ...(selectedSkill ? { skillId: selectedSkill.id } : {}),
                  originalRequest: plannerUserMessage,
                  workingBrief: plannerUserMessage,
                  askedDimensions: [],
                  answers: [],
                  referenceImages: executionReferenceImages,
                  ...(runReferenceContext ? { referenceContext: structuredClone(runReferenceContext) } : {}),
                  ...(plannerVisualSummary ? { visualSummary: structuredClone(plannerVisualSummary) } : {}),
                  plannerFailure: {
                    reason: plannerFailureReason,
                    retryMode: 'replan',
                    failedAt: Date.now(),
                  },
                },
              });
              writeEvent(controller, {
                type: 'agent_error',
                stage: 'planning',
                message: plannerFailureMessage,
                reason: plannerFailureReason,
                retryable: ['timeout', 'transport'].includes(plannerFailureReason),
                recoveryRecord: buildRecoveryRecord({
                  stage: 'planning',
                  message: plannerFailureMessage,
                  reason: plannerFailureReason,
                  retryable: ['timeout', 'transport'].includes(plannerFailureReason),
                  resumeRoute: 'image_planner',
                }),
              });
              writeAgentDone('planner_failed');
              return;
            }
            executionPlan = plannerResult.plan;
            executionPlanSource = plannerResult.source as 'model' | 'fallback';
            executionPlanSourceDetail = plannerResult.sourceDetail as AgentPlannerSourceDetail;
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
            intent = executionPlan.intent === 'analysis' ? 'chat' : executionPlan.intent;
            selectedSkill = executionPlan.skillId
              ? skillManifests.find((manifest) => manifest.id === executionPlan?.skillId) || null
              : null;
            skillSource = selectedSkill ? skillSource || (body.activeSkillId ? 'manual' : 'auto') : null;
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
            void contextLogger.info('planner.resolved', 'Image Planner execution plan resolved', {
              durationMs: Date.now() - plannerStartedAt,
              providerId: plannerProviderId || null,
              model: plannerModel,
              plannerRequestCount: plannerResult.attempts > 0 ? 1 : 0,
              userTextLength: plannerUserMessage.length,
              usage: plannerResult.usage || null,
              decisionSource: plannerResult.source,
              sourceDetail: plannerResult.sourceDetail,
              attempts: plannerResult.attempts,
              repairAttempted: plannerResult.repairAttempted,
              error: plannerResult.error || null,
              validationErrors: plannerResult.validationErrors || [],
              normalizedFields: plannerResult.normalizedFields || [],
              ...summarizePlannerNormalizations(plannerResult.normalizedFields),
              diagnostics: plannerResult.diagnostics || [],
              intent: executionPlan.intent,
              skillId: executionPlan.skillId,
              confidence: executionPlan.confidence,
              executionKind: executionPlan.execution.kind,
              executionTool: executionPlan.execution.tool,
              deliveryMode: executionPlan.delivery.mode,
              outputCount: executionPlan.delivery.outputCount,
              panelCount: executionPlan.delivery.panelCount,
              variationAxes: executionPlan.delivery.variationAxes,
              contextReferences: executionPlan.contextReferences,
              imageOperation: executionPlan.imageTask?.operation || null,
              editTargetReferenceId: executionPlan.imageTask?.targetReferenceId || null,
              supportingReferenceIds: executionPlan.imageTask?.supportingReferenceIds || [],
              visualReferenceCount: executionPlan.visualContext?.references.length || 0,
              targetSelectionConfidence: executionPlan.visualContext?.targetSelectionConfidence || null,
              targetClarificationRequired: executionPlan.needsClarification,
              generationPromptFormat: executionPlan.generation?.promptFormat || null,
              generationPromptLength: executionPlan.generation?.prompt.length || 0,
              generationItemCount: executionPlan.generation?.items.length || 0,
            });
          if (executionPlan.needsClarification && executionPlan.clarification) {
            if (intent === 'chat') {
              writeProgress({ stepId: 'clarification', phase: 'waiting_input', status: 'waiting', label: '等待补充关键信息' });
              writeEvent(controller, {
                type: 'assistant_delta',
                delta: executionPlan.clarification.question,
                channel: 'content',
                model: resolvedChatSelection.model,
              });
              writeAgentDone('clarification_required');
              return;
            }
            const taskId = randomUUID();
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
            writeEvent(controller, {
              type: 'clarification_required',
              message: request.question,
              request,
              state: {
                taskId,
                operationId: checkpoint.operationId,
                skillSource,
                lastSequence: checkpoint.lastSequence,
                intent: intent === 'skill_action' ? 'skill_action' : 'image',
                ...(selectedSkill ? { skillId: selectedSkill.id } : {}),
                originalRequest: plannerUserMessage,
                workingBrief: executionBrief,
                askedDimensions: [],
                answers: [],
                referenceImages: executionReferenceImages,
                ...(runReferenceContext ? { referenceContext: structuredClone(runReferenceContext) } : {}),
                requestedImageCountTotal: executionPlan.delivery.outputCount,
                resolvedImageCount: executionPlan.delivery.outputCount,
                resolvedImageCountSource: 'prompt',
                resolvedImageDeliveryMode: executionPlan.delivery.mode === 'single' ? 'variants' : executionPlan.delivery.mode,
                resolvedImagePanelCount: executionPlan.delivery.panelCount || undefined,
                executionPlan: structuredClone(executionPlan),
              },
            });
            writeAgentDone('clarification_required');
            return;
          }
          }
        }
        if (!body.clarificationResponse && contextResolution.detected) {
          writeProgress({ stepId: 'context_resolution', phase: 'resolving', status: 'active', label: '正在解析上下文引用' });
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
            writeProgress({
              stepId: 'context_resolution',
              phase: 'resolving',
              status: 'completed',
              label: `已解析引用：${labels.join('、')}`,
            });
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
            const taskId = randomUUID();
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
            writeEvent(controller, {
              type: 'clarification_required',
              message: request.question,
              request,
              state: {
                taskId,
                operationId: checkpoint.operationId,
                skillSource,
                lastSequence: checkpoint.lastSequence,
                intent: candidates.every((candidate) => candidate.intent === 'skill_action') ? 'skill_action' : 'image',
                originalRequest: plannerUserMessage,
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
          const retryClarification = body.clarificationResponse.retry === true;
          const isPlannerFailureRequest = body.clarificationRequest.dimension === 'planner_failure';
          const isImageOperationClarification = body.clarificationRequest.dimension === 'image_operation';
          const isSkillSelectionClarification = body.clarificationRequest.dimension === 'skill_selection';
          const isPlannerModelSwitch = body.clarificationRequest.dimension === 'planner_model_switch';
          const isRecoveryScope = body.clarificationRequest.dimension === 'recovery_scope';
          const selectedPlannerCandidate = isPlannerModelSwitch
            ? activeClarificationState.plannerCandidates?.find((candidate) => (
                candidate.id === body.clarificationResponse?.selectedOptionId
              ))
            : undefined;
          const selectedPlannerResolution = selectedPlannerCandidate
            ? resolveProviderModelSelection({
                providers,
                purpose: 'chat',
                requestedProviderId: selectedPlannerCandidate.providerId,
                requestedModel: selectedPlannerCandidate.model,
              })
            : null;
          if (
            isPlannerModelSwitch
            && (
              !selectedPlannerCandidate
              || selectedPlannerResolution?.reason !== 'exact'
              || selectedPlannerResolution.providerId !== selectedPlannerCandidate.providerId
              || selectedPlannerResolution.model !== selectedPlannerCandidate.model
            )
          ) {
            throw new Error('Planner model selection is no longer an enabled provider and model pair');
          }
          const isPlannerFailureRetry = isPlannerFailureRequest
            && retryClarification
            && body.clarificationResponse.retryMode === 'replan'
            && activeClarificationState.plannerFailure?.retryMode === 'replan';
          if (isPlannerFailureRequest && !isPlannerFailureRetry) {
            throw new Error('Planner failure retry must use the saved replan mode');
          }
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
          if (selectedPlannerResolution?.providerId && selectedPlannerResolution.model) {
            activeClarificationState.plannerSelection = {
              providerId: selectedPlannerResolution.providerId,
              model: selectedPlannerResolution.model,
            };
          }
          executionBrief = isPlannerFailureRetry || isPlannerModelSwitch || isRecoveryScope
            ? activeClarificationState.originalRequest
            : activeClarificationState.workingBrief || activeClarificationState.originalRequest;
          executionReferenceImages = [...(activeClarificationState.referenceImages || executionReferenceImages)];
          const shouldReplan = plannerAuthoritative
            && (
              isPlannerFailureRetry
              || isPlannerModelSwitch
              || isImageOperationClarification
              || isSkillSelectionClarification
              || isRecoveryScope
              || legacyExecutionPlanDetected
              || activeClarificationState.executionPlan?.needsClarification === true
            );
          if (shouldReplan) {
            await ensureSelectedSkillContent();
            const plannerStartedAt = Date.now();
            const plannerHasVisualReferences = Boolean(runReferenceContext?.references.length);
            const plannerSelection = activeClarificationState.plannerSelection || explicitPlannerSelection || resolvedChatSelection;
            const plannerModel = plannerSelection.model;
            const plannerProviderId = plannerSelection.providerId || undefined;
            const replanned = await planAgentExecutionRequest({
              userMessage: executionBrief,
              messages: plannerHistoryMessages,
              recoveryContext: activeClarificationState.recoveryRecord ? {
                mode: activeClarificationState.recoveryMode || recoveryMode || 'redo_all',
                completedAssetCount: activeClarificationState.recoveryRecord.completedAssetCount,
                taskSnapshot: activeClarificationState.recoveryRecord.taskSnapshot || null,
              } : null,
              frontDoorDecision: frontDoorResult ? {
                route: 'planner',
                skillId: frontDoorResult.skillId,
                confidence: frontDoorResult.confidence,
              } : null,
              manifests: selectedSkill ? [selectedSkill] : [],
              contextEntities,
              selectedContextEntityIds,
              activeSkillId: skillSource === 'manual' ? selectedSkill?.id || null : null,
              lockedSkillId: selectedSkill?.id || null,
              visualSummary: plannerVisualSummary,
              hasReferenceImages: plannerHasVisualReferences,
              referenceContext: runReferenceContext,
              imageOptions: body.imageOptions,
              canvasContext: body.canvasContext,
              model: plannerModel,
              providerId: plannerProviderId,
              timeoutMs: plannerTimeoutMs,
              signal: runSignal,
              chatFn: chat,
            });
            plannerVisualSummary = replanned.visualSummary || plannerVisualSummary;
            if (replanned.plan?.intent === 'image') {
              promptCompilation = {
                skillId: selectedSkill?.id || null,
                skillLabel: selectedSkill?.name || null,
                plannerProviderId: plannerProviderId || null,
                plannerModel,
                referenceCount: runReferenceContext?.references.length || 0,
                visualReferencesUsed: plannerHasVisualReferences,
                durationMs: Date.now() - plannerStartedAt,
                compiledAt: Date.now(),
              };
            }
            if (!replanned.plan) {
              if (
                !activeClarificationState.askedDimensions.includes('image_operation')
                && hasOnlyImageOperationAmbiguity(replanned.validationErrors)
              ) {
                const clarificationRequest = createImageOperationClarificationRequest(activeClarificationState.taskId);
                writeProgress({ stepId: 'clarification', phase: 'waiting_input', status: 'waiting', label: '等待确认生成或编辑方式' });
                const checkpoint = progressTracker.snapshot();
                writeEvent(controller, {
                  type: 'clarification_required',
                  message: clarificationRequest.question,
                  request: clarificationRequest,
                  state: {
                    ...activeClarificationState,
                    operationId: checkpoint.operationId,
                    skillSource,
                    lastSequence: checkpoint.lastSequence,
                    executionPlan: undefined,
                    plannerFailure: undefined,
                    referenceImages: [...executionReferenceImages],
                    ...(runReferenceContext ? { referenceContext: structuredClone(runReferenceContext) } : {}),
                    ...(plannerVisualSummary ? { visualSummary: structuredClone(plannerVisualSummary) } : {}),
                  },
                });
                writeAgentDone('clarification_required');
                void contextLogger.info('planner.operation_ambiguous', 'Replanned image operation requires user clarification', {
                  durationMs: Date.now() - plannerStartedAt,
                  providerId: plannerProviderId || null,
                  model: plannerModel,
                  validationErrors: replanned.validationErrors,
                  normalizedFields: replanned.normalizedFields || [],
                  visualReferenceCount: runReferenceContext?.references.length || 0,
                  mutationBlocked: true,
                });
                return;
              }
              const failureReason = replanned.failureReason || 'invalid_plan';
              const message = failureReason === 'timeout'
                ? 'Agent 分析超时，未生成有效执行计划。请重新分析。'
                : failureReason === 'transport'
                  ? 'Agent 分析连接中断，请重新分析。'
                : failureReason === 'vision_unsupported'
                ? '当前分析模型不支持图片输入，请切换模型后重新分析。'
                : failureReason === 'vision_unavailable'
                  ? '引用图片无法读取，请重新选择图片后分析。'
                  : failureReason === 'invalid_reference'
                    ? '图片引用与当前任务不一致，请重新选择图片后分析。'
                    : failureReason === 'invalid_context'
                      ? 'Agent 混淆了图片引用和画布上下文，已停止执行。请重新分析。'
                      : 'Agent 未能生成完整的执行计划，请重新分析。';
              const replannedModelSwitch = failureReason === 'vision_unsupported'
                ? createPlannerModelSwitchClarification(
                    activeClarificationState.taskId,
                    providers,
                    plannerProviderId,
                    plannerModel,
                    isPlannerModelSwitch ? activeClarificationState.plannerCandidates : undefined,
                  )
                : null;
              if (replannedModelSwitch) {
                writeProgress({ stepId: 'clarification', phase: 'waiting_input', status: 'waiting', label: '等待选择支持图片输入的分析模型' });
                const switchCheckpoint = progressTracker.snapshot();
                writeEvent(controller, {
                  type: 'clarification_required',
                  message: replannedModelSwitch.request.question,
                  request: replannedModelSwitch.request,
                  state: {
                    ...activeClarificationState,
                    operationId: switchCheckpoint.operationId,
                    skillSource,
                    lastSequence: switchCheckpoint.lastSequence,
                    executionPlan: undefined,
                    referenceImages: [...executionReferenceImages],
                    ...(runReferenceContext ? { referenceContext: structuredClone(runReferenceContext) } : {}),
                    ...(plannerVisualSummary ? { visualSummary: structuredClone(plannerVisualSummary) } : {}),
                    plannerCandidates: replannedModelSwitch.plannerCandidates,
                    plannerFailure: {
                      reason: failureReason,
                      retryMode: 'replan',
                      failedAt: Date.now(),
                    },
                  },
                });
                writeAgentDone('clarification_required');
                void contextLogger.warn('planner.clarification_model_switch', 'Planner needs user-approved visual model switch', {
                  durationMs: Date.now() - plannerStartedAt,
                  providerId: plannerProviderId || null,
                  model: plannerModel,
                  candidates: replannedModelSwitch.plannerCandidates,
                  mutationBlocked: true,
                });
                return;
              }
              writeProgress({ stepId: 'clarification', phase: 'planning', status: 'failed', label: '补充信息规划失败' });
              const failedRequest: AgentClarificationRequest = {
                id: randomUUID(),
                taskId: activeClarificationState.taskId,
                question: message,
                dimension: 'planner_failure',
                options: [],
                allowCustom: true,
                allowProceed: true,
                failed: true,
              };
              const failedCheckpoint = progressTracker.snapshot();
              const failedState: AgentClarificationState = {
                ...activeClarificationState,
                operationId: failedCheckpoint.operationId,
                skillSource,
                lastSequence: failedCheckpoint.lastSequence,
                originalRequest: activeClarificationState.originalRequest,
                workingBrief: activeClarificationState.originalRequest,
                referenceImages: [...executionReferenceImages],
                ...(runReferenceContext ? { referenceContext: structuredClone(runReferenceContext) } : {}),
                ...(plannerVisualSummary ? { visualSummary: structuredClone(plannerVisualSummary) } : {}),
                executionPlan: undefined,
                plannerFailure: {
                  reason: failureReason,
                  retryMode: 'replan',
                  failedAt: Date.now(),
                },
              };
              writeEvent(controller, {
                type: 'clarification_required',
                message,
                request: failedRequest,
                state: failedState,
              });
              writeEvent(controller, {
                type: 'agent_error',
                stage: 'planning',
                message,
                reason: failureReason,
                retryable: ['timeout', 'transport'].includes(failureReason),
                recoveryRecord: buildRecoveryRecord({
                  stage: 'planning',
                  message,
                  reason: failureReason,
                  retryable: ['timeout', 'transport'].includes(failureReason),
                  resumeRoute: 'image_planner',
                }),
              });
              writeAgentDone('planner_failed');
              void contextLogger.warn('planner.clarification_failed', 'Planner failed after clarification', {
                durationMs: Date.now() - plannerStartedAt,
                providerId: plannerProviderId || null,
                model: plannerModel,
                plannerRequestCount: replanned.attempts > 0 ? 1 : 0,
                userTextLength: executionBrief.length,
                failureReason,
                validationErrors: replanned.validationErrors || [],
                normalizedFields: replanned.normalizedFields || [],
                ...summarizePlannerNormalizations(replanned.normalizedFields),
                diagnostics: replanned.diagnostics || [],
                visualReferenceCount: runReferenceContext?.references.length || 0,
                mutationBlocked: true,
              });
              return;
            }
            executionPlan = replanned.plan;
            executionPlanSource = replanned.source as 'model' | 'fallback';
            executionPlanSourceDetail = replanned.sourceDetail as AgentPlannerSourceDetail;
            executionKind = executionPlan.execution.kind;
            executionBriefData = executionPlanToBrief(executionPlan, executionBrief, contextEntities) as ExecutionBrief;
            executionBrief = executionBriefData.plainText;
            imageDeliveryPlan = executionPlanToImageDeliveryPlan(executionPlan) as ImageDeliveryPlan;
            executionReferenceImages = resolveAgentImageCardReferences({
              referenceContext: runReferenceContext,
              referenceImages: executionReferenceImages,
              imageTask: executionPlan.imageTask,
            }).orderedReferenceImages;
            activeClarificationState.executionPlan = structuredClone(executionPlan);
            activeClarificationState.workingBrief = executionBrief;
            activeClarificationState.intent = executionPlan.intent === 'skill_action' ? 'skill_action' : 'image';
            activeClarificationState.skillId = executionPlan.skillId || undefined;
            activeClarificationState.plannerFailure = undefined;
            void contextLogger.info('planner.clarification_resolved', 'Planner resolved a new execution plan after user-requested reanalysis', {
              durationMs: Date.now() - plannerStartedAt,
              providerId: plannerProviderId || null,
              model: plannerModel,
              plannerRequestCount: 1,
              userTextLength: executionBrief.length,
              diagnostics: replanned.diagnostics || [],
              generationPromptFormat: executionPlan.generation?.promptFormat || null,
              generationPromptLength: executionPlan.generation?.prompt.length || 0,
              generationItemCount: executionPlan.generation?.items.length || 0,
            });
            if (executionPlan.needsClarification && executionPlan.clarification) {
              const request: AgentClarificationRequest = {
                id: randomUUID(),
                taskId: activeClarificationState.taskId,
                question: executionPlan.clarification.question,
                dimension: executionPlan.clarification.dimension,
                options: executionPlan.clarification.options,
                allowCustom: true,
                allowProceed: true,
              };
              const checkpoint = progressTracker.snapshot();
              writeProgress({ stepId: 'clarification', phase: 'waiting_input', status: 'waiting', label: '仍需确认主要编辑图片' });
              writeEvent(controller, {
                type: 'clarification_required',
                message: request.question,
                request,
                state: {
                  ...activeClarificationState,
                  operationId: checkpoint.operationId,
                  lastSequence: checkpoint.lastSequence,
                  referenceImages: executionReferenceImages,
                  ...(runReferenceContext ? { referenceContext: structuredClone(runReferenceContext) } : {}),
                },
              });
              writeAgentDone('clarification_required');
              return;
            }
          }
          const selectedContextEntity = body.clarificationRequest.dimension === 'context_reference'
            ? [...(activeClarificationState.contextCandidates || []), ...contextEntities]
                .find((entity) => entity.id === body.clarificationResponse?.selectedOptionId)
            : null;
          if (selectedContextEntity) {
            if (executionPlan) {
              executionPlan = {
                ...executionPlan,
                contextReferences: [selectedContextEntity.id],
              };
              activeClarificationState.executionPlan = structuredClone(executionPlan);
            }
            contextResolution = {
              status: 'resolved',
              detected: true,
              confidence: 'high',
              candidates: [selectedContextEntity],
              entityIds: [selectedContextEntity.id],
            };
            executionBriefData = executionPlan
              ? executionPlanToBrief(executionPlan, latestUserMessage, contextEntities) as ExecutionBrief
              : compileExecutionBrief({ userMessage: latestUserMessage, contextResolution });
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
            writeEvent(controller, {
              type: 'brief_compiled',
              resolvedEntityIds: [selectedContextEntity.id],
              summary: selectedContextEntity.label,
              mustPreserveCount: executionBriefData.mustPreserve.length,
            });
          } else {
            executionBriefData = compileExecutionBrief({ userMessage: executionBrief });
          }
          proceedWithCurrentBrief = applied.proceedWithCurrent;
          resumedClarification = true;
          writeProgress({ stepId: 'clarification', phase: 'resuming', status: 'active', label: '正在应用补充信息' });
          intent = activeClarificationState.intent;
          selectedSkill = activeClarificationState.skillId
            ? skillManifests.find((manifest) => manifest.id === activeClarificationState?.skillId) || null
            : null;
          if (activeClarificationState.skillId && !selectedSkill) {
            throw new Error('The selected skill is no longer available; please restart the request');
          }
          if (selectedSkill && !skillSource) skillSource = body.activeSkillId ? 'manual' : 'auto';
          if (retryClarification) executionBrief = activeClarificationState.workingBrief;
          writeProgress({ stepId: 'clarification', phase: 'resuming', status: 'completed', label: '补充信息已应用' });
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
            skillSource = selectedSkill ? 'auto' : null;
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
          if (!plannerAuthoritative && !executionPlan && intent === 'chat' && !selectedSkill && isPotentialDesignExecutionRequest(latestUserMessage)) {
            intent = 'image';
          }
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
        void contextLogger.info('planner.resolved', 'Image Planner route and execution intent resolved', {
          decisionSource: executionPlanSource || routingDecision?.source || null,
          skillSelectionMethod,
          skillCandidateIds,
          fullSkillInjected: Boolean(selectedSkill && skillContent),
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
        writeProgress({ stepId: 'routing', phase: 'routing', status: 'completed', label: '请求路由完成' });
        writeEvent(controller, { type: 'intent_resolved', intent });
        if (selectedSkill) {
          writeEvent(controller, {
            type: 'skill_selected',
            skillId: selectedSkill.id,
            label: selectedSkill.name,
            source: skillSource || 'auto',
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

        // Full Skill instructions belong to Image Planner; Main Agent receives the validated plan only.
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
            const taskId = activeClarificationState?.taskId || randomUUID();
            const candidates = [...new Set((explicitBatchCountResolution.candidates || [])
              .map((candidate) => positiveInteger(candidate))
              .filter((candidate): candidate is number => Boolean(candidate)))];
            const requestedTotal = Math.max(2, ...candidates);
            const question = '你同时要求多张独立图片和全部放进一张图，需确认最终交付形式。';
            const checkpoint = progressTracker.snapshot();
            const state: AgentClarificationState = {
              ...(activeClarificationState || {
                taskId,
                intent: intent === 'skill_action' ? 'skill_action' : 'image',
                originalRequest: executionBrief,
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
            writeEvent(controller, { type: 'clarification_required', message: question, request, state });
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
            const taskId = activeClarificationState?.taskId || randomUUID();
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
                intent: intent === 'skill_action' ? 'skill_action' : 'image',
                originalRequest: executionBrief,
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
              ...(selectedSkill ? { skillId: selectedSkill.id } : {}),
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
            writeEvent(controller, { type: 'clarification_required', message: question, request, state });
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
            taskId: randomUUID(),
            operationId: progressTracker.snapshot().operationId,
            skillSource,
            lastSequence: progressTracker.snapshot().lastSequence,
            intent: intent === 'skill_action' ? 'skill_action' : 'image',
            ...(selectedSkill ? { skillId: selectedSkill.id } : {}),
            originalRequest: executionBrief,
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
            writeEvent(controller, {
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
            writeEvent(controller, {
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
            const failedTaskId = activeClarificationState?.taskId || randomUUID();
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
            writeProgress({ stepId: 'routing', phase: 'planning', status: 'failed', label: '图片计划校验失败，已停止执行' });
            writeEvent(controller, {
              type: 'clarification_required',
              message,
              request: failedRequest,
              state: {
                taskId: failedTaskId,
                operationId: failedCheckpoint.operationId,
                skillSource,
                lastSequence: failedCheckpoint.lastSequence,
                intent: 'image',
                originalRequest: activeClarificationState?.originalRequest || latestUserMessage,
                workingBrief: activeClarificationState?.originalRequest || latestUserMessage,
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
                resumeRoute: 'image_planner',
              }),
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
          writeProgress({
            stepId: 'prompt_optimization',
            phase: 'optimizing',
            status: 'active',
            label: '正在准备最终图片提示词',
          });
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
          writeProgress({
            stepId: 'prompt_optimization',
            phase: 'optimizing',
            status: 'completed',
            label: '最终图片提示词已准备',
          });

          const requiresImageConfirmation = (
            (requestedImageCount > 1 && body.imageOptions?.autoConfirm !== true)
            || executionPlan?.execution.requiresConfirmation === true
          );
          if (requiresImageConfirmation) {
            const previewPromptEntries = allGenerationItems.length > 0
              ? allGenerationItems
              : [{ id: 'image-1', index: 1, label: '图片 1', subject: 'image', prompt: finalGenerationPrompt }];
            previewPromptEntries.forEach((item, index) => writeEvent(controller, {
              type: 'image_prompts_ready',
              index,
              label: item.label || `图片 ${index + 1}`,
              prompt: item.prompt,
              ...(promptCompilation ? { compilation: promptCompilation } : {}),
            }));
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
            const progressToolCallId = `${runId}-generate-image-confirmation`;
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
              toolArgs: { prompt: finalGenerationPrompt },
              pendingToolCall: {
                id: progressToolCallId,
                name: 'generate_image',
                args: { prompt: finalGenerationPrompt },
                argsHash: hashEnvelopeValue({ prompt: finalGenerationPrompt }),
                batch: [{ id: progressToolCallId, name: 'generate_image', args: { prompt: finalGenerationPrompt } }],
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
            writeEvent(controller, {
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
          writeToolProgress('generate_image', 'active', toolCallId);
          writeEvent(controller, { type: 'tool_start', toolCallId, toolName: 'generate_image' });
          writeEvent(controller, { type: 'tool_update', toolCallId, message: '正在渲染高分辨率画面' });

          const toolRegistry = createAgentToolRegistry({
            generateImage: async () => generateImagePayload(
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
              undefined,
              imageDeliveryPlan,
            ),
          });
          const generationPayload = await executeAgentTool(toolRegistry, 'generate_image', {}, {
            allowedTools: selectedSkill?.allowedTools || ['generate_image', 'get_canvas_context'],
            canvasContext: body.canvasContext,
          }) as any;
          const assets = generatedAssetsFromResult(generationPayload);
          if (assets.length === 0) throw new Error('Image generation returned no usable assets');
          writeResolvedImageOptionUpdate(toolCallId, generationPayload);
          for (const event of enrichGeneratedAssetEvents(createAgentToolResultEvents({
            source: 'direct',
            runId,
            toolCallId,
            toolName: 'generate_image',
            rawResult: generationPayload,
          }), generationPayload)) writeEvent(controller, event as AgentEvent);
          writeImageCompletionSummary(generationPayload);
          updateTopicMemory({
            activeTask: { status: 'completed', summary: executionPlan.presentation?.completionSummary || 'Image Planner image delivery completed.' },
            recentReferencedAssetIds: executionPlan.contextReferences,
          });
          writeToolProgress('generate_image', 'completed', toolCallId);
          writeAgentDone('image_generated');
          return;
        }

        if (executionPlan) {
          if (executionPlan.execution.tool !== 'start_skill_job') {
            throw new Error(`Unsupported deterministic Image Planner tool: ${executionPlan.execution.tool}`);
          }
          const skillType = selectedSkill?.id;
          if (skillType !== 'logo' && skillType !== 'brand') {
            throw new Error('Image Planner Skill job requires a supported locked Skill');
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
          writeEvent(controller, {
            type: 'confirmation_required',
            request: {
              confirmationId,
              toolName: 'start_skill_job',
              message: '确认后启动 Image Planner 已验证的 Skill 任务。',
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
          generateImage: async (args: Record<string, unknown>) => {
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
              undefined,
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
          writeProgress({ stepId: 'composing', phase: 'planning', status: 'active', label: '正在规划下一步操作' });
          const loopResult = await runZFlowAgentBrain({
            messages: chatMessages,
            providerId: resolvedChatSelection.providerId,
            model,
            modelMetadata: providers.find((provider) => provider.id === resolvedChatSelection.providerId),
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
              });
              rawToolResults.set(context.toolCallId, rawResult);
              const views = createAgentToolResultViews(toolName, rawResult);
              return { ...rawResult as Record<string, unknown>, ...views };
            },
            requireMutationTool: executionPlan
              ? Boolean(executionPlan.execution.tool)
              : intent === 'image' || intent === 'skill_action',
            onToolStart: ({ id, name }) => {
              writeToolProgress(name, 'active', id);
              writeEvent(controller, { type: 'tool_start', toolCallId: id, toolName: name });
            },
            onToolResult: ({ id, name, result, rawResult: runtimeRawResult, isError }) => {
              const rawResult = rawToolResults.get(id) ?? runtimeRawResult;
              if (name === 'generate_image') {
                writeResolvedImageOptionUpdate(id, rawResult);
              }
              for (const event of enrichGeneratedAssetEvents(createAgentToolResultEvents({
                source: 'loop',
                runId,
                toolCallId: id,
                toolName: name,
                rawResult: rawResult ?? result,
              }), rawResult ?? result)) writeEvent(controller, event as AgentEvent);
              if (name === 'generate_image') {
                writeImageCompletionSummary(rawResult ?? result);
              }
              writeToolProgress(name, isError ? 'failed' : 'completed', id);
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
            });
            return;
          }
          writeProgress({ stepId: 'composing', phase: 'planning', status: 'completed', label: '操作规划完成' });
          if (loopResult.stopReason === 'execution_required') {
            const taskId = randomUUID();
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
            writeEvent(controller, {
              type: 'clarification_required',
              message: request.question,
              request,
              state: {
                taskId,
                operationId: checkpoint.operationId,
                skillSource,
                lastSequence: checkpoint.lastSequence,
                intent: intent === 'skill_action' ? 'skill_action' : 'image',
                ...(selectedSkill ? { skillId: selectedSkill.id } : {}),
                originalRequest: executionBrief,
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
            writeEvent(controller, {
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
          writeProgress({ stepId: 'composing', phase: 'responding', status: 'active', label: '正在整理执行结果' });
          const loopProposal = parseAgentProposalBlock(loopResult.content);
          const safeLoopContent = sanitizeAgentResponseContent(
            loopProposal.cleanContent,
            loopResult.mutationToolCalls > 0,
          );
          if (loopProposal.proposal) {
            writeEvent(controller, { type: 'proposal_presented', proposal: loopProposal.proposal });
          }
          if (safeLoopContent) {
            writeEvent(controller, {
              type: 'assistant_delta',
              delta: safeLoopContent,
              channel: 'content',
              model,
            });
          }
          writeProgress({ stepId: 'composing', phase: 'responding', status: 'completed', label: '执行结果已整理' });
          writeAgentDone(loopResult.stopReason);
          return;
        }
        writeProgress({ stepId: 'composing', phase: 'responding', status: 'active', label: '正在组织回复' });
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
        writeProgress({ stepId: 'composing', phase: 'responding', status: 'completed', label: '回复已完成' });
        writeAgentDone('completed');
      } catch (error) {
        if (clarificationSubmissionKey) {
          clarificationSubmissionStore.delete(clarificationSubmissionKey);
        }
        const aborted = request.signal.aborted;
        const failureStage = aborted ? 'cancelled' : executionKind || (intent === 'image' ? 'image_pipeline' : 'chat');
        const failureMessage = aborted ? '运行已取消' : error instanceof Error ? error.message : 'Agent run failed';
        const recoveryRecord = preserveRecoveryRecordOnFailure && recoveryBaseRecord
          ? recoveryBaseRecord
          : buildRecoveryRecord({
              stage: failureStage,
              message: failureMessage,
              status: aborted ? 'cancelled' : 'failed',
            });
        progressTracker.settleActive(
          'failed',
          aborted ? '运行已取消' : '运行失败',
        );
        writeEvent(controller, {
          type: 'agent_error',
          stage: failureStage,
          message: failureMessage,
          recoveryRecord,
        });
      } finally {
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
