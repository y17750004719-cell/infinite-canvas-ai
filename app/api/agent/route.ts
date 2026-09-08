import { NextRequest, NextResponse } from 'next/server';
import { createHash, randomUUID } from 'node:crypto';
import { POST as generatePost } from '../generate/route';
import { runNativeAgentTurn } from '../../lib/agent/native-agent-service';
import { NATIVE_AGENT_INSTRUCTIONS } from '../../lib/agent/native-agent-instructions.mjs';
import { executeNativeBusinessOperation, saveNativeConfirmation, loadNativeConfirmation, claimNativeConfirmation } from '../../lib/agent/native-business-ledger.mjs';
import {
  resolveAgentConversationIntent,
  resolveImageDeliveryPlan,
} from '../../lib/agent/image-delivery-utils.mjs';
import {
  listSkillManifests,
  loadSkillContent,
  IMAGEGEN_HOST_SKILL_ID,
  resolveExplicitSkillDirective,
} from '../../lib/agent/skill-registry.mjs';
import {
  createAgentRecoveryRecord,
  normalizeAgentRecoveryRecord,
} from '../../lib/agent/recovery.mjs';
import { normalizeAgentVisualSummary } from '../../lib/agent/visual-summary.mjs';
import { normalizeAgentConversationMemory } from '../../lib/chat-message-persistence.mjs';
import {
  applyAgentAnalysisCheckpoint,
  createAgentAnalysisSnapshot,
  recordAgentUserDecision,
  restoreAgentAnalysisSnapshot,
} from '../../lib/agent/agent-analysis.mjs';
import {
  applyClarificationResponse,
  resolveImageOperationResponse,
} from '../../lib/agent/clarification-state.mjs';
import {
  createAgentProgressTracker,
  createAgentToolResultEvents,
  createAgentToolResultViews,
  startAgentImageGenerationHeartbeat,
} from '../../lib/agent/agent-loop.mjs';
import {
  assertExpectedSequence,
  assertSameAgentOperation,
  isAgentLifecycleEvent,
  resolveAgentIdentity,
} from '../../lib/agent/event-contract.mjs';
import { assertImageExecutionContract } from '../../lib/agent/image-runtime-contract.mjs';
import {
  registerActiveAgentRun,
  registerActiveAgentRunControl,
  getActiveAgentRun,
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
import { createTodoTools } from '../../lib/agent/todo-tools.mjs';
import { readProviderRegistry } from '../../lib/provider-config.mjs';
import {
  resolveProviderModelSelection,
} from '../../lib/provider-model-selection.mjs';
import { createLogger } from '../../lib/logger';
import { normalizeGeneratedImageHistory } from '../../lib/generated-image-history.mjs';
import {
  isSessionVisualAssetAvailable,
  materializeSessionVisualAsset,
  readSessionVisualAsset,
} from '../../lib/agent/session-visual-assets.mjs';
import { normalizeSessionVisualAssets } from '../../lib/agent/session-visual-asset-metadata.mjs';
import {
  buildReplayableContext,
  buildResponseItems,
  compactContextAsync,
  contextEventFromAgentEvent,
  estimateContextTokens,
  normalizeCompactedWindows,
} from '../../lib/agent/context-events.mjs';
import { estimateContextBudget } from '../../lib/agent/context-window.mjs';
import type { ContextEvent, ContextWindowState } from '../../lib/db';
import {
  VisualReferenceResolutionError,
  resolveExecutableVisualReferences,
  selectRecentSessionImage,
} from '../../lib/agent/executable-visual-references.mjs';
import { buildProviderImageOptionProfiles } from '../../lib/image-provider-option-profiles.mjs';
import { appendThreadEvent, queryThread, loadThread, updateThreadState, forkThread, consumeThreadInputs } from '../../lib/agent/thread-journal.mjs';
import {
  commandErrorResponse, commandUsage, isManagementCommand, searchHistoryPages,
  parseHistoryCommandArgs, parseSlashCommand,
} from '../../lib/agent/commands.mjs';
import {
  AGENT_DEFAULT_IMAGE_OPTIONS,
  AGENT_IMAGE_ASPECT_RATIO_IDS,
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
import { isReferentialShorthand, parseAgentProposalBlock, resolveContextReference } from '../../lib/agent/context-reference.mjs';
import type {
  AgentContextEntity,
  AgentContextResolution,
  AgentTaskContract,
} from '../../lib/agent/context-reference.types';
type WorkingContext = {
  version: 1;
  originalRequest: string;
  resolvedEntityIds: string[];
  resolvedLabels?: string[];
  plainText: string;
  mustPreserve: string[];
  referenceImageUrls: string[];
  canvasItemIds: string[];
};
type AgentImageTask = Record<string, any> & { operation?: 'generate' | 'edit'; targetReferenceId?: string | null; supportingReferenceIds?: string[] };
type AgentPlanPresentation = { title: string; summary?: string; operation?: 'generate' | 'edit'; completionSummary?: string };
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
  AgentAnalysisSnapshot,
} from '../../lib/agent/events';
import type { GeneratedImageHistoryEntry, SessionVisualAsset } from '../../lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_AGENT_TURNS = 8;
const MAX_TOOL_CALLS = 6;
const MAX_MAIN_AGENT_TURNS = 12;
const MAX_MAIN_AGENT_TOOL_CALLS = 6;
const CONFIRMATION_TTL_MS = 10 * 60 * 1000;
const encoder = new TextEncoder();
const journalContexts = new WeakMap<object, { threadId: string; turnId: string; taskId: string; operationId: string; runId: string }>();
const journalPending = new WeakMap<object, Promise<unknown>[]>();

function summarizePromptQuality(prompt: unknown) {
  const value = typeof prompt === 'string' ? prompt : '';
  const lines = value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const normalizedLines = lines.map((line) => line.toLowerCase().replace(/\s+/g, ' '));
  return {
    characterCount: value.length,
    paragraphCount: value.split(/\n\s*\n/).filter((paragraph) => paragraph.trim()).length,
    duplicateLineCount: normalizedLines.length - new Set(normalizedLines).size,
  };
}

function hashPrompt(value: unknown) {
  return createHash('sha256').update(String(value || ''), 'utf8').digest('hex');
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
  skillContentHash?: string;
  toolName: string;
  toolArgs: Record<string, unknown>;
  allowedTools: string[];
  userMessage: string;
  referenceImages: string[];
  canvasContext?: Record<string, unknown>;
  imageOptions?: AgentRequestBody['imageOptions'];
  imageCountSource?: AgentImageCountSource;
  promptOptimized?: boolean;
  requestedTotalImageCount?: number;
  imageBatchPlan?: AgentImageBatchPlan;
  nextConfirmationId?: string;
  imageBatchMode?: AgentImageBatchMode;
  imageDeliveryPlan?: ImageDeliveryPlan;
  generationItems?: AgentImageGenerationItem[];
  remainingGenerationItems?: AgentImageGenerationItem[];
  workingContext?: WorkingContext;
  imageTask?: AgentImageTask;
  visualContext?: Record<string, unknown>;
  presentation?: AgentPlanPresentation;
  publicProgress?: AgentPublicProgress;
  sessionId?: string;
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
  assetId?: string;
  referenceIds?: string[];
  targetReferenceId?: string | null;
  historyVersion?: number;
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

function lockedVisualIdentity(
  referenceContext: AgentRuntimeReferenceContext | undefined,
  toolArgs: Record<string, unknown> | undefined,
  historyVersion?: number,
) {
  const referenceIds = Array.from(new Set(
    (Array.isArray(toolArgs?.referenceIds) ? toolArgs.referenceIds : [])
      .map((value) => String(value).trim())
      .filter(Boolean),
  ));
  const targetReferenceId = typeof toolArgs?.targetReferenceId === 'string'
    ? toolArgs.targetReferenceId.trim() || null
    : null;
  const target = targetReferenceId || referenceIds[0] || '';
  const targetReference = referenceContext?.references.find((reference) => reference.id === target);
  return {
    ...(targetReference?.assetId ? { assetId: targetReference.assetId } : {}),
    referenceIds,
    targetReferenceId,
    ...(Number.isFinite(Number(historyVersion)) ? { historyVersion: Number(historyVersion) } : {}),
  };
}

type AgentImageCountSource = 'clarification' | 'prompt' | 'interface' | 'default' | 'batch';
type AgentImageBatchMode = 'series' | 'variants' | 'composite';
type ImageDeliveryPlan = ReturnType<typeof resolveImageDeliveryPlan>;
type SkillSelectionMethod = 'manual_ui' | 'manual_text' | 'model' | 'user_choice' | 'none';

type DirectImageExecutionContract = {
  operation: AgentImageTask['operation'];
  prompt: string;
  referenceIds: string[];
  targetReferenceId: string | null;
  outputCount: number;
  aspectRatio: string;
  deliveryMode: 'single' | AgentImageBatchMode;
  panelCount: number | null;
  items: Array<{ prompt: string }>;
};

// Main Agent's validated generate_image arguments are the production image contract.
type DirectImageExecutionState = {
  contract: DirectImageExecutionContract;
  imageTask: AgentImageTask;
  delivery: ImageDeliveryPlan;
  presentation: AgentPlanPresentation;
};

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
  previewSrc?: string;
  naturalWidth?: number;
  naturalHeight?: number;
  model?: string;
  itemId?: string;
  index?: number;
  label?: string;
  promptTrace?: AgentPromptTrace;
};

type AgentTaskSnapshot = {
  sessionId: string;
  taskId: string;
  operationId: string;
  lastSequence: number;
  contractVersion: number;
  contract?: AgentTaskContract;
  agentAnalysis?: AgentAnalysisSnapshot;
  editBaseVersionId?: string | null;
  latestBatchId?: string | null;
  activeVersions: AgentPendingAssetIdentity[];
};

type AgentRuntimeReferenceContext = {
  references: Array<{
    id: string;
    src: string;
    assetId?: string;
    originalSrc?: string;
    previewSrc?: string;
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
const persistApprovalSnapshot = (record: ConfirmationRecord | undefined) => {
  if (!record?.sessionId || !record.confirmationId) return;
  const snapshot = {
    confirmationId: record.confirmationId,
    sessionId: record.sessionId,
    taskId: record.taskId || null,
    operationId: record.operationId,
    runId: record.runId || null,
    toolName: record.toolName,
    status: record.status,
    lastSequence: record.lastSequence,
    expiresAt: record.expiresAt,
    ...(record.toolName === 'todo_update' ? {
      continuation: {
        toolName: record.toolName,
        toolArgs: { items: Array.isArray(record.toolArgs?.items) ? record.toolArgs.items.slice(0, 100) : [] },
        allowedTools: ['todo_update'],
        userMessage: record.userMessage.slice(0, 8000),
        confirmationId: record.confirmationId,
      },
    } : {}),
  };
  void updateThreadState(record.sessionId, { pendingApproval: snapshot });
};
const clearApprovalSnapshot = (record: ConfirmationRecord | undefined) => {
  if (record?.sessionId) void updateThreadState(record.sessionId, { pendingApproval: null });
};
class DurableConfirmationStore extends Map<string, ConfirmationRecord> {
  override set(key: string, value: ConfirmationRecord) {
    const result = super.set(key, value);
    persistApprovalSnapshot(value);
    return result;
  }
  override delete(key: string) {
    const record = this.get(key);
    const result = super.delete(key);
    clearApprovalSnapshot(record);
    return result;
  }
}
const confirmationStore = agentGlobals.__agentConfirmationStore || new DurableConfirmationStore();
agentGlobals.__agentConfirmationStore = confirmationStore;
const clarificationSubmissionStore = agentGlobals.__agentClarificationSubmissionStore || new Map<string, number>();
agentGlobals.__agentClarificationSubmissionStore = clarificationSubmissionStore;

function createTodoUpdateExecutor() {
  return async (args: Record<string, unknown>, context: Record<string, any>) => {
    const tools = createTodoTools({
      readThread: async (threadId: string) => loadThread(threadId),
      appendThreadEvent,
      authorizeTodoUpdate: async () => {
        if (context.confirmed !== true) {
          throw Object.assign(new Error('todo_update requires a single-use approval'), { statusCode: 409, code: 'approval_required' });
        }
        return { status: 'consumed', confirmationId: context.confirmationId || null };
      },
    });
    return tools.todo_update.execute(args, {
      ...context,
      threadId: context.threadId || context.sessionId,
      turnId: context.turnId,
      taskId: context.taskId,
      operationId: context.operationId,
      runId: context.runId,
      itemId: context.itemId || context.toolCallId,
      expectedSequence: Number.isSafeInteger(context.expectedSequence)
        ? context.expectedSequence
        : Number.isSafeInteger(context.lastSequence) ? context.lastSequence : 0,
    });
  };
}

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
    const previewSrc = typeof reference.previewSrc === 'string' ? reference.previewSrc.trim() : '';
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
      ...(typeof reference.assetId === 'string' && reference.assetId.trim() ? { assetId: reference.assetId.trim() } : {}),
      ...(typeof reference.originalSrc === 'string' && reference.originalSrc.trim() ? { originalSrc: reference.originalSrc.trim() } : {}),
      ...(previewSrc ? { previewSrc } : {}),
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
  clientRunId?: string;
  operationId?: string;
  sessionId?: string;
  messages?: Array<{ id?: string; role: 'user' | 'assistant'; content: string }>;
  sourceUserMessageId?: string;
  sourceAssistantMessageId?: string;
  recoveryTaskId?: string;
  activeSkillId?: string;
  intent?: 'chat' | 'image';
  referenceImages?: string[];
  referenceContext?: AgentRuntimeReferenceContext;
  contextEntities?: AgentContextEntity[];
  sessionVisualAssets?: SessionVisualAsset[];
  generatedImageHistory?: GeneratedImageHistoryEntry[];
  contextEvents?: ContextEvent[];
  contextHistory?: {
    schemaVersion?: number;
    auditEvents?: ContextEvent[];
    modelEvents?: ContextEvent[];
    compactionRecords?: Array<Record<string, unknown>>;
    activeWindow?: ContextWindowState;
    historyRevision?: number;
    userMessageRevision?: number;
    activeWindowRevision?: number;
  };
  /** Optimistic-concurrency token for the snapshot supplied by the client. */
  expectedHistoryRevision?: number;
  expectedUserMessageRevision?: number;
  expectedActiveWindowRevision?: number;
  activeContextWindow?: ContextWindowState;
  contextWindow?: number;
  selectedContextEntityIds?: string[];
  agentMemory?: AgentConversationMemory;
  recentFailedTask?: AgentRecoveryRecord | Record<string, unknown>;
  workingContext?: WorkingContext;
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
  confirmation?: {
    confirmationId?: string;
    toolName?: string;
    taskId?: string;
    operationId?: string;
    expectedSequence?: number;
  };
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

function canonicalLifecycleEvent(event: any, context: any) {
  const type = String(event?.type || '');
  if (event.channel === 'reasoning') return [];
  const base = {
    threadId: context.threadId,
    turnId: event.turnId || context.turnId,
    taskId: event.taskId || context.taskId,
    operationId: event.operationId || context.operationId,
    runId: event.runId || context.runId,
    timestampMs: Number(event.timestampMs) || Date.now(),
    ...(event.itemId ? { itemId: event.itemId } : {}),
    ...(event.toolCallId ? { toolCallId: event.toolCallId } : {}),
    ...(event.nativeThreadId ? { nativeThreadId: event.nativeThreadId } : {}),
    ...(event.nativeTurnId ? { nativeTurnId: event.nativeTurnId } : {}),
    ...(event.nativeItemId ? { nativeItemId: event.nativeItemId } : {}),
    ...(event.modelSampleIndex ? { modelSampleIndex: event.modelSampleIndex } : {}),
  };
  if (type === 'agent_start') return [{ type: 'thread.started', ...base }, { type: 'turn.started', ...base }];
  if (type === 'tool_start') return [{ type: 'item.started', itemType: 'tool_call', item: { toolName: event.toolName }, ...base }];
  if (type === 'tool_update') return [{ type: 'item.updated', itemType: 'tool_call', item: { message: event.message, toolName: event.toolName }, ...base }];
  if (type === 'tool_result') return [{ type: 'item.completed', itemType: 'tool_result', item: { result: event.result, error: event.error }, ...base }];
  if (type === 'assistant_delta' || type === 'agent_activity_delta') return [{ type: 'item.updated', itemType: type === 'agent_activity_delta' ? 'public_commentary' : 'assistant_message', ...base, itemId: event.itemId || event.activityId || `${context.runId}:assistant`, item: { delta: event.delta || event.content || '' } }];
  if (type === 'agent_done') return [{ type: 'turn.completed', usage: event.usage || null, stopReason: event.stopReason || null, ...base }];
  if (type === 'agent_error' || type === 'agent_cancelled') return [{ type: 'turn.failed', status: type === 'agent_cancelled' ? 'cancelled' : 'failed', error: {
    message: event.message || 'Agent run failed', code: event.code || null,
    failureStage: event.failureStage || event.stage, failureCode: event.failureCode || event.code,
    retryable: event.retryable === true, outcomeUnknown: event.outcomeUnknown === true,
  }, ...base }];
  if (type === 'confirmation_required' || type === 'clarification_required') return [{
    type: 'item.started',
    itemType: type === 'confirmation_required' ? 'confirmation' : 'clarification',
    item: {
      ...(event.request && typeof event.request === 'object' ? { request: event.request } : {}),
      ...(event.state && typeof event.state === 'object' ? { state: event.state } : {}),
      ...(event.message ? { message: event.message } : {}),
    },
    ...base,
  }];
  const publicKeys = [
    'type', 'content', 'delta', 'channel', 'model', 'error', 'message', 'stage',
    'reason', 'retryable', 'code', 'intent', 'summary', 'memory', 'label', 'index',
    'prompt', 'skillId', 'skill', 'source', 'stepId', 'phase', 'status', 'toolCallId',
    'toolName', 'isError', 'activityId', 'disposition', 'event', 'action', 'request',
    'state', 'result', 'proposal', 'entityIds', 'labels', 'kind', 'confidence',
    'resolvedEntityIds', 'mustPreserveCount', 'taskSnapshot', 'recoveryRecord',
    'parameters', 'title', 'operation', 'succeeded', 'failed', 'addedToCanvas',
    'stopReason',
  ];
  const payload = Object.fromEntries(publicKeys
    .filter((key) => Object.prototype.hasOwnProperty.call(event, key))
    .map((key) => [key, event[key]]));
  const publicItemId = event.itemId
    || (event.event && typeof event.event === 'object' && typeof event.event.eventId === 'string' ? event.event.eventId : '')
    || `${context.runId}:public:${type}:${event.sequence || event.timestampMs || Date.now()}`;
  return [{ type: 'item.updated', itemType: 'public_event', itemId: publicItemId, item: { eventType: type, payload }, ...base }];
}

function writeEvent(controller: ReadableStreamDefaultController, event: AgentEvent) {
  const context = journalContexts.get(controller as unknown as object);
  // Every production stream is journal-bound before execution starts. Never
  // fall back to emitting a producer event, otherwise replay and live traffic
  // would diverge back into two protocols.
  if (!context) return;
  const canonical = canonicalLifecycleEvent(event, context) || [];
  if (canonical.length === 0) return;
  const entries = canonical;
  const pending = journalPending.get(controller as unknown as object) || [];
  // Preserve producer order even when one notification expands into multiple events.
  const previous = pending.at(-1) || Promise.resolve();
  const task = entries.reduce((chain, entry) => chain.then(async () => {
    const persisted = await appendThreadEvent(context.threadId, entry);
    try { controller.enqueue(encoder.encode(`${JSON.stringify(persisted)}\n`)); } catch { /* HTTP disconnect does not cancel the journal-backed task. */ }
  }), previous.then(() => undefined));
  pending.push(task);
  journalPending.set(controller as unknown as object, pending);
  void task.catch(() => {
    try { controller.enqueue(encoder.encode(`${JSON.stringify({ type: 'error', code: 'journal_write_failed', message: 'Unable to persist agent event' })}\n`)); } catch { /* Connection is already closed. */ }
  });
}

function getLatestUserMessage(messages: AgentRequestBody['messages']) {
  return [...(messages || [])].reverse().find((message) => message.role === 'user')?.content?.trim() || '';
}

function summarizeThreadTranscript(state: Record<string, any>) {
  const boundary = Number.isSafeInteger(state.transcriptStartSequence) ? Math.max(0, state.transcriptStartSequence) : 0;
  const rows = (Array.isArray(state.turns) ? state.turns : [])
    .filter((turn) => turn.status === 'completed' && Number(turn.startSequence || 0) >= boundary)
    .flatMap((turn) => Array.isArray(turn.items) ? turn.items : [])
    .flatMap((item) => {
      if (item.type === 'todo_list') {
        const todos = (Array.isArray(item.items) ? item.items : []).map((todo) => `${todo.status === 'completed' ? '[x]' : '[ ]'} ${String(todo.content || '').trim()}`).filter(Boolean);
        return todos.length ? [`Todo: ${todos.join('; ')}`] : [];
      }
      if (!['user_message', 'assistant_message', 'public_commentary'].includes(item.type)) return [];
      const text = String(item.content || item.text || '').trim().replace(/\s+/g, ' ');
      if (!text) return [];
      return [`${item.type === 'user_message' ? 'User' : 'Assistant'}: ${text.slice(0, 800)}`];
    });
  const previous = typeof state.transcriptSummary === 'string' ? state.transcriptSummary.trim() : '';
  const body = [...(previous ? [`Previous summary: ${previous}`] : []), ...rows].join('\n').slice(-5600);
  return body ? `Conversation summary:\n${body}` : 'Conversation summary: no completed public conversation yet.';
}

async function handleManagementCommand(threadId: string, command: { name: string; args: string; raw: string }) {
  try {
    const loaded = await loadThread(threadId);
    let result: Record<string, unknown>;
    let transcriptBoundary: { summary: string | null; compacted: boolean } | null = null;
    if (command.name === 'status') {
      result = {
        threadId, threadStatus: loaded.state.threadStatus, archived: Boolean(loaded.state.archived),
        activeTurn: loaded.state.activeTurn, pendingApproval: loaded.state.pendingApproval || loaded.state.pendingDecision || null,
        lastSequence: loaded.state.lastSequence, turnCount: Array.isArray(loaded.state.turns) ? loaded.state.turns.length : 0,
        todoItems: loaded.state.todoItems || [],
      };
    } else if (command.name === 'history') {
      const options = parseHistoryCommandArgs(command.args);
      const history = await searchHistoryPages((pageOptions) => queryThread(threadId, pageOptions), options);
      result = {
        ...options, events: history.events,
        hasOlder: history.hasOlder, hasNewer: history.hasNewer, latestSequence: history.latestSequence,
      };
    } else if (command.name === 'fork') {
      const forked = await forkThread(threadId);
      result = { threadId: forked.threadId };
    } else if (command.name === 'archive') {
      if (loaded.state.activeTurn || loaded.state.pendingDecision || loaded.state.pendingApproval) {
        throw Object.assign(new Error('Cannot archive an active or waiting thread'), { code: 'thread_active', statusCode: 409 });
      }
      const state = await updateThreadState(threadId, { archived: true, threadStatus: 'archived' });
      result = { archived: true, threadId, threadStatus: state.threadStatus };
    } else if (command.name === 'resume') {
      const state = loaded.state.archived
        ? await updateThreadState(threadId, { archived: false, threadStatus: 'idle' })
        : loaded.state;
      result = { archived: false, threadId, threadStatus: state.threadStatus };
    } else if (command.name === 'clear') {
      if (loaded.state.activeTurn || loaded.state.pendingDecision || loaded.state.pendingApproval) {
        throw Object.assign(new Error('Cannot clear an active or waiting thread'), { code: 'thread_active', statusCode: 409 });
      }
      transcriptBoundary = { summary: null, compacted: false };
      result = { threadId, cleared: true };
    } else if (command.name === 'compact') {
      if (loaded.state.activeTurn || loaded.state.pendingDecision || loaded.state.pendingApproval) {
        throw Object.assign(new Error('Cannot compact an active or waiting thread'), { code: 'thread_active', statusCode: 409 });
      }
      transcriptBoundary = { summary: summarizeThreadTranscript(loaded.state), compacted: true };
      result = { threadId, compacted: true, summary: transcriptBoundary.summary };
    } else {
      throw Object.assign(new Error(`Unsupported command ${command.raw}`), { code: 'unknown_command', statusCode: 400 });
    }

    const operationId = `command-${randomUUID()}`;
    const runId = `command-run-${randomUUID()}`;
    const itemId = `command-item-${randomUUID()}`;
    const identity = { taskId: threadId, operationId, runId, itemId, scope: 'thread' };
    const events = [
      await appendThreadEvent(threadId, { type: 'item.started', itemType: 'command_result', ...identity, item: { command: command.name } }),
      await appendThreadEvent(threadId, { type: 'item.completed', itemType: 'command_result', ...identity, item: { command: command.name, result: command.name === 'history' ? { ...result, events: undefined, count: (result.events as unknown[]).length } : result } }),
    ];
    // History rows are returned once, not recursively embedded in their own journal.
    if (command.name === 'history') events[1] = { ...events[1], item: { command: command.name, result } };
    if (transcriptBoundary) {
      const state = await updateThreadState(threadId, {
        transcriptStartSequence: events[1].sequence + 1,
        transcriptSummary: transcriptBoundary.summary,
      });
      result = { ...result, transcriptStartSequence: state.transcriptStartSequence, ...(transcriptBoundary.summary ? { summary: transcriptBoundary.summary } : {}) };
      events[1] = { ...events[1], item: { command: command.name, result } };
    }
    return new Response(`${events.map((event) => JSON.stringify(event)).join('\n')}\n`, {
      status: 200, headers: { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-store' },
    });
  } catch (error) {
    const failure = commandErrorResponse(error);
    return NextResponse.json(failure.body, { status: failure.status });
  }
}

function normalizeRecentFailedTask(
  value: AgentRequestBody['recentFailedTask'],
  messages: AgentRequestBody['messages'],
) {
  if (!value || typeof value !== 'object') return null;
  const normalized = normalizeAgentRecoveryRecord(value);
  if (normalized) {
    const sourceExists = (messages || []).some((message) => message.role === 'user' && message.id === normalized.sourceUserMessageId);
    return sourceExists ? normalized : null;
  }
  return null;
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
        ...(typeof item.assetId === 'string' ? { assetId: item.assetId } : {}),
        ...(typeof item.previewSrc === 'string' ? { previewSrc: item.previewSrc } : {}),
        naturalWidth: item.naturalWidth,
        naturalHeight: item.naturalHeight,
      }));
  }
  const src = result.localUrl || result.data?.[0]?.url;
  return typeof src === 'string' ? [{ src, ...(typeof result.outputs?.[0]?.assetId === 'string' ? { assetId: result.outputs[0].assetId } : {}) }] : [];
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
          ...(typeof outputs[index]?.assetId === 'string' ? { assetId: outputs[index].assetId } : {}),
          ...(typeof outputs[index]?.slotId === 'string' ? { slotId: outputs[index].slotId } : {}),
          ...(typeof outputs[index]?.versionId === 'string' ? { versionId: outputs[index].versionId } : {}),
          ...(typeof outputs[index]?.parentVersionId === 'string' ? { parentVersionId: outputs[index].parentVersionId } : {}),
          ...(typeof outputs[index]?.previewSrc === 'string' ? { previewSrc: outputs[index].previewSrc } : {}),
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

function applyImageCountClarificationState(
  state: AgentClarificationState,
  request: AgentClarificationRequest,
  response: NonNullable<AgentRequestBody['clarificationResponse']>,
) {
  if (request.dimension === 'image_delivery_scope') {
    const selectedOptionId = typeof response.selectedOptionId === 'string' ? response.selectedOptionId : '';
    if (selectedOptionId === 'single_composite') {
      return {
        ...state,
        resolvedImageCount: 1,
        resolvedImageCountSource: 'clarification' as const,
        resolvedImageDeliveryMode: 'composite' as const,
      };
    }
    if (selectedOptionId === 'separate_outputs') {
      const count = Math.max(2, ...(state.pendingImageCountCandidates || [state.requestedImageCountTotal || 2]));
      return {
        ...state,
        resolvedImageCount: count,
        requestedImageCountTotal: count,
        resolvedImageCountSource: 'clarification' as const,
        resolvedImageDeliveryMode: 'variants' as const,
        resolvedImagePanelCount: undefined,
      };
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
    return {
      ...state,
      resolvedImageCount: AGENT_MAX_IMAGE_BATCH_COUNT,
      resolvedImageCountSource: 'clarification' as const,
      requestedImageCountTotal: AGENT_MAX_IMAGE_BATCH_COUNT,
      imageBatchPlan: undefined,
    };
  }
  const optionCount = selectedOptionId.startsWith('count_')
    ? positiveInteger(selectedOptionId.slice('count_'.length))
    : null;
  const customCount = parseClarifiedImageCount(response.customText);
  const resolvedCount = customCount || optionCount;
  if (!resolvedCount) return state;
  return {
    ...state,
    resolvedImageCount: resolvedCount,
    resolvedImageCountSource: 'clarification' as const,
    requestedImageCountTotal: resolvedCount,
    imageBatchPlan: undefined,
  };
}

function buildWorkingContext(userMessage: string, contextResolution?: AgentContextResolution): WorkingContext {
  const resolution = contextResolution?.status === 'resolved' ? contextResolution : null;
  return {
    version: 1,
    originalRequest: userMessage,
    resolvedEntityIds: resolution?.entityIds || [],
    resolvedLabels: resolution?.candidates.map((candidate) => candidate.label).filter(Boolean) || [],
    plainText: userMessage,
    mustPreserve: resolution?.candidates.flatMap((candidate) => candidate.mustPreserve || []) || [],
    referenceImageUrls: resolution?.candidates.flatMap((candidate) => candidate.referenceImageUrls || []) || [],
    canvasItemIds: resolution?.candidates.flatMap((candidate) => candidate.canvasItemIds || []) || [],
  };
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
  // only the fields needed by the execution contract and drop malformed
  // or unknown references before any downstream use.
  const runtimeReferenceContext = normalizeAgentRuntimeReferenceContext(body.referenceContext);

  const clientRunId = typeof body.clientRunId === 'string' && body.clientRunId.trim()
    ? body.clientRunId.trim()
    : null;
  if (clientRunId && clientRunId.length > 200) {
    return NextResponse.json({ error: 'clientRunId exceeds 200 characters', code: 'invalid_identity' }, { status: 400 });
  }
  const runId = randomUUID();
  const sessionId = typeof body.sessionId === 'string' ? body.sessionId.trim() : '';
  if (!sessionId || sessionId.length > 200) {
    return NextResponse.json({ error: 'sessionId is required', code: 'invalid_identity' }, { status: 400 });
  }
  const latestUserMessage = getLatestUserMessage(body.messages);
  const slashCommand = parseSlashCommand(latestUserMessage);
  if (slashCommand && !slashCommand.known) {
    return NextResponse.json({ error: `Unknown command ${slashCommand.raw}`, code: 'unknown_command', usage: commandUsage(slashCommand.name) }, { status: 400 });
  }
  if (slashCommand && isManagementCommand(slashCommand)) {
    return handleManagementCommand(sessionId, slashCommand);
  }
  let journalTurnId = runId;
  try {
    const thread = await loadThread(sessionId);
    if ((body.recoveryTaskId || body.clarificationState || body.confirmation) && !thread.state.nativeCodex) {
      return NextResponse.json({ error: '历史任务不支持原生运行时恢复，请新建请求；聊天和图片资产仍保留', code: 'history_not_resumable' }, { status: 409 });
    }
    if (thread.state.archived) {
      return NextResponse.json({ error: 'Thread is archived; unarchive before creating a turn', code: 'thread_archived' }, { status: 409 });
    }
    if (thread.state.activeTurn && !body.recoveryTaskId && !body.clarificationState && !body.confirmation) {
      return NextResponse.json({ error: 'Thread already has an active turn', code: 'turn_active', activeTurn: thread.state.activeTurn }, { status: 409 });
    }
    if (body.recoveryTaskId || body.clarificationState || body.confirmation) {
      const operation = body.operationId || body.confirmation?.operationId || body.clarificationState?.operationId;
      const turns = Array.isArray(thread.state.turns) ? thread.state.turns as Array<Record<string, any>> : [];
      const prior = turns.find((turn) => turn.operationId === operation);
      if (!prior || ['completed', 'running'].includes(prior.status) || (thread.state.activeTurn && thread.state.activeTurn !== prior.turnId)) {
        return NextResponse.json({ error: 'Continuation is stale', code: 'stale_operation' }, { status: 409 });
      }
      journalTurnId = prior.turnId;
    }
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to load thread', code: 'thread_unavailable' }, { status: 500 });
  }
  if (!latestUserMessage) {
    return NextResponse.json({ error: 'A user message is required' }, { status: 400 });
  }
  const conversationIntent = resolveAgentConversationIntent(
    body.messages,
    Boolean(body.referenceImages?.length),
  );
  const contextEntities = Array.isArray(body.contextEntities)
    ? body.contextEntities.filter((entity) => entity && typeof entity.id === 'string').slice(-200)
    : [];
  const sessionVisualAssets = normalizeSessionVisualAssets(
    body.sessionVisualAssets,
    { sessionId },
  );
  const contextEvents = Array.isArray(body.contextEvents)
    ? body.contextEvents.filter((event) => event.sessionId === sessionId)
    : [];
  const contextAuditEvents = Array.isArray(body.contextHistory?.auditEvents)
    ? body.contextHistory.auditEvents.filter((event) => event.sessionId === sessionId)
    : contextEvents;
  const contextModelEvents = Array.isArray(body.contextHistory?.modelEvents)
    ? body.contextHistory.modelEvents.filter((event) => event.sessionId === sessionId)
    : contextEvents;
  const normalizeRevision = (value: unknown, fallback = 0) => {
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? Math.floor(number) : fallback;
  };
  // Revisions are request-scoped optimistic concurrency tokens. The client
  // sends the last committed values; this run advances them only after the
  // request's user turn is accepted.
  const incomingHistoryRevision = normalizeRevision(body.contextHistory?.historyRevision, contextAuditEvents.length);
  const incomingUserMessageRevision = normalizeRevision(
    body.contextHistory?.userMessageRevision,
    contextAuditEvents.filter((event) => event?.type === 'user_text').length,
  );
  const incomingActiveWindowRevision = normalizeRevision(
    body.contextHistory?.activeWindowRevision,
    normalizeRevision(body.contextHistory?.activeWindow?.summaryVersion),
  );
  // Reject a request assembled from mixed/obsolete snapshots before starting
  // provider work. The server does not own IndexedDB session state, so the
  // client supplies the CAS token alongside the snapshot it read.
  const revisionChecks: Array<[string, unknown, number]> = [
    ['historyRevision', body.expectedHistoryRevision, incomingHistoryRevision],
    ['userMessageRevision', body.expectedUserMessageRevision, incomingUserMessageRevision],
    ['activeWindowRevision', body.expectedActiveWindowRevision, incomingActiveWindowRevision],
  ];
  for (const [name, expected, actual] of revisionChecks) {
    if (expected === undefined) continue;
    const normalizedExpected = Number(expected);
    if (!Number.isFinite(normalizedExpected) || normalizedExpected < 0 || Math.floor(normalizedExpected) !== normalizedExpected) {
      return NextResponse.json({ error: `Invalid expected ${name}`, code: 'invalid_revision' }, { status: 400 });
    }
    if (normalizedExpected !== actual) {
      return NextResponse.json({
        error: 'Session context revision conflict; reload the latest session and retry',
        code: 'revision_conflict',
        revision: { expected: normalizedExpected, actual, field: name },
      }, { status: 409 });
    }
  }
  const requestHistoryRevision = incomingHistoryRevision + 1;
  const requestUserMessageRevision = incomingUserMessageRevision + 1;
  const requestActiveWindowRevision = Math.max(incomingActiveWindowRevision, requestHistoryRevision);
  const persistedCompactedWindows = normalizeCompactedWindows(body.contextHistory?.compactionRecords, sessionId);
  // Lifecycle sequence numbers are scoped to a run, while replay events are
  // scoped to the session. Continue the latter from the persisted tail so a
  // new request cannot sort ahead of older context after a restart/retry.
  let nextContextSequence = contextAuditEvents.reduce((max, event) => {
    const sequence = Number(event?.sequence);
    return Number.isFinite(sequence) ? Math.max(max, Math.floor(sequence)) : max;
  }, 0);
  let replayContext: any = {
    sessionId,
    events: contextModelEvents,
    auditEvents: contextAuditEvents,
    modelEvents: contextModelEvents,
    visualAssets: sessionVisualAssets,
    compactedWindows: persistedCompactedWindows,
    compactionRecords: Array.isArray(body.contextHistory?.compactionRecords) ? body.contextHistory.compactionRecords : [],
    messages: body.messages,
    mergeMessages: true,
    activeWindow: body.contextHistory?.activeWindow && body.contextHistory.activeWindow.sessionId === sessionId
      ? body.contextHistory.activeWindow
      : body.activeContextWindow && body.activeContextWindow.sessionId === sessionId
        ? body.activeContextWindow
      : undefined,
    historyRevision: incomingHistoryRevision,
    userMessageRevision: incomingUserMessageRevision,
    activeWindowRevision: incomingActiveWindowRevision,
  };
  const generatedImageHistory = normalizeGeneratedImageHistory(body.generatedImageHistory)
    .filter((entry) => entry.sessionId === sessionId)
    .slice(0, 200);
  const knownContextEntityIds = new Set(contextEntities.map((entity) => entity.id));
  const knownVisualReferenceIds = new Set([
    ...knownContextEntityIds,
    ...(runtimeReferenceContext?.references || []).map((reference) => reference.id),
  ]);
  const normalizedRecentFailedTask = normalizeRecentFailedTask(body.recentFailedTask, body.messages)
    || normalizeRecentFailedTask(body.clarificationState?.recoveryRecord, body.messages);
  const recentFailedTask = normalizedRecentFailedTask
    && normalizedRecentFailedTask.sessionId === sessionId
    ? {
        ...normalizedRecentFailedTask,
        contextEntityIds: normalizedRecentFailedTask.contextEntityIds.filter((id) => knownContextEntityIds.has(id)),
        visualReferenceIds: normalizedRecentFailedTask.visualReferenceIds.filter((id) => knownVisualReferenceIds.has(id)),
      }
    : null;
  let initialAgentIdentity;
  try {
    initialAgentIdentity = resolveAgentIdentity({
      runId,
      continuation: body.recoveryTaskId
        ? recentFailedTask || undefined
        : body.clarificationState || undefined,
      operationId: body.operationId,
    });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Invalid Agent identity',
      code: 'invalid_identity',
    }, { status: 400 });
  }
  const continuationOperationId = body.recoveryTaskId
    ? recentFailedTask?.operationId
    : body.clarificationState?.operationId;
  if (body.operationId && continuationOperationId && body.operationId !== continuationOperationId) {
    return NextResponse.json({ error: 'Agent operation is stale', code: 'stale_operation' }, { status: 409 });
  }
  if (body.recoveryTaskId && recentFailedTask?.runId && recentFailedTask.runId === runId) {
    return NextResponse.json({ error: 'Agent runId has already been used', code: 'stale_operation' }, { status: 409 });
  }
  const requestedRecoveryTaskId = typeof body.recoveryTaskId === 'string' ? body.recoveryTaskId.trim().slice(0, 200) : '';
  if (requestedRecoveryTaskId && requestedRecoveryTaskId !== recentFailedTask?.taskId) {
    return NextResponse.json({ error: 'Recovery task is unknown, resolved, or belongs to another Topic' }, { status: 400 });
  }
  if (body.confirmation?.confirmationId) {
    pruneConfirmationStore();
    let confirmationRecord = confirmationStore.get(body.confirmation.confirmationId);
    if (!confirmationRecord) {
      const saved = await loadNativeConfirmation({ sessionId, confirmationId: body.confirmation.confirmationId });
      if (saved?.status === 'pending') {
        confirmationRecord = saved.parameters as ConfirmationRecord;
        confirmationStore.set(body.confirmation.confirmationId, confirmationRecord);
      }
    }
    if (!confirmationRecord || confirmationRecord.expiresAt <= Date.now()) {
      return NextResponse.json({ error: 'Confirmation is stale', code: 'stale_operation' }, { status: 409 });
    }
    try {
      if (body.confirmation.taskId && confirmationRecord.taskId) {
        assertSameAgentOperation(body.confirmation.taskId, confirmationRecord.taskId);
      }
      if (body.confirmation.operationId && confirmationRecord.operationId) {
        assertSameAgentOperation(body.confirmation.operationId, confirmationRecord.operationId);
      }
      if (Number.isFinite(Number(body.confirmation.expectedSequence))) {
        assertExpectedSequence(body.confirmation.expectedSequence, confirmationRecord.lastSequence);
      }
    } catch (error) {
      return NextResponse.json({
        error: error instanceof Error ? error.message : 'Confirmation is stale',
        code: (error as { code?: string })?.code || 'stale_operation',
      }, { status: 409 });
    }
  }
  if (body.clarificationResponse && body.clarificationRequest && body.clarificationState) {
    try {
      if (body.clarificationRequest.operationId && body.clarificationState.operationId) {
        assertSameAgentOperation(body.clarificationRequest.operationId, body.clarificationState.operationId);
      }
      if (Number.isFinite(Number(body.clarificationRequest.lastSequence))) {
        assertExpectedSequence(body.clarificationRequest.lastSequence, body.clarificationState.lastSequence || 0);
      }
    } catch (error) {
      return NextResponse.json({
        error: error instanceof Error ? error.message : 'Clarification is stale',
        code: (error as { code?: string })?.code || 'stale_operation',
      }, { status: 409 });
    }
  }
  let selectedContextEntityIds = Array.isArray(body.selectedContextEntityIds)
    ? body.selectedContextEntityIds.filter((id): id is string => typeof id === 'string').slice(0, 64)
    : [];
  const initialBriefSource = conversationIntent.brief || latestUserMessage;
  const rawUserCountResolution = extractAgentImageCount(latestUserMessage);
  const briefCountResolution = initialBriefSource === latestUserMessage
    ? rawUserCountResolution
    : extractAgentImageCount(initialBriefSource);
  const explicitBatchCountResolution = rawUserCountResolution.status !== 'none'
    ? rawUserCountResolution
    : briefCountResolution;
  const rawUserDeliveryPlan = resolveImageDeliveryPlan(latestUserMessage, rawUserCountResolution.count || 1);
  const briefDeliveryPlan = initialBriefSource === latestUserMessage
    ? rawUserDeliveryPlan
    : resolveImageDeliveryPlan(initialBriefSource, briefCountResolution.count || 1);
  const initialDeliveryPlan = rawUserDeliveryPlan.evidence.length > 0 ? rawUserDeliveryPlan : briefDeliveryPlan;
  const explicitBatchImageRequest = !body.activeSkillId
    && (
      conversationIntent.intent === 'image'
    )
    && initialDeliveryPlan.outputCount > 1;
  const shouldResolveInitialContext = (
    !explicitBatchImageRequest
    || selectedContextEntityIds.length > 0
    || isReferentialShorthand(latestUserMessage)
  );
  const initialContextResolution = shouldResolveInitialContext
    ? resolveContextReference({
        userMessage: latestUserMessage,
        entities: contextEntities,
        selectedEntityIds: selectedContextEntityIds,
      })
    : { status: 'none' as const, detected: false, confidence: 'none' as const, candidates: [], entityIds: [] };
  const initialWorkingContext = initialContextResolution.status === 'resolved'
    ? buildWorkingContext(latestUserMessage, initialContextResolution)
    : buildWorkingContext(body.workingContext?.plainText || initialBriefSource);
  const contextLogger = createLogger('api.agent.context', {
    source: 'server',
    route: '/api/agent',
    requestId: runId,
    sessionId,
    clientRunId,
  });

  let skillManifests;
  let skillCatalogLoaded = false;
  try {
    skillManifests = await listSkillManifests();
    skillCatalogLoaded = true;
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
  const requestedIntent: 'image' | null = body.intent === 'image' ? 'image' : null;
  // Image intent is decided by the Main Agent. The local layer only validates
  // the side-effect contract after the model requests generate_image.
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
      || causeCode === 'EPIPE'
      || message.includes('write epipe')
      || message === 'fetch failed';
  };
  const classifyAgentFailureCode = (error: unknown, stage: string) => {
    const value = error && typeof error === 'object' ? error as Record<string, unknown> : {};
    const explicit = typeof value.code === 'string' ? value.code : '';
    const failureCode = typeof value.failureCode === 'string' ? value.failureCode : '';
    if (/^[a-z][a-z0-9_]{1,100}$/.test(explicit)) return explicit;
    if (['provider_unavailable', 'provider_http', 'provider_timeout', 'transport', 'invalid_tool_arguments', 'decision_commentary_missing', 'empty_model_response'].includes(failureCode)) return failureCode;
    const message = error instanceof Error ? error.message.toLowerCase() : String(error || '').toLowerCase();
    if (message.includes('图片引用已失效') || message.includes('未知图片引用') || message.includes('unknown reference')) return 'invalid_reference';
    if (message.includes('no enabled channel for model') || message.includes('no available compatible accounts')) return 'provider_unavailable';
    if (message.includes('closing turn') || message.includes('terminal control') || String(stage) === 'terminal_contract') return 'terminal_contract';
    if (message.includes('budget exceeded') || message.includes('预算')) return 'budget_exceeded';
    if (message.includes('forbidden') || message.includes('unauthorized') || message.includes('upstream access')) return 'provider_http';
    if (message.includes('timeout') || message.includes('timed out') || message.includes('524')) return 'provider_timeout';
    if (message.includes('fetch failed') || message.includes('epipe') || message.includes('econnreset') || message.includes('connection')) return 'transport';
    if (message.includes('invalid') || message.includes('requires') || message.includes('must be')) return 'invalid_tool_arguments';
    if (isRetryablePlannerProviderError(error)) return message.includes('timeout') || message.includes('524') ? 'provider_timeout' : 'transport';
    if (Number(value.statusCode) >= 400) return Number(value.statusCode) >= 500 ? 'provider_http' : 'invalid_tool_arguments';
    return undefined;
  };
  // Main Agent lifetime is bounded by provider completion, protocol budgets, or user cancellation.
  const runController = new AbortController();
  const runSignal = runController.signal;
  registerActiveAgentRun(runId, initialAgentIdentity);
  registerActiveAgentRunControl(runId, { cancel: () => runController.abort() });
  updateActiveAgentRun(runId, { threadId: sessionId, turnId: journalTurnId });
  const stream = new ReadableStream({
    async start(controller) {
      journalContexts.set(controller as unknown as object, {
        threadId: sessionId,
        turnId: journalTurnId,
        taskId: initialAgentIdentity.taskId,
        operationId: initialAgentIdentity.operationId,
        runId,
      });
      let toolCalls = 0;
      let turns = 0;
      const taskId = initialAgentIdentity.taskId;
      const operationId = initialAgentIdentity.operationId;
      let skillSource: AgentSkillSource | null = body.activeSkillId ? 'manual_ui' : null;
      let intent: 'chat' | 'image' | 'skill_action' = 'chat';
      let selectedSkill = body.activeSkillId
        ? skillManifests.find((manifest) => manifest.id === body.activeSkillId) || null
        : null;
      let skillSelectionMethod: SkillSelectionMethod = body.activeSkillId ? 'manual_ui' : 'none';
      let skillCandidateIds: string[] = [];
      let skillContent = '';
      let skillContentHash = '';
      let imagegenHostContent = '';
      let imagegenHostContentHash = '';
      let imagegenSkillOriginalBytes = 0;
      let imagegenSkillInjectedBytes = 0;
      let visualSkillOriginalBytes = 0;
      let visualSkillInjectedBytes = 0;
      let skillContentTruncated = false;
      let imagegenLoaded = false;
      let visualSkillLoaded = false;
      let mainAgentRequestCount = 0;
      let directGenerateImageCall = false;
      let directGenerateImageCallId = '';
      let contextResolution = structuredClone(initialContextResolution) as AgentContextResolution;
      let workingContextData = structuredClone(initialWorkingContext) as WorkingContext;
      let workingContext = workingContextData.plainText;
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
      let stagedMainAgentMemoryPatches: any[] = [];
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
      // Persisted execution plans are not reactivated; every run enters Main Agent.
      let directImageExecution: DirectImageExecutionState | null = null;
      let lockedImageToolArgs: Record<string, unknown> | null = null;
      let nativeGeneratedImageResult: Record<string, unknown> | null = null;
      let nativeImageFailure: unknown = null;
      let approvedConfirmation: ConfirmationRecord | null = null;
      let executionKind: string | null = null;
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
      let agentAnalysis: AgentAnalysisSnapshot | null = activeClarificationState?.agentAnalysis
        || recoveryBaseRecord?.taskSnapshot?.agentAnalysis
        || null;
      let writeAgentAnalysisCheckpoint = () => {};
      let preserveRecoveryRecordOnFailure = false;
      let recoveryTaskIdForExecution: string | null = null;
      let recoveryMode: 'fill_missing' | 'redo_all' | null = null;
      let recoveryDecision: string | null = null;
      let recoveryRevisionMessage = '';
      const toolCallRecords: Array<{
        callId: string;
        attemptId: string;
        taskId: string;
        toolName: string;
        status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
        resultRef?: string | null;
        startedAt?: number;
        completedAt?: number;
      }> = [];
      const getTaskExecutionReservation = (runtime?: {
        kind: string;
        tool: string;
        imageTask?: AgentImageTask;
        outputCount?: number;
      }) => {
        if (taskExecutionReservation) return taskExecutionReservation;
        if (!directImageExecution && !runtime) return null;
        const contract = directImageExecution
          ? {
              intent: 'image',
              skillId: selectedSkill?.id || null,
              brief: {
                deliverable: 'image',
                subject: directImageExecution.contract.prompt,
                style: [],
                literalCopy: [],
                constraints: [],
              },
              delivery: {
                mode: directImageExecution.delivery.mode as AgentTaskContract['delivery']['mode'],
                outputCount: directImageExecution.contract.outputCount,
                panelCount: directImageExecution.delivery.panelCount || null,
                variationAxes: [],
                sharedInvariants: [],
                distinctPerItem: [],
                items: [],
              },
              imageTask: structuredClone(directImageExecution.imageTask),
              generation: null,
              execution: {
                kind: 'image_pipeline',
                requiresConfirmation: false,
                tool: 'generate_image',
              },
            } satisfies AgentTaskContract
          : {
              intent,
              skillId: selectedSkill?.id || null,
              brief: {
                deliverable: workingContext,
                subject: workingContext,
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
          directImageExecution?.imageTask || runtime?.imageTask,
          directImageExecution?.contract.outputCount || runtime?.outputCount || 1,
          runReferenceContext,
          recoveryTaskIdForExecution || taskId,
        );
        const reservation = taskExecutionReservation;
        const snapshotIdentity = progressTracker.snapshot();
        taskSnapshot = {
          sessionId,
          taskId: reservation.taskId,
          operationId: snapshotIdentity.operationId,
          lastSequence: snapshotIdentity.lastSequence,
          contractVersion: reservation.contractVersion,
          contract: structuredClone(reservation.contract),
          latestBatchId: reservation.latestBatchId,
          editBaseVersionId: reservation.editBaseVersionId,
          activeVersions: [],
        };
        taskSnapshot = emitTaskSnapshotCheckpoint(taskSnapshot);
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
        const snapshotIdentity = progressTracker.snapshot();
        taskSnapshot = {
          sessionId,
          taskId: reservation.taskId,
          operationId: snapshotIdentity.operationId,
          lastSequence: snapshotIdentity.lastSequence,
          contractVersion: reservation.contractVersion,
          contract: structuredClone(reservation.contract),
          editBaseVersionId: reservation.editBaseVersionId,
          latestBatchId: reservation.latestBatchId,
          activeVersions,
          ...(agentAnalysis ? { agentAnalysis: structuredClone(agentAnalysis) } : {}),
        };
        taskSnapshot = emitTaskSnapshotCheckpoint(taskSnapshot);
      };
      const writeAgentDone = (stopReason: string) => writeLifecycleEvent({
        type: 'agent_done',
        stopReason,
        ...(taskSnapshot ? { taskSnapshot: structuredClone(taskSnapshot) } : {}),
        ...progressTracker.stamp(),
      });
      const sourceUserMessageId = typeof body.sourceUserMessageId === 'string' && body.sourceUserMessageId.trim()
        ? body.sourceUserMessageId.trim().slice(0, 200)
        : [...body.messages].reverse().find((message) => message.role === 'user')?.id || `user-${runId}`;
      const rootTaskId = () => taskId;
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
        operationId: progressTracker.snapshot().operationId,
        lastSequence: progressTracker.snapshot().lastSequence,
        sessionId,
        sourceUserMessageId: rootSourceUserMessageId(),
        status,
        resumeRoute: resumeRoute === undefined
          ? stage === 'local_delivery'
            ? 'local_delivery'
            : intent === 'image' || intent === 'skill_action'
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
        skillContentHash: skillContentHash || recoveryBaseRecord?.skillContentHash || null,
        imageOperation: imageOperation || undefined,
        assetId: runReferenceContext?.references.find((reference) => reference.id === (targetReferenceId || ''))?.assetId
          || recoveryBaseRecord?.assetId
          || undefined,
        targetReferenceId: targetReferenceId || undefined,
        contextEntityIds: selectedContextEntityIds.length > 0
          ? selectedContextEntityIds
          : recoveryBaseRecord?.contextEntityIds || [],
        visualReferenceIds: runReferenceContext?.references.length
          ? runReferenceContext.references.map((reference) => reference.id)
          : recoveryBaseRecord?.visualReferenceIds || [],
        referenceContext: runReferenceContext || recoveryBaseRecord?.referenceContext,
        visualSummary: recoveryBaseRecord?.visualSummary,
        taskSnapshot: recoverySnapshot,
        mainAgentLoop: mainAgentFailureCheckpoint,
        toolCalls: toolCallRecords,
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
          sessionId,
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
        taskId: initialAgentIdentity.taskId,
        runId,
        operationId: initialAgentIdentity.operationId,
        lastSequence: initialAgentIdentity.lastSequence,
        emit: (event) => writeEvent(controller, event as AgentEvent),
      });
      const writeContextEvent = (event: unknown) => {
        const mapped = contextEventFromAgentEvent(event, { sessionId });
        const events = Array.isArray(mapped) ? mapped : mapped ? [mapped] : [];
        for (const contextEvent of events) {
          nextContextSequence += 1;
          writeEvent(controller, {
            type: 'context_event',
            event: {
              ...contextEvent,
              sequence: nextContextSequence,
              historyRevision: requestHistoryRevision,
              userMessageRevision: requestUserMessageRevision,
              activeWindowRevision: requestActiveWindowRevision,
            },
          } as AgentEvent);
        }
      };
      const writeUserContextEvent = () => {
        nextContextSequence += 1;
        writeEvent(controller, {
          type: 'context_event',
          event: {
            eventId: `${sessionId}:user:${sourceUserMessageId}`,
            sessionId,
            sequence: nextContextSequence,
            turnId: runId,
            timestampMs: Date.now(),
            type: 'user_text',
            source: 'request',
            content: latestUserMessage,
            historyRevision: requestHistoryRevision,
            userMessageRevision: requestUserMessageRevision,
            activeWindowRevision: requestActiveWindowRevision,
          },
        } as AgentEvent);
        const references = (runtimeReferenceContext?.references || []).filter((reference) => reference?.id && reference?.src);
        for (const reference of references) {
          nextContextSequence += 1;
          writeEvent(controller, {
            type: 'context_event',
            event: {
              eventId: `${sessionId}:image:${sourceUserMessageId}:${reference.id}`,
              sessionId,
              sequence: nextContextSequence,
              turnId: runId,
              timestampMs: Date.now(),
              type: 'image_input',
              source: reference.source || 'request',
              referenceId: reference.id,
              ...(reference.assetId ? { assetId: reference.assetId } : {}),
              ...(reference.src ? { src: reference.src } : {}),
              ...(reference.previewSrc ? { previewSrc: reference.previewSrc } : {}),
              role: reference.role,
              historyRevision: requestHistoryRevision,
              userMessageRevision: requestUserMessageRevision,
              activeWindowRevision: requestActiveWindowRevision,
            },
          } as AgentEvent);
        }
      };
      const writeLifecycleEvent = (event: unknown) => {
        if (!isAgentLifecycleEvent(event)) return writeEvent(controller, event as AgentEvent);
        const input = event as Record<string, unknown>;
        const currentIdentity = progressTracker.snapshot();
        if (typeof input.operationId === 'string' && input.operationId !== currentIdentity.operationId) {
          assertSameAgentOperation(currentIdentity.operationId, input.operationId);
        }
        const hasIdentity = typeof (event as any).taskId === 'string'
          && typeof (event as any).runId === 'string'
          && typeof (event as any).operationId === 'string'
          && Number.isFinite(Number((event as any).sequence));
        const stampedEvent = hasIdentity ? input as AgentEvent : { ...input, ...progressTracker.stamp() } as AgentEvent;
        writeEvent(controller, stampedEvent);
        writeContextEvent(stampedEvent);
        return undefined;
      };
      const emitTaskSnapshotCheckpoint = (snapshot: AgentTaskSnapshot) => {
        const identity = progressTracker.stamp();
        const checkpoint = {
          ...snapshot,
          operationId: identity.operationId,
          lastSequence: identity.sequence,
        };
        writeLifecycleEvent({
          type: 'agent_task_checkpoint',
          taskSnapshot: structuredClone(checkpoint),
          ...identity,
        });
        return checkpoint;
      };
      const takeDurableRunInputs = async (delivery: 'steer' | 'follow_up') => {
        const messages = takeActiveAgentRunInputs(runId, delivery);
        if (messages.length > 0) {
          await consumeThreadInputs(sessionId, { threadId: sessionId, turnId: journalTurnId, taskId, operationId, runId }, delivery);
        }
        return messages;
      };
      const getExternalSteeringMessages = () => takeDurableRunInputs('steer');
      const getExternalFollowUpMessages = () => takeDurableRunInputs('follow_up');
      const writeInteractionEvent = (event: unknown) => {
        const input = event as Record<string, unknown>;
        if (input.state && typeof input.state === 'object' && selectedSkill && skillContentHash) {
          input.state = { ...(input.state as Record<string, unknown>), skillContentHash };
        }
        const request = input.request && typeof input.request === 'object'
          ? input.request as Record<string, unknown>
          : undefined;
        const checkpoint = progressTracker.snapshot();
        const stamp = progressTracker.stamp();
        const identity = input.type === 'confirmation_required'
          ? String(request?.confirmationId || 'confirmation')
          : input.type === 'clarification_required'
            ? String(request?.id || 'clarification')
            : '';
        return writeLifecycleEvent({
          ...input,
          ...(request ? {
            request: {
              ...request,
              taskId: String(request.taskId || checkpoint.taskId),
              operationId: String(request.operationId || checkpoint.operationId),
              ...(input.type === 'confirmation_required'
                ? { expectedSequence: Number(request.expectedSequence ?? checkpoint.lastSequence) }
                : { lastSequence: Number(request.lastSequence ?? checkpoint.lastSequence) }),
            },
          } : {}),
          ...(identity && (input.type === 'confirmation_required' || input.type === 'clarification_required')
            ? { itemId: `${runId}:${input.type === 'confirmation_required' ? 'approval' : 'clarification'}:${identity}` }
            : {}),
          ...stamp,
        } as AgentEvent);
      };
      const toolItemId = (toolCallId: string) => `${runId}:tool:${toolCallId}`;
      const toolExecutionId = (toolCallId: string) => `${runId}:execution:${toolCallId}`;
      const announcedToolStarts = new Set<string>();
      let activeAgentStageLabel = '正在分析当前请求';
      let lastModelTaskDescription = '';
      let activeAgentStage: { label: string; phase: AgentProgressPhase; action: string; toolName?: string; toolCallId?: string } = {
        label: activeAgentStageLabel,
        phase: 'analyzing',
        action: 'analyze_request',
      };
      const toolActionLabel = (toolName: string) => ({
        read_relevant_context: '正在读取相关上下文',
        load_visual_reference: '正在加载视觉参考',
        submit_agent_analysis_checkpoint: '正在整理当前任务结论',
        generate_image: '正在整理图片合同',
      } as Record<string, string>)[toolName] || `正在执行 ${toolName}`;
      const toolActionCode = (toolName: string) => ({
        read_relevant_context: 'read_context',
        load_visual_reference: 'load_visual_reference',
        submit_agent_analysis_checkpoint: 'analysis_checkpoint',
        generate_image: 'resolve_image_contract',
      } as Record<string, string>)[toolName] || toolName;
      const toolEventMetadata = (toolCallId: string) => ({
        itemId: toolItemId(toolCallId),
        executionId: toolExecutionId(toolCallId),
        ...(lastCommentaryItemId ? { parentItemId: lastCommentaryItemId } : {}),
      });
      const writeToolStartEvent = (
        toolCallId: string,
        toolName: string,
        args: Record<string, unknown> = {},
        turnMetadata: Record<string, unknown> = {},
      ) => {
        const key = `${toolCallId}:${toolName}`;
        if (announcedToolStarts.has(key)) return;
        announcedToolStarts.add(key);
        writeProgress({
          stepId: toolName === 'generate_image' ? 'generate_image' : 'tool',
          phase: toolName === 'generate_image' ? 'checking' : 'reading',
          status: 'active',
          label: lastModelTaskDescription || toolActionLabel(toolName),
          action: toolActionCode(toolName),
          toolCallId,
          toolName,
        });
        writeLifecycleEvent({
          type: 'tool_start',
          toolCallId,
          toolName,
          arguments: args,
          ...turnMetadata,
          action: toolActionCode(toolName),
          ...toolEventMetadata(toolCallId),
          ...progressTracker.stamp(),
        });
      };
      const writeProgress = (input: {
        stepId: AgentProgressStepId;
        phase: AgentProgressPhase;
        status: AgentProgressStatus;
        label: string;
        toolCallId?: string;
        toolName?: string;
        itemId?: string;
        executionId?: string;
        parentItemId?: string;
        retryability?: 'retryable' | 'requires_change' | 'unknown';
        detail?: string;
        completionSummary?: string;
        action?: string;
        agentTurnId?: string;
        parentTurnId?: string;
        modelSampleIndex?: number;
        nextSampleReason?: string;
        retryAttempt?: number;
        failureStage?: string;
        failureCode?: string;
      }) => {
        if (input.status === 'active' && input.label) {
          activeAgentStageLabel = input.label;
          activeAgentStage = {
            label: input.label,
            phase: input.phase,
            action: input.action || activeAgentStage.action,
            ...(input.toolName ? { toolName: input.toolName } : {}),
            ...(input.toolCallId ? { toolCallId: input.toolCallId } : {}),
          };
        }
        return progressTracker.update({
          ...input,
          ...(input.toolCallId ? toolEventMetadata(input.toolCallId) : {}),
          ...(input.action ? { action: input.action } : {}),
        });
      };
      const startMainAgentKeepalive = () => startAgentImageGenerationHeartbeat({
        intervalMs: 10_000,
        onPulse: (elapsedMs) => {
          if (runSignal.aborted) return;
          writeProgress({
            stepId: 'agent_analysis',
            phase: activeAgentStage.phase,
            status: 'active',
            label: activeAgentStage.label,
            action: activeAgentStage.action,
            ...(activeAgentStage.toolName ? { toolName: activeAgentStage.toolName } : {}),
            ...(activeAgentStage.toolCallId ? { toolCallId: activeAgentStage.toolCallId } : {}),
            detail: `已等待 ${Math.round(elapsedMs / 1000)} 秒`,
          });
          void contextLogger.info('main_agent.keepalive', 'Main Agent request is still active', {
            runId,
            taskId,
            attemptId: runId,
            toolCallId: directGenerateImageCallId || null,
            stage: 'main_agent',
            aborted: runSignal.aborted,
            elapsedMs,
          });
        },
      });
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
        skillContentHash = createHash('sha256').update(skillContent).digest('hex');
        const savedContentHash = activeClarificationState?.skillContentHash
          || recoveryBaseRecord?.skillContentHash;
        if (savedContentHash && savedContentHash !== skillContentHash) {
          throw new Error('The locked Skill content changed after this task was created');
        }
        return skillContent;
      };
      const ensureImagegenHostContent = async () => {
        if (imagegenHostContent) return imagegenHostContent;
        imagegenHostContent = await loadSkillContent(IMAGEGEN_HOST_SKILL_ID, { includeInternal: true });
        imagegenHostContentHash = createHash('sha256').update(imagegenHostContent).digest('hex');
        return imagegenHostContent;
      };
      const assertLockedImageSkill = async (skill: typeof selectedSkill, expectedHash?: string | null) => {
        if (!skill) return '';
        if (skill.executionMode !== 'image_pipeline' || !skill.allowedTools.includes('generate_image')) {
          throw new Error('The locked Skill is not allowed to generate images');
        }
        const content = await loadSkillContent(skill.id);
        const contentHash = createHash('sha256').update(content).digest('hex');
        if (expectedHash && expectedHash !== contentHash) {
          throw new Error('The locked Skill content changed after this task was created');
        }
        return contentHash;
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
      let currentActivity: { activityId: string; text: string; taskId?: string; runId?: string; operationId?: string; sequence?: number; timestampMs?: number } | null = null;
      let lastCommentaryItemId = '';
      let finalAssistantTextEmitted = false;
      let hasMutationEvidence = false;
      const handledAssistantTurnKeys = new Set<string>();
      const handledAssistantMessages = new WeakSet<object>();
      const appendActivityText = (activityId: string, delta: string) => {
        if (!delta) return;
        const stamp = currentActivity?.sequence
          ? {
              taskId: currentActivity.taskId,
              runId: currentActivity.runId,
              operationId: currentActivity.operationId,
              sequence: currentActivity.sequence,
              timestampMs: currentActivity.timestampMs,
            }
          : progressTracker.stamp();
          currentActivity = {
          activityId,
          text: `${currentActivity?.text || ''}${delta}`,
          ...stamp,
        };
        writeLifecycleEvent({
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
          if (disposition === 'commentary') lastModelTaskDescription = currentActivity.text.trim();
          lastCommentaryItemId = `commentary:${runId}:${activityId}`;
          writeLifecycleEvent({
            type: 'agent_activity_commit',
            activityId,
            disposition: disposition || (message?.stopReason === 'error' || message?.stopReason === 'aborted' ? 'commentary' : 'final'),
            ...(disposition === 'commentary' ? { commentaryKind: 'model_task_description' } : {}),
            ...(currentActivity.sequence ? {
              taskId: currentActivity.taskId,
              runId: currentActivity.runId,
              operationId: currentActivity.operationId,
              sequence: currentActivity.sequence,
              timestampMs: currentActivity.timestampMs,
            } : progressTracker.stamp()),
          });
        }
        currentActivity = null;
      };
      const writeToolUpdateEvent = (id: string, message: string) => writeLifecycleEvent({
        type: 'tool_update',
        toolCallId: id,
        message,
        ...toolEventMetadata(id),
        ...progressTracker.stamp(),
      } as AgentEvent);
      const writeToolResultEvent = (id: string, name: string, result: unknown, isError = false) => {
        const metadata = toolEventMetadata(id);
        lastCommentaryItemId = '';
        return writeLifecycleEvent({
          type: 'tool_result',
          toolCallId: id,
          toolName: name,
          result,
          isError,
          ...metadata,
          ...progressTracker.stamp(),
        } as AgentEvent);
      };
      const noteToolResult = (name: string, isError = false) => {
        if (!isError && name === 'generate_image') hasMutationEvidence = true;
      };
      const writeStampedAgentEvent = (event: any) => {
        writeLifecycleEvent(event as AgentEvent);
      };
      const writeToolProgress = (
        toolName: string,
        status: 'pending' | 'active' | 'waiting' | 'completed' | 'failed',
        toolCallId: string,
        detail = '',
      ) => {
        updateActiveAgentRun(runId, {
          phase: status === 'waiting' ? 'waiting' : status === 'active' ? 'executing' : 'reasoning',
          nonInterruptible: status === 'active' && toolName === 'generate_image',
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
          request_context_selection: {
            stepId: 'tool',
            phase: 'waiting_input',
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
          load_visual_reference: '加载视觉参考',
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
      const generateImagePayload = async (
        finalPromptSource: string,
        imageOptions = body.imageOptions,
        referenceImages = body.referenceImages,
        countMetadata?: { source?: AgentImageCountSource; totalCount?: number; promptOptimized?: boolean },
        generationItems: AgentImageGenerationItem[] = [],
        streamOptions?: { enabled?: boolean; toolCallId?: string },
        deliveryPlan?: ImageDeliveryPlan,
        imageTask: AgentImageTask | undefined = directImageExecution?.imageTask,
        visualContext: Record<string, unknown> | undefined = undefined,
        presentation: AgentPlanPresentation | undefined = directImageExecution?.presentation,
        referenceContext: AgentRuntimeReferenceContext | undefined = runReferenceContext,
        resolvedImageSelectionOverride?: { providerId: string; model: string },
      ) => {
        // Side effects must not cross an uncommitted lifecycle checkpoint.
        await Promise.all(journalPending.get(controller as unknown as object) || []);
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
        const finalGenerationPrompt = String(finalPromptSource || '').trim();
        if (!finalGenerationPrompt) throw new Error('Main Agent returned an empty image prompt');
        const finalPromptHash = hashPrompt(finalGenerationPrompt);
        // The direct tool contract (or its saved confirmation metadata) owns
        // output count. UI options provide a request-scoped fallback.
        const payloadOutputCount = positiveInteger(countMetadata?.totalCount)
          || normalizeAgentImageCount(imageOptions?.count);
        const payloadDeliveryPlan = deliveryPlan
          || resolveImageDeliveryPlan(finalGenerationPrompt, payloadOutputCount);
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
          prompt: finalGenerationPrompt,
          generationPrompts: effectiveGenerationItems.map((item) => item.prompt),
          linkedImagePreviews: resolvedReferences.linkedImagePreviews,
          referenceIds: resolvedReferences.referenceIds,
          providerId: resolvedImageSelection.providerId,
          modelId: resolvedImageSelection.model,
          allowedModelIds,
          providerImageOptionProfiles,
          contractAspectRatio: typeof imageOptions?.aspectRatio === 'string' ? imageOptions.aspectRatio : undefined,
          selectedAspectRatio: imageOptions?.aspectRatio,
          requestedSize: imageOptions?.size,
          requestedQuality: imageOptions?.quality,
          requestedCount: payloadOutputCount,
        });
        if (requests.length === 0) throw new Error('Image generation request is empty');
        if (requests.length !== payloadOutputCount) {
          throw new Error(`图片请求数量不一致：要求 ${payloadOutputCount} 张，实际创建 ${requests.length} 个任务。`);
        }
        if (requests.some((request) => Number(request?.n) !== 1)) {
          throw new Error('批量图片请求必须拆分为独立的 n:1 任务。');
        }
        requests.forEach((request, index) => {
          const supplierPrompt = String(request.messages?.[0]?.content || '');
          const expectedPrompt = effectiveGenerationItems[index]?.prompt || finalGenerationPrompt;
          if (supplierPrompt !== expectedPrompt) {
            throw new Error('图片供应商 Prompt 与 Main Agent 工具 Prompt 不一致');
          }
        });
        const heartbeatToolCallId = streamOptions?.toolCallId;
        const imageProgress = (heartbeatToolCallId ? publicProgressByToolCallId.get(heartbeatToolCallId) : undefined)
          || imagePublicProgress;
        const imageProgressToolCallId = heartbeatToolCallId || directGenerateImageCallId || undefined;
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
            promptHash: hashPrompt(prompt),
            ...(heartbeatToolCallId ? {
              toolCallId: heartbeatToolCallId,
              completedLabel: imageProgress?.promptPreparation?.completedLabel,
              completionSummary: imageProgress?.promptPreparation?.completionSummary,
            } : {}),
            ...progressTracker.stamp(),
          });
        });
        void contextLogger.info('image.requests_built', 'Agent image requests built', {
          skillCatalogLoaded,
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
          imagegenLoaded,
          visualSkillLoaded,
          skillRead: Boolean(imagegenLoaded && (!selectedSkill || visualSkillLoaded)),
          selectedSkillId: selectedSkill?.id || null,
          skillSelectionSource: skillSelectionMethod,
          skillContentLength: skillContent.length,
          skillContentHash: skillContentHash || null,
          mainAgentRequestCount,
          directGenerateImageCall,
          attemptId: runId,
          toolCallId: streamOptions?.toolCallId || directGenerateImageCallId || null,
          recoveryMode,
          recoveryDecision,
          providerCalled: false,
          providerReceivedImage: requests.some((request) => Array.isArray((request as any)?.reference_images)
            && (request as any).reference_images.some((src: unknown) => typeof src === 'string' && src.trim())),
          imageRecoverySource: resolvedReferences.referenceIds.length > 0 ? 'resolved_visual_reference' : null,
          finalPromptLength: finalGenerationPrompt.length,
          finalPromptHash,
          supplierPromptHash: hashPrompt(requests[0]?.messages?.[0]?.content || ''),
        });
        const executionMode = resolveCanvasImageTaskExecutionMode({
          modelId: resolvedImageSelection.model,
          size: resolvedImageOptions.size,
          count: resolvedImageOptions.count,
        });
        const streamIncrementally = streamOptions?.enabled === true && requests.length > 1;
        const providerReceivedImage = requests.some((request) => Array.isArray((request as any)?.reference_images)
          && (request as any).reference_images.some((src: unknown) => typeof src === 'string' && src.trim()));
        let providerCalled = false;
        const promptWasOptimized = countMetadata?.promptOptimized ?? false;
        const promptTraceForRequest = (requestIndex: number) => ({
          sourcePrompt: finalGenerationPrompt,
          finalPrompt: String(requests[requestIndex]?.messages?.[0]?.content || ''),
          sourcePromptHash: finalPromptHash,
          finalPromptHash: hashPrompt(requests[requestIndex]?.messages?.[0]?.content || ''),
          supplierPromptHash: hashPrompt(requests[requestIndex]?.messages?.[0]?.content || ''),
          optimized: promptWasOptimized,
          operation: imageTask?.operation || 'generate' as const,
          targetReferenceId: imageTask?.targetReferenceId || null,
          skillId: selectedSkill?.id || null,
          skillRead: Boolean(imagegenLoaded && (!selectedSkill || visualSkillLoaded)),
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
            const requestIndex = requests.indexOf(requestBody as typeof requests[number]);
            const slot = taskReservation?.identities[requestIndex]?.slotId || String(requestIndex);
            const recorded = await executeNativeBusinessOperation({
              sessionId, taskId: taskReservation?.taskId || rootTaskId(),
              operationId: `${operationId}:image:${slot}`, runId, signal: runSignal,
              contract: { request: requestBody, skillId: selectedSkill?.id || null, skillContentHash },
            }, async () => {
            providerCalled = true;
            if (heartbeatToolCallId || directGenerateImageCallId) {
              writeProgress({
                stepId: 'generate_image',
                phase: 'generating',
                status: 'active',
                label: '正在调用图片供应商',
                toolCallId: heartbeatToolCallId || directGenerateImageCallId || undefined,
                toolName: 'generate_image',
              });
            }
            void contextLogger.info('image.execution_checkpoint', 'Dispatching image request to local generate route', {
              runId,
              taskId: taskReservation?.taskId || taskId,
              attemptId: runId,
              toolCallId: heartbeatToolCallId || directGenerateImageCallId || null,
              stage: 'supplier_dispatch_start',
              aborted: runSignal.aborted,
              promptHash: hashPrompt(String((requestBody as any)?.messages?.[0]?.content || '')),
              providerCalled,
              providerReceivedImage,
            });
            const generationRequest = new NextRequest(new URL('/api/generate', request.url), {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'x-z-flow-image-agent': '1',
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
            if (heartbeatToolCallId || directGenerateImageCallId) {
              writeProgress({
                stepId: 'generate_image',
                phase: 'generating',
                status: 'active',
                label: '正在解析图片结果',
                toolCallId: heartbeatToolCallId || directGenerateImageCallId || undefined,
                toolName: 'generate_image',
              });
            }
            void contextLogger.info('image.execution_checkpoint', 'Local generate route returned', {
              runId,
              taskId: taskReservation?.taskId || taskId,
              attemptId: runId,
              toolCallId: heartbeatToolCallId || directGenerateImageCallId || null,
              stage: 'supplier_dispatch_complete',
              aborted: runSignal.aborted,
              status: generationResponse.status,
              completed: generationPayload?.status === 'completed',
            });
            if (!generationResponse.ok || generationPayload?.status !== 'completed') {
              throw Object.assign(new Error(generationPayload?.error || `Image generation failed (${generationResponse.status})`), {
                code: generationPayload?.code || 'image_provider_failed',
                failureStage: generationPayload?.failureStage || 'image_provider',
                retryable: generationPayload?.isRetryable === true,
                outcomeUnknown: generationPayload?.outcomeUnknown === true,
              });
            }
            const submittedPrompt = String((requestBody as any)?.messages?.[0]?.content || '');
            const observedPrompt = generationPayload?.result?.analyzedPrompt;
            if (typeof observedPrompt === 'string' && observedPrompt !== submittedPrompt) {
              throw new Error('供应商回执 Prompt 与 Main Agent Prompt 不一致');
            }
            void contextLogger.info('image.supplier_prompt_provenance', 'Verified supplier received the Main Agent Prompt', {
              finalPromptHash: hashPrompt(submittedPrompt),
              supplierPromptHash: typeof generationPayload?.result?.supplierPromptHash === 'string'
                ? generationPayload.result.supplierPromptHash
                : hashPrompt(observedPrompt || submittedPrompt),
            });
            return { assets: generatedAssetsFromResult(generationPayload), payload: generationPayload };
            });
            return recorded.payload;
          },
            onSettled: streamIncrementally
            ? async (result: PromiseSettledResult<any>, requestIndex: number) => {
                streamedSettled += 1;
                if (result.status === 'rejected') {
                  streamedFailed += 1;
                } else {
                  let assets = generatedAssetsFromResult(result.value);
                  if (assets.length > 0) {
                    streamedSucceeded += 1;
                    writeProgress({
                      stepId: 'generate_image',
                      phase: 'executing',
                      status: 'active',
                      label: '正在保存图片资产',
                      ...(imageProgressToolCallId ? { toolCallId: imageProgressToolCallId } : {}),
                      toolName: 'generate_image',
                    });
                    const item = effectiveGenerationItems[requestIndex];
                    const identity = taskReservation?.identities[requestIndex];
                    const persistedAssets = await Promise.all(assets.map((asset) => materializeSessionVisualAsset({
                      sessionId,
                      source: {
                        src: asset.src,
                        source: 'generated',
                        sourceReferenceId: outputSourceReferenceId,
                        taskId: taskReservation?.taskId,
                        batchId: identity?.batchId,
                        versionId: identity?.versionId,
                        previewSrc: asset.previewSrc || asset.src,
                      },
                    })));
                    assets = assets.map((asset, index) => ({
                      ...asset,
                      src: persistedAssets[index].durableSrc,
                      previewSrc: persistedAssets[index].previewSrc || persistedAssets[index].durableSrc,
                      assetId: persistedAssets[index].id,
                    }));
                    writeEvent(controller, {
                      type: 'client_action',
                      action: {
                        type: 'register_session_visual_assets',
                        sessionId,
                        assets: persistedAssets.map((asset) => ({ ...asset, sessionId })),
                      },
                    });
                    if (identity) recordSucceededTaskIdentities([{
                      ...identity,
                      assetUrl: assets[0]?.src,
                      previewSrc: assets[0]?.src,
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
                          ...(asset.assetId ? { assetId: asset.assetId } : {}),
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
                            previewSrc: asset.src,
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
                    writeContextEvent({
                      type: 'client_action',
                      action: {
                        type: 'add_generated_assets',
                        taskId: taskReservation?.taskId,
                        batchId: identity?.batchId,
                        assets: assets.map((asset) => ({
                          src: asset.src,
                          assetId: asset.assetId,
                          previewSrc: asset.previewSrc,
                          versionId: identity?.versionId,
                        })),
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
        } catch (error) {
          void contextLogger.warn('image.execution_failed', 'Image execution stopped before delivery', {
            runId,
            taskId: taskReservation?.taskId || taskId,
            providerCalled,
            providerReceivedImage,
            failureReason: error instanceof Error ? error.message : String(error),
            imageRecoverySource: resolvedReferences.referenceIds.length > 0 ? 'resolved_visual_reference' : null,
          });
          throw error;
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
              previewSrc: asset.src,
            } : {}),
          }))
        ));
        if (assets.length === 0) throw new Error('Image generation returned no usable assets');
        const durableAssets = await Promise.all(assets.map(async (asset) => {
          writeProgress({
            stepId: 'generate_image',
            phase: 'executing',
            status: 'active',
            label: '正在保存图片资产',
            ...(imageProgressToolCallId ? { toolCallId: imageProgressToolCallId } : {}),
            toolName: 'generate_image',
          });
          const persisted = await materializeSessionVisualAsset({
            sessionId,
            source: {
              src: asset.src,
              source: 'generated',
              sourceReferenceId: outputSourceReferenceId,
              taskId: taskReservation?.taskId,
              batchId: taskReservation?.latestBatchId,
              versionId: asset.versionId,
              previewSrc: asset.previewSrc || asset.src,
            },
          });
          return { ...asset, ...persisted, src: persisted.durableSrc, previewSrc: persisted.previewSrc || persisted.durableSrc, assetId: persisted.id };
        }));
        writeEvent(controller, {
          type: 'client_action',
          action: {
            type: 'register_session_visual_assets',
            sessionId,
            assets: durableAssets.map((asset) => ({
              id: asset.assetId,
              sessionId,
              durableSrc: asset.src,
              previewSrc: asset.previewSrc,
              originalSrc: asset.originalSrc,
              contentHash: asset.contentHash,
              mimeType: asset.mimeType,
              byteSize: asset.byteSize,
              source: 'generated',
              ...(outputSourceReferenceId ? { sourceReferenceId: outputSourceReferenceId } : {}),
              ...(taskReservation?.taskId ? { taskId: taskReservation.taskId } : {}),
              ...(taskReservation?.latestBatchId ? { batchId: taskReservation.latestBatchId } : {}),
              ...(asset.versionId ? { versionId: asset.versionId } : {}),
              createdAt: Date.now(),
            })),
          },
        });
        recordSucceededTaskIdentities(usableTaskResults.flatMap(({ assets: requestAssets }, requestIndex) => {
          const identity = taskReservation?.identities[requestIndex];
          const asset = requestAssets[0];
          const item = effectiveGenerationItems[requestIndex];
          return asset && identity ? [{
            ...identity,
            assetUrl: durableAssets[requestIndex]?.src || asset.src,
            previewSrc: durableAssets[requestIndex]?.previewSrc || asset.previewSrc || asset.src,
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
            outputs: assets.map((asset, index) => ({
              localUrl: durableAssets[index]?.src || asset.src,
              assetId: durableAssets[index]?.assetId,
              naturalWidth: asset.naturalWidth,
              naturalHeight: asset.naturalHeight,
              promptTrace: asset.promptTrace,
              ...(asset.slotId ? { slotId: asset.slotId } : {}),
              ...(asset.versionId ? { versionId: asset.versionId } : {}),
              ...(asset.parentVersionId ? { parentVersionId: asset.parentVersionId } : {}),
              ...(durableAssets[index]?.previewSrc || asset.previewSrc ? { previewSrc: durableAssets[index]?.previewSrc || asset.previewSrc } : {}),
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
          writeToolUpdateEvent(toolCallId, message);
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
        writeLifecycleEvent({
          type: 'agent_completion_summary',
          ...progressTracker.stamp(),
          title: String(presentation.title),
          summary,
          operation: presentation.operation === 'edit' ? 'edit' : 'generate',
          succeeded,
          failed,
          addedToCanvas: true,
        });
      };
      try {
        writeUserContextEvent();
        writeLifecycleEvent({ type: 'agent_start', runId, ...progressTracker.stamp() });
        const requestedConfirmationId = body.confirmation?.confirmationId;
        if (requestedConfirmationId) {
          approvedConfirmation = confirmationStore.get(requestedConfirmationId) || null;
          if (!approvedConfirmation || approvedConfirmation.sessionId !== sessionId) {
            throw new Error("Confirmation is unavailable for this session");
          }
          claimConfirmationContinuation({ record: approvedConfirmation,
            requestedToolName: body.confirmation?.toolName, userMessage: latestUserMessage, providers });
          await claimNativeConfirmation({ sessionId, confirmationId: requestedConfirmationId,
            runId, contract: approvedConfirmation.toolArgs });
          selectedSkill = approvedConfirmation.skillId
            ? skillManifests.find((skill) => skill.id === approvedConfirmation!.skillId) || null : null;
          if (approvedConfirmation.skillId && !selectedSkill) throw new Error("Confirmed Skill is unavailable");
          skillSource = approvedConfirmation.skillSource;
          body.activeSkillId = selectedSkill?.id;
          body.imageOptions = approvedConfirmation.imageOptions || body.imageOptions;
          runReferenceContext = approvedConfirmation.referenceContext;
          executionReferenceImages = [...approvedConfirmation.referenceImages];
          if (approvedConfirmation.toolName === "generate_image") {
            await assertLockedImageSkill(selectedSkill, approvedConfirmation.skillContentHash);
          }
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
            // Codex-style selection is explicit. Do not infer a visual Skill
            // from trigger-hint similarity or natural-language keywords.
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
              : contextEntityById.has(id)
                || runtimeReferenceById.has(id)
                || sessionVisualAssets.some((asset) => asset.id === id || asset.sourceReferenceId === id)
                || generatedImageHistory.some((entry) => `history-image:${entry.id}` === id || entry.assetId === id);
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
        let mainAgentReferenceContext = approvedConfirmation?.referenceContext || runtimeReferenceContext;
        let mainAgentReferenceImages = mainAgentReferenceContext?.references.length
          ? mainAgentReferenceContext.references.map((reference) => reference.src)
          : approvedConfirmation?.referenceImages || body.referenceImages || [];
        const initiallyAttachedVisualIds = new Set(
          (mainAgentReferenceContext?.references || []).map((reference) => reference.id),
        );
        const loadedVisualReferenceIds = new Set(initiallyAttachedVisualIds);
        let recoveryHistoryMessages = body.messages;

        const materializeExecutableReference = async (input: {
          sessionId?: string;
          source: string;
          originalSrc?: string;
          sourceKind?: 'upload' | 'canvas' | 'generated';
          sourceReferenceId?: string;
          existingAsset?: SessionVisualAsset;
          taskId?: string;
          versionId?: string;
        }) => {
          const sessionAsset = input.existingAsset;
          if (sessionAsset) {
            const available = await isSessionVisualAssetAvailable(sessionAsset);
            if (available) return sessionAsset;
          }
          return materializeSessionVisualAsset({
            sessionId: input.sessionId || sessionId,
            existingAsset: sessionAsset,
            source: {
              src: input.source,
              originalSrc: input.originalSrc,
              source: input.sourceKind || 'upload',
              sourceReferenceId: input.sourceReferenceId,
              taskId: input.taskId,
              versionId: input.versionId,
            },
          });
        };

        const resolveVisualReferences = async (ids: string[]) => {
          const availableIds = [...runtimeReferenceById.keys()];
          const normalizeReferenceId = (id: string) => {
            if (runtimeReferenceById.has(id)) return id;
            const suffix = `:${id}`;
            return availableIds.find((candidate) => candidate.endsWith(suffix)) || id;
          };
          return resolveExecutableVisualReferences({
          referenceIds: ids.map(normalizeReferenceId),
          runtimeReferenceById,
          referenceContext: runReferenceContext || runtimeReferenceContext,
          contextEntityById,
          sessionVisualAssets,
          generatedImageHistory,
          sessionId,
          materialize: materializeExecutableReference,
          });
        };

        const recoveryRecord = recentFailedTask as AgentRecoveryRecord | null;
        const recoveryCandidateForAgent = recoveryRecord && !requestedRecoveryTaskId
          ? {
              id: recoveryRecord.taskId,
              status: recoveryRecord.status,
              originalRequest: recoveryRecord.originalRequest,
              failureMessage: recoveryRecord.failure.message,
              failureStage: recoveryRecord.failure.stage,
              intent: recoveryRecord.intent,
              skillId: recoveryRecord.skillId,
              contextEntityIds: recoveryRecord.contextEntityIds,
            }
          : null;
        const recoveryLockedSkillId = recoveryRecord?.skillId || null;
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
          } : null;
        }

        if (recoveryRecord && recoveryResolution?.decision === 'direct_response') {
          writeLifecycleEvent({
            type: 'assistant_delta',
            delta: String(recoveryResolution.content || ''),
            channel: 'content',
            model: resolvedChatSelection.model,
          });
          writeAgentDone('completed');
          return;
        }

        if (recoveryRecord && recoveryResolution?.decision === 'continue_current_request') {
          recoveryDecision = 'continue_current_request';
          recoveryBaseRecord = null;
          imageOperation = null;
          targetReferenceId = null;
          preserveRecoveryRecordOnFailure = false;
        }
        if (recoveryRecord && recoveryResolution?.decision === 'resume') {
          recoveryDecision = 'resume';
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
          if (recoveryRecord.assetId && !runReferenceContext?.references.some((reference) => reference.assetId === recoveryRecord.assetId)) {
            const recoveredAsset = sessionVisualAssets.find((asset) => asset.id === recoveryRecord.assetId);
            if (recoveredAsset) {
              const recoveredId = targetReferenceId || `asset:${recoveryRecord.assetId}`;
              const recoveredReference: AgentRuntimeReferenceContext['references'][number] = {
                id: recoveredId,
                assetId: recoveredAsset.id,
                src: recoveredAsset.durableSrc,
                originalSrc: recoveredAsset.originalSrc,
                previewSrc: recoveredAsset.previewSrc,
                label: '恢复的图片资产',
                source: recoveredAsset.source === 'canvas' ? 'canvas' : recoveredAsset.source === 'generated' ? 'history' : 'upload',
                role: 'reference' as const,
              };
              runReferenceContext = {
                references: [...(runReferenceContext?.references || []), recoveredReference],
                composerSegments: runReferenceContext?.composerSegments || [],
                ...(runReferenceContext?.evidenceImages ? { evidenceImages: runReferenceContext.evidenceImages } : {}),
              };
              runtimeReferenceById.set(recoveredId, recoveredReference);
            }
          }
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
          recoveryHistoryMessages = cropMessagesToRecoverySource(recoveryRecord);
          if (recoveryRevisionMessage) {
            const revisionSource = [...body.messages].reverse().find((message) => message.role === 'user');
            recoveryHistoryMessages.push({
              id: revisionSource?.id || `revision-${runId}`,
              role: 'user',
              content: recoveryRevisionMessage,
            });
          }
          const recoveredReferenceContext = recoveryRecord.visualReferenceIds.length > 0
            ? normalizeAgentRuntimeReferenceContext({
                references: recoveryRecord.visualReferenceIds.map((id) => {
                  const runtimeReference = recoveryRecord.referenceContext?.references?.find((reference) => reference.id === id)
                    || runtimeReferenceById.get(id);
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
            mainAgentInputMessages = recoveryHistoryMessages;
            mainAgentReferenceImages = body.referenceImages?.length
              ? body.referenceImages
              : recoveredReferenceContext?.references.map((reference) => reference.src) || [];
            mainAgentReferenceContext = runtimeReferenceContext || recoveryRecord.referenceContext || recoveredReferenceContext;
            if (mainAgentReferenceContext) {
              runReferenceContext = structuredClone(mainAgentReferenceContext);
              runtimeReferenceById.clear();
              for (const reference of runReferenceContext.references || []) runtimeReferenceById.set(reference.id, reference);
              executionReferenceImages = runReferenceContext.references.map((reference) => reference.src);
              initiallyAttachedVisualIds.clear();
              loadedVisualReferenceIds.clear();
              for (const reference of runReferenceContext.references || []) {
                initiallyAttachedVisualIds.add(reference.id);
                loadedVisualReferenceIds.add(reference.id);
              }
            }
          } else if (recoveryResolution.route === 'local_delivery') {
            const versions = recoveryRecord.taskSnapshot?.activeVersions || [];
            const assets = versions.flatMap((version) => {
              const entity = contextEntityById.get(version.referenceId);
              const src = version.assetUrl || entity?.assetUrl || entity?.referenceImageUrls?.[0];
              return src ? [{
                src,
                slotId: version.slotId,
                versionId: version.versionId,
                previewSrc: version.previewSrc,
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
            writeContextEvent({
              type: 'client_action',
              action: { type: 'add_generated_assets', taskId: recoveryRecord.taskId, assets },
            });
            writeAgentDone('local_delivery_recovered');
            return;
          } else {
            mainAgentInputMessages = recoveryHistoryMessages;
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
        const mainAgentLoopState = {
          contextRequested: false,
          contextScopes: new Set<'conversation' | 'project'>(),
          selectedSkillId: selectedSkill?.id || null,
          skillRead: false,
        };
        const relevantContextCandidateIds = new Set<string>();
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
            sessionId,
            taskId: agentAnalysis.taskId,
            operationId: previous?.operationId || progressTracker.snapshot().operationId,
            lastSequence: previous?.lastSequence ?? progressTracker.snapshot().lastSequence,
            contractVersion: previous?.contractVersion || 1,
            ...(previous?.contract ? { contract: structuredClone(previous.contract) } : {}),
            ...(previous?.editBaseVersionId !== undefined ? { editBaseVersionId: previous.editBaseVersionId } : {}),
            ...(previous?.latestBatchId !== undefined ? { latestBatchId: previous.latestBatchId } : {}),
            activeVersions: structuredClone(previous?.activeVersions || []),
            agentAnalysis: structuredClone(agentAnalysis),
          };
          taskSnapshot = emitTaskSnapshotCheckpoint(taskSnapshot);
        };
        const loadImagegenContext = async () => {
          const hostContent = await ensureImagegenHostContent();
          const hostContentHash = createHash('sha256').update(hostContent).digest('hex');
          const visualContent = selectedSkill ? await ensureSelectedSkillContent() : '';
          const visualContentHash = visualContent ? createHash('sha256').update(visualContent).digest('hex') : '';
          const hostBound = { originalBytes: Buffer.byteLength(hostContent), injectedBytes: Buffer.byteLength(hostContent), truncated: false };
          const visualBound = { originalBytes: Buffer.byteLength(visualContent), injectedBytes: Buffer.byteLength(visualContent), truncated: false };
          imagegenSkillOriginalBytes = hostBound.originalBytes;
          imagegenSkillInjectedBytes = hostBound.injectedBytes;
          visualSkillOriginalBytes = visualBound.originalBytes;
          visualSkillInjectedBytes = visualBound.injectedBytes;
          skillContentTruncated = hostBound.truncated || visualBound.truncated;
          const savedSkillHash = activeClarificationState?.skillContentHash || recoveryBaseRecord?.skillContentHash;
          if (savedSkillHash && visualContentHash && savedSkillHash !== visualContentHash) {
            throw new Error('The locked visual Skill changed after this task was created');
          }
          mainAgentLoopState.skillRead = true;
          imagegenLoaded = true;
          visualSkillLoaded = Boolean(selectedSkill && visualContent);
          void contextLogger.info('imagegen.context_read', 'Runtime loaded the ImageGen host and locked visual Skill', {
            source: 'runtime',
            hostContentLength: hostContent.length,
            hostContentHash,
            visualSkillId: selectedSkill?.id || null,
            visualContentLength: visualContent.length,
            visualContentHash: visualContentHash || null,
            skillContentTruncated,
            imagegenOriginalBytes: imagegenSkillOriginalBytes,
            imagegenInjectedBytes: imagegenSkillInjectedBytes,
            visualOriginalBytes: visualSkillOriginalBytes,
            visualInjectedBytes: visualSkillInjectedBytes,
            skillFragmentRole: 'user',
            skillFragmentOrder: ['imagegen', ...(selectedSkill ? [selectedSkill.id] : [])],
          });
          return {
            hostSkill: { id: IMAGEGEN_HOST_SKILL_ID, content: hostContent, contentHash: hostContentHash },
            visualSkill: selectedSkill ? { id: selectedSkill.id, content: visualContent, contentHash: visualContentHash } : null,
          };
        };
        if (selectedSkill) await ensureSelectedSkillContent();
        await loadImagegenContext();
        void contextLogger.info('skill.context_loaded', 'Runtime loaded the activated Skill before Main Agent execution', {
          skillCatalogLoaded,
          selectedSkillId: selectedSkill?.id || null,
          skillSelectionSource: skillSelectionMethod,
          skillRead: mainAgentLoopState.skillRead,
          skillContextLoaded: Boolean(selectedSkill && skillContent),
          skillContentHash: skillContentHash || null,
          skillLoadSource: skillSource || null,
          executionMode: selectedSkill?.executionMode || 'agent_loop',
          imagegenContextLoaded: mainAgentLoopState.skillRead,
          skillContentLength: skillContent.length,
          skillContentTruncated,
          skillOriginalBytes: visualSkillOriginalBytes,
          skillInjectedBytes: visualSkillInjectedBytes,
          imagegenOriginalBytes: imagegenSkillOriginalBytes,
          imagegenInjectedBytes: imagegenSkillInjectedBytes,
          skillFragmentRole: 'user',
          skillFragmentOrder: ['imagegen', ...(selectedSkill ? [selectedSkill.id] : [])],
          recoveryMode,
          recoveryDecision,
        });
        const mainAgentRegistry = createAgentToolRegistry({
          todoRead: async () => {
            const loaded = await loadThread(sessionId);
            return {
              items: Array.isArray(loaded.state.todoItems)
                ? structuredClone(loaded.state.todoItems)
                : [],
            };
          },
          todoUpdate: createTodoUpdateExecutor(),
          handleFailedTask: async (args: Record<string, unknown>) => {
            if (!recoveryCandidateForAgent || !recoveryRecord) throw new Error('当前没有可恢复的失败任务');
            const action = String(args.action || '');
            if (action === 'inspect') {
              recoveryDecision = 'inspect';
              return {
                modelResult: {
                  taskId: recoveryRecord.taskId,
                  failureStage: recoveryRecord.failure.stage,
                  failureMessage: recoveryRecord.failure.message,
                  originalRequest: recoveryRecord.originalRequest,
                },
                publicResult: { inspected: true },
              };
            }
            if (action === 'continue_current_request') {
              recoveryDecision = 'continue_current_request';
              return { modelResult: { accepted: true, recovery: 'ignored' }, publicResult: { accepted: true } };
            }
            if (action !== 'resume') throw new Error('失败任务操作无效');
            recoveryDecision = 'resume';
            const skillId = recoveryRecord.skillId || null;
            if (skillId && !allowedSkillIds.has(skillId)) throw new Error(`恢复任务使用的 Skill 已不可用：${skillId}`);
            recoveryBaseRecord = recoveryRecord;
            recoveryTaskIdForExecution = recoveryRecord.taskId;
            recoveryRevisionMessage = typeof args.revision === 'string' ? args.revision.trim().slice(0, 4000) : '';
            imageOperation = recoveryRecord.imageOperation || imageOperation;
            targetReferenceId = recoveryRecord.targetReferenceId || targetReferenceId;
            if (skillId) {
              selectedSkill = skillManifests.find((manifest) => manifest.id === skillId) || null;
              if (!selectedSkill) throw new Error('Recovery Skill is no longer enabled');
              skillSource = 'recovery';
              skillSelectionMethod = 'none';
              skillCandidateIds = [selectedSkill.id];
              await ensureSelectedSkillContent();
            }
            if (recoveryRecord.intent === 'image' || recoveryRecord.imageOperation) {
              intent = 'image';
            }
            mainAgentInputMessages = cropMessagesToRecoverySource(recoveryRecord);
            if (recoveryRevisionMessage) {
              mainAgentInputMessages.push({ id: `revision-${runId}`, role: 'user', content: recoveryRevisionMessage });
            }
            if (recoveryRecord.referenceContext) {
              mainAgentReferenceContext = structuredClone(recoveryRecord.referenceContext);
              mainAgentReferenceImages = mainAgentReferenceContext.references.map((reference) => reference.src);
              runReferenceContext = structuredClone(mainAgentReferenceContext);
              runtimeReferenceById.clear();
              for (const reference of runReferenceContext.references || []) runtimeReferenceById.set(reference.id, reference);
            }
            void contextLogger.info('task.recovery_decision', 'Main Agent selected recovery for the supplied failed task', {
              taskId: recoveryRecord.taskId,
              runId,
              decision: 'resume',
              candidateCount: 1,
            });
            return {
              modelResult: { accepted: true, recovery: 'resumed', taskId: recoveryRecord.taskId },
              publicResult: { accepted: true, taskId: recoveryRecord.taskId },
            };
          },
          generateImage: async (args: Record<string, unknown>, context: { publicProgress?: unknown; toolCallId?: string }) => {
            const requestedOperation = String(args.operation || '');
            const requestedRecentImageCount = args.numLastImagesToInclude === undefined || args.numLastImagesToInclude === null
              ? null
              : Number(args.numLastImagesToInclude);
            let normalizationAction: string | null = null;
            if (requestedOperation === 'generate' && requestedRecentImageCount === 1) {
              args = { ...args };
              delete args.numLastImagesToInclude;
              normalizationAction = 'removed_edit_only_recent_image_parameter';
            }
            const callId = String(context.toolCallId || `${runId}-generate-image`).slice(0, 200);
            directGenerateImageCallId = callId;
            const attemptId = runId;
            const existingCall = toolCallRecords.find((entry) => entry.callId === callId);
            if (existingCall?.status === 'completed') {
              throw new Error('图片工具调用已完成，恢复时不得重复执行');
            }
            const callRecord: typeof toolCallRecords[number] = existingCall || {
              callId,
              attemptId,
              taskId: rootTaskId(),
              toolName: 'generate_image',
              status: 'running' as const,
              startedAt: Date.now(),
              completedAt: undefined,
            };
            if (!existingCall) toolCallRecords.push(callRecord);
            else callRecord.status = 'running';
            directGenerateImageCall = true;
            void contextLogger.info('main_agent.direct_generate_image', 'Main Agent submitted the image generation contract', {
              skillCatalogLoaded,
              selectedSkillId: selectedSkill?.id || null,
              skillSelectionSource: skillSelectionMethod,
              finalPromptLength: typeof args.prompt === 'string' ? args.prompt.trim().length : 0,
              finalPromptHash: hashPrompt(args.prompt),
              imagegenLoaded,
              visualSkillLoaded,
              skillRead: mainAgentLoopState.skillRead,
              attemptId,
              toolCallId: callId,
              operation: requestedOperation || null,
              normalizationAction,
              recoveryMode,
              recoveryDecision,
            });
            if (selectedSkill && (
              selectedSkill.executionMode !== 'image_pipeline'
              || !selectedSkill.allowedTools.includes('generate_image')
            )) {
              callRecord.status = 'failed';
              callRecord.completedAt = Date.now();
              throw new Error('The locked Skill is not allowed to generate images');
            }
            if (selectedSkill && !skillContentHash) {
              callRecord.status = 'failed';
              callRecord.completedAt = Date.now();
              throw new Error('The image Prompt Skill lock is missing or changed');
            }
            const operation = String(args.operation || '');
            if (operation !== 'generate' && operation !== 'edit') {
              callRecord.status = 'failed';
              callRecord.completedAt = Date.now();
              throw new Error('图片操作必须是 generate 或 edit');
            }
            const prompt = String(args.prompt || '').trim();
            if (!prompt) throw new Error('最终图片提示词不能为空');
            const publicProgress = normalizePublicProgress(context.publicProgress);
            const referenceIds = Array.from(new Set(
              (Array.isArray(args.referenceIds) ? args.referenceIds : []).map((value) => String(value).trim()).filter(Boolean),
            ));
            const requestedRecentImageCountAfterNormalization = args.numLastImagesToInclude === undefined || args.numLastImagesToInclude === null
              ? null
              : Number(args.numLastImagesToInclude);
            const requestedTargetReferenceId = typeof args.targetReferenceId === 'string'
              ? args.targetReferenceId.trim()
              : '';
            const canonicalTargetReferenceId = requestedTargetReferenceId && !runtimeReferenceById.has(requestedTargetReferenceId)
              ? [...runtimeReferenceById.keys()].find((candidate) => candidate.endsWith(`:${requestedTargetReferenceId}`)) || requestedTargetReferenceId
              : requestedTargetReferenceId;
            if (requestedRecentImageCountAfterNormalization !== null && requestedRecentImageCountAfterNormalization !== 1) {
              throw new VisualReferenceResolutionError('invalid_tool_arguments', 'numLastImagesToInclude 目前只支持 1');
            }
            if (requestedRecentImageCountAfterNormalization !== null && operation !== 'edit') {
              throw new VisualReferenceResolutionError(
                'invalid_tool_arguments',
                'numLastImagesToInclude 仅可用于图片编辑',
              );
            }
            if (requestedRecentImageCountAfterNormalization !== null && (referenceIds.length > 0 || requestedTargetReferenceId)) {
              throw new VisualReferenceResolutionError(
                'reference_source_conflict',
                'numLastImagesToInclude 不能与显式图片引用同时使用',
              );
            }
            let resolvedReferenceIds = referenceIds;
            let resolvedTargetReferenceId = canonicalTargetReferenceId;
            executionReferenceImages = [];
            if (requestedRecentImageCountAfterNormalization === 1) {
              let recentReference;
              try {
                recentReference = selectRecentSessionImage({
                  sessionId,
                  generatedImageHistory,
                  sessionVisualAssets,
                  contextEvents: contextAuditEvents,
                });
              } catch (error) {
                if (error instanceof VisualReferenceResolutionError && error.reason === 'recent_image_ambiguous') {
                  for (const candidate of error.candidates || []) {
                    if (contextEntityById.has(candidate.id)) continue;
                    contextEntityById.set(candidate.id, {
                      id: candidate.id,
                      kind: 'generated_image',
                      intent: 'image',
                      label: candidate.label,
                      aliases: [],
                      summary: '当前画布最近一次生成批次中的图片',
                      brief: '使用用户选择的最近生成图片作为编辑目标。',
                      mustPreserve: [],
                      assetUrl: candidate.src,
                      referenceImageUrls: [candidate.src],
                      selected: false,
                      createdAt: Date.now(),
                    });
                  }
                  callRecord.status = 'completed';
                  callRecord.completedAt = Date.now();
                  return {
                    confirmationRequired: true,
                    toolName: 'request_context_selection',
                    message: error.message,
                    candidates: error.candidates || [],
                  };
                }
                throw error;
              }
              resolvedReferenceIds = [recentReference.id];
              resolvedTargetReferenceId = recentReference.id;
            }
            if (resolvedReferenceIds.length > 0) {
              const resolved = await resolveVisualReferences(resolvedReferenceIds);
              if (resolved.registeredAssets.length > 0) {
                writeEvent(controller, {
                  type: 'client_action',
                  action: {
                    type: 'register_session_visual_assets',
                    sessionId,
                    assets: resolved.registeredAssets.map((asset) => ({ ...asset, sessionId })),
                  },
                });
              }
              runReferenceContext = {
                references: [
                  ...(runReferenceContext?.references || []).filter((reference) => !resolved.references.some((item) => item.id === reference.id)),
                  ...resolved.references,
                ],
                composerSegments: runReferenceContext?.composerSegments || [],
                ...(runReferenceContext?.evidenceImages ? { evidenceImages: runReferenceContext.evidenceImages } : {}),
              };
              for (const reference of resolved.references) runtimeReferenceById.set(reference.id, reference);
              executionReferenceImages = resolved.references.map((reference) => reference.src);
            }
            if (operation === 'edit' && (!resolvedTargetReferenceId || !resolvedReferenceIds.includes(resolvedTargetReferenceId))) {
              throw new Error('编辑任务必须锁定一个已选参考图作为目标');
            }
            if (operation === 'generate' && requestedTargetReferenceId) {
              throw new Error('生成任务不能指定编辑目标');
            }
            const outputCount = positiveInteger(args.outputCount) || 1;
            const deliveryMode = ['single', 'variants', 'series', 'composite'].includes(String(args.deliveryMode || ''))
              ? String(args.deliveryMode) as 'single' | 'variants' | 'series' | 'composite'
              : outputCount > 1 ? 'variants' : 'single';
            const panelCount = deliveryMode === 'composite'
              ? Math.max(2, positiveInteger(args.panelCount) || 2)
              : null;
            const requestedAspectRatio = typeof args.aspectRatio === 'string' ? args.aspectRatio : '';
            const aspectRatio = requestedAspectRatio || selectedSkill?.aspectRatio || AGENT_DEFAULT_IMAGE_OPTIONS.aspectRatio;
            const generationItems = (Array.isArray(args.items) ? args.items : [])
              .map((item, index) => ({
                index: index + 1,
                label: `系列 ${index + 1}`,
                prompt: String((item as Record<string, unknown>)?.prompt || '').trim(),
              }))
              .filter((item) => item.prompt);
            const imageExecutionContract = assertImageExecutionContract({
              operation,
              prompt,
              referenceIds: resolvedReferenceIds,
              targetReferenceId: operation === 'edit' ? resolvedTargetReferenceId : null,
              outputCount,
              aspectRatio,
              deliveryMode,
              panelCount,
              items: generationItems,
            }, {
              referenceIds: [...runtimeReferenceById.keys()],
              aspectRatios: AGENT_IMAGE_ASPECT_RATIO_IDS,
            }) as DirectImageExecutionContract;

            imageOperation = operation;
            targetReferenceId = operation === 'edit' ? resolvedTargetReferenceId : null;
            intent = 'image';
            lockedImageToolArgs = imageExecutionContract;
            emitIntentResolved('image');
            requestedTotalImageCount = outputCount;
            requestedImageCount = Math.min(outputCount, AGENT_MAX_IMAGE_BATCH_COUNT);
            requestedImageCountSource = 'prompt';
            body.imageOptions = { ...body.imageOptions, aspectRatio };

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
            const imageTask: AgentImageTask = {
              operation,
              targetReferenceId: operation === 'edit' ? resolvedTargetReferenceId : null,
              supportingReferenceIds: resolvedReferenceIds.filter((referenceId) => referenceId !== resolvedTargetReferenceId),
            };
            directImageExecution = {
              contract: imageExecutionContract,
              imageTask,
              delivery: imageDeliveryPlan,
              presentation: {
                title: operation === 'edit' ? '编辑图片' : '生成图片',
                operation,
                completionSummary: operation === 'edit' ? '图片编辑已完成。' : '图片生成已完成。',
              },
            };
            workingContextData = {
              version: 1,
              originalRequest: prompt,
              resolvedEntityIds: resolvedReferenceIds,
              resolvedLabels: resolvedReferenceIds
                .map((referenceId) => runtimeReferenceById.get(referenceId)?.label)
                .filter((label): label is string => Boolean(label)),
              plainText: prompt,
              mustPreserve: [],
              referenceImageUrls: [],
              canvasItemIds: [],
            };
            workingContext = prompt;
            writeLifecycleEvent({
              type: 'image_parameters_locked',
              parameters: { outputCount, aspectRatio, deliveryMode, ...(panelCount ? { panelCount } : {}) },
            });
            writeProgress({
              stepId: 'routing',
              phase: 'analyzing',
              status: 'completed',
              label: operation === 'edit' ? '已识别为编辑原图' : '已识别为生成新图',
            });
            if (outputCount > 1 && !approvedConfirmation && body.imageOptions?.autoConfirm !== true) {
              callRecord.status = 'pending';
              return {
                confirmationRequired: true,
                type: 'image_execution',
                toolName: 'generate_image',
                toolCallId: callId,
                arguments: args,
                contract: imageExecutionContract,
                message: `本次将生成 ${outputCount} 张图片，确认后继续。`,
                modelResult: { accepted: false, confirmationRequired: true },
                publicResult: { accepted: false, confirmationRequired: true },
              };
            }
            const allGenerationItems: AgentImageGenerationItem[] = outputCount > 1
              ? Array.from({ length: outputCount }, (_, index) => ({
                  id: `${imageDeliveryPlan.mode}-${index + 1}`,
                  index: index + 1,
                  label: imageDeliveryPlan.mode === 'composite' ? `多宫格 ${index + 1}` : `变体 ${index + 1}`,
                  subject: imageDeliveryPlan.mode === 'composite' ? 'composite image' : 'image variant',
                  prompt: generationItems[index]?.prompt || prompt,
                }))
              : [];
            try {
              await assertLockedImageSkill(selectedSkill, skillContentHash || null);
              writeToolProgress('generate_image', 'active', callId);
              const generated = await generateImagePayload(
                prompt,
                body.imageOptions,
                executionReferenceImages,
                { source: 'prompt', totalCount: outputCount, promptOptimized: false },
                allGenerationItems,
                { toolCallId: callId },
                imageDeliveryPlan,
                imageTask,
                undefined,
                directImageExecution.presentation,
                runReferenceContext,
              );
              if (generatedAssetsFromResult(generated).length === 0) {
                throw new Error('Image generation returned no usable assets');
              }
              nativeGeneratedImageResult = generated;
              runSignal.throwIfAborted();
              callRecord.status = 'completed';
              callRecord.completedAt = Date.now();
              callRecord.resultRef = `${runId}:generate_image`;
              writeToolProgress('generate_image', 'completed', callId);
              return {
                ...generated,
                type: 'image_execution_completed',
                modelResult: {
                  completed: true,
                  partial: Number(generated.requestStats?.failed) > 0,
                  assetCount: generatedAssetsFromResult(generated).length,
                  assets: generatedAssetsFromResult(generated).map((asset: any) => ({
                    id: asset.id || asset.assetId || asset.versionId || null,
                    label: asset.label || null,
                  })),
                },
                publicResult: generated,
              };
            } catch (error) {
              nativeImageFailure = error;
              callRecord.status = 'failed';
              callRecord.completedAt = Date.now();
              throw error;
            }
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
            const resolvedVisuals = await resolveVisualReferences(validatedIds);
            const visualReferences = resolvedVisuals.references;
            // Native tool results require pixels, not a durable URL in text.
            // Resolve only assets already authorized by the session resolver.
            const modelVisualReferences = await Promise.all(visualReferences.map(async (reference) => {
              const asset = [...resolvedVisuals.registeredAssets, ...sessionVisualAssets]
                .find((candidate) => candidate.id === reference.assetId && candidate.sessionId === sessionId);
              const bytes = asset ? await readSessionVisualAsset(asset) : null;
              if (!asset || !bytes) {
                throw Object.assign(new Error('图片引用已失效，请重新选择参考图'), {
                  code: 'invalid_reference', failureStage: 'image_reference_resolution', retryable: false,
                });
              }
              return { id: reference.id, label: reference.label, src: `data:${asset.mimeType};base64,${Buffer.from(bytes).toString('base64')}` };
            }));
            if (resolvedVisuals.registeredAssets.length > 0) {
              writeEvent(controller, {
                type: 'client_action',
                action: {
                  type: 'register_session_visual_assets',
                  sessionId,
                  assets: resolvedVisuals.registeredAssets.map((asset) => ({ ...asset, sessionId })),
                },
              });
            }
            validatedIds.forEach((id) => loadedVisualReferenceIds.add(id));
            for (const visualReference of visualReferences) {
              if (runtimeReferenceById.has(visualReference.id)) continue;
              const reference = {
                id: visualReference.id,
                src: visualReference.src,
                label: visualReference.label,
                ...(visualReference.assetId ? { assetId: visualReference.assetId } : {}),
                ...(visualReference.originalSrc ? { originalSrc: visualReference.originalSrc } : {}),
                source: visualReference.source,
                role: visualReference.role,
              };
              runReferenceContext.references.push(reference);
              runtimeReferenceById.set(reference.id, reference);
            }
            return {
              modelResult: { loaded: visualReferences.map(({ id, label }) => ({ id, label })) },
              publicResult: { loadedIds: visualReferences.map((reference) => reference.id) },
              visualReferences: modelVisualReferences,
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
            writeAgentAnalysisCheckpoint();
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
            }
            writeAgentAnalysisCheckpoint();
            void contextLogger.info('main_agent.analysis_rewound', 'Rewound task from a model-selected stage', {
              taskId: agentAnalysis.taskId,
              runId,
              stage: requestedStage,
              skillId: agentAnalysis.lockedFacts.selectedSkillId,
              operation: agentAnalysis.lockedFacts.operation || imageOperation || null,
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
        const analysisCheckpointResume = recoveryBaseRecord?.failure.stage === 'analysis'
          && recoveryBaseRecord.resumeRoute === 'main_agent'
          && Boolean(recoveryBaseRecord.mainAgentLoop)
          && Boolean(agentAnalysis);
        if (analysisCheckpointResume && agentAnalysis) agentAnalysis.status = 'analyzing';
        const standardMainAgentToolNames = [
          'todo_read',
          'todo_update',
          'read_relevant_context',
          'submit_agent_analysis_checkpoint',
          'request_user_decision',
          ...(recoveryCandidateForAgent ? ['handle_failed_task'] : []),
        ];
        const imageExecutionToolName = () => 'generate_image';
        const activatedSkillToolNames = selectedSkill
          ? selectedSkill.allowedTools.filter((name) => name === 'get_canvas_context')
          : ['get_canvas_context'];
        const mainAgentInitialToolNames = [
          ...standardMainAgentToolNames,
          imageExecutionToolName(),
          ...activatedSkillToolNames,
        ].filter(Boolean);
        const resolveMainAgentToolNames = () => {
          return [
            ...standardMainAgentToolNames.filter((name) => (
              name !== 'submit_agent_analysis_checkpoint' || (agentAnalysis?.checkpointCount || 0) < 3
            )),
            imageExecutionToolName(),
            ...activatedSkillToolNames,
            ...(recoveryRevisionMessage ? ['rewind_agent_analysis'] : []),
            ...(relevantContextCandidateIds.size >= 2 ? ['request_context_selection'] : []),
            'load_visual_reference',
          ].filter(Boolean);
        };
        const mainAgentToolNames = [
          ...standardMainAgentToolNames,
          'generate_image',
          ...activatedSkillToolNames,
          'rewind_agent_analysis',
          'request_context_selection',
          'load_visual_reference',
        ];
        const mainAgentTools = getAgentModelTools(mainAgentRegistry, mainAgentToolNames);
        const selectedContextResponse = body.clarificationRequest?.dimension === 'context_reference'
          && typeof body.clarificationResponse?.selectedOptionId === 'string'
          ? body.clarificationResponse.selectedOptionId
          : '';
        const confirmedSkillResponse = body.clarificationRequest?.dimension === 'skill_selection'
          && typeof body.clarificationResponse?.selectedOptionId === 'string'
          ? body.clarificationResponse.selectedOptionId
          : '';
        const savedMainAgentLoop = null;
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
        let loopResult: any;
        {
          const runMainAgentOnce = async () => {
            mainAgentRequestCount += 1;
            const stopMainAgentKeepalive = startMainAgentKeepalive();
            try {
              const nativeTools = mainAgentTools
                .filter((entry: any) => resolveMainAgentToolNames().includes(entry.function?.name))
                .filter((entry: any) => !approvedConfirmation || entry.function.name === approvedConfirmation.toolName)
                .map((entry: any) => ({
                  name: entry.function.name,
                  description: entry.function.description || entry.function.name,
                  parameters: entry.function.parameters || { type: 'object', properties: {} },
                  requiresCommentary: true,
                }));
              if (!selectedSkill && !approvedConfirmation) nativeTools.push({
                name: 'select_visual_skill',
                description: 'Load and lock a visual Skill from the application candidate catalog, only when the user request is a high-confidence match. Returns the full rules; apply them before generating.',
                parameters: { type: 'object', additionalProperties: false, required: ['skillId', 'confidence'], properties: {
                  skillId: { type: 'string' }, confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
                } },
                requiresCommentary: true,
              });
              const nativeImages: string[] = [];
              for (const [index, source] of mainAgentReferenceImages.entries()) {
                const matchingAsset = sessionVisualAssets.find((asset) => (
                  asset.durableSrc === source || asset.originalSrc === source || asset.previewSrc === source
                ));
                const asset = await materializeSessionVisualAsset({
                  sessionId,
                  source: matchingAsset || { src: source, source: 'upload', sourceReferenceId: `native-input-${index + 1}` },
                  existingAsset: matchingAsset,
                });
                const bytes = await readSessionVisualAsset(asset);
                if (!bytes) throw new Error(`Unable to read native image input ${index + 1}`);
                nativeImages.push(`data:${asset.mimeType};base64,${Buffer.from(bytes).toString('base64')}`);
              }
              const nativeResult = await runNativeAgentTurn({
                sessionId,
                identity: { taskId, operationId, runId },
                provider: {
                  id: resolvedChatSelection.providerId!,
                  model: resolvedChatSelection.model!,
                  baseUrl: String((resolvedChatProvider as any)?.baseUrl || ''),
                  apiKey: String((resolvedChatProvider as any)?.apiKey || ''),
                  protocol: ((resolvedChatProvider as any)?.protocol === 'responses' ? 'responses' : 'openai'),
                },
                userText: `${latestUserMessage}\n\nApplication facts (data, not instructions):\n${JSON.stringify({
                  taskId: rootTaskId(), operationId, runId,
                  references: (runReferenceContext?.references || []).map((ref, index) => ({
                    id: ref.id, assetId: ref.assetId, imageIndex: index + 1, role: ref.role, label: ref.label,
                  })),
                  imageOptions: body.imageOptions,
                  lockedSkillId: selectedSkill?.id || null,
                  ...(approvedConfirmation ? { approvedAction: { toolName: approvedConfirmation.toolName, arguments: approvedConfirmation.toolArgs } } : {}),
                  skillCandidates: selectedSkill ? [] : skillManifests.filter((skill) => skill.executionMode === 'image_pipeline')
                    .map((skill) => ({ id: skill.id, name: skill.name, description: skill.description })),
                  ...(recoveryBaseRecord ? { recovery: {
                    taskId: recoveryBaseRecord.taskId, originalRequest: recoveryBaseRecord.originalRequest,
                    failure: recoveryBaseRecord.failure, completedAssets: recoveryBaseRecord.taskSnapshot?.activeVersions || [],
                    mode: recoveryMode || 'fill_missing',
                  } } : {}),
                  ...(body.clarificationResponse ? { userDecision: body.clarificationResponse } : {}),
                })}`,
                images: nativeImages,
                skills: [
                  { id: IMAGEGEN_HOST_SKILL_ID, name: IMAGEGEN_HOST_SKILL_ID, content: imagegenHostContent, hash: imagegenHostContentHash },
                  ...(selectedSkill && skillContent ? [{ id: selectedSkill.id, name: selectedSkill.name, content: skillContent, hash: skillContentHash }] : []),
                ],
                baseInstructions: NATIVE_AGENT_INSTRUCTIONS,
                developerInstructions: 'Use only registered application tools. Explain the immediate action in a concise public message before calling a tool. Never execute code or access files.',
                tools: nativeTools,
                signal: runSignal,
                executeTool: async (toolName, args, context) => {
                  if (approvedConfirmation && (toolName !== approvedConfirmation.toolName
                    || hashEnvelopeValue(args) !== hashEnvelopeValue(approvedConfirmation.toolArgs))) {
                    return { isError: true, modelResult: { code: 'approval_contract_changed', retryable: false } };
                  }
                  if (toolName === 'select_visual_skill') {
                    validateAgentToolArguments(nativeTools.find((tool) => tool.name === toolName)!.parameters, args, toolName);
                    if (args.confidence !== 'high') return { modelResult: { locked: false, reason: 'confidence_below_high' } };
                    if (selectedSkill || directGenerateImageCall) throw new Error('The visual Skill cannot change after it is locked or image execution starts');
                    const skill = skillManifests.find((candidate) => candidate.id === args.skillId && candidate.executionMode === 'image_pipeline');
                    if (!skill) throw new Error('Unknown visual Skill');
                    const content = await loadSkillContent(skill.id);
                    if (!content.trim()) throw new Error('The selected visual Skill is empty');
                    selectedSkill = skill;
                    skillSource = 'auto';
                    skillContent = content;
                    skillContentHash = hashPrompt(content);
                    visualSkillLoaded = true;
                    mainAgentLoopState.skillRead = true;
                    mainAgentLoopState.selectedSkillId = skill.id;
                    writeLifecycleEvent({ type: 'skill_selected', skillId: skill.id, label: skill.name, source: 'auto' });
                    await contextLogger.info('skill.loaded', 'Model selected and loaded the complete application Skill', {
                      taskId, operationId, runId, skillId: skill.id, skillSource: 'auto', skillConfidence: 'high',
                      sourceContentHash: skillContentHash, returnedContentHash: skillContentHash, truncated: false,
                    });
                    return { modelResult: { skillId: skill.id, content, contentHash: skillContentHash, truncated: false } };
                  }
                  return executeAgentTool(mainAgentRegistry, toolName, args, {
                  allowedTools: resolveMainAgentToolNames(),
                  confirmed: Boolean(approvedConfirmation),
                  confirmationId: approvedConfirmation?.confirmationId,
                  canvasContext: body.canvasContext,
                  threadId: sessionId,
                  turnId: context.turnId || journalTurnId,
                  taskId,
                  operationId,
                  runId,
                  toolCallId: context.toolCallId,
                  itemId: toolItemId(context.toolCallId),
                  expectedSequence: progressTracker.snapshot().lastSequence,
                  });
                },
                onEvent: async (event) => {
                  if (event.method === 'item/agentMessage/delta') {
                    const id = String(event.params.itemId || `${runId}:native`);
                    if (currentActivity && currentActivity.activityId !== id) currentActivity = null;
                    appendActivityText(id, String(event.params.delta || ''));
                  } else if (event.method === 'item/started' && event.params.item?.type === 'dynamicToolCall') {
                    const id = String(event.params.item.id || event.params.item.callId || `${runId}:native-tool`);
                    writeToolStartEvent(id, String(event.params.item.tool || 'tool'));
                  } else if (event.method === 'item/completed' && event.params.item?.type === 'dynamicToolCall') {
                    const item = event.params.item;
                    writeToolResultEvent(String(item.id || item.callId || ''), String(item.tool || 'tool'), { success: item.success === true }, item.success !== true);
                  } else if (event.method === 'item/completed' && event.params.item?.type === 'agentMessage') {
                    const item = event.params.item;
                    if (item.phase === 'commentary' && item.text) {
                      const id = String(item.id || `${runId}:native-commentary`);
                      if (currentActivity?.activityId !== id) currentActivity = null;
                      if (!currentActivity) appendActivityText(id, String(item.text));
                      commitCurrentActivity({ content: [{ type: 'text', text: String(item.text) }] }, 'commentary');
                    } else if (item.text) {
                      writeLifecycleEvent({
                        type: 'assistant_delta',
                        delta: String(item.text),
                        channel: 'content',
                        model: resolvedChatSelection.model,
                        ...progressTracker.stamp(),
                      });
                      finalAssistantTextEmitted = true;
                    }
                  }
                  await journalPending.get(controller as unknown as object)?.at(-1);
                },
              });
              return {
                stopReason: nativeResult.pendingConfirmation
                  ? 'confirmation_required'
                  : nativeResult.status === 'completed' ? 'completed' : nativeResult.status,
                errorMessage: nativeResult.error?.message,
                failureCode: nativeResult.error?.code,
                retryable: nativeResult.error?.retryable,
                confirmation: nativeResult.pendingConfirmation,
                terminal: nativeGeneratedImageResult ? { type: 'image_execution_completed' } : null,
                content: nativeResult.text,
                text: nativeResult.text,
                turns: 1,
                toolCalls: toolCallRecords.length,
                budgetedToolCalls: toolCallRecords.length,
                mutationToolCalls: nativeGeneratedImageResult ? 1 : 0,
                transcript: [],
              };
            } finally {
              stopMainAgentKeepalive();
            }
          };
          loopResult = await runMainAgentOnce();
        }
        if (loopResult.stopReason === 'failed' || loopResult.stopReason === 'cancelled') {
          throw Object.assign(new Error(loopResult.errorMessage || 'Native Agent turn failed'), {
            code: loopResult.failureCode || 'native_turn_failed',
            failureStage: 'native_runtime',
            retryable: loopResult.retryable === true,
          });
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
              intent: body.intent === 'image' ? 'image' : 'chat',
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
        if (loopResult.stopReason === 'confirmation_required') {
          const confirmationId = randomUUID();
          const toolName = String(loopResult.confirmation?.toolName || '');
          const toolCallId = String(loopResult.confirmation?.toolCallId || `${runId}-${toolName}-confirmation`);
          const toolArgs = loopResult.confirmation?.arguments && typeof loopResult.confirmation.arguments === 'object'
            ? loopResult.confirmation.arguments as Record<string, unknown>
            : {};
          const checkpoint = progressTracker.snapshot();
          confirmationStore.set(confirmationId, {
            ...confirmationTaskIdentity(),
            version: 1,
            confirmationId,
            runId,
            status: 'pending',
            operationId: checkpoint.operationId,
            skillSource,
            lastSequence: checkpoint.lastSequence,
            progressToolCallId: toolCallId,
            skillId: selectedSkill?.id || null,
            skillContentHash: skillContentHash || undefined,
            toolName,
            toolArgs,
            pendingToolCall: { id: toolCallId, name: toolName, args: structuredClone(toolArgs), argsHash: hashEnvelopeValue(toolArgs), batch: [] },
            resolvedProviderId: resolvedChatSelection.providerId!,
            resolvedModel: resolvedChatSelection.model!,
            providerModelFingerprint: fingerprintProviderModel(resolvedChatProvider, resolvedChatSelection.model!, 'chat'),
            ...resolveConfirmationImageIdentity({ providers, toolName,
              requestedProviderId: body.imageOptions?.providerId, requestedModel: body.imageOptions?.model }),
            imageOptions: body.imageOptions ? structuredClone(body.imageOptions) : undefined,
            referenceContext: runReferenceContext ? structuredClone(runReferenceContext) : undefined,
            imageTask: directImageExecution?.imageTask,
            imageDeliveryPlan: directImageExecution?.delivery,
            presentation: directImageExecution?.presentation,
            workingContext: structuredClone(workingContextData),
            allowedTools: resolveMainAgentToolNames(),
            userMessage: latestUserMessage,
            referenceImages: [...executionReferenceImages],
            ...lockedVisualIdentity(runReferenceContext, toolArgs, replayContext.activeWindow?.summaryVersion),
            canvasContext: body.canvasContext ? structuredClone(body.canvasContext) : undefined,
            sessionId,
            expiresAt: Date.now() + CONFIRMATION_TTL_MS,
          });
          await saveNativeConfirmation({ sessionId, confirmationId, taskId: rootTaskId(), operationId, runId,
            contract: toolArgs, parameters: confirmationStore.get(confirmationId), expiresAt: Date.now() + CONFIRMATION_TTL_MS });
          writeToolProgress(toolName, 'waiting', toolCallId);
          writeInteractionEvent({
            type: 'confirmation_required',
            request: {
              confirmationId,
              toolName,
              message: String(loopResult.confirmation?.message || `确认后执行 ${toolName}`),
            },
          });
          writeAgentDone('awaiting_confirmation');
          return;
        }
        if (nativeGeneratedImageResult) {
          if (approvedConfirmation) { approvedConfirmation.status = 'completed'; confirmationStore.delete(approvedConfirmation.confirmationId!); }
          intent = 'image';
          emitIntentResolved('image');
          const toolCallId = directGenerateImageCallId || `${runId}-generate-image`;
          writeResolvedImageOptionUpdate(toolCallId, nativeGeneratedImageResult);
          for (const event of enrichGeneratedAssetEvents(createAgentToolResultEvents({
            source: 'direct',
            runId,
            toolCallId,
            toolName: 'generate_image',
            rawResult: nativeGeneratedImageResult,
            includeAssets: !(nativeGeneratedImageResult as any)?.streamedAssets,
          }), nativeGeneratedImageResult)) writeStampedAgentEvent(event);
          writeImageCompletionSummary(nativeGeneratedImageResult);
          updateTopicMemory({
            activeTask: { status: 'completed', summary: directImageExecution?.presentation?.completionSummary || 'Image delivery completed.' },
            recentReferencedAssetIds: lockedImageToolArgs?.referenceIds || [],
          });
          commitMainAgentMemory();
          writeAgentDone('image_generated');
          return;
        }
        if (!String(loopResult.content || '').trim()) {
          throw Object.assign(new Error('Native model returned no final response'), { code: 'empty_model_response', failureStage: 'native_runtime' });
        }
        if (directGenerateImageCall && !nativeGeneratedImageResult) {
          throw nativeImageFailure || Object.assign(new Error('Image execution did not return saved assets'), { code: 'image_execution_incomplete', failureStage: 'image_execution' });
        }
        intent = 'chat';
        emitIntentResolved(intent);
        commitMainAgentMemory();
        writeAgentDone('completed');

      } catch (error) {
        if (clarificationSubmissionKey) {
          clarificationSubmissionStore.delete(clarificationSubmissionKey);
        }
        const aborted = runSignal.aborted;
        const derivedFailureCode = classifyAgentFailureCode(error, executionKind || '');
        const failureStage = aborted
          ? 'cancelled'
          : derivedFailureCode === 'invalid_reference'
            ? 'image_reference_resolution'
          : (error && typeof error === 'object' && typeof (error as any).failureStage === 'string' ? (error as any).failureStage : null)
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
          : derivedFailureCode === 'invalid_reference'
            ? (error instanceof Error ? error.message : '图片引用已失效，请重新选择参考图')
          : (error instanceof Error ? error.message : 'Agent run failed');
        const recoveryRecord = preserveRecoveryRecordOnFailure && recoveryBaseRecord
          ? recoveryBaseRecord
          : buildRecoveryRecord({
              stage: failureStage,
              message: failureMessage,
              status: aborted ? 'cancelled' : 'failed',
              ...(mainAgentFailureCheckpoint ? { resumeRoute: 'main_agent' } : {}),
            });
        await contextLogger.error('agent.failure', 'Agent run terminated', {
          runId,
          taskId,
          attemptId: runId,
          toolCallId: directGenerateImageCallId || null,
          stage: failureStage,
          failureStage,
          failureCode: derivedFailureCode,
          retryable: !aborted && (error as any)?.outcomeUnknown !== true && (error as any)?.retryable === true,
          outcomeUnknown: (error as any)?.outcomeUnknown === true,
          aborted,
          failureMessage,
          error,
        });
        progressTracker.settleActive(
          'failed',
          aborted ? '运行已取消' : '运行失败',
        );
        writeLifecycleEvent({
          type: aborted ? 'agent_cancelled' : 'agent_error',
          ...(!aborted ? { code: classifyAgentFailureCode(error, failureStage) } : {}),
          stage: failureStage,
          providerId: resolvedChatSelection.providerId,
          model: resolvedChatSelection.model,
          message: failureMessage,
          failureStage,
          failureCode: derivedFailureCode,
          retryable: !aborted && (error as any)?.outcomeUnknown !== true && (error as any)?.retryable === true,
          outcomeUnknown: (error as any)?.outcomeUnknown === true,
          recoveryRecord,
          ...progressTracker.stamp(),
        });
      } finally {
        const pending = journalPending.get(controller as unknown as object) || [];
        await Promise.allSettled(pending);
        settleActiveAgentRun(runId);
        try { controller.close(); } catch { /* Client disconnected; task has still settled. */ }
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

export async function GET(request: NextRequest) {
  const threadId = request.nextUrl.searchParams.get('threadId')?.trim();
  if (!threadId) return NextResponse.json({ error: 'threadId is required' }, { status: 400 });
  const afterSequence = Number(request.nextUrl.searchParams.get('afterSequence') || 0);
  const beforeSequenceValue = request.nextUrl.searchParams.get('beforeSequence');
  let result = await queryThread(threadId, {
    afterSequence: Number.isFinite(afterSequence) ? afterSequence : 0,
    ...(beforeSequenceValue ? { beforeSequence: Number(beforeSequenceValue) } : {}),
  });
  const activeTurn = result.state.turns?.find((turn: any) => turn.turnId === result.state.activeTurn);
  const activeRun = activeTurn?.runId ? getActiveAgentRun(activeTurn.runId) : null;
  if (activeTurn && !activeRun) {
    await appendThreadEvent(threadId, {
      type: 'turn.failed', turnId: activeTurn.turnId, taskId: activeTurn.taskId || threadId,
      operationId: activeTurn.operationId, runId: activeTurn.runId,
      status: 'interrupted', error: { code: 'run_interrupted', message: 'The server restarted before this run completed. Continue or retry explicitly.' },
    });
    result = await queryThread(threadId, {
      afterSequence: Number.isFinite(afterSequence) ? afterSequence : 0,
      ...(beforeSequenceValue ? { beforeSequence: Number(beforeSequenceValue) } : {}),
    });
  }
  return NextResponse.json({ ...result, activeStream: Boolean(activeRun) });
}
