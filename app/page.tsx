'use client';

import React, { useState, useRef, useEffect, useLayoutEffect, useCallback, memo } from 'react';
import Image from 'next/image';
import { createPortal } from 'react-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import gsap from 'gsap';
import { ScrollToPlugin } from 'gsap/ScrollToPlugin';
import { useGSAP } from '@gsap/react';
import { 
  MousePointer2, Type, Image as ImageIcon,
  Share2, History, Settings, Paperclip,
  Send, Sparkles, X, ChevronDown, ChevronLeft, ChevronRight, Trash2, Edit3, ArrowLeft, Plus, SlidersHorizontal, Copy, Check, Video, Pencil, Package2, Workflow, Clock3, Eye, EyeOff, Moon, Sun, MessageCircle,
  MoreHorizontal, Upload, Library, Search, BrainCircuit, Settings2, ArrowUp, ArrowDown, Square, Pin
} from 'lucide-react';
import { GeneratedImageHistoryEntry, ProjectSession } from './lib/db';
import type { TaskSnapshot } from './lib/db';
import type { CanvasItem, CanvasPoint } from './lib/canvas-types';
import { isCanvasAnnotationItem, isCanvasAnnotationTextItem } from './lib/canvas-types';
import {
  CanvasRegionSelectionsLayer,
  ImageRegionCandidatePopover,
} from './components/workspace/ImageRegionSelectionUI';
import {
  buildAgentRegionSelectionSnapshot,
  canvasPointToImageNormalized,
  selectedRegionLabel,
  buildRegionBox,
  buildRegionEvidenceCrop,
  imageNormalizedToItemLocal,
} from './lib/image-region-selection.mjs';
import type { RegionSelection, RegionCandidate } from './lib/image-region-selection.types';
import {
  useImageRegionSelectionController,
  type RegionEvidence,
} from './hooks/useImageRegionSelectionController';
import {
  isCanvasPerformanceEnabled,
  useCanvasInteractionController,
  type CanvasInteractionCancelReason,
  type CanvasRegisteredTarget,
} from './hooks/useCanvasInteractionController';
import { ASPECT_RATIOS } from './lib/aspect-ratios';
import {
  appendGeneratedImageHistoryEntries,
  appendMissingGeneratedHistoryEntries,
  buildGeneratedImageHistorySortKey,
  buildGeneratedHistoryEntriesFromImageCard,
} from './lib/generated-image-history.mjs';
import {
  buildPersistedSession,
  normalizeTextCardPanelDrafts,
  normalizeProjectSession,
} from './lib/session-persistence.mjs';
import { resolveStateUpdate } from './lib/state-update.mjs';
import { resolveProviderModelSelection } from './lib/provider-model-selection.mjs';
import {
  clampCanvasAnchor,
  getCanvasViewportAtAnchor,
  normalizeCanvasWheelDelta,
} from './lib/canvas-viewport-motion.mjs';
import {
  applyDirectItemResize,
  applyDirectPan,
  applyDirectZoom,
  resolveDirectMarqueeSelection,
} from './lib/canvas-direct-interaction.mjs';
import {
  applyCanvasItemDragPositions,
  areCanvasPointsFullyContained,
  getCanvasDragDelta,
  getCanvasMarqueePath,
  getRotatedRectAabb,
  hasCanvasDragIntent,
  isRectIntersecting,
  matchesCanvasItemDragTransaction,
  normalizeCanvasMarqueeRect,
  projectCanvasPointToViewport,
  projectScreenRectToCanvas,
  resolveCanvasFixedOverlayAnchors,
  resolveCanvasItemDragReleasePositions,
  resolveCanvasMarqueeSelection,
  resolveCanvasPointerGesture,
} from './lib/canvas-interaction.mjs';
import { getCanvasImageWorkingSetIds } from './lib/canvas-image-working-set.mjs';
import {
  createInitialAgentRunProgress,
  createAgentProgressEventRouter,
  formatAgentProgressLabel,
  getAgentProgressElapsedMs,
  reduceAgentRunProgress,
  routeAgentProgressEvent,
  shouldShowAgentRunProgress,
} from './lib/agent/run-progress.mjs';
import { preloadGeneratedAsset } from './lib/agent/preload-generated-assets.mjs';
import { applyQueuedChatMessageUpdates } from './lib/chat-stream-update-batcher.mjs';
import { runGeneratedAssetPreloadQueue } from './lib/generated-asset-preload-queue.mjs';
import { buildAgentContextEntities } from './lib/agent/context-reference.mjs';
import type { AgentContextEntity, AgentProposal } from './lib/agent/context-reference.types';
import type {
  AgentRunProgress,
  AgentRunProgressEvent,
  AgentRunProgressStep,
} from './lib/agent/run-progress.types';
import {
  areCanvasUndoSnapshotsEqual,
  createCanvasUndoSnapshot,
  createCanvasMoveHistoryCommand,
  createEmptySessionCanvasHistoryState,
  pushUndoCommand,
  pushUndoSnapshot,
  redoSnapshot,
  undoSnapshot,
} from './lib/canvas-history.mjs';
import {
  appendImageCardOutput,
  buildAsyncImageTaskRequests,
  buildCanvasImageGenerationFailureMessage,
  buildImageCardOutputsState,
  buildCanvasImagePanelSubmitInput,
  buildCanvasTextPanelSubmitInput,
  CANVAS_TEXT_GENERATION_CONCURRENCY_LIMIT,
  IMAGE_CARD_MODEL_OPTIONS,
  TEXT_PANEL_MODEL_OPTIONS,
  canSubmitImageCardPanel,
  canSubmitTextCardPanel,
  canItemAcceptIncomingConnection,
  buildCanvasTextGenerationRequest,
  buildReferenceImageRequestPayload,
  canEnterManualTextMode,
  canStartCanvasTextGeneration,
  createCanvasClipboardSnapshot,
  createCanvasCardItemAtCanvasPoint,
  createWorkspaceModelOptions,
  finalizeManualTextCardItem,
  findWorkspaceModelOption,
  getDefaultImageCardModelOption,
  getDefaultTextPanelModelOption,
  getDisplayableTextCardPanelDraft,
  getGeneratedImageHistoryEntries,
  getDirectImagePreviewsForTextCard,
  getDirectTextInputsForTextCard,
  getGenerationDurationDisplay,
  getImageToolResultSpawnPosition,
  getImageCardFrameSizeForAspectRatio,
  getImageCardItemSizeForFrameSize,
  getImageCardItemSizeForNaturalImage,
  getImageCardQualitySummary,
  getSupportedImageCardSizeOptions,
  getSelectedImageToolbarSource,
  getCurrentImageCardOutput,
  isEventInsideTextCardPanel,
  extractImageFilesFromClipboardItems,
  getReplacedImageAssetItem,
  isImageAssetItem,
  isImageCardItem,
  moveCanvasItemsToFront,
  materializeCanvasClipboardPaste,
  reorderIncomingImageConnections,
  resolveCanvasImagePasteTarget,
  shouldHandleCanvasImagePaste,
  getViewportCenteredOnBounds,
  shouldSubmitTextCardPanelEnter,
  shouldFocusTextCardPanelInputOnPointerDown,
  getTextCardPanelPlaceholder,
  getTextCardVisualState,
  normalizeImageCardAspectRatio,
  removeCanvasTextGenerationEntry,
  resolveCanvasImageTaskExecutionMode,
  resolveFloatingPopoverOffset,
  resolveImageCardModel,
  resolveImageCardSize,
  resolveImageCardSizeForAspectRatio,
  resolveProviderDeletionFallbacks,
  resolveWorkspaceImageCardModel,
  resolveWorkspaceTextPanelChatModel,
  resolveSessionPresentationState,
  settleCanvasImageGenerationRequests,
  shouldPreventScrollableRegionWheelDefault,
  syncAutoResizedTextareaLayout,
  syncImageCardOptionsForProviderModel as syncWorkspaceImageCardOptionsForProviderModel,
} from './lib/workspace-session-view.mjs';
import {
  buildProviderImageOptionProfiles,
  DEFAULT_IMAGE_CARD_QUALITY_OPTIONS,
  getEnabledProviderModelAspectRatios,
  getProviderModelAspectRatios,
  getProviderModelQualityOptions,
  normalizeProviderModelAspectRatioForSize,
} from './lib/image-provider-option-profiles.mjs';
import { GalleryView, SessionActionErrorBanner } from './components/workspace/GalleryView';
import { AgentDecisionPopover } from './components/workspace/AgentDecisionPopover';
import { useWorkspaceSessionController } from './hooks/useWorkspaceSessionController';

gsap.registerPlugin(useGSAP, ScrollToPlugin);

const CANVAS_OVERLAY_Z = 120;
const CHAT_PANEL_Z = 180;
const GLOBAL_NOTICE_Z = 220;
const CANVAS_CLIPBOARD_PASTE_OFFSET = { x: 32, y: 32 };
const CANVAS_VIEWPORT_ANIMATION_SECONDS = 0.12;
const CANVAS_SNAPSHOT_COMMIT_IDLE_MS = 1200;
const CANVAS_IMAGE_WORKING_SET_ENTER_SCREENS = 1;
const CANVAS_IMAGE_WORKING_SET_RETAIN_SCREENS = 1.5;
const CANVAS_IMAGE_WORKING_SET_RELEASE_MS = 500;
const CHAT_PANEL_GSAP_OPEN_DURATION = 0.28;
const CHAT_PANEL_GSAP_CLOSE_DURATION = 0.23;
const CHAT_PANEL_GSAP_EASE = 'power3.out';
const PROMPT_PIPELINE_AGENT_ENABLED = process.env.NEXT_PUBLIC_PROMPT_PIPELINE_AGENT_ENABLED !== '0';
const GENERATED_IMAGE_HISTORY_PLACEHOLDER_PATTERN = /\[(?:Generated image[^\]]*omitted from chat history|聊天记录中省略了代理生成的图像)\]/gi;
const canOptimizeCanvasImage = (src: string) => src.startsWith('/api/local-assets/');

function useStableEvent<TArgs extends unknown[], TResult>(
  handler: (...args: TArgs) => TResult
) {
  const handlerRef = useRef(handler);
  useLayoutEffect(() => {
    handlerRef.current = handler;
  }, [handler]);
  return useCallback((...args: TArgs) => handlerRef.current(...args), []);
}

const hasPendingBrowserInput = () => {
  if (typeof navigator === 'undefined') return false;
  const scheduling = (navigator as Navigator & {
    scheduling?: {
      isInputPending?: (options?: { includeContinuous?: boolean }) => boolean;
    };
  }).scheduling;
  return scheduling?.isInputPending?.({ includeContinuous: true }) === true;
};

const AGENT_RETRY_CONFIRMATION_PATTERN = /^(?:同意|确认|可以|没问题|按(?:这个|此|上述)(?:方案)?来|就按(?:这个|此|上述)(?:方案)?|继续|开始吧)(?:[\s，,。.!！?？]*(?:(?:请)?(?:给我|帮我)?(?:继续)?(?:生成|制作|执行|出图)(?:这张|该张|图片|图像|封面|海报|任务)?))?[\s，,。.!！?？]*$/i;

const extractPlainText = (value: React.ReactNode): string =>
  React.Children.toArray(value)
    .map((child) => {
      if (typeof child === 'string' || typeof child === 'number') return String(child);
      if (React.isValidElement<{ children?: React.ReactNode }>(child)) {
        return extractPlainText(child.props.children);
      }
      return '';
    })
    .join('');

const sanitizeDownloadFileName = (value: string): string | null => {
  const normalizedValue = value.trim().replace(/[\\/:*?"<>|]+/g, '-');
  return normalizedValue.length > 0 ? normalizedValue : null;
};

const getDownloadFileNameFromDisposition = (headerValue: string | null): string | null => {
  if (!headerValue) return null;

  const utf8Match = headerValue.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match?.[1]) {
    try {
      const decodedValue = decodeURIComponent(utf8Match[1]);
      return sanitizeDownloadFileName(decodedValue);
    } catch {
      return sanitizeDownloadFileName(utf8Match[1]);
    }
  }

  const quotedMatch = headerValue.match(/filename="([^"]+)"/i);
  if (quotedMatch?.[1]) {
    return sanitizeDownloadFileName(quotedMatch[1]);
  }

  const unquotedMatch = headerValue.match(/filename=([^;]+)/i);
  if (unquotedMatch?.[1]) {
    return sanitizeDownloadFileName(unquotedMatch[1]);
  }

  return null;
};

const getFallbackImageDownloadName = (src: string): string => {
  try {
    const parsedUrl = src.startsWith('/')
      ? new URL(src, 'http://localhost')
      : new URL(src);
    const lastSegment = parsedUrl.pathname.split('/').filter(Boolean).at(-1) || 'zo-image.png';
    return sanitizeDownloadFileName(lastSegment) || 'zo-image.png';
  } catch {
    return 'zo-image.png';
  }
};

interface Connection {
  id: string;
  fromItemId: string;
  toItemId: string;
}

interface CanvasUndoSnapshot {
  items: CanvasItem[];
  connections: Connection[];
  textCardPanelDrafts: Record<string, string>;
  textCardProviderById: Record<string, string>;
  textCardModelById: Record<string, string>;
  imageCardPanelDrafts: Record<string, string>;
  imageCardProviderById: Record<string, string>;
  imageCardModelById: Record<string, string>;
  imageCardSizeById: Record<string, string>;
  imageCardQualityById: Record<string, string>;
  imageCardCountById: Record<string, number>;
  imageCardAspectRatioById: Record<string, string>;
}

interface CanvasMoveHistoryCommand {
  kind: 'move-items';
  before: Record<string, { x: number; y: number }>;
  after: Record<string, { x: number; y: number }>;
  orderBefore: string[];
  orderAfter: string[];
}

type CanvasHistoryEntry = CanvasUndoSnapshot | CanvasMoveHistoryCommand;

interface SessionCanvasHistoryState {
  past: CanvasHistoryEntry[];
  future: CanvasHistoryEntry[];
}

type ConnectionMode = 'idle' | 'armed' | 'dragging';

interface ConnectionSession {
  mode: 'dragging';
  fromItemId: string;
  pointerId: number;
  startPoint: { x: number; y: number };
  fromPoint: { x: number; y: number };
  point: { x: number; y: number };
  inputPortCandidates: Array<{ targetId: string; x: number; y: number }>;
  snapTargetId: string | null;
  moved: boolean;
}

interface ConnectionSnapTargetVisual {
  itemId: string;
  element: HTMLElement;
  opacity: string;
  visibility: string;
  pointerEvents: string;
  willChange: string;
}

type PortSide = 'left' | 'right';

interface FrozenPreviewConnection {
  from: { x: number; y: number };
  to: { x: number; y: number };
}

interface PendingConnectionMenu {
  fromItemId: string;
  position: { x: number; y: number };
}

type ChatMessageInlineSegment =
  | { type: 'text'; text: string }
  | {
      type: 'reference';
      referenceId: string;
      id?: string;
      src?: string;
      label?: string;
      source?: 'upload' | 'history' | 'canvas';
      annotationCount?: number;
    };

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'skill';
  content: string;
  reasoningContent?: string;
  imageUrl?: string;
  taskKey?: string;
  taskStatus?: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  skill?: { id: string; label: string };
  referenceImages?: string[];
  referenceContext?: AgentReferenceContext;
  inlineContent?: ChatMessageInlineSegment[];
  resultTitle?: string;
  resultSummary?: string;
  imageOperation?: 'generate' | 'edit';
  imageProviderId?: string;
  sourceReferenceId?: string;
  promptTrace?: {
    sourcePrompt: string;
    finalPrompt: string;
    optimized: boolean;
    operation: 'generate' | 'edit';
    targetReferenceId: string | null;
  };
  model?: string;
  imageName?: string;
  skillChoice?: SkillChoicePayload;
  skillChoiceDismissed?: boolean;
  skillChoiceResolved?: boolean;
  agentRunProgress?: AgentRunProgress;
  agentConfirmation?: AgentConfirmationPayload;
  agentConfirmationDismissed?: boolean;
  agentConfirmationResolved?: boolean;
  agentClarification?: AgentClarificationPayload;
  agentClarificationResponsePayload?: {
    clarification: AgentClarificationPayload;
    response: AgentClarificationResponse;
  };
  agentClarificationDismissed?: boolean;
  agentClarificationResolved?: boolean;
  agentProposal?: AgentProposal;
  agentProposalDismissed?: boolean;
  agentProposalResolved?: boolean;
  resolvedContext?: { entityIds: string[]; labels: string[]; kind: string; confidence: 'high' | 'medium' };
  executionBriefSummary?: string;
  taskSnapshot?: TaskSnapshot;
}

const updateAgentRunProgress = (
  message: ChatMessage,
  event: AgentRunProgressEvent,
): ChatMessage => {
  const nextProgress = reduceAgentRunProgress(message.agentRunProgress || null, event);
  if (nextProgress) return { ...message, agentRunProgress: nextProgress };
  return message.agentRunProgress ? { ...message, agentRunProgress: undefined } : message;
};

const applyAgentRunProgressEvents = (
  message: ChatMessage,
  events: AgentRunProgressEvent[],
) => events.reduce(updateAgentRunProgress, message);

const getAgentProgressMarker = (
  status: AgentRunProgressStep['status'] | AgentRunProgress['outcome'],
) => status === 'completed' ? '✓' : status === 'waiting' ? '⏸' : status === 'active' || status === 'running' ? '○' : '!';

const getAgentProgressCompletionLabel = (progress: AgentRunProgress) => {
  if (progress.outcome === 'warning') {
    return `⚠️ 部分完成（${progress.assets.succeeded}/${progress.assets.expected} 张资产可用）`;
  }
  if (progress.outcome === 'failed') return '❌ 任务失败，请重试';
  if (progress.outcome !== 'completed') return '⏳ 正在结算生成资产';
  if (progress.intent === 'chat') return '✍️ 回复已完成';
  if (progress.intent === 'image') return '🖼️ 设计生成已完成';
  return '⚙️ 任务已完成';
};

const isAgentImageGenerationStep = (step: AgentRunProgressStep) =>
  step.toolName === 'generate_image' || step.stepId === 'generate_image';

const getAgentProgressDurationLabel = (step: AgentRunProgressStep, now: number) => {
  const elapsedMs = getAgentProgressElapsedMs(step, now);
  return elapsedMs === null ? null : getGenerationDurationDisplay(elapsedMs);
};

interface SkillChoiceOption {
  label: string;
  submitText: string;
}

interface SkillChoicePayload {
  id: string;
  title: string;
  message: string;
  options: SkillChoiceOption[];
}

interface AgentClarificationOption {
  id: string;
  label: string;
  answer: string;
  description?: string;
}

interface AgentClarificationState {
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
  referenceContext?: AgentReferenceContext;
  contextCandidates?: AgentContextEntity[];
  resolvedImageCount?: number;
  resolvedImageCountSource?: 'clarification' | 'prompt' | 'interface' | 'default' | 'batch';
  requestedImageCountTotal?: number;
  pendingImageCountCandidates?: number[];
  imageBatchPlan?: {
    totalCount: number;
    completedCount: number;
    remainingCount: number;
    batchSize: number;
  };
  plannerFailure?: {
    reason: 'timeout' | 'transport' | 'invalid_reference' | 'invalid_context' | 'invalid_plan' | 'vision_unsupported' | 'vision_unavailable';
    retryMode: 'replan';
    failedAt: number;
  };
}

interface AgentClarificationRequest {
  id: string;
  taskId: string;
  question: string;
  dimension: string;
  options: AgentClarificationOption[];
  allowCustom: true;
  allowProceed: true;
  failed?: boolean;
}

interface AgentClarificationPayload {
  request: AgentClarificationRequest;
  state: AgentClarificationState;
}

interface AgentConfirmationPayload {
  confirmationId: string;
  toolName: string;
  message: string;
}

interface AgentClarificationResponse {
  requestId: string;
  selectedOptionId?: string;
  customText?: string;
  proceedWithCurrent?: boolean;
  retry?: boolean;
  retryMode?: 'replan';
}

interface AssistantTextSelectionSession {
  startedInAssistant: boolean;
  isPointerDown: boolean;
  hasSelection: boolean;
  suppressOutsideClickUntil: number;
}

interface CanvasClipboardSnapshot {
  items: CanvasItem[];
  bounds: {
    left: number;
    top: number;
    right: number;
    bottom: number;
  };
  textCardPanelDrafts: Record<string, string>;
  textCardProviderById: Record<string, string>;
  textCardModelById: Record<string, string>;
  imageCardPanelDrafts: Record<string, string>;
  imageCardProviderById: Record<string, string>;
  imageCardModelById: Record<string, string>;
  imageCardSizeById: Record<string, string>;
  imageCardQualityById: Record<string, string>;
  imageCardCountById: Record<string, number>;
  imageCardAspectRatioById: Record<string, string>;
}

interface MaterializedCanvasClipboardPaste {
  items: CanvasItem[];
  selectedIds: string[];
  textCardPanelDrafts: Record<string, string>;
  textCardProviderById: Record<string, string>;
  textCardModelById: Record<string, string>;
  imageCardPanelDrafts: Record<string, string>;
  imageCardProviderById: Record<string, string>;
  imageCardModelById: Record<string, string>;
  imageCardSizeById: Record<string, string>;
  imageCardQualityById: Record<string, string>;
  imageCardCountById: Record<string, number>;
  imageCardAspectRatioById: Record<string, string>;
  nextPasteCount: number;
}

interface ChatTopic {
  id: string;
  title: string;
  messages: ChatMessage[];
  activeSkill?: { id: string; label: string } | null;
  activeSkillExplicit?: boolean;
  createdAt: number;
  updatedAt: number;
}

interface SessionLiveState {
  items: CanvasItem[];
  connections: Connection[];
  textCardPanelDrafts: Record<string, string>;
  textCardProviderById: Record<string, string>;
  textCardModelById: Record<string, string>;
  imageCardPanelDrafts: Record<string, string>;
  imageCardProviderById: Record<string, string>;
  imageCardModelById: Record<string, string>;
  imageCardSizeById: Record<string, string>;
  imageCardQualityById: Record<string, string>;
  imageCardCountById: Record<string, number>;
  imageCardAspectRatioById: Record<string, string>;
  chatMessages: ChatMessage[];
  activeSkill: { id: string; label: string } | null;
  chatProviderId: string;
  chatModelId: string;
  imageProviderId: string;
  imageModelId: string;
  generatedImageHistoryBySession: Record<string, GeneratedImageHistoryEntry[]>;
  viewport: { x: number; y: number; scale: number };
  regionSelections: RegionSelection[];
}

type Tool = 'select' | 'target' | 'draw' | 'annotation-text';
type GenerationMode = 'agent' | 'image' | 'chat';
type ChatReferenceTokenRole = 'reference' | 'edit_target' | 'annotation_bundle' | 'region_target';
type ChatReferenceTokenSource = 'upload' | 'history' | 'canvas';

interface ChatReferenceToken {
  id: string;
  src: string;
  label: string;
  source: ChatReferenceTokenSource;
  canvasItemId?: string;
  transient: boolean;
  pinned: boolean;
  role: ChatReferenceTokenRole;
  annotationCount?: number;
  annotationItemIds?: string[];
  regionId?: string;
  candidateId?: string;
  description?: string;
  aliases?: string[];
  confidence?: 'high' | 'medium' | 'low';
  confirmationStatus?: 'pending' | 'confirmed';
  sourceTaskId?: string;
  sourceVersionId?: string;
  previewSrc?: string;
  targetPoint?: { x: number; y: number };
  targetBox?: { x: number; y: number; width: number; height: number };
  uploadStatus?: 'uploading' | 'failed';
  uploadError?: string;
  uploadFile?: File;
  previewObjectUrl?: string;
}

interface AgentReferenceContext {
  references: Array<{
    id: string;
    src: string;
    plannerPreviewSrc?: string;
    label: string;
    source: ChatReferenceTokenSource;
    canvasItemId?: string;
    role: ChatReferenceTokenRole;
    annotationCount?: number;
    regionId?: string;
    candidateId?: string;
    description?: string;
    aliases?: string[];
    confidence?: 'high' | 'medium' | 'low';
    confirmationStatus?: 'pending' | 'confirmed';
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
}

type ChatComposerSegment =
  | { type: 'text'; text: string }
  | { type: 'reference'; tokenId: string };

interface DraftStroke {
  pointerId: number;
  points: CanvasPoint[];
  color: string;
  width: number;
}

interface CanvasAnnotationContext {
  targetImage?: {
    id: string;
    src: string;
    x: number;
    y: number;
    width: number;
    height: number;
  };
  annotations: Array<Record<string, unknown>>;
  annotationItemIds: string[];
  annotationCount: number;
  ambiguousImageTarget: boolean;
  compositePreviewUrl?: string;
  compositePreviewError?: string;
}

const DEFAULT_ANNOTATION_COLOR = '#ef4444';
const DEFAULT_ANNOTATION_STROKE_WIDTH = 5;
const ANNOTATION_STROKE_WIDTHS = [
  { label: '细', value: 2 },
  { label: '中', value: 5 },
  { label: '粗', value: 9 },
] as const;
const ANNOTATION_COLORS = ['#ef4444', '#f97316', '#facc15', '#22c55e', '#3b82f6', '#ffffff', '#18181b'] as const;
const ANNOTATION_TEXT_DEFAULT_WIDTH = 260;
const ANNOTATION_TEXT_DEFAULT_HEIGHT = 36;
const ANNOTATION_TEXT_DEFAULT_FONT_SIZE = 20;

const getChatComposerPlainText = (segments: ChatComposerSegment[]): string =>
  segments
    .filter((segment): segment is Extract<ChatComposerSegment, { type: 'text' }> => segment.type === 'text')
    .map((segment) => segment.text)
    .join('');

const mergeAdjacentChatComposerText = (segments: ChatComposerSegment[]): ChatComposerSegment[] => {
  const merged: ChatComposerSegment[] = [];
  for (const segment of segments) {
    if (segment.type === 'text' && !segment.text) continue;
    const previous = merged.at(-1);
    if (segment.type === 'text' && previous?.type === 'text') {
      previous.text += segment.text;
    } else {
      merged.push(segment.type === 'text' ? { ...segment } : segment);
    }
  }
  return merged;
};

const insertReferenceSegmentsAtTextOffset = (
  segments: ChatComposerSegment[],
  tokenIds: string[],
  requestedAnchor: { textOffset: number; referenceCount: number }
): ChatComposerSegment[] => {
  if (tokenIds.length === 0) return segments;
  const offset = Math.max(0, Math.min(requestedAnchor.textOffset, getChatComposerPlainText(segments).length));
  const referenceCount = Math.max(0, requestedAnchor.referenceCount);
  const inserted = tokenIds.map((tokenId) => ({ type: 'reference' as const, tokenId }));
  const next: ChatComposerSegment[] = [];
  let consumedText = 0;
  let consumedReferences = 0;
  let didInsert = false;

  for (const segment of segments) {
    if (!didInsert && consumedText === offset && consumedReferences === referenceCount) {
      next.push(...inserted);
      didInsert = true;
    }
    if (!didInsert && segment.type === 'text' && consumedReferences === referenceCount && consumedText + segment.text.length > offset) {
      const localOffset = offset - consumedText;
      if (localOffset > 0) next.push({ type: 'text', text: segment.text.slice(0, localOffset) });
      next.push(...inserted);
      if (localOffset < segment.text.length) next.push({ type: 'text', text: segment.text.slice(localOffset) });
      didInsert = true;
    } else {
      next.push(segment);
    }
    if (segment.type === 'text') consumedText += segment.text.length;
    else consumedReferences += 1;
  }

  if (!didInsert) next.push(...inserted);
  return mergeAdjacentChatComposerText(next);
};

const replaceChatComposerTextPreservingReferences = (
  segments: ChatComposerSegment[],
  text: string
): ChatComposerSegment[] => {
  const referencesByOffset = new Map<number, string[]>();
  let offset = 0;
  for (const segment of segments) {
    if (segment.type === 'text') {
      offset += segment.text.length;
      continue;
    }
    const tokenIds = referencesByOffset.get(offset) || [];
    tokenIds.push(segment.tokenId);
    referencesByOffset.set(offset, tokenIds);
  }

  const next: ChatComposerSegment[] = [];
  let cursor = 0;
  for (const [referenceOffset, tokenIds] of [...referencesByOffset.entries()].sort((a, b) => a[0] - b[0])) {
    const clampedOffset = Math.max(cursor, Math.min(referenceOffset, text.length));
    if (clampedOffset > cursor) next.push({ type: 'text', text: text.slice(cursor, clampedOffset) });
    next.push(...tokenIds.map((tokenId) => ({ type: 'reference' as const, tokenId })));
    cursor = clampedOffset;
  }
  if (cursor < text.length) next.push({ type: 'text', text: text.slice(cursor) });
  return mergeAdjacentChatComposerText(next);
};

const materializeChatMessageInlineContent = (
  segments: ChatComposerSegment[],
  referenceTokens: ChatReferenceToken[]
): ChatMessageInlineSegment[] => {
  const tokenById = new Map(referenceTokens.map((token) => [token.id, token]));
  return segments.flatMap((segment): ChatMessageInlineSegment[] => {
    if (segment.type === 'text') {
      return segment.text ? [{ type: 'text', text: segment.text }] : [];
    }
    const token = tokenById.get(segment.tokenId);
    if (!token) return [];
    return [{
      type: 'reference',
      referenceId: token.id,
    }];
  });
};

type ResolvedChatMessageInlineSegment =
  | { type: 'text'; text: string }
  | {
      type: 'reference';
      id: string;
      src: string;
      label: string;
      source: 'upload' | 'history' | 'canvas';
      annotationCount?: number;
    };

const resolveChatMessageInlineContent = (message: ChatMessage): ResolvedChatMessageInlineSegment[] => {
  const referenceById = new Map(
    (message.referenceContext?.references || []).map((reference) => [reference.id, reference])
  );
  if (message.inlineContent?.length) {
    return message.inlineContent.flatMap<ResolvedChatMessageInlineSegment>((segment, index) => {
      if (segment.type === 'text') return [segment];
      const referenceId = segment.referenceId || segment.id || '';
      const reference = referenceById.get(referenceId);
      const src = reference?.src || segment.src;
      if (!src) return [];
      return [{
        type: 'reference' as const,
        id: referenceId || `${message.id}-inline-reference-${index}`,
        src,
        label: reference?.label || segment.label || `image${index + 1}`,
        source: reference?.source || segment.source || 'upload',
        annotationCount: reference?.annotationCount || segment.annotationCount,
      }];
    });
  }
  if (message.referenceContext?.composerSegments?.length) {
    return message.referenceContext.composerSegments.flatMap<ResolvedChatMessageInlineSegment>((segment) => {
      if (segment.type === 'text') return [segment];
      const reference = referenceById.get(segment.referenceId);
      return reference ? [{
        type: 'reference' as const,
        id: reference.id,
        src: reference.src,
        label: reference.label,
        source: reference.source,
        annotationCount: reference.annotationCount,
      }] : [];
    });
  }
  return [
    ...(message.referenceImages || []).map((src, index) => ({
      type: 'reference' as const,
      id: `${message.id}-legacy-reference-${index}`,
      src,
      label: `image${index + 1}`,
      source: 'upload' as const,
    })),
    ...(message.content ? [{ type: 'text' as const, text: message.content }] : []),
  ];
};
type ProviderSettingsProviderId = string;
type ProviderSettingsSource = 'runtime' | 'env';
type ProviderProtocol = 'openai' | 'gemini';
type ProviderImageRequestMode = 'openai' | 'openai-json';
type ProviderImageApiKeyScope = 'all' | 'gemini' | 'gpt';

interface ProviderSettingsImageApiKey {
  id: string;
  apiKey: string;
  scope: ProviderImageApiKeyScope;
  hasApiKey?: boolean;
  maskedApiKey?: string;
}

interface ProviderSettingsImageApiKeyRow extends ProviderSettingsImageApiKey {
  isVisible: boolean;
}

interface ProviderSettingsCompatibilityResponse {
  providerId: ProviderSettingsProviderId;
  baseUrl: string;
  apiKey?: string;
  hasApiKey: boolean;
  maskedApiKey: string;
  source: ProviderSettingsSource;
  updatedAt?: string;
}

interface ProviderSettingsItem {
  id: string;
  name: string;
  baseUrl: string;
  protocol: ProviderProtocol;
  imageRequestMode: ProviderImageRequestMode;
  imageGenerationEndpoint: string;
  imageEditEndpoint: string;
  enabled: boolean;
  primary: boolean;
  imageModels: string[];
  chatModels: string[];
  modelProtocols: Record<string, ProviderProtocol>;
  apiKey: string;
  imageApiKeys: ProviderSettingsImageApiKey[];
  hasApiKey: boolean;
  maskedApiKey: string;
  source: ProviderSettingsSource;
  updatedAt?: string;
}

interface ProviderSettingsResponse {
  providers: ProviderSettingsItem[];
}

interface ProviderConnectionTestResult {
  ok: boolean;
  status: number;
  message: string;
  modelCount: number;
  imageModels: string[];
  chatModels: string[];
  imageRequestMode: ProviderImageRequestMode;
}

interface ProviderFetchedModelsResult extends ProviderConnectionTestResult {
  allModels: string[];
  modelSources?: Record<string, string[]>;
}

type ProviderSettingsModelPickerCategory = 'all' | 'image' | 'chat';

interface WorkspaceModelOption {
  id: string;
  label: string;
  providerId: string;
  providerName: string;
}

type ChatPanelModelPurpose = 'chat' | 'image';

interface ChatPanelModelSelectorProps {
  purpose: ChatPanelModelPurpose;
  providers: ProviderSettingsItem[];
  providerId: string | null;
  model: string | null;
  open: boolean;
  disabled: boolean;
  loading: boolean;
  loadFailed: boolean;
  align?: 'left' | 'right';
  containerRef: React.RefObject<HTMLDivElement>;
  onToggle: () => void;
  onSelect: (providerId: string, model: string) => void;
  onOpenSettings: () => void;
  onRetry: () => void;
}

const ChatPanelModelSelector = memo(function ChatPanelModelSelector({
  purpose,
  providers,
  providerId,
  model,
  open,
  disabled,
  loading,
  loadFailed,
  align = 'left',
  containerRef,
  onToggle,
  onSelect,
  onOpenSettings,
  onRetry,
}: ChatPanelModelSelectorProps) {
  const modelsKey = purpose === 'chat' ? 'chatModels' : 'imageModels';
  const label = purpose === 'chat' ? '对话' : '生图';
  const emptyLabel = loadFailed
    ? '供应商加载失败'
    : loading
      ? '正在加载供应商…'
      : purpose === 'chat'
        ? '未配置聊天模型'
        : '未配置生图模型';
  const selectedProvider = providers.find((provider) => provider.id === providerId) || null;
  const selectedProviderName = selectedProvider?.name || selectedProvider?.id || '';
  const hasSelection = Boolean(selectedProvider && model);
  const availableProviders = providers.filter((provider) => provider[modelsKey].length > 0);
  const [draftProviderId, setDraftProviderId] = useState(providerId || '');
  const activeProvider =
    availableProviders.find((provider) => provider.id === draftProviderId) ||
    selectedProvider ||
    availableProviders[0] ||
    null;

  return (
    <div ref={containerRef} className="relative min-w-0">
      <button
        type="button"
        disabled={disabled}
        onClick={(event) => {
          event.stopPropagation();
          if (!open) {
            setDraftProviderId(providerId || availableProviders[0]?.id || '');
          }
          onToggle();
        }}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={`${label}供应商与模型：${hasSelection ? `${selectedProviderName} / ${model}` : emptyLabel}`}
        title={hasSelection ? `${selectedProviderName} / ${model}` : emptyLabel}
        className={`workspace-control-chip flex h-9 w-full min-w-0 items-center gap-2 rounded-xl px-2.5 text-left ${open ? 'is-active' : ''}`}
      >
        {purpose === 'chat' ? <MessageCircle size={13} /> : <ImageIcon size={13} />}
        <span className="min-w-0 flex-1 truncate text-[11px] font-medium tracking-[-0.01em]">
          <span className="workspace-text-muted">{purpose === 'chat' ? '对话 · ' : '生图 · '}</span>
          {hasSelection ? `${selectedProviderName} / ${model}` : emptyLabel}
        </span>
        <ChevronDown size={12} className="shrink-0" data-gsap-chevron="true" />
      </button>

      {open && (
        <div
          className={`workspace-menu-panel absolute bottom-full z-30 mb-2 w-[min(340px,calc(100vw-2rem))] overflow-hidden rounded-2xl ${align === 'right' ? 'right-0' : 'left-0'}`}
          role="listbox"
          aria-label={`${label}供应商与模型`}
        >
          {availableProviders.length > 0 ? (
            <div className="grid max-h-[300px] grid-cols-[112px_minmax(0,1fr)]">
              <div className="workspace-subtle-divider border-r p-1.5">
                <div className="workspace-text-muted px-2 py-1 text-[10px] font-medium">供应商</div>
                {availableProviders.map((provider) => {
                  const selected = provider.id === activeProvider?.id;
                  return (
                    <button
                      key={provider.id}
                      type="button"
                      className={`workspace-menu-item flex w-full items-center justify-between gap-2 rounded-xl px-2 py-1.5 text-left text-xs ${selected ? 'is-selected' : ''}`}
                      onClick={() => setDraftProviderId(provider.id)}
                    >
                      <span className="truncate">{provider.name || provider.id}</span>
                      {selected && <Check size={11} className="shrink-0" />}
                    </button>
                  );
                })}
              </div>
              <div className="min-w-0 p-1.5">
                <div className="workspace-text-muted px-2 py-1 text-[10px] font-medium">模型</div>
                <div className="panel-scrollbar max-h-[250px] overflow-y-auto">
                  {(activeProvider?.[modelsKey] || []).map((modelId) => {
                    const selected = activeProvider?.id === providerId && modelId === model;
                    return (
                      <button
                        key={`${activeProvider?.id}-${modelId}`}
                        type="button"
                        title={modelId}
                        className={`workspace-menu-item flex w-full items-center justify-between gap-2 rounded-xl px-2 py-1.5 text-left text-xs ${selected ? 'is-selected' : ''}`}
                        onClick={() => activeProvider && onSelect(activeProvider.id, modelId)}
                      >
                        <span className="truncate">{modelId}</span>
                        {selected && <Check size={11} className="shrink-0" />}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          ) : (
            <div className="p-3">
              <div className="workspace-text-muted px-1 pb-2 text-xs">{emptyLabel}</div>
              {loadFailed ? (
                <button
                  type="button"
                  className="workspace-menu-item w-full rounded-xl px-3 py-2 text-left text-xs"
                  onClick={onRetry}
                >
                  重新加载
                </button>
              ) : !loading ? (
                <button
                  type="button"
                  className="workspace-menu-item w-full rounded-xl px-3 py-2 text-left text-xs"
                  onClick={onOpenSettings}
                >
                  打开供应商设置
                </button>
              ) : null}
            </div>
          )}
        </div>
      )}
    </div>
  );
});

const tools = [
  { id: 'select', icon: MousePointer2, label: '选择' },
  { id: 'text', icon: Type, label: '文字' },
  { id: 'image', icon: ImageIcon, label: '图片' },
];

const DEFAULT_QUICK_ACTIONS = [
  { id: 'logo', label: 'Logo 与品牌' },
  { id: 'brand', label: '品牌识别系统' },
  { id: 'api-helper', label: 'API 助手' },
];

const PROVIDER_SETTINGS_PRESET_OPTIONS = [
  { id: 'comfly', name: 'Comfly', baseUrl: 'https://ai.comfly.org/v1', protocol: 'openai', imageRequestMode: 'openai' },
  { id: 'gpt-best', name: 'GPT-Best', baseUrl: 'https://gpt-best.cn', protocol: 'openai', imageRequestMode: 'openai' },
  { id: 'custom', name: '自定义', baseUrl: 'https://api.openai.com/v1', protocol: 'openai', imageRequestMode: 'openai' },
] as const;

const getProviderSettingsProviderLabel = (providerId: ProviderSettingsProviderId) =>
  PROVIDER_SETTINGS_PRESET_OPTIONS.find((option) => option.id === providerId)?.name || providerId || '自定义';

const PROVIDER_PROTOCOL_OPTIONS = [
  { id: 'openai', label: 'OpenAI Compatible' },
  { id: 'gemini', label: 'Gemini' },
] as const;

const PROVIDER_IMAGE_REQUEST_MODE_OPTIONS = [
  { id: 'openai', label: 'openai' },
  { id: 'openai-json', label: 'openai-json' },
] as const;

const PROVIDER_IMAGE_API_KEY_SCOPE_OPTIONS = [
  { id: 'all', label: '全部' },
  { id: 'gemini', label: 'Gemini' },
  { id: 'gpt', label: 'OpenAI' },
] as const;

const PROVIDER_SETTINGS_MODEL_PICKER_CATEGORIES = ['all', 'image', 'chat'] as const;
const PROVIDER_SETTINGS_MODEL_PICKER_LABELS: Record<ProviderSettingsModelPickerCategory, string> = {
  all: '全部',
  image: '图片',
  chat: '聊天',
};
const CANVAS_CHAT_PANEL_RESERVED_WIDTH = 500;

const uniqueModelIds = (models: string[]) =>
  Array.from(new Set(models.map((model) => model.trim()).filter(Boolean)));

const normalizeProviderSettingsModelProtocols = (
  modelProtocols?: Record<string, ProviderProtocol>,
  allowedModels?: string[]
): Record<string, ProviderProtocol> => {
  const allowedModelSet = allowedModels ? new Set(uniqueModelIds(allowedModels)) : null;
  return Object.entries(modelProtocols || {}).reduce<Record<string, ProviderProtocol>>((result, [modelId, protocol]) => {
    const normalizedModelId = modelId.trim();
    if (!normalizedModelId || (protocol !== 'openai' && protocol !== 'gemini')) return result;
    if (allowedModelSet && !allowedModelSet.has(normalizedModelId)) return result;
    result[normalizedModelId] = protocol;
    return result;
  }, {});
};

const getFetchedModelCategory = (
  modelId: string,
  fetchedModels: ProviderFetchedModelsResult | null,
  categoryById: Record<string, 'image' | 'chat'>
): 'image' | 'chat' => {
  const normalizedModelId = modelId.trim();
  if (categoryById[normalizedModelId]) {
    return categoryById[normalizedModelId];
  }
  if (fetchedModels?.imageModels.includes(normalizedModelId)) {
    return 'image';
  }
  return 'chat';
};

const maskProviderSettingsApiKeyForDisplay = (apiKey: string) => {
  if (!apiKey) return '';
  if (apiKey.length <= 4) return '*'.repeat(apiKey.length);
  if (apiKey.length <= 8) {
    return `${apiKey.slice(0, 2)}${'*'.repeat(apiKey.length - 4)}${apiKey.slice(-2)}`;
  }
  return `${apiKey.slice(0, 4)}${'*'.repeat(apiKey.length - 8)}${apiKey.slice(-4)}`;
};

const createProviderSettingsDraftId = (providers: ProviderSettingsItem[]) => {
  const existingIds = new Set(providers.map((provider) => provider.id));
  if (!existingIds.has('provider')) {
    return 'provider';
  }

  let nextIndex = 2;
  while (existingIds.has(`provider-${nextIndex}`)) {
    nextIndex += 1;
  }
  return `provider-${nextIndex}`;
};

const createProviderSettingsDraftProvider = (providers: ProviderSettingsItem[]): ProviderSettingsItem => {
  const draftId = createProviderSettingsDraftId(providers);
  return {
    id: draftId,
    name: '',
    baseUrl: '',
    protocol: 'openai',
    imageRequestMode: 'openai',
    imageGenerationEndpoint: '',
    imageEditEndpoint: '',
    enabled: true,
    primary: providers.length === 0,
    imageModels: [],
    chatModels: [],
    modelProtocols: {},
    apiKey: '',
    imageApiKeys: [],
    hasApiKey: false,
    maskedApiKey: '',
    source: 'runtime',
    updatedAt: new Date().toISOString(),
  };
};

const createProviderSettingsImageApiKeyRow = (
  row?: Partial<ProviderSettingsImageApiKey>,
  index = 0
): ProviderSettingsImageApiKeyRow => {
  const apiKey = row?.apiKey || '';
  return {
    id: row?.id || `image-key-${Date.now()}-${index + 1}`,
    apiKey,
    scope: row?.scope || 'all',
    hasApiKey: Boolean(apiKey || row?.hasApiKey),
    maskedApiKey: row?.maskedApiKey || maskProviderSettingsApiKeyForDisplay(apiKey),
    isVisible: false,
  };
};

const normalizeProviderSettingsImageApiKeyRows = (
  rows?: ProviderSettingsImageApiKey[]
): ProviderSettingsImageApiKeyRow[] => {
  const sourceRows = Array.isArray(rows) ? rows : [];
  return sourceRows.length > 0
    ? sourceRows.map((row, index) => createProviderSettingsImageApiKeyRow(row, index))
    : [createProviderSettingsImageApiKeyRow()];
};

const persistProviderSettingsImageApiKeys = (
  rows: ProviderSettingsImageApiKey[]
): ProviderSettingsImageApiKey[] =>
  rows
    .filter((row) => row.apiKey.trim().length > 0)
    .map((row, index) => ({
      id: row.id || `image-key-${index + 1}`,
      apiKey: row.apiKey,
      scope: row.scope,
    }));

type SkillSelectSource = 'center_quick_action' | 'bottom_skill_bar';

const SKILL_DEFAULT_PROMPTS: Record<string, string> = {
  brand: '请按品牌识别系统流程开始信息收集，先询问我行业、品牌名称、补充说明和 logo 参考图（可选）。',
  logo: '请按 Logo 与品牌流程开始信息收集，先询问我品牌名称、行业、风格偏好和使用场景，再给出 2-3 个方向供我确认。',
};

const SKILL_CHOICE_START = '<<skill_choice>>';
const SKILL_CHOICE_END = '<</skill_choice>>';
const CANVAS_NODE_CORNER_RADIUS = 5;
const CORNER_HANDLE_GAP = 10;
const CORNER_HANDLE_STROKE = 4;
const HANDLE_ARC_RADIUS = CANVAS_NODE_CORNER_RADIUS + CORNER_HANDLE_GAP;
const CORNER_HANDLE_PADDING = CORNER_HANDLE_STROKE / 2;
const CORNER_HANDLE_SIZE = HANDLE_ARC_RADIUS * 2 + CORNER_HANDLE_PADDING * 2;
const CORNER_HANDLE_CENTER = HANDLE_ARC_RADIUS + CORNER_HANDLE_PADDING;
const CORNER_HANDLE_OFFSET = -(CORNER_HANDLE_GAP + CORNER_HANDLE_PADDING);
const CORNER_HANDLE_HIT_SIZE = HANDLE_ARC_RADIUS + CORNER_HANDLE_PADDING * 2;
const CORNER_HANDLE_HIT_OFFSET = CORNER_HANDLE_OFFSET + (CORNER_HANDLE_SIZE - CORNER_HANDLE_HIT_SIZE) / 2;
const CORNER_HANDLE_VISUAL_OFFSET = -(CORNER_HANDLE_SIZE - CORNER_HANDLE_HIT_SIZE) / 2;
const PORT_ICON_SIZE = 46;
const PORT_ICON_RADIUS = PORT_ICON_SIZE / 2;
const PORT_OUTER_GAP = 26;
const PORT_PROXIMITY_SIZE = 84;
const CONNECTION_ANCHOR_EDGE_GAP = 8;
const IMAGE_DISPLAY_MIN_SIDE = 512;
const IMAGE_NODE_OVERLAY_GAP_PX = 10;

function isCanvasItemDragTarget(target: CanvasRegisteredTarget): boolean {
  const { role } = target;
  return role === 'node-drag' ||
    role === 'annotation-drag' ||
    role === 'selection-group' ||
    role === 'input-port' ||
    role === 'input-port-bridge' ||
    role === 'output-port' ||
    role === 'output-port-bridge' ||
    role.startsWith('region-');
}

const getPortCanvasPoint = (item: CanvasItem, side: PortSide) => ({
  x:
    side === 'left'
      ? item.x - PORT_ICON_RADIUS - PORT_OUTER_GAP
      : item.x + item.width + PORT_ICON_RADIUS + PORT_OUTER_GAP,
  y: item.y + item.height / 2,
});
const TEXT_CARD_DIMENSIONS = {
  width: 380,
  height: 430,
} as const;
const TEXT_CARD_FRAME_INSET_X = 16;
const TEXT_CARD_FRAME_TOP = 24;
const TEXT_CARD_FRAME_BOTTOM = 12;
const IMAGE_CARD_MIN_EDGE = 384;
const IMAGE_CARD_DIMENSIONS = {
  width: IMAGE_CARD_MIN_EDGE + TEXT_CARD_FRAME_INSET_X * 2,
  height: IMAGE_CARD_MIN_EDGE + TEXT_CARD_FRAME_TOP + TEXT_CARD_FRAME_BOTTOM,
} as const;
const TEXT_CARD_GENERATION_PANEL_DEFAULT_WIDTH = 720;
const IMAGE_CARD_GENERATION_PANEL_DEFAULT_WIDTH = 720;
const TEXT_CARD_GENERATION_PANEL_BASE_HEIGHT = 156;
const TEXT_CARD_GENERATION_PANEL_PREVIEW_HEIGHT = 92;
const TEXT_CARD_PANEL_INPUT_MIN_ROWS = 2;
const TEXT_CARD_PANEL_INPUT_MAX_ROWS = 6;
const TEXT_CARD_PANEL_INPUT_LINE_HEIGHT = 24;
const TEXT_CARD_PANEL_INPUT_MIN_HEIGHT = 52;
const TEXT_CARD_PANEL_INPUT_MAX_HEIGHT =
  TEXT_CARD_PANEL_INPUT_MIN_HEIGHT +
  (TEXT_CARD_PANEL_INPUT_MAX_ROWS - TEXT_CARD_PANEL_INPUT_MIN_ROWS) * TEXT_CARD_PANEL_INPUT_LINE_HEIGHT;
const TEXT_CARD_BODY_TEXT_CLASSNAME = 'text-[15px] leading-7 tracking-[-0.02em] text-[var(--workspace-text-primary)]';
const IMAGE_CARD_PANEL_PROMPT_PLACEHOLDER = '描述你想生成的图片内容…（按 Enter 生成，Shift+Enter 换行）';
const IMAGE_CARD_MENU_OPTIONS = [
  { icon: ImageIcon, label: '图生图' },
  { icon: Video, label: '图生视频' },
  { icon: SlidersHorizontal, label: '图片换背景' },
  { icon: Sparkles, label: '首帧图生视频' },
] as const;
const IMAGE_CARD_SIZE_OPTIONS = [
  { id: '1024x1024', label: '1K' },
  { id: '2048x2048', label: '2K' },
  { id: '4096x4096', label: '4K' },
] as const;
const IMAGE_CARD_COUNT_MIN = 1;
const IMAGE_CARD_COUNT_MAX = 9;
const NODE_SELECTED_OUTLINE_COLOR = 'rgba(23, 23, 23, 0.74)';
const NODE_SELECTED_OUTLINE_WIDTH = 2;
const VIEWPORT_ZOOM_DURATION_MS = 140;
type WorkspaceTheme = 'light' | 'dark';
const WORKSPACE_THEME_STORAGE_KEY = 'zo-design-workspace-theme';
const DEFAULT_WORKSPACE_THEME: WorkspaceTheme = 'light';

const applyWorkspaceTheme = (theme: WorkspaceTheme) => {
  if (typeof document === 'undefined') return;
  document.documentElement.dataset.workspaceTheme = theme;
  document.documentElement.classList.toggle('dark', theme === 'dark');
};

const clampImageCardCount = (value: number) => {
  if (!Number.isFinite(value)) return IMAGE_CARD_COUNT_MIN;
  return Math.min(IMAGE_CARD_COUNT_MAX, Math.max(IMAGE_CARD_COUNT_MIN, Math.floor(value)));
};

function useWorkspaceTheme() {
  const [theme, setTheme] = useState<WorkspaceTheme>(DEFAULT_WORKSPACE_THEME);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const storedTheme = window.localStorage.getItem(WORKSPACE_THEME_STORAGE_KEY);
    const nextTheme: WorkspaceTheme = storedTheme === 'dark' ? 'dark' : DEFAULT_WORKSPACE_THEME;
    setTheme(nextTheme);
    applyWorkspaceTheme(nextTheme);
  }, []);

  useEffect(() => {
    applyWorkspaceTheme(theme);
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(WORKSPACE_THEME_STORAGE_KEY, theme);
  }, [theme]);

  const toggleTheme = useCallback(() => {
    setTheme((currentTheme) => (currentTheme === 'dark' ? 'light' : 'dark'));
  }, []);

  return { theme, toggleTheme };
}

const LIGHT_THEME = {
  appBg: '#f5f5f4',
  panel: 'rgba(255, 255, 255, 0.86)',
  panelElevated: 'rgba(255, 255, 255, 0.96)',
  panelSoft: 'rgba(250, 250, 249, 0.82)',
  border: 'rgba(23, 23, 23, 0.1)',
  borderStrong: 'rgba(23, 23, 23, 0.18)',
  textPrimary: '#171717',
  textMuted: '#737373',
  textSoft: '#a3a3a3',
  accent: '#171717',
  accentSurface: 'rgba(23, 23, 23, 0.05)',
  accentSurfaceStrong: 'rgba(23, 23, 23, 0.09)',
  canvasLine: 'rgba(23, 23, 23, 0.24)',
  marqueeStroke: 'rgba(23, 23, 23, 0.78)',
  marqueeFill: 'rgba(64, 64, 64, 0.08)',
  portFill: '#fafaf9',
  portStroke: 'rgba(64, 64, 64, 0.58)',
};
const DARK_THEME = {
  appBg: '#1a1a1a',
  panel: 'rgba(32, 32, 32, 0.92)',
  panelElevated: 'rgba(38, 38, 38, 0.96)',
  panelSoft: 'rgba(29, 29, 29, 0.88)',
  border: 'rgba(255, 255, 255, 0.09)',
  borderStrong: 'rgba(255, 255, 255, 0.16)',
  textPrimary: '#f5f5f5',
  textMuted: '#a3a3a3',
  textSoft: '#737373',
  accent: '#f5f5f5',
  accentSurface: 'rgba(255, 255, 255, 0.08)',
  accentSurfaceStrong: 'rgba(255, 255, 255, 0.12)',
  canvasLine: 'rgba(245, 245, 245, 0.84)',
  marqueeStroke: 'rgba(255, 255, 255, 0.76)',
  marqueeFill: 'rgba(255, 255, 255, 0.06)',
  portFill: '#1a1a1a',
  portStroke: 'rgba(245, 245, 245, 0.78)',
};
const WORKSPACE_THEME_PALETTES = {
  light: LIGHT_THEME,
  dark: DARK_THEME,
} as const;

const getImageCardAspectRatioShortLabel = (aspectRatioId: string) =>
  normalizeImageCardAspectRatio(aspectRatioId);

const getImageCardAspectRatioPreviewSize = (aspectRatioId: string) => {
  const normalizedAspectRatioId = normalizeImageCardAspectRatio(aspectRatioId);

  const match = normalizedAspectRatioId.match(/^(\d+):(\d+)$/);
  if (!match) {
    return { width: 18, height: 18 };
  }

  const widthRatio = Number(match[1]);
  const heightRatio = Number(match[2]);
  if (!Number.isFinite(widthRatio) || !Number.isFinite(heightRatio) || widthRatio <= 0 || heightRatio <= 0) {
    return { width: 18, height: 18 };
  }

  const maxPreviewEdge = 18;
  if (widthRatio >= heightRatio) {
    return {
      width: maxPreviewEdge,
      height: Math.max(7, (heightRatio / widthRatio) * maxPreviewEdge),
    };
  }

  return {
    width: Math.max(7, (widthRatio / heightRatio) * maxPreviewEdge),
    height: maxPreviewEdge,
  };
};

const IMAGE_CARD_QUALITY_OPTIONS = DEFAULT_IMAGE_CARD_QUALITY_OPTIONS;

const getImageCardQualityLabel = (qualityId: string) =>
  IMAGE_CARD_QUALITY_OPTIONS.find((option) => option.id === qualityId)?.label || qualityId;

const getConstrainedImageDisplaySize = (
  naturalWidth: number,
  naturalHeight: number,
  minSide: number = IMAGE_DISPLAY_MIN_SIDE
) => {
  if (naturalWidth <= 0 || naturalHeight <= 0) {
    return { width: minSide, height: minSide };
  }

  if (naturalWidth >= naturalHeight) {
    return {
      width: (naturalWidth / naturalHeight) * minSide,
      height: minSide,
    };
  }

  return {
    width: minSide,
    height: (naturalHeight / naturalWidth) * minSide,
  };
};

const FLOATING_TOOLBAR_VIEWPORT_PADDING = 20;

const clampFloatingPanelToViewport = ({
  left,
  top,
  width,
  height,
  viewportWidth,
  viewportHeight,
  padding = FLOATING_TOOLBAR_VIEWPORT_PADDING,
}: {
  left: number;
  top: number;
  width: number;
  height: number;
  viewportWidth: number;
  viewportHeight: number;
  padding?: number;
}) => {
  if (!Number.isFinite(left) || !Number.isFinite(top)) {
    return { left: 0, top: 0 };
  }

  if (
    !Number.isFinite(width) ||
    width <= 0 ||
    !Number.isFinite(height) ||
    height <= 0 ||
    !Number.isFinite(viewportWidth) ||
    viewportWidth <= 0 ||
    !Number.isFinite(viewportHeight) ||
    viewportHeight <= 0
  ) {
    return { left, top };
  }

  const minLeft = padding;
  const maxLeft = Math.max(minLeft, viewportWidth - width - padding);
  const minTop = padding;
  const maxTop = Math.max(minTop, viewportHeight - height - padding);

  return {
    left: Math.min(Math.max(left, minLeft), maxLeft),
    top: Math.min(Math.max(top, minTop), maxTop),
  };
};

const createImageCanvasItem = ({
  id,
  src,
  naturalWidth,
  naturalHeight,
  x,
  y,
}: {
  id: string;
  src: string;
  naturalWidth: number;
  naturalHeight: number;
  x: number;
  y: number;
}): CanvasItem => {
  const { width, height } = getConstrainedImageDisplaySize(naturalWidth, naturalHeight);

  return {
    id,
    type: 'image',
    x,
    y,
    width,
    height,
    rotation: 0,
    src,
    naturalWidth,
    naturalHeight,
    visible: true,
    locked: false,
  };
};

const IMAGE_CARD_DEFAULT_FRAME_WIDTH = IMAGE_CARD_MIN_EDGE;
const GENERATED_HISTORY_SOURCE_LABELS: Record<GeneratedImageHistoryEntry['source'], string> = {
  chat: '聊天生成',
  'image-card': 'Image 生成',
  archive: '本地生成',
};

const createGeneratedImageHistoryEntry = ({
  src,
  plannerPreviewSrc = src,
  naturalWidth,
  naturalHeight,
  timestamp = Date.now(),
  sequence = 0,
  source,
  sourceItemId,
  topicId,
  messageId,
  operation,
  sourceReferenceId,
  sourceTaskId,
  sourceVersionId,
  providerId,
  model,
  promptTrace,
  taskId,
  contractVersion,
  batchId,
  slotId,
  versionId,
  parentVersionId,
}: {
  src: string;
  plannerPreviewSrc?: string;
  naturalWidth?: number;
  naturalHeight?: number;
  timestamp?: number;
  sequence?: number;
  source: GeneratedImageHistoryEntry['source'];
  sourceItemId?: string;
  topicId?: string;
  messageId?: string;
  operation?: 'generate' | 'edit';
  sourceReferenceId?: string;
  sourceTaskId?: string;
  sourceVersionId?: string;
  providerId?: string;
  model?: string;
  promptTrace?: GeneratedImageHistoryEntry['promptTrace'];
  taskId?: string;
  contractVersion?: number;
  batchId?: string;
  slotId?: string;
  versionId?: string;
  parentVersionId?: string;
}): GeneratedImageHistoryEntry => {
  const normalizedCreatedAt = buildGeneratedImageHistorySortKey(timestamp, sequence);

  return {
    id: `generated-history-${normalizedCreatedAt}-${Math.random().toString(36).slice(2, 8)}`,
    src,
    plannerPreviewSrc,
    naturalWidth,
    naturalHeight,
    createdAt: normalizedCreatedAt,
    source,
    sourceItemId,
    topicId,
    messageId,
    operation,
    sourceReferenceId,
    sourceTaskId,
    sourceVersionId,
    providerId,
    model,
    promptTrace,
    taskId,
    contractVersion,
    batchId,
    slotId,
    versionId,
    parentVersionId,
  };
};

const resizeCanvasItemFromCenter = (
  item: CanvasItem,
  nextSize: {
    width: number;
    height: number;
  }
): CanvasItem => {
  const safeWidth = Number.isFinite(nextSize.width) && nextSize.width > 0 ? nextSize.width : item.width;
  const safeHeight = Number.isFinite(nextSize.height) && nextSize.height > 0 ? nextSize.height : item.height;
  const centerX = item.x + item.width / 2;
  const centerY = item.y + item.height / 2;

  return {
    ...item,
    width: safeWidth,
    height: safeHeight,
    x: centerX - safeWidth / 2,
    y: centerY - safeHeight / 2,
  };
};

const resizeImageCardItemToAspectRatio = (item: CanvasItem, aspectRatio: string): CanvasItem => {
  const frameSize = getImageCardFrameSizeForAspectRatio(aspectRatio, IMAGE_CARD_MIN_EDGE);
  const nextSize = getImageCardItemSizeForFrameSize(frameSize.width, frameSize.height, {
    frameInsetX: TEXT_CARD_FRAME_INSET_X,
    frameTopInset: TEXT_CARD_FRAME_TOP,
    frameBottomInset: TEXT_CARD_FRAME_BOTTOM,
  });

  return resizeCanvasItemFromCenter(item, nextSize);
};

const resizeImageCardItemToNaturalImage = (
  item: CanvasItem,
  naturalWidth: number,
  naturalHeight: number
): CanvasItem => {
  const nextSize = getImageCardItemSizeForNaturalImage(naturalWidth, naturalHeight, IMAGE_CARD_MIN_EDGE, {
    frameInsetX: TEXT_CARD_FRAME_INSET_X,
    frameTopInset: TEXT_CARD_FRAME_TOP,
    frameBottomInset: TEXT_CARD_FRAME_BOTTOM,
  });

  return resizeCanvasItemFromCenter(item, nextSize);
};

const extractCanvasGeneratedImageUrls = (result: any): string[] => {
  if (Array.isArray(result?.result?.outputs) && result.result.outputs.length > 0) {
    return result.result.outputs
      .map((entry: { localUrl?: string }) => (typeof entry?.localUrl === 'string' ? entry.localUrl : ''))
      .filter(Boolean);
  }

  return typeof result?.result?.localUrl === 'string' ? [result.result.localUrl] : [];
};

const waitForCanvasImagePreview = (delayMs: number) =>
  new Promise<void>((resolve) => {
    window.setTimeout(resolve, delayMs);
  });

const loadCanvasGeneratedImageMeta = async (localUrl: string) => {
  const maxAttempts = 3;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await new Promise<{ src: string; naturalWidth: number; naturalHeight: number }>((resolve, reject) => {
        const img = new window.Image();
        img.onload = () => {
          resolve({
            src: localUrl,
            naturalWidth: img.naturalWidth || img.width || IMAGE_CARD_DEFAULT_FRAME_WIDTH,
            naturalHeight: img.naturalHeight || img.height || IMAGE_CARD_DEFAULT_FRAME_WIDTH,
          });
        };
        img.onerror = () => reject(new Error('生成图片加载失败'));
        img.src = attempt === 1 ? localUrl : `${localUrl}${localUrl.includes('?') ? '&' : '?'}previewRetry=${attempt}`;
      });
    } catch (error) {
      if (attempt >= maxAttempts) {
        console.warn('Canvas generated image preview fallback:', {
          localUrl,
          attempts: attempt,
          error: error instanceof Error ? error.message : String(error),
        });
        return {
          src: localUrl,
          naturalWidth: IMAGE_CARD_DEFAULT_FRAME_WIDTH,
          naturalHeight: IMAGE_CARD_DEFAULT_FRAME_WIDTH,
        };
      }

      await waitForCanvasImagePreview(180);
    }
  }

  return {
    src: localUrl,
    naturalWidth: IMAGE_CARD_DEFAULT_FRAME_WIDTH,
    naturalHeight: IMAGE_CARD_DEFAULT_FRAME_WIDTH,
  };
};

const stopCanvasWheelFromScrollableRegion: React.WheelEventHandler<HTMLElement> = (e) => {
  e.stopPropagation();

  const currentTarget = e.currentTarget;
  if (
    shouldPreventScrollableRegionWheelDefault({
      deltaX: e.deltaX,
      deltaY: e.deltaY,
      scrollTop: currentTarget.scrollTop,
      scrollHeight: currentTarget.scrollHeight,
      clientHeight: currentTarget.clientHeight,
      scrollLeft: currentTarget.scrollLeft,
      scrollWidth: currentTarget.scrollWidth,
      clientWidth: currentTarget.clientWidth,
    })
  ) {
    e.preventDefault();
  }
};

const getOriginalImageCopyPayload = (item: CanvasItem) => {
  if (item.type !== 'image' || !item.src) {
    return null;
  }

  return {
    src: item.src,
    naturalWidth: item.naturalWidth ?? item.width,
    naturalHeight: item.naturalHeight ?? item.height,
  };
};

const normalizeCanvasItems = (items: CanvasItem[]): CanvasItem[] =>
  items.map((item) => {
    if (item.type === 'text' && item.textVariant === 'card') {
      return {
        ...item,
        textMode: item.textMode === 'manual' ? 'manual' : 'ai',
      };
    }

    if (item.type !== 'image') {
      return item;
    }

    if (isImageCardItem(item)) {
      if (Array.isArray(item.imageOutputs) && item.imageOutputs.length > 0) {
        const nextOutputState = buildImageCardOutputsState(item.imageOutputs, item.activeImageOutputIndex ?? 0);
        return {
          ...resizeImageCardItemToNaturalImage(
            {
              ...item,
              ...nextOutputState,
            },
            nextOutputState.naturalWidth ?? item.naturalWidth ?? IMAGE_CARD_DEFAULT_FRAME_WIDTH,
            nextOutputState.naturalHeight ?? item.naturalHeight ?? IMAGE_CARD_DEFAULT_FRAME_WIDTH
          ),
          ...nextOutputState,
        };
      }

      if (typeof item.src === 'string' && item.src && Number.isFinite(item.naturalWidth) && Number.isFinite(item.naturalHeight)) {
        return resizeImageCardItemToNaturalImage(item, item.naturalWidth ?? IMAGE_CARD_DEFAULT_FRAME_WIDTH, item.naturalHeight ?? IMAGE_CARD_DEFAULT_FRAME_WIDTH);
      }

      return item;
    }

    const sourceWidth = item.naturalWidth ?? item.width;
    const sourceHeight = item.naturalHeight ?? item.height;
    const { width, height } = getConstrainedImageDisplaySize(sourceWidth, sourceHeight);

    return {
      ...item,
      width,
      height,
    };
  });

const getItemVisualBounds = (item: CanvasItem) => {
  if ((item.type === 'text' && item.textVariant === 'card') || isImageCardItem(item)) {
    return {
      left: item.x + TEXT_CARD_FRAME_INSET_X,
      top: item.y + TEXT_CARD_FRAME_TOP,
      width: Math.max(0, item.width - TEXT_CARD_FRAME_INSET_X * 2),
      height: Math.max(0, item.height - TEXT_CARD_FRAME_TOP - TEXT_CARD_FRAME_BOTTOM),
    };
  }

  return {
    left: item.x,
    top: item.y,
    width: item.width,
    height: item.height,
  };
};

const getTextCardFrameBounds = (item: CanvasItem) => ({
  left: TEXT_CARD_FRAME_INSET_X,
  top: TEXT_CARD_FRAME_TOP,
  width: Math.max(0, item.width - TEXT_CARD_FRAME_INSET_X * 2),
  height: Math.max(0, item.height - TEXT_CARD_FRAME_TOP - TEXT_CARD_FRAME_BOTTOM),
});

const getTextCardFrameCornerRadius = (_item: CanvasItem) => CANVAS_NODE_CORNER_RADIUS;

const getItemCornerRadius = (_item: CanvasItem) => CANVAS_NODE_CORNER_RADIUS;

const getCanvasItemsVisualBounds = (items: CanvasItem[]) => {
  if (!Array.isArray(items) || items.length === 0) {
    return null;
  }

  const visualBounds = items.map(getItemVisualBounds);
  const left = Math.min(...visualBounds.map((bounds) => bounds.left));
  const top = Math.min(...visualBounds.map((bounds) => bounds.top));
  const right = Math.max(...visualBounds.map((bounds) => bounds.left + bounds.width));
  const bottom = Math.max(...visualBounds.map((bounds) => bounds.top + bounds.height));

  return {
    left,
    top,
    width: right - left,
    height: bottom - top,
  };
};

const simplifyStrokePoints = (points: CanvasPoint[], tolerance = 1.25): CanvasPoint[] => {
  if (points.length <= 2) return points;
  const simplified = [points[0]];
  let previous = points[0];

  for (let index = 1; index < points.length - 1; index += 1) {
    const point = points[index];
    if (Math.hypot(point.x - previous.x, point.y - previous.y) >= tolerance) {
      simplified.push(point);
      previous = point;
    }
  }

  simplified.push(points[points.length - 1]);
  return simplified;
};

const buildStrokePath = (points: CanvasPoint[]): string => {
  if (points.length === 0) return '';
  if (points.length === 1) {
    return `M ${points[0].x} ${points[0].y} l 0.01 0`;
  }
  if (points.length === 2) {
    return `M ${points[0].x} ${points[0].y} L ${points[1].x} ${points[1].y}`;
  }

  let path = `M ${points[0].x} ${points[0].y}`;
  for (let index = 1; index < points.length - 1; index += 1) {
    const point = points[index];
    const next = points[index + 1];
    path += ` Q ${point.x} ${point.y} ${(point.x + next.x) / 2} ${(point.y + next.y) / 2}`;
  }
  const last = points[points.length - 1];
  path += ` L ${last.x} ${last.y}`;
  return path;
};

const createStrokeCanvasItem = ({
  points,
  color,
  width,
}: {
  points: CanvasPoint[];
  color: string;
  width: number;
}): CanvasItem | null => {
  if (points.length === 0) return null;
  const simplifiedPoints = simplifyStrokePoints(points, Math.max(0.8, width * 0.18));
  const padding = Math.max(8, width * 1.75);
  const minX = Math.min(...simplifiedPoints.map((point) => point.x));
  const minY = Math.min(...simplifiedPoints.map((point) => point.y));
  const maxX = Math.max(...simplifiedPoints.map((point) => point.x));
  const maxY = Math.max(...simplifiedPoints.map((point) => point.y));
  const x = minX - padding;
  const y = minY - padding;

  return {
    id: `stroke-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    type: 'stroke',
    x,
    y,
    width: Math.max(1, maxX - minX) + padding * 2,
    height: Math.max(1, maxY - minY) + padding * 2,
    rotation: 0,
    points: simplifiedPoints.map((point) => ({
      x: point.x - x,
      y: point.y - y,
      pressure: point.pressure,
    })),
    strokeColor: color,
    strokeWidth: width,
    visible: true,
    locked: false,
  };
};

const getReferenceTokenLabel = (src: string, fallback: string): string => {
  try {
    const url = src.startsWith('/') ? new URL(src, 'http://localhost') : new URL(src);
    const fileName = decodeURIComponent(url.pathname.split('/').filter(Boolean).at(-1) || '');
    return fileName || fallback;
  } catch {
    return fallback;
  }
};

const buildSelectedCanvasAnnotationContext = (
  items: CanvasItem[],
  selectedIds: string[]
): CanvasAnnotationContext => {
  const selectedItems = items.filter((item) => selectedIds.includes(item.id));
  const selectedImages = selectedItems.filter(
    (item) => item.type === 'image' && typeof item.src === 'string' && item.src.length > 0
  );
  const selectedAnnotations = selectedItems.filter(isCanvasAnnotationItem);
  const targetItem = selectedImages.length === 1 ? selectedImages[0] : null;
  const targetBounds = targetItem ? getItemVisualBounds(targetItem) : null;

  const annotations = selectedAnnotations.map((item) => {
    if (item.type === 'stroke') {
      const normalizedPoints = (item.points || []).map((point) => {
        const globalX = item.x + point.x;
        const globalY = item.y + point.y;
        return {
          x: targetBounds ? (globalX - targetBounds.left) / Math.max(1, targetBounds.width) : globalX,
          y: targetBounds ? (globalY - targetBounds.top) / Math.max(1, targetBounds.height) : globalY,
          pressure: point.pressure,
        };
      });
      const pointStep = Math.max(1, Math.ceil(normalizedPoints.length / 256));
      const points = normalizedPoints.filter((_, index) => index % pointStep === 0);
      const lastPoint = normalizedPoints.at(-1);
      if (lastPoint && points.at(-1) !== lastPoint) points.push(lastPoint);
      return {
        id: item.id,
        type: 'stroke',
        points,
        color: item.strokeColor || DEFAULT_ANNOTATION_COLOR,
        width: targetBounds
          ? (item.strokeWidth || DEFAULT_ANNOTATION_STROKE_WIDTH) / Math.max(1, targetBounds.width)
          : item.strokeWidth || DEFAULT_ANNOTATION_STROKE_WIDTH,
        coordinateSpace: targetBounds ? 'target-normalized' : 'canvas',
      };
    }

    return {
      id: item.id,
      type: 'text',
      text: item.text || '',
      color: item.textColor || DEFAULT_ANNOTATION_COLOR,
      fontSize: targetBounds
        ? (item.fontSize || ANNOTATION_TEXT_DEFAULT_FONT_SIZE) / Math.max(1, targetBounds.height)
        : item.fontSize || ANNOTATION_TEXT_DEFAULT_FONT_SIZE,
      x: targetBounds ? (item.x - targetBounds.left) / Math.max(1, targetBounds.width) : item.x,
      y: targetBounds ? (item.y - targetBounds.top) / Math.max(1, targetBounds.height) : item.y,
      width: targetBounds ? item.width / Math.max(1, targetBounds.width) : item.width,
      height: targetBounds ? item.height / Math.max(1, targetBounds.height) : item.height,
      coordinateSpace: targetBounds ? 'target-normalized' : 'canvas',
    };
  });

  return {
    targetImage: targetItem && targetBounds && targetItem.src
      ? {
          id: targetItem.id,
          src: targetItem.src,
          x: targetBounds.left,
          y: targetBounds.top,
          width: targetBounds.width,
          height: targetBounds.height,
        }
      : undefined,
    annotations,
    annotationItemIds: selectedAnnotations.map((item) => item.id),
    annotationCount: selectedAnnotations.length,
    ambiguousImageTarget: selectedImages.length > 1 && selectedAnnotations.length > 0,
  };
};

const loadCanvasCompositeImage = (src: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new window.Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('目标图片无法载入合成画布'));
    image.src = src;
  });

const uploadAnnotationCompositePreview = async ({
  context,
  items,
}: {
  context: CanvasAnnotationContext;
  items: CanvasItem[];
}): Promise<{ url?: string; error?: string }> => {
  if (!context.targetImage || context.annotationCount === 0) return {};

  try {
    const target = context.targetImage;
    const image = await loadCanvasCompositeImage(target.src);
    const longestEdge = Math.max(target.width, target.height, 1);
    const scale = Math.min(1, 2048 / longestEdge);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(target.width * scale));
    canvas.height = Math.max(1, Math.round(target.height * scale));
    const context2d = canvas.getContext('2d');
    if (!context2d) throw new Error('浏览器无法创建图片合成上下文');

    context2d.drawImage(image, 0, 0, canvas.width, canvas.height);
    context2d.lineCap = 'round';
    context2d.lineJoin = 'round';

    for (const itemId of context.annotationItemIds) {
      const item = items.find((candidate) => candidate.id === itemId);
      if (!item) continue;

      if (item.type === 'stroke') {
        const points = (item.points || []).map((point) => ({
          x: (item.x + point.x - target.x) * scale,
          y: (item.y + point.y - target.y) * scale,
        }));
        if (points.length === 0) continue;
        context2d.beginPath();
        context2d.moveTo(points[0].x, points[0].y);
        for (let index = 1; index < points.length; index += 1) {
          context2d.lineTo(points[index].x, points[index].y);
        }
        context2d.strokeStyle = item.strokeColor || DEFAULT_ANNOTATION_COLOR;
        context2d.lineWidth = Math.max(1, (item.strokeWidth || DEFAULT_ANNOTATION_STROKE_WIDTH) * scale);
        context2d.stroke();
        continue;
      }

      if (isCanvasAnnotationTextItem(item) && item.text) {
        const fontSize = Math.max(8, (item.fontSize || ANNOTATION_TEXT_DEFAULT_FONT_SIZE) * scale);
        const lineHeight = fontSize * 1.25;
        context2d.fillStyle = item.textColor || DEFAULT_ANNOTATION_COLOR;
        context2d.font = `600 ${fontSize}px sans-serif`;
        item.text.split('\n').forEach((line, index) => {
          context2d.fillText(
            line,
            (item.x - target.x) * scale,
            (item.y - target.y) * scale + fontSize + index * lineHeight
          );
        });
      }
    }

    const imageData = canvas.toDataURL('image/png');
    const response = await fetch('/api/upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageData }),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload || typeof payload.url !== 'string') {
      throw new Error(payload?.error || '标注合成预览上传失败');
    }

    return { url: payload.url };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : '标注合成预览生成失败',
    };
  }
};

const uploadRegionEvidencePreview = async (
  region: Pick<RegionSelection, 'imageSrc' | 'point' | 'box'>,
  signal?: AbortSignal
) => {
  const image = await loadCanvasCompositeImage(region.imageSrc);
  const naturalWidth = Math.max(1, image.naturalWidth || image.width);
  const naturalHeight = Math.max(1, image.naturalHeight || image.height);
  const scale = Math.min(1, 1600 / Math.max(naturalWidth, naturalHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(naturalHeight * scale));
  const context = canvas.getContext('2d');
  if (!context) throw new Error('浏览器无法创建定位预览');
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  const originalImageData = canvas.toDataURL('image/png');
  context.strokeStyle = '#2563eb';
  context.fillStyle = '#2563eb';
  context.lineWidth = Math.max(3, Math.round(5 * scale));
  if (region.box) {
    context.fillStyle = 'rgba(37, 99, 235, 0.12)';
    context.fillRect(
      region.box.x * canvas.width,
      region.box.y * canvas.height,
      region.box.width * canvas.width,
      region.box.height * canvas.height
    );
    context.strokeRect(
      region.box.x * canvas.width,
      region.box.y * canvas.height,
      region.box.width * canvas.width,
      region.box.height * canvas.height
    );
  }
  const x = region.point.x * canvas.width;
  const y = region.point.y * canvas.height;
  const radius = Math.max(9, Math.round(13 * scale));
  context.beginPath();
  context.arc(x, y, radius, 0, Math.PI * 2);
  context.fillStyle = '#2563eb';
  context.fill();
  context.lineWidth = Math.max(2, Math.round(3 * scale));
  context.strokeStyle = '#ffffff';
  context.stroke();
  const crop = buildRegionEvidenceCrop({
    point: region.point,
    box: region.box,
    naturalWidth,
    naturalHeight,
  });
  const cropCanvas = document.createElement('canvas');
  if (!crop) throw new Error('无法计算定位局部区域');
  const cropX = crop.x * naturalWidth;
  const cropY = crop.y * naturalHeight;
  const cropWidth = crop.width * naturalWidth;
  const cropHeight = crop.height * naturalHeight;
  const cropScale = Math.min(1, 1024 / Math.max(cropWidth, cropHeight, 1));
  cropCanvas.width = Math.max(1, Math.round(cropWidth * cropScale));
  cropCanvas.height = Math.max(1, Math.round(cropHeight * cropScale));
  const cropContext = cropCanvas.getContext('2d');
  if (!cropContext) throw new Error('浏览器无法创建定位局部上下文');
  cropContext.drawImage(
    image,
    cropX,
    cropY,
    cropWidth,
    cropHeight,
    0,
    0,
    cropCanvas.width,
    cropCanvas.height
  );

  const uploadDataUrl = async (imageData: string, errorMessage: string) => {
    if (signal?.aborted) throw new DOMException('定位请求已取消', 'AbortError');
    const response = await fetch('/api/upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageData }),
      signal,
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || typeof payload?.url !== 'string') {
      throw new Error(payload?.error || errorMessage);
    }
    return payload.url as string;
  };

  const [imageSrc, evidenceImageSrc, cropImageSrc] = await Promise.all([
    uploadDataUrl(originalImageData, '定位原图上传失败'),
    uploadDataUrl(canvas.toDataURL('image/png'), '定位预览上传失败'),
    uploadDataUrl(cropCanvas.toDataURL('image/png'), '定位局部上传失败'),
  ]);
  return { imageSrc, evidenceImageSrc, cropImageSrc };
};

const getRegionImageContent = (item: CanvasItem) => {
  if (isImageCardItem(item)) {
    return {
      x: TEXT_CARD_FRAME_INSET_X,
      y: TEXT_CARD_FRAME_TOP,
      width: Math.max(1, item.width - TEXT_CARD_FRAME_INSET_X * 2),
      height: Math.max(1, item.height - TEXT_CARD_FRAME_TOP - TEXT_CARD_FRAME_BOTTOM),
      naturalWidth: item.naturalWidth || item.width,
      naturalHeight: item.naturalHeight || item.height,
      fit: 'cover' as const,
    };
  }
  return {
    x: 0,
    y: 0,
    width: Math.max(1, item.width),
    height: Math.max(1, item.height),
    naturalWidth: item.naturalWidth || item.width,
    naturalHeight: item.naturalHeight || item.height,
    fit: 'contain' as const,
  };
};

const getRegionCandidate = (region: RegionSelection): RegionCandidate | undefined =>
  region.candidates.find((candidate) => candidate.id === region.selectedCandidateId) || region.candidates[0];

const buildRegionReferenceToken = (
  region: RegionSelection,
  evidence: RegionEvidence = {}
): ChatReferenceToken => {
  const candidate = getRegionCandidate(region);
  return {
    id: `region-reference:${region.id}`,
    src: region.imageSrc,
    previewSrc: evidence.cropImageSrc || region.imageSrc,
    label: region.status === 'recognizing' ? '识别中…' : selectedRegionLabel(region),
    source: 'canvas',
    canvasItemId: region.imageItemId,
    transient: false,
    pinned: false,
    role: 'region_target',
    regionId: region.id,
    candidateId: region.selectedCandidateId,
    description: region.customLabel ? undefined : candidate?.description,
    aliases: region.customLabel ? [] : candidate?.aliases,
    confidence: region.customLabel ? undefined : candidate?.confidence,
    confirmationStatus: region.confirmationStatus || 'pending',
    targetPoint: region.point,
    ...(region.box ? { targetBox: region.box } : {}),
  };
};

interface ViewportState {
  x: number;
  y: number;
  scale: number;
}

type CanvasInteractionPhase =
  | 'idle'
  | 'item-drag'
  | 'connection-drag'
  | 'canvas-pan'
  | 'canvas-zoom'
  | 'resize'
  | 'marquee';

interface CanvasSize {
  width: number;
  height: number;
}

interface CanvasMetrics extends CanvasSize {
  left: number;
  top: number;
}

type CanvasItemOverlayKind =
  | 'selected-image-toolbar'
  | 'selected-image-panel'
  | 'selected-text-panel';

interface CanvasItemOverlayGroup {
  kind: CanvasItemOverlayKind;
  itemId: string;
  root: HTMLElement;
}

interface CanvasOverlayVisibilitySnapshot {
  root: HTMLElement;
  visibility: string;
  pointerEvents: string;
}

interface PendingCanvasSelectionGesture {
  itemIds: string[];
  primaryId: string;
  previousSelectedId: string | null;
  previousSelectedIds: string[];
  previousConnectionIds: string[];
  overlayVisibility: CanvasOverlayVisibilitySnapshot[];
  pointerDownAt: number;
  firstDragVisualAt: number | null;
  activated: boolean;
}

interface FinalizeCanvasSelectionGestureOptions {
  itemIds?: string[];
  items?: CanvasItem[];
  reason: 'click' | 'drag' | 'alt-copy';
  saveSession?: boolean;
}

interface CanvasMarqueeSession {
  start: { x: number; y: number };
  viewport: ViewportState;
  additive: boolean;
  activated: boolean;
}

interface CanvasPanMotion {
  token: number;
  startPointer: { x: number; y: number };
  currentPointer: { x: number; y: number };
  startViewport: ViewportState;
  targetViewport: ViewportState;
  visualViewport: ViewportState;
  clearSelectionOnClick: boolean;
  moved: boolean;
}

interface NativeViewportAnimation {
  cancel: () => void;
}

interface CanvasItemDragPreviewTarget {
  target: CanvasRegisteredTarget;
  logicalStartX: number | null;
  logicalStartY: number | null;
  zIndex: string;
  willChange: string;
}

interface CanvasItemDragConnectionPreview {
  paths: SVGPathElement[];
  originalPath: string;
  originalTransforms: string[];
  fromStart: { x: number; y: number };
  toStart: { x: number; y: number };
  fromPoint: { x: number; y: number };
  toPoint: { x: number; y: number };
  movesFrom: boolean;
  movesTo: boolean;
  translationOnly: boolean;
}

interface CanvasItemDragPreviewState {
  targets: CanvasItemDragPreviewTarget[];
  connections: CanvasItemDragConnectionPreview[];
  connectionsPrepared: boolean;
  delta: { x: number; y: number };
}

interface CachedCanvasItemDragConnection {
  connection: Connection;
  paths: SVGPathElement[];
  movesFrom: boolean;
  movesTo: boolean;
}

interface CachedCanvasItemDragPlan {
  connections: CachedCanvasItemDragConnection[];
}

interface DirectItemDragSession {
  sessionId: string | null;
  token: number;
  itemIds: string[];
  startPositions: Record<string, { x: number; y: number }>;
  delta: { x: number; y: number };
  overlayVisibility: CanvasOverlayVisibilitySnapshot[];
  isAltCopy: boolean;
}

type CanvasConnectionRuntimeIndex = Map<string, CachedCanvasItemDragPlan>;

interface ChatPanelMotionController {
  open: () => void;
  close: () => void;
  syncBreakpoint: (isDesktop: boolean) => void;
  isCollapsed: () => boolean;
}

interface ChatPanelMotionPerformanceTrace {
  targetCollapsed: boolean;
  startedAt: number;
  maxFrameIntervalMs: number;
  frameCount: number;
  longFrameCount: number;
  ticker: (time: number, deltaTime: number) => void;
}

interface PendingCanvasCommit {
  revision: number;
  stagedAt: number;
  items?: CanvasItem[];
  viewport?: ViewportState;
  connections?: Connection[];
  selectedId?: string | null;
  selectedIds?: string[];
  selectedConnectionIds?: string[];
  saveSession?: boolean;
  viewportToken?: number;
}

interface CanvasCommitBuffer extends PendingCanvasCommit {
  deadlineAt: number;
}

interface CornerResizePreview {
  itemId: string;
  target: CanvasRegisteredTarget | null;
  startWidth: number;
  startHeight: number;
  nextWidth: number;
  nextHeight: number;
  overlayVisibility: CanvasOverlayVisibilitySnapshot[];
}

interface RegionDraftVisualController {
  root: HTMLElement;
  setMarkerX: (value: number) => void;
  setMarkerY: (value: number) => void;
  setBoxX: (value: number) => void;
  setBoxY: (value: number) => void;
  setBoxScaleX: (value: number) => void;
  setBoxScaleY: (value: number) => void;
}

const CanvasBackgroundLayer = memo(function CanvasBackgroundLayer({
  theme,
}: {
  theme: typeof DARK_THEME;
}) {
  return (
    <div
      className="pointer-events-none absolute inset-0"
      style={{
        backgroundColor: theme.appBg,
      }}
    />
  );
});

const CanvasConnectionPath = memo(function CanvasConnectionPath({
  connectionId,
  path,
  role,
  stroke,
  strokeOpacity,
  strokeWidth,
  onPointerDown,
  getConnectionPathRef,
}: {
  connectionId: string;
  path: string;
  role: 'visual' | 'hit';
  stroke: string;
  strokeOpacity?: number;
  strokeWidth: number | string;
  onPointerDown?: (e: React.PointerEvent<SVGPathElement>, connectionId: string) => void;
  getConnectionPathRef: (connectionId: string, role: string) => (element: SVGPathElement | null) => void;
}) {
  const isHitPath = role === 'hit';
  return (
    <path
      ref={getConnectionPathRef(connectionId, role)}
      data-canvas-connection-id={connectionId}
      d={path}
      fill="none"
      stroke={stroke}
      {...(!isHitPath && strokeOpacity !== undefined ? { strokeOpacity } : {})}
      strokeWidth={strokeWidth}
      vectorEffect="non-scaling-stroke"
      strokeLinecap="round"
      pointerEvents={isHitPath ? undefined : 'none'}
      className={isHitPath ? 'pointer-events-auto cursor-pointer' : undefined}
      onPointerDown={isHitPath && onPointerDown
        ? (event) => onPointerDown(event, connectionId)
        : undefined}
    />
  );
});

const CanvasResolvedConnectionPath = memo(function CanvasResolvedConnectionPath({
  connection,
  fromItem,
  toItem,
  role,
  stroke,
  strokeOpacity,
  strokeWidth,
  onPointerDown,
  getConnectionAnchorCanvasPoint,
  buildConnectionPath,
  getConnectionPathRef,
}: {
  connection: Connection;
  fromItem: CanvasItem;
  toItem: CanvasItem;
  role: 'visual' | 'hit';
  stroke: string;
  strokeOpacity?: number;
  strokeWidth: number | string;
  onPointerDown?: (e: React.PointerEvent<SVGPathElement>, connectionId: string) => void;
  getConnectionAnchorCanvasPoint: (item: CanvasItem, side: 'left' | 'right') => { x: number; y: number };
  buildConnectionPath: (from: { x: number; y: number }, to: { x: number; y: number }) => string;
  getConnectionPathRef: (connectionId: string, role: string) => (element: SVGPathElement | null) => void;
}) {
  const from = getConnectionAnchorCanvasPoint(fromItem, 'right');
  const to = getConnectionAnchorCanvasPoint(toItem, 'left');
  return (
    <CanvasConnectionPath
      connectionId={connection.id}
      path={buildConnectionPath(from, to)}
      role={role}
      stroke={stroke}
      strokeOpacity={strokeOpacity}
      strokeWidth={strokeWidth}
      onPointerDown={onPointerDown}
      getConnectionPathRef={getConnectionPathRef}
    />
  );
});

const CanvasConnectionsLayer = memo(function CanvasConnectionsLayer({
  connections,
  theme,
  itemById,
  selectedConnectionIds,
  onConnectionPointerDown,
  getConnectionAnchorCanvasPoint,
  buildConnectionPath,
  getConnectionPathRef,
}: {
  connections: Connection[];
  theme: typeof DARK_THEME;
  itemById: Record<string, CanvasItem>;
  selectedConnectionIds: string[];
  onConnectionPointerDown: (e: React.PointerEvent<SVGPathElement>, connectionId: string) => void;
  getConnectionAnchorCanvasPoint: (item: CanvasItem, side: 'left' | 'right') => { x: number; y: number };
  buildConnectionPath: (from: { x: number; y: number }, to: { x: number; y: number }) => string;
  getConnectionPathRef: (connectionId: string, role: string) => (element: SVGPathElement | null) => void;
}) {
  const selectedConnectionIdSet = React.useMemo(
    () => new Set(selectedConnectionIds),
    [selectedConnectionIds]
  );
  const connectionStrokeWidth = 3.5;
  const selectedConnectionStrokeWidth = 4.5;
  return (
      <div
        data-canvas-world-connections="true"
        className="pointer-events-none absolute left-0 top-0 z-[1]"
      >
        <svg className="pointer-events-none absolute left-0 top-0 overflow-visible" width="1" height="1">
          {connections.map((connection) => {
            const fromItem = itemById[connection.fromItemId];
            const toItem = itemById[connection.toItemId];
            if (!fromItem || !toItem) return null;
            const isSelectedConnection = selectedConnectionIdSet.has(connection.id);
            return (
              <CanvasResolvedConnectionPath
                key={`visual-${connection.id}`}
                connection={connection}
                fromItem={fromItem}
                toItem={toItem}
                role="visual"
                stroke={theme.canvasLine}
                strokeOpacity={isSelectedConnection ? 0.98 : 0.9}
                strokeWidth={isSelectedConnection ? selectedConnectionStrokeWidth : connectionStrokeWidth}
                getConnectionAnchorCanvasPoint={getConnectionAnchorCanvasPoint}
                buildConnectionPath={buildConnectionPath}
                getConnectionPathRef={getConnectionPathRef}
              />
            );
          })}
        </svg>
        <svg
          data-canvas-connection-hit-layer="true"
          className="pointer-events-none absolute left-0 top-0 overflow-visible"
          width="1"
          height="1"
        >
          {connections.map((connection) => {
            const fromItem = itemById[connection.fromItemId];
            const toItem = itemById[connection.toItemId];
            if (!fromItem || !toItem) return null;
            return (
              <CanvasResolvedConnectionPath
                key={`hit-${connection.id}`}
                connection={connection}
                fromItem={fromItem}
                toItem={toItem}
                role="hit"
                stroke="transparent"
                strokeWidth="20"
                onPointerDown={onConnectionPointerDown}
                getConnectionAnchorCanvasPoint={getConnectionAnchorCanvasPoint}
                buildConnectionPath={buildConnectionPath}
                getConnectionPathRef={getConnectionPathRef}
              />
            );
          })}
        </svg>
      </div>
  );
});

const CanvasConnectionPreviewLayer = memo(function CanvasConnectionPreviewLayer({
  canvasSize,
  theme,
  connectionMode,
  connectionPreviewPathRef,
  frozenPreviewConnection,
  buildConnectionPath,
}: {
  canvasSize: CanvasSize;
  theme: typeof DARK_THEME;
  connectionMode: ConnectionMode;
  connectionPreviewPathRef: React.RefObject<SVGPathElement | null>;
  frozenPreviewConnection: FrozenPreviewConnection | null;
  buildConnectionPath: (from: { x: number; y: number }, to: { x: number; y: number }) => string;
}) {
  return (
    <svg
      data-canvas-screen-connection-preview="true"
      className="pointer-events-none absolute inset-0 z-[1] h-full w-full overflow-hidden"
      width={canvasSize.width}
      height={canvasSize.height}
      viewBox={`0 0 ${Math.max(canvasSize.width, 1)} ${Math.max(canvasSize.height, 1)}`}
      preserveAspectRatio="none"
    >
      <path
        ref={connectionPreviewPathRef}
        data-canvas-connection-preview="true"
        fill="none"
        stroke={theme.canvasLine}
        strokeOpacity="0.9"
        strokeWidth={3.5}
        strokeLinecap="round"
        pointerEvents="none"
        visibility={connectionMode === 'dragging' ? 'visible' : 'hidden'}
      />
      {frozenPreviewConnection && (
        <path
          d={buildConnectionPath(frozenPreviewConnection.from, frozenPreviewConnection.to)}
          fill="none"
          stroke={theme.canvasLine}
          strokeOpacity="0.5"
          strokeWidth={3.5}
          strokeLinecap="round"
          pointerEvents="none"
        />
      )}
    </svg>
  );
});

const CanvasPortsLayer = memo(function CanvasPortsLayer({
  items,
  hoveredCanvasItemId,
  hoveredInputPortItemId,
  hoveredOutputPortItemId,
  connectionFromItemId,
  onInputPortEnter,
  onInputPortLeave,
  onOutputPortEnter,
  onOutputPortLeave,
  onOutputPortPointerDown,
  getItemTargetRef,
}: {
  items: CanvasItem[];
  hoveredCanvasItemId: string | null;
  hoveredInputPortItemId: string | null;
  hoveredOutputPortItemId: string | null;
  connectionFromItemId: string | null;
  onInputPortEnter: (itemId: string) => void;
  onInputPortLeave: (itemId: string) => void;
  onOutputPortEnter: (itemId: string) => void;
  onOutputPortLeave: (itemId: string) => void;
  onOutputPortPointerDown: (
    e: React.PointerEvent<HTMLElement>,
    item: CanvasItem
  ) => void;
  getItemTargetRef: (itemId: string, role: string) => (element: HTMLElement | null) => void;
}) {
  const portsLayerRef = useRef<HTMLDivElement | null>(null);
  const portVisibilityRef = useRef(new Map<string, boolean>());
  const incomingPortItemIds = React.useMemo(
    () => new Set(items.filter(canItemAcceptIncomingConnection).map((item) => item.id)),
    [items]
  );
  useLayoutEffect(() => {
    const root = portsLayerRef.current;
    if (!root) return;
    const elements = Array.from(root.querySelectorAll<HTMLElement>('[data-port][data-item-id]'));
    elements.forEach((element) => {
      const itemId = element.dataset.itemId;
      const side = element.dataset.port;
      if (!itemId || !side) return;
      const acceptsIncomingConnection = side !== 'in' || incomingPortItemIds.has(itemId);
      const isHoveredItem = hoveredCanvasItemId === itemId;
      const isHoveredInputPort = hoveredInputPortItemId === itemId;
      const isHoveredOutputPort = hoveredOutputPortItemId === itemId;
      const isConnectionSource = connectionFromItemId === itemId;
      const isNearPort = isHoveredInputPort || isHoveredOutputPort;
      const visible = acceptsIncomingConnection && (side === 'out'
        ? isHoveredItem || isNearPort || isConnectionSource
        : isHoveredItem || isNearPort);
      const key = `${itemId}:${side}`;
      const previous = portVisibilityRef.current.get(key);
      portVisibilityRef.current.set(key, visible);
      if (previous === visible) return;
      element.style.visibility = visible ? 'visible' : 'hidden';
      element.style.opacity = visible ? '1' : '0';
      element.style.pointerEvents = side === 'out' && visible ? 'auto' : 'none';
    });
  }, [
    connectionFromItemId,
    hoveredCanvasItemId,
    hoveredInputPortItemId,
    hoveredOutputPortItemId,
    incomingPortItemIds,
  ]);

  return (
    <div ref={portsLayerRef} data-canvas-ports-layer="true" className="absolute inset-0 z-[90] pointer-events-none">
      <div className="absolute z-[90] overflow-visible">
        {items.map((item) => {
          const acceptsIncomingConnection = canItemAcceptIncomingConnection(item);
          const inputPoint = getPortCanvasPoint(item, 'left');
          const outputPoint = getPortCanvasPoint(item, 'right');

          return (
            <React.Fragment key={`port-overlay-${item.id}`}>
              {acceptsIncomingConnection && (
                <>
                  <div
                    ref={getItemTargetRef(item.id, 'input-port-bridge')}
                    data-port-bridge="in"
                    data-item-id={item.id}
                    onPointerEnter={() => onInputPortEnter(item.id)}
                    onPointerLeave={() => onInputPortLeave(item.id)}
                    className="absolute -translate-x-1/2 -translate-y-1/2 bg-transparent pointer-events-auto"
                    style={{
                      left: inputPoint.x,
                      top: inputPoint.y,
                      width: PORT_PROXIMITY_SIZE,
                      height: PORT_PROXIMITY_SIZE,
                    }}
                  />
                  <div
                    ref={getItemTargetRef(item.id, 'input-port')}
                    data-port="in"
                    data-item-id={item.id}
                    className="invisible absolute -translate-x-1/2 -translate-y-1/2 pointer-events-none opacity-0"
                    style={{
                      left: inputPoint.x,
                      top: inputPoint.y,
                      width: PORT_ICON_SIZE,
                      height: PORT_ICON_SIZE,
                      transform: 'translate(-50%, -50%)',
                    }}
                  >
                    <ConnectionPortIcon className="h-full w-full" />
                  </div>
                </>
              )}
              <div
                ref={getItemTargetRef(item.id, 'output-port-bridge')}
                data-port-bridge="out"
                data-item-id={item.id}
                onPointerEnter={() => onOutputPortEnter(item.id)}
                onPointerLeave={() => onOutputPortLeave(item.id)}
                className="absolute -translate-x-1/2 -translate-y-1/2 bg-transparent pointer-events-auto"
                style={{
                  left: outputPoint.x,
                  top: outputPoint.y,
                  width: PORT_PROXIMITY_SIZE,
                  height: PORT_PROXIMITY_SIZE,
                }}
              />
              <button
                ref={getItemTargetRef(item.id, 'output-port')}
                type="button"
                data-port="out"
                data-item-id={item.id}
                onPointerEnter={() => onOutputPortEnter(item.id)}
                onPointerLeave={() => onOutputPortLeave(item.id)}
                onPointerDown={(e) => onOutputPortPointerDown(e, item)}
                className="invisible pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 rounded-full bg-transparent opacity-0"
                style={{
                  left: outputPoint.x,
                  top: outputPoint.y,
                  width: PORT_ICON_SIZE,
                  height: PORT_ICON_SIZE,
                  transform: 'translate(-50%, -50%)',
                }}
                aria-label="开始连线"
              >
                <ConnectionPortIcon className="h-full w-full" />
              </button>
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
});

const CanvasGenerationDurationBadge = memo(function CanvasGenerationDurationBadge({
  startedAt,
  lastDurationMs,
}: {
  startedAt: number | null;
  lastDurationMs?: number;
}) {
  const [clockMs, setClockMs] = useState(() => Date.now());
  useEffect(() => {
    if (!Number.isFinite(startedAt)) return;
    setClockMs(Date.now());
    const timer = window.setInterval(() => setClockMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [startedAt]);

  const label = getGenerationDurationDisplay(
    Number.isFinite(startedAt)
      ? Math.max(0, clockMs - (startedAt ?? 0))
      : lastDurationMs
  );
  if (!label) return null;

  return (
    <div className="workspace-control-chip inline-flex h-6 items-center gap-1 rounded-lg px-2 text-[11px]">
      <Clock3 size={12} strokeWidth={2} />
      <span>{label}</span>
    </div>
  );
});

const CanvasNodesContent = memo(function CanvasNodesContent({
  tool,
  items,
  connections,
  hoveredCanvasItemId,
  activeCanvasTextGenerationItemIds,
  activeCanvasImageGenerationItemIds,
  activeCanvasTextGenerations,
  activeCanvasImageGenerations,
  activeCanvasImageIds,
  editingTextCardId,
  editingTextCardTextareaRef,
  onImageCardOutputSelect,
  onItemMouseEnter,
  onItemMouseLeave,
  onItemClick,
  onItemDoubleClick,
  onItemPointerDown,
  onCornerResizePointerDown,
  onManualTextCardInputChange,
  onManualTextCardBlur,
  getItemTargetRef,
}: {
  tool: Tool;
  items: CanvasItem[];
  connections: Connection[];
  hoveredCanvasItemId: string | null;
  activeCanvasTextGenerationItemIds: Set<string>;
  activeCanvasImageGenerationItemIds: Set<string>;
  activeCanvasTextGenerations: Record<string, { status: 'running'; startedAt: number }>;
  activeCanvasImageGenerations: Record<string, { status: 'running'; startedAt: number; total: number; completed: number; failed: number }>;
  activeCanvasImageIds: Set<string>;
  editingTextCardId: string | null;
  editingTextCardTextareaRef: React.RefObject<HTMLTextAreaElement | null>;
  onImageCardOutputSelect: (itemId: string, outputIndex: number) => void;
  onItemMouseEnter: (itemId: string) => void;
  onItemMouseLeave: (itemId: string) => void;
  onItemClick: (e: React.MouseEvent<HTMLDivElement>, itemId: string) => void;
  onItemDoubleClick: (itemId: string) => void;
  onItemPointerDown: (e: React.PointerEvent<HTMLDivElement>, itemId: string) => void;
  onCornerResizePointerDown: (e: React.PointerEvent<HTMLButtonElement>, item: CanvasItem) => void;
  onManualTextCardInputChange: (itemId: string, value: string) => void;
  onManualTextCardBlur: (itemId: string) => void;
  getItemTargetRef: (itemId: string, role: string) => (element: HTMLElement | null) => void;
}) {
  const itemRenderCacheRef = useRef(new Map<string, {
    item: CanvasItem;
    element: React.ReactElement;
  }>());
  const renderContextRef = useRef<unknown[]>([]);
  const renderContext = [
    tool,
    connections,
    activeCanvasTextGenerationItemIds,
    activeCanvasImageGenerationItemIds,
    activeCanvasTextGenerations,
    activeCanvasImageGenerations,
    activeCanvasImageIds,
    editingTextCardId,
    editingTextCardTextareaRef,
    onImageCardOutputSelect,
    onItemMouseEnter,
    onItemMouseLeave,
    onItemClick,
    onItemDoubleClick,
    onItemPointerDown,
    onCornerResizePointerDown,
    onManualTextCardInputChange,
    onManualTextCardBlur,
    getItemTargetRef,
  ];
  const previousRenderContext = renderContextRef.current;
  const renderContextChanged =
    previousRenderContext.length !== renderContext.length ||
    renderContext.some((value, index) => previousRenderContext[index] !== value);
  if (renderContextChanged) {
    itemRenderCacheRef.current.clear();
    renderContextRef.current = renderContext;
  }
  useEffect(() => {
    const activeIds = new Set(items.map((item) => item.id));
    itemRenderCacheRef.current.forEach((_, itemId) => {
      if (!activeIds.has(itemId)) itemRenderCacheRef.current.delete(itemId);
    });
  }, [items]);

  return (
    <>
      {items.map((item) => {
        const cached = itemRenderCacheRef.current.get(item.id);
        if (cached?.item === item) return cached.element;
        const isTextCard = item.type === 'text' && item.textVariant === 'card';
        const isImageCard = isImageCardItem(item);
        const isImageActive = !isImageCard && !isImageAssetItem(item)
          ? true
          : activeCanvasImageGenerationItemIds.has(item.id) ||
            activeCanvasImageIds.has(item.id);
        const textCardFrameBounds = isTextCard || isImageCard ? getTextCardFrameBounds(item) : null;
        const textCardVisualState = isTextCard
          ? getTextCardVisualState({
              item,
              items,
              connections,
              generatingItemIds: activeCanvasTextGenerationItemIds,
              editingItemId: editingTextCardId,
            })
          : 'idle';
        const imageCardVisualState = isImageCard
          ? activeCanvasImageGenerationItemIds.has(item.id)
            ? item.src
              ? 'content'
              : 'waiting'
            : item.src
              ? 'content'
              : 'idle'
          : 'idle';
        const imageOutputCount = Array.isArray(item.imageOutputs) ? item.imageOutputs.length : 0;
        const activeImageOutputIndex = Number.isFinite(item.activeImageOutputIndex) ? item.activeImageOutputIndex ?? 0 : 0;
        const currentImageOutput = isImageCard ? getCurrentImageCardOutput(item) : null;
        const activeGenerationStartedAt = isTextCard
          ? activeCanvasTextGenerations[item.id]?.startedAt
          : isImageCard
            ? activeCanvasImageGenerations[item.id]?.startedAt
            : null;
        const itemCornerRadius = CANVAS_NODE_CORNER_RADIUS;
        const frameCornerRadius = CANVAS_NODE_CORNER_RADIUS;
        const selectedOutlineCornerRadius = CANVAS_NODE_CORNER_RADIUS;
        const hasGenerationDuration = Number.isFinite(activeGenerationStartedAt) || Number.isFinite(item.lastGenerationDurationMs);
        const currentImageDimensionsLabel = isImageCard && currentImageOutput
          ? Number.isFinite(currentImageOutput.naturalWidth) &&
            currentImageOutput.naturalWidth > 0 &&
            Number.isFinite(currentImageOutput.naturalHeight) &&
            currentImageOutput.naturalHeight > 0
              ? `${currentImageOutput.naturalWidth}×${currentImageOutput.naturalHeight}`
              : null
          : null;

        const element = (
          <div
            key={item.id}
            ref={getItemTargetRef(item.id, 'node-drag')}
            data-canvas-drag-shell="true"
            className="pointer-events-none absolute left-0 top-0"
            style={{
              width: item.width,
              height: item.height,
            }}
          >
            <div
              ref={getItemTargetRef(item.id, 'node-base-position')}
              data-canvas-base-position="true"
              className="absolute left-0 top-0 h-full w-full"
              style={{ transform: `translate3d(${item.x}px, ${item.y}px, 0)` }}
            >
              <div
                data-canvas-rotation-shell="true"
                className="h-full w-full"
                style={{ transform: `rotate(${item.rotation}deg)` }}
              >
                <div
                  ref={getItemTargetRef(item.id, 'node-resize')}
                  data-canvas-resize-shell="true"
                  data-canvas-item-id={item.id}
                  className={`pointer-events-auto relative h-full w-full group ${tool === 'target' && item.type === 'image' ? 'cursor-crosshair' : 'cursor-move'} ${!item.visible ? 'opacity-30' : ''}`}
                  onMouseEnter={() => onItemMouseEnter(item.id)}
                  onMouseLeave={() => onItemMouseLeave(item.id)}
                  onClick={(e) => onItemClick(e, item.id)}
                  onDoubleClick={() => onItemDoubleClick(item.id)}
                  onPointerDown={(e) => onItemPointerDown(e, item.id)}
                >
            {isImageAssetItem(item) && item.src && isImageActive && (
              <Image
                src={item.src}
                alt=""
                fill
                unoptimized={!canOptimizeCanvasImage(item.src)}
                quality={72}
                sizes={`(max-width: 1600px) ${Math.min(1600, Math.max(1, Math.round(item.width)))}px, 1600px`}
                loading="lazy"
                decoding="async"
                className="h-full w-full object-contain pointer-events-none"
                style={{ borderRadius: `${itemCornerRadius}px`, contain: 'layout paint style' }}
                draggable={false}
              />
            )}
            {isImageAssetItem(item) && item.src && !isImageActive && (
              <div
                data-canvas-image-shell="true"
                className="h-full w-full bg-black/10"
                style={{ borderRadius: `${itemCornerRadius}px`, contain: 'layout paint style' }}
              />
            )}
            {isImageCard && (
              <div className="relative h-full w-full">
                <div className="absolute inset-x-4 top-0 flex items-center justify-between gap-3 text-sm font-medium text-zinc-500">
                  <div className="inline-flex min-w-0 items-center gap-1.5">
                    <ImageIcon size={14} strokeWidth={2.1} />
                    <span>Image</span>
                  </div>
                  {(currentImageDimensionsLabel || hasGenerationDuration) && (
                    <div className="inline-flex items-center gap-2">
                      {currentImageDimensionsLabel && (
                        <div className="workspace-control-chip inline-flex h-6 items-center gap-1 rounded-lg px-2 text-[11px]">
                          <span>{currentImageDimensionsLabel}</span>
                        </div>
                      )}
                      <CanvasGenerationDurationBadge
                        startedAt={activeGenerationStartedAt}
                        lastDurationMs={item.lastGenerationDurationMs}
                      />
                    </div>
                  )}
                </div>
                <div
                  className="workspace-panel-surface absolute overflow-hidden"
                  style={{
                    left: `${TEXT_CARD_FRAME_INSET_X}px`,
                    top: `${TEXT_CARD_FRAME_TOP}px`,
                    right: `${TEXT_CARD_FRAME_INSET_X}px`,
                    bottom: `${TEXT_CARD_FRAME_BOTTOM}px`,
                    borderRadius: `${frameCornerRadius}px`,
                  }}
                >
                  <div className="flex h-full w-full items-center justify-center">
                    {imageCardVisualState === 'idle' && (
                      <div className="w-full max-w-[560px] px-8 py-10 text-left">
                        <div className="flex flex-col gap-4">
                          <div className="workspace-text-muted px-2 text-sm">尝试：</div>
                          <div className="flex w-full flex-col items-start gap-2">
                            {IMAGE_CARD_MENU_OPTIONS.map((option) => {
                              const Icon = option.icon;
                              return (
                                <button
                                  key={option.label}
                                  type="button"
                                  onPointerDown={(e) => {
                                    e.stopPropagation();
                                  }}
                                  className="workspace-menu-item group/row flex w-full items-center justify-start gap-2.5 rounded-[14px] border border-transparent px-3 py-2 text-left"
                                >
                                  <Icon
                                    size={16}
                                    className="shrink-0"
                                  />
                                  <span className="text-[15px] font-medium tracking-[-0.02em]">
                                    {option.label}
                                  </span>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                    )}
                    {imageCardVisualState === 'waiting' && (
                      <div className="flex h-full w-full items-center justify-center px-8 py-10 text-center">
                        <span className="text-[17px] font-medium tracking-[-0.03em] text-zinc-500">
                          图片生成中……
                        </span>
                      </div>
                    )}
                    {imageCardVisualState === 'content' && item.src && isImageActive && (() => {
                      return (
                        <div className="relative h-full w-full overflow-hidden bg-black/20">
                          <Image
                            src={item.src}
                            alt=""
                            fill
                            unoptimized={!canOptimizeCanvasImage(item.src)}
                            quality={72}
                            sizes={`(max-width: 1600px) ${Math.min(1600, Math.max(1, Math.round(item.width - TEXT_CARD_FRAME_INSET_X * 2)))}px, 1600px`}
                            loading="lazy"
                            decoding="async"
                            className="object-cover pointer-events-none"
                            style={{ contain: 'layout paint style' }}
                            draggable={false}
                          />
                          {imageOutputCount > 1 && (
                            <div className="absolute inset-x-3 bottom-3 flex items-center justify-between gap-3">
                              <button
                                type="button"
                                onPointerDown={(e) => {
                                  e.stopPropagation();
                                }}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onImageCardOutputSelect(item.id, activeImageOutputIndex - 1);
                                }}
                                className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-black/55 text-zinc-100  hover:bg-black/70"
                                aria-label="查看上一张"
                              >
                                <ArrowLeft size={15} />
                              </button>
                              <div className="rounded-full border border-white/10 bg-black/55 px-3 py-1 text-[12px] font-medium text-zinc-100">
                                {activeImageOutputIndex + 1} / {imageOutputCount}
                              </div>
                              <button
                                type="button"
                                onPointerDown={(e) => {
                                  e.stopPropagation();
                                }}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onImageCardOutputSelect(item.id, activeImageOutputIndex + 1);
                                }}
                                className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-black/55 text-zinc-100  hover:bg-black/70"
                                aria-label="查看下一张"
                              >
                                <ArrowLeft size={15} className="rotate-180" />
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    })()}
                    {imageCardVisualState === 'content' && item.src && !isImageActive && (
                      <div
                        data-canvas-image-shell="true"
                        className="h-full w-full bg-black/20"
                        style={{ contain: 'layout paint style' }}
                      />
                    )}
                  </div>
                </div>
              </div>
            )}
            {item.type === 'shape' && <div className="h-full w-full rounded" style={{ backgroundColor: item.fill }} />}
            {item.type === 'text' && item.textVariant !== 'card' && (
              <div className="flex h-full w-full items-center justify-center text-sm text-zinc-100">{item.text}</div>
            )}
            {item.type === 'text' && item.textVariant === 'card' && (
              <div className="relative h-full w-full">
                <div className="absolute inset-x-4 top-0 flex items-center justify-between gap-3 text-sm font-medium text-zinc-500">
                  <div className="inline-flex min-w-0 items-center gap-1.5">
                    <Type size={14} strokeWidth={2.1} />
                    <span>Text</span>
                  </div>
                  <CanvasGenerationDurationBadge
                    startedAt={activeGenerationStartedAt}
                    lastDurationMs={item.lastGenerationDurationMs}
                  />
                </div>
                <div
                  className="workspace-panel-surface absolute overflow-hidden"
                  style={{
                    left: `${TEXT_CARD_FRAME_INSET_X}px`,
                    top: `${TEXT_CARD_FRAME_TOP}px`,
                    right: `${TEXT_CARD_FRAME_INSET_X}px`,
                    bottom: `${TEXT_CARD_FRAME_BOTTOM}px`,
                    borderRadius: `${frameCornerRadius}px`,
                  }}
                >
                  <div className="flex h-full w-full items-center justify-center">
                    {textCardVisualState === 'idle' && (
                      <div className="w-full max-w-[560px] px-8 py-10 text-left">
                        <div className="flex flex-col gap-4">
                          <div className="workspace-text-muted px-2 text-sm">尝试：</div>
                          <div className="flex w-full flex-col items-start gap-2">
                            {[
                              { icon: Pencil, label: '自己编写内容' },
                              { icon: Video, label: '文字生视频' },
                              { icon: ImageIcon, label: '图片反推提示词' },
                            ].map((option) => {
                              const Icon = option.icon;
                              return (
                                <button
                                  key={option.label}
                                  type="button"
                                  onPointerDown={(e) => {
                                    e.stopPropagation();
                                  }}
                                  className="workspace-menu-item group/row flex w-full items-center justify-start gap-2.5 rounded-[14px] border border-transparent px-3 py-2 text-left"
                                >
                                  <Icon
                                    size={16}
                                    className="shrink-0"
                                  />
                                  <span className="text-[15px] font-medium tracking-[-0.02em]">
                                    {option.label}
                                  </span>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                    )}
                    {textCardVisualState === 'waiting' && (
                      <div className="flex h-full w-full items-center justify-center px-8 text-center">
                        <span className="text-[17px] font-medium tracking-[-0.03em] text-zinc-500">
                          等待生成中……
                        </span>
                      </div>
                    )}
                    {textCardVisualState === 'content' && (
                      <div
                        className="panel-scrollbar h-full min-w-0 w-full overflow-y-auto"
                        onWheel={stopCanvasWheelFromScrollableRegion}
                      >
                        <div
                          data-assistant-selectable="true"
                          className="assistant-selectable-node pointer-events-auto min-h-full w-full min-w-0 break-words px-6 py-5"
                          onPointerDown={(e) => {
                            e.stopPropagation();
                          }}
                          onDoubleClick={(e) => {
                            e.stopPropagation();
                          }}
                        >
                          <TextCardMarkdown content={item.text || ''} />
                        </div>
                      </div>
                    )}
                    {textCardVisualState === 'manual-editing' && (
                      <div className="h-full w-full px-6 py-5">
                        <textarea
                          data-manual-text-card-editor="true"
                          ref={item.id === editingTextCardId ? editingTextCardTextareaRef : null}
                          value={item.text || ''}
                          onChange={(e) => onManualTextCardInputChange(item.id, e.target.value)}
                          onBlur={() => onManualTextCardBlur(item.id)}
                          onPointerDown={(e) => {
                            e.stopPropagation();
                          }}
                          onDoubleClick={(e) => {
                            e.stopPropagation();
                          }}
                          onWheel={stopCanvasWheelFromScrollableRegion}
                          className={`panel-scrollbar h-full min-w-0 w-full resize-none bg-transparent ${TEXT_CARD_BODY_TEXT_CLASSNAME} outline-none placeholder:text-zinc-500`}
                          placeholder="请输入文本内容..."
                        />
                      </div>
                    )}
                    {textCardVisualState === 'manual-content' && (
                      <div
                        className="panel-scrollbar h-full min-w-0 w-full overflow-y-auto"
                        onWheel={stopCanvasWheelFromScrollableRegion}
                      >
                        <div
                          data-assistant-selectable="true"
                          className={`assistant-selectable-node pointer-events-auto min-h-full w-full min-w-0 whitespace-pre-wrap break-words px-6 py-5 ${TEXT_CARD_BODY_TEXT_CLASSNAME}`}
                          onPointerDown={(e) => {
                            e.stopPropagation();
                          }}
                          onDoubleClick={(e) => {
                            e.stopPropagation();
                            onItemDoubleClick(item.id);
                          }}
                        >
                          {item.text || ''}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
            {(isTextCard || isImageCard) && textCardFrameBounds ? (
                <div
                  ref={getItemTargetRef(item.id, 'node-selection-outline')}
                  data-canvas-selection-outline="true"
                  className="invisible absolute z-10 pointer-events-none"
                  style={{
                    left: `${textCardFrameBounds.left - NODE_SELECTED_OUTLINE_WIDTH}px`,
                    top: `${textCardFrameBounds.top - NODE_SELECTED_OUTLINE_WIDTH}px`,
                    width: `${textCardFrameBounds.width + NODE_SELECTED_OUTLINE_WIDTH * 2}px`,
                    height: `${textCardFrameBounds.height + NODE_SELECTED_OUTLINE_WIDTH * 2}px`,
                    borderRadius: `${selectedOutlineCornerRadius}px`,
                    border: `${NODE_SELECTED_OUTLINE_WIDTH}px solid ${NODE_SELECTED_OUTLINE_COLOR}`,
                  }}
                />
              ) : (
                <div
                  ref={getItemTargetRef(item.id, 'node-selection-outline')}
                  data-canvas-selection-outline="true"
                  className="invisible absolute z-10 pointer-events-none"
                  style={{
                    inset: `${-NODE_SELECTED_OUTLINE_WIDTH}px`,
                    borderRadius: `${selectedOutlineCornerRadius}px`,
                    border: `${NODE_SELECTED_OUTLINE_WIDTH}px solid ${NODE_SELECTED_OUTLINE_COLOR}`,
                  }}
                />
              )}
            <button
                data-corner-resize="true"
                onPointerDown={(e) => onCornerResizePointerDown(e, item)}
                className="pointer-events-none absolute flex cursor-nwse-resize items-center justify-center overflow-visible bg-transparent opacity-0 group-hover:pointer-events-auto group-hover:opacity-100"
                style={{
                  width: `${CORNER_HANDLE_HIT_SIZE}px`,
                  height: `${CORNER_HANDLE_HIT_SIZE}px`,
                  right: isTextCard || isImageCard
                    ? `${TEXT_CARD_FRAME_INSET_X + CORNER_HANDLE_HIT_OFFSET}px`
                    : `${CORNER_HANDLE_HIT_OFFSET}px`,
                  bottom: isTextCard || isImageCard
                    ? `${TEXT_CARD_FRAME_BOTTOM + CORNER_HANDLE_HIT_OFFSET}px`
                    : `${CORNER_HANDLE_HIT_OFFSET}px`,
                }}
                aria-label="缩放"
              >
                <svg
                  viewBox={`0 0 ${CORNER_HANDLE_SIZE} ${CORNER_HANDLE_SIZE}`}
                  className="pointer-events-none absolute"
                  style={{
                    width: `${CORNER_HANDLE_SIZE}px`,
                    height: `${CORNER_HANDLE_SIZE}px`,
                    left: `${CORNER_HANDLE_VISUAL_OFFSET}px`,
                    top: `${CORNER_HANDLE_VISUAL_OFFSET}px`,
                  }}
                >
                  <path
                    d={`M ${CORNER_HANDLE_CENTER + HANDLE_ARC_RADIUS} ${CORNER_HANDLE_CENTER} L ${CORNER_HANDLE_CENTER + HANDLE_ARC_RADIUS} ${CORNER_HANDLE_CENTER + HANDLE_ARC_RADIUS} L ${CORNER_HANDLE_CENTER} ${CORNER_HANDLE_CENTER + HANDLE_ARC_RADIUS}`}
                    fill="none"
                    stroke="rgba(226,232,240,0.8)"
                    strokeWidth={CORNER_HANDLE_STROKE}
                    strokeLinecap="round"
                  />
                </svg>
              </button>
                </div>
              </div>
            </div>
          </div>
        );
        itemRenderCacheRef.current.set(item.id, { item, element });
        return element;
      })}
    </>
  );
});

type CanvasNodesContentProps = React.ComponentProps<typeof CanvasNodesContent>;

const CanvasNodesLayer = memo(function CanvasNodesLayer({
  multiSelectionBounds,
  onSelectionGroupPointerDown,
  selectionGroupRef,
  ...contentProps
}: CanvasNodesContentProps & {
  multiSelectionBounds: { left: number; top: number; width: number; height: number } | null;
  onSelectionGroupPointerDown: (e: React.PointerEvent<HTMLDivElement>) => void;
  selectionGroupRef: (element: HTMLDivElement | null) => void;
}) {
  return (
    <div className="pointer-events-none absolute z-[2]">
      {multiSelectionBounds && (
        <div
          ref={selectionGroupRef}
          data-selection-group="true"
          className="pointer-events-auto absolute rounded-[28px] border border-white/20 bg-white/[0.06]"
          style={{
            left: multiSelectionBounds.left - 10,
            top: multiSelectionBounds.top - 10,
            width: multiSelectionBounds.width + 20,
            height: multiSelectionBounds.height + 20,
          }}
          onPointerDown={onSelectionGroupPointerDown}
        />
      )}
      <CanvasNodesContent {...contentProps} />
    </div>
  );
});

const CanvasAnnotationsContent = memo(function CanvasAnnotationsContent({
  items,
  selectedIds,
  selectedId,
  hoveredCanvasItemId,
  editingAnnotationTextId,
  editingAnnotationTextRef,
  draftStroke,
  draftStrokePathRef,
  onItemMouseEnter,
  onItemMouseLeave,
  onItemClick,
  onItemDoubleClick,
  onItemPointerDown,
  onAnnotationTextChange,
  onAnnotationTextBlur,
  getItemTargetRef,
}: {
  items: CanvasItem[];
  selectedIds: string[];
  selectedId: string | null;
  hoveredCanvasItemId: string | null;
  editingAnnotationTextId: string | null;
  editingAnnotationTextRef: React.RefObject<HTMLTextAreaElement | null>;
  draftStroke: DraftStroke | null;
  draftStrokePathRef: React.RefObject<SVGPathElement | null>;
  onItemMouseEnter: (itemId: string) => void;
  onItemMouseLeave: (itemId: string) => void;
  onItemClick: (e: React.MouseEvent<HTMLDivElement>, itemId: string) => void;
  onItemDoubleClick: (itemId: string) => void;
  onItemPointerDown: (e: React.PointerEvent<HTMLDivElement>, itemId: string) => void;
  onAnnotationTextChange: (itemId: string, value: string, height: number) => void;
  onAnnotationTextBlur: (itemId: string) => void;
  getItemTargetRef: (itemId: string, role: string) => (element: HTMLElement | null) => void;
}) {
  const annotationItems = React.useMemo(() => items.filter(isCanvasAnnotationItem), [items]);

  return (
    <>
      {draftStroke && draftStroke.points.length > 0 && (
        <svg className="pointer-events-none absolute left-0 top-0 overflow-visible" width="1" height="1" aria-hidden="true">
          <path
            ref={draftStrokePathRef}
            d={buildStrokePath(draftStroke.points)}
            fill="none"
            stroke={draftStroke.color}
            strokeWidth={draftStroke.width}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )}
      {annotationItems.map((item) => {
        const isSelected = selectedIds.includes(item.id) || selectedId === item.id;
        const isEditingText = isCanvasAnnotationTextItem(item) && editingAnnotationTextId === item.id;

        return (
          <div
            key={item.id}
            ref={getItemTargetRef(item.id, 'annotation-drag')}
            data-canvas-drag-shell="true"
            className="pointer-events-none absolute left-0 top-0"
            style={{
              width: item.width,
              height: item.height,
            }}
          >
            <div
              ref={getItemTargetRef(item.id, 'annotation-base-position')}
              data-canvas-base-position="true"
              className="absolute left-0 top-0 h-full w-full"
              style={{ transform: `translate3d(${item.x}px, ${item.y}px, 0)` }}
            >
              <div
                data-canvas-rotation-shell="true"
                className="h-full w-full"
                style={{ transform: `rotate(${item.rotation}deg)` }}
              >
                <div
                  ref={getItemTargetRef(item.id, 'annotation-resize')}
                  data-canvas-resize-shell="true"
                  data-canvas-item-id={item.id}
                  data-canvas-annotation="true"
                  className={`pointer-events-auto relative h-full w-full group cursor-move ${!item.visible ? 'opacity-30' : ''}`}
                  onMouseEnter={() => onItemMouseEnter(item.id)}
                  onMouseLeave={() => onItemMouseLeave(item.id)}
                  onClick={(event) => onItemClick(event, item.id)}
                  onDoubleClick={(event) => {
                    event.stopPropagation();
                    onItemDoubleClick(item.id);
                  }}
                  onPointerDown={(event) => onItemPointerDown(event, item.id)}
                >
            {item.type === 'stroke' && (
              <svg className="absolute inset-0 h-full w-full overflow-visible" viewBox={`0 0 ${Math.max(1, item.width)} ${Math.max(1, item.height)}`}>
                <path
                  d={buildStrokePath(item.points || [])}
                  fill="none"
                  stroke="transparent"
                  strokeWidth={Math.max(14, (item.strokeWidth || DEFAULT_ANNOTATION_STROKE_WIDTH) + 10)}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="pointer-events-auto"
                />
                <path
                  d={buildStrokePath(item.points || [])}
                  fill="none"
                  stroke={item.strokeColor || DEFAULT_ANNOTATION_COLOR}
                  strokeWidth={item.strokeWidth || DEFAULT_ANNOTATION_STROKE_WIDTH}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="pointer-events-none"
                />
              </svg>
            )}
            {isCanvasAnnotationTextItem(item) && (
              isEditingText ? (
                <textarea
                  ref={editingAnnotationTextRef}
                  data-annotation-text-editor="true"
                  value={item.text || ''}
                  onChange={(event) => {
                    event.currentTarget.style.height = '0px';
                    const nextHeight = Math.max(
                      ANNOTATION_TEXT_DEFAULT_HEIGHT,
                      event.currentTarget.scrollHeight
                    );
                    event.currentTarget.style.height = `${nextHeight}px`;
                    onAnnotationTextChange(item.id, event.target.value, nextHeight);
                  }}
                  onBlur={() => onAnnotationTextBlur(item.id)}
                  onKeyDown={(event) => {
                    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                      event.preventDefault();
                      event.currentTarget.blur();
                    } else if (event.key === 'Escape') {
                      event.preventDefault();
                      event.currentTarget.blur();
                    }
                  }}
                  onPointerDown={(event) => event.stopPropagation()}
                  className="h-full w-full resize-none overflow-hidden bg-transparent p-0 font-semibold outline-none"
                  style={{
                    color: item.textColor || DEFAULT_ANNOTATION_COLOR,
                    fontSize: item.fontSize || ANNOTATION_TEXT_DEFAULT_FONT_SIZE,
                    lineHeight: 1.25,
                  }}
                  placeholder="输入标注"
                />
              ) : (
                <div
                  className="h-full w-full whitespace-pre-wrap break-words font-semibold"
                  style={{
                    color: item.textColor || DEFAULT_ANNOTATION_COLOR,
                    fontSize: item.fontSize || ANNOTATION_TEXT_DEFAULT_FONT_SIZE,
                    lineHeight: 1.25,
                  }}
                >
                  {item.text}
                </div>
              )
            )}
            {isSelected && selectedIds.length <= 1 && !isEditingText && (
              <div
                className="pointer-events-none absolute border border-blue-400/90"
                style={{ inset: -4, borderRadius: item.type === 'stroke' ? 8 : 4 }}
              />
            )}
            {!isSelected && !isEditingText && (
              <div
                className="pointer-events-none absolute border border-blue-300/40 opacity-0 group-hover:opacity-100"
                style={{ inset: -3, borderRadius: item.type === 'stroke' ? 8 : 4 }}
              />
            )}
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </>
  );
});

type CanvasAnnotationsContentProps = React.ComponentProps<typeof CanvasAnnotationsContent>;

const CanvasAnnotationsLayer = memo(function CanvasAnnotationsLayer({
  ...contentProps
}: CanvasAnnotationsContentProps) {
  return (
    <div className="pointer-events-none absolute z-[3]">
      <CanvasAnnotationsContent {...contentProps} />
    </div>
  );
});

const CanvasViewport = memo(function CanvasViewport({
  canvasRef,
  canvasSceneRef,
  canvasSize,
  canvasRect,
  widthStyle,
  tool,
  isSpacePressed,
  viewport,
  themePalette,
  items,
  connections,
  itemById,
  selectedIds,
  selectedId,
  selectedConnectionIds,
  regionSelections,
  activeRegionId,
  hoveredCanvasItemId,
  hoveredInputPortItemId,
  hoveredOutputPortItemId,
  connectionMode,
  connectionFromItemId,
  frozenPreviewConnection,
  pendingConnectionMenu,
  multiSelectionBounds,
  marqueeElementRef,
  marqueePathRef,
  getConnectionAnchorCanvasPoint,
  toCanvasScreenPoint,
  buildConnectionPath,
  getItemTargetRef,
  getSelectionGroupRef,
  getConnectionPathRef,
  connectionPreviewPathRef,
  getViewportOverlayRef,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerLeave,
  onNativeWheel,
  onMetricsChange,
  onPaste,
  onConnectionPointerDown,
  onInputPortEnter,
  onInputPortLeave,
  onOutputPortEnter,
  onOutputPortLeave,
  onOutputPortPointerDown,
  onSelectionGroupPointerDown,
  onItemMouseEnter,
  onItemMouseLeave,
  onItemClick,
  onItemPointerDown,
  onRegionClick,
  onCornerResizePointerDown,
  onPendingMenuPointerDown,
  onPendingMenuAction,
  selectedTextCardPanelItem,
  linkedImagePreviews,
  selectedTextCardPanelLinkedTexts,
  selectedImageCardPanelItem,
  selectedImageCardPanelLinkedImagePreviews,
  activeCanvasTextGenerationItemIds,
  activeCanvasImageGenerationItemIds,
  activeCanvasTextGenerations,
  activeCanvasImageGenerations,
  activeCanvasImageIds,
  selectedTextPanelModel,
  textPanelModelOptions,
  selectedTextCardProviderLabel,
  selectableTextProviders,
  selectedTextCardProviderId,
  showTextPanelProviderMenu,
  textPanelProviderMenuRef,
  textPanelProviderPopoverRef,
  showTextPanelModelMenu,
  textPanelModelMenuRef,
  textPanelModelPopoverRef,
  selectedTextCardPanelInput,
  selectedTextCardPanelCanSubmit,
  selectedTextCardPanelError,
  isSelectedTextCardGenerating,
  selectedImageCardPanelInput,
  selectedImageCardPanelCanSubmit,
  selectedImageCardPanelError,
  selectedImageCardModel,
  imageCardModelOptions,
  selectedImageCardAspectRatioOptions,
  selectedImageCardPanelSize,
  selectedImageCardSizeOptions,
  selectedImageCardEnabledAspectRatios,
  selectedImageCardPanelQuality,
  selectedImageCardQualityOptions,
  selectedImageCardPanelCount,
  selectedImageCardPanelAspectRatio,
  isSelectedImageCardGenerating,
  selectedImageCardProviderLabel,
  selectableImageProviders,
  selectedImageCardProviderId,
  showImageCardProviderMenu,
  imageCardProviderMenuRef,
  imageCardProviderPopoverRef,
  showImageCardModelMenu,
  imageCardModelMenuRef,
  imageCardModelPopoverRef,
  showImageCardSettingsMenu,
  imageCardSettingsMenuRef,
  imageCardSettingsPopoverRef,
  editingTextCardId,
  editingTextCardTextareaRef,
  editingAnnotationTextId,
  editingAnnotationTextRef,
  draftStroke,
  draftStrokePathRef,
  onToggleTextPanelProviderMenu,
  onSelectTextPanelProvider,
  onToggleTextPanelModelMenu,
  onSelectTextPanelModel,
  onSelectedTextCardPanelInputChange,
  onSelectedTextCardPanelBlur,
  onSelectedTextCardPanelSubmit,
  onSelectedTextCardPanelCancel,
  onToggleImageCardProviderMenu,
  onSelectImageCardProvider,
  onToggleImageCardModelMenu,
  onSelectImageCardModel,
  onToggleImageCardSettingsMenu,
  onSelectImageCardSize,
  onSelectImageCardQuality,
  onSelectImageCardCount,
  onSelectImageCardAspectRatio,
  onSelectedImageCardPanelInputChange,
  onSelectedImageCardPanelBlur,
  onSelectedImageCardPanelSubmit,
  onSelectedImageCardPanelCancel,
  onItemDoubleClick,
  onManualTextCardInputChange,
  onManualTextCardBlur,
  onAnnotationTextChange,
  onAnnotationTextBlur,
  onImageCardOutputSelect,
  draggingPanelReference,
  dragOverPanelReference,
  onPanelReferenceDragStart,
  onPanelReferenceDragOver,
  onPanelReferenceDrop,
  onPanelReferenceDragEnd,
}: {
  canvasRef: React.RefObject<HTMLDivElement | null>;
  canvasSceneRef: (element: HTMLDivElement | null) => void;
  canvasSize: CanvasSize;
  canvasRect: Pick<DOMRect, 'left' | 'top'>;
  widthStyle: string;
  tool: Tool;
  isSpacePressed: boolean;
  viewport: ViewportState;
  themePalette: typeof DARK_THEME;
  items: CanvasItem[];
  connections: Connection[];
  itemById: Record<string, CanvasItem>;
  selectedIds: string[];
  selectedId: string | null;
  selectedConnectionIds: string[];
  regionSelections: RegionSelection[];
  activeRegionId: string | null;
  hoveredCanvasItemId: string | null;
  hoveredInputPortItemId: string | null;
  hoveredOutputPortItemId: string | null;
  connectionMode: ConnectionMode;
  connectionFromItemId: string | null;
  frozenPreviewConnection: FrozenPreviewConnection | null;
  pendingConnectionMenu: PendingConnectionMenu | null;
  multiSelectionBounds: { left: number; top: number; width: number; height: number } | null;
  marqueeElementRef: (element: SVGSVGElement | null) => void;
  marqueePathRef: (element: SVGPathElement | null) => void;
  getConnectionAnchorCanvasPoint: (item: CanvasItem, side: 'left' | 'right') => { x: number; y: number };
  toCanvasScreenPoint: (point: { x: number; y: number }) => { x: number; y: number };
  buildConnectionPath: (from: { x: number; y: number }, to: { x: number; y: number }) => string;
  getItemTargetRef: (itemId: string, role: string) => (element: HTMLElement | null) => void;
  getSelectionGroupRef: (element: HTMLDivElement | null) => void;
  getConnectionPathRef: (connectionId: string, role: string) => (element: SVGPathElement | null) => void;
  connectionPreviewPathRef: React.RefObject<SVGPathElement | null>;
  getViewportOverlayRef: (key: string) => (element: HTMLElement | null) => void;
  onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => void;
  onPointerMove: (e: React.PointerEvent<HTMLDivElement>) => void;
  onPointerUp: (e?: React.PointerEvent<HTMLDivElement>) => void;
  onPointerLeave: () => void;
  onNativeWheel: (event: WheelEvent) => void;
  onMetricsChange: (metrics: CanvasMetrics) => void;
  onPaste: (e: React.ClipboardEvent<HTMLDivElement>) => void;
  onConnectionPointerDown: (e: React.PointerEvent<SVGPathElement>, connectionId: string) => void;
  onInputPortEnter: (itemId: string) => void;
  onInputPortLeave: (itemId: string) => void;
  onOutputPortEnter: (itemId: string) => void;
  onOutputPortLeave: (itemId: string) => void;
  onOutputPortPointerDown: (
    e: React.PointerEvent<HTMLElement>,
    item: CanvasItem
  ) => void;
  onSelectionGroupPointerDown: (e: React.PointerEvent<HTMLDivElement>) => void;
  onItemMouseEnter: (itemId: string) => void;
  onItemMouseLeave: (itemId: string) => void;
  onItemClick: (e: React.MouseEvent<HTMLDivElement>, itemId: string) => void;
  onItemPointerDown: (e: React.PointerEvent<HTMLDivElement>, itemId: string) => void;
  onRegionClick: (regionId: string) => void;
  onCornerResizePointerDown: (e: React.PointerEvent<HTMLButtonElement>, item: CanvasItem) => void;
  onPendingMenuPointerDown: (e: React.PointerEvent<HTMLDivElement>) => void;
  onPendingMenuAction: (optionId: (typeof CONNECTION_MENU_OPTIONS)[number]['id']) => void;
  selectedTextCardPanelItem: CanvasItem | null;
  linkedImagePreviews: Array<{ id: string; src: string; label: string; alt?: string }>;
  selectedTextCardPanelLinkedTexts: Array<{ id: string; text: string }>;
  selectedImageCardPanelItem: CanvasItem | null;
  selectedImageCardPanelLinkedImagePreviews: Array<{ id: string; src: string; label: string; alt?: string }>;
  activeCanvasTextGenerationItemIds: Set<string>;
  activeCanvasImageGenerationItemIds: Set<string>;
  activeCanvasTextGenerations: Record<string, { status: 'running'; startedAt: number }>;
  activeCanvasImageGenerations: Record<string, { status: 'running'; startedAt: number; total: number; completed: number; failed: number }>;
  activeCanvasImageIds: Set<string>;
  selectedTextPanelModel: { id: string; label: string };
  textPanelModelOptions: Array<{ id: string; label: string }>;
  selectedTextCardProviderLabel: string;
  selectableTextProviders: ProviderSettingsItem[];
  selectedTextCardProviderId: string;
  showTextPanelProviderMenu: boolean;
  textPanelProviderMenuRef: React.RefObject<HTMLDivElement | null>;
  textPanelProviderPopoverRef: React.RefObject<HTMLDivElement | null>;
  showTextPanelModelMenu: boolean;
  textPanelModelMenuRef: React.RefObject<HTMLDivElement | null>;
  textPanelModelPopoverRef: React.RefObject<HTMLDivElement | null>;
  selectedTextCardPanelInput: string;
  selectedTextCardPanelCanSubmit: boolean;
  selectedTextCardPanelError: string | null;
  isSelectedTextCardGenerating: boolean;
  selectedImageCardPanelInput: string;
  selectedImageCardPanelCanSubmit: boolean;
  selectedImageCardPanelError: string | null;
  selectedImageCardModel: { id: string; label: string };
  imageCardModelOptions: Array<{ id: string; label: string }>;
  selectedImageCardAspectRatioOptions: string[];
  selectedImageCardPanelSize: string;
  selectedImageCardSizeOptions: Array<{ id: string; label: string }>;
  selectedImageCardEnabledAspectRatios: string[];
  selectedImageCardPanelQuality: string;
  selectedImageCardQualityOptions: Array<{ id: string; label: string }>;
  selectedImageCardPanelCount: number;
  selectedImageCardPanelAspectRatio: string;
  isSelectedImageCardGenerating: boolean;
  selectedImageCardProviderLabel: string;
  selectableImageProviders: ProviderSettingsItem[];
  selectedImageCardProviderId: string;
  showImageCardProviderMenu: boolean;
  imageCardProviderMenuRef: React.RefObject<HTMLDivElement | null>;
  imageCardProviderPopoverRef: React.RefObject<HTMLDivElement | null>;
  showImageCardModelMenu: boolean;
  imageCardModelMenuRef: React.RefObject<HTMLDivElement | null>;
  imageCardModelPopoverRef: React.RefObject<HTMLDivElement | null>;
  showImageCardSettingsMenu: boolean;
  imageCardSettingsMenuRef: React.RefObject<HTMLDivElement | null>;
  imageCardSettingsPopoverRef: React.RefObject<HTMLDivElement | null>;
  editingTextCardId: string | null;
  editingTextCardTextareaRef: React.RefObject<HTMLTextAreaElement | null>;
  editingAnnotationTextId: string | null;
  editingAnnotationTextRef: React.RefObject<HTMLTextAreaElement | null>;
  draftStroke: DraftStroke | null;
  draftStrokePathRef: React.RefObject<SVGPathElement | null>;
  onToggleTextPanelProviderMenu: () => void;
  onSelectTextPanelProvider: (providerId: string) => void;
  onToggleTextPanelModelMenu: () => void;
  onSelectTextPanelModel: (modelId: string) => void;
  onSelectedTextCardPanelInputChange: (value: string) => void;
  onSelectedTextCardPanelBlur: () => void;
  onSelectedTextCardPanelSubmit: () => void;
  onSelectedTextCardPanelCancel: () => void;
  onToggleImageCardProviderMenu: () => void;
  onSelectImageCardProvider: (providerId: string) => void;
  onToggleImageCardModelMenu: () => void;
  onSelectImageCardModel: (modelId: string) => void;
  onToggleImageCardSettingsMenu: () => void;
  onSelectImageCardSize: (sizeId: string) => void;
  onSelectImageCardQuality: (qualityId: string) => void;
  onSelectImageCardCount: (count: number) => void;
  onSelectImageCardAspectRatio: (aspectRatioId: string) => void;
  onSelectedImageCardPanelInputChange: (value: string) => void;
  onSelectedImageCardPanelBlur: () => void;
  onSelectedImageCardPanelSubmit: () => void;
  onSelectedImageCardPanelCancel: () => void;
  onItemDoubleClick: (itemId: string) => void;
  onManualTextCardInputChange: (itemId: string, value: string) => void;
  onManualTextCardBlur: (itemId: string) => void;
  onAnnotationTextChange: (itemId: string, value: string, height: number) => void;
  onAnnotationTextBlur: (itemId: string) => void;
  onImageCardOutputSelect: (itemId: string, outputIndex: number) => void;
  draggingPanelReference: { targetItemId: string; sourceItemId: string } | null;
  dragOverPanelReference: { targetItemId: string; sourceItemId: string } | null;
  onPanelReferenceDragStart: (
    e: React.DragEvent<HTMLDivElement>,
    targetItemId: string,
    sourceItemId: string
  ) => void;
  onPanelReferenceDragOver: (
    e: React.DragEvent<HTMLDivElement>,
    targetItemId: string,
    sourceItemId: string
  ) => void;
  onPanelReferenceDrop: (
    e: React.DragEvent<HTMLDivElement>,
    targetItemId: string,
    sourceItemId: string
  ) => void;
  onPanelReferenceDragEnd: () => void;
}) {
  const regularItems = React.useMemo(
    () => items.filter((item) => !isCanvasAnnotationItem(item)),
    [items]
  );
  const selectedTextCardPanelTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const selectedImageCardPanelTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const selectedTextCardPanelRootRef = useRef<HTMLDivElement | null>(null);
  const selectedImageCardPanelRootRef = useRef<HTMLDivElement | null>(null);
  const registerSelectedTextPanelOverlay = getViewportOverlayRef('selected-text-panel');
  const registerSelectedImagePanelOverlay = getViewportOverlayRef('selected-image-panel');
  const setSelectedTextCardPanelRoot = useCallback((element: HTMLDivElement | null) => {
    selectedTextCardPanelRootRef.current = element;
  }, []);
  const setSelectedImageCardPanelRoot = useCallback((element: HTMLDivElement | null) => {
    selectedImageCardPanelRootRef.current = element;
  }, []);
  const [selectedImageCardCountInput, setSelectedImageCardCountInput] = useState(() => String(selectedImageCardPanelCount));
  const [selectedTextCardPanelInputMetrics, setSelectedTextCardPanelInputMetrics] = useState(() => ({
    height: TEXT_CARD_PANEL_INPUT_MIN_HEIGHT,
    isOverflowing: false,
  }));
  const [selectedImageCardPanelInputMetrics, setSelectedImageCardPanelInputMetrics] = useState(() => ({
    height: TEXT_CARD_PANEL_INPUT_MIN_HEIGHT,
    isOverflowing: false,
  }));

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.addEventListener('wheel', onNativeWheel, { passive: false, capture: true });
    return () => {
      canvas.removeEventListener('wheel', onNativeWheel, true);
    };
  }, [canvasRef, onNativeWheel]);

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let metricsFrame: number | null = null;
    const updateMetrics = () => {
      metricsFrame = null;
      const rect = canvas.getBoundingClientRect();
      onMetricsChange({
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
      });
    };
    const scheduleMetricsUpdate = () => {
      if (metricsFrame !== null) return;
      metricsFrame = requestAnimationFrame(updateMetrics);
    };

    updateMetrics();
    const observer = typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(scheduleMetricsUpdate);
    observer?.observe(canvas);
    window.addEventListener('resize', scheduleMetricsUpdate, { passive: true });
    window.addEventListener('scroll', scheduleMetricsUpdate, { passive: true, capture: true });
    window.visualViewport?.addEventListener('resize', scheduleMetricsUpdate, { passive: true });
    window.visualViewport?.addEventListener('scroll', scheduleMetricsUpdate, { passive: true });

    return () => {
      if (metricsFrame !== null) cancelAnimationFrame(metricsFrame);
      observer?.disconnect();
      window.removeEventListener('resize', scheduleMetricsUpdate);
      window.removeEventListener('scroll', scheduleMetricsUpdate, true);
      window.visualViewport?.removeEventListener('resize', scheduleMetricsUpdate);
      window.visualViewport?.removeEventListener('scroll', scheduleMetricsUpdate);
    };
  }, [canvasRef, onMetricsChange]);
  const connectionMenuWidth = 360;
  const connectionMenuHeight = 292;
  const connectionMenuPadding = 24;
  const scaledConnectionMenuWidth = connectionMenuWidth * viewport.scale;
  const scaledConnectionMenuHeight = connectionMenuHeight * viewport.scale;
  const pendingMenuLeft = pendingConnectionMenu
    ? Math.min(
        Math.max(pendingConnectionMenu.position.x + 18, connectionMenuPadding),
        Math.max(connectionMenuPadding, canvasSize.width - scaledConnectionMenuWidth - connectionMenuPadding)
      )
    : 0;
  const pendingMenuTop = pendingConnectionMenu
    ? Math.min(
        Math.max(pendingConnectionMenu.position.y - 40, connectionMenuPadding),
        Math.max(connectionMenuPadding, canvasSize.height - scaledConnectionMenuHeight - connectionMenuPadding)
      )
    : 0;
  const selectedTextCardPanelFrameBounds = selectedTextCardPanelItem
    ? getTextCardFrameBounds(selectedTextCardPanelItem)
    : null;
  const selectedImageCardPanelFrameBounds = selectedImageCardPanelItem
    ? getTextCardFrameBounds(selectedImageCardPanelItem)
    : null;
  const selectedTextCardPanelCanvasWidth = selectedTextCardPanelFrameBounds
    ? Math.max(TEXT_CARD_GENERATION_PANEL_DEFAULT_WIDTH, selectedTextCardPanelFrameBounds.width)
    : 0;
  const selectedImageCardPanelCanvasWidth = IMAGE_CARD_GENERATION_PANEL_DEFAULT_WIDTH;
  const selectedTextCardPanelDisplayInput = getDisplayableTextCardPanelDraft(selectedTextCardPanelInput);
  const selectedImageCardPanelDisplayInput = getDisplayableTextCardPanelDraft(selectedImageCardPanelInput);
  const focusSelectedTextCardPanelInput = useCallback(() => {
    const textarea = selectedTextCardPanelTextareaRef.current;
    if (!textarea) return;

    textarea.focus();
  }, []);
  const focusSelectedImageCardPanelInput = useCallback(() => {
    const textarea = selectedImageCardPanelTextareaRef.current;
    if (!textarea) return;

    textarea.focus();
  }, []);
  useLayoutEffect(() => {
    if (!selectedTextCardPanelItem?.id) {
      setSelectedTextCardPanelInputMetrics((prev) =>
        prev.height === TEXT_CARD_PANEL_INPUT_MIN_HEIGHT && !prev.isOverflowing
          ? prev
          : { height: TEXT_CARD_PANEL_INPUT_MIN_HEIGHT, isOverflowing: false }
      );
      return;
    }

    const textarea = selectedTextCardPanelTextareaRef.current;
    if (!textarea) return;

    const nextMetrics = syncAutoResizedTextareaLayout(textarea, {
      minHeight: TEXT_CARD_PANEL_INPUT_MIN_HEIGHT,
      maxHeight: TEXT_CARD_PANEL_INPUT_MAX_HEIGHT,
    });

    setSelectedTextCardPanelInputMetrics((prev) =>
      prev.height === nextMetrics.height && prev.isOverflowing === nextMetrics.isOverflowing ? prev : nextMetrics
    );
  }, [selectedTextCardPanelCanvasWidth, selectedTextCardPanelDisplayInput, selectedTextCardPanelItem?.id]);
  useLayoutEffect(() => {
    if (!selectedImageCardPanelItem?.id) {
      setSelectedImageCardPanelInputMetrics((prev) =>
        prev.height === TEXT_CARD_PANEL_INPUT_MIN_HEIGHT && !prev.isOverflowing
          ? prev
          : { height: TEXT_CARD_PANEL_INPUT_MIN_HEIGHT, isOverflowing: false }
      );
      return;
    }

    const textarea = selectedImageCardPanelTextareaRef.current;
    if (!textarea) return;

    const nextMetrics = syncAutoResizedTextareaLayout(textarea, {
      minHeight: TEXT_CARD_PANEL_INPUT_MIN_HEIGHT,
      maxHeight: TEXT_CARD_PANEL_INPUT_MAX_HEIGHT,
    });

    setSelectedImageCardPanelInputMetrics((prev) =>
      prev.height === nextMetrics.height && prev.isOverflowing === nextMetrics.isOverflowing ? prev : nextMetrics
    );
  }, [selectedImageCardPanelCanvasWidth, selectedImageCardPanelDisplayInput, selectedImageCardPanelItem?.id]);
  useEffect(() => {
    setSelectedImageCardCountInput(String(selectedImageCardPanelCount));
  }, [selectedImageCardPanelCount, selectedImageCardPanelItem?.id]);

  const commitSelectedImageCardCountInput = useCallback(() => {
    const parsedValue = Number.parseInt(selectedImageCardCountInput, 10);
    const nextCount = clampImageCardCount(parsedValue);
    setSelectedImageCardCountInput(String(nextCount));
    if (nextCount !== selectedImageCardPanelCount) {
      onSelectImageCardCount(nextCount);
    }
  }, [onSelectImageCardCount, selectedImageCardCountInput, selectedImageCardPanelCount]);

  const selectedTextCardPanelCanvasHeight =
    TEXT_CARD_GENERATION_PANEL_BASE_HEIGHT +
    (linkedImagePreviews.length > 0 ? TEXT_CARD_GENERATION_PANEL_PREVIEW_HEIGHT : 0) +
    Math.max(0, selectedTextCardPanelInputMetrics.height - TEXT_CARD_PANEL_INPUT_MIN_HEIGHT);
  const selectedImageCardPanelCanvasHeight =
    TEXT_CARD_GENERATION_PANEL_BASE_HEIGHT +
    (selectedImageCardPanelLinkedImagePreviews.length > 0 ? TEXT_CARD_GENERATION_PANEL_PREVIEW_HEIGHT : 0) +
    Math.max(0, selectedImageCardPanelInputMetrics.height - TEXT_CARD_PANEL_INPUT_MIN_HEIGHT);
  useLayoutEffect(() => {
    const panelElement = selectedTextCardPanelRootRef.current;
    const overlayGroup = panelElement?.parentElement;
    if (!panelElement || !overlayGroup || !selectedTextCardPanelItem?.id) return;
    const panelRect = panelElement.getBoundingClientRect();
    const measuredOffsets = ([
      [textPanelProviderMenuRef.current, '--canvas-text-provider-menu-left', '--canvas-text-provider-menu-top'],
      [textPanelModelMenuRef.current, '--canvas-text-model-menu-left', '--canvas-text-model-menu-top'],
    ] as const).map(([anchorElement, leftProperty, topProperty]) => {
      if (!(anchorElement instanceof HTMLElement)) return null;
      const offset = resolveFloatingPopoverOffset({
        panelRect,
        anchorRect: anchorElement.getBoundingClientRect(),
        scale: 1,
        placement: 'below-panel',
        gap: 12,
      });
      return offset ? { leftProperty, topProperty, offset } : null;
    });
    measuredOffsets.forEach((measurement) => {
      if (!measurement) return;
      overlayGroup.style.setProperty(measurement.leftProperty, `${measurement.offset.left}px`);
      overlayGroup.style.setProperty(measurement.topProperty, `${measurement.offset.top}px`);
    });
  }, [
    linkedImagePreviews.length,
    selectedTextCardPanelCanvasHeight,
    selectedTextCardPanelItem?.id,
    textPanelModelMenuRef,
    textPanelProviderMenuRef,
  ]);
  useLayoutEffect(() => {
    const panelElement = selectedImageCardPanelRootRef.current;
    const overlayGroup = panelElement?.parentElement;
    if (!panelElement || !overlayGroup || !selectedImageCardPanelItem?.id) return;
    const panelRect = panelElement.getBoundingClientRect();
    const measuredOffsets = ([
      [imageCardProviderMenuRef.current, '--canvas-image-provider-menu-left', '--canvas-image-provider-menu-top'],
      [imageCardModelMenuRef.current, '--canvas-image-model-menu-left', '--canvas-image-model-menu-top'],
      [imageCardSettingsMenuRef.current, '--canvas-image-settings-menu-left', '--canvas-image-settings-menu-top'],
    ] as const).map(([anchorElement, leftProperty, topProperty]) => {
      if (!(anchorElement instanceof HTMLElement)) return null;
      const offset = resolveFloatingPopoverOffset({
        panelRect,
        anchorRect: anchorElement.getBoundingClientRect(),
        scale: 1,
        placement: 'below-panel',
        gap: 12,
      });
      return offset ? { leftProperty, topProperty, offset } : null;
    });
    measuredOffsets.forEach((measurement) => {
      if (!measurement) return;
      overlayGroup.style.setProperty(measurement.leftProperty, `${measurement.offset.left}px`);
      overlayGroup.style.setProperty(measurement.topProperty, `${measurement.offset.top}px`);
    });
  }, [
    imageCardModelMenuRef,
    imageCardProviderMenuRef,
    imageCardSettingsMenuRef,
    selectedImageCardPanelCanvasHeight,
    selectedImageCardPanelItem?.id,
    selectedImageCardPanelLinkedImagePreviews.length,
  ]);
  const selectedTextCardPanelPlaceholder = getTextCardPanelPlaceholder({
    linkedImageCount: linkedImagePreviews.length,
    linkedTextCount: selectedTextCardPanelLinkedTexts.length,
  });
  const selectedTextCardPanelCanvasRect =
    selectedTextCardPanelItem && selectedTextCardPanelFrameBounds
      ? {
          left:
            selectedTextCardPanelItem.x +
            selectedTextCardPanelFrameBounds.left +
            (selectedTextCardPanelFrameBounds.width - selectedTextCardPanelCanvasWidth) / 2,
          top:
            selectedTextCardPanelItem.y +
            selectedTextCardPanelFrameBounds.top +
            selectedTextCardPanelFrameBounds.height +
            18,
          width: selectedTextCardPanelCanvasWidth,
          height: selectedTextCardPanelCanvasHeight,
        }
      : null;
  const selectedImageCardPanelCanvasRect =
    selectedImageCardPanelItem && selectedImageCardPanelFrameBounds
      ? {
          width: selectedImageCardPanelCanvasWidth,
          height: selectedImageCardPanelCanvasHeight,
        }
      : null;
  const selectedTextCardPanelAnchorPoint =
    selectedTextCardPanelItem && selectedTextCardPanelFrameBounds
      ? toCanvasScreenPoint({
          x:
            selectedTextCardPanelItem.x +
            selectedTextCardPanelFrameBounds.left +
            selectedTextCardPanelFrameBounds.width / 2,
          y:
            selectedTextCardPanelItem.y +
            selectedTextCardPanelFrameBounds.top +
            selectedTextCardPanelFrameBounds.height,
        })
    : null;
  const selectedTextCardPanelViewportOrigin = selectedTextCardPanelAnchorPoint && canvasRect
    ? {
        left: canvasRect.left + selectedTextCardPanelAnchorPoint.x - selectedTextCardPanelCanvasWidth / 2,
        top: canvasRect.top + selectedTextCardPanelAnchorPoint.y + 18,
      }
    : null;
  const selectedImageCardPanelVisualBounds = selectedImageCardPanelItem
    ? getItemVisualBounds(selectedImageCardPanelItem)
    : null;
  const selectedImageCardPanelOverlayAnchors = selectedImageCardPanelVisualBounds && canvasRect
    ? resolveCanvasFixedOverlayAnchors({
        bounds: selectedImageCardPanelVisualBounds,
        viewport,
        canvasOrigin: { x: canvasRect.left, y: canvasRect.top },
        gap: IMAGE_NODE_OVERLAY_GAP_PX,
      })
    : null;
  const selectedImageCardPanelViewportOrigin = selectedImageCardPanelOverlayAnchors
    ? {
        left: selectedImageCardPanelOverlayAnchors.centerX - selectedImageCardPanelCanvasWidth / 2,
        top: selectedImageCardPanelOverlayAnchors.bottomPanelY,
      }
    : null;
  const portaledSelectedImageCardPanel =
    typeof document !== 'undefined' &&
    selectedImageCardPanelItem &&
    selectedImageCardPanelFrameBounds &&
    selectedImageCardPanelCanvasRect &&
    selectedImageCardPanelViewportOrigin
      ? createPortal(
          <div
            ref={registerSelectedImagePanelOverlay}
            data-canvas-overlay-root="true"
            data-canvas-item-overlay-group="selected-image-panel"
            data-canvas-overlay-item-id={selectedImageCardPanelItem.id}
            className="pointer-events-none fixed left-0 top-0 z-[115]"
            style={{
              width: selectedImageCardPanelCanvasRect.width,
              height: selectedImageCardPanelCanvasRect.height,
              transform: `translate3d(${selectedImageCardPanelViewportOrigin.left}px, ${selectedImageCardPanelViewportOrigin.top}px, 0)`,
            }}
          >
              <div
              data-text-card-panel="true"
              data-canvas-viewport-overlay="true"
              data-canvas-overlay-item-id={selectedImageCardPanelItem.id}
              ref={setSelectedImageCardPanelRoot}
              className="workspace-panel-surface pointer-events-auto absolute left-0 top-0 overflow-hidden rounded-[26px]"
              style={{
                width: selectedImageCardPanelCanvasRect.width,
              }}
              onPointerDown={(e) => {
                e.stopPropagation();
              }}
            >
              <div className="px-5 py-3">
                {selectedImageCardPanelLinkedImagePreviews.length > 0 && (
                  <div className="workspace-panel-input mb-3 rounded-[18px] p-2.5">
                    <div
                      className="panel-scrollbar flex gap-2 overflow-x-auto pb-1"
                      onWheel={stopCanvasWheelFromScrollableRegion}
                    >
                      {selectedImageCardPanelLinkedImagePreviews.map((preview) => (
                        <div
                          key={preview.id}
                          data-panel-reference-id={preview.id}
                          draggable
                          onDragStart={(e) => {
                            onPanelReferenceDragStart(e, selectedImageCardPanelItem.id, preview.id);
                          }}
                          onDragOver={(e) => {
                            onPanelReferenceDragOver(e, selectedImageCardPanelItem.id, preview.id);
                          }}
                          onDrop={(e) => {
                            onPanelReferenceDrop(e, selectedImageCardPanelItem.id, preview.id);
                          }}
                          onDragEnd={onPanelReferenceDragEnd}
                          className={`relative h-20 w-20 shrink-0 overflow-hidden rounded-[14px] border bg-black/25 ${
                            draggingPanelReference?.targetItemId === selectedImageCardPanelItem.id &&
                            draggingPanelReference.sourceItemId === preview.id
                              ? 'border-white/[0.08] opacity-50'
                              : dragOverPanelReference?.targetItemId === selectedImageCardPanelItem.id &&
                                  dragOverPanelReference.sourceItemId === preview.id
                                ? 'border-white/30 ring-1 ring-zinc-100'
                                : 'border-white/[0.08]'
                          } cursor-move`}
                        >
                          <Image
                            src={preview.src}
                            alt={preview.alt || preview.label}
                            fill
                            unoptimized
                            sizes="80px"
                            className="object-cover"
                            draggable={false}
                          />
                          <span className="pointer-events-none absolute left-1.5 top-1.5 rounded-full bg-black/70 px-2 py-0.5 text-[10px] font-medium tracking-[0.01em] text-zinc-100">
                            {preview.label}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                <div
                  data-text-card-panel-input-shell="true"
                  className="workspace-panel-input rounded-[20px] px-4 py-3"
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    if (!shouldFocusTextCardPanelInputOnPointerDown(e.target as HTMLElement | null)) {
                      return;
                    }

                    e.preventDefault();
                    focusSelectedImageCardPanelInput();
                  }}
                >
                  <textarea
                    data-text-card-panel-input="true"
                    ref={selectedImageCardPanelTextareaRef}
                    value={selectedImageCardPanelDisplayInput}
                    onChange={(e) => {
                      onSelectedImageCardPanelInputChange(e.target.value);
                    }}
                    onBlur={() => {
                      onSelectedImageCardPanelBlur();
                    }}
                    onKeyDown={(e) => {
                      if (
                        shouldSubmitTextCardPanelEnter({
                          key: e.key,
                          shiftKey: e.shiftKey,
                          altKey: e.altKey,
                          isComposing: e.nativeEvent.isComposing,
                        })
                      ) {
                        e.preventDefault();
                        if (isSelectedImageCardGenerating) {
                          onSelectedImageCardPanelCancel();
                        } else {
                          onSelectedImageCardPanelSubmit();
                        }
                      }
                    }}
                    onPointerDown={(e) => {
                      e.stopPropagation();
                    }}
                    onPaste={(e) => {
                      e.stopPropagation();
                    }}
                    onWheel={stopCanvasWheelFromScrollableRegion}
                    autoFocus={false}
                    readOnly={false}
                    disabled={false}
                    spellCheck={false}
                    className="panel-scrollbar workspace-text-primary w-full resize-none bg-transparent text-[14px] leading-6 caret-[var(--workspace-text-primary)] outline-none placeholder:text-[var(--workspace-text-soft)] [user-select:text] [-webkit-user-select:text] cursor-text"
                    placeholder={IMAGE_CARD_PANEL_PROMPT_PLACEHOLDER}
                    rows={TEXT_CARD_PANEL_INPUT_MIN_ROWS}
                    style={{
                      height: `${selectedImageCardPanelInputMetrics.height}px`,
                      overflowY: selectedImageCardPanelInputMetrics.isOverflowing ? 'auto' : 'hidden',
                    }}
                  />
                </div>
                {selectedImageCardPanelError && (
                  <div className="mt-2 px-0.5 text-[12px] leading-5 text-rose-400">
                    {selectedImageCardPanelError}
                  </div>
                )}
              </div>
              <div
                data-text-card-panel-control="true"
                className="workspace-panel-footer flex items-end justify-between gap-4 px-5 py-3"
              >
                <div className="grid min-w-0 flex-1 grid-cols-[minmax(0,1.1fr)_minmax(0,1.2fr)_minmax(0,1.6fr)_minmax(0,1fr)] gap-2">
                  <div className="relative" ref={imageCardProviderMenuRef}>
                    <button
                      data-text-card-panel-control="true"
                      type="button"
                      onPointerDown={(e) => {
                        e.stopPropagation();
                      }}
                      onClick={() => {
                        onToggleImageCardProviderMenu();
                      }}
                      disabled={selectableImageProviders.length === 0}
                      className={`workspace-control-chip flex min-h-[52px] w-full items-center justify-between gap-3 rounded-[14px] px-3 py-2 text-left ${showImageCardProviderMenu ? 'is-active' : ''}`}
                      aria-haspopup="menu"
                      aria-expanded={showImageCardProviderMenu}
                    >
                      <span className="min-w-0 truncate text-[13px] font-semibold tracking-[-0.02em]">
                        {selectedImageCardProviderLabel}
                      </span>
                      <ChevronDown size={14} className="shrink-0" />
                    </button>
                  </div>
                  <div className="relative" ref={imageCardModelMenuRef}>
                    <button
                      data-text-card-panel-control="true"
                      type="button"
                      onPointerDown={(e) => {
                        e.stopPropagation();
                      }}
                      onClick={() => {
                        onToggleImageCardModelMenu();
                      }}
                      className={`workspace-control-chip flex min-h-[52px] w-full items-center justify-between gap-3 rounded-[14px] px-3 py-2 text-left ${showImageCardModelMenu ? 'is-active' : ''}`}
                      aria-haspopup="menu"
                      aria-expanded={showImageCardModelMenu}
                    >
                      <span className="min-w-0 flex items-center gap-2 text-[13px] font-semibold tracking-[-0.02em]">
                        <Sparkles size={14} className="shrink-0" />
                        <span className="truncate">{selectedImageCardModel.label}</span>
                      </span>
                      <ChevronDown size={14} className="shrink-0" />
                    </button>
                  </div>
                  <div className="relative" ref={imageCardSettingsMenuRef}>
                    <button
                      data-text-card-panel-control="true"
                      type="button"
                      onPointerDown={(e) => {
                        e.stopPropagation();
                      }}
                      onClick={() => {
                        onToggleImageCardSettingsMenu();
                      }}
                      className={`workspace-control-chip flex min-h-[52px] w-full items-center justify-between gap-3 rounded-[14px] px-3 py-2 text-left ${showImageCardSettingsMenu ? 'is-active' : ''}`}
                      aria-haspopup="menu"
                      aria-expanded={showImageCardSettingsMenu}
                    >
                      <span className="min-w-0 truncate text-[13px] font-semibold tracking-[-0.02em]">
                        {`${getImageCardAspectRatioShortLabel(selectedImageCardPanelAspectRatio)} · ${selectedImageCardSizeOptions.find((item) => item.id === selectedImageCardPanelSize)?.label || selectedImageCardPanelSize} · ${getImageCardQualityLabel(selectedImageCardPanelQuality)}`}
                      </span>
                      <ChevronDown size={14} className="shrink-0" />
                    </button>
                  </div>
                  <div className="workspace-control-chip flex min-h-[52px] w-full items-center rounded-[14px] px-2 py-2">
                    <button
                      data-text-card-panel-control="true"
                      type="button"
                      onPointerDown={(e) => {
                        e.stopPropagation();
                      }}
                      onClick={() => {
                        onSelectImageCardCount(clampImageCardCount(selectedImageCardPanelCount - 1));
                      }}
                      disabled={selectedImageCardPanelCount <= IMAGE_CARD_COUNT_MIN}
                      className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px]  disabled:cursor-not-allowed disabled:opacity-40"
                      aria-label="减少张数"
                    >
                      <ChevronLeft size={16} />
                    </button>
                    <input
                      data-text-card-panel-control="true"
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      value={selectedImageCardCountInput}
                      onPointerDown={(e) => {
                        e.stopPropagation();
                      }}
                      onChange={(e) => {
                        const digitsOnly = e.target.value.replace(/\D+/g, '');
                        setSelectedImageCardCountInput(digitsOnly);
                      }}
                      onBlur={() => {
                        commitSelectedImageCardCountInput();
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          commitSelectedImageCardCountInput();
                        }
                      }}
                      className="min-w-0 flex-1 bg-transparent px-2 text-center text-[13px] font-semibold tracking-[-0.02em] outline-none"
                      aria-label="张数"
                    />
                    <button
                      data-text-card-panel-control="true"
                      type="button"
                      onPointerDown={(e) => {
                        e.stopPropagation();
                      }}
                      onClick={() => {
                        onSelectImageCardCount(clampImageCardCount(selectedImageCardPanelCount + 1));
                      }}
                      disabled={selectedImageCardPanelCount >= IMAGE_CARD_COUNT_MAX}
                      className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px]  disabled:cursor-not-allowed disabled:opacity-40"
                      aria-label="增加张数"
                    >
                      <ChevronRight size={16} />
                    </button>
                  </div>
                </div>
                <div className="flex items-center gap-2.5">
                  <button
                    data-text-card-panel-control="true"
                    type="button"
                    onPointerDown={(e) => {
                      e.stopPropagation();
                    }}
                    onClick={() => {
                      if (isSelectedImageCardGenerating) {
                        onSelectedImageCardPanelCancel();
                      } else {
                        onSelectedImageCardPanelSubmit();
                      }
                    }}
                    disabled={!isSelectedImageCardGenerating && !selectedImageCardPanelCanSubmit}
                    className="workspace-add-button inline-flex h-11 w-11 items-center justify-center rounded-full  disabled:cursor-not-allowed disabled:opacity-50"
                    aria-label={isSelectedImageCardGenerating ? '终止生成' : '开始生图'}
                    title={isSelectedImageCardGenerating ? '终止生成' : '开始生图'}
                  >
                    {isSelectedImageCardGenerating ? (
                      <svg className="animate-spin" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <circle cx="12" cy="12" r="9" opacity="0.25" />
                        <path d="M21 12a9 9 0 0 1-9 9" />
                      </svg>
                    ) : (
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M12 18V6" />
                        <path d="m7 11 5-5 5 5" />
                      </svg>
                    )}
                  </button>
                </div>
              </div>
            </div>
            {showImageCardModelMenu && (
              <div
                ref={imageCardModelPopoverRef}
                data-text-card-panel-control="true"
                className="workspace-menu-panel pointer-events-auto absolute z-[116] min-w-[248px] overflow-hidden rounded-[18px] p-1.5"
                style={{
                  left: 'var(--canvas-image-model-menu-left)',
                  top: 'var(--canvas-image-model-menu-top)',
                }}
                onPointerDown={(e) => {
                  e.stopPropagation();
                }}
              >
                {imageCardModelOptions.map((option) => {
                  const isSelected = option.id === selectedImageCardModel.id;
                  return (
                    <button
                      key={option.id}
                      type="button"
                      onClick={() => {
                        onSelectImageCardModel(option.id);
                      }}
                      className={`workspace-menu-item flex w-full items-center justify-between rounded-[14px] border border-transparent px-3 py-2.5 text-left ${isSelected ? 'is-selected' : ''}`}
                    >
                      <div className="min-w-0">
                        <div className="truncate text-[13px] font-semibold tracking-[-0.02em]">{option.label}</div>
                        <div className="workspace-text-muted truncate text-[11px]">{option.id}</div>
                      </div>
                      {isSelected && <Check size={15} className="ml-3 shrink-0" />}
                    </button>
                  );
                })}
              </div>
            )}
            {showImageCardProviderMenu && (
              <div
                ref={imageCardProviderPopoverRef}
                data-text-card-panel-control="true"
                className="workspace-menu-panel pointer-events-auto absolute z-[116] min-w-[220px] overflow-hidden rounded-[18px] p-1.5"
                style={{
                  left: 'var(--canvas-image-provider-menu-left)',
                  top: 'var(--canvas-image-provider-menu-top)',
                }}
                onPointerDown={(e) => {
                  e.stopPropagation();
                }}
              >
                {selectableImageProviders.map((provider) => {
                  const isSelected = provider.id === selectedImageCardProviderId;
                  return (
                    <button
                      key={provider.id}
                      type="button"
                      onClick={() => {
                        onSelectImageCardProvider(provider.id);
                      }}
                      className={`workspace-menu-item flex w-full items-center justify-between rounded-[14px] border border-transparent px-3 py-2.5 text-left ${isSelected ? 'is-selected' : ''}`}
                    >
                      <div className="min-w-0">
                        <div className="truncate text-[13px] font-semibold tracking-[-0.02em]">
                          {provider.name || getProviderSettingsProviderLabel(provider.id)}
                        </div>
                        <div className="workspace-text-muted truncate text-[11px]">{provider.id}</div>
                      </div>
                      {isSelected && <Check size={15} className="ml-3 shrink-0" />}
                    </button>
                  );
                })}
              </div>
            )}
            {showImageCardSettingsMenu && (
              <div
                ref={imageCardSettingsPopoverRef}
                data-text-card-panel-control="true"
                className="workspace-menu-panel pointer-events-auto absolute z-[116] overflow-hidden rounded-[22px] p-3"
                style={{
                  left: 'var(--canvas-image-settings-menu-left)',
                  top: 'var(--canvas-image-settings-menu-top)',
                  width: 292,
                }}
                onPointerDown={(e) => {
                  e.stopPropagation();
                }}
              >
                <div className="flex flex-col gap-3">
                  <div className="workspace-panel-input rounded-[18px] p-3">
                    <div className="mb-2.5 text-[11px] font-medium tracking-[0.04em] text-zinc-500">比例</div>
                    <div className="grid grid-cols-4 gap-1.5">
                      {selectedImageCardAspectRatioOptions.map((aspectRatioId) => {
                        const option = ASPECT_RATIOS.find((item) => item.id === aspectRatioId);
                        if (!option) return null;
                        const isSelected = option.id === selectedImageCardPanelAspectRatio;
                        const isEnabled = selectedImageCardEnabledAspectRatios.includes(option.id);
                        const previewSize = getImageCardAspectRatioPreviewSize(option.id);
                        return (
                          <button
                            key={option.id}
                            type="button"
                            disabled={!isEnabled}
                            onClick={() => {
                              if (!isEnabled) return;
                              onSelectImageCardAspectRatio(option.id);
                            }}
                            className={`workspace-control-chip flex min-h-[58px] flex-col items-center justify-center gap-1.5 rounded-[14px] px-1.5 py-2 text-center disabled:cursor-not-allowed disabled:opacity-40 ${isSelected ? 'is-active' : ''}`}
                          >
                            <span className="workspace-panel-input flex h-7 w-7 items-center justify-center rounded-[10px]">
                              <span
                                className={`rounded-[6px] border ${
                                  isSelected ? 'border-[var(--workspace-text-primary)] bg-[var(--workspace-control-active)]' : 'border-[var(--workspace-text-muted)] bg-[var(--workspace-surface-soft)]'
                                }`}
                                style={{
                                  width: `${previewSize.width}px`,
                                  height: `${previewSize.height}px`,
                                }}
                              />
                            </span>
                            <span className="text-[11px] font-semibold tracking-[-0.02em]">
                              {option.id}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  <div className="workspace-panel-input rounded-[18px] p-3">
                    <div className="mb-2.5 text-[11px] font-medium tracking-[0.04em] text-zinc-500">清晰度</div>
                    <div className="workspace-panel-input inline-flex w-full items-center rounded-[14px] p-1">
                      {selectedImageCardSizeOptions.map((option) => {
                        const isSelected = option.id === selectedImageCardPanelSize;
                        return (
                          <button
                            key={option.id}
                            type="button"
                            onClick={() => {
                              onSelectImageCardSize(option.id);
                            }}
                            className={`workspace-control-chip flex-1 rounded-[11px] px-2.5 py-1.5 text-[12px] font-semibold tracking-[-0.02em] ${isSelected ? 'is-active' : ''}`}
                          >
                            {option.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  <div className="workspace-panel-input rounded-[18px] p-3">
                    <div className="mb-2.5 text-[11px] font-medium tracking-[0.04em] text-zinc-500">质量</div>
                    <div className="workspace-panel-input inline-flex w-full items-center rounded-[14px] p-1">
                      {selectedImageCardQualityOptions.map((option) => {
                        const isSelected = option.id === selectedImageCardPanelQuality;
                        return (
                          <button
                            key={option.id}
                            type="button"
                            onClick={() => {
                              onSelectImageCardQuality(option.id);
                            }}
                            className={`workspace-control-chip flex-1 rounded-[11px] px-2.5 py-1.5 text-[12px] font-semibold tracking-[-0.02em] ${isSelected ? 'is-active' : ''}`}
                          >
                            {option.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>,
          document.body
        )
      : null;
  const portaledSelectedTextCardPanel =
    typeof document !== 'undefined' &&
    selectedTextCardPanelItem &&
    selectedTextCardPanelFrameBounds &&
    selectedTextCardPanelCanvasRect &&
    selectedTextCardPanelViewportOrigin
      ? createPortal(
          <div
            ref={registerSelectedTextPanelOverlay}
            data-canvas-overlay-root="true"
            data-canvas-item-overlay-group="selected-text-panel"
            data-canvas-overlay-item-id={selectedTextCardPanelItem.id}
            className="pointer-events-none fixed left-0 top-0 z-[115]"
            style={{
              width: selectedTextCardPanelCanvasRect.width,
              height: selectedTextCardPanelCanvasRect.height,
              transform: `translate3d(${selectedTextCardPanelViewportOrigin.left}px, ${selectedTextCardPanelViewportOrigin.top}px, 0)`,
            }}
          >
            <div
              data-text-card-panel="true"
              data-canvas-viewport-overlay="true"
              ref={setSelectedTextCardPanelRoot}
              className="workspace-panel-surface pointer-events-auto absolute left-0 top-0 overflow-hidden rounded-[26px]"
              style={{
                width: selectedTextCardPanelCanvasRect.width,
              }}
              onPointerDown={(e) => {
                e.stopPropagation();
              }}
            >
              <div className="px-5 py-3">
                {linkedImagePreviews.length > 0 && (
                  <div className="workspace-panel-input mb-3 rounded-[18px] p-2.5">
                    <div
                      className="panel-scrollbar flex gap-2 overflow-x-auto pb-1"
                      onWheel={stopCanvasWheelFromScrollableRegion}
                    >
                      {linkedImagePreviews.map((preview) => (
                        <div
                          key={preview.id}
                          data-panel-reference-id={preview.id}
                          draggable
                          onDragStart={(e) => {
                            onPanelReferenceDragStart(e, selectedTextCardPanelItem.id, preview.id);
                          }}
                          onDragOver={(e) => {
                            onPanelReferenceDragOver(e, selectedTextCardPanelItem.id, preview.id);
                          }}
                          onDrop={(e) => {
                            onPanelReferenceDrop(e, selectedTextCardPanelItem.id, preview.id);
                          }}
                          onDragEnd={onPanelReferenceDragEnd}
                          className={`relative h-20 w-20 shrink-0 overflow-hidden rounded-[14px] border bg-black/25 ${
                            draggingPanelReference?.targetItemId === selectedTextCardPanelItem.id &&
                            draggingPanelReference.sourceItemId === preview.id
                              ? 'border-white/[0.08] opacity-50'
                              : dragOverPanelReference?.targetItemId === selectedTextCardPanelItem.id &&
                                  dragOverPanelReference.sourceItemId === preview.id
                                ? 'border-white/30 ring-1 ring-zinc-100'
                                : 'border-white/[0.08]'
                          } cursor-move`}
                        >
                          <Image
                            src={preview.src}
                            alt={preview.alt || preview.label}
                            fill
                            unoptimized
                            sizes="80px"
                            className="object-cover"
                            draggable={false}
                          />
                          <span className="pointer-events-none absolute left-1.5 top-1.5 rounded-full bg-black/70 px-2 py-0.5 text-[10px] font-medium tracking-[0.01em] text-zinc-100">
                            {preview.label}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                <div
                  data-text-card-panel-input-shell="true"
                  className="workspace-panel-input rounded-[20px] px-4 py-3"
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    if (!shouldFocusTextCardPanelInputOnPointerDown(e.target as HTMLElement | null)) {
                      return;
                    }

                    e.preventDefault();
                    focusSelectedTextCardPanelInput();
                  }}
                >
                  <textarea
                    data-text-card-panel-input="true"
                    ref={selectedTextCardPanelTextareaRef}
                    value={selectedTextCardPanelDisplayInput}
                    onChange={(e) => {
                      onSelectedTextCardPanelInputChange(e.target.value);
                    }}
                    onBlur={() => {
                      onSelectedTextCardPanelBlur();
                    }}
                    onKeyDown={(e) => {
                      if (
                        shouldSubmitTextCardPanelEnter({
                          key: e.key,
                          shiftKey: e.shiftKey,
                          altKey: e.altKey,
                          isComposing: e.nativeEvent.isComposing,
                        })
                      ) {
                        e.preventDefault();
                        if (isSelectedTextCardGenerating) {
                          onSelectedTextCardPanelCancel();
                        } else {
                          onSelectedTextCardPanelSubmit();
                        }
                      }
                    }}
                    onPointerDown={(e) => {
                      e.stopPropagation();
                    }}
                    onPaste={(e) => {
                      e.stopPropagation();
                    }}
                    onWheel={stopCanvasWheelFromScrollableRegion}
                    autoFocus={false}
                    readOnly={false}
                    disabled={false}
                    spellCheck={false}
                    className="panel-scrollbar workspace-text-primary w-full resize-none bg-transparent text-[14px] leading-6 caret-[var(--workspace-text-primary)] outline-none placeholder:text-[var(--workspace-text-soft)] [user-select:text] [-webkit-user-select:text] cursor-text"
                    placeholder={selectedTextCardPanelPlaceholder}
                    rows={TEXT_CARD_PANEL_INPUT_MIN_ROWS}
                    style={{
                      height: `${selectedTextCardPanelInputMetrics.height}px`,
                      overflowY: selectedTextCardPanelInputMetrics.isOverflowing ? 'auto' : 'hidden',
                    }}
                  />
                </div>
                {selectedTextCardPanelError && (
                  <div className="mt-2 px-0.5 text-[12px] leading-5 text-rose-400">
                    {selectedTextCardPanelError}
                  </div>
                )}
              </div>
              <div
                data-text-card-panel-control="true"
                className="workspace-panel-footer flex items-end justify-between gap-4 px-5 py-3"
              >
                <div className="grid min-w-0 flex-1 grid-cols-[minmax(0,1.1fr)_minmax(0,1.2fr)] gap-2">
                  <div className="relative" ref={textPanelProviderMenuRef}>
                    <button
                      data-text-card-panel-control="true"
                      type="button"
                      onPointerDown={(e) => {
                        e.stopPropagation();
                      }}
                      onClick={() => {
                        onToggleTextPanelProviderMenu();
                      }}
                      disabled={selectableTextProviders.length === 0}
                      className={`workspace-control-chip flex min-h-[52px] w-full items-center justify-between gap-3 rounded-[14px] px-3 py-2 text-left ${showTextPanelProviderMenu ? 'is-active' : ''}`}
                      aria-haspopup="menu"
                      aria-expanded={showTextPanelProviderMenu}
                    >
                      <span className="min-w-0 truncate text-[13px] font-semibold tracking-[-0.02em]">
                        {selectedTextCardProviderLabel}
                      </span>
                      <ChevronDown size={14} className="shrink-0" />
                    </button>
                  </div>
                  <div className="relative" ref={textPanelModelMenuRef}>
                    <button
                      data-text-card-panel-control="true"
                      type="button"
                      onPointerDown={(e) => {
                        e.stopPropagation();
                      }}
                      onClick={() => {
                        onToggleTextPanelModelMenu();
                      }}
                      disabled={textPanelModelOptions.length === 0}
                      className={`workspace-control-chip flex min-h-[52px] w-full items-center justify-between gap-3 rounded-[14px] px-3 py-2 text-left ${showTextPanelModelMenu ? 'is-active' : ''}`}
                      aria-haspopup="menu"
                      aria-expanded={showTextPanelModelMenu}
                    >
                      <span className="min-w-0 flex items-center gap-2 text-[13px] font-semibold tracking-[-0.02em]">
                        <Sparkles size={14} className="shrink-0" />
                        <span className="truncate">{selectedTextPanelModel.label}</span>
                      </span>
                      <ChevronDown size={14} className="shrink-0" />
                    </button>
                  </div>
                </div>
                <div className="flex items-center gap-2.5">
                  <button
                    data-text-card-panel-control="true"
                    type="button"
                    onPointerDown={(e) => {
                      e.stopPropagation();
                    }}
                    onClick={() => {
                      if (isSelectedTextCardGenerating) {
                        onSelectedTextCardPanelCancel();
                      } else {
                        onSelectedTextCardPanelSubmit();
                      }
                    }}
                    disabled={!isSelectedTextCardGenerating && !selectedTextCardPanelCanSubmit}
                    className="workspace-add-button inline-flex h-11 w-11 items-center justify-center rounded-full  disabled:cursor-not-allowed disabled:opacity-50"
                    aria-label={isSelectedTextCardGenerating ? '终止生成' : '开始生成'}
                    title={isSelectedTextCardGenerating ? '终止生成' : '开始生成'}
                  >
                    {isSelectedTextCardGenerating ? (
                      <svg className="animate-spin" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <circle cx="12" cy="12" r="9" opacity="0.25" />
                        <path d="M21 12a9 9 0 0 1-9 9" />
                      </svg>
                    ) : (
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M12 18V6" />
                        <path d="m7 11 5-5 5 5" />
                      </svg>
                    )}
                  </button>
                </div>
              </div>
            </div>
            {showTextPanelProviderMenu && (
              <div
                ref={textPanelProviderPopoverRef}
                data-text-card-panel-control="true"
                className="workspace-menu-panel pointer-events-auto absolute z-[116] min-w-[220px] overflow-hidden rounded-[18px] p-1.5"
                style={{
                  left: 'var(--canvas-text-provider-menu-left)',
                  top: 'var(--canvas-text-provider-menu-top)',
                }}
                onPointerDown={(e) => {
                  e.stopPropagation();
                }}
              >
                {selectableTextProviders.map((provider) => {
                  const isSelected = provider.id === selectedTextCardProviderId;
                  return (
                    <button
                      key={provider.id}
                      type="button"
                      onClick={() => {
                        onSelectTextPanelProvider(provider.id);
                      }}
                      className={`workspace-menu-item flex w-full items-center justify-between rounded-[14px] border border-transparent px-3 py-2.5 text-left ${isSelected ? 'is-selected' : ''}`}
                    >
                      <div className="min-w-0">
                        <div className="truncate text-[13px] font-semibold tracking-[-0.02em]">
                          {provider.name || getProviderSettingsProviderLabel(provider.id)}
                        </div>
                        <div className="workspace-text-muted truncate text-[11px]">{provider.id}</div>
                      </div>
                      {isSelected && <Check size={15} className="ml-3 shrink-0" />}
                    </button>
                  );
                })}
              </div>
            )}
            {showTextPanelModelMenu && (
              <div
                ref={textPanelModelPopoverRef}
                data-text-card-panel-control="true"
                className="workspace-menu-panel pointer-events-auto absolute z-[116] min-w-[248px] overflow-hidden rounded-[18px] p-1.5"
                style={{
                  left: 'var(--canvas-text-model-menu-left)',
                  top: 'var(--canvas-text-model-menu-top)',
                }}
                onPointerDown={(e) => {
                  e.stopPropagation();
                }}
              >
                {textPanelModelOptions.map((option) => {
                  const isSelected = option.id === selectedTextPanelModel.id;
                  return (
                    <button
                      key={option.id}
                      type="button"
                      onClick={() => {
                        onSelectTextPanelModel(option.id);
                      }}
                      className={`workspace-menu-item flex w-full items-center justify-between rounded-[14px] border border-transparent px-3 py-2.5 text-left ${isSelected ? 'is-selected' : ''}`}
                    >
                      <div className="min-w-0">
                        <div className="truncate text-[13px] font-semibold tracking-[-0.02em]">{option.label}</div>
                        <div className="workspace-text-muted truncate text-[11px]">{option.id}</div>
                      </div>
                      {isSelected && <Check size={15} className="ml-3 shrink-0" />}
                    </button>
                  );
                })}
              </div>
            )}
          </div>,
          document.body
        )
      : null;

  return (
    <div
      ref={canvasRef}
      data-canvas="true"
      tabIndex={0}
      className={`relative z-0 shrink-0 overflow-hidden select-none ${
        isSpacePressed
          ? 'cursor-grab'
          : tool === 'draw'
            ? 'cursor-crosshair'
            : tool === 'target'
              ? 'cursor-crosshair'
            : tool === 'annotation-text'
              ? 'cursor-text'
              : tool === 'select'
                ? 'cursor-grab'
                : 'cursor-default'
      }`}
      style={{ width: widthStyle }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onPointerLeave={onPointerLeave}
      onContextMenu={(event) => {
        if (tool !== 'select' || !event.ctrlKey) return;
        const target = event.target as HTMLElement;
        if (target.closest(
          'input, textarea, select, [contenteditable="true"], [data-port], [data-text-card-panel], button:not([data-corner-resize="true"])'
        )) return;
        event.preventDefault();
      }}
      onPaste={onPaste}
    >
      <CanvasBackgroundLayer theme={themePalette} />
      <div
        ref={canvasSceneRef}
        data-canvas-world="true"
        data-canvas-scene="true"
        className="pointer-events-none absolute inset-0"
        style={{ transformOrigin: '0 0' }}
      >
        <CanvasConnectionsLayer
          connections={connections}
          theme={themePalette}
          itemById={itemById}
          selectedConnectionIds={selectedConnectionIds}
          onConnectionPointerDown={onConnectionPointerDown}
          getConnectionAnchorCanvasPoint={getConnectionAnchorCanvasPoint}
          buildConnectionPath={buildConnectionPath}
          getConnectionPathRef={getConnectionPathRef}
        />
        <CanvasPortsLayer
          items={regularItems}
          hoveredCanvasItemId={hoveredCanvasItemId}
          hoveredInputPortItemId={hoveredInputPortItemId}
          hoveredOutputPortItemId={hoveredOutputPortItemId}
          connectionFromItemId={connectionFromItemId}
          onInputPortEnter={onInputPortEnter}
          onInputPortLeave={onInputPortLeave}
          onOutputPortEnter={onOutputPortEnter}
          onOutputPortLeave={onOutputPortLeave}
          onOutputPortPointerDown={onOutputPortPointerDown}
          getItemTargetRef={getItemTargetRef}
        />
        <CanvasNodesLayer
          items={regularItems}
          tool={tool}
          connections={connections}
          multiSelectionBounds={multiSelectionBounds}
          hoveredCanvasItemId={hoveredCanvasItemId}
          activeCanvasTextGenerationItemIds={activeCanvasTextGenerationItemIds}
          activeCanvasImageGenerationItemIds={activeCanvasImageGenerationItemIds}
          activeCanvasTextGenerations={activeCanvasTextGenerations}
          activeCanvasImageGenerations={activeCanvasImageGenerations}
          activeCanvasImageIds={activeCanvasImageIds}
          editingTextCardId={editingTextCardId}
          editingTextCardTextareaRef={editingTextCardTextareaRef}
          onImageCardOutputSelect={onImageCardOutputSelect}
          onSelectionGroupPointerDown={onSelectionGroupPointerDown}
          onItemMouseEnter={onItemMouseEnter}
          onItemMouseLeave={onItemMouseLeave}
          onItemClick={onItemClick}
          onItemDoubleClick={onItemDoubleClick}
          onItemPointerDown={onItemPointerDown}
          onCornerResizePointerDown={onCornerResizePointerDown}
          onManualTextCardInputChange={onManualTextCardInputChange}
          onManualTextCardBlur={onManualTextCardBlur}
          getItemTargetRef={getItemTargetRef}
          selectionGroupRef={getSelectionGroupRef}
        />
        <CanvasAnnotationsLayer
          items={items}
          selectedIds={selectedIds}
          selectedId={selectedId}
          hoveredCanvasItemId={hoveredCanvasItemId}
          editingAnnotationTextId={editingAnnotationTextId}
          editingAnnotationTextRef={editingAnnotationTextRef}
          draftStroke={draftStroke}
          draftStrokePathRef={draftStrokePathRef}
          onItemMouseEnter={onItemMouseEnter}
          onItemMouseLeave={onItemMouseLeave}
          onItemClick={onItemClick}
          onItemDoubleClick={onItemDoubleClick}
          onItemPointerDown={onItemPointerDown}
          onAnnotationTextChange={onAnnotationTextChange}
          onAnnotationTextBlur={onAnnotationTextBlur}
          getItemTargetRef={getItemTargetRef}
        />
        <CanvasRegionSelectionsLayer
          items={items}
          regions={regionSelections}
          activeRegionId={activeRegionId}
          getImageContent={getRegionImageContent}
          onRegionClick={onRegionClick}
          getItemTargetRef={getItemTargetRef}
        />
      </div>
      <div data-canvas-screen-overlay="true" className="pointer-events-none absolute inset-0">
        <CanvasConnectionPreviewLayer
          canvasSize={canvasSize}
          theme={themePalette}
          connectionMode={connectionMode}
          connectionPreviewPathRef={connectionPreviewPathRef}
          frozenPreviewConnection={frozenPreviewConnection}
          buildConnectionPath={buildConnectionPath}
        />
        {pendingConnectionMenu && (
          <div className="pointer-events-none absolute inset-0 z-[110]">
            <div
              data-connection-create-menu="true"
              className="workspace-menu-panel pointer-events-auto absolute overflow-hidden rounded-[26px]"
              style={{
                left: pendingMenuLeft,
                top: pendingMenuTop,
                width: 320,
                minHeight: 198,
                transform: `scale(${viewport.scale})`,
                transformOrigin: 'top left',
              }}
              onPointerDown={onPendingMenuPointerDown}
            >
              <div className="p-3.5">
                <div className="mb-2.5 px-1 text-xs font-medium tracking-[-0.01em] text-zinc-500/80">
                  引用该节点生成
                </div>
                <div className="space-y-1.5">
                  {CONNECTION_MENU_OPTIONS.map((option) => (
                    <CanvasActionMenuItem
                      key={option.id}
                      title={option.title}
                      description={option.description}
                      Icon={option.icon}
                      onClick={() => onPendingMenuAction(option.id)}
                    />
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}
        <svg
          ref={marqueeElementRef}
          aria-hidden="true"
          width="100%"
          height="100%"
          className="pointer-events-none invisible absolute inset-0 z-[100] overflow-hidden opacity-0"
        >
          <path
            ref={marqueePathRef}
            d=""
            vectorEffect="non-scaling-stroke"
            fill={themePalette.marqueeFill}
            stroke={themePalette.marqueeStroke}
            strokeWidth="1.25"
            strokeDasharray="6 4"
            shapeRendering="geometricPrecision"
          />
        </svg>
      </div>
      {portaledSelectedTextCardPanel}
      {portaledSelectedImageCardPanel}
    </div>
  );
});

const MarkdownMessage = memo(function MarkdownMessage({
  content,
  onPointerDown,
  onMouseDown,
  onClick,
}: {
  content: string;
  onPointerDown?: React.PointerEventHandler<HTMLElement>;
  onMouseDown?: React.MouseEventHandler<HTMLElement>;
  onClick?: React.MouseEventHandler<HTMLElement>;
}) {
  const [copiedCodeBlockId, setCopiedCodeBlockId] = useState<string | null>(null);
  const copiedCodeBlockTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleCopyCodeBlock = useCallback(async (blockId: string, text: string) => {
    const textToCopy = text.trim();
    if (!textToCopy) return;

    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(textToCopy);
      } else {
        const textarea = document.createElement('textarea');
        textarea.value = textToCopy;
        textarea.setAttribute('readonly', 'true');
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
      }

      setCopiedCodeBlockId(blockId);
      if (copiedCodeBlockTimeoutRef.current) {
        clearTimeout(copiedCodeBlockTimeoutRef.current);
      }
      copiedCodeBlockTimeoutRef.current = setTimeout(() => {
        setCopiedCodeBlockId((prev) => (prev === blockId ? null : prev));
      }, 1400);
    } catch (error) {
      console.error('Copy code block failed:', error);
    }
  }, []);

  useEffect(() => {
    return () => {
      if (copiedCodeBlockTimeoutRef.current) {
        clearTimeout(copiedCodeBlockTimeoutRef.current);
      }
    };
  }, []);

  const selectableStyle: React.CSSProperties = {
    userSelect: 'text',
    WebkitUserSelect: 'text',
  };

  const getSelectableProps = <T extends HTMLElement>(
    className: string,
    extraProps: React.HTMLAttributes<T> = {}
  ): React.HTMLAttributes<T> & { 'data-assistant-selectable': 'true' } => ({
    ...extraProps,
    'data-assistant-selectable': 'true',
    className: `assistant-selectable-node pointer-events-auto ${className}`.trim(),
    style: {
      ...selectableStyle,
      ...(extraProps.style || {}),
    },
    onPointerDown: onPointerDown as React.PointerEventHandler<T> | undefined,
    onMouseDown: onMouseDown as React.MouseEventHandler<T> | undefined,
    onClick: onClick as React.MouseEventHandler<T> | undefined,
  });

  return (
    <div
      data-assistant-selectable="true"
      className="assistant-selectable relative z-[1] pointer-events-auto"
      onPointerDown={onPointerDown}
      onMouseDown={onMouseDown}
      onClick={onClick}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children }) => <h1 {...getSelectableProps<HTMLHeadingElement>('mb-3 mt-7 text-[1.55rem] font-semibold leading-[1.22] tracking-[-0.03em] text-zinc-50 first:mt-0')}>{children}</h1>,
          h2: ({ children }) => <h2 {...getSelectableProps<HTMLHeadingElement>('mb-3 mt-7 text-[1.34rem] font-semibold leading-[1.24] tracking-[-0.02em] text-zinc-100 first:mt-0')}>{children}</h2>,
          h3: ({ children }) => <h3 {...getSelectableProps<HTMLHeadingElement>('mb-2.5 mt-6 text-[1.15rem] font-semibold leading-[1.3] text-zinc-100 first:mt-0')}>{children}</h3>,
          h4: ({ children }) => <h4 {...getSelectableProps<HTMLHeadingElement>('mb-2 mt-5 text-[1rem] font-semibold leading-[1.35] text-zinc-200 first:mt-0')}>{children}</h4>,
          p: ({ children }) => <p {...getSelectableProps<HTMLParagraphElement>('mt-5 text-sm leading-[1.72] text-zinc-200 first:mt-0')}>{children}</p>,
          strong: ({ children }) => <strong {...getSelectableProps<HTMLElement>('font-semibold text-zinc-50')}>{children}</strong>,
          em: ({ children }) => <em {...getSelectableProps<HTMLElement>('italic text-zinc-100')}>{children}</em>,
          ul: ({ children }) => <ul {...getSelectableProps<HTMLUListElement>('mt-5 list-disc space-y-1.5 pl-5 text-sm leading-[1.7] text-zinc-200 first:mt-0')}>{children}</ul>,
          ol: ({ children }) => <ol {...getSelectableProps<HTMLOListElement>('mt-5 list-decimal space-y-1.5 pl-5 text-sm leading-[1.7] text-zinc-200 first:mt-0')}>{children}</ol>,
          li: ({ children }) => <li {...getSelectableProps<HTMLLIElement>('pl-1 marker:text-zinc-500')}>{children}</li>,
          blockquote: ({ children }) => <blockquote {...getSelectableProps<HTMLQuoteElement>('workspace-text-muted mt-5 border-l border-[var(--workspace-border)] pl-4 text-sm leading-[1.7] first:mt-0')}>{children}</blockquote>,
          hr: () => <hr className="my-5 border-0 border-t border-[var(--workspace-border)]" />,
          code(props) {
            const { children, node, className, ...rest } = props as React.HTMLAttributes<HTMLElement> & {
              node?: { position?: { start?: { line?: number }; end?: { line?: number } } };
              className?: string;
            };
            const isBlockCode =
              typeof node?.position?.start?.line === 'number' &&
              typeof node?.position?.end?.line === 'number' &&
              node.position.start.line !== node.position.end.line;

            if (!isBlockCode) {
              return (
                <code
                  {...rest}
                  className={undefined}
                  {...getSelectableProps<HTMLElement>('rounded-md border border-[var(--workspace-border)] bg-[var(--workspace-surface-soft)] px-1.5 py-0.5 text-[0.9em] text-[var(--workspace-text-primary)]', rest)}
                >
                  {children}
                </code>
              );
            }

            return (
              <code
                {...rest}
                className={className}
                {...getSelectableProps<HTMLElement>('block overflow-x-auto rounded-[14px] border border-[var(--workspace-border)] bg-[var(--workspace-surface-soft)] px-3 py-1.5 pr-16 text-[13px] leading-[1.5] text-[var(--workspace-text-primary)]', rest)}
              >
                {children}
              </code>
            );
          },
          pre: ({ children }) => {
            const codeText = extractPlainText(children);
            const codeBlockId = `code-${content}-${codeText}`.slice(0, 120);
            const isCopied = copiedCodeBlockId === codeBlockId;

            return (
              <div className="group relative mt-4 first:mt-0" data-gsap-hover-root="true" data-gsap-no-scale="true">
                <button
                  type="button"
                  onPointerDown={(e) => {
                    e.stopPropagation();
                  }}
                  onMouseDown={(e) => {
                    e.stopPropagation();
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    void handleCopyCodeBlock(codeBlockId, codeText);
                  }}
                  className="workspace-control-chip absolute right-3 top-1/2 z-[2] inline-flex h-7 -translate-y-1/2 items-center gap-1 rounded-lg px-2 text-[11px] opacity-70"
                  data-gsap-hover-alpha="0.7,1"
                  aria-label="复制代码块"
                  title="复制代码块"
                >
                  {isCopied ? (
                    <>
                      <Check size={12} />
                      <span>已复制</span>
                    </>
                  ) : (
                    <>
                      <Copy size={12} />
                      <span>复制</span>
                    </>
                  )}
                </button>
                <pre {...getSelectableProps<HTMLPreElement>('overflow-x-auto first:mt-0')}>{children}</pre>
              </div>
            );
          },
          a: ({ children, href }) => (
            <a
              href={href}
              target="_blank"
              rel="noreferrer"
              {...getSelectableProps<HTMLAnchorElement>('text-zinc-100 underline decoration-zinc-500 underline-offset-4 hover:text-white')}
            >
              {children}
            </a>
          ),
          table: ({ children }) => <div {...getSelectableProps<HTMLDivElement>('mt-5 overflow-x-auto first:mt-0')}><table {...getSelectableProps<HTMLTableElement>('min-w-full border-collapse text-left text-[13px] text-zinc-200')}>{children}</table></div>,
          thead: ({ children }) => <thead {...getSelectableProps<HTMLTableSectionElement>('border-b border-[var(--workspace-border)] text-[var(--workspace-text-primary)]')}>{children}</thead>,
          tbody: ({ children }) => <tbody {...getSelectableProps<HTMLTableSectionElement>('')}>{children}</tbody>,
          tr: ({ children }) => <tr {...getSelectableProps<HTMLTableRowElement>('border-b border-[var(--workspace-border)] last:border-b-0')}>{children}</tr>,
          th: ({ children }) => <th {...getSelectableProps<HTMLTableCellElement>('px-3 py-2 font-medium')}>{children}</th>,
          td: ({ children }) => <td {...getSelectableProps<HTMLTableCellElement>('px-3 py-2 text-zinc-300')}>{children}</td>,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
});

const TextCardMarkdown = memo(function TextCardMarkdown({
  content,
}: {
  content: string;
}) {
  return (
    <div className="workspace-text-card-markdown w-full min-w-0 max-w-none break-words text-[15px] leading-7 tracking-[-0.02em] text-zinc-200">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children }) => <h1 className="mb-3 text-[1.2rem] font-semibold leading-[1.25] text-zinc-50 first:mt-0">{children}</h1>,
          h2: ({ children }) => <h2 className="mb-3 mt-5 text-[1.08rem] font-semibold leading-[1.3] text-zinc-100 first:mt-0">{children}</h2>,
          h3: ({ children }) => <h3 className="mb-2 mt-4 text-[1rem] font-semibold leading-[1.35] text-zinc-100 first:mt-0">{children}</h3>,
          p: ({ children }) => <p className="mt-4 break-words first:mt-0">{children}</p>,
          ul: ({ children }) => <ul className="mt-4 list-disc space-y-1.5 pl-5 first:mt-0">{children}</ul>,
          ol: ({ children }) => <ol className="mt-4 list-decimal space-y-1.5 pl-5 first:mt-0">{children}</ol>,
          li: ({ children }) => <li className="break-words pl-1 marker:text-zinc-500">{children}</li>,
          blockquote: ({ children }) => <blockquote className="workspace-text-muted mt-4 break-words border-l border-[var(--workspace-border)] pl-4 first:mt-0">{children}</blockquote>,
          strong: ({ children }) => <strong className="font-semibold text-zinc-50">{children}</strong>,
          em: ({ children }) => <em className="italic text-zinc-100">{children}</em>,
          code(props) {
            const { inline, children, className, ...rest } = props as React.HTMLAttributes<HTMLElement> & {
              inline?: boolean;
              className?: string;
            };

            if (inline) {
              return (
                <code
                  {...rest}
                  className="rounded-md border border-[var(--workspace-border)] bg-[var(--workspace-surface-soft)] px-1.5 py-0.5 text-[0.92em] text-[var(--workspace-text-primary)]"
                >
                  {children}
                </code>
              );
            }

            return (
              <code
                {...rest}
                className={['block w-full min-w-0 whitespace-pre-wrap break-words [overflow-wrap:anywhere]', className]
                  .filter(Boolean)
                  .join(' ')}
              >
                {children}
              </code>
            );
          },
          pre: ({ children }) => (
            <pre
              className="panel-scrollbar mt-4 whitespace-pre-wrap break-words [overflow-wrap:anywhere] rounded-[14px] border border-[var(--workspace-border)] bg-[var(--workspace-surface-soft)] px-3 py-2 text-[13px] leading-6 text-[var(--workspace-text-primary)] first:mt-0"
              onWheel={stopCanvasWheelFromScrollableRegion}
            >
              {children}
            </pre>
          ),
          a: ({ children, href }) => (
            <a
              href={href}
              target="_blank"
              rel="noreferrer"
              className="text-zinc-100 underline decoration-zinc-500 underline-offset-4 hover:text-white"
            >
              {children}
            </a>
          ),
          table: ({ children }) => (
            <div className="mt-4 overflow-x-auto first:mt-0" onWheel={stopCanvasWheelFromScrollableRegion}>
              <table className="min-w-full border-collapse text-left text-[13px] text-zinc-200">{children}</table>
            </div>
          ),
          thead: ({ children }) => <thead className="border-b border-[var(--workspace-border)] text-[var(--workspace-text-primary)]">{children}</thead>,
          tbody: ({ children }) => <tbody>{children}</tbody>,
          tr: ({ children }) => <tr className="border-b border-[var(--workspace-border)] last:border-b-0">{children}</tr>,
          th: ({ children }) => <th className="px-3 py-2 font-medium">{children}</th>,
          td: ({ children }) => <td className="px-3 py-2 text-zinc-300">{children}</td>,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
});

function ConnectionPortIcon({
  className = '',
  glyphSize = 14,
}: {
  className?: string;
  glyphSize?: number;
}) {
  return (
    <span
      className={`workspace-control-chip inline-flex items-center justify-center rounded-full ${className}`.trim()}
    >
      <svg
        viewBox="0 0 24 24"
        style={{ width: glyphSize, height: glyphSize }}
        aria-hidden="true"
      >
        <path
          d="M12 4.6v14.8M4.6 12h14.8"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
        />
      </svg>
    </span>
  );
}

const CONNECTION_MENU_OPTIONS = [
  {
    id: 'text',
    title: '文本',
    description: '脚本、广告词、品牌文案',
    icon: Type,
  },
  {
    id: 'image',
    title: '图片',
    description: '风格一致、图生图',
    icon: ImageIcon,
  },
  {
    id: 'video',
    title: '视频',
    description: '风格化、视频生视频',
    icon: Video,
  },
] as const;

const LEFT_RAIL_ITEMS = [
  { id: 'assets', label: '资产', icon: Package2 },
  { id: 'workflow', label: '工作流', icon: Workflow },
  { id: 'history', label: '历史', icon: Clock3 },
  { id: 'theme', label: '黑夜', icon: Moon },
  { id: 'settings', label: '设置', icon: Settings },
] as const;

const IMAGE_NODE_TOOLBAR_ACTIONS = [
  { id: 'redraw', label: '重绘', icon: Pencil, enabled: false, disabledReason: undefined },
  { id: 'erase', label: '擦除', icon: X, enabled: false, disabledReason: undefined },
  { id: 'enhance', label: '增强', icon: Sparkles, enabled: false, disabledReason: undefined },
  { id: 'expand', label: '扩图', icon: Plus, enabled: false, disabledReason: undefined },
  { id: 'cutout', label: '抠图', icon: ImageIcon, enabled: true, disabledReason: undefined },
  { id: 'crop', label: '裁剪', icon: SlidersHorizontal, enabled: false, disabledReason: undefined },
  { id: 'export', label: '导出', icon: Send, enabled: true, disabledReason: undefined },
] as const;

const CANVAS_BOTTOM_TOOLBAR_ITEMS = [
  { id: 'select', label: '选择', svgPath: 'M2.8 5.66C2.187 3.886 3.887 2.186 5.66 2.8l14.833 5.126c1.96.677 2.038 3.42.12 4.208l-5.722 2.35a.75.75 0 0 0-.408.409l-2.35 5.721-.08.174c-.849 1.682-3.307 1.611-4.059-.116l-.07-.178zm2.37-1.444a.75.75 0 0 0-.953.954l5.127 14.833c.225.653 1.14.68 1.402.04l2.35-5.72.096-.204c.245-.46.645-.823 1.131-1.023l5.72-2.35c.64-.263.614-1.177-.04-1.403z' },
  { id: 'target', label: '定位', svgPath: 'M12.463 2.012A9 9 0 0 1 21 11l-.004.29c-.09 2.975-1.54 5.293-2.996 7.112l-.275.328c-1.45 1.66-3.967 3.52-5.725 3.52l-.179-.006c-1.746-.118-4.145-1.91-5.546-3.514L6 18.403C4.497 16.524 3 14.115 3 11a9 9 0 0 1 9-9zM12 3.38A7.62 7.62 0 0 0 4.38 11c0 2.646 1.264 4.747 2.698 6.54.602.752 1.53 1.622 2.517 2.295 1.036.707 1.9 1.034 2.405 1.034.506 0 1.369-.327 2.405-1.034.986-.673 1.915-1.543 2.517-2.295 1.434-1.793 2.697-3.894 2.697-6.54A7.62 7.62 0 0 0 12 3.38M12 7.5a3.5 3.5 0 1 1 0 7 3.5 3.5 0 0 1 0-7M12 9a2 2 0 1 0 0 4 2 2 0 0 0 0-4' },
  { id: 'image', label: '图片', svgPath: 'M17.25 3A3.75 3.75 0 0 1 21 6.75v4.5a.75.75 0 0 1-1.5 0v-4.5a2.25 2.25 0 0 0-2.25-2.25H6.75A2.25 2.25 0 0 0 4.5 6.75v8.505l2.777-2.634.002-.002a1.75 1.75 0 0 1 2.438.036l2.813 2.815a.75.75 0 1 1-1.06 1.06l-2.815-2.813a.25.25 0 0 0-.347-.006l-3.805 3.607A2.25 2.25 0 0 0 6.75 19.5h6.75a.75.75 0 0 1 0 1.5H6.75A3.75 3.75 0 0 1 3 17.25V6.75A3.75 3.75 0 0 1 6.75 3zm1 10.25a.75.75 0 0 1 .55.241l3 3.25a.75.75 0 0 1-1.1 1.018L19 15.918v4.332a.75.75 0 0 1-1.5 0v-4.332l-1.7 1.84a.75.75 0 0 1-1.1-1.017l3-3.25.055-.054a.75.75 0 0 1 .495-.187M15 7.5a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3' },
  { id: 'grid', label: '网格', svgPath: 'M16.8 3a.75.75 0 0 1 .75.75v3.3h2.7a.75.75 0 0 1 0 1.5h-2.7v6.9h2.7a.75.75 0 0 1 0 1.5h-2.7v3.3a.75.75 0 0 1-1.5 0v-3.3h-8.1v3.3a.75.75 0 0 1-1.5 0v-3.3h-2.7a.75.75 0 0 1 0-1.5h2.7v-6.9h-2.7a.75.75 0 0 1 0-1.5h2.7v-3.3a.75.75 0 0 1 1.5 0v3.3h8.1v-3.3A.75.75 0 0 1 16.8 3M7.95 15.45h8.1v-6.9h-8.1z' },
  { id: 'shape', label: '形状', svgPath: 'M19.5 8.55c0-.853 0-1.447-.038-1.91-.037-.453-.107-.714-.207-.911a2.25 2.25 0 0 0-.983-.984c-.198-.1-.459-.17-.913-.207-.462-.038-1.057-.038-1.909-.038h-6.9c-.853 0-1.447 0-1.91.038-.453.037-.714.106-.911.207a2.25 2.25 0 0 0-.984.984c-.1.197-.17.458-.207.912C4.5 7.103 4.5 7.697 4.5 8.55v6.9c0 .852 0 1.447.038 1.91.037.453.106.714.207.912.216.423.56.767.984.983.197.1.458.17.912.207.462.038 1.056.038 1.909.038h6.9c.852 0 1.447 0 1.91-.038.453-.037.714-.107.912-.207a2.25 2.25 0 0 0 .983-.983c.1-.198.17-.459.207-.913.038-.462.038-1.057.038-1.909zm1.5 6.9c0 .828.001 1.494-.043 2.031-.045.547-.14 1.027-.366 1.471a3.75 3.75 0 0 1-1.639 1.639c-.444.226-.924.321-1.47.366-.538.044-1.204.043-2.032.043h-6.9c-.828 0-1.494.001-2.031-.043-.547-.045-1.027-.14-1.471-.366a3.75 3.75 0 0 1-1.639-1.639c-.226-.444-.321-.924-.366-1.47C2.999 16.943 3 16.277 3 15.45v-6.9c0-.828-.001-1.494.043-2.031.045-.547.14-1.027.366-1.471a3.75 3.75 0 0 1 1.639-1.639c.444-.226.924-.321 1.47-.366C7.057 2.999 7.723 3 8.55 3h6.9c.828 0 1.494-.001 2.031.043.547.045 1.027.14 1.471.366a3.75 3.75 0 0 1 1.639 1.639c.226.444.321.924.366 1.47.044.538.043 1.204.043 2.032z' },
  { id: 'draw', label: '画笔', svgPath: 'M14.72 3.72a3.932 3.932 0 0 1 5.56 5.56L8.366 21.195A2.75 2.75 0 0 1 6.422 22H2.75a.75.75 0 0 1-.75-.75v-3.671c0-.73.29-1.43.806-1.946zm4.5 1.06c-.95-.95-2.49-.95-3.44 0l-1.47 1.47 3.44 3.44 1.47-1.47c.95-.95.95-2.49 0-3.44M3.5 20.5h2.922c.331 0 .65-.132.884-.367l9.383-9.383-3.439-3.44-9.384 9.385a1.25 1.25 0 0 0-.366.884z' },
  { id: 'text', label: '文字', svgPath: 'M19.5 6.25V4.5h-6.75v15h1.5a.75.75 0 0 1 0 1.5h-4.5a.75.75 0 0 1 0-1.5h1.5v-15H4.5v1.75a.75.75 0 0 1-1.5 0v-2.5A.75.75 0 0 1 3.75 3h16.5a.75.75 0 0 1 .75.75v2.5a.75.75 0 0 1-1.5 0' },
  { id: 'image-enhance', label: '图片增强', action: 'add-image-card', svgPath: 'M11.75 3a.75.75 0 0 1 0 1.5h-5A2.25 2.25 0 0 0 4.5 6.75v7.513l2.28-2.145a1.75 1.75 0 0 1 2.437.037L12 14.94l.763-.762a1.75 1.75 0 0 1 2.474 0l4.041 4.04c.14-.293.222-.62.222-.967v-5a.75.75 0 0 1 1.5 0v5A3.75 3.75 0 0 1 17.25 21H6.75A3.75 3.75 0 0 1 3 17.25V6.75A3.75 3.75 0 0 1 6.75 3zM8.155 13.216a.25.25 0 0 0-.347-.005L4.5 16.323v.927a2.25 2.25 0 0 0 2.25 2.25h10.5c.347 0 .674-.081.968-.222l-4.041-4.04a.25.25 0 0 0-.315-.033l-.039.032-1.293 1.293a.75.75 0 0 1-1.06 0zM18 2c.241 0 .457.148.544.373l.696 1.813a1 1 0 0 0 .575.574l1.812.696a.583.583 0 0 1 0 1.088l-1.812.696a1 1 0 0 0-.575.574l-.696 1.813a.583.583 0 0 1-1.088 0l-.696-1.813a1 1 0 0 0-.575-.574l-1.812-.696a.583.583 0 0 1 0-1.088l1.813-.696a1 1 0 0 0 .574-.574l.696-1.813A.58.58 0 0 1 18 2' },
  { id: 'video', label: '视频（即将支持）', action: 'video-placeholder', svgPath: 'M11.977 3a.75.75 0 0 1 0 1.5h-5a2.25 2.25 0 0 0-2.25 2.25v10.5a2.25 2.25 0 0 0 2.25 2.25h10.5a2.25 2.25 0 0 0 2.25-2.25v-5a.75.75 0 0 1 1.5 0v5a3.75 3.75 0 0 1-3.75 3.75h-10.5a3.75 3.75 0 0 1-3.75-3.75V6.75A3.75 3.75 0 0 1 6.977 3zm-1.558 5.827a.75.75 0 0 1 .788.078l3.25 2.5a.75.75 0 0 1 0 1.19l-3.25 2.5A.75.75 0 0 1 10 14.5v-5l.008-.105a.75.75 0 0 1 .41-.568M18.227 2c.24 0 .457.148.543.373l.698 1.813a1 1 0 0 0 .574.574l1.811.696a.583.583 0 0 1 0 1.088l-1.811.696a1 1 0 0 0-.574.574l-.698 1.813a.583.583 0 0 1-1.086 0l-.698-1.813a1 1 0 0 0-.574-.574l-1.811-.696a.584.584 0 0 1 0-1.088l1.811-.696a1 1 0 0 0 .574-.574l.698-1.813A.58.58 0 0 1 18.227 2' },
  { id: 'text-add', label: '添加文字', action: 'add-text-card', svgPath: 'M19 14c.241 0 .457.148.544.373l.696 1.813a1 1 0 0 0 .575.574l1.812.696a.583.583 0 0 1 0 1.088l-1.812.696a1 1 0 0 0-.575.575l-.696 1.812a.583.583 0 0 1-1.088 0l-.696-1.812a1 1 0 0 0-.575-.575l-1.812-.696a.583.583 0 0 1 0-1.088l1.813-.696a1 1 0 0 0 .574-.575l.696-1.812A.58.58 0 0 1 19 14M15.45 3c.828 0 1.494-.001 2.031.043.547.045 1.027.14 1.471.366a3.75 3.75 0 0 1 1.639 1.639c.226.444.321.924.366 1.47.044.538.043 1.204.043 2.032v1.95a.75.75 0 0 1-1.5 0V8.55c0-.853 0-1.447-.038-1.91-.037-.453-.107-.714-.207-.911a2.25 2.25 0 0 0-.983-.984c-.198-.1-.459-.17-.913-.207-.462-.038-1.057-.038-1.909-.038h-6.9c-.853 0-1.447 0-1.91.038-.453.037-.714.106-.911.207a2.25 2.25 0 0 0-.984.984c-.1.197-.17.458-.207.912C4.5 7.103 4.5 7.697 4.5 8.55v6.9c0 .852 0 1.447.038 1.91.037.453.106.714.207.912.216.423.56.767.984.983.197.1.458.17.912.207.462.038 1.056.038 1.909.038h1.95a.75.75 0 0 1 0 1.5H8.55c-.828 0-1.494.001-2.031-.043-.547-.045-1.027-.14-1.471-.366a3.75 3.75 0 0 1-1.639-1.639c-.226-.444-.321-.924-.366-1.47C2.999 16.943 3 16.277 3 15.45v-6.9c0-.828-.001-1.494.043-2.031.045-.547.14-1.027.366-1.471a3.75 3.75 0 0 1 1.639-1.639c.444-.226.924-.321 1.47-.366C7.057 2.999 7.723 3 8.55 3zM16 7.25a.75.75 0 0 1 0 1.5h-3.25V15a.75.75 0 0 1-1.5 0V8.75H8a.75.75 0 1 1 0-1.5z', svgOpacity: 1 },
] as const;
type CanvasBottomToolbarAction = 'add-image-card' | 'add-text-card' | 'video-placeholder';

const ADD_NODE_MENU_OPTIONS = [
  {
    id: 'text',
    title: '文本',
    description: '脚本、广告词、品牌文案',
    icon: Type,
    disabled: false,
  },
  {
    id: 'image',
    title: '图片',
    description: '海报、封面、参考图',
    icon: ImageIcon,
    disabled: false,
  },
  {
    id: 'video',
    title: '视频',
    description: '即将支持',
    icon: Video,
    disabled: true,
  },
] as const;

function CanvasActionMenuItem({
  title,
  description,
  Icon,
  disabled = false,
  onClick,
}: {
  title: string;
  description: string;
  Icon: React.ComponentType<any>;
  disabled?: boolean;
  onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onPointerDown={(e) => {
        e.stopPropagation();
      }}
      onClick={onClick}
      className={`workspace-menu-item group flex min-h-[68px] w-full items-center gap-2.5 rounded-[20px] border border-transparent px-3 py-2.5 text-left  ${disabled ? 'is-disabled' : ''}`}
    >
      <div
        className="workspace-menu-icon flex h-12 w-12 shrink-0 items-center justify-center rounded-[11px]  "
      >
        <Icon size={21} strokeWidth={2} />
      </div>
      <div className="flex min-w-0 flex-1 items-center pl-1">
        <div className={`relative min-w-0 flex-1 ${disabled ? 'flex flex-col justify-center gap-0.5' : 'h-[38px]'}`}>
          <div
            className={`min-w-0 text-[16px] font-medium tracking-[-0.03em] ${
              disabled
                ? 'workspace-text-soft'
                : 'workspace-text-primary absolute left-0 top-1/2 -translate-y-1/2 group-hover:-translate-y-[18px]'
            }`}
          >
            {title}
          </div>
          <div
            className={`workspace-text-muted min-w-0 whitespace-normal break-words text-[11px] font-medium tracking-[-0.01em] ${
              disabled
                ? ''
                : 'pointer-events-none absolute left-0 top-[22px] translate-y-1 opacity-0 group-hover:translate-y-0 group-hover:opacity-100'
            }`}
          >
            {description}
          </div>
        </div>
      </div>
    </button>
  );
}

function WorkspaceThemeToggle({
  theme,
  onToggle,
}: {
  theme: WorkspaceTheme;
  onToggle: () => void;
}) {
  const Icon = theme === 'dark' ? Sun : Moon;
  const label = theme === 'dark' ? '白天' : '黑夜';

  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      className="workspace-rail-item"
      title={label}
      aria-label={theme === 'dark' ? '切换到白天模式' : '切换到黑夜模式'}
    >
      <Icon size={19} strokeWidth={2.1} />
      <span className="text-[10px] font-medium tracking-[-0.03em] leading-none">{label}</span>
    </button>
  );
}

export default function AIWorkspace() {
  const { theme, toggleTheme } = useWorkspaceTheme();
  const themePalette = WORKSPACE_THEME_PALETTES[theme];
  const editorShellRef = useRef<HTMLDivElement | null>(null);
  const { contextSafe: workspaceContextSafe } = useGSAP({ scope: editorShellRef });
  const zoomControlRef = useRef<HTMLDivElement | null>(null);
  const zoomMenuRef = useRef<HTMLDivElement | null>(null);
  const zoomPercentageRef = useRef<HTMLSpanElement | null>(null);
  const setZoomMenuOpen = useCallback((open: boolean) => {
    const menu = zoomMenuRef.current;
    if (!menu) return;
    menu.style.opacity = open ? '1' : '0';
    menu.style.visibility = open ? 'visible' : 'hidden';
    menu.style.pointerEvents = open ? 'auto' : 'none';
  }, []);
  const chatPanelRef = useRef<HTMLDivElement | null>(null);
  const chatPanelOpenButtonRef = useRef<HTMLDivElement | null>(null);
  const chatPanelTimelineRef = useRef<gsap.core.Timeline | null>(null);
  const chatPanelMotionControllerRef = useRef<ChatPanelMotionController | null>(null);
  const chatPanelMotionFrameRef = useRef<number | null>(null);
  const chatPanelMotionPerformanceRef = useRef<ChatPanelMotionPerformanceTrace | null>(null);
  const chatPanelCollapsedRef = useRef(false);
  const canvasBottomToolbarMotionRef = useRef<HTMLDivElement | null>(null);
  const chatSafeAreaWidthRef = useRef(0);
  const chatPanelIsDesktopRef = useRef(true);
  const [viewMode, setViewMode] = useState<'gallery' | 'editor'>('gallery');
  const [tool, setTool] = useState<Tool>('select');
  const [annotationColor, setAnnotationColor] = useState(DEFAULT_ANNOTATION_COLOR);
  const [annotationStrokeWidth, setAnnotationStrokeWidth] = useState(DEFAULT_ANNOTATION_STROKE_WIDTH);
  const [draftStroke, setDraftStroke] = useState<DraftStroke | null>(null);
  const [editingAnnotationTextId, setEditingAnnotationTextId] = useState<string | null>(null);
  const [items, setItemsState] = useState<CanvasItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [hoveredCanvasItemId, setHoveredCanvasItemId] = useState<string | null>(null);
  const [hoveredInputPortItemId, setHoveredInputPortItemId] = useState<string | null>(null);
  const [hoveredOutputPortItemId, setHoveredOutputPortItemId] = useState<string | null>(null);
  const [connectionMode, setConnectionMode] = useState<ConnectionMode>('idle');
  const [connectionFromItemId, setConnectionFromItemId] = useState<string | null>(null);
  const [connectionPointerId, setConnectionPointerId] = useState<number | null>(null);
  const [frozenPreviewConnection, setFrozenPreviewConnection] = useState<FrozenPreviewConnection | null>(null);
  const [pendingConnectionMenu, setPendingConnectionMenu] = useState<PendingConnectionMenu | null>(null);
  const [activeCanvasImageIds, setActiveCanvasImageIds] = useState<Set<string>>(() => new Set());
  const [viewport, setViewportState] = useState({ x: 0, y: 0, scale: 1 });
  const canvasInteractionPhaseRef = useRef<CanvasInteractionPhase>('idle');
  const isCornerResizingRef = useRef(false);
  const [isSpacePressed, setIsSpacePressed] = useState(false);
  const marqueeVisualRectRef = useRef<{ x: number; y: number; width: number; height: number } | null>(null);
  const marqueeSvgRef = useRef<SVGSVGElement | null>(null);
  const marqueePathRef = useRef<SVGPathElement | null>(null);
  const [connections, setConnectionsState] = useState<Connection[]>([]);
  const [selectedConnectionIds, setSelectedConnectionIds] = useState<string[]>([]);
  const dragStart = useRef({ x: 0, y: 0 });
  const panStartViewportRef = useRef<ViewportState>({ x: 0, y: 0, scale: 1 });
  const isPanningRef = useRef(false);
  const isDraggingRef = useRef(false);
  const isAltCopyDragRef = useRef(false);
  const altDragPrimarySourceIdRef = useRef<string | null>(null);
  const activeItemDragTokenRef = useRef<number | null>(null);
  const canvasItemDragTransactionRef = useRef<DirectItemDragSession | null>(null);
  const canvasItemDragPreviewRef = useRef<CanvasItemDragPreviewState | null>(null);
  const canvasItemDragConnectionPrepareFrameRef = useRef<number | null>(null);
  const refreshDirectItemConnectionPathsRef = useRef<(
    itemId: string,
    geometry?: { width: number; height: number }
  ) => void>(() => {});
  const canvasItemDragPresentationRef = useRef(new Map<HTMLElement, {
    zIndex: string;
    willChange: string;
  }>());
  const clearCanvasItemDragPreviewRef = useRef<(
    restoreConnectionPaths?: boolean
  ) => void>(() => {});
  const canvasConnectionRuntimeIndexRef = useRef<CanvasConnectionRuntimeIndex>(new Map());
  const viewportRef = useRef({ x: 0, y: 0, scale: 1 });
  const visualViewportRef = useRef({ x: 0, y: 0, scale: 1 });
  const renderedViewportRef = useRef({ x: 0, y: 0, scale: 1 });
  const itemsRef = useRef<CanvasItem[]>([]);
  const itemByIdRef = useRef(new Map<string, CanvasItem>());
  const renderedItemsByIdRef = useRef(new Map<string, CanvasItem>());
  const connectionPreviewPathRef = useRef<SVGPathElement | null>(null);
  const activeCanvasImageIdsRef = useRef(new Set<string>());
  const canvasImageReleaseTimersRef = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const pendingCanvasCommitRef = useRef<CanvasCommitBuffer | null>(null);
  const pendingCanvasCommitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingCanvasCommitIdleRef = useRef<number | null>(null);
  const pendingCanvasCommitIdleKindRef = useRef<'idle' | 'frame' | null>(null);
  const pendingCanvasCommitRevisionRef = useRef(0);
  const pendingCanvasCommitLayoutMeasureRef = useRef<{
    revision: number;
    reason: string;
    startedAt: number;
    commitDuringInteraction: boolean;
    commitDuringInteractionCount: number;
  } | null>(null);
  const canvasCommitDuringInteractionCountRef = useRef(0);
  const pendingCanvasNextInputMeasureRef = useRef<{
    kind: string;
    startedAt: number;
  } | null>(null);
  const pendingCanvasOverlayMountMeasureRef = useRef<{
    itemId: string;
    startedAt: number;
    releasedAt: number;
    firstDragVisualAt: number | null;
    selectionReactCommitDuringInteractionCount: number;
  } | null>(null);
  const pendingCanvasOverlayMountFrameRef = useRef<number | null>(null);
  const pendingCanvasSelectionFinalizeFrameRef = useRef<number | null>(null);
  const cancelPendingCanvasSelectionFinalizeRef = useRef<() => void>(() => {});
  const canvasOverlayTransformCacheRef = useRef(new WeakMap<HTMLElement, string>());
  const canvasOverlaySyncWriteCountRef = useRef(0);
  const canvasOverlayReactCommitDuringInteractionCountRef = useRef(0);
  const canvasPerformanceEnabledRef = useRef(false);
  const workspaceCommitPerformanceSamplesRef = useRef<number[]>([]);
  const workspaceCommitWindowRef = useRef({ startedAt: 0, count: 0 });
  const interactionCommitTokenRef = useRef(0);
  const selectedIdRef = useRef<string | null>(null);
  const selectedIdsRef = useRef<string[]>([]);
  const canvasDomSelectedIdsRef = useRef<string[]>([]);
  const selectedConnectionIdsRef = useRef<string[]>([]);
  const pendingCanvasSelectionGestureRef = useRef<PendingCanvasSelectionGesture | null>(null);
  const finalizeCanvasSelectionGestureRef = useRef<(
    options: FinalizeCanvasSelectionGestureOptions
  ) => void>(() => {});
  const restoreCanvasSelectionGestureRef = useRef<() => void>(() => {});
  const canvasSelectionReactCommitDuringInteractionCountRef = useRef(0);
  const reducedMotionRef = useRef(false);
  const dragItemStartPositionsRef = useRef<Record<string, { x: number; y: number }>>({});
  const cornerResizePreviewRef = useRef<CornerResizePreview | null>(null);
  const panMotionRef = useRef<CanvasPanMotion | null>(null);
  const pendingViewportIdleCommitTokenRef = useRef<number | null>(null);
  const panReactViewportCommitCountRef = useRef(0);
  const panOverlayStateActiveRef = useRef(false);
  const viewportTweenRef = useRef<NativeViewportAnimation | null>(null);
  const animateViewportToRef = useRef<(viewport: ViewportState) => void>(() => {});
  const marqueeSessionRef = useRef<CanvasMarqueeSession | null>(null);
  const draggingItemIdsRef = useRef<string[]>([]);
  const draftStrokeRef = useRef<DraftStroke | null>(null);
  const draftStrokePathRef = useRef<SVGPathElement | null>(null);
  const regionDraftVisualRef = useRef<RegionDraftVisualController | null>(null);
  const editingAnnotationTextRef = useRef<HTMLTextAreaElement | null>(null);
  const connectionDragMovedRef = useRef(false);
  const connectionSessionRef = useRef<ConnectionSession | null>(null);
  const connectionSnapTargetVisualRef = useRef<ConnectionSnapTargetVisual | null>(null);
  const clearConnectionSnapTargetVisualRef = useRef<() => void>(() => {});
  const clearConnectionInteractionStateRef = useRef<() => void>(() => {});
  
  const [chatInputSyncRevision, setChatInputSyncRevision] = useState(0);
  const [chatMessages, setChatMessagesState] = useState<ChatMessage[]>([]);
  const [visibleChatMessageLimit, setVisibleChatMessageLimit] = useState(80);
  const attemptedLegacyChatReferenceMigrationsRef = useRef(new Set<string>());
  const attemptedLegacyCanvasImageMigrationsRef = useRef(new Set<string>());
  const [activeAgentRunMarker, setActiveAgentRunMarker] = useState<ProjectSession['activeAgentRun']>(undefined);
  const activeAgentRunMarkerRef = useRef<ProjectSession['activeAgentRun']>(undefined);
  const [interruptedRunRecoveryPending, setInterruptedRunRecoveryPending] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [activeCanvasTextGenerations, setActiveCanvasTextGenerations] = useState<
    Record<string, { status: 'running'; startedAt: number }>
  >({});
  const [activeCanvasImageGenerations, setActiveCanvasImageGenerations] = useState<
    Record<string, { status: 'running'; startedAt: number; total: number; completed: number; failed: number }>
  >({});
  const [generationClockMs, setGenerationClockMs] = useState(() => Date.now());
  const [canvasTextGenerationErrorById, setCanvasTextGenerationErrorById] = useState<Record<string, string>>({});
  const [canvasImageGenerationErrorById, setCanvasImageGenerationErrorById] = useState<Record<string, string>>({});
  const [hasStartedChat, setHasStartedChat] = useState(false);
  const [showAvatarMenu, setShowAvatarMenu] = useState(false);
  const [activeSkill, setActiveSkillState] = useState<{ id: string; label: string } | null>(null);
  const [generationMode, setGenerationMode] = useState<GenerationMode>(PROMPT_PIPELINE_AGENT_ENABLED ? 'agent' : 'chat');
  const [chatProviderId, setChatProviderIdState] = useState('');
  const [chatModelId, setChatModelIdState] = useState('');
  const [imageProviderId, setImageProviderIdState] = useState('');
  const [imageModelId, setImageModelIdState] = useState('');
  const [showChatModelSelector, setShowChatModelSelector] = useState(false);
  const [showImageModelSelector, setShowImageModelSelector] = useState(false);
  const [modelSelectionNotice, setModelSelectionNotice] = useState<string | null>(null);
  const [quickActions, setQuickActions] = useState(DEFAULT_QUICK_ACTIONS);
  const [showGenerationModeMenu, setShowGenerationModeMenu] = useState(false);
  const [showSkillsMenu, setShowSkillsMenu] = useState(false);
  const [showChatComposerMoreMenu, setShowChatComposerMoreMenu] = useState(false);
  const [showChatAssetPicker, setShowChatAssetPicker] = useState(false);
  const [selectedChatHistoryAssetIds, setSelectedChatHistoryAssetIds] = useState<string[]>([]);
  const [showModelPreferencePopover, setShowModelPreferencePopover] = useState(false);
  const [imageAspectRatio, setImageAspectRatio] = useState('auto');
  const [agentImageAspectRatio, setAgentImageAspectRatio] = useState('3:4');
  const activeChatImageAspectRatio = generationMode === 'agent' ? agentImageAspectRatio : imageAspectRatio;
  const [hideWelcomeByCenterSkillPick, setHideWelcomeByCenterSkillPick] = useState(false);
  const [referenceImages, setReferenceImages] = useState<string[]>([]);
  const [chatReferenceTokens, setChatReferenceTokens] = useState<ChatReferenceToken[]>([]);
  const chatReferenceTokensRef = useRef<ChatReferenceToken[]>([]);
  const [regionSelections, setRegionSelectionsState] = useState<RegionSelection[]>([]);
  const regionSelectionsRef = useRef<RegionSelection[]>([]);
  const regionEvidenceByIdRef = useRef<Map<string, RegionEvidence>>(new Map());
  const [activeRegionMenuId, setActiveRegionMenuId] = useState<string | null>(null);
  const [regionRefineId, setRegionRefineId] = useState<string | null>(null);
  const [regionCustomLabelDraft, setRegionCustomLabelDraft] = useState('');

  useLayoutEffect(() => {
    chatReferenceTokensRef.current = chatReferenceTokens;
  }, [chatReferenceTokens]);
  const [regionDraftPreview, setRegionDraftPreview] = useState<RegionSelection | null>(null);
  const regionDraftRef = useRef<{
    pointerId: number;
    imageItemId: string;
    existingRegionId?: string;
    start: { x: number; y: number };
    current: { x: number; y: number };
  } | null>(null);
  const dismissedCanvasReferenceIdsRef = useRef<Set<string>>(new Set());
  const [draggingImageIndex, setDraggingImageIndex] = useState<number | null>(null);
  const [dragOverImageIndex, setDragOverImageIndex] = useState<number | null>(null);
  const processedAgentActionsRef = useRef(new Set<string>());
  const processedAgentCompletionSummariesRef = useRef(new Set<string>());
  const pendingAgentConfirmationsRef = useRef(new Set<string>());
  const [draggingPanelReference, setDraggingPanelReference] = useState<{
    targetItemId: string;
    sourceItemId: string;
  } | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void fetch('/api/skills', { signal: controller.signal, cache: 'no-store' })
      .then((response) => response.ok ? response.json() : Promise.reject(new Error('Failed to load skills')))
      .then((payload: { skills?: Array<{ id?: string; name?: string }> }) => {
        const skills = Array.isArray(payload.skills)
          ? payload.skills
              .filter((skill): skill is { id: string; name: string } => Boolean(skill.id && skill.name))
              .map((skill) => ({ id: skill.id, label: skill.name }))
          : [];
        if (skills.length > 0) setQuickActions(skills);
      })
      .catch((error) => {
        if (!(error instanceof DOMException && error.name === 'AbortError')) {
          console.warn('Failed to load skill registry', error);
        }
      });
    return () => controller.abort();
  }, []);

  useGSAP(
    () => {
      const panel = chatPanelRef.current;
      const toolbar = canvasBottomToolbarMotionRef.current;
      const openButton = chatPanelOpenButtonRef.current;
      if (viewMode !== 'editor' || !panel || !toolbar || !openButton) return;

      const desktopQuery = window.matchMedia('(min-width: 640px)');
      chatPanelIsDesktopRef.current = desktopQuery.matches;
      const timeline = gsap.timeline({
        paused: true,
        defaults: {
          duration: CHAT_PANEL_GSAP_OPEN_DURATION,
          ease: CHAT_PANEL_GSAP_EASE,
          overwrite: 'auto',
        },
      });

      timeline
        .fromTo(panel, { xPercent: 100 }, { xPercent: 0, force3D: true }, 0)
        .fromTo(
          toolbar,
          { x: 0 },
          {
            x: () => chatPanelIsDesktopRef.current ? -CANVAS_CHAT_PANEL_RESERVED_WIDTH / 2 : 0,
            force3D: true,
          },
          0
        )
        .fromTo(
          openButton,
          { autoAlpha: 1 },
          { autoAlpha: 0, duration: 0.12, ease: 'none', overwrite: 'auto' },
          0
        );

      const setElementState = (collapsed: boolean) => {
        panel.setAttribute('aria-hidden', String(collapsed));
        panel.style.pointerEvents = collapsed ? 'none' : 'auto';
        panel.style.visibility = collapsed ? 'hidden' : 'visible';
        openButton.setAttribute('aria-hidden', String(!collapsed));
        openButton.style.pointerEvents = collapsed ? 'auto' : 'none';
        openButton.style.visibility = collapsed ? 'visible' : 'hidden';
      };
      const clearMotionHints = () => {
        panel.style.willChange = '';
        toolbar.style.willChange = '';
        openButton.style.willChange = '';
      };
      const finishPerformanceTrace = (interrupted = false) => {
        const trace = chatPanelMotionPerformanceRef.current;
        if (!trace) return;
        gsap.ticker.remove(trace.ticker);
        chatPanelMotionPerformanceRef.current = null;
        console.info('[chat-panel-perf]', {
          direction: trace.targetCollapsed ? 'close' : 'open',
          durationMs: performance.now() - trace.startedAt,
          maxFrameIntervalMs: trace.maxFrameIntervalMs,
          frameCount: trace.frameCount,
          longFrameCount: trace.longFrameCount,
          interrupted,
        });
      };
      const startPerformanceTrace = (targetCollapsed: boolean) => {
        finishPerformanceTrace(true);
        if (!isCanvasPerformanceEnabled()) return;
        const trace: ChatPanelMotionPerformanceTrace = {
          targetCollapsed,
          startedAt: performance.now(),
          maxFrameIntervalMs: 0,
          frameCount: 0,
          longFrameCount: 0,
          ticker: (_time, deltaTime) => {
            trace.frameCount += 1;
            trace.maxFrameIntervalMs = Math.max(trace.maxFrameIntervalMs, deltaTime);
            if (deltaTime > 50) trace.longFrameCount += 1;
          },
        };
        chatPanelMotionPerformanceRef.current = trace;
        gsap.ticker.add(trace.ticker);
      };
      const settle = (collapsed: boolean) => {
        if (chatPanelCollapsedRef.current !== collapsed) return;
        finishPerformanceTrace(false);
        clearMotionHints();
        setElementState(collapsed);
      };
      const syncEndpoint = () => {
        const collapsed = chatPanelCollapsedRef.current;
        chatSafeAreaWidthRef.current = collapsed || !chatPanelIsDesktopRef.current
          ? 0
          : CANVAS_CHAT_PANEL_RESERVED_WIDTH;
        timeline.invalidate().progress(collapsed ? 0 : 1, true).pause();
        settle(collapsed);
      };
      const moveTo = (collapsed: boolean) => {
        startPerformanceTrace(collapsed);
        chatPanelCollapsedRef.current = collapsed;
        chatSafeAreaWidthRef.current = collapsed || !chatPanelIsDesktopRef.current
          ? 0
          : CANVAS_CHAT_PANEL_RESERVED_WIDTH;
        if (chatPanelMotionFrameRef.current !== null) {
          cancelAnimationFrame(chatPanelMotionFrameRef.current);
          chatPanelMotionFrameRef.current = null;
        }

        panel.style.visibility = 'visible';
        panel.style.pointerEvents = collapsed ? 'none' : 'auto';
        panel.setAttribute('aria-hidden', String(collapsed));
        openButton.style.visibility = 'visible';
        openButton.style.pointerEvents = 'none';
        openButton.setAttribute('aria-hidden', 'true');
        panel.style.willChange = 'transform';
        toolbar.style.willChange = 'transform';
        openButton.style.willChange = 'opacity';

        const targetProgress = collapsed ? 0 : 1;
        if (
          reducedMotionRef.current ||
          Math.abs(timeline.progress() - targetProgress) <= 0.001
        ) {
          timeline.progress(targetProgress, true).pause();
          settle(collapsed);
          return;
        }
        chatPanelMotionFrameRef.current = requestAnimationFrame(() => {
          chatPanelMotionFrameRef.current = null;
          if (chatPanelCollapsedRef.current !== collapsed) return;
          if (collapsed) {
            timeline
              .timeScale(CHAT_PANEL_GSAP_OPEN_DURATION / CHAT_PANEL_GSAP_CLOSE_DURATION)
              .reverse();
          } else {
            timeline.timeScale(1).play();
          }
        });
      };

      timeline.eventCallback('onComplete', () => settle(false));
      timeline.eventCallback('onReverseComplete', () => settle(true));
      timeline.progress(chatPanelCollapsedRef.current ? 0 : 1, true).pause();
      chatPanelTimelineRef.current = timeline;
      chatPanelMotionControllerRef.current = {
        open: () => moveTo(false),
        close: () => moveTo(true),
        syncBreakpoint: (isDesktop: boolean) => {
          chatPanelIsDesktopRef.current = isDesktop;
          syncEndpoint();
        },
        isCollapsed: () => chatPanelCollapsedRef.current,
      };
      syncEndpoint();

      const handleDesktopChange = (event: MediaQueryListEvent) => {
        chatPanelMotionControllerRef.current?.syncBreakpoint(event.matches);
      };
      desktopQuery.addEventListener('change', handleDesktopChange);

      return () => {
        desktopQuery.removeEventListener('change', handleDesktopChange);
        if (chatPanelMotionFrameRef.current !== null) {
          cancelAnimationFrame(chatPanelMotionFrameRef.current);
          chatPanelMotionFrameRef.current = null;
        }
        finishPerformanceTrace(true);
        clearMotionHints();
        chatPanelMotionControllerRef.current = null;
        chatPanelTimelineRef.current = null;
        timeline.kill();
      };
    },
    {
      dependencies: [viewMode],
      scope: editorShellRef,
      revertOnUpdate: true,
    }
  );

  const [dragOverPanelReference, setDragOverPanelReference] = useState<{
    targetItemId: string;
    sourceItemId: string;
  } | null>(null);
  const [imageCount, setImageCount] = useState(0);
  
  // 项目管理状态
  const [showProjectMenu, setShowProjectMenu] = useState(false);
  const [showHistoryPanel, setShowHistoryPanel] = useState(false);
  const [showGeneratedImageHistoryPanel, setShowGeneratedImageHistoryPanel] = useState(false);
  const [showProviderSettingsModal, setShowProviderSettingsModal] = useState(false);
  const [providerSettingsLoading, setProviderSettingsLoading] = useState(false);
  const [providerSettingsLoaded, setProviderSettingsLoaded] = useState(false);
  const [providerSettingsSaving, setProviderSettingsSaving] = useState(false);
  const [providerSettingsTesting, setProviderSettingsTesting] = useState(false);
  const [providerSettingsFetchingModels, setProviderSettingsFetchingModels] = useState(false);
  const [providerSettingsError, setProviderSettingsError] = useState<string | null>(null);
  const [providerSettingsProviders, setProviderSettingsProviders] = useState<ProviderSettingsItem[]>([]);
  const [providerSettingsEditableProviderIds, setProviderSettingsEditableProviderIds] = useState<string[]>([]);
  const [providerSettingsSelectedProviderId, setProviderSettingsSelectedProviderId] = useState<ProviderSettingsProviderId>('comfly');
  const [providerSettingsApiKey, setProviderSettingsApiKey] = useState('');
  const [providerSettingsImageApiKeys, setProviderSettingsImageApiKeys] = useState<ProviderSettingsImageApiKeyRow[]>(
    () => normalizeProviderSettingsImageApiKeyRows()
  );
  const [providerSettingsTestResult, setProviderSettingsTestResult] = useState<ProviderConnectionTestResult | null>(null);
  const [providerSettingsFetchedModels, setProviderSettingsFetchedModels] = useState<ProviderFetchedModelsResult | null>(null);
  const [providerSettingsModelPickerOpen, setProviderSettingsModelPickerOpen] = useState(false);
  const [providerSettingsModelPickerCategory, setProviderSettingsModelPickerCategory] =
    useState<ProviderSettingsModelPickerCategory>('all');
  const [providerSettingsModelPickerSearch, setProviderSettingsModelPickerSearch] = useState('');
  const [providerSettingsSelectedFetchedModels, setProviderSettingsSelectedFetchedModels] = useState<Record<string, boolean>>({});
  const [providerSettingsFetchedModelCategoryById, setProviderSettingsFetchedModelCategoryById] =
    useState<Record<string, 'image' | 'chat'>>({});
  const [isProviderSettingsApiKeyVisible, setIsProviderSettingsApiKeyVisible] = useState(false);
  const [generatedImageHistoryBySession, setGeneratedImageHistoryBySessionState] = useState<Record<string, GeneratedImageHistoryEntry[]>>({});
  const [archiveGeneratedImageHistoryEntries, setArchiveGeneratedImageHistoryEntries] = useState<GeneratedImageHistoryEntry[]>([]);
  const [showAddNodeMenu, setShowAddNodeMenu] = useState(false);
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [imageToolbarNotice, setImageToolbarNotice] = useState<string | null>(null);
  
  const [activeSkillJobId, setActiveSkillJobId] = useState<string | null>(null);
  const [activeSkillJobType, setActiveSkillJobType] = useState<'logo' | 'brand' | null>(null);
  const [activeSkillJobStatus, setActiveSkillJobStatus] = useState<{
    completed: number;
    failed: number;
    total: number;
    items: Array<{ component: string; name: string; status: string; localUrl?: string; error?: string }>;
  } | null>(null);
  
  const projectMenuRef = useRef<HTMLDivElement>(null);
  const addNodeMenuRef = useRef<HTMLDivElement>(null);
  const generatedImageHistoryPanelRef = useRef<HTMLDivElement>(null);
  const generationModeMenuRef = useRef<HTMLDivElement>(null);
  const chatModelSelectorRef = useRef<HTMLDivElement>(null);
  const imageModelSelectorRef = useRef<HTMLDivElement>(null);
  const skillsMenuRef = useRef<HTMLDivElement>(null);
  const chatComposerMoreMenuRef = useRef<HTMLDivElement>(null);
  const chatComposerMoreButtonRef = useRef<HTMLButtonElement>(null);
  const chatAssetPickerRef = useRef<HTMLDivElement>(null);
  const modelPreferenceContainerRef = useRef<HTMLDivElement>(null);
  const modelPreferencePopoverRef = useRef<HTMLDivElement>(null);
  const modelPreferenceButtonRef = useRef<HTMLButtonElement>(null);
  const textPanelModelMenuRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const updateCanvasInteractionPhase = useCallback((phase: CanvasInteractionPhase) => {
    if (canvasInteractionPhaseRef.current === phase) return;
    canvasInteractionPhaseRef.current = phase;
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (phase === 'idle') delete canvas.dataset.canvasInteraction;
    else canvas.dataset.canvasInteraction = phase;
  }, []);
  const setCanvasConnectionHitTestingDisabled = useCallback((disabled: boolean) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (disabled) canvas.dataset.canvasConnectionHitTesting = 'disabled';
    else delete canvas.dataset.canvasConnectionHitTesting;
  }, []);
  const canvasSceneRef = useRef<HTMLDivElement>(null);
  const canvasMetricsRef = useRef<CanvasMetrics>({ left: 0, top: 0, width: 0, height: 0 });
  const [canvasSize, setCanvasSize] = useState<CanvasSize>({ width: 0, height: 0 });
  const {
    registerScene,
    getItemTargetRef,
    getSelectionGroupRef,
    getConnectionPathRef,
    getViewportOverlayRef,
    getItemTargets,
    getConnectionPaths,
    getViewportOverlay,
    getSceneTarget,
    setHoveredItem,
    startPointerSession,
    setPointerSessionMode,
    isManagedPointer,
    hasActivePointerSession,
    cancelInteraction,
    markLayoutCommitted,
  } = useCanvasInteractionController(canvasRef);
  const setCanvasSceneRef = useCallback((element: HTMLDivElement | null) => {
    canvasSceneRef.current = element;
    registerScene(element);
    if (!element) return;
    const activeViewport = visualViewportRef.current;
    getSceneTarget()?.setViewportTransform(activeViewport.x, activeViewport.y, activeViewport.scale);
  }, [getSceneTarget, registerScene]);
  const setMarqueeElementRef = useCallback((element: SVGSVGElement | null) => {
    marqueeSvgRef.current = element;
    if (!element) return;
    const visible = Boolean(marqueeSessionRef.current?.activated);
    element.style.opacity = visible ? '1' : '0';
    element.style.visibility = visible ? 'visible' : 'hidden';
  }, []);
  const setMarqueePathRef = useCallback((element: SVGPathElement | null) => {
    marqueePathRef.current = element;
    if (!element) return;
    const rect = marqueeVisualRectRef.current;
    element.setAttribute('d', rect ? getCanvasMarqueePath(rect) : '');
  }, []);
  const hideMarqueeVisual = useCallback(() => {
    const element = marqueeSvgRef.current;
    if (element) {
      element.style.opacity = '0';
      element.style.visibility = 'hidden';
    }
    marqueePathRef.current?.setAttribute('d', '');
    marqueeVisualRectRef.current = null;
    marqueeSessionRef.current = null;
    if (canvasInteractionPhaseRef.current === 'marquee') {
      updateCanvasInteractionPhase('idle');
    }
  }, [updateCanvasInteractionPhase]);
  const getRegionDraftVisualController = useCallback(() => {
    const cached = regionDraftVisualRef.current;
    if (cached?.root.isConnected) return cached;
    const root = canvasRef.current?.querySelector<HTMLElement>('[data-region-draft="true"]');
    const marker = root?.querySelector<HTMLElement>('[data-region-draft-marker="true"]');
    const box = root?.querySelector<HTMLElement>('[data-region-draft-box="true"]');
    if (!root || !marker || !box) return null;
    let markerX = 0;
    let markerY = 0;
    let boxX = 0;
    let boxY = 0;
    let boxScaleX = 1;
    let boxScaleY = 1;
    const writeMarkerTransform = () => {
      marker.style.transform = `translate3d(${markerX}px, ${markerY}px, 0)`;
    };
    const writeBoxTransform = () => {
      box.style.transform = `translate3d(${boxX}px, ${boxY}px, 0) scale(${boxScaleX}, ${boxScaleY})`;
    };
    const controller: RegionDraftVisualController = {
      root,
      setMarkerX: (value) => { markerX = value; writeMarkerTransform(); },
      setMarkerY: (value) => { markerY = value; writeMarkerTransform(); },
      setBoxX: (value) => { boxX = value; writeBoxTransform(); },
      setBoxY: (value) => { boxY = value; writeBoxTransform(); },
      setBoxScaleX: (value) => { boxScaleX = value; writeBoxTransform(); },
      setBoxScaleY: (value) => { boxScaleY = value; writeBoxTransform(); },
    };
    marker.style.opacity = '1';
    marker.style.visibility = 'visible';
    box.style.opacity = '1';
    box.style.visibility = 'visible';
    regionDraftVisualRef.current = controller;
    return controller;
  }, []);
  const handleCanvasMetricsChange = useCallback((metrics: CanvasMetrics) => {
    canvasMetricsRef.current = metrics;
    setCanvasSize((previous) => (
      previous.width === metrics.width && previous.height === metrics.height
        ? previous
        : { width: metrics.width, height: metrics.height }
    ));
  }, []);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const chatFileInputRef = useRef<HTMLInputElement>(null);
  const chatInputEditorRef = useRef<HTMLDivElement>(null);
  const chatComposerSegmentsRef = useRef<ChatComposerSegment[]>([{ type: 'text', text: '' }]);
  const chatEditorCaretAnchorRef = useRef({ textOffset: 0, referenceCount: 0 });
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const chatMessagesContentRef = useRef<HTMLDivElement>(null);
  const [isChatNearBottom, setIsChatNearBottom] = useState(true);
  const isChatNearBottomRef = useRef(true);
  const isProgrammaticChatScrollRef = useRef(false);
  const chatScrollTweenRef = useRef<gsap.core.Tween | null>(null);
  const activeSkillJobMessageIdRef = useRef<string | null>(null);
  const generateAbortRef = useRef<AbortController | null>(null);
  const isGeneratingRef = useRef(false);
  const agentReanalysisInFlightRef = useRef(false);
  isGeneratingRef.current = isGenerating;
  const canvasTextGenerateAbortControllersRef = useRef<Map<string, AbortController>>(new Map());
  const suppressCanvasTextAbortErrorItemIdsRef = useRef<Set<string>>(new Set());
  const canvasImageGenerateAbortControllersRef = useRef<Map<string, AbortController>>(new Map());
  const suppressCanvasImageAbortErrorItemIdsRef = useRef<Set<string>>(new Set());
  const processedSkillJobUrlsRef = useRef<Set<string>>(new Set());
  const processedSkillChoiceIdsRef = useRef<Set<string>>(new Set());
  const streamQueueRef = useRef('');
  const streamTickerRef = useRef<((time: number) => void) | null>(null);
  const streamTickerLastTimeRef = useRef(0);
  const streamMessageIdRef = useRef<string | null>(null);
  const pendingChatMessageUpdatesRef = useRef(new Map<string, Array<(message: ChatMessage) => ChatMessage>>());
  const pendingChatMessageUpdateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingChatMessageUpdateStartedAtRef = useRef(0);
  const chatStreamPaintSamplesRef = useRef<number[]>([]);
  const pendingAssistantMessageIdRef = useRef<string | null>(null);
  const currentSessionIdRef = useRef<string | null>(null);
  const scheduleCurrentSessionSaveRef = useRef<() => void>(() => {});
  const canvasHistoryBySessionRef = useRef<Record<string, SessionCanvasHistoryState>>({});
  const pendingCanvasHistorySnapshotRef = useRef<CanvasUndoSnapshot | null>(null);
  const suppressNextItemClickRef = useRef<string | null>(null);
  const suppressNextItemClickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestChatInputRef = useRef('');
  const lastSyncedChatInputRevisionRef = useRef(chatInputSyncRevision);
  const isChatInputComposingRef = useRef(false);
  const pendingChatEditorSyncRef = useRef(false);
  const pendingChatEditorMoveCaretToEndRef = useRef(false);
  const pendingProgrammaticChatInputRef = useRef<string | null>(null);
  const setChatInput = useCallback((value: string) => {
    latestChatInputRef.current = value;
    if (isChatInputComposingRef.current) {
      pendingProgrammaticChatInputRef.current = value;
      pendingChatEditorSyncRef.current = true;
    }
    setChatInputSyncRevision((revision) => revision + 1);
  }, []);
  const chatInputPerformanceSamplesRef = useRef<number[]>([]);
  const chatComposerPlaceholderRef = useRef<HTMLSpanElement | null>(null);
  const chatSendButtonRef = useRef<HTMLButtonElement | null>(null);
  const isHydratingSessionRef = useRef(false);
  const imageToolbarNoticeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const modelSelectionNoticeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (streamTickerRef.current) {
      gsap.ticker.remove(streamTickerRef.current);
      streamTickerRef.current = null;
    }
    if (pendingChatMessageUpdateTimerRef.current) {
      clearTimeout(pendingChatMessageUpdateTimerRef.current);
      pendingChatMessageUpdateTimerRef.current = null;
    }
    pendingChatMessageUpdatesRef.current.clear();
  }, []);

  const updateChatNearBottomState = useCallback(() => {
    const container = chatContainerRef.current;
    if (!container) return true;
    const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
    const nextIsNearBottom = distanceFromBottom <= 56;
    if (isChatNearBottomRef.current !== nextIsNearBottom) {
      isChatNearBottomRef.current = nextIsNearBottom;
      setIsChatNearBottom(nextIsNearBottom);
    }
    return nextIsNearBottom;
  }, []);

  const scrollChatToBottom = React.useMemo(() => workspaceContextSafe((behavior?: ScrollBehavior) => {
    const container = chatContainerRef.current;
    if (!container) return;
    const resolvedBehavior = behavior || (reducedMotionRef.current ? 'auto' : 'smooth');
    isChatNearBottomRef.current = true;
    setIsChatNearBottom(true);
    chatScrollTweenRef.current?.kill();
    chatScrollTweenRef.current = null;
    isProgrammaticChatScrollRef.current = resolvedBehavior === 'smooth';
    if (resolvedBehavior === 'smooth') {
      chatScrollTweenRef.current = gsap.to(container, {
        scrollTo: { y: 'max' },
        duration: 0.36,
        ease: 'power2.out',
        overwrite: 'auto',
        onComplete: () => {
          chatScrollTweenRef.current = null;
          isProgrammaticChatScrollRef.current = false;
          updateChatNearBottomState();
        },
        onInterrupt: () => {
          chatScrollTweenRef.current = null;
          isProgrammaticChatScrollRef.current = false;
        },
      });
    } else {
      gsap.set(container, { scrollTo: { y: 'max' } });
      isProgrammaticChatScrollRef.current = false;
      updateChatNearBottomState();
    }
  }), [updateChatNearBottomState, workspaceContextSafe]);

  const handleChatContainerScroll = useCallback(() => {
    if (isProgrammaticChatScrollRef.current) return;
    updateChatNearBottomState();
  }, [updateChatNearBottomState]);

  const cancelProgrammaticChatScroll = useCallback(() => {
    chatScrollTweenRef.current?.kill();
    chatScrollTweenRef.current = null;
    if (!isProgrammaticChatScrollRef.current) return;
    isProgrammaticChatScrollRef.current = false;
    gsap.ticker.add(function syncChatScrollState() {
      gsap.ticker.remove(syncChatScrollState);
      updateChatNearBottomState();
    });
  }, [updateChatNearBottomState]);

  useEffect(() => () => {
    chatScrollTweenRef.current?.kill();
  }, []);
  const canvasClipboardRef = useRef<{
    snapshot: CanvasClipboardSnapshot | null;
    pasteCount: number;
  }>({
    snapshot: null,
    pasteCount: 0,
  });
  const persistedGeneratedImageHistoryBySessionRef = useRef<Record<string, GeneratedImageHistoryEntry[]>>({});
  const assistantTextSelectionRef = useRef<AssistantTextSelectionSession>({
    startedInAssistant: false,
    isPointerDown: false,
    hasSelection: false,
    suppressOutsideClickUntil: 0,
  });
  const [pendingSkillChoice, setPendingSkillChoice] = useState<SkillChoicePayload | null>(null);
  const [showSkillChoiceModal, setShowSkillChoiceModal] = useState(false);
  const [pendingAgentProposal, setPendingAgentProposal] = useState<AgentProposal | null>(null);
  const [showAgentProposalModal, setShowAgentProposalModal] = useState(false);
  const [pendingAgentConfirmation, setPendingAgentConfirmation] = useState<AgentConfirmationPayload | null>(null);
  const [showAgentConfirmationModal, setShowAgentConfirmationModal] = useState(false);
  const [pendingAgentClarification, setPendingAgentClarification] = useState<AgentClarificationPayload | null>(null);
  const [showAgentClarificationModal, setShowAgentClarificationModal] = useState(false);
  const [agentClarificationCustomText, setAgentClarificationCustomText] = useState('');
  const [chatInputFocused, setChatInputFocused] = useState(false);
  const chatInputHeightRef = useRef(72);
  const [copiedAssistantMessageId, setCopiedAssistantMessageId] = useState<string | null>(null);
  const [editingTextCardId, setEditingTextCardId] = useState<string | null>(null);
  const [textCardPanelDrafts, setTextCardPanelDraftsState] = useState<Record<string, string>>({});
  const [textCardProviderById, setTextCardProviderByIdState] = useState<Record<string, string>>({});
  const [textCardModelById, setTextCardModelByIdState] = useState<Record<string, string>>({});
  const [imageCardPanelDrafts, setImageCardPanelDraftsState] = useState<Record<string, string>>({});
  const [imageCardProviderById, setImageCardProviderByIdState] = useState<Record<string, string>>({});
  const [imageCardModelById, setImageCardModelByIdState] = useState<Record<string, string>>({});
  const [imageCardSizeById, setImageCardSizeByIdState] = useState<Record<string, string>>({});
  const [imageCardQualityById, setImageCardQualityByIdState] = useState<Record<string, string>>({});
  const [imageCardCountById, setImageCardCountByIdState] = useState<Record<string, number>>({});
  const [imageCardAspectRatioById, setImageCardAspectRatioByIdState] = useState<Record<string, string>>({});
  const [showTextPanelProviderMenu, setShowTextPanelProviderMenu] = useState(false);
  const [showTextPanelModelMenu, setShowTextPanelModelMenu] = useState(false);
  const [showImageCardProviderMenu, setShowImageCardProviderMenu] = useState(false);
  const [showImageCardModelMenu, setShowImageCardModelMenu] = useState(false);
  const [showImageCardSettingsMenu, setShowImageCardSettingsMenu] = useState(false);
  const editingTextCardTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const textPanelProviderMenuRef = useRef<HTMLDivElement>(null);
  const textPanelProviderPopoverRef = useRef<HTMLDivElement | null>(null);
  const textPanelModelPopoverRef = useRef<HTMLDivElement | null>(null);
  const imageCardProviderMenuRef = useRef<HTMLDivElement | null>(null);
  const imageCardProviderPopoverRef = useRef<HTMLDivElement | null>(null);
  const imageCardModelMenuRef = useRef<HTMLDivElement | null>(null);
  const imageCardModelPopoverRef = useRef<HTMLDivElement | null>(null);
  const imageCardSettingsMenuRef = useRef<HTMLDivElement | null>(null);
  const imageCardSettingsPopoverRef = useRef<HTMLDivElement | null>(null);
  const providerSettingsLoadRequestIdRef = useRef(0);
  const sessionLiveStateRef = useRef<SessionLiveState>({
    items,
    connections,
    textCardPanelDrafts,
    textCardProviderById,
    textCardModelById,
    imageCardPanelDrafts,
    imageCardProviderById,
    imageCardModelById,
    imageCardSizeById,
    imageCardQualityById,
    imageCardCountById,
    imageCardAspectRatioById,
    chatMessages,
    activeSkill,
    chatProviderId,
    chatModelId,
    imageProviderId,
    imageModelId,
    generatedImageHistoryBySession,
    viewport,
    regionSelections,
  });
  const syncSessionLiveState = useCallback((patch: Partial<SessionLiveState>) => {
    if (Object.prototype.hasOwnProperty.call(patch, 'items')) {
      itemsRef.current = patch.items ?? [];
      itemByIdRef.current = new Map((patch.items ?? []).map((item) => [item.id, item]));
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'viewport')) {
      viewportRef.current = patch.viewport ?? { x: 0, y: 0, scale: 1 };
      visualViewportRef.current = viewportRef.current;
    }

    sessionLiveStateRef.current = {
      ...sessionLiveStateRef.current,
      ...patch,
    };
  }, []);
  const applySessionLiveStateUpdate = useCallback(
    <K extends keyof SessionLiveState>(
      key: K,
      value: React.SetStateAction<SessionLiveState[K]>,
      stateSetter: React.Dispatch<React.SetStateAction<SessionLiveState[K]>>
    ) => {
      const nextValue = resolveStateUpdate(value, sessionLiveStateRef.current[key]);
      syncSessionLiveState({ [key]: nextValue } as Pick<SessionLiveState, K>);
      stateSetter(nextValue);
      return nextValue;
    },
    [syncSessionLiveState]
  );
  const isCanvasCommitBlocked = useCallback(() => Boolean(
    hasActivePointerSession() ||
    isPanningRef.current ||
    isDraggingRef.current ||
    viewportTweenRef.current ||
    cornerResizePreviewRef.current ||
    marqueeSessionRef.current ||
    connectionSessionRef.current
  ), [hasActivePointerSession]);
  const applyPendingCanvasCommit = useCallback((commit: PendingCanvasCommit, reason: string) => {
    const commitDuringInteraction = isCanvasCommitBlocked();
    if (commitDuringInteraction) canvasCommitDuringInteractionCountRef.current += 1;
    pendingCanvasCommitLayoutMeasureRef.current = {
      revision: commit.revision,
      reason,
      startedAt: performance.now(),
      commitDuringInteraction,
      commitDuringInteractionCount: canvasCommitDuringInteractionCountRef.current,
    };
    const commitReactSnapshot = () => {
      if (commit.items) setItemsState(commit.items);
      if (commit.connections) setConnectionsState(commit.connections);
      if (commit.selectedIds) {
        selectedIdsRef.current = commit.selectedIds;
        setSelectedIds(commit.selectedIds);
      }
      if (Object.prototype.hasOwnProperty.call(commit, 'selectedId')) {
        selectedIdRef.current = commit.selectedId ?? null;
        setSelectedId(commit.selectedId ?? null);
      }
      if (commit.selectedConnectionIds) {
        selectedConnectionIdsRef.current = commit.selectedConnectionIds;
        setSelectedConnectionIds(commit.selectedConnectionIds);
      }
      if (commit.viewport) {
        setViewportState(commit.viewport);
        panReactViewportCommitCountRef.current += 1;
      }
    };
    if (reason === 'snapshot-idle') React.startTransition(commitReactSnapshot);
    else commitReactSnapshot();
    if (commit.saveSession && currentSessionIdRef.current) {
      scheduleCurrentSessionSaveRef.current();
    }
  }, [isCanvasCommitBlocked]);
  const cancelPendingCanvasCommitSchedule = useCallback(() => {
    if (pendingCanvasCommitTimerRef.current !== null) {
      clearTimeout(pendingCanvasCommitTimerRef.current);
      pendingCanvasCommitTimerRef.current = null;
    }
    if (pendingCanvasCommitIdleRef.current !== null) {
      if (
        pendingCanvasCommitIdleKindRef.current === 'idle' &&
        typeof window.cancelIdleCallback === 'function'
      ) {
        window.cancelIdleCallback(pendingCanvasCommitIdleRef.current);
      } else {
        cancelAnimationFrame(pendingCanvasCommitIdleRef.current);
      }
      pendingCanvasCommitIdleRef.current = null;
      pendingCanvasCommitIdleKindRef.current = null;
    }
  }, []);
  const flushPendingCanvasCommit = useCallback((reason = 'manual') => {
    cancelPendingCanvasCommitSchedule();
    const commit = pendingCanvasCommitRef.current;
    if (!commit) return null;
    pendingCanvasCommitRef.current = null;
    applyPendingCanvasCommit(commit, reason);
    return commit;
  }, [applyPendingCanvasCommit, cancelPendingCanvasCommitSchedule]);
  const schedulePendingCanvasCommit = useCallback(() => {
    if (!pendingCanvasCommitRef.current) return;
    if (
      pendingCanvasCommitTimerRef.current !== null ||
      pendingCanvasCommitIdleRef.current !== null
    ) return;
    const flushWhenIdle = () => {
      pendingCanvasCommitTimerRef.current = null;
      const pendingCommit = pendingCanvasCommitRef.current;
      if (!pendingCommit) return;
      const remainingDelay = pendingCommit.deadlineAt - performance.now();
      const interactionBlocked = isCanvasCommitBlocked() || hasPendingBrowserInput();
      if (remainingDelay > 0 || interactionBlocked) {
        pendingCanvasCommitTimerRef.current = setTimeout(
          flushWhenIdle,
          interactionBlocked ? 64 : Math.max(16, remainingDelay)
        );
        return;
      }
      const queueIdleCommitFrame = () => {
        const runIdleCommitFrame = () => {
          pendingCanvasCommitIdleRef.current = null;
          pendingCanvasCommitIdleKindRef.current = null;
          const latestCommit = pendingCanvasCommitRef.current;
          if (!latestCommit) return;
          const latestRemainingDelay = latestCommit.deadlineAt - performance.now();
          if (
            latestRemainingDelay > 0 ||
            isCanvasCommitBlocked() ||
            hasPendingBrowserInput()
          ) {
            schedulePendingCanvasCommit();
            return;
          }
          flushPendingCanvasCommit('snapshot-idle');
        };
        pendingCanvasCommitIdleKindRef.current = 'frame';
        pendingCanvasCommitIdleRef.current = requestAnimationFrame(runIdleCommitFrame);
      };
      const runIdleCommit = () => {
        pendingCanvasCommitIdleRef.current = null;
        pendingCanvasCommitIdleKindRef.current = null;
        const latestCommit = pendingCanvasCommitRef.current;
        if (!latestCommit) return;
        const latestRemainingDelay = latestCommit.deadlineAt - performance.now();
        if (
          latestRemainingDelay > 0 ||
          isCanvasCommitBlocked() ||
          hasPendingBrowserInput()
        ) {
          schedulePendingCanvasCommit();
          return;
        }
        queueIdleCommitFrame();
      };
      if (typeof window.requestIdleCallback === 'function') {
        pendingCanvasCommitIdleKindRef.current = 'idle';
        pendingCanvasCommitIdleRef.current = window.requestIdleCallback(runIdleCommit, {
          timeout: 300,
        });
      } else {
        queueIdleCommitFrame();
      }
    };
    const initialDelay = Math.max(
      16,
      pendingCanvasCommitRef.current.deadlineAt - performance.now()
    );
    pendingCanvasCommitTimerRef.current = setTimeout(flushWhenIdle, initialDelay);
  }, [flushPendingCanvasCommit, isCanvasCommitBlocked]);
  const interruptCanvasCommitForInteraction = useCallback((kind: string) => {
    cancelPendingCanvasSelectionFinalizeRef.current();
    cancelPendingCanvasCommitSchedule();
    if (pendingCanvasCommitRef.current && canvasPerformanceEnabledRef.current) {
      pendingCanvasNextInputMeasureRef.current = {
        kind,
        startedAt: performance.now(),
      };
    }
  }, [cancelPendingCanvasCommitSchedule]);
  const stageCanvasCommit = useCallback((patch: Partial<PendingCanvasCommit>) => {
    const revision = pendingCanvasCommitRevisionRef.current + 1;
    pendingCanvasCommitRevisionRef.current = revision;
    const stagedAt = performance.now();
    const accumulator = pendingCanvasCommitRef.current ?? {
      revision,
      stagedAt,
      deadlineAt: stagedAt + CANVAS_SNAPSHOT_COMMIT_IDLE_MS,
    };
    accumulator.revision = revision;
    accumulator.stagedAt = stagedAt;
    accumulator.deadlineAt = stagedAt + CANVAS_SNAPSHOT_COMMIT_IDLE_MS;
    if (patch.items !== undefined) accumulator.items = patch.items;
    if (patch.viewport !== undefined) accumulator.viewport = patch.viewport;
    if (patch.connections !== undefined) accumulator.connections = patch.connections;
    if (Object.prototype.hasOwnProperty.call(patch, 'selectedId')) {
      accumulator.selectedId = patch.selectedId;
    }
    if (patch.selectedIds !== undefined) accumulator.selectedIds = patch.selectedIds;
    if (patch.selectedConnectionIds !== undefined) {
      accumulator.selectedConnectionIds = patch.selectedConnectionIds;
    }
    if (patch.saveSession !== undefined) accumulator.saveSession = patch.saveSession;
    if (patch.viewportToken !== undefined) accumulator.viewportToken = patch.viewportToken;
    pendingCanvasCommitRef.current = accumulator;
    schedulePendingCanvasCommit();
    return revision;
  }, [schedulePendingCanvasCommit]);
  const markCanvasInteractionVisualFrame = useCallback((kind: string) => {
    const pending = pendingCanvasNextInputMeasureRef.current;
    if (!pending) return;
    pendingCanvasNextInputMeasureRef.current = null;
    console.info('[canvas-sequence-perf]', {
      previousCommitInterruptedBy: pending.kind,
      visualKind: kind,
      nextInputToFirstVisual: performance.now() - pending.startedAt,
      activeTickerCount: Number(Boolean(viewportTweenRef.current)),
    });
  }, []);
  const resetPendingCanvasInteractionCommits = useCallback(() => {
    cancelInteraction('replaced');
    restoreCanvasSelectionGestureRef.current();
    cancelPendingCanvasCommitSchedule();
    pendingCanvasCommitRef.current = null;
    clearCanvasItemDragPreviewRef.current(true);
    clearConnectionInteractionStateRef.current();
    panMotionRef.current = null;
    pendingViewportIdleCommitTokenRef.current = null;
    panReactViewportCommitCountRef.current = 0;
    viewportTweenRef.current?.cancel();
    viewportTweenRef.current = null;
    const sceneTarget = getSceneTarget();
    const activeViewport = visualViewportRef.current;
    sceneTarget?.setViewportTransform(activeViewport.x, activeViewport.y, activeViewport.scale);
    panOverlayStateActiveRef.current = false;
    canvasItemDragPresentationRef.current.clear();
    activeItemDragTokenRef.current = null;
    canvasItemDragTransactionRef.current = null;
    setCanvasConnectionHitTestingDisabled(false);
    updateCanvasInteractionPhase('idle');
  }, [cancelInteraction, cancelPendingCanvasCommitSchedule, getSceneTarget, setCanvasConnectionHitTestingDisabled, updateCanvasInteractionPhase]);
  const setItems = useCallback(
    (value: React.SetStateAction<CanvasItem[]>) => {
      const nextValue = resolveStateUpdate(value, sessionLiveStateRef.current.items);
      syncSessionLiveState({ items: nextValue });
      stageCanvasCommit({ items: nextValue });
      if (!isCanvasCommitBlocked()) flushPendingCanvasCommit('direct-items');
      return nextValue;
    },
    [flushPendingCanvasCommit, isCanvasCommitBlocked, stageCanvasCommit, syncSessionLiveState]
  );
  const setRegionSelections = useCallback(
    (value: React.SetStateAction<RegionSelection[]>) => {
      const nextValue = applySessionLiveStateUpdate('regionSelections', value, setRegionSelectionsState);
      regionSelectionsRef.current = nextValue;
      return nextValue;
    },
    [applySessionLiveStateUpdate]
  );
  const setConnections = useCallback(
    (value: React.SetStateAction<Connection[]>) => {
      const nextValue = resolveStateUpdate(value, sessionLiveStateRef.current.connections);
      syncSessionLiveState({ connections: nextValue });
      stageCanvasCommit({ connections: nextValue });
      if (!isCanvasCommitBlocked()) flushPendingCanvasCommit('direct-connections');
      return nextValue;
    },
    [flushPendingCanvasCommit, isCanvasCommitBlocked, stageCanvasCommit, syncSessionLiveState]
  );
  const setTextCardPanelDrafts = useCallback(
    (value: React.SetStateAction<Record<string, string>>) =>
      applySessionLiveStateUpdate('textCardPanelDrafts', value, setTextCardPanelDraftsState),
    [applySessionLiveStateUpdate]
  );
  const setTextCardProviderById = useCallback(
    (value: React.SetStateAction<Record<string, string>>) =>
      applySessionLiveStateUpdate('textCardProviderById', value, setTextCardProviderByIdState),
    [applySessionLiveStateUpdate]
  );
  const setTextCardModelById = useCallback(
    (value: React.SetStateAction<Record<string, string>>) =>
      applySessionLiveStateUpdate('textCardModelById', value, setTextCardModelByIdState),
    [applySessionLiveStateUpdate]
  );
  const setImageCardPanelDrafts = useCallback(
    (value: React.SetStateAction<Record<string, string>>) =>
      applySessionLiveStateUpdate('imageCardPanelDrafts', value, setImageCardPanelDraftsState),
    [applySessionLiveStateUpdate]
  );
  const setImageCardProviderById = useCallback(
    (value: React.SetStateAction<Record<string, string>>) =>
      applySessionLiveStateUpdate('imageCardProviderById', value, setImageCardProviderByIdState),
    [applySessionLiveStateUpdate]
  );
  const setImageCardModelById = useCallback(
    (value: React.SetStateAction<Record<string, string>>) =>
      applySessionLiveStateUpdate('imageCardModelById', value, setImageCardModelByIdState),
    [applySessionLiveStateUpdate]
  );
  const setImageCardSizeById = useCallback(
    (value: React.SetStateAction<Record<string, string>>) =>
      applySessionLiveStateUpdate('imageCardSizeById', value, setImageCardSizeByIdState),
    [applySessionLiveStateUpdate]
  );
  const setImageCardQualityById = useCallback(
    (value: React.SetStateAction<Record<string, string>>) =>
      applySessionLiveStateUpdate('imageCardQualityById', value, setImageCardQualityByIdState),
    [applySessionLiveStateUpdate]
  );
  const setImageCardCountById = useCallback(
    (value: React.SetStateAction<Record<string, number>>) =>
      applySessionLiveStateUpdate('imageCardCountById', value, setImageCardCountByIdState),
    [applySessionLiveStateUpdate]
  );
  const setImageCardAspectRatioById = useCallback(
    (value: React.SetStateAction<Record<string, string>>) =>
      applySessionLiveStateUpdate('imageCardAspectRatioById', value, setImageCardAspectRatioByIdState),
    [applySessionLiveStateUpdate]
  );
  const setChatMessages = useCallback(
    (value: React.SetStateAction<ChatMessage[]>) =>
      applySessionLiveStateUpdate('chatMessages', value, setChatMessagesState),
    [applySessionLiveStateUpdate]
  );
  const setActiveSkill = useCallback(
    (value: React.SetStateAction<{ id: string; label: string } | null>) =>
      applySessionLiveStateUpdate('activeSkill', value, setActiveSkillState),
    [applySessionLiveStateUpdate]
  );
  const setChatProviderId = useCallback(
    (value: React.SetStateAction<string>) =>
      applySessionLiveStateUpdate('chatProviderId', value, setChatProviderIdState),
    [applySessionLiveStateUpdate]
  );
  const setChatModelId = useCallback(
    (value: React.SetStateAction<string>) =>
      applySessionLiveStateUpdate('chatModelId', value, setChatModelIdState),
    [applySessionLiveStateUpdate]
  );
  const setImageProviderId = useCallback(
    (value: React.SetStateAction<string>) =>
      applySessionLiveStateUpdate('imageProviderId', value, setImageProviderIdState),
    [applySessionLiveStateUpdate]
  );
  const setImageModelId = useCallback(
    (value: React.SetStateAction<string>) =>
      applySessionLiveStateUpdate('imageModelId', value, setImageModelIdState),
    [applySessionLiveStateUpdate]
  );
  const showModelSelectionNoticeWithTimeout = useCallback((message: string) => {
    setModelSelectionNotice(message);
    if (modelSelectionNoticeTimeoutRef.current) {
      clearTimeout(modelSelectionNoticeTimeoutRef.current);
    }
    modelSelectionNoticeTimeoutRef.current = setTimeout(() => {
      setModelSelectionNotice(null);
      modelSelectionNoticeTimeoutRef.current = null;
    }, 3200);
  }, []);
  const setGeneratedImageHistoryBySession = useCallback(
    (value: React.SetStateAction<Record<string, GeneratedImageHistoryEntry[]>>) =>
      applySessionLiveStateUpdate(
        'generatedImageHistoryBySession',
        value,
        setGeneratedImageHistoryBySessionState
      ),
    [applySessionLiveStateUpdate]
  );
  const setViewport = useCallback(
    (value: React.SetStateAction<{ x: number; y: number; scale: number }>) => {
      cancelPendingCanvasCommitSchedule();
      const nextValue = resolveStateUpdate(value, sessionLiveStateRef.current.viewport);
      syncSessionLiveState({ viewport: nextValue });
      stageCanvasCommit({
        viewport: nextValue,
        viewportToken: interactionCommitTokenRef.current,
      });
      if (!isCanvasCommitBlocked()) flushPendingCanvasCommit('direct-viewport');
      return nextValue;
    },
    [cancelPendingCanvasCommitSchedule, flushPendingCanvasCommit, isCanvasCommitBlocked, stageCanvasCommit, syncSessionLiveState]
  );
  const canvasItemMembershipKey = React.useMemo(
    () => items.map((item) => item.id).join('\u0000'),
    [items]
  );
  const imageCardMembershipKey = React.useMemo(
    () => items.filter((item) => isImageCardItem(item)).map((item) => item.id).join('\u0000'),
    [items]
  );
  const multiSelectionBounds = React.useMemo(() => {
    if (selectedIds.length <= 1) return null;
    const selectedItems = items.filter((item) => selectedIds.includes(item.id));
    return selectedItems.length <= 1 ? null : getCanvasItemsVisualBounds(selectedItems);
  }, [items, selectedIds]);
  const selectedCanvasAnnotationContext = React.useMemo(
    () => buildSelectedCanvasAnnotationContext(items, selectedIds),
    [items, selectedIds]
  );
  const canvasSelectionReferenceTokens = React.useMemo<ChatReferenceToken[]>(() => {
    const selectedItems = items.filter((item) => selectedIds.includes(item.id));
    const imageItems = selectedItems.filter(
      (item) => item.type === 'image' && typeof item.src === 'string' && item.src.length > 0
    );
    const annotations = selectedItems.filter(isCanvasAnnotationItem);
    const dismissedIds = dismissedCanvasReferenceIdsRef.current;

    if (imageItems.length === 1 && annotations.length > 0) {
      const imageItem = imageItems[0];
      if (dismissedIds.has(imageItem.id)) return [];
      return [{
        id: `canvas-reference:${imageItem.id}`,
        src: imageItem.src!,
        label: getReferenceTokenLabel(imageItem.src!, '画布图片'),
        source: 'canvas',
        canvasItemId: imageItem.id,
        transient: true,
        pinned: false,
        role: 'annotation_bundle',
        annotationCount: annotations.length,
        annotationItemIds: annotations.map((item) => item.id),
      }];
    }

    return imageItems
      .filter((item) => !dismissedIds.has(item.id))
      .map((item) => ({
        id: `canvas-reference:${item.id}`,
        src: item.src!,
        label: getReferenceTokenLabel(item.src!, '画布图片'),
        source: 'canvas' as const,
        canvasItemId: item.id,
        transient: true,
        pinned: false,
        role: 'reference' as const,
      }));
  }, [items, selectedIds]);

  const resolvedChatReferenceTokens = React.useMemo(() => {
    const occupiedKeys = new Set(
      chatReferenceTokens.map((token) => token.canvasItemId ? `canvas:${token.canvasItemId}` : `src:${token.src}`)
    );
    const transientTokens = canvasSelectionReferenceTokens.filter((token) => {
      const key = token.canvasItemId ? `canvas:${token.canvasItemId}` : `src:${token.src}`;
      if (occupiedKeys.has(key)) return false;
      occupiedKeys.add(key);
      return true;
    });
    return [...chatReferenceTokens, ...transientTokens].slice(0, 14);
  }, [canvasSelectionReferenceTokens, chatReferenceTokens]);
  const chatReferenceImages = React.useMemo(
    () => resolvedChatReferenceTokens
      .filter((token) => !token.uploadStatus)
      .map((token) => token.src),
    [resolvedChatReferenceTokens]
  );
  const hasPendingChatReferenceUploads = React.useMemo(
    () => resolvedChatReferenceTokens.some((token) => Boolean(token.uploadStatus)),
    [resolvedChatReferenceTokens]
  );
  const syncChatComposerControls = useCallback((value: string) => {
    const hasText = value.trim().length > 0;
    if (chatComposerPlaceholderRef.current) {
      chatComposerPlaceholderRef.current.hidden = (
        hasText
        || Boolean(activeSkill)
        || resolvedChatReferenceTokens.length > 0
        || chatInputFocused
      );
    }
    if (chatSendButtonRef.current) {
      chatSendButtonRef.current.disabled = (
        !isGeneratingRef.current
        && (!hasText || hasPendingChatReferenceUploads)
      );
    }
  }, [activeSkill, chatInputFocused, hasPendingChatReferenceUploads, resolvedChatReferenceTokens.length]);
  const chatReferenceTokenCount = resolvedChatReferenceTokens.length;

  useEffect(() => {
    syncChatComposerControls(latestChatInputRef.current);
  }, [isGenerating, syncChatComposerControls]);
  const activeRegionSelection = activeRegionMenuId
    ? (() => {
        const region = regionSelections.find((candidate) => candidate.id === activeRegionMenuId) || null;
        if (!region || region.customLabel || region.candidates.length > 0 || region.status === 'failed') {
          return region;
        }
        const regionToken = chatReferenceTokens.find((token) => token.regionId === region.id);
        const tokenLabel = regionToken?.label?.trim();
        return tokenLabel && tokenLabel !== '未识别对象'
          ? { ...region, customLabel: tokenLabel }
          : region;
      })()
    : null;

  useEffect(() => {
    if (tool !== 'target') setRegionRefineId(null);
  }, [tool]);

  useEffect(() => {
    const selectedIdSet = new Set(selectedIds);
    for (const dismissedId of dismissedCanvasReferenceIdsRef.current) {
      if (!selectedIdSet.has(dismissedId)) {
        dismissedCanvasReferenceIdsRef.current.delete(dismissedId);
      }
    }
  }, [selectedIds]);
  const itemById = React.useMemo(
    () => Object.fromEntries(items.map((item) => [item.id, item] as const)),
    [items]
  );
  const connectionsByItemId = React.useMemo(() => {
    const index = new Map<string, Connection[]>();
    connections.forEach((connection) => {
      const fromConnections = index.get(connection.fromItemId) ?? [];
      fromConnections.push(connection);
      index.set(connection.fromItemId, fromConnections);
      if (connection.toItemId !== connection.fromItemId) {
        const toConnections = index.get(connection.toItemId) ?? [];
        toConnections.push(connection);
        index.set(connection.toItemId, toConnections);
      }
    });
    return index;
  }, [connections]);
  useEffect(() => {
    if (!isDraggingRef.current) return;
    if (draggingItemIdsRef.current.some((itemId) => !itemById[itemId])) {
      cancelInteraction('replaced');
    }
  }, [cancelInteraction, itemById]);
  const selectedTextCardPanelItem = React.useMemo(() => {
    if (selectedIds.length !== 1 || !selectedId) return null;
    const item = itemById[selectedId];
    return item?.type === 'text' && item.textVariant === 'card' && item.textMode !== 'manual' ? item : null;
  }, [itemById, selectedId, selectedIds]);
  const selectedImageCardPanelItem = React.useMemo(() => {
    if (selectedIds.length !== 1 || !selectedId) return null;
    const item = itemById[selectedId];
    return isImageCardItem(item) ? item : null;
  }, [itemById, selectedId, selectedIds]);
  const selectedImageAssetItem = React.useMemo(() => {
    if (selectedIds.length !== 1 || !selectedId) return null;
    const item = itemById[selectedId];
    return isImageAssetItem(item) ? item : null;
  }, [itemById, selectedId, selectedIds]);
  const selectedImageToolbarTarget = React.useMemo<{ itemId: string; src: string; kind: 'asset' | 'card' } | null>(
    () =>
      getSelectedImageToolbarSource({
        selectedId,
        selectedIds,
        itemById,
      }) as { itemId: string; src: string; kind: 'asset' | 'card' } | null,
    [itemById, selectedId, selectedIds]
  );
  const selectedTextCardPanelLinkedImagePreviews = React.useMemo(
    () =>
      getDirectImagePreviewsForTextCard({
        textCardId: selectedTextCardPanelItem?.id ?? '',
        items,
        connections,
      }),
    [connections, items, selectedTextCardPanelItem?.id]
  );
  const selectedTextCardPanelLinkedTexts = React.useMemo(
    () =>
      getDirectTextInputsForTextCard({
        textCardId: selectedTextCardPanelItem?.id ?? '',
        items,
        connections,
      }),
    [connections, items, selectedTextCardPanelItem?.id]
  );
  const selectedTextCardPanelInput = selectedTextCardPanelItem
    ? textCardPanelDrafts[selectedTextCardPanelItem.id] ?? ''
    : '';
  const selectedImageCardPanelLinkedImagePreviews = React.useMemo(
    () =>
      getDirectImagePreviewsForTextCard({
        textCardId: selectedImageCardPanelItem?.id ?? '',
        items,
        connections,
      }),
    [connections, items, selectedImageCardPanelItem?.id]
  );
  const selectedImageCardPanelLinkedTexts = React.useMemo(
    () =>
      getDirectTextInputsForTextCard({
        textCardId: selectedImageCardPanelItem?.id ?? '',
        items,
        connections,
      }),
    [connections, items, selectedImageCardPanelItem?.id]
  );
  const selectedImageCardPanelInput = selectedImageCardPanelItem
    ? imageCardPanelDrafts[selectedImageCardPanelItem.id] ?? ''
    : '';
  const enabledProviderSettingsProviders = providerSettingsProviders.filter((provider) => provider.enabled !== false);
  const selectableTextProviders = React.useMemo(
    () => enabledProviderSettingsProviders.filter((provider) => provider.chatModels.length > 0),
    [enabledProviderSettingsProviders]
  );
  const selectableImageProviders = React.useMemo(
    () => enabledProviderSettingsProviders.filter((provider) => provider.imageModels.length > 0),
    [enabledProviderSettingsProviders]
  );
  const resolvedChatSelection = React.useMemo(
    () => resolveProviderModelSelection({
      providers: providerSettingsProviders,
      purpose: 'chat',
      requestedProviderId: chatProviderId,
      requestedModel: chatModelId,
    }),
    [chatModelId, chatProviderId, providerSettingsProviders]
  );
  const resolvedImageSelection = React.useMemo(
    () => resolveProviderModelSelection({
      providers: providerSettingsProviders,
      purpose: 'image',
      requestedProviderId: imageProviderId,
      requestedModel: imageModelId,
    }),
    [imageModelId, imageProviderId, providerSettingsProviders]
  );

  useEffect(() => {
    if (!providerSettingsLoaded || !resolvedChatSelection.providerId || !resolvedChatSelection.model) return;
    if (resolvedChatSelection.providerId === chatProviderId && resolvedChatSelection.model === chatModelId) return;
    const hadSavedSelection = Boolean(chatProviderId || chatModelId);
    setChatProviderId(resolvedChatSelection.providerId);
    setChatModelId(resolvedChatSelection.model);
    if (hadSavedSelection) {
      showModelSelectionNoticeWithTimeout(`对话模型已切换为 ${resolvedChatSelection.model}`);
    }
  }, [chatModelId, chatProviderId, providerSettingsLoaded, resolvedChatSelection, setChatModelId, setChatProviderId, showModelSelectionNoticeWithTimeout]);

  useEffect(() => {
    if (!providerSettingsLoaded || !resolvedImageSelection.providerId || !resolvedImageSelection.model) return;
    if (resolvedImageSelection.providerId === imageProviderId && resolvedImageSelection.model === imageModelId) return;
    const hadSavedSelection = Boolean(imageProviderId || imageModelId);
    setImageProviderId(resolvedImageSelection.providerId);
    setImageModelId(resolvedImageSelection.model);
    if (hadSavedSelection) {
      showModelSelectionNoticeWithTimeout(`生图模型已切换为 ${resolvedImageSelection.model}`);
    }
  }, [imageModelId, imageProviderId, providerSettingsLoaded, resolvedImageSelection, setImageModelId, setImageProviderId, showModelSelectionNoticeWithTimeout]);
  const workspaceImageModelOptions = React.useMemo(
    () => createWorkspaceModelOptions(enabledProviderSettingsProviders, 'image', IMAGE_CARD_MODEL_OPTIONS, getProviderSettingsProviderLabel),
    [enabledProviderSettingsProviders]
  );
  const workspaceTextModelOptions = React.useMemo(
    () => createWorkspaceModelOptions(enabledProviderSettingsProviders, 'chat', TEXT_PANEL_MODEL_OPTIONS, getProviderSettingsProviderLabel),
    [enabledProviderSettingsProviders]
  );
  const defaultWorkspaceImageModelOption =
    workspaceImageModelOptions[0] ||
    createWorkspaceModelOptions([], 'image', IMAGE_CARD_MODEL_OPTIONS, getProviderSettingsProviderLabel)[0];
  const defaultWorkspaceTextModelOption =
    workspaceTextModelOptions[0] ||
    createWorkspaceModelOptions([], 'chat', TEXT_PANEL_MODEL_OPTIONS, getProviderSettingsProviderLabel)[0];
  const selectedTextCardProviderId = selectedTextCardPanelItem
    ? (
        selectableTextProviders.find((provider) => provider.id === textCardProviderById[selectedTextCardPanelItem.id])?.id ||
        selectableTextProviders[0]?.id ||
        textCardProviderById[selectedTextCardPanelItem.id] ||
        defaultWorkspaceTextModelOption.providerId
      )
    : defaultWorkspaceTextModelOption.providerId;
  const selectedTextCardProviderLabel =
    selectableTextProviders.find((provider) => provider.id === selectedTextCardProviderId)?.name ||
    getProviderSettingsProviderLabel(selectedTextCardProviderId);
  const selectedTextCardProviderModelOptions = React.useMemo(
    () => workspaceTextModelOptions.filter((option) => option.providerId === selectedTextCardProviderId),
    [selectedTextCardProviderId, workspaceTextModelOptions]
  );
  const selectedTextCardPanelModelId = selectedTextCardPanelItem
    ? resolveWorkspaceTextPanelChatModel(
        textCardModelById[selectedTextCardPanelItem.id],
        selectedTextCardProviderModelOptions.map((option) => option.id),
        selectedTextCardProviderModelOptions[0]?.id || defaultWorkspaceTextModelOption.id
      )
    : defaultWorkspaceTextModelOption.id;
  const selectedImageCardProviderId = selectedImageCardPanelItem
    ? (
        selectableImageProviders.find((provider) => provider.id === imageCardProviderById[selectedImageCardPanelItem.id])?.id ||
        selectableImageProviders[0]?.id ||
        imageCardProviderById[selectedImageCardPanelItem.id] ||
        defaultWorkspaceImageModelOption.providerId
      )
    : defaultWorkspaceImageModelOption.providerId;
  const selectedImageCardProviderLabel =
    selectableImageProviders.find((provider) => provider.id === selectedImageCardProviderId)?.name ||
    getProviderSettingsProviderLabel(selectedImageCardProviderId);
  const selectedImageCardProviderModelOptions = React.useMemo(
    () => workspaceImageModelOptions.filter((option) => option.providerId === selectedImageCardProviderId),
    [selectedImageCardProviderId, workspaceImageModelOptions]
  );
  const providerImageOptionProfiles = React.useMemo(
    () => buildProviderImageOptionProfiles(providerSettingsProviders),
    [providerSettingsProviders]
  );
  const selectedImageCardPanelModelId = selectedImageCardPanelItem
    ? resolveWorkspaceImageCardModel(
        imageCardModelById[selectedImageCardPanelItem.id],
        selectedImageCardProviderModelOptions.map((option) => option.id),
        selectedImageCardProviderModelOptions[0]?.id || defaultWorkspaceImageModelOption.id
      )
    : defaultWorkspaceImageModelOption.id;
  const selectedImageCardAspectRatioOptions = React.useMemo(
    () => getProviderModelAspectRatios(
      selectedImageCardProviderId,
      selectedImageCardPanelModelId,
      providerImageOptionProfiles
    ),
    [providerImageOptionProfiles, selectedImageCardPanelModelId, selectedImageCardProviderId]
  );
  const selectedImageCardSizeOptions = React.useMemo(
    () => getSupportedImageCardSizeOptions(
      selectedImageCardPanelModelId,
      undefined,
      selectedImageCardProviderId,
      providerImageOptionProfiles
    ),
    [providerImageOptionProfiles, selectedImageCardPanelModelId, selectedImageCardProviderId]
  );
  const selectedImageCardPanelSize = selectedImageCardPanelItem
    ? resolveImageCardSize(
        selectedImageCardPanelModelId,
        imageCardSizeById[selectedImageCardPanelItem.id] ?? IMAGE_CARD_SIZE_OPTIONS[0].id,
        IMAGE_CARD_SIZE_OPTIONS[0].id,
        selectedImageCardProviderId,
        providerImageOptionProfiles
      )
    : IMAGE_CARD_SIZE_OPTIONS[0].id;
  const selectedImageCardPanelAspectRatio = selectedImageCardPanelItem
    ? normalizeProviderModelAspectRatioForSize(
        selectedImageCardProviderId,
        selectedImageCardPanelModelId,
        selectedImageCardPanelSize,
        normalizeImageCardAspectRatio(imageCardAspectRatioById[selectedImageCardPanelItem.id], '1:1'),
        providerImageOptionProfiles
      )
    : '1:1';
  const selectedImageCardEnabledAspectRatios = React.useMemo(
    () => getEnabledProviderModelAspectRatios(
      selectedImageCardProviderId,
      selectedImageCardPanelModelId,
      selectedImageCardPanelSize,
      providerImageOptionProfiles
    ),
    [
      providerImageOptionProfiles,
      selectedImageCardPanelModelId,
      selectedImageCardPanelSize,
      selectedImageCardProviderId,
    ]
  );
  const selectedImageCardQualityOptions = React.useMemo(() => {
    const options = getProviderModelQualityOptions(
      selectedImageCardProviderId,
      selectedImageCardPanelModelId,
      providerImageOptionProfiles
    );
    return options.length > 0 ? options : IMAGE_CARD_QUALITY_OPTIONS;
  }, [providerImageOptionProfiles, selectedImageCardPanelModelId, selectedImageCardProviderId]);
  const selectedImageCardPanelQuality = selectedImageCardPanelItem
    ? (
        selectedImageCardQualityOptions.find(
          (option) => option.id === (imageCardQualityById[selectedImageCardPanelItem.id] ?? '')
        )?.id ||
        selectedImageCardQualityOptions[0]?.id ||
        IMAGE_CARD_QUALITY_OPTIONS[0].id
      )
    : (selectedImageCardQualityOptions[0]?.id || IMAGE_CARD_QUALITY_OPTIONS[0].id);
  const selectedImageCardPanelCount = selectedImageCardPanelItem
    ? clampImageCardCount(imageCardCountById[selectedImageCardPanelItem.id] ?? IMAGE_CARD_COUNT_MIN)
    : IMAGE_CARD_COUNT_MIN;
  const selectedTextCardPanelSubmitInput = React.useMemo(
    () =>
      buildCanvasTextPanelSubmitInput({
        draft: selectedTextCardPanelInput,
        linkedTexts: selectedTextCardPanelLinkedTexts,
      }),
    [selectedTextCardPanelInput, selectedTextCardPanelLinkedTexts]
  );
  const selectedTextCardPanelCanSubmit = canSubmitTextCardPanel({
    draft: selectedTextCardPanelInput,
    linkedTexts: selectedTextCardPanelLinkedTexts,
  });
  const selectedImageCardPanelSubmitInput = React.useMemo(
    () =>
      buildCanvasImagePanelSubmitInput({
        draft: selectedImageCardPanelInput,
        linkedTexts: selectedImageCardPanelLinkedTexts,
      }),
    [selectedImageCardPanelInput, selectedImageCardPanelLinkedTexts]
  );
  const selectedImageCardPanelCanSubmit = canSubmitImageCardPanel({
    draft: selectedImageCardPanelInput,
    linkedTexts: selectedImageCardPanelLinkedTexts,
    linkedImagePreviews: selectedImageCardPanelLinkedImagePreviews,
  });
  const selectedImageCardPanelValidationError =
    selectedImageCardPanelLinkedImagePreviews.length > 0 && selectedImageCardPanelSubmitInput.length === 0
      ? '参考图生成需要输入文字描述'
      : null;
  const selectedTextCardPanelError = selectedTextCardPanelItem
    ? canvasTextGenerationErrorById[selectedTextCardPanelItem.id] ?? null
    : null;
  const selectedImageCardPanelError = selectedImageCardPanelItem
    ? selectedImageCardPanelValidationError ?? canvasImageGenerationErrorById[selectedImageCardPanelItem.id] ?? null
    : null;
  const activeCanvasTextGenerationItemIds = React.useMemo(
    () => new Set(Object.keys(activeCanvasTextGenerations)),
    [activeCanvasTextGenerations]
  );
  const activeCanvasImageGenerationItemIds = React.useMemo(
    () => new Set(Object.keys(activeCanvasImageGenerations)),
    [activeCanvasImageGenerations]
  );
  const canvasImageWorkingSetEnterIds = React.useMemo(
    () => new Set(getCanvasImageWorkingSetIds({
      items,
      viewport,
      canvasSize,
      overscanScreens: CANVAS_IMAGE_WORKING_SET_ENTER_SCREENS,
    })),
    [canvasSize, items, viewport]
  );
  const canvasImageWorkingSetRetainIds = React.useMemo(
    () => new Set(getCanvasImageWorkingSetIds({
      items,
      viewport,
      canvasSize,
      overscanScreens: CANVAS_IMAGE_WORKING_SET_RETAIN_SCREENS,
    })),
    [canvasSize, items, viewport]
  );
  const protectedCanvasImageIds = React.useMemo(
    () => new Set([
      ...selectedIds,
      ...activeCanvasImageGenerationItemIds,
    ]),
    [activeCanvasImageGenerationItemIds, selectedIds]
  );

  useEffect(() => {
    const validImageIds = new Set(
      items.filter((item) => item.type === 'image').map((item) => item.id)
    );
    const immediatelyActiveIds = new Set<string>();
    canvasImageWorkingSetEnterIds.forEach((itemId) => {
      if (validImageIds.has(itemId)) immediatelyActiveIds.add(itemId);
    });
    protectedCanvasImageIds.forEach((itemId) => {
      if (validImageIds.has(itemId)) immediatelyActiveIds.add(itemId);
    });

    immediatelyActiveIds.forEach((itemId) => {
      const timer = canvasImageReleaseTimersRef.current.get(itemId);
      if (!timer) return;
      clearTimeout(timer);
      canvasImageReleaseTimersRef.current.delete(itemId);
    });

    setActiveCanvasImageIds((current) => {
      let changed = false;
      const next = new Set(current);
      immediatelyActiveIds.forEach((itemId) => {
        if (next.has(itemId)) return;
        next.add(itemId);
        changed = true;
      });
      next.forEach((itemId) => {
        if (validImageIds.has(itemId)) return;
        next.delete(itemId);
        changed = true;
      });
      const resolved = changed ? next : current;
      activeCanvasImageIdsRef.current = resolved;
      return resolved;
    });

    activeCanvasImageIdsRef.current.forEach((itemId) => {
      if (
        protectedCanvasImageIds.has(itemId) ||
        canvasImageWorkingSetRetainIds.has(itemId) ||
        canvasImageReleaseTimersRef.current.has(itemId)
      ) {
        return;
      }
      const timer = setTimeout(() => {
        canvasImageReleaseTimersRef.current.delete(itemId);
        setActiveCanvasImageIds((current) => {
          if (!current.has(itemId)) return current;
          const next = new Set(current);
          next.delete(itemId);
          activeCanvasImageIdsRef.current = next;
          return next;
        });
      }, CANVAS_IMAGE_WORKING_SET_RELEASE_MS);
      canvasImageReleaseTimersRef.current.set(itemId, timer);
    });
  }, [
    canvasImageWorkingSetEnterIds,
    canvasImageWorkingSetRetainIds,
    items,
    protectedCanvasImageIds,
  ]);

  useEffect(() => () => {
    canvasImageReleaseTimersRef.current.forEach((timer) => clearTimeout(timer));
    canvasImageReleaseTimersRef.current.clear();
  }, []);
  const hasActiveAgentImageGeneration = React.useMemo(
    () => chatMessages.some((message) => message.agentRunProgress?.steps.some(
      (step) => step.status === 'active' && isAgentImageGenerationStep(step)
    )),
    [chatMessages]
  );
  useEffect(() => {
    if (!hasActiveAgentImageGeneration) return;

    setGenerationClockMs(Date.now());
    const timer = window.setInterval(() => {
      setGenerationClockMs(Date.now());
    }, 1000);

    return () => {
      window.clearInterval(timer);
    };
  }, [hasActiveAgentImageGeneration]);
  const isSelectedTextCardGenerating =
    !!selectedTextCardPanelItem && !!activeCanvasTextGenerations[selectedTextCardPanelItem.id];
  const isSelectedImageCardGenerating =
    !!selectedImageCardPanelItem && !!activeCanvasImageGenerations[selectedImageCardPanelItem.id];
  const selectedImageCardModel =
    findWorkspaceModelOption(selectedImageCardProviderModelOptions, selectedImageCardPanelModelId, selectedImageCardProviderId) ||
    findWorkspaceModelOption(selectedImageCardProviderModelOptions, '', selectedImageCardProviderId) ||
    defaultWorkspaceImageModelOption;
  const syncImageCardOptionsForProviderModel = useCallback((
    providerId: string,
    modelId: string,
    currentSizeId: string,
    currentAspectRatioId: string,
    currentQualityId = IMAGE_CARD_QUALITY_OPTIONS[0].id
  ) => {
    return syncWorkspaceImageCardOptionsForProviderModel({
      providerId,
      modelId,
      currentSizeId,
      currentAspectRatioId,
      currentQualityId,
      defaultSizeId: IMAGE_CARD_SIZE_OPTIONS[0].id,
      defaultQualityId: IMAGE_CARD_QUALITY_OPTIONS[0].id,
      providerImageOptionProfiles,
    });
  }, [providerImageOptionProfiles]);
  const selectedTextPanelModel =
    findWorkspaceModelOption(selectedTextCardProviderModelOptions, selectedTextCardPanelModelId, selectedTextCardProviderId) ||
    defaultWorkspaceTextModelOption;
  const SKILL_TOKEN_SELECTOR = '[data-skill-token="true"]';
  const REFERENCE_TOKEN_SELECTOR = '[data-reference-token="true"]';
  const copiedAssistantMessageTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const createCurrentCanvasUndoSnapshot = useCallback(() => {
    const liveState = sessionLiveStateRef.current;
    return createCanvasUndoSnapshot({
      items: liveState.items,
      connections: liveState.connections,
      textCardPanelDrafts: liveState.textCardPanelDrafts,
      textCardProviderById: liveState.textCardProviderById,
      textCardModelById: liveState.textCardModelById,
      imageCardPanelDrafts: liveState.imageCardPanelDrafts,
      imageCardProviderById: liveState.imageCardProviderById,
      imageCardModelById: liveState.imageCardModelById,
      imageCardSizeById: liveState.imageCardSizeById,
      imageCardQualityById: liveState.imageCardQualityById,
      imageCardCountById: liveState.imageCardCountById,
      imageCardAspectRatioById: liveState.imageCardAspectRatioById,
    }) as CanvasUndoSnapshot;
  }, []);

  const pushCanvasUndoSnapshot = useCallback((snapshot: CanvasUndoSnapshot | null | undefined) => {
    const sessionId = currentSessionIdRef.current;
    if (!sessionId || !snapshot) {
      return;
    }

    const currentHistory = canvasHistoryBySessionRef.current[sessionId] ?? createEmptySessionCanvasHistoryState();
    canvasHistoryBySessionRef.current[sessionId] = pushUndoSnapshot({
      history: currentHistory,
      snapshot,
    }) as SessionCanvasHistoryState;
  }, []);

  const pushCanvasMoveUndoCommand = useCallback((command: CanvasMoveHistoryCommand) => {
    const sessionId = currentSessionIdRef.current;
    if (!sessionId) return;
    const currentHistory = canvasHistoryBySessionRef.current[sessionId] ?? createEmptySessionCanvasHistoryState();
    canvasHistoryBySessionRef.current[sessionId] = pushUndoCommand({
      history: currentHistory,
      command,
    }) as SessionCanvasHistoryState;
  }, []);

  const commitCanvasUndoSnapshot = useCallback(() => {
    if (!pendingCanvasHistorySnapshotRef.current) {
      return;
    }

    pushCanvasUndoSnapshot(pendingCanvasHistorySnapshotRef.current);
  }, [pushCanvasUndoSnapshot]);

  const recordCurrentCanvasUndoSnapshot = useCallback(() => {
    pushCanvasUndoSnapshot(createCurrentCanvasUndoSnapshot());
  }, [createCurrentCanvasUndoSnapshot, pushCanvasUndoSnapshot]);

  const capturePendingCanvasUndoSnapshot = useCallback(() => {
    if (pendingCanvasHistorySnapshotRef.current) {
      return;
    }

    pendingCanvasHistorySnapshotRef.current = createCurrentCanvasUndoSnapshot();
  }, [createCurrentCanvasUndoSnapshot]);

  const clearPendingCanvasUndoSnapshot = useCallback(() => {
    pendingCanvasHistorySnapshotRef.current = null;
  }, []);

  const commitPendingCanvasUndoSnapshot = useCallback(() => {
    if (!pendingCanvasHistorySnapshotRef.current) {
      return;
    }

    const currentSnapshot = createCurrentCanvasUndoSnapshot();
    if (!areCanvasUndoSnapshotsEqual(pendingCanvasHistorySnapshotRef.current, currentSnapshot)) {
      // @ts-expect-error The commit helper reads the pending snapshot ref directly.
      commitCanvasUndoSnapshot(pendingCanvasHistorySnapshotRef.current);
    }

    pendingCanvasHistorySnapshotRef.current = null;
  }, [commitCanvasUndoSnapshot, createCurrentCanvasUndoSnapshot]);

  const applyCanvasUndoSnapshot = useCallback((snapshot: CanvasUndoSnapshot) => {
    setItems(snapshot.items);
    setConnections(snapshot.connections);
    setTextCardPanelDrafts(snapshot.textCardPanelDrafts);
    setTextCardProviderById(snapshot.textCardProviderById);
    setTextCardModelById(snapshot.textCardModelById);
    setImageCardPanelDrafts(snapshot.imageCardPanelDrafts);
    setImageCardProviderById(snapshot.imageCardProviderById);
    setImageCardModelById(snapshot.imageCardModelById);
    setImageCardSizeById(snapshot.imageCardSizeById);
    setImageCardQualityById(snapshot.imageCardQualityById);
    setImageCardCountById(snapshot.imageCardCountById);
    setImageCardAspectRatioById(snapshot.imageCardAspectRatioById);
    setSelectedId(null);
    setSelectedIds([]);
    setSelectedConnectionIds([]);
    setHoveredCanvasItemId(null);
    setHoveredInputPortItemId(null);
    setHoveredOutputPortItemId(null);
    setConnectionMode('idle');
    setConnectionFromItemId(null);
    setConnectionPointerId(null);
    setFrozenPreviewConnection(null);
    setPendingConnectionMenu(null);
    setActiveCanvasImageIds(new Set());
    activeCanvasImageIdsRef.current = new Set();
    canvasImageReleaseTimersRef.current.forEach((timer) => clearTimeout(timer));
    canvasImageReleaseTimersRef.current.clear();
    setEditingTextCardId(null);
    setShowTextPanelProviderMenu(false);
    setShowTextPanelModelMenu(false);
    setShowImageCardProviderMenu(false);
    setShowImageCardModelMenu(false);
    setShowImageCardSettingsMenu(false);
    setCanvasTextGenerationErrorById({});
    setCanvasImageGenerationErrorById({});
    pendingCanvasHistorySnapshotRef.current = null;
    clearConnectionInteractionStateRef.current();
  }, [
    setConnections,
    setImageCardAspectRatioById,
    setImageCardCountById,
    setImageCardModelById,
    setImageCardPanelDrafts,
    setImageCardProviderById,
    setImageCardQualityById,
    setImageCardSizeById,
    setItems,
    setTextCardModelById,
    setTextCardPanelDrafts,
    setTextCardProviderById,
  ]);

  const undoCanvasEdit = useCallback(() => {
    const sessionId = currentSessionIdRef.current;
    if (!sessionId) {
      return;
    }

    const currentHistory = canvasHistoryBySessionRef.current[sessionId] ?? createEmptySessionCanvasHistoryState();
    const result = undoSnapshot({
      history: currentHistory,
      currentSnapshot: createCurrentCanvasUndoSnapshot(),
    });

    if (!result.snapshot) {
      return;
    }

    canvasHistoryBySessionRef.current[sessionId] = result.history as SessionCanvasHistoryState;
    applyCanvasUndoSnapshot(result.snapshot as CanvasUndoSnapshot);
  }, [applyCanvasUndoSnapshot, createCurrentCanvasUndoSnapshot]);

  const redoCanvasEdit = useCallback(() => {
    const sessionId = currentSessionIdRef.current;
    if (!sessionId) {
      return;
    }

    const currentHistory = canvasHistoryBySessionRef.current[sessionId] ?? createEmptySessionCanvasHistoryState();
    const result = redoSnapshot({
      history: currentHistory,
      currentSnapshot: createCurrentCanvasUndoSnapshot(),
    });

    if (!result.snapshot) {
      return;
    }

    canvasHistoryBySessionRef.current[sessionId] = result.history as SessionCanvasHistoryState;
    applyCanvasUndoSnapshot(result.snapshot as CanvasUndoSnapshot);
  }, [applyCanvasUndoSnapshot, createCurrentCanvasUndoSnapshot]);

  useEffect(() => {
    if (!editingTextCardId || !editingTextCardTextareaRef.current) return;

    editingTextCardTextareaRef.current.focus();
    const textLength = editingTextCardTextareaRef.current.value.length;
    editingTextCardTextareaRef.current.setSelectionRange(textLength, textLength);
  }, [editingTextCardId]);

  useEffect(() => {
    draftStrokeRef.current = draftStroke;
  }, [draftStroke]);

  useEffect(() => {
    if (!editingAnnotationTextId || !editingAnnotationTextRef.current) return;
    const textarea = editingAnnotationTextRef.current;
    textarea.focus();
    const textLength = textarea.value.length;
    textarea.setSelectionRange(textLength, textLength);
  }, [editingAnnotationTextId]);

  useLayoutEffect(() => {
    renderedViewportRef.current = viewport;
    const sceneTarget = getSceneTarget();
    const activeViewport = visualViewportRef.current;
    sceneTarget?.setViewportTransform(activeViewport.x, activeViewport.y, activeViewport.scale);
  }, [getSceneTarget, viewport]);

  useLayoutEffect(() => {
    itemsRef.current = items;
    renderedItemsByIdRef.current = new Map(items.map((item) => [item.id, item]));
    itemByIdRef.current = new Map(items.map((item) => [item.id, item]));
  }, [items]);

  useEffect(() => {
    if (!editingTextCardId) return;
    if (!items.some((item) => item.id === editingTextCardId && item.type === 'text' && item.textVariant === 'card')) {
      setEditingTextCardId(null);
    }
  }, [editingTextCardId, items]);

  useEffect(() => {
    if (!editingAnnotationTextId) return;
    if (!items.some((item) => item.id === editingAnnotationTextId && isCanvasAnnotationTextItem(item))) {
      setEditingAnnotationTextId(null);
    }
  }, [editingAnnotationTextId, items]);

  useEffect(() => {
    const imageCardIds = new Set(imageCardMembershipKey ? imageCardMembershipKey.split('\u0000') : []);

    setImageCardPanelDrafts((prev) => {
      const nextEntries = Object.entries(prev).filter(([itemId]) => imageCardIds.has(itemId));
      return nextEntries.length === Object.keys(prev).length ? prev : Object.fromEntries(nextEntries);
    });

    setImageCardModelById((prev) => {
      const nextEntries = Object.entries(prev).filter(([itemId]) => imageCardIds.has(itemId));
      return nextEntries.length === Object.keys(prev).length ? prev : Object.fromEntries(nextEntries);
    });

    setImageCardSizeById((prev) => {
      const nextEntries = Object.entries(prev).filter(([itemId]) => imageCardIds.has(itemId));
      return nextEntries.length === Object.keys(prev).length ? prev : Object.fromEntries(nextEntries);
    });

    setImageCardQualityById((prev) => {
      const nextEntries = Object.entries(prev).filter(([itemId]) => imageCardIds.has(itemId));
      return nextEntries.length === Object.keys(prev).length ? prev : Object.fromEntries(nextEntries);
    });

    setImageCardCountById((prev) => {
      const nextEntries = Object.entries(prev).filter(([itemId]) => imageCardIds.has(itemId));
      return nextEntries.length === Object.keys(prev).length ? prev : Object.fromEntries(nextEntries);
    });

    setImageCardAspectRatioById((prev) => {
      const nextEntries = Object.entries(prev).filter(([itemId]) => imageCardIds.has(itemId));
      return nextEntries.length === Object.keys(prev).length ? prev : Object.fromEntries(nextEntries);
    });

    setCanvasImageGenerationErrorById((prev) => {
      const nextEntries = Object.entries(prev).filter(([itemId]) => imageCardIds.has(itemId));
      return nextEntries.length === Object.keys(prev).length ? prev : Object.fromEntries(nextEntries);
    });
  }, [
    imageCardMembershipKey,
    setImageCardAspectRatioById,
    setImageCardCountById,
    setImageCardModelById,
    setImageCardPanelDrafts,
    setImageCardQualityById,
    setImageCardSizeById,
  ]);

  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);

  useEffect(() => {
    selectedIdsRef.current = selectedIds;
  }, [selectedIds]);

  useEffect(() => {
    selectedConnectionIdsRef.current = selectedConnectionIds;
  }, [selectedConnectionIds]);

  useEffect(() => {
    return () => {
      if (imageToolbarNoticeTimeoutRef.current) {
        clearTimeout(imageToolbarNoticeTimeoutRef.current);
      }
      if (modelSelectionNoticeTimeoutRef.current) {
        clearTimeout(modelSelectionNoticeTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return;
    }

    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    const updateReducedMotion = () => {
      reducedMotionRef.current = mediaQuery.matches;
    };

    updateReducedMotion();

    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', updateReducedMotion);
      return () => mediaQuery.removeEventListener('change', updateReducedMotion);
    }

    mediaQuery.addListener(updateReducedMotion);
    return () => mediaQuery.removeListener(updateReducedMotion);
  }, []);

  const inferTopicSkill = useCallback((topic: ChatTopic | null): { id: string; label: string } | null => {
    if (!topic) return null;
    return topic.activeSkillExplicit ? topic.activeSkill || null : null;
  }, []);

  const getAssistantSelectableHost = useCallback((node: Node | null): HTMLElement | null => {
    if (!node) return null;
    if (node instanceof HTMLElement) {
      return node.closest('[data-assistant-selectable="true"]');
    }
    return node.parentElement?.closest('[data-assistant-selectable="true"]') ?? null;
  }, []);

  const isNodeInsideAssistantSelectable = useCallback((node: Node | null) => {
    const selectableHost = getAssistantSelectableHost(node);
    if (!selectableHost || !chatContainerRef.current) return false;
    return chatContainerRef.current.contains(selectableHost);
  }, [getAssistantSelectableHost]);

  const hasActiveAssistantTextSelection = useCallback(() => {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return false;
    return (
      isNodeInsideAssistantSelectable(selection.anchorNode) ||
      isNodeInsideAssistantSelectable(selection.focusNode)
    );
  }, [isNodeInsideAssistantSelectable]);

  const markAssistantSelectionIntent = useCallback(() => {
    assistantTextSelectionRef.current.startedInAssistant = true;
    assistantTextSelectionRef.current.suppressOutsideClickUntil = Date.now() + 300;
  }, []);

  const handleAssistantSelectablePointerDown = useCallback((e: React.PointerEvent<HTMLElement>) => {
    assistantTextSelectionRef.current.isPointerDown = true;
    markAssistantSelectionIntent();
    e.stopPropagation();
  }, [markAssistantSelectionIntent]);

  const handleAssistantSelectableMouseDown = useCallback((e: React.MouseEvent<HTMLElement>) => {
    assistantTextSelectionRef.current.isPointerDown = true;
    markAssistantSelectionIntent();
    e.stopPropagation();
  }, [markAssistantSelectionIntent]);

  const handleAssistantSelectableClick = useCallback((e: React.MouseEvent<HTMLElement>) => {
    if (hasActiveAssistantTextSelection()) {
      markAssistantSelectionIntent();
    }
    e.stopPropagation();
  }, [hasActiveAssistantTextSelection, markAssistantSelectionIntent]);

  const handleCopyAssistantMessage = useCallback(async (messageId: string, content: string) => {
    const textToCopy = content.trim();
    if (!textToCopy) return;

    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(textToCopy);
      } else {
        const textarea = document.createElement('textarea');
        textarea.value = textToCopy;
        textarea.setAttribute('readonly', 'true');
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
      }

      setCopiedAssistantMessageId(messageId);
      if (copiedAssistantMessageTimeoutRef.current) {
        clearTimeout(copiedAssistantMessageTimeoutRef.current);
      }
      copiedAssistantMessageTimeoutRef.current = setTimeout(() => {
        setCopiedAssistantMessageId((prev) => (prev === messageId ? null : prev));
      }, 1400);
    } catch (error) {
      console.error('Copy assistant message failed:', error);
    }
  }, []);

  useEffect(() => {
    return () => {
      if (copiedAssistantMessageTimeoutRef.current) {
        clearTimeout(copiedAssistantMessageTimeoutRef.current);
      }
    };
  }, []);

  const syncEditorHeight = useCallback(() => {
    const editor = chatInputEditorRef.current;
    if (!editor) return;
    editor.style.height = "auto";
    const next = Math.max(72, Math.min(editor.scrollHeight || 72, 240));
    editor.style.height = `${next}px`;
    chatInputHeightRef.current = next;
  }, []);

  const parseChatEditorSegments = useCallback((root: HTMLElement): ChatComposerSegment[] => {
    const segments: ChatComposerSegment[] = [];
    const visit = (node: Node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        const text = node.textContent || '';
        if (text) segments.push({ type: 'text', text: text.replace(/\u00A0/g, ' ') });
        return;
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return;
      const element = node as HTMLElement;
      if (element.matches(SKILL_TOKEN_SELECTOR)) return;
      if (element.matches(REFERENCE_TOKEN_SELECTOR)) {
        const tokenId = element.getAttribute('data-reference-id');
        if (tokenId) segments.push({ type: 'reference', tokenId });
        return;
      }
      if (element.tagName === 'BR') {
        segments.push({ type: 'text', text: '\n' });
        return;
      }
      Array.from(element.childNodes).forEach(visit);
      if (element !== root && /^(DIV|P|LI)$/.test(element.tagName)) {
        segments.push({ type: 'text', text: '\n' });
      }
    };
    Array.from(root.childNodes).forEach(visit);
    return mergeAdjacentChatComposerText(segments);
  }, [REFERENCE_TOKEN_SELECTOR, SKILL_TOKEN_SELECTOR]);

  const getChatEditorCaretAnchor = useCallback(() => {
    const editor = chatInputEditorRef.current;
    const selection = window.getSelection();
    if (!editor || !selection || selection.rangeCount === 0) return chatEditorCaretAnchorRef.current;
    const range = selection.getRangeAt(0);
    if (!range.collapsed || !editor.contains(range.startContainer)) return chatEditorCaretAnchorRef.current;
    const prefixRange = range.cloneRange();
    prefixRange.selectNodeContents(editor);
    prefixRange.setEnd(range.startContainer, range.startOffset);
    const wrapper = document.createElement('div');
    wrapper.appendChild(prefixRange.cloneContents());
    const prefixSegments = parseChatEditorSegments(wrapper);
    return {
      textOffset: getChatComposerPlainText(prefixSegments).length,
      referenceCount: prefixSegments.filter((segment) => segment.type === 'reference').length,
    };
  }, [parseChatEditorSegments]);

  const rememberChatEditorCaretOffset = useCallback(() => {
    chatEditorCaretAnchorRef.current = getChatEditorCaretAnchor();
  }, [getChatEditorCaretAnchor]);

  const moveCaretToEditorEnd = useCallback(() => {
    const editor = chatInputEditorRef.current;
    if (!editor) return;
    const selection = window.getSelection();
    if (!selection) return;
    const range = document.createRange();
    range.selectNodeContents(editor);
    range.collapse(false);
    selection.removeAllRanges();
    selection.addRange(range);
  }, []);

  const syncEditorTextFromState = useCallback((value: string, moveCaretToEnd = false) => {
    const editor = chatInputEditorRef.current;
    if (!editor) return;
    if (isChatInputComposingRef.current) {
      pendingChatEditorSyncRef.current = true;
      pendingChatEditorMoveCaretToEndRef.current ||= moveCaretToEnd;
      return;
    }

    let segments = parseChatEditorSegments(editor);
    const validTokenIds = new Set(resolvedChatReferenceTokens.map((token) => token.id));
    segments = segments.filter((segment) => segment.type === 'text' || validTokenIds.has(segment.tokenId));
    const currentTokenIds = new Set(
      segments.filter((segment): segment is Extract<ChatComposerSegment, { type: 'reference' }> => segment.type === 'reference')
        .map((segment) => segment.tokenId)
    );
    const missingTokenIds = resolvedChatReferenceTokens
      .map((token) => token.id)
      .filter((tokenId) => !currentTokenIds.has(tokenId));
    if (missingTokenIds.length > 0) {
      segments = insertReferenceSegmentsAtTextOffset(segments, missingTokenIds, chatEditorCaretAnchorRef.current);
    }
    if (getChatComposerPlainText(segments) !== value) {
      segments = replaceChatComposerTextPreservingReferences(segments, value);
    }
    segments = mergeAdjacentChatComposerText(segments);
    const currentTokenLabel = editor.querySelector(SKILL_TOKEN_SELECTOR)?.getAttribute("data-skill-label") || "";
    const targetTokenLabel = activeSkill?.label || "";

    const currentDomSignature = Array.from(editor.querySelectorAll(REFERENCE_TOKEN_SELECTOR))
      .map((node) => `${node.getAttribute('data-reference-id')}:${node.getAttribute('data-reference-signature') || ''}`)
      .join('|');
    const tokenById = new Map(resolvedChatReferenceTokens.map((token) => [token.id, token]));
    const targetDomSignature = segments
      .filter((segment): segment is Extract<ChatComposerSegment, { type: 'reference' }> => segment.type === 'reference')
      .map((segment) => {
        const token = tokenById.get(segment.tokenId);
        return `${segment.tokenId}:${token ? JSON.stringify(token) : ''}`;
      })
      .join('|');
    const existingSegments = chatComposerSegmentsRef.current;
    const segmentsChanged = JSON.stringify(existingSegments) !== JSON.stringify(segments);
    const shouldRebuild = segmentsChanged || currentTokenLabel !== targetTokenLabel || currentDomSignature !== targetDomSignature;
    if (shouldRebuild) {
      editor.innerHTML = "";

      if (activeSkill) {
        const token = document.createElement("span");
        token.setAttribute("data-skill-token", "true");
        token.setAttribute("data-skill-label", activeSkill.label);
        token.setAttribute("contenteditable", "false");
        token.className = "inline-flex items-center gap-1 px-2 h-5 leading-5 rounded-full bg-violet-100 text-violet-700 text-sm font-medium align-middle mr-1";
        token.textContent = `✧ ${activeSkill.label}`;
        editor.appendChild(token);
      }

      for (const segment of segments) {
        if (segment.type === 'text') {
          editor.appendChild(document.createTextNode(segment.text));
          continue;
        }
        const tokenData = tokenById.get(segment.tokenId);
        if (!tokenData) continue;
        const token = document.createElement('span');
        token.setAttribute('data-reference-token', 'true');
        token.setAttribute('data-reference-id', tokenData.id);
        token.setAttribute('data-reference-signature', JSON.stringify(tokenData));
        token.setAttribute('contenteditable', 'false');
        token.className = 'workspace-reference-token group/reference relative mx-0.5 inline-flex h-7 max-w-[172px] align-middle items-center gap-1 rounded-lg px-1.5 text-[11px]';
        token.title = tokenData.regionId && tokenData.confirmationStatus !== 'confirmed'
          ? `待确认 · ${tokenData.label}`
          : tokenData.label;

        const thumb = document.createElement('span');
        thumb.className = 'h-5 w-5 shrink-0 rounded-md bg-cover bg-center';
        thumb.style.backgroundImage = `url("${(tokenData.previewSrc || tokenData.src).replace(/"/g, '\\"')}")`;
        token.appendChild(thumb);
        const label = document.createElement('span');
        label.className = 'min-w-0 truncate text-[11px] font-medium';
        label.textContent = tokenData.uploadStatus === 'uploading'
          ? '上传中…'
          : tokenData.uploadStatus === 'failed'
            ? '上传失败'
            : tokenData.label;
        token.appendChild(label);
        if (tokenData.annotationCount) {
          const badge = document.createElement('span');
          badge.className = 'shrink-0 rounded-md bg-red-500/12 px-1.5 py-0.5 text-[9px] font-medium text-red-500';
          badge.textContent = `${tokenData.annotationCount} 条标注`;
          token.appendChild(badge);
        }
        if (tokenData.regionId && tokenData.confirmationStatus !== 'confirmed') {
          const badge = document.createElement('span');
          badge.className = 'shrink-0 rounded-md bg-amber-500/12 px-1.5 py-0.5 text-[9px] font-medium text-amber-600';
          badge.textContent = '待确认';
          token.appendChild(badge);
        }
        if (tokenData.regionId && !tokenData.uploadStatus) {
          const candidates = document.createElement('button');
          candidates.type = 'button';
          candidates.setAttribute('data-reference-action', 'candidates');
          candidates.className = 'inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md opacity-65 hover:opacity-100';
          candidates.setAttribute('aria-label', '选择识别候选');
          candidates.textContent = '⌄';
          token.appendChild(candidates);
        }
        if (tokenData.uploadStatus === 'failed') {
          const retry = document.createElement('button');
          retry.type = 'button';
          retry.setAttribute('data-reference-action', 'retry');
          retry.className = 'inline-flex h-5 shrink-0 items-center justify-center rounded-md px-1 text-[9px] text-red-500';
          retry.setAttribute('aria-label', '重试上传参考图');
          retry.textContent = '重试';
          token.appendChild(retry);
        } else if (!tokenData.uploadStatus && !tokenData.regionId) {
          const pin = document.createElement('button');
          pin.type = 'button';
          pin.setAttribute('data-reference-action', 'pin');
          pin.className = `inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md ${tokenData.pinned ? 'opacity-100' : 'opacity-0 group-hover/reference:opacity-70'}`;
          pin.setAttribute('aria-label', tokenData.pinned ? '取消固定参考图' : '固定参考图');
          pin.textContent = tokenData.pinned ? '●' : '○';
          token.appendChild(pin);
        }
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.setAttribute('data-reference-action', 'remove');
        remove.className = 'inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md opacity-50 hover:opacity-100';
        remove.setAttribute('aria-label', '移除参考图');
        remove.textContent = '×';
        token.appendChild(remove);
        editor.appendChild(token);
      }
      chatComposerSegmentsRef.current = segments;
      if (moveCaretToEnd) {
        moveCaretToEditorEnd();
      }
    } else {
      chatComposerSegmentsRef.current = segments;
    }

    syncEditorHeight();
  }, [activeSkill, moveCaretToEditorEnd, parseChatEditorSegments, resolvedChatReferenceTokens, syncEditorHeight]);

  const isCaretAtEditorStart = (): boolean => {
    const editor = chatInputEditorRef.current;
    if (!editor) return false;
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return false;
    const range = selection.getRangeAt(0);
    if (!range.collapsed) return false;
    if (!editor.contains(range.startContainer)) return false;

    const prefixRange = range.cloneRange();
    prefixRange.selectNodeContents(editor);
    prefixRange.setEnd(range.startContainer, range.startOffset);
    const fragment = prefixRange.cloneContents();
    const wrapper = document.createElement("div");
    wrapper.appendChild(fragment);
    if (wrapper.querySelector(REFERENCE_TOKEN_SELECTOR)) return false;
    return getChatComposerPlainText(parseChatEditorSegments(wrapper)).trim().length === 0;
  };

  const parseSkillChoicePayload = (raw: string): SkillChoicePayload | null => {
    try {
      const parsed = JSON.parse(raw) as {
        id?: unknown;
        title?: unknown;
        message?: unknown;
        options?: Array<{ label?: unknown; submitText?: unknown }>;
      };
      if (typeof parsed.id !== 'string' || !parsed.id.trim()) return null;
      if (typeof parsed.title !== 'string' || !parsed.title.trim()) return null;
      if (typeof parsed.message !== 'string') return null;
      if (!Array.isArray(parsed.options) || parsed.options.length < 2 || parsed.options.length > 3) return null;

      const options: SkillChoiceOption[] = parsed.options
        .filter((item) => typeof item?.label === 'string' && typeof item?.submitText === 'string')
        .map((item) => ({ label: (item.label as string).trim(), submitText: (item.submitText as string).trim() }))
        .filter((item) => item.label.length > 0 && item.submitText.length > 0);

      if (options.length < 2 || options.length > 3) return null;

      return {
        id: parsed.id.trim(),
        title: parsed.title.trim(),
        message: parsed.message.trim(),
        options,
      };
    } catch {
      return null;
    }
  };

  const extractSkillChoiceFromContent = (
    content: string
  ): { cleanContent: string; choice: SkillChoicePayload | null } => {
    const start = content.indexOf(SKILL_CHOICE_START);
    const end = content.indexOf(SKILL_CHOICE_END);
    if (start === -1 || end === -1 || end <= start) {
      return { cleanContent: content, choice: null };
    }

    const jsonStart = start + SKILL_CHOICE_START.length;
    const rawJson = content.slice(jsonStart, end).trim();
    const parsedChoice = parseSkillChoicePayload(rawJson);
    if (!parsedChoice) {
      return { cleanContent: content, choice: null };
    }

    const cleanContent = `${content.slice(0, start)}${content.slice(end + SKILL_CHOICE_END.length)}`.trim();
    return { cleanContent, choice: parsedChoice };
  };

  const processAssistantContentWithChoice = (
    content: string,
    skillId: string | null | undefined
  ): { content: string; skillChoice?: SkillChoicePayload } => {
    if (skillId !== 'brand') {
      return { content };
    }

    const extracted = extractSkillChoiceFromContent(content);
    if (!extracted.choice) {
      return { content: extracted.cleanContent };
    }

    if (processedSkillChoiceIdsRef.current.has(extracted.choice.id)) {
      return { content: extracted.cleanContent };
    }

    return { content: extracted.cleanContent, skillChoice: extracted.choice };
  };

  useEffect(() => {
    if (!pendingSkillChoice) return;
    const stillPending = chatMessages.some((msg) =>
      msg.skillChoice?.id === pendingSkillChoice.id && !msg.skillChoiceResolved
    );
    if (!stillPending) {
      setPendingSkillChoice(null);
      setShowSkillChoiceModal(false);
    }
  }, [chatMessages, pendingSkillChoice]);

  useEffect(() => {
    const pendingMessage = [...chatMessages].reverse().find((message) => (
      message.role === 'assistant'
      && message.agentProposal?.requiresSelection
      && !message.agentProposalResolved
    ));
    if (!pendingMessage?.agentProposal) {
      setPendingAgentProposal(null);
      setShowAgentProposalModal(false);
      return;
    }
    setPendingAgentProposal(pendingMessage.agentProposal);
    if (!pendingMessage.agentProposalDismissed) setShowAgentProposalModal(true);
  }, [chatMessages]);

  useEffect(() => {
    const pendingMessage = [...chatMessages].reverse().find((message) => (
      message.role === 'assistant'
      && message.agentConfirmation
      && !message.agentConfirmationResolved
    ));
    if (!pendingMessage?.agentConfirmation) {
      setPendingAgentConfirmation(null);
      setShowAgentConfirmationModal(false);
      return;
    }
    setPendingAgentConfirmation(pendingMessage.agentConfirmation);
    if (!pendingMessage.agentConfirmationDismissed) setShowAgentConfirmationModal(true);
  }, [chatMessages]);

  useEffect(() => {
    const pendingMessage = [...chatMessages].reverse().find((message) =>
      message.role === 'assistant'
      && message.agentClarification
      && !message.agentClarificationResolved
    );
    if (!pendingMessage?.agentClarification) {
      setPendingAgentClarification(null);
      setShowAgentClarificationModal(false);
      return;
    }
    setPendingAgentClarification(pendingMessage.agentClarification);
    if (!pendingMessage.agentClarificationDismissed) {
      setShowAgentClarificationModal(true);
    }
  }, [chatMessages]);

  const stopStreamTypewriter = () => {
    flushQueuedChatMessageUpdates();
    if (streamTickerRef.current) {
      gsap.ticker.remove(streamTickerRef.current);
      streamTickerRef.current = null;
    }
    streamTickerLastTimeRef.current = 0;
    streamQueueRef.current = '';
    streamMessageIdRef.current = null;
  };

  const ensureStreamTypewriterRunning = () => {
    if (streamTickerRef.current) return;

    const tickStreamTypewriter = (time: number) => {
      if (time - streamTickerLastTimeRef.current < 0.08) return;
      streamTickerLastTimeRef.current = time;
      const messageId = streamMessageIdRef.current;
      if (!messageId) return;
      if (!streamQueueRef.current) return;

      const nextChunkSize = Math.max(4, Math.min(24, Math.ceil(streamQueueRef.current.length / 16)));
      const nextChunk = streamQueueRef.current.slice(0, nextChunkSize);
      streamQueueRef.current = streamQueueRef.current.slice(nextChunkSize);

      updateChatMessageById(messageId, (msg) => {
        return {
          ...msg,
          content: `${msg.content}${nextChunk}`,
        };
      });
      flushQueuedChatMessageUpdates();
    };
    streamTickerLastTimeRef.current = 0;
    streamTickerRef.current = tickStreamTypewriter;
    gsap.ticker.add(tickStreamTypewriter);
  };

  const enqueueStreamDelta = (messageId: string, delta: string) => {
    streamMessageIdRef.current = messageId;
    streamQueueRef.current += delta;
    ensureStreamTypewriterRunning();
  };

  const flushStreamQueueNow = (messageId?: string | null) => {
    const targetMessageId = messageId || streamMessageIdRef.current;
    const remaining = streamQueueRef.current;
    if (!targetMessageId || !remaining) return;

    streamQueueRef.current = '';
    updateChatMessageById(targetMessageId, (msg) => {
      return {
        ...msg,
        content: `${msg.content}${remaining}`,
      };
    });
    flushQueuedChatMessageUpdates();
  };

  const waitForStreamFlush = async () => {
    const maxWaitMs = 12000;
    const start = Date.now();
    while (streamQueueRef.current.length > 0) {
      if (Date.now() - start >= maxWaitMs) {
        flushStreamQueueNow();
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 15));
    }
  };

  const updateActiveStreamMessageStatus = (
    status: 'failed' | 'cancelled' | undefined,
    fallbackContent?: string
  ) => {
    const messageId = streamMessageIdRef.current;
    if (!messageId) return;

    flushStreamQueueNow(messageId);

    updateChatMessageById(messageId, (msg) => {
      return {
        ...msg,
        taskStatus: status,
        content: msg.content || fallbackContent || msg.content,
      };
    });
    flushQueuedChatMessageUpdates();
  };

  const flushQueuedChatMessageUpdates = useCallback(() => {
    if (pendingChatMessageUpdateTimerRef.current) {
      clearTimeout(pendingChatMessageUpdateTimerRef.current);
      pendingChatMessageUpdateTimerRef.current = null;
    }
    const queuedUpdates = pendingChatMessageUpdatesRef.current;
    if (queuedUpdates.size === 0) return;
    pendingChatMessageUpdatesRef.current = new Map();
    const queuedAt = pendingChatMessageUpdateStartedAtRef.current;
    pendingChatMessageUpdateStartedAtRef.current = 0;
    setChatMessages((prev) => applyQueuedChatMessageUpdates(prev, queuedUpdates));
    if (canvasPerformanceEnabledRef.current && queuedAt > 0) {
      const samples = chatStreamPaintSamplesRef.current;
      if (samples.length >= 120) samples.shift();
      samples.push(performance.now() - queuedAt);
      if (samples.length >= 30 && samples.length % 30 === 0) {
        const sorted = [...samples].sort((left, right) => left - right);
        const p95 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] || 0;
        console.info('[chat-stream-perf]', { sampleCount: samples.length, eventToCommitP95: p95 });
      }
    }
  }, [setChatMessages]);

  const scheduleQueuedChatMessageUpdates = useCallback(() => {
    if (pendingChatMessageUpdateTimerRef.current) return;
    pendingChatMessageUpdateStartedAtRef.current = performance.now();
    pendingChatMessageUpdateTimerRef.current = setTimeout(flushQueuedChatMessageUpdates, 64);
  }, [flushQueuedChatMessageUpdates]);

  const updateChatMessageById = useCallback((
    messageId: string,
    updater: (msg: ChatMessage) => ChatMessage
  ) => {
    const queuedUpdates = pendingChatMessageUpdatesRef.current.get(messageId) || [];
    queuedUpdates.push(updater);
    pendingChatMessageUpdatesRef.current.set(messageId, queuedUpdates);
    scheduleQueuedChatMessageUpdates();
  }, [scheduleQueuedChatMessageUpdates]);

  const updatePendingAssistantMessage = (
    updater: (msg: ChatMessage) => ChatMessage
  ) => {
    const messageId = pendingAssistantMessageIdRef.current;
    if (!messageId) return;
    updateChatMessageById(messageId, updater);
  };

  const readAsDataURL = (file: File) => {
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (event) => resolve(event.target?.result as string);
      reader.onerror = () => reject(new Error(`读取文件失败: ${file.name}`));
      reader.readAsDataURL(file);
    });
  };

  const uploadChatReferenceFile = useCallback(async (file: File) => {
    const imageData = await readAsDataURL(file);
    const response = await fetch('/api/upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        imageData,
        fileName: file.name || `chat-reference-${Date.now()}.${file.type.split('/')[1] || 'png'}`,
      }),
    });
    if (!response.ok) {
      throw new Error(`Upload failed: ${response.status}`);
    }
    const payload = await response.json();
    if (typeof payload?.url !== 'string' || !payload.url) {
      throw new Error('Upload did not return a usable image URL');
    }
    return payload.url as string;
  }, []);

  const enqueueChatReferenceUploads = useCallback((files: File[]) => {
    const pendingTokens = files.map((file, index): ChatReferenceToken => {
      const previewObjectUrl = URL.createObjectURL(file);
      return {
        id: `upload:${Date.now()}:${index}:${Math.random().toString(36).slice(2, 7)}`,
        src: previewObjectUrl,
        label: file.name || '上传图片',
        source: 'upload',
        transient: false,
        pinned: false,
        role: 'reference',
        uploadStatus: 'uploading',
        uploadFile: file,
        previewObjectUrl,
      };
    });

    setChatReferenceTokens((current) => [...current, ...pendingTokens].slice(0, 14));

    pendingTokens.forEach((pendingToken) => {
      void uploadChatReferenceFile(pendingToken.uploadFile!).then((src) => {
        if (pendingToken.previewObjectUrl) URL.revokeObjectURL(pendingToken.previewObjectUrl);
        setChatReferenceTokens((tokens) => tokens.map((token) => token.id === pendingToken.id
          ? {
              ...token,
              src,
              label: getReferenceTokenLabel(src, pendingToken.label),
              uploadStatus: undefined,
              uploadError: undefined,
              uploadFile: undefined,
              previewObjectUrl: undefined,
            }
          : token));
      }).catch((error) => {
        setChatReferenceTokens((tokens) => tokens.map((token) => token.id === pendingToken.id
          ? {
              ...token,
              uploadStatus: 'failed',
              uploadError: error instanceof Error ? error.message : '图片上传失败',
            }
          : token));
      });
    });
  }, [uploadChatReferenceFile]);

  const retryChatReferenceUpload = useCallback((targetToken: ChatReferenceToken) => {
    if (!targetToken.uploadFile) return;
    setChatReferenceTokens((tokens) => tokens.map((token) => token.id === targetToken.id
      ? { ...token, uploadStatus: 'uploading', uploadError: undefined }
      : token));
    void uploadChatReferenceFile(targetToken.uploadFile).then((src) => {
      if (targetToken.previewObjectUrl) URL.revokeObjectURL(targetToken.previewObjectUrl);
      setChatReferenceTokens((tokens) => tokens.map((token) => token.id === targetToken.id
        ? {
            ...token,
            src,
            label: getReferenceTokenLabel(src, targetToken.label),
            uploadStatus: undefined,
            uploadError: undefined,
            uploadFile: undefined,
            previewObjectUrl: undefined,
          }
        : token));
    }).catch((error) => {
      setChatReferenceTokens((tokens) => tokens.map((token) => token.id === targetToken.id
        ? {
            ...token,
            uploadStatus: 'failed',
            uploadError: error instanceof Error ? error.message : '图片上传失败',
          }
        : token));
    });
  }, [uploadChatReferenceFile]);

  const getViewportCenterCanvasPoint = useCallback(
    (overrideViewport?: { x: number; y: number; scale: number }) => {
      const activeViewport = overrideViewport ?? visualViewportRef.current;
      const canvasRect = canvasMetricsRef.current;
      const isDesktopCanvas = typeof window === 'undefined'
        ? true
        : window.matchMedia('(min-width: 640px)').matches;
      const reservedRight = isDesktopCanvas ? chatSafeAreaWidthRef.current : 0;
      const fallbackCanvasWidth = typeof window === 'undefined'
        ? 0
        : window.innerWidth;
      const fallbackCanvasHeight = typeof window === 'undefined' ? 0 : window.innerHeight;
      const canvasWidth = Math.max(0, (canvasRect.width || fallbackCanvasWidth) - reservedRight);
      const canvasHeight = canvasRect.height || fallbackCanvasHeight;

      return {
        x: (canvasWidth / 2 - activeViewport.x) / activeViewport.scale,
        y: (canvasHeight / 2 - activeViewport.y) / activeViewport.scale,
      };
    },
    []
  );

  const getSpawnPosition = useCallback(
    (
      size: { width: number; height: number },
      orderOffset = 0,
      overrideViewport?: { x: number; y: number; scale: number }
    ) => {
      const center = getViewportCenterCanvasPoint(overrideViewport);
      const horizontalSpacing = Math.max(size.width + 32, 160);
      const centeredOffsetX = orderOffset * horizontalSpacing;

      return {
        x: center.x - size.width / 2 + centeredOffsetX,
        y: center.y - size.height / 2,
      };
    },
    [getViewportCenterCanvasPoint]
  );

  const addImageToCanvas = useCallback(
    async (imageData: string, fileName: string, orderOffset: number = 0) => {
      const response = await fetch('/api/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageData,
          fileName,
        }),
      });

      if (!response.ok) {
        throw new Error(`Upload failed: ${response.status}`);
      }

      const data = await response.json();
      const imageUrl = data.url;

      await new Promise<void>((resolve, reject) => {
        const img = new window.Image();
        img.onload = () => {
          const spawnPosition = getSpawnPosition(
            {
              width: getConstrainedImageDisplaySize(img.width, img.height).width,
              height: getConstrainedImageDisplaySize(img.width, img.height).height,
            },
            orderOffset
          );
          const newItem = createImageCanvasItem({
            id: `item-${Date.now()}-${Math.random()}`,
            src: imageUrl,
            naturalWidth: img.width,
            naturalHeight: img.height,
            x: spawnPosition.x,
            y: spawnPosition.y,
          });
          recordCurrentCanvasUndoSnapshot();
          setItems((prev) => [...prev, newItem]);
          resolve();
        };
        img.onerror = () => reject(new Error('图片加载失败'));
        img.src = imageUrl;
      });
    },
    [getSpawnPosition, recordCurrentCanvasUndoSnapshot, setItems]
  );

  const addGeneratedHistoryImageToCanvas = useCallback(
    async ({
      src,
      naturalWidth,
      naturalHeight,
    }: {
      src: string;
      naturalWidth?: number;
      naturalHeight?: number;
    }) => {
      const resolvedMeta =
        Number.isFinite(naturalWidth) &&
        naturalWidth > 0 &&
        Number.isFinite(naturalHeight) &&
        naturalHeight > 0
          ? {
              naturalWidth,
              naturalHeight,
            }
          : await new Promise<{ naturalWidth: number; naturalHeight: number }>((resolve, reject) => {
              const img = new window.Image();
              img.onload = () => {
                resolve({
                  naturalWidth: img.width,
                  naturalHeight: img.height,
                });
              };
              img.onerror = () => reject(new Error('图片加载失败'));
              img.src = src;
            });

      const displaySize = getConstrainedImageDisplaySize(
        resolvedMeta.naturalWidth,
        resolvedMeta.naturalHeight
      );
      const spawnPosition = getSpawnPosition(displaySize);
      const newItem = createImageCanvasItem({
        id: `history-image-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        src,
        naturalWidth: resolvedMeta.naturalWidth,
        naturalHeight: resolvedMeta.naturalHeight,
        x: spawnPosition.x,
        y: spawnPosition.y,
      });

      recordCurrentCanvasUndoSnapshot();
      setItems((prev) => [...prev, newItem]);
    },
    [getSpawnPosition, recordCurrentCanvasUndoSnapshot, setItems]
  );

  const addBackgroundRemovedImageToCanvas = useCallback(
    async ({
      src,
      naturalWidth,
      naturalHeight,
      sourceItemId,
    }: {
      src: string;
      naturalWidth?: number;
      naturalHeight?: number;
      sourceItemId: string;
    }) => {
      const resolvedMeta =
        Number.isFinite(naturalWidth) &&
        naturalWidth > 0 &&
        Number.isFinite(naturalHeight) &&
        naturalHeight > 0
          ? {
              naturalWidth,
              naturalHeight,
            }
          : await new Promise<{ naturalWidth: number; naturalHeight: number }>((resolve, reject) => {
              const img = new window.Image();
              img.onload = () => {
                resolve({
                  naturalWidth: img.width,
                  naturalHeight: img.height,
                });
              };
              img.onerror = () => reject(new Error('图片加载失败'));
              img.src = src;
            });

      recordCurrentCanvasUndoSnapshot();
      setItems((prev) => {
        const displaySize = getConstrainedImageDisplaySize(
          resolvedMeta.naturalWidth,
          resolvedMeta.naturalHeight
        );
        const sourceItem = prev.find((item) => item.id === sourceItemId) ?? null;
        const spawnPosition = sourceItem
          ? getImageToolResultSpawnPosition({
              sourceItem,
              nextSize: displaySize,
            })
          : getSpawnPosition(displaySize);
        const newItem = createImageCanvasItem({
          id: `cutout-image-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          src,
          naturalWidth: resolvedMeta.naturalWidth,
          naturalHeight: resolvedMeta.naturalHeight,
          x: spawnPosition.x,
          y: spawnPosition.y,
        });

        return [...prev, newItem];
      });
    },
    [getSpawnPosition, recordCurrentCanvasUndoSnapshot, setItems]
  );

  const replaceImageAssetItemFromFile = useCallback(
    async (itemId: string, file: File) => {
      const base64Data = await readAsDataURL(file);
      const fallbackName = file.name || `pasted-${Date.now()}.${file.type.split('/')[1] || 'png'}`;
      const response = await fetch('/api/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageData: base64Data,
          fileName: fallbackName,
        }),
      });

      if (!response.ok) {
        throw new Error(`Upload failed: ${response.status}`);
      }

      const data = await response.json();
      const imageUrl = data.url;

      const imageMeta = await new Promise<{ src: string; naturalWidth: number; naturalHeight: number }>((resolve, reject) => {
        const img = new window.Image();
        img.onload = () => {
          resolve({
            src: imageUrl,
            naturalWidth: img.width,
            naturalHeight: img.height,
          });
        };
        img.onerror = () => reject(new Error('图片加载失败'));
        img.src = imageUrl;
      });

      recordCurrentCanvasUndoSnapshot();
      setItems((prev) =>
        prev.map((item) => (item.id === itemId ? getReplacedImageAssetItem(item, imageMeta) : item))
      );
    },
    [recordCurrentCanvasUndoSnapshot, setItems]
  );

  const uploadImageFilesToCanvas = useCallback(
    async (files: File[], fallbackPrefix: 'upload' | 'pasted' = 'upload') => {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        try {
          const base64Data = await readAsDataURL(file);
          const fallbackName =
            file.name || `${fallbackPrefix}-${Date.now()}-${i + 1}.${file.type.split('/')[1] || 'png'}`;
          await addImageToCanvas(base64Data, fallbackName, i);
        } catch (error) {
          console.error(
            fallbackPrefix === 'pasted' ? 'Canvas paste upload failed:' : 'Upload failed:',
            error
          );
        }
      }
    },
    [addImageToCanvas]
  );

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;

    await uploadImageFilesToCanvas(Array.from(files), 'upload');
    e.target.value = '';
  };

  const getPrimarySelectedId = useCallback((ids: string[]) => ids[0] || null, []);

  const centerViewportOnPastedCanvasItems = useCallback(
    (currentViewport: { x: number; y: number; scale: number }, items: CanvasItem[]) => {
      const canvasElement = canvasRef.current;
      const pastedItemsBounds = getCanvasItemsVisualBounds(items);
      if (!canvasElement || !pastedItemsBounds) {
        return currentViewport;
      }

      return getViewportCenteredOnBounds(
        currentViewport,
        pastedItemsBounds,
        canvasElement.clientWidth,
        canvasElement.clientHeight
      );
    },
    []
  );

  const handleCanvasPaste = useCallback(
    async (e: React.ClipboardEvent<HTMLDivElement> | ClipboardEvent) => {
      if (!shouldHandleCanvasImagePaste(e.target)) {
        return;
      }

      const imageFiles = extractImageFilesFromClipboardItems(e.clipboardData?.items);
      if (imageFiles.length > 0) {
        e.preventDefault();
        const pasteTarget = resolveCanvasImagePasteTarget({
          selectedId: selectedImageAssetItem?.id ?? selectedId,
          selectedIds,
          itemById,
        });
        if (pasteTarget.mode === 'replace') {
          await replaceImageAssetItemFromFile(pasteTarget.itemId, imageFiles[0]);
          return;
        }
        await uploadImageFilesToCanvas(imageFiles, 'pasted');
        return;
      }

      const pastedCanvasClipboard = materializeCanvasClipboardPaste({
        clipboard: canvasClipboardRef.current?.snapshot,
        pasteCount: canvasClipboardRef.current?.pasteCount ?? 0,
        offsetStep: CANVAS_CLIPBOARD_PASTE_OFFSET,
        createId: (sourceId: string, index: number) =>
          `${sourceId}-copy-${Date.now()}-${index + 1}-${Math.random().toString(36).slice(2, 7)}`,
      }) as MaterializedCanvasClipboardPaste | null;

      if (!pastedCanvasClipboard) {
        return;
      }

      e.preventDefault();
      recordCurrentCanvasUndoSnapshot();
      setItems((prev) => [...prev, ...pastedCanvasClipboard.items]);
      setTextCardPanelDrafts((prev) => ({ ...prev, ...pastedCanvasClipboard.textCardPanelDrafts }));
      setTextCardProviderById((prev) => ({ ...prev, ...pastedCanvasClipboard.textCardProviderById }));
      setTextCardModelById((prev) => ({ ...prev, ...pastedCanvasClipboard.textCardModelById }));
      setImageCardPanelDrafts((prev) => ({ ...prev, ...pastedCanvasClipboard.imageCardPanelDrafts }));
      setImageCardProviderById((prev) => ({ ...prev, ...pastedCanvasClipboard.imageCardProviderById }));
      setImageCardModelById((prev) => ({ ...prev, ...pastedCanvasClipboard.imageCardModelById }));
      setImageCardSizeById((prev) => ({ ...prev, ...pastedCanvasClipboard.imageCardSizeById }));
      setImageCardQualityById((prev) => ({ ...prev, ...pastedCanvasClipboard.imageCardQualityById }));
      setImageCardCountById((prev) => ({ ...prev, ...pastedCanvasClipboard.imageCardCountById }));
      setImageCardAspectRatioById((prev) => ({ ...prev, ...pastedCanvasClipboard.imageCardAspectRatioById }));
      setSelectedConnectionIds([]);
      setSelectedIds(pastedCanvasClipboard.selectedIds);
      setSelectedId(getPrimarySelectedId(pastedCanvasClipboard.selectedIds));
      animateViewportToRef.current(centerViewportOnPastedCanvasItems(visualViewportRef.current, pastedCanvasClipboard.items));

      canvasClipboardRef.current = {
        snapshot: canvasClipboardRef.current?.snapshot ?? null,
        pasteCount: pastedCanvasClipboard.nextPasteCount,
      };
    },
    [
      getPrimarySelectedId,
      itemById,
      recordCurrentCanvasUndoSnapshot,
      replaceImageAssetItemFromFile,
      selectedId,
      selectedIds,
      selectedImageAssetItem?.id,
      setImageCardAspectRatioById,
      setImageCardCountById,
      setImageCardModelById,
      setImageCardPanelDrafts,
      setImageCardProviderById,
      setImageCardQualityById,
      setImageCardSizeById,
      setItems,
      setTextCardModelById,
      setTextCardPanelDrafts,
      setTextCardProviderById,
      uploadImageFilesToCanvas,
      centerViewportOnPastedCanvasItems,
    ]
  );

  const appendChatReferenceSources = useCallback((
    sources: Array<string | Pick<GeneratedImageHistoryEntry, 'src' | 'taskId' | 'versionId'>>,
    source: Exclude<ChatReferenceTokenSource, 'canvas'>
  ) => {
    setChatReferenceTokens((currentTokens) => {
      const existingSources = new Set(currentTokens.map((token) => token.src));
      const nextTokens = [...currentTokens];
      for (const sourceEntry of sources) {
        const src = typeof sourceEntry === 'string' ? sourceEntry : sourceEntry.src;
        if (!src || existingSources.has(src) || nextTokens.length >= 14) continue;
        existingSources.add(src);
        nextTokens.push({
          id: `${source}:${Date.now()}:${Math.random().toString(36).slice(2, 7)}`,
          src,
          label: getReferenceTokenLabel(src, source === 'upload' ? '上传图片' : '历史图片'),
          source,
          transient: false,
          pinned: false,
          role: 'reference',
          ...(source === 'history' && typeof sourceEntry !== 'string' && sourceEntry.taskId
            ? { sourceTaskId: sourceEntry.taskId }
            : {}),
          ...(source === 'history' && typeof sourceEntry !== 'string' && sourceEntry.versionId
            ? { sourceVersionId: sourceEntry.versionId }
            : {}),
        });
      }
      return nextTokens;
    });
  }, []);

  const handleChatImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;

    const currentCount = chatReferenceTokenCount;
    const remainingSlots = 14 - currentCount;
    
    if (remainingSlots <= 0) {
      alert('最多只能上传14张参考图');
      return;
    }

    const filesToProcess = Array.from(files).slice(0, remainingSlots);

    if (!isGeneratingRef.current) enqueueChatReferenceUploads(filesToProcess);
    
    e.target.value = '';
  };

  const handleChatPaste = async (e: React.ClipboardEvent<HTMLDivElement>) => {
    const imageFiles = extractImageFilesFromClipboardItems(e.clipboardData.items);

    if (imageFiles.length === 0) {
      const text = e.clipboardData.getData('text/plain');
      if (!text) return;
      e.preventDefault();
      const selection = window.getSelection();
      if (selection && selection.rangeCount > 0) {
        const range = selection.getRangeAt(0);
        range.deleteContents();
        const node = document.createTextNode(text);
        range.insertNode(node);
        range.setStartAfter(node);
        range.collapse(true);
        selection.removeAllRanges();
        selection.addRange(range);
      } else {
        document.execCommand('insertText', false, text);
      }
      const editor = chatInputEditorRef.current;
      const nextSegments = editor ? parseChatEditorSegments(editor) : [{ type: 'text' as const, text: '' }];
      const editorText = getChatComposerPlainText(nextSegments);
      chatComposerSegmentsRef.current = nextSegments;
      latestChatInputRef.current = editorText;
      syncChatComposerControls(editorText);
      syncEditorHeight();
      rememberChatEditorCaretOffset();
      return;
    }

    e.preventDefault();

    const currentCount = chatReferenceTokenCount;
    const remainingSlots = 14 - currentCount;

    if (remainingSlots <= 0) {
      alert('最多只能上传14张参考图');
      return;
    }

    const filesToProcess = imageFiles.slice(0, remainingSlots);

    if (!isGeneratingRef.current) enqueueChatReferenceUploads(filesToProcess);
  };

  const recordChatInputPerformance = useCallback((duration: number) => {
    if (!canvasPerformanceEnabledRef.current) return;
    const samples = chatInputPerformanceSamplesRef.current;
    if (samples.length >= 120) samples.shift();
    samples.push(duration);
    if (samples.length < 30 || samples.length % 30 !== 0) return;
    const sorted = [...samples].sort((left, right) => left - right);
    const at = (ratio: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * ratio))] || 0;
    console.info('[chat-input-perf]', {
      sampleCount: samples.length,
      p50: at(0.5),
      p95: at(0.95),
      p99: at(0.99),
    });
  }, []);

  const handleChatEditorInput = () => {
    const editor = chatInputEditorRef.current;
    if (!editor) return;
    const startedAt = performance.now();
    const nextSegments = parseChatEditorSegments(editor);
    const previousTokenIds = new Set(
      chatComposerSegmentsRef.current
        .filter((segment): segment is Extract<ChatComposerSegment, { type: 'reference' }> => segment.type === 'reference')
        .map((segment) => segment.tokenId)
    );
    const nextTokenIds = new Set(
      nextSegments
        .filter((segment): segment is Extract<ChatComposerSegment, { type: 'reference' }> => segment.type === 'reference')
        .map((segment) => segment.tokenId)
    );
    const removedTokenIds = [...previousTokenIds].filter((tokenId) => !nextTokenIds.has(tokenId));
    if (removedTokenIds.length > 0) {
      const removedTokens = resolvedChatReferenceTokens.filter((token) => removedTokenIds.includes(token.id));
      removedTokens.forEach((token) => {
        if (token.source === 'canvas' && token.canvasItemId) {
          dismissedCanvasReferenceIdsRef.current.add(token.canvasItemId);
        }
      });
      setChatReferenceTokens((tokens) => tokens.filter((token) => !removedTokenIds.includes(token.id)));
    }
    chatComposerSegmentsRef.current = nextSegments;
    const editorText = getChatComposerPlainText(nextSegments);
    latestChatInputRef.current = editorText;
    syncChatComposerControls(editorText);
    syncEditorHeight();
    recordChatInputPerformance(performance.now() - startedAt);
  };

  const handleChatCompositionStart = () => {
    isChatInputComposingRef.current = true;
  };

  const handleChatCompositionEnd = () => {
    isChatInputComposingRef.current = false;
    const programmaticValue = pendingProgrammaticChatInputRef.current;
    pendingProgrammaticChatInputRef.current = null;
    if (programmaticValue === null) {
      handleChatEditorInput();
    } else {
      latestChatInputRef.current = programmaticValue;
    }
    const shouldSyncEditor = pendingChatEditorSyncRef.current || programmaticValue !== null;
    const moveCaretToEnd = pendingChatEditorMoveCaretToEndRef.current;
    pendingChatEditorSyncRef.current = false;
    pendingChatEditorMoveCaretToEndRef.current = false;
    if (shouldSyncEditor) {
      syncEditorTextFromState(latestChatInputRef.current, moveCaretToEnd);
      syncChatComposerControls(latestChatInputRef.current);
      lastSyncedChatInputRevisionRef.current = chatInputSyncRevision;
    }
    rememberChatEditorCaretOffset();
  };

  const handleSelectedTextCardPanelInputChange = useCallback(
    (value: string) => {
      if (!selectedTextCardPanelItem) return;
      capturePendingCanvasUndoSnapshot();
      setCanvasTextGenerationErrorById((prev) => {
        if (!prev[selectedTextCardPanelItem.id]) return prev;
        const next = { ...prev };
        delete next[selectedTextCardPanelItem.id];
        return next;
      });
      setTextCardPanelDrafts((prev) => ({
        ...prev,
        [selectedTextCardPanelItem.id]: value,
      }));
    },
    [capturePendingCanvasUndoSnapshot, selectedTextCardPanelItem, setTextCardPanelDrafts]
  );

  const handleSelectedImageCardPanelInputChange = useCallback(
    (value: string) => {
      if (!selectedImageCardPanelItem) return;
      capturePendingCanvasUndoSnapshot();
      setCanvasImageGenerationErrorById((prev) => {
        if (!prev[selectedImageCardPanelItem.id]) return prev;
        const next = { ...prev };
        delete next[selectedImageCardPanelItem.id];
        return next;
      });
      setImageCardPanelDrafts((prev) => ({
        ...prev,
        [selectedImageCardPanelItem.id]: value,
      }));
    },
    [capturePendingCanvasUndoSnapshot, selectedImageCardPanelItem, setImageCardPanelDrafts]
  );

  const handleManualTextCardInputChange = useCallback((itemId: string, value: string) => {
    setItems((prev) =>
      prev.map((item) =>
        item.id === itemId
          ? {
              ...item,
              text: value,
              textMode: 'manual',
            }
          : item
      )
    );
  }, [setItems]);

  const handleAnnotationTextChange = useCallback((itemId: string, value: string, height: number) => {
    setItems((prev) =>
      prev.map((item) =>
        item.id === itemId && isCanvasAnnotationTextItem(item)
          ? {
              ...item,
              text: value,
              height: Math.max(ANNOTATION_TEXT_DEFAULT_HEIGHT, height),
            }
          : item
      )
    );
  }, [setItems]);

  const finalizeAnnotationTextEditing = (itemId: string) => {
    const shouldDelete = !(itemsRef.current.find((candidate) => candidate.id === itemId)?.text || '').trim();
    setItems((prev) => {
      const item = prev.find((candidate) => candidate.id === itemId);
      if (!item || !isCanvasAnnotationTextItem(item)) return prev;
      if (!(item.text || '').trim()) {
        return prev.filter((candidate) => candidate.id !== itemId);
      }
      return prev;
    });
    if (shouldDelete) {
      setSelectedIds((current) => current.filter((id) => id !== itemId));
      setSelectedId((current) => (current === itemId ? null : current));
    }
    setEditingAnnotationTextId((current) => (current === itemId ? null : current));
    setTool('select');
    if (currentSessionIdRef.current) scheduleCurrentSessionSave();
  };

  const handleImageCardOutputSelect = useCallback((itemId: string, outputIndex: number) => {
    recordCurrentCanvasUndoSnapshot();
    setItems((prev) =>
      prev.map((item) => {
        if (item.id !== itemId || !Array.isArray(item.imageOutputs) || item.imageOutputs.length === 0) {
          return item;
        }

        const nextOutputState = buildImageCardOutputsState(item.imageOutputs, outputIndex);
        return {
          ...resizeImageCardItemToNaturalImage(
            {
              ...item,
              ...nextOutputState,
            },
            nextOutputState.naturalWidth ?? item.naturalWidth ?? IMAGE_CARD_DEFAULT_FRAME_WIDTH,
            nextOutputState.naturalHeight ?? item.naturalHeight ?? IMAGE_CARD_DEFAULT_FRAME_WIDTH
          ),
          ...nextOutputState,
        };
      })
    );
  }, [recordCurrentCanvasUndoSnapshot, setItems]);

  const finalizeManualTextCardEditing = useCallback((itemId: string) => {
    commitPendingCanvasUndoSnapshot();
    setItems((prev) =>
      prev.map((item) => (item.id === itemId ? finalizeManualTextCardItem(item) : item))
    );
    setEditingTextCardId((prev) => (prev === itemId ? null : prev));
  }, [commitPendingCanvasUndoSnapshot, setItems]);

  const handleTextCardDoubleClick = useCallback((itemId: string) => {
    const item = itemsRef.current.find((entry) => entry.id === itemId);
    if (!item || item.type !== 'text' || item.textVariant !== 'card') return;

    if (item.textMode === 'manual') {
      pendingCanvasHistorySnapshotRef.current = createCurrentCanvasUndoSnapshot();
      setEditingTextCardId(itemId);
      return;
    }

    if (
      !canEnterManualTextMode({
        item,
        items: itemsRef.current,
        connections,
        generatingItemIds: activeCanvasTextGenerationItemIds,
      })
    ) {
      return;
    }

    pendingCanvasHistorySnapshotRef.current = createCurrentCanvasUndoSnapshot();
    setItems((prev) =>
      prev.map((entry) =>
        entry.id === itemId
          ? {
              ...entry,
              textMode: 'manual',
            }
          : entry
      )
    );
    setEditingTextCardId(itemId);
  }, [activeCanvasTextGenerationItemIds, connections, createCurrentCanvasUndoSnapshot, setItems]);

  const handleCanvasItemDoubleClick = useCallback((itemId: string) => {
    const item = itemsRef.current.find((candidate) => candidate.id === itemId);
    if (isCanvasAnnotationTextItem(item)) {
      if (editingAnnotationTextId !== itemId) {
        recordCurrentCanvasUndoSnapshot();
      }
      setEditingAnnotationTextId(itemId);
      setSelectedConnectionIds([]);
      setSelectedId(itemId);
      setSelectedIds([itemId]);
      return;
    }
    handleTextCardDoubleClick(itemId);
  }, [editingAnnotationTextId, handleTextCardDoubleClick, recordCurrentCanvasUndoSnapshot]);

  useEffect(() => {
    setTextCardPanelDrafts((prev) => {
      const next = normalizeTextCardPanelDrafts(prev, items);
      const prevKeys = Object.keys(prev);
      const nextKeys = Object.keys(next);

      if (
        prevKeys.length === nextKeys.length &&
        prevKeys.every((key) => prev[key] === next[key])
      ) {
        return prev;
      }

      return next;
    });
  }, [items, setTextCardPanelDrafts]);

  const handleChatEditorKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.nativeEvent.isComposing || isChatInputComposingRef.current) return;

    if ((e.key === 'Backspace' || e.key === 'Delete') && activeSkill && isCaretAtEditorStart()) {
      e.preventDefault();
      setActiveSkillForCurrentTopic(null);
      return;
    }

    if (e.key === 'Enter' && !e.shiftKey && !e.altKey) {
      e.preventDefault();
      if (isGenerating) {
        void handleCancelGenerate();
      } else if (!hasPendingChatReferenceUploads) {
        void handleGenerate();
      }
    }
  };

  const removeChatReferenceToken = (token: ChatReferenceToken) => {
    if (token.source === 'canvas' && token.canvasItemId) {
      dismissedCanvasReferenceIdsRef.current.add(token.canvasItemId);
    }
    if (token.previewObjectUrl) URL.revokeObjectURL(token.previewObjectUrl);
    if (token.regionId) {
      setActiveRegionMenuId((current) => current === token.regionId ? null : current);
    }
    setChatReferenceTokens((tokens) => tokens.filter((candidate) => candidate.id !== token.id));
  };

  const toggleChatReferenceTokenPin = (targetToken: ChatReferenceToken) => {
    setChatReferenceTokens((tokens) => {
      if (targetToken.source === 'canvas') {
        if (targetToken.pinned) {
          return tokens.filter((token) => token.id !== targetToken.id);
        }
        return [
          ...tokens.filter((token) => token.canvasItemId !== targetToken.canvasItemId),
          { ...targetToken, pinned: true, transient: false },
        ].slice(0, 14);
      }

      return tokens.map((token) =>
        token.id === targetToken.id ? { ...token, pinned: !token.pinned } : token
      );
    });
  };

  const reorderChatImages = (fromIndex: number, toIndex: number) => {
    if (fromIndex === toIndex) return;
    setChatReferenceTokens((prev) => {
      const next = [...prev];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      return next;
    });
  };

  const handleReferenceDragStart = (index: number) => {
    setDraggingImageIndex(index);
  };

  const handleReferenceDragOver = (e: React.DragEvent<HTMLDivElement>, index: number) => {
    e.preventDefault();
    if (dragOverImageIndex !== index) {
      setDragOverImageIndex(index);
    }
  };

  const handleReferenceDrop = (e: React.DragEvent<HTMLDivElement>, index: number) => {
    e.preventDefault();
    if (draggingImageIndex !== null) {
      reorderChatImages(draggingImageIndex, index);
    }
    setDraggingImageIndex(null);
    setDragOverImageIndex(null);
  };

  const handleReferenceDragEnd = () => {
    setDraggingImageIndex(null);
    setDragOverImageIndex(null);
  };

  const handlePanelReferenceDragStart = useCallback(
    (e: React.DragEvent<HTMLDivElement>, targetItemId: string, sourceItemId: string) => {
      e.stopPropagation();
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', sourceItemId);
      setDraggingPanelReference({
        targetItemId,
        sourceItemId,
      });
      setDragOverPanelReference(null);
    },
    []
  );

  const handlePanelReferenceDragOver = useCallback(
    (e: React.DragEvent<HTMLDivElement>, targetItemId: string, sourceItemId: string) => {
      if (!draggingPanelReference || draggingPanelReference.targetItemId !== targetItemId) {
        return;
      }

      e.preventDefault();
      e.stopPropagation();
      if (
        !dragOverPanelReference ||
        dragOverPanelReference.targetItemId !== targetItemId ||
        dragOverPanelReference.sourceItemId !== sourceItemId
      ) {
        setDragOverPanelReference({
          targetItemId,
          sourceItemId,
        });
      }
    },
    [dragOverPanelReference, draggingPanelReference]
  );

  const handlePanelReferenceDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>, targetItemId: string, sourceItemId: string) => {
      if (!draggingPanelReference || draggingPanelReference.targetItemId !== targetItemId) {
        return;
      }

      e.preventDefault();
      e.stopPropagation();

      if (draggingPanelReference.sourceItemId !== sourceItemId) {
        recordCurrentCanvasUndoSnapshot();
        setConnections((prev) =>
          reorderIncomingImageConnections({
            connections: prev,
            itemById: Object.fromEntries(itemsRef.current.map((item) => [item.id, item] as const)),
            targetItemId,
            fromImageItemId: draggingPanelReference.sourceItemId,
            toImageItemId: sourceItemId,
          })
        );
      }

      setDraggingPanelReference(null);
      setDragOverPanelReference(null);
    },
    [draggingPanelReference, recordCurrentCanvasUndoSnapshot, setConnections]
  );

  const handlePanelReferenceDragEnd = useCallback(() => {
    setDraggingPanelReference(null);
    setDragOverPanelReference(null);
  }, []);

  const addShape = (shapeType: 'rectangle' | 'circle') => {
    const newItem: CanvasItem = {
      id: `shape-${Date.now()}`,
      type: 'shape',
      ...getSpawnPosition({ width: 100, height: 100 }),
      width: 100,
      height: 100,
      rotation: 0,
      fill: '#3b82f6',
      visible: true,
      locked: false,
    };
    recordCurrentCanvasUndoSnapshot();
    setItems(prev => [...prev, newItem]);
  };

  const addText = () => {
    const newItem: CanvasItem = {
      id: `text-${Date.now()}`,
      type: 'text',
      ...getSpawnPosition({
        width: TEXT_CARD_DIMENSIONS.width,
        height: TEXT_CARD_DIMENSIONS.height,
      }),
      width: TEXT_CARD_DIMENSIONS.width,
      height: TEXT_CARD_DIMENSIONS.height,
      rotation: 0,
      textVariant: 'card',
      textMode: 'ai',
      visible: true,
      locked: false,
    };
    recordCurrentCanvasUndoSnapshot();
    setItems(prev => [...prev, newItem]);
    setSelectedConnectionIds([]);
    setSelectedId(newItem.id);
    setSelectedIds([newItem.id]);
  };

  const createAnnotationTextAtCanvasPoint = useCallback((canvasPoint: { x: number; y: number }) => {
    const newItem: CanvasItem = {
      id: `annotation-text-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      type: 'text',
      textVariant: 'annotation',
      text: '',
      textColor: annotationColor,
      fontSize: ANNOTATION_TEXT_DEFAULT_FONT_SIZE,
      x: canvasPoint.x,
      y: canvasPoint.y,
      width: ANNOTATION_TEXT_DEFAULT_WIDTH,
      height: ANNOTATION_TEXT_DEFAULT_HEIGHT,
      rotation: 0,
      visible: true,
      locked: false,
    };
    recordCurrentCanvasUndoSnapshot();
    setItems((prev) => [...prev, newItem]);
    setSelectedConnectionIds([]);
    setSelectedId(newItem.id);
    setSelectedIds([newItem.id]);
    setEditingAnnotationTextId(newItem.id);
    setTool('select');
  }, [annotationColor, recordCurrentCanvasUndoSnapshot, setItems]);

  const addImageCard = useCallback(() => {
    const newItem: CanvasItem = {
      id: `image-card-${Date.now()}`,
      type: 'image',
      ...getSpawnPosition({
        width: IMAGE_CARD_DIMENSIONS.width,
        height: IMAGE_CARD_DIMENSIONS.height,
      }),
      width: IMAGE_CARD_DIMENSIONS.width,
      height: IMAGE_CARD_DIMENSIONS.height,
      rotation: 0,
      imageVariant: 'card',
      visible: true,
      locked: false,
    };
    recordCurrentCanvasUndoSnapshot();
    setItems((prev) => [...prev, newItem]);
    setSelectedConnectionIds([]);
    setSelectedId(newItem.id);
    setSelectedIds([newItem.id]);
  }, [getSpawnPosition, recordCurrentCanvasUndoSnapshot, setItems]);

  const createTextItemAtCanvasPoint = useCallback((canvasPoint: { x: number; y: number }) => {
    const newItem = createCanvasCardItemAtCanvasPoint({
      kind: 'text',
      id: `text-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      canvasPoint,
      width: TEXT_CARD_DIMENSIONS.width,
      height: TEXT_CARD_DIMENSIONS.height,
    }) as CanvasItem;

    setItems((prev) => [...prev, newItem]);
    setSelectedConnectionIds([]);
    setSelectedId(newItem.id);
    setSelectedIds([newItem.id]);

    return newItem;
  }, [setItems]);

  const createImageCardItemAtCanvasPoint = useCallback((canvasPoint: { x: number; y: number }) => {
    const newItem = createCanvasCardItemAtCanvasPoint({
      kind: 'image',
      id: `image-card-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      canvasPoint,
      width: IMAGE_CARD_DIMENSIONS.width,
      height: IMAGE_CARD_DIMENSIONS.height,
    }) as CanvasItem;

    setItems((prev) => [...prev, newItem]);
    setSelectedConnectionIds([]);
    setSelectedId(newItem.id);
    setSelectedIds([newItem.id]);

    return newItem;
  }, [setItems]);

  const getConnectionAnchorCanvasPoint = useCallback((item: CanvasItem, side: 'left' | 'right') => ({
    x:
      side === 'left'
        ? item.x - CONNECTION_ANCHOR_EDGE_GAP
        : item.x + item.width + CONNECTION_ANCHOR_EDGE_GAP,
    y: item.y + item.height / 2,
  }), []);

  const toCanvasScreenPoint = useCallback((point: { x: number; y: number }) => ({
    x: point.x * viewport.scale + viewport.x,
    y: point.y * viewport.scale + viewport.y,
  }), [viewport.scale, viewport.x, viewport.y]);

  const selectedImageToolbarItem = selectedImageToolbarTarget
    ? itemById[selectedImageToolbarTarget.itemId] ?? null
    : null;
  const selectedImageToolbarBounds = selectedImageToolbarItem
    ? getItemVisualBounds(selectedImageToolbarItem)
    : null;
  const selectedImageToolbarAnchors = selectedImageToolbarBounds
    ? resolveCanvasFixedOverlayAnchors({
        bounds: selectedImageToolbarBounds,
        viewport,
        canvasOrigin: {
          x: canvasMetricsRef.current.left,
          y: canvasMetricsRef.current.top,
        },
        gap: IMAGE_NODE_OVERLAY_GAP_PX,
      })
    : null;

  const getCanvasItemOverlayGroup = useCallback((kind: CanvasItemOverlayKind) => {
    const root = getViewportOverlay(kind);
    const itemId = root?.dataset.canvasOverlayItemId;
    if (!root || !itemId) return null;
    return { kind, itemId, root } satisfies CanvasItemOverlayGroup;
  }, [getViewportOverlay]);

  const hideCanvasSelectionOverlayGroups = useCallback(() => {
    const snapshots: CanvasOverlayVisibilitySnapshot[] = [];
    for (const kind of [
      'selected-image-toolbar',
      'selected-image-panel',
      'selected-text-panel',
    ] as const) {
      const group = getCanvasItemOverlayGroup(kind);
      if (!group) continue;
      snapshots.push({
        root: group.root,
        visibility: group.root.style.visibility,
        pointerEvents: group.root.style.pointerEvents,
      });
      group.root.style.visibility = 'hidden';
      group.root.style.pointerEvents = 'none';
    }
    return snapshots;
  }, [getCanvasItemOverlayGroup]);

  const revealCanvasSelectionOverlayGroups = useCallback(() => {
    for (const kind of [
      'selected-image-toolbar',
      'selected-image-panel',
      'selected-text-panel',
    ] as const) {
      const group = getCanvasItemOverlayGroup(kind);
      if (!group) continue;
      group.root.style.visibility = '';
      group.root.style.pointerEvents = '';
    }
  }, [getCanvasItemOverlayGroup]);

  const restoreCanvasOverlayVisibility = useCallback((
    snapshots: readonly CanvasOverlayVisibilitySnapshot[]
  ) => {
    snapshots.forEach((snapshot) => {
      if (!snapshot.root.isConnected) return;
      snapshot.root.style.visibility = snapshot.visibility;
      snapshot.root.style.pointerEvents = snapshot.pointerEvents;
    });
  }, []);

  const writeCanvasOverlayTransform = useCallback((element: HTMLElement, transform: string) => {
    if (
      canvasOverlayTransformCacheRef.current.get(element) === transform
      && element.style.transform === transform
    ) {
      return false;
    }
    canvasOverlayTransformCacheRef.current.set(element, transform);
    element.style.transform = transform;
    return true;
  }, []);

  const syncSelectedCanvasOverlayPositions = useCallback((
    activeViewport: ViewportState,
    changedItemIds?: readonly string[]
  ) => {
    const canvasMetrics = canvasMetricsRef.current;
    const shouldSyncItem = (itemId: string | undefined) => (
      Boolean(itemId) && (!changedItemIds || changedItemIds.includes(itemId!))
    );
    let syncWriteCount = 0;
    const toolbarGroup = getCanvasItemOverlayGroup('selected-image-toolbar');
    if (toolbarGroup) {
      const { itemId, root } = toolbarGroup;
      const item = shouldSyncItem(itemId) && itemId ? itemByIdRef.current.get(itemId) : null;
      if (item && (isImageAssetItem(item) || isImageCardItem(item))) {
        const anchors = resolveCanvasFixedOverlayAnchors({
          bounds: getItemVisualBounds(item),
          viewport: activeViewport,
          canvasOrigin: { x: canvasMetrics.left, y: canvasMetrics.top },
          gap: IMAGE_NODE_OVERLAY_GAP_PX,
        });
        if (writeCanvasOverlayTransform(
          root,
          `translate3d(${anchors.centerX}px, ${anchors.topToolbarY}px, 0) translate(-50%, -100%)`
        )) syncWriteCount += 1;
      }
    }
    const imagePanelGroup = getCanvasItemOverlayGroup('selected-image-panel');
    if (imagePanelGroup) {
      const { itemId, root } = imagePanelGroup;
      const item = shouldSyncItem(itemId) && itemId ? itemByIdRef.current.get(itemId) : null;
      if (item && isImageCardItem(item)) {
        const anchors = resolveCanvasFixedOverlayAnchors({
          bounds: getItemVisualBounds(item),
          viewport: activeViewport,
          canvasOrigin: { x: canvasMetrics.left, y: canvasMetrics.top },
          gap: IMAGE_NODE_OVERLAY_GAP_PX,
        });
        if (writeCanvasOverlayTransform(
          root,
          `translate3d(${anchors.centerX - IMAGE_CARD_GENERATION_PANEL_DEFAULT_WIDTH / 2}px, ${anchors.bottomPanelY}px, 0)`
        )) syncWriteCount += 1;
      }
    }
    const textPanelGroup = getCanvasItemOverlayGroup('selected-text-panel');
    if (textPanelGroup) {
      const { itemId, root } = textPanelGroup;
      const item = shouldSyncItem(itemId) && itemId ? itemByIdRef.current.get(itemId) : null;
      if (item?.type === 'text' && item.textVariant === 'card') {
        const frameBounds = getTextCardFrameBounds(item);
        const panelWidth = Math.max(TEXT_CARD_GENERATION_PANEL_DEFAULT_WIDTH, frameBounds.width);
        const centerX = canvasMetrics.left + activeViewport.x + (
          item.x + frameBounds.left + frameBounds.width / 2
        ) * activeViewport.scale;
        const bottomY = canvasMetrics.top + activeViewport.y + (
          item.y + frameBounds.top + frameBounds.height
        ) * activeViewport.scale;
        if (writeCanvasOverlayTransform(
          root,
          `translate3d(${centerX - panelWidth / 2}px, ${bottomY + 18}px, 0)`
        )) syncWriteCount += 1;
      }
    }
    if (canvasPerformanceEnabledRef.current) {
      canvasOverlaySyncWriteCountRef.current += syncWriteCount;
    }
  }, [getCanvasItemOverlayGroup, writeCanvasOverlayTransform]);

  const buildConnectionPath = useCallback((from: { x: number; y: number }, to: { x: number; y: number }) => {
    const dx = Math.max(64, Math.abs(to.x - from.x) * 0.42);
    const c1x = from.x + dx;
    const c2x = to.x - dx;
    return `M ${from.x} ${from.y} C ${c1x} ${from.y}, ${c2x} ${to.y}, ${to.x} ${to.y}`;
  }, []);

  const clearPendingConnectionMenu = useCallback(() => {
    setPendingConnectionMenu(null);
    setFrozenPreviewConnection(null);
  }, []);

  const toCanvasPoint = useCallback((screenPoint: { x: number; y: number }) => {
    const activeViewport = visualViewportRef.current;
    return {
      x: (screenPoint.x - activeViewport.x) / activeViewport.scale,
      y: (screenPoint.y - activeViewport.y) / activeViewport.scale,
    };
  }, []);

  const clearConnectionSnapTargetVisual = useCallback(() => {
    const visual = connectionSnapTargetVisualRef.current;
    if (!visual) return;
    connectionSnapTargetVisualRef.current = null;
    visual.element.style.opacity = visual.opacity;
    visual.element.style.visibility = visual.visibility;
    visual.element.style.pointerEvents = visual.pointerEvents;
    visual.element.style.willChange = visual.willChange;
  }, []);
  clearConnectionSnapTargetVisualRef.current = clearConnectionSnapTargetVisual;

  const setConnectionSnapTargetVisual = useCallback((itemId: string | null) => {
    if (connectionSnapTargetVisualRef.current?.itemId === itemId) return;
    clearConnectionSnapTargetVisual();
    if (!itemId) return;
    const element = getItemTargets([itemId]).find((target) => target.role === 'input-port')?.element;
    if (!element) return;
    connectionSnapTargetVisualRef.current = {
      itemId,
      element,
      opacity: element.style.opacity,
      visibility: element.style.visibility,
      pointerEvents: element.style.pointerEvents,
      willChange: element.style.willChange,
    };
    element.style.opacity = '1';
    element.style.visibility = 'visible';
    element.style.pointerEvents = 'none';
    element.style.willChange = 'opacity';
  }, [clearConnectionSnapTargetVisual, getItemTargets]);

  const beginConnectionDragFromItem = (
    item: CanvasItem,
    pointerId: number,
    clientX: number,
    clientY: number
  ) => {
    interruptCanvasCommitForInteraction('connection-drag');
    if (isPanningRef.current) {
      cancelInteraction('viewport-handoff');
      cancelViewportAnimation(false);
    }
    clearPendingConnectionMenu();
    clearConnectionSnapTargetVisual();
    setCanvasConnectionHitTestingDisabled(true);
    if (selectedConnectionIdsRef.current.length > 0) {
      selectedConnectionIdsRef.current = [];
      setSelectedConnectionIds([]);
      stageCanvasCommit({ selectedConnectionIds: [] });
    }

    connectionDragMovedRef.current = false;
    const activeViewport = visualViewportRef.current;
    const toVisualScreenPoint = (point: { x: number; y: number }) => ({
      x: point.x * activeViewport.scale + activeViewport.x,
      y: point.y * activeViewport.scale + activeViewport.y,
    });
    const portPoint = toVisualScreenPoint(getConnectionAnchorCanvasPoint(item, 'right'));
    const initialPoint = { x: portPoint.x + 12, y: portPoint.y };
    const inputPortCandidates = itemsRef.current.flatMap((candidate) => {
      if (candidate.id === item.id || !canItemAcceptIncomingConnection(candidate)) return [];
      const point = toVisualScreenPoint(getConnectionAnchorCanvasPoint(candidate, 'left'));
      return [{ targetId: candidate.id, x: point.x, y: point.y }];
    });
    connectionSessionRef.current = {
      mode: 'dragging',
      fromItemId: item.id,
      pointerId,
      startPoint: portPoint,
      fromPoint: portPoint,
      point: initialPoint,
      inputPortCandidates,
      snapTargetId: null,
      moved: false,
    };
    updateCanvasInteractionPhase('connection-drag');
    const previewPath = connectionPreviewPathRef.current;
    if (previewPath) {
      previewPath.setAttribute('d', buildConnectionPath(portPoint, initialPoint));
      previewPath.style.visibility = 'visible';
    }
    isDraggingRef.current = false;
    clearCanvasItemDragPreview(true);
    connectionDragMovedRef.current = false;
    startPointerSession({
      mode: 'connection-drag',
      pointerId,
      startPoint: { x: clientX, y: clientY },
      onFrame: (pointerX, pointerY) => {
        const point = getCanvasRelativePoint(pointerX, pointerY);
        if (point) updateConnectionPreview(point.x, point.y);
      },
      onEnd: finalizeConnectionInteraction,
      onCancel: clearConnectionInteractionState,
    });
  };

  const toggleSelectionId = (ids: string[], id: string) =>
    ids.includes(id) ? ids.filter((entry) => entry !== id) : [...ids, id];

  const cubicBezierPoint = (
    p0: { x: number; y: number },
    p1: { x: number; y: number },
    p2: { x: number; y: number },
    p3: { x: number; y: number },
    t: number
  ) => {
    const mt = 1 - t;
    const mt2 = mt * mt;
    const t2 = t * t;
    return {
      x: mt2 * mt * p0.x + 3 * mt2 * t * p1.x + 3 * mt * t2 * p2.x + t2 * t * p3.x,
      y: mt2 * mt * p0.y + 3 * mt2 * t * p1.y + 3 * mt * t2 * p2.y + t2 * t * p3.y,
    };
  };

  const getConnectionControlPoints = (from: { x: number; y: number }, to: { x: number; y: number }) => {
    const dx = Math.max(64, Math.abs(to.x - from.x) * 0.42);
    return {
      c1: { x: from.x + dx, y: from.y },
      c2: { x: to.x - dx, y: to.y },
    };
  };

  const getConnectionHitIdsForMarquee = (
    rect: { x: number; y: number; width: number; height: number },
    activeViewport: ViewportState,
    activeItems: CanvasItem[],
    activeConnections: Connection[]
  ) => {
    const SAMPLE_COUNT = 24;
    const activeItemById = new Map(activeItems.map((item) => [item.id, item]));

    return activeConnections
      .filter((connection) => {
        const fromItem = activeItemById.get(connection.fromItemId);
        const toItem = activeItemById.get(connection.toItemId);
        if (!fromItem || !toItem || fromItem.visible === false || toItem.visible === false) return false;

        const from = projectCanvasPointToViewport(
          getConnectionAnchorCanvasPoint(fromItem, 'right'),
          activeViewport
        );
        const to = projectCanvasPointToViewport(
          getConnectionAnchorCanvasPoint(toItem, 'left'),
          activeViewport
        );
        const { c1, c2 } = getConnectionControlPoints(from, to);

        const sampledPoints = Array.from(
          { length: SAMPLE_COUNT + 1 },
          (_, step) => cubicBezierPoint(from, c1, c2, to, step / SAMPLE_COUNT)
        );
        return areCanvasPointsFullyContained(rect, sampledPoints);
      })
      .map((connection) => connection.id);
  };

  const findNearestInputPort = (
    x: number,
    y: number,
    candidates: readonly { targetId: string; x: number; y: number }[]
  ): { targetId: string; x: number; y: number } | null => {
    const SNAP_DISTANCE = 28;
    const maxDistanceSquared = SNAP_DISTANCE * SNAP_DISTANCE;
    let nearest: { targetId: string; x: number; y: number; distanceSquared: number } | null = null;

    for (const candidate of candidates) {
      const deltaX = candidate.x - x;
      const deltaY = candidate.y - y;
      const distanceSquared = deltaX * deltaX + deltaY * deltaY;
      if (distanceSquared > maxDistanceSquared) continue;
      if (!nearest || distanceSquared < nearest.distanceSquared) {
        nearest = { ...candidate, distanceSquared };
      }
    }

    if (!nearest) return null;
    return { targetId: nearest.targetId, x: nearest.x, y: nearest.y };
  };

  const deleteItem = useCallback((id: string) => {
    recordCurrentCanvasUndoSnapshot();
    setItems(prev => prev.filter(item => item.id !== id));
    setConnections(prev => prev.filter((connection) => connection.fromItemId !== id && connection.toItemId !== id));
    if (selectedId === id) setSelectedId(null);
    setSelectedIds(prev => prev.filter(selected => selected !== id));
  }, [recordCurrentCanvasUndoSnapshot, selectedId, setConnections, setItems]);

  const deleteConnection = (connectionId: string) => {
    recordCurrentCanvasUndoSnapshot();
    setConnections((prev) => prev.filter((connection) => connection.id !== connectionId));
    setSelectedConnectionIds((prev) => prev.filter((id) => id !== connectionId));
  };

  const getCanvasRelativePoint = (clientX: number, clientY: number) => {
    const canvasRect = canvasMetricsRef.current;
    if (canvasRect.width <= 0 || canvasRect.height <= 0) return null;
    return {
      x: clientX - canvasRect.left,
      y: clientY - canvasRect.top,
    };
  };

  const getRegionImagePointFromClient = useCallback((item: CanvasItem, clientX: number, clientY: number) => {
    const relativePoint = getCanvasRelativePoint(clientX, clientY);
    if (!relativePoint) return null;
    const canvasPoint = toCanvasPoint(relativePoint);
    const content = getRegionImageContent(item);
    return canvasPointToImageNormalized({
      canvasPoint,
      item,
      content,
      naturalWidth: content.naturalWidth,
      naturalHeight: content.naturalHeight,
      fit: content.fit,
    });
  }, [toCanvasPoint]);

  const handleRegionRecognitionResolved = useCallback((
    nextRegion: RegionSelection,
    previousRegionId: string,
    _lowConfidence: boolean,
    evidence: RegionEvidence
  ) => {
    regionEvidenceByIdRef.current.delete(previousRegionId);
    regionEvidenceByIdRef.current.set(nextRegion.id, evidence);
    const token = buildRegionReferenceToken(nextRegion, evidence);
    const hasToken = chatReferenceTokensRef.current.some((candidate) => (
      candidate.regionId === previousRegionId || candidate.regionId === nextRegion.id
    ));
    setChatReferenceTokens((previous) => previous.some((candidate) => (
      candidate.regionId === previousRegionId || candidate.regionId === nextRegion.id
    ))
      ? previous.map((candidate) => (
          candidate.regionId === previousRegionId || candidate.regionId === nextRegion.id ? token : candidate
        ))
      : previous);
    if (hasToken) setActiveRegionMenuId(nextRegion.id);
    setRegionCustomLabelDraft('');
  }, []);

  const handleRegionRecognitionFailed = useCallback((regionId: string, evidence: RegionEvidence) => {
    regionEvidenceByIdRef.current.set(regionId, evidence);
    const hasToken = chatReferenceTokensRef.current.some((token) => token.regionId === regionId);
    setChatReferenceTokens((previous) => previous.map((token) => token.regionId === regionId
      ? {
          ...token,
          label: '识别失败',
          confirmationStatus: 'pending',
          previewSrc: evidence.cropImageSrc || token.previewSrc,
        }
      : token));
    setRegionCustomLabelDraft('');
    if (hasToken) setActiveRegionMenuId(regionId);
  }, []);

  const {
    startRecognition: startRegionRecognition,
    cancelRecognition: cancelRegionRecognition,
    cancelAllRecognitions,
    getRecognitionRevision,
  } = useImageRegionSelectionController({
    setRegions: setRegionSelections,
    providerId: resolvedChatSelection.providerId || undefined,
    model: resolvedChatSelection.model || undefined,
    buildEvidence: uploadRegionEvidencePreview,
    onResolved: handleRegionRecognitionResolved,
    onFailed: handleRegionRecognitionFailed,
  });

  const clearSentChatReferenceTokens = useCallback(() => {
    setChatReferenceTokens((tokens) => tokens.filter((token) => !token.regionId && token.pinned));
    setActiveRegionMenuId(null);
  }, []);

  const removeRegionSelection = useCallback((regionId: string) => {
    cancelRegionRecognition(regionId);
    regionEvidenceByIdRef.current.delete(regionId);
    setRegionSelections((regions) => regions.filter((region) => region.id !== regionId));
    setChatReferenceTokens((tokens) => tokens.filter((token) => token.regionId !== regionId));
    setActiveRegionMenuId((current) => current === regionId ? null : current);
    setRegionRefineId((current) => current === regionId ? null : current);
  }, [cancelRegionRecognition, setRegionSelections]);

  const updateRegionCandidate = useCallback((regionId: string, candidateId?: string, customLabel?: string) => {
    const region = regionSelectionsRef.current.find((candidate) => candidate.id === regionId);
    if (!region) return;
    const candidate = region.candidates.find((entry) => entry.id === candidateId) || region.candidates[0];
    const customLabelValue = customLabel?.trim();
    if (customLabel !== undefined && !customLabelValue) return;
    const nextRegion: RegionSelection = {
      ...region,
      selectedCandidateId: candidate?.id || region.selectedCandidateId,
      ...(customLabelValue ? { customLabel: customLabelValue } : { customLabel: undefined }),
      status: 'ready' as const,
      confirmationStatus: 'confirmed',
    };
    setRegionSelections((previous) => previous.map((entry) => entry.id === regionId ? nextRegion : entry));
    setChatReferenceTokens((previous) => {
      const updatedToken = buildRegionReferenceToken(
        nextRegion,
        regionEvidenceByIdRef.current.get(regionId)
      );
      const hasToken = previous.some((token) => token.regionId === regionId);
      const next = hasToken
        ? previous.map((token) => token.regionId === regionId ? { ...token, ...updatedToken } : token)
        : [...previous, updatedToken];
      return next.slice(0, 14);
    });
    setRegionCustomLabelDraft('');
  }, [setRegionSelections]);

  const handleRegionClick = useCallback((regionId: string) => {
    const region = regionSelectionsRef.current.find((candidate) => candidate.id === regionId);
    if (!region) return;
    const regionToken = chatReferenceTokens.find((token) => token.regionId === regionId);
    if (!regionToken) {
      setChatReferenceTokens((previous) => [
        ...previous,
        buildRegionReferenceToken(region, regionEvidenceByIdRef.current.get(regionId)),
      ].slice(0, 14));
      setActiveRegionMenuId(regionId);
      if (!regionEvidenceByIdRef.current.has(regionId)) {
        const requestedGeometry = JSON.stringify([
          region.mode,
          region.point,
          region.box || null,
          region.recognitionRevision || 0,
        ]);
        void uploadRegionEvidencePreview(region).then((evidence) => {
          const currentRegion = regionSelectionsRef.current.find((candidate) => candidate.id === regionId);
          if (!currentRegion || JSON.stringify([
            currentRegion.mode,
            currentRegion.point,
            currentRegion.box || null,
            currentRegion.recognitionRevision || 0,
          ]) !== requestedGeometry) return;
          regionEvidenceByIdRef.current.set(regionId, evidence);
          setChatReferenceTokens((previous) => previous.map((token) => token.regionId === regionId
            ? buildRegionReferenceToken(currentRegion, evidence)
            : token));
        }).catch(() => {});
      }
    } else {
      setActiveRegionMenuId((previous) => previous === regionId ? null : regionId);
    }
    setRegionCustomLabelDraft(region?.customLabel || regionToken?.label || '');
  }, [chatReferenceTokens]);

  const beginRegionRefine = useCallback((regionId: string) => {
    const region = regionSelectionsRef.current.find((candidate) => candidate.id === regionId);
    if (!region) return;
    setRegionRefineId(regionId);
    setActiveRegionMenuId(null);
    setRegionCustomLabelDraft('');
    setTool('target');
  }, []);

  const clearConnectionInteractionState = useCallback(() => {
    connectionSessionRef.current = null;
    clearConnectionSnapTargetVisual();
    const previewPath = connectionPreviewPathRef.current;
    if (previewPath) {
      previewPath.removeAttribute('d');
      previewPath.style.visibility = 'hidden';
    }
    setConnectionMode('idle');
    setConnectionFromItemId(null);
    setConnectionPointerId(null);
    connectionDragMovedRef.current = false;
    setCanvasConnectionHitTestingDisabled(false);
    updateCanvasInteractionPhase('idle');
  }, [clearConnectionSnapTargetVisual, setCanvasConnectionHitTestingDisabled, updateCanvasInteractionPhase]);
  clearConnectionInteractionStateRef.current = clearConnectionInteractionState;

  const resetConnectionInteraction = useCallback(() => {
    const session = connectionSessionRef.current;
    if (session && isManagedPointer(session.pointerId)) {
      cancelInteraction('replaced');
      return;
    }
    clearConnectionInteractionState();
  }, [cancelInteraction, clearConnectionInteractionState, isManagedPointer]);

  const updateConnectionPreview = (rawX: number, rawY: number) => {
    const session = connectionSessionRef.current;
    if (!session) return;
    const startPoint = session.startPoint;
    const movedX = rawX - startPoint.x;
    const movedY = rawY - startPoint.y;
    const hasMoved = movedX * movedX + movedY * movedY >= 9;
    connectionDragMovedRef.current = hasMoved;
    const nearest = findNearestInputPort(rawX, rawY, session.inputPortCandidates);
    session.point = nearest ? { x: nearest.x, y: nearest.y } : { x: rawX, y: rawY };
    const nextSnapTargetId = nearest?.targetId || null;
    if (session.snapTargetId !== nextSnapTargetId) {
      session.snapTargetId = nextSnapTargetId;
      setConnectionSnapTargetVisual(nextSnapTargetId);
    }
    session.moved = hasMoved;
    connectionPreviewPathRef.current?.setAttribute(
      'd',
      buildConnectionPath(session.fromPoint, session.point)
    );
    markCanvasInteractionVisualFrame('connection-drag');
  };

  const finalizeConnectionInteraction = () => {
    const session = connectionSessionRef.current;
    if (session && session.mode === 'dragging' && session.fromItemId && session.snapTargetId && session.fromItemId !== session.snapTargetId) {
      clearPendingConnectionMenu();
      recordCurrentCanvasUndoSnapshot();
      const currentConnections = sessionLiveStateRef.current.connections;
      const exists = currentConnections.some(
        (connection) =>
          connection.fromItemId === session.fromItemId &&
          connection.toItemId === session.snapTargetId
      );
      if (!exists) {
        const nextConnections = [
          ...currentConnections,
          {
            id: `conn-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            fromItemId: session.fromItemId,
            toItemId: session.snapTargetId,
          },
        ];
        syncSessionLiveState({ connections: nextConnections });
        stageCanvasCommit({ connections: nextConnections, saveSession: true });
      } else {
        schedulePendingCanvasCommit();
      }
    } else if (session && session.mode === 'dragging' && session.fromItemId && session.point) {
      if (itemByIdRef.current.has(session.fromItemId)) {
        setFrozenPreviewConnection({
          from: session.fromPoint,
          to: session.point,
        });
        setPendingConnectionMenu({
          fromItemId: session.fromItemId,
          position: {
            x: session.point.x,
            y: session.point.y,
          },
        });
      } else {
        clearPendingConnectionMenu();
      }
    }
    clearConnectionInteractionState();
  };

  const previewCanvasViewport = useCallback((nextViewport: ViewportState) => {
    const zoomPercentage = `${Math.round(nextViewport.scale * 100)}%`;
    if (zoomPercentageRef.current?.textContent !== zoomPercentage) {
      zoomPercentageRef.current.textContent = zoomPercentage;
    }
    const sceneTarget = getSceneTarget();
    if (!sceneTarget) return;

    visualViewportRef.current = nextViewport;
    sceneTarget.setViewportTransform(nextViewport.x, nextViewport.y, nextViewport.scale);
    syncSelectedCanvasOverlayPositions(nextViewport);
    markCanvasInteractionVisualFrame('viewport');
  }, [getSceneTarget, markCanvasInteractionVisualFrame, syncSelectedCanvasOverlayPositions]);

  const previewCanvasPanMotion = useCallback((motion: CanvasPanMotion) => {
    previewCanvasViewport(motion.visualViewport);
  }, [previewCanvasViewport]);

  useLayoutEffect(() => {
    if (
      !pendingCanvasSelectionGestureRef.current &&
      !isDraggingRef.current &&
      !isCornerResizingRef.current
    ) {
      revealCanvasSelectionOverlayGroups();
    }
    syncSelectedCanvasOverlayPositions(visualViewportRef.current);
    if (!canvasPerformanceEnabledRef.current) return;

    if (isCanvasCommitBlocked()) {
      canvasOverlayReactCommitDuringInteractionCountRef.current += 1;
    }

    const pendingMount = pendingCanvasOverlayMountMeasureRef.current;
    if (!pendingMount) return;
    const mountedForItem = (
      getCanvasItemOverlayGroup('selected-image-toolbar')?.itemId === pendingMount.itemId ||
      getCanvasItemOverlayGroup('selected-image-panel')?.itemId === pendingMount.itemId ||
      getCanvasItemOverlayGroup('selected-text-panel')?.itemId === pendingMount.itemId
    );
    if (!mountedForItem) return;

    pendingCanvasOverlayMountMeasureRef.current = null;
    if (pendingCanvasOverlayMountFrameRef.current !== null) {
      cancelAnimationFrame(pendingCanvasOverlayMountFrameRef.current);
    }
    pendingCanvasOverlayMountFrameRef.current = requestAnimationFrame(() => {
      pendingCanvasOverlayMountFrameRef.current = null;
      console.info('[canvas-overlay-perf]', {
        itemId: pendingMount.itemId,
        pointerDownToFirstVisualFrame: performance.now() - pendingMount.startedAt,
        releaseToToolbarFirstFrame: performance.now() - pendingMount.releasedAt,
        pointerDownToFirstDragVisual:
          pendingMount.firstDragVisualAt === null
            ? null
            : pendingMount.firstDragVisualAt - pendingMount.startedAt,
        itemToOverlayPositionErrorPx: 0,
        overlaySyncWriteCount: canvasOverlaySyncWriteCountRef.current,
        overlayReactCommitDuringInteractionCount:
          canvasOverlayReactCommitDuringInteractionCountRef.current,
        selectionReactCommitDuringInteractionCount:
          pendingMount.selectionReactCommitDuringInteractionCount,
      });
    });
  }, [getCanvasItemOverlayGroup, isCanvasCommitBlocked, items, revealCanvasSelectionOverlayGroups, selectedId, selectedIds, syncSelectedCanvasOverlayPositions, viewport]);

  useEffect(() => () => {
    if (pendingCanvasOverlayMountFrameRef.current !== null) {
      cancelAnimationFrame(pendingCanvasOverlayMountFrameRef.current);
      pendingCanvasOverlayMountFrameRef.current = null;
    }
    if (pendingCanvasSelectionFinalizeFrameRef.current !== null) {
      cancelAnimationFrame(pendingCanvasSelectionFinalizeFrameRef.current);
      pendingCanvasSelectionFinalizeFrameRef.current = null;
    }
  }, []);

  useEffect(() => {
    canvasPerformanceEnabledRef.current = isCanvasPerformanceEnabled();
  }, []);

  const clearCanvasViewportPreview = useCallback(() => {
    const sceneTarget = getSceneTarget();
    if (!sceneTarget) return;
    const activeViewport = visualViewportRef.current;
    sceneTarget.setViewportTransform(activeViewport.x, activeViewport.y, activeViewport.scale);
  }, [getSceneTarget]);

  const stageVisualViewportCommit = useCallback((
    nextViewport: ViewportState,
    defer = false,
    existingToken?: number
  ) => {
    if (existingToken !== undefined && existingToken !== interactionCommitTokenRef.current) return;
    visualViewportRef.current = nextViewport;
    syncSessionLiveState({ viewport: nextViewport });
    const token = existingToken ?? ++interactionCommitTokenRef.current;
    stageCanvasCommit({
      viewport: nextViewport,
      viewportToken: token,
      saveSession: true,
    });
    if (!defer) flushPendingCanvasCommit('viewport-immediate');
  }, [flushPendingCanvasCommit, stageCanvasCommit, syncSessionLiveState]);

  const stageViewportIdleCommit = useCallback((
    nextViewport: ViewportState,
    token: number
  ) => {
    if (token !== interactionCommitTokenRef.current) return;
    previewCanvasViewport(nextViewport);
    syncSessionLiveState({ viewport: nextViewport });
    pendingViewportIdleCommitTokenRef.current = token;
    stageCanvasCommit({
      viewport: nextViewport,
      viewportToken: token,
      saveSession: true,
    });
  }, [previewCanvasViewport, stageCanvasCommit, syncSessionLiveState]);

  const setCanvasPanVisualState = useCallback((active: boolean) => {
    if (panOverlayStateActiveRef.current === active) return;
    const canvas = canvasRef.current;
    if (canvas) canvas.style.cursor = active ? 'grabbing' : '';

    panOverlayStateActiveRef.current = active;
  }, []);

  const handoffCanvasViewportMotion = useCallback((
    mode: 'pan' | 'wheel' | 'programmatic'
  ) => {
    interruptCanvasCommitForInteraction(mode);
    pendingViewportIdleCommitTokenRef.current = null;
    viewportTweenRef.current?.cancel();
    viewportTweenRef.current = null;
    panMotionRef.current = null;
    isPanningRef.current = false;
    setCanvasPanVisualState(false);
    const token = ++interactionCommitTokenRef.current;
    return token;
  }, [interruptCanvasCommitForInteraction, setCanvasPanVisualState]);

  const cancelViewportAnimation = useCallback((stageCurrentViewport = true) => {
    cancelPendingCanvasCommitSchedule();
    pendingViewportIdleCommitTokenRef.current = null;
    if (viewportTweenRef.current) {
      viewportTweenRef.current.cancel();
      viewportTweenRef.current = null;
    }
    panMotionRef.current = null;
    isPanningRef.current = false;
    setCanvasPanVisualState(false);
    ++interactionCommitTokenRef.current;
    if (stageCurrentViewport) {
      const visualViewport = visualViewportRef.current;
      const committedViewport = renderedViewportRef.current;
      if (
        visualViewport.x !== committedViewport.x ||
        visualViewport.y !== committedViewport.y ||
        visualViewport.scale !== committedViewport.scale
      ) {
        stageVisualViewportCommit(visualViewport, true);
      }
    }
  }, [cancelPendingCanvasCommitSchedule, setCanvasPanVisualState, stageVisualViewportCommit]);

  const cancelZoomAnimation = cancelViewportAnimation;

  useLayoutEffect(() => {
    if (
      !isPanningRef.current &&
      !pendingCanvasCommitRef.current?.viewport &&
      !viewportTweenRef.current
    ) {
      clearCanvasViewportPreview();
    }
  }, [clearCanvasViewportPreview, viewport.x, viewport.y, viewport.scale]);

  const getCanvasItemDragPlanKey = useCallback(
    (itemIds: readonly string[]) => itemIds.join('\u0000'),
    []
  );

  const syncCanvasItemPortPositions = useCallback((item: CanvasItem) => {
    const inputPoint = getPortCanvasPoint(item, 'left');
    const outputPoint = getPortCanvasPoint(item, 'right');
    getItemTargets([item.id]).forEach((target) => {
      const isInputPort = target.role.startsWith('input-port');
      const isOutputPort = target.role.startsWith('output-port');
      if (!isInputPort && !isOutputPort) return;
      const point = isInputPort ? inputPoint : outputPoint;
      target.element.style.left = `${point.x}px`;
      target.element.style.top = `${point.y}px`;
    });
  }, [getItemTargets]);

  const buildCanvasItemDragPlan = useCallback((itemIds: readonly string[]) => {
    const itemIdSet = new Set(itemIds);
    const affectedConnectionsById = new Map<string, Connection>();
    for (const itemId of itemIds) {
      const connected = connectionsByItemId.get(itemId);
      if (!connected) continue;
      for (const connection of connected) affectedConnectionsById.set(connection.id, connection);
    }
    const connectionPaths = getConnectionPaths(
      Array.from(affectedConnectionsById.keys()),
      ['visual']
    );
    const plan: CachedCanvasItemDragPlan = {
      connections: [],
    };
    for (const connection of affectedConnectionsById.values()) {
      const paths = connectionPaths.get(connection.id);
      if (!paths || paths.length === 0) continue;
      plan.connections.push({
        connection,
        paths,
        movesFrom: itemIdSet.has(connection.fromItemId),
        movesTo: itemIdSet.has(connection.toItemId),
      });
    }
    canvasConnectionRuntimeIndexRef.current.set(getCanvasItemDragPlanKey(itemIds), plan);
    return plan;
  }, [connectionsByItemId, getCanvasItemDragPlanKey, getConnectionPaths]);

  useEffect(() => {
    canvasConnectionRuntimeIndexRef.current.clear();
  }, [canvasItemMembershipKey, connections]);

  const prepareCanvasItemDragPreview = useCallback((itemIds: string[]) => {
    const dragTargets = getItemTargets(itemIds, itemIds.length > 1).filter(isCanvasItemDragTarget);
    const targets = dragTargets.map((target) => {
      const { element } = target;
      const existingPresentation = canvasItemDragPresentationRef.current.get(element);
      const presentation = existingPresentation ?? {
        zIndex: element.style.zIndex,
        willChange: element.style.willChange,
      };
      if (!existingPresentation) {
        canvasItemDragPresentationRef.current.set(element, presentation);
      }
      const logicalItem = target.itemId ? itemByIdRef.current.get(target.itemId) : null;
      const previewTarget = {
        target,
        logicalStartX: logicalItem?.x ?? null,
        logicalStartY: logicalItem?.y ?? null,
        zIndex: presentation.zIndex,
        willChange: presentation.willChange,
      };
      return previewTarget;
    });
    const targetElements = targets.map(({ target }) => target.element);
    targetElements.forEach((element) => {
      element.style.willChange = 'transform';
    });
    const elevatedElements = targets
      .filter(({ target }) => target.role === 'node-drag' || target.role === 'annotation-drag')
      .map(({ target }) => target.element);
    elevatedElements.forEach((element) => {
      element.style.zIndex = '1000';
    });

    canvasItemDragPreviewRef.current = {
      targets,
      connections: [],
      connectionsPrepared: false,
      delta: { x: 0, y: 0 },
    };
  }, [getItemTargets]);

  const cancelCanvasItemDragConnectionPreparation = useCallback(() => {
    if (canvasItemDragConnectionPrepareFrameRef.current === null) return;
    cancelAnimationFrame(canvasItemDragConnectionPrepareFrameRef.current);
    canvasItemDragConnectionPrepareFrameRef.current = null;
  }, []);

  const flushCanvasItemDragConnectionFrame = useCallback(() => {
    const preview = canvasItemDragPreviewRef.current;
    if (!preview) return;
    const screenDeltaX = preview.delta.x;
    const screenDeltaY = preview.delta.y;
    preview.connections.forEach((connection) => {
      connection.fromPoint.x = connection.fromStart.x + (connection.movesFrom ? screenDeltaX : 0);
      connection.fromPoint.y = connection.fromStart.y + (connection.movesFrom ? screenDeltaY : 0);
      connection.toPoint.x = connection.toStart.x + (connection.movesTo ? screenDeltaX : 0);
      connection.toPoint.y = connection.toStart.y + (connection.movesTo ? screenDeltaY : 0);
      if (connection.translationOnly) {
        const transform = `translate(${screenDeltaX}px, ${screenDeltaY}px)`;
        connection.paths.forEach((element) => {
          element.style.transform = transform;
        });
        return;
      }
      const path = buildConnectionPath(connection.fromPoint, connection.toPoint);
      connection.paths.forEach((element) => element.setAttribute('d', path));
    });
  }, [buildConnectionPath]);

  const flushAffectedConnectionWork = useCallback(() => {
    flushCanvasItemDragConnectionFrame();
    const resize = cornerResizePreviewRef.current;
    if (!resize) return;
    refreshDirectItemConnectionPathsRef.current(resize.itemId, {
      width: resize.nextWidth,
      height: resize.nextHeight,
    });
  }, [flushCanvasItemDragConnectionFrame]);

  const scheduleCanvasItemDragConnectionPreparation = useCallback((
    itemIds: string[],
    token: number
  ) => {
    cancelCanvasItemDragConnectionPreparation();
    canvasItemDragConnectionPrepareFrameRef.current = requestAnimationFrame(() => {
      canvasItemDragConnectionPrepareFrameRef.current = null;
      if (activeItemDragTokenRef.current !== token || !isDraggingRef.current) return;
      const preview = canvasItemDragPreviewRef.current;
      if (!preview) return;
      const plan = canvasConnectionRuntimeIndexRef.current.get(getCanvasItemDragPlanKey(itemIds))
        ?? buildCanvasItemDragPlan(itemIds);
      const connectionPreviews: CanvasItemDragConnectionPreview[] = [];
      plan.connections.forEach(({ connection, paths, movesFrom, movesTo }) => {
        const fromItem = itemByIdRef.current.get(connection.fromItemId);
        const toItem = itemByIdRef.current.get(connection.toItemId);
        if (!fromItem || !toItem) return;
        const fromStart = getConnectionAnchorCanvasPoint(fromItem, 'right');
        const toStart = getConnectionAnchorCanvasPoint(toItem, 'left');
        connectionPreviews.push({
          paths,
          originalPath: buildConnectionPath(fromStart, toStart),
          originalTransforms: paths.map((element) => element.style.transform),
          fromStart,
          toStart,
          fromPoint: { ...fromStart },
          toPoint: { ...toStart },
          movesFrom,
          movesTo,
          translationOnly: movesFrom && movesTo,
        });
      });
      preview.connections = connectionPreviews;
      preview.connectionsPrepared = true;
      flushCanvasItemDragConnectionFrame();
    });
  }, [buildCanvasItemDragPlan, buildConnectionPath, cancelCanvasItemDragConnectionPreparation, flushCanvasItemDragConnectionFrame, getCanvasItemDragPlanKey, getConnectionAnchorCanvasPoint]);

  const previewCanvasItemDrag = useCallback(
    (deltaX: number, deltaY: number) => {
      const preview = canvasItemDragPreviewRef.current;
      if (!preview) return;
      preview.delta.x = deltaX;
      preview.delta.y = deltaY;
      const transaction = canvasItemDragTransactionRef.current;
      if (transaction) {
        transaction.delta.x = deltaX;
        transaction.delta.y = deltaY;
      }
      preview.targets.forEach((target) => {
        target.target.setPosition(deltaX, deltaY);
      });
      if (preview.connections.length > 0) flushAffectedConnectionWork();
      markCanvasInteractionVisualFrame('item-drag');
    },
    [flushAffectedConnectionWork, markCanvasInteractionVisualFrame]
  );

  const commitCanvasItemDragPreviewToBase = useCallback((
    finalPositions: Map<string, { x: number; y: number }>
  ) => {
    cancelCanvasItemDragConnectionPreparation();
    flushCanvasItemDragConnectionFrame();
    const preview = canvasItemDragPreviewRef.current;
    if (!preview) return;
    for (const [itemId, finalPosition] of finalPositions) {
      const item = itemByIdRef.current.get(itemId);
      if (item) syncCanvasItemPortPositions({ ...item, ...finalPosition });
    }
    preview.targets.forEach(({ target, zIndex, willChange }) => {
      const itemId = target.itemId;
      if (itemId) {
        const finalPosition = finalPositions.get(itemId);
        const baseTarget = getItemTargets([itemId]).find((candidate) => (
          candidate.role === 'node-base-position' || candidate.role === 'annotation-base-position'
        ));
        if (finalPosition && baseTarget) {
          baseTarget.element.style.transform = `translate3d(${finalPosition.x}px, ${finalPosition.y}px, 0)`;
        }
        if (finalPosition && target.role.startsWith('region-')) {
          target.element.style.left = `${finalPosition.x}px`;
          target.element.style.top = `${finalPosition.y}px`;
        }
      }
      target.setPosition(0, 0);
      target.element.style.zIndex = zIndex;
      target.element.style.willChange = willChange;
      canvasItemDragPresentationRef.current.delete(target.element);
    });
    preview.connections.forEach((connection) => {
      const path = buildConnectionPath(connection.fromPoint, connection.toPoint);
      connection.paths.forEach((element) => {
        element.setAttribute('d', path);
        element.style.transform = '';
      });
    });
    canvasItemDragPreviewRef.current = null;
  }, [buildConnectionPath, cancelCanvasItemDragConnectionPreparation, flushCanvasItemDragConnectionFrame, getItemTargets, syncCanvasItemPortPositions]);

  const clearCanvasItemDragPreview = useCallback((restoreConnectionPaths = false) => {
    cancelCanvasItemDragConnectionPreparation();
    const preview = canvasItemDragPreviewRef.current;
    if (!preview) return;
    preview.targets.forEach((target) => {
      target.target.setPosition(0, 0);
      target.target.element.style.zIndex = target.zIndex;
      target.target.element.style.willChange = target.willChange;
      canvasItemDragPresentationRef.current.delete(target.target.element);
    });
    if (restoreConnectionPaths) {
      preview.connections.forEach((connection) => {
        connection.paths.forEach((element, index) => {
          if (!connection.translationOnly) element.setAttribute('d', connection.originalPath);
          element.style.transform = connection.originalTransforms[index] ?? '';
        });
      });
    } else {
      preview.connections.forEach((connection) => {
        connection.paths.forEach((element, index) => {
          element.style.transform = connection.originalTransforms[index] ?? '';
        });
      });
    }
    canvasItemDragPreviewRef.current = null;
  }, [cancelCanvasItemDragConnectionPreparation]);
  clearCanvasItemDragPreviewRef.current = clearCanvasItemDragPreview;

  useLayoutEffect(() => {
    if (!isDraggingRef.current && canvasItemDragPreviewRef.current) {
      clearCanvasItemDragPreview();
    }
    if (
      canvasInteractionPhaseRef.current !== 'connection-drag' &&
      !isDraggingRef.current &&
      !canvasItemDragPreviewRef.current
    ) {
      setCanvasConnectionHitTestingDisabled(false);
      if (canvasInteractionPhaseRef.current === 'item-drag') {
        updateCanvasInteractionPhase('idle');
      }
    }
  }, [clearCanvasItemDragPreview, items, setCanvasConnectionHitTestingDisabled, updateCanvasInteractionPhase]);

  useLayoutEffect(() => {
    markLayoutCommitted();
    const measure = pendingCanvasCommitLayoutMeasureRef.current;
    if (!measure) return;
    pendingCanvasCommitLayoutMeasureRef.current = null;
    console.info('[canvas-commit-perf]', {
      revision: measure.revision,
      reason: measure.reason,
      commitDuration: performance.now() - measure.startedAt,
      commitDuringInteraction: measure.commitDuringInteraction,
      commitDuringInteractionCount: measure.commitDuringInteractionCount,
    });
  }, [connections, items, markLayoutCommitted, selectedConnectionIds, selectedId, selectedIds, viewport]);

  const animateViewportTo = useCallback((
    nextViewport: ViewportState,
    options: { duration?: number; ease?: string } = {}
  ) => {
    if (isPanningRef.current) cancelInteraction('viewport-handoff');
    const token = handoffCanvasViewportMotion('programmatic');
    const currentViewport = { ...visualViewportRef.current };
    const hasNoMovement =
      currentViewport.x === nextViewport.x &&
      currentViewport.y === nextViewport.y &&
      currentViewport.scale === nextViewport.scale;

    if (reducedMotionRef.current || hasNoMovement || options.duration === 0) {
      previewCanvasViewport(nextViewport);
      stageViewportIdleCommit(nextViewport, token);
      return;
    }

    const durationMs = Math.max(
      0,
      (options.duration ?? CANVAS_VIEWPORT_ANIMATION_SECONDS) * 1000
    );
    const startedAt = performance.now();
    let frameId: number | null = null;
    let cancelled = false;
    const animation: NativeViewportAnimation = {
      cancel: () => {
        if (cancelled) return;
        cancelled = true;
        if (frameId !== null) cancelAnimationFrame(frameId);
        if (viewportTweenRef.current === animation) viewportTweenRef.current = null;
      },
    };
    const tick = (now: number) => {
      if (cancelled || token !== interactionCommitTokenRef.current) return;
      const progress = durationMs === 0 ? 1 : Math.min(1, (now - startedAt) / durationMs);
      const eased = 1 - Math.pow(1 - progress, 3);
      previewCanvasViewport({
        x: currentViewport.x + (nextViewport.x - currentViewport.x) * eased,
        y: currentViewport.y + (nextViewport.y - currentViewport.y) * eased,
        scale: currentViewport.scale + (nextViewport.scale - currentViewport.scale) * eased,
      });
      if (progress < 1) {
        frameId = requestAnimationFrame(tick);
        return;
      }
      viewportTweenRef.current = null;
      stageViewportIdleCommit(nextViewport, token);
    };
    viewportTweenRef.current = animation;
    frameId = requestAnimationFrame(tick);
  }, [cancelInteraction, handoffCanvasViewportMotion, previewCanvasViewport, stageViewportIdleCommit]);
  animateViewportToRef.current = animateViewportTo;

  const getScaledViewportAtAnchor = useCallback(
    (
      currentViewport: { x: number; y: number; scale: number },
      nextScale: number,
      anchor?: { x: number; y: number }
    ) => {
      const clampedScale = Math.min(Math.max(nextScale, 0.1), 10);
      if (clampedScale === currentViewport.scale) {
        return currentViewport;
      }

      const resolvedAnchor =
        anchor ??
        (canvasMetricsRef.current.width > 0 && canvasMetricsRef.current.height > 0
          ? { x: canvasMetricsRef.current.width / 2, y: canvasMetricsRef.current.height / 2 }
          : undefined);

      if (!resolvedAnchor) {
        return getCanvasViewportAtAnchor(currentViewport, clampedScale);
      }
      return getCanvasViewportAtAnchor(currentViewport, clampedScale, resolvedAnchor);
    },
    []
  );

  const refreshDirectItemConnectionPaths = useCallback((
    itemId: string,
    geometry?: { width: number; height: number }
  ) => {
    const affectedConnections = connectionsByItemId.get(itemId);
    if (!affectedConnections || affectedConnections.length === 0) return;
    const pathsByConnection = getConnectionPaths(
      affectedConnections.map((connection) => connection.id),
      ['visual', 'hit']
    );
    for (const connection of affectedConnections) {
      const fromItem = itemByIdRef.current.get(connection.fromItemId);
      const toItem = itemByIdRef.current.get(connection.toItemId);
      const paths = pathsByConnection.get(connection.id);
      if (!fromItem || !toItem || !paths) continue;
      const fromCanvas = connection.fromItemId === itemId && geometry
        ? {
            x: fromItem.x + geometry.width + CONNECTION_ANCHOR_EDGE_GAP,
            y: fromItem.y + geometry.height / 2,
          }
        : getConnectionAnchorCanvasPoint(fromItem, 'right');
      const toCanvas = connection.toItemId === itemId && geometry
        ? {
            x: toItem.x - CONNECTION_ANCHOR_EDGE_GAP,
            y: toItem.y + geometry.height / 2,
          }
        : getConnectionAnchorCanvasPoint(toItem, 'left');
      const path = buildConnectionPath(fromCanvas, toCanvas);
      paths.forEach((element) => element.setAttribute('d', path));
    }
  }, [buildConnectionPath, connectionsByItemId, getConnectionAnchorCanvasPoint, getConnectionPaths]);
  refreshDirectItemConnectionPathsRef.current = refreshDirectItemConnectionPaths;

  const restoreCanvasItemDragHint = useCallback((
    target: CanvasRegisteredTarget,
    itemId: string
  ) => {
    const remainsSingleSelected =
      selectedIdsRef.current.length === 1 && selectedIdsRef.current[0] === itemId;
    target.element.style.willChange = remainsSingleSelected
      ? 'transform'
      : '';
  }, []);

  const commitCornerResizePreview = useCallback(() => {
    const preview = cornerResizePreviewRef.current;
    cornerResizePreviewRef.current = null;
    if (!preview) return;
    const changed =
      Math.abs(preview.nextWidth - preview.startWidth) > 0.01 ||
      Math.abs(preview.nextHeight - preview.startHeight) > 0.01;
    if (preview.target) {
      restoreCanvasItemDragHint(preview.target, preview.itemId);
    }
    if (!changed) {
      return;
    }

    const nextItems = sessionLiveStateRef.current.items.map((item) => (
      item.id === preview.itemId
        ? { ...item, width: preview.nextWidth, height: preview.nextHeight }
        : item
    ));
    syncSessionLiveState({ items: nextItems });
    stageCanvasCommit({ items: nextItems, saveSession: true });
  }, [restoreCanvasItemDragHint, stageCanvasCommit, syncSessionLiveState]);

  const cancelActiveItemDrag = useCallback((reason: CanvasInteractionCancelReason = 'escape') => {
    const wasDragging = isDraggingRef.current;
    const transaction = canvasItemDragTransactionRef.current;
    isDraggingRef.current = false;
    isAltCopyDragRef.current = false;
    altDragPrimarySourceIdRef.current = null;
    activeItemDragTokenRef.current = null;
    canvasItemDragTransactionRef.current = null;
    draggingItemIdsRef.current = [];
    dragItemStartPositionsRef.current = {};
    if (wasDragging) clearCanvasItemDragPreview(true);
    if (transaction) restoreCanvasOverlayVisibility(transaction.overlayVisibility);
    if (canvasRef.current) canvasRef.current.style.cursor = '';
    clearPendingCanvasUndoSnapshot();
    setCanvasConnectionHitTestingDisabled(false);
    updateCanvasInteractionPhase('idle');
    if (reason !== 'replaced') {
      const visualViewport = visualViewportRef.current;
      const renderedViewport = renderedViewportRef.current;
      if (
        visualViewport.x !== renderedViewport.x ||
        visualViewport.y !== renderedViewport.y ||
        visualViewport.scale !== renderedViewport.scale
      ) {
        stageVisualViewportCommit(visualViewport, true);
      }
    }
    restoreCanvasSelectionGestureRef.current();
    schedulePendingCanvasCommit();
  }, [clearCanvasItemDragPreview, clearPendingCanvasUndoSnapshot, restoreCanvasOverlayVisibility, schedulePendingCanvasCommit, setCanvasConnectionHitTestingDisabled, stageVisualViewportCommit, updateCanvasInteractionPhase]);

  const suppressCanvasItemClickAfterDrag = useCallback((itemId: string | null) => {
    if (!itemId) return;
    suppressNextItemClickRef.current = itemId;
    if (suppressNextItemClickTimerRef.current) clearTimeout(suppressNextItemClickTimerRef.current);
    suppressNextItemClickTimerRef.current = setTimeout(() => {
      suppressNextItemClickRef.current = null;
      suppressNextItemClickTimerRef.current = null;
    }, 350);
  }, []);

  const completeActiveItemDrag = useCallback((pointerX: number, pointerY: number) => {
    if (!isDraggingRef.current) return;
    const dragDelta = getCanvasDragDelta(
      dragStart.current,
      { x: pointerX, y: pointerY },
      visualViewportRef.current.scale
    );
    const { x: deltaX, y: deltaY } = dragDelta;
    const draggedItemIds = [...draggingItemIdsRef.current];
    const moved = Math.abs(deltaX) > 0.001 || Math.abs(deltaY) > 0.001;
    const isAltCopyDrag = isAltCopyDragRef.current;
    const token = activeItemDragTokenRef.current;
    const transaction = canvasItemDragTransactionRef.current;
    const transactionMatches = matchesCanvasItemDragTransaction(
      transaction,
      token,
      currentSessionIdRef.current
    );
    const startPositions = transactionMatches && transaction
      ? transaction.startPositions
      : { ...dragItemStartPositionsRef.current };
    let finalizedSelection: FinalizeCanvasSelectionGestureOptions | null = null;
    let shouldRestorePendingSelection = false;


    if (transactionMatches) {
      previewCanvasItemDrag(deltaX, deltaY);
    }

    if (moved && token !== null && transactionMatches) {
      if (isAltCopyDrag) {
        const beforeSnapshot = createCurrentCanvasUndoSnapshot();
        const baseItems = sessionLiveStateRef.current.items;
        const snapshot = createCanvasClipboardSnapshot({
          items: baseItems,
          selectedIds: draggedItemIds,
          textCardPanelDrafts,
          textCardProviderById,
          textCardModelById,
          imageCardPanelDrafts,
          imageCardProviderById,
          imageCardModelById,
          imageCardSizeById,
          imageCardQualityById,
          imageCardCountById,
          imageCardAspectRatioById,
        }) as CanvasClipboardSnapshot | null;
        const copiedItems = snapshot
          ? materializeCanvasClipboardPaste({
              clipboard: snapshot,
              pasteCount: 0,
              offsetStep: { x: 0, y: 0 },
              createId: (sourceId: string, index: number) =>
                `${sourceId}-alt-copy-${Date.now()}-${index + 1}-${Math.random().toString(36).slice(2, 7)}`,
            }) as MaterializedCanvasClipboardPaste | null
          : null;
        if (copiedItems) {
          const positionedCopies = copiedItems.items.map((item) => ({
            ...item,
            x: item.x + deltaX,
            y: item.y + deltaY,
          }));
          const nextItems = [...baseItems, ...positionedCopies];
          clearCanvasItemDragPreview(true);
          syncSessionLiveState({ items: nextItems });
          setTextCardPanelDrafts((previous) => ({ ...previous, ...copiedItems.textCardPanelDrafts }));
          setTextCardProviderById((previous) => ({ ...previous, ...copiedItems.textCardProviderById }));
          setTextCardModelById((previous) => ({ ...previous, ...copiedItems.textCardModelById }));
          setImageCardPanelDrafts((previous) => ({ ...previous, ...copiedItems.imageCardPanelDrafts }));
          setImageCardProviderById((previous) => ({ ...previous, ...copiedItems.imageCardProviderById }));
          setImageCardModelById((previous) => ({ ...previous, ...copiedItems.imageCardModelById }));
          setImageCardSizeById((previous) => ({ ...previous, ...copiedItems.imageCardSizeById }));
          setImageCardQualityById((previous) => ({ ...previous, ...copiedItems.imageCardQualityById }));
          setImageCardCountById((previous) => ({ ...previous, ...copiedItems.imageCardCountById }));
          setImageCardAspectRatioById((previous) => ({ ...previous, ...copiedItems.imageCardAspectRatioById }));
          pushCanvasUndoSnapshot(beforeSnapshot);
          finalizedSelection = {
            itemIds: copiedItems.selectedIds,
            items: nextItems,
            reason: 'alt-copy',
            saveSession: true,
          };
        } else {
          clearCanvasItemDragPreview(true);
          setCanvasConnectionHitTestingDisabled(false);
          updateCanvasInteractionPhase('idle');
          shouldRestorePendingSelection = true;
        }
      } else {
        const finalPositions = resolveCanvasItemDragReleasePositions({
          itemIds: draggedItemIds,
          startPositions,
          delta: { x: deltaX, y: deltaY },
        });
        for (const [itemId, finalPosition] of finalPositions) {
          const currentItem = itemByIdRef.current.get(itemId);
          if (currentItem) {
            itemByIdRef.current.set(itemId, {
              ...currentItem,
              x: finalPosition.x,
              y: finalPosition.y,
            });
          }
        }
        const baseItems = sessionLiveStateRef.current.items;
        const committedMove = applyCanvasItemDragPositions({
          items: baseItems,
          itemIds: draggedItemIds,
          positions: finalPositions,
        });
        const nextItems = committedMove.items;
        commitCanvasItemDragPreviewToBase(finalPositions);
        draggedItemIds.forEach((itemId) => refreshDirectItemConnectionPaths(itemId));
        syncSessionLiveState({ items: nextItems });
        const afterPositions: Record<string, { x: number; y: number }> = {};
        for (const [itemId, finalPosition] of finalPositions) {
          afterPositions[itemId] = finalPosition;
        }
        pushCanvasMoveUndoCommand(createCanvasMoveHistoryCommand({
          before: startPositions,
          after: afterPositions,
          orderBefore: committedMove.orderBefore,
          orderAfter: committedMove.orderAfter,
        }) as CanvasMoveHistoryCommand);
        if (pendingCanvasSelectionGestureRef.current) {
          finalizedSelection = {
            itemIds: draggedItemIds,
            items: nextItems,
            reason: 'drag',
            saveSession: true,
          };
        } else {
          stageCanvasCommit({ items: nextItems, saveSession: true });
        }
      }
    }

    isDraggingRef.current = false;
    isAltCopyDragRef.current = false;
    draggingItemIdsRef.current = [];
    dragItemStartPositionsRef.current = {};
    activeItemDragTokenRef.current = null;
    canvasItemDragTransactionRef.current = null;
    if (canvasRef.current) canvasRef.current.style.cursor = '';
    altDragPrimarySourceIdRef.current = null;
    setCanvasConnectionHitTestingDisabled(false);
    updateCanvasInteractionPhase('idle');
    if (!moved || !transactionMatches) {
      if (transaction) restoreCanvasOverlayVisibility(transaction.overlayVisibility);
      clearCanvasItemDragPreview(true);
    }
    const visualViewport = visualViewportRef.current;
    const renderedViewport = renderedViewportRef.current;
    if (
      visualViewport.x !== renderedViewport.x ||
      visualViewport.y !== renderedViewport.y ||
      visualViewport.scale !== renderedViewport.scale
    ) {
      stageVisualViewportCommit(visualViewport, true);
    }
    if (
      !finalizedSelection &&
      !shouldRestorePendingSelection &&
      pendingCanvasSelectionGestureRef.current &&
      transactionMatches
    ) {
      finalizedSelection = {
        itemIds: pendingCanvasSelectionGestureRef.current.itemIds,
        reason: 'drag',
        saveSession: true,
      };
    }
    if (finalizedSelection) {
      finalizeCanvasSelectionGestureRef.current(finalizedSelection);
    } else if (pendingCanvasSelectionGestureRef.current) {
      restoreCanvasSelectionGestureRef.current();
    } else if (transaction) {
      syncSelectedCanvasOverlayPositions(visualViewportRef.current, draggedItemIds);
      restoreCanvasOverlayVisibility(transaction.overlayVisibility);
    }
    schedulePendingCanvasCommit();
  }, [clearCanvasItemDragPreview, commitCanvasItemDragPreviewToBase, createCurrentCanvasUndoSnapshot, imageCardAspectRatioById, imageCardCountById, imageCardModelById, imageCardPanelDrafts, imageCardProviderById, imageCardQualityById, imageCardSizeById, previewCanvasItemDrag, pushCanvasMoveUndoCommand, pushCanvasUndoSnapshot, refreshDirectItemConnectionPaths, restoreCanvasOverlayVisibility, schedulePendingCanvasCommit, setCanvasConnectionHitTestingDisabled, setImageCardAspectRatioById, setImageCardCountById, setImageCardModelById, setImageCardPanelDrafts, setImageCardProviderById, setImageCardQualityById, setImageCardSizeById, setTextCardModelById, setTextCardPanelDrafts, setTextCardProviderById, stageCanvasCommit, stageVisualViewportCommit, syncSelectedCanvasOverlayPositions, syncSessionLiveState, textCardModelById, textCardPanelDrafts, textCardProviderById, updateCanvasInteractionPhase]);

  const stageCanvasPanViewportCommit = useCallback((
    finalViewport: ViewportState,
    motion: CanvasPanMotion | null = panMotionRef.current
  ) => {
    const token = motion?.token ?? interactionCommitTokenRef.current;
    panMotionRef.current = null;
    isPanningRef.current = false;
    if (canvasRef.current) canvasRef.current.style.cursor = '';
    updateCanvasInteractionPhase('idle');
    stageViewportIdleCommit(finalViewport, token);
  }, [stageViewportIdleCommit, updateCanvasInteractionPhase]);

  const cancelActiveCanvasPan = useCallback((reason: CanvasInteractionCancelReason = 'escape') => {
    const motion = panMotionRef.current;
    if (!motion && !isPanningRef.current) return;

    if (reason === 'unmount') {
      panMotionRef.current = null;
      isPanningRef.current = false;
      return;
    }

    if (reason === 'viewport-handoff') {
      panMotionRef.current = null;
      isPanningRef.current = false;
      if (canvasRef.current) canvasRef.current.style.cursor = '';
      setCanvasPanVisualState(false);
      updateCanvasInteractionPhase('idle');
      return;
    }

    const startViewport = motion?.startViewport ?? panStartViewportRef.current;
    panMotionRef.current = null;
    isPanningRef.current = false;
    visualViewportRef.current = { ...startViewport };
    previewCanvasViewport(startViewport);
    if (canvasRef.current) canvasRef.current.style.cursor = '';
    updateCanvasInteractionPhase('idle');

    const renderedViewport = renderedViewportRef.current;
    const needsViewportCommit =
      startViewport.x !== renderedViewport.x ||
      startViewport.y !== renderedViewport.y ||
      startViewport.scale !== renderedViewport.scale;
    if (needsViewportCommit) {
      stageCanvasPanViewportCommit(startViewport, motion);
      return;
    }
    setCanvasPanVisualState(false);
    clearCanvasViewportPreview();
  }, [clearCanvasViewportPreview, previewCanvasViewport, setCanvasPanVisualState, stageCanvasPanViewportCommit, updateCanvasInteractionPhase]);

  const completeActiveCanvasPan = useCallback((pointerX: number, pointerY: number) => {
    const motion = panMotionRef.current;
    if (!motion || !isPanningRef.current) return;
    motion.currentPointer.x = pointerX;
    motion.currentPointer.y = pointerY;
    Object.assign(
      motion.targetViewport,
      applyDirectPan(motion.startViewport, motion.startPointer, motion.currentPointer)
    );
    motion.moved = motion.moved ||
      motion.targetViewport.x !== motion.startViewport.x ||
      motion.targetViewport.y !== motion.startViewport.y;

    if (!motion.moved) {
      if (motion.clearSelectionOnClick) {
        setSelectedConnectionIds([]);
        setSelectedId(null);
        setSelectedIds([]);
      }
      const renderedViewport = renderedViewportRef.current;
      const needsViewportCommit =
        motion.startViewport.x !== renderedViewport.x ||
        motion.startViewport.y !== renderedViewport.y ||
        motion.startViewport.scale !== renderedViewport.scale;
      if (needsViewportCommit) {
        stageCanvasPanViewportCommit(motion.startViewport, motion);
      } else {
        panMotionRef.current = null;
        isPanningRef.current = false;
        if (canvasRef.current) canvasRef.current.style.cursor = '';
        setCanvasPanVisualState(false);
        clearCanvasViewportPreview();
        updateCanvasInteractionPhase('idle');
      }
      return;
    }

    stageCanvasPanViewportCommit(motion.targetViewport, motion);
  }, [clearCanvasViewportPreview, setCanvasPanVisualState, stageCanvasPanViewportCommit, updateCanvasInteractionPhase]);

  useEffect(() => {
    const flushCanvasSessionBoundary = (reason: string) => {
      cancelInteraction('window-blur');
      flushPendingCanvasCommit(reason);
    };
    const handleWindowBlur = () => {
      flushCanvasSessionBoundary('window-blur');
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState !== 'hidden') return;
      flushCanvasSessionBoundary('visibility-hidden');
    };
    const handlePageHide = () => flushCanvasSessionBoundary('page-hide');
    window.addEventListener('blur', handleWindowBlur, true);
    window.addEventListener('pagehide', handlePageHide, true);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      window.removeEventListener('blur', handleWindowBlur, true);
      window.removeEventListener('pagehide', handlePageHide, true);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [cancelInteraction, flushPendingCanvasCommit]);

  const beginPendingItemDrag = React.useCallback(
    ({
      clientX,
      clientY,
      itemIds,
      primaryId,
      pointerId,
      pointerType,
      altCopy,
    }: {
      clientX: number;
      clientY: number;
      itemIds: string[];
      primaryId: string | null;
      pointerId: number;
      pointerType: string;
      altCopy: boolean;
    }) => {
      if (itemIds.length === 0 || !primaryId) return;
      interruptCanvasCommitForInteraction('item-drag');
      pendingCanvasHistorySnapshotRef.current = null;
      if (isPanningRef.current) cancelInteraction('viewport-handoff');
      if (viewportTweenRef.current) cancelViewportAnimation(false);
      isDraggingRef.current = false;
      isAltCopyDragRef.current = altCopy;
      altDragPrimarySourceIdRef.current = altCopy ? primaryId : null;
      draggingItemIdsRef.current = itemIds;
      dragStart.current = { x: clientX, y: clientY };

      let activated = false;
      const activate = () => {
        if (activated) return;
        activated = true;
        const pendingSelection = pendingCanvasSelectionGestureRef.current;
        if (pendingSelection?.primaryId === primaryId) {
          pendingSelection.activated = true;
        }
        const token = ++interactionCommitTokenRef.current;
        activeItemDragTokenRef.current = token;
        isDraggingRef.current = true;
        updateCanvasInteractionPhase('item-drag');
        setCanvasConnectionHitTestingDisabled(true);
        setPointerSessionMode('item-drag');
        const startPositions: Record<string, { x: number; y: number }> = {};
        for (const itemId of itemIds) {
          const item = itemByIdRef.current.get(itemId);
          if (item) startPositions[itemId] = { x: item.x, y: item.y };
        }
        const overlayVisibility = hideCanvasSelectionOverlayGroups();
        canvasItemDragTransactionRef.current = {
          sessionId: currentSessionIdRef.current,
          token,
          itemIds: [...itemIds],
          startPositions,
          delta: { x: 0, y: 0 },
          overlayVisibility,
          isAltCopy: altCopy,
        };
        dragItemStartPositionsRef.current = startPositions;
        prepareCanvasItemDragPreview(itemIds);
        if (canvasRef.current) canvasRef.current.style.cursor = 'grabbing';
      };

      startPointerSession({
        mode: 'pending-item-drag',
        pointerId,
        startPoint: { x: clientX, y: clientY },
        onFrame: (pointerX, pointerY) => {
          if (!activated) {
            if (!hasCanvasDragIntent(
              { x: clientX, y: clientY },
              { x: pointerX, y: pointerY },
              pointerType
            )) return;
            activate();
          }
          const delta = getCanvasDragDelta(
            dragStart.current,
            { x: pointerX, y: pointerY },
            visualViewportRef.current.scale
          );
          previewCanvasItemDrag(delta.x, delta.y);
          const preview = canvasItemDragPreviewRef.current;
          if (preview && !preview.connectionsPrepared && canvasItemDragConnectionPrepareFrameRef.current === null) {
            scheduleCanvasItemDragConnectionPreparation(itemIds, activeItemDragTokenRef.current!);
          }
          const pendingSelection = pendingCanvasSelectionGestureRef.current;
          if (
            pendingSelection?.primaryId === primaryId &&
            pendingSelection.firstDragVisualAt === null
          ) {
            pendingSelection.firstDragVisualAt = performance.now();
          }
        },
        onRelease: (pointerX, pointerY) => {
          if (
            activated ||
            hasCanvasDragIntent(
              { x: clientX, y: clientY },
              { x: pointerX, y: pointerY },
              pointerType
            )
          ) {
            suppressCanvasItemClickAfterDrag(primaryId);
          }
        },
        onEnd: (pointerX, pointerY) => {
          if (pendingConnectionMenu || frozenPreviewConnection) clearPendingConnectionMenu();
          if (!activated) {
            if (pendingCanvasSelectionGestureRef.current?.primaryId === primaryId) {
              finalizeCanvasSelectionGestureRef.current({
                reason: 'click',
              });
            }
            draggingItemIdsRef.current = [];
            isAltCopyDragRef.current = false;
            altDragPrimarySourceIdRef.current = null;
            const visualViewport = visualViewportRef.current;
            const renderedViewport = renderedViewportRef.current;
            if (
              visualViewport.x !== renderedViewport.x ||
              visualViewport.y !== renderedViewport.y ||
              visualViewport.scale !== renderedViewport.scale
            ) {
              stageVisualViewportCommit(visualViewport, true);
            }
            schedulePendingCanvasCommit();
            return;
          }
          completeActiveItemDrag(pointerX, pointerY);
        },
        onCancel: cancelActiveItemDrag,
      });
    },
    [
      cancelActiveItemDrag,
      cancelInteraction,
      cancelViewportAnimation,
      clearPendingConnectionMenu,
      completeActiveItemDrag,
      frozenPreviewConnection,
      hideCanvasSelectionOverlayGroups,
      interruptCanvasCommitForInteraction,
      pendingConnectionMenu,
      prepareCanvasItemDragPreview,
      previewCanvasItemDrag,
      schedulePendingCanvasCommit,
      scheduleCanvasItemDragConnectionPreparation,
      setCanvasConnectionHitTestingDisabled,
      setPointerSessionMode,
      stageVisualViewportCommit,
      startPointerSession,
      suppressCanvasItemClickAfterDrag,
      updateCanvasInteractionPhase,
    ]
  );

  const beginDraggingSelectedItems = React.useCallback(
    (clientX: number, clientY: number, itemIds: string[], primaryId: string | null, pointerId: number, pointerType: string) => {
      beginPendingItemDrag({ clientX, clientY, itemIds, primaryId, pointerId, pointerType, altCopy: false });
    },
    [beginPendingItemDrag]
  );

  const beginAltDragCopiedItems = React.useCallback(
    (clientX: number, clientY: number, sourceIds: string[], primaryId: string | null, pointerId: number, pointerType: string) => {
      beginPendingItemDrag({ clientX, clientY, itemIds: sourceIds, primaryId, pointerId, pointerType, altCopy: true });
    },
    [beginPendingItemDrag]
  );

  const beginCanvasPan = useCallback(
    (
      e: React.PointerEvent<Element>,
      options: { clearSelectionOnClick?: boolean } = {}
    ) => {
      const continuesPanSequence =
        pendingViewportIdleCommitTokenRef.current !== null || panOverlayStateActiveRef.current;
      if (!continuesPanSequence) panReactViewportCommitCountRef.current = 0;
      if (isPanningRef.current) cancelInteraction('viewport-handoff');
      const token = handoffCanvasViewportMotion('pan');
      if (pendingConnectionMenu || frozenPreviewConnection) {
        clearPendingConnectionMenu();
      }
      e.preventDefault();
      isPanningRef.current = true;
      updateCanvasInteractionPhase('canvas-pan');
      const startingViewport = { ...visualViewportRef.current };
      const visualViewport = { ...startingViewport };
      visualViewportRef.current = visualViewport;
      const motion: CanvasPanMotion = {
        token,
        startPointer: { x: e.clientX, y: e.clientY },
        currentPointer: { x: e.clientX, y: e.clientY },
        startViewport: startingViewport,
        targetViewport: { ...startingViewport },
        visualViewport,
        clearSelectionOnClick: options.clearSelectionOnClick === true,
        moved: false,
      };
      panMotionRef.current = motion;
      panStartViewportRef.current = { ...startingViewport };
      setCanvasPanVisualState(true);
      startPointerSession({
        mode: 'canvas-pan',
        pointerId: e.pointerId,
        startPoint: { x: e.clientX, y: e.clientY },
        onFrame: (pointerX, pointerY) => {
          const activeMotion = panMotionRef.current;
          if (!activeMotion) return;
          activeMotion.currentPointer.x = pointerX;
          activeMotion.currentPointer.y = pointerY;
          const nextViewport = applyDirectPan(
            activeMotion.startViewport,
            activeMotion.startPointer,
            activeMotion.currentPointer
          );
          Object.assign(activeMotion.targetViewport, nextViewport);
          Object.assign(activeMotion.visualViewport, nextViewport);
          activeMotion.moved = activeMotion.moved ||
            nextViewport.x !== activeMotion.startViewport.x ||
            nextViewport.y !== activeMotion.startViewport.y;
          previewCanvasPanMotion(activeMotion);
        },
        onEnd: completeActiveCanvasPan,
        onCancel: cancelActiveCanvasPan,
      });
    },
    [
      cancelInteraction,
      clearPendingConnectionMenu,
      frozenPreviewConnection,
      handoffCanvasViewportMotion,
      pendingConnectionMenu,
      previewCanvasPanMotion,
      setCanvasPanVisualState,
      completeActiveCanvasPan,
      cancelActiveCanvasPan,
      startPointerSession,
      updateCanvasInteractionPhase,
    ]
  );

  const beginCanvasMarquee = (e: React.PointerEvent<Element>) => {
    e.preventDefault();
    e.stopPropagation();
    interruptCanvasCommitForInteraction('marquee');
    if (isPanningRef.current) cancelInteraction('viewport-handoff');
    cancelViewportAnimation();
    const start = getCanvasRelativePoint(e.clientX, e.clientY);
    if (!start) return;
    updateCanvasInteractionPhase('idle');

    const session: CanvasMarqueeSession = {
      start,
      viewport: { ...visualViewportRef.current },
      additive: e.shiftKey,
      activated: false,
    };
    const baseSelectedIds = selectedIds;
    const baseSelectedConnectionIds = selectedConnectionIds;
    marqueeSessionRef.current = session;
    marqueeVisualRectRef.current = { x: start.x, y: start.y, width: 0, height: 0 };
    marqueePathRef.current?.setAttribute('d', getCanvasMarqueePath(marqueeVisualRectRef.current));

    const finish = () => {
      hideMarqueeVisual();
    };

    startPointerSession({
      mode: 'marquee',
      pointerId: e.pointerId,
      startPoint: { x: e.clientX, y: e.clientY },
      onFrame: (pointerX, pointerY) => {
        if (!session.activated) {
          if (!hasCanvasDragIntent(
            { x: e.clientX, y: e.clientY },
            { x: pointerX, y: pointerY },
            e.pointerType
          )) return;
          session.activated = true;
          updateCanvasInteractionPhase('marquee');
          if (marqueeSvgRef.current) {
            marqueeSvgRef.current.style.opacity = '1';
            marqueeSvgRef.current.style.visibility = 'visible';
          }
        }

        const current = getCanvasRelativePoint(pointerX, pointerY);
        if (!current) return;
        const nextRect = normalizeCanvasMarqueeRect(session.start, current);
        marqueeVisualRectRef.current = nextRect;
        marqueePathRef.current?.setAttribute('d', getCanvasMarqueePath(nextRect));
        markCanvasInteractionVisualFrame('marquee');
      },
      onEnd: (pointerX, pointerY) => {
        const metrics = canvasMetricsRef.current;
        const releasedInsideCanvas =
          pointerX >= metrics.left &&
          pointerX <= metrics.left + metrics.width &&
          pointerY >= metrics.top &&
          pointerY <= metrics.top + metrics.height;
        const activeRect = marqueeVisualRectRef.current;

        if (!session.activated) {
          finish();
          return;
        }

        if (!releasedInsideCanvas || !activeRect) {
          finish();
          return;
        }

        const activeItems = sessionLiveStateRef.current.items.map(
          (item) => itemByIdRef.current.get(item.id) ?? item
        );
        const boundsById = new Map<string, { left: number; right: number; top: number; bottom: number }>();
        activeItems.forEach((item) => {
          if (item.visible === false) return;
          const target = getItemTargets([item.id]).find((candidate) => (
            candidate.role === 'node-resize' || candidate.role === 'annotation-resize'
          ));
          const bounds = target?.element.getBoundingClientRect();
          if (!bounds) return;
          boundsById.set(item.id, {
            left: bounds.left,
            right: bounds.right,
            top: bounds.top,
            bottom: bounds.bottom,
          });
        });
        const marqueeClientRect = {
          left: metrics.left + activeRect.x,
          right: metrics.left + activeRect.x + activeRect.width,
          top: metrics.top + activeRect.y,
          bottom: metrics.top + activeRect.y + activeRect.height,
        };
        const hitIds = resolveDirectMarqueeSelection({
          rect: marqueeClientRect,
          boundsById,
        });
        const hitConnectionIds = getConnectionHitIdsForMarquee(
          activeRect,
          session.viewport,
          activeItems,
          sessionLiveStateRef.current.connections
        );

        const nextSelectedIds = session.additive
          ? resolveCanvasMarqueeSelection(baseSelectedIds, hitIds, true)
          : hitIds;
        const nextSelectedConnectionIds = session.additive
          ? resolveCanvasMarqueeSelection(baseSelectedConnectionIds, hitConnectionIds, true)
          : hitConnectionIds;
        const nextPrimaryId = getPrimarySelectedId(nextSelectedIds);
        const nextItems = moveCanvasItemsToFront(
          sessionLiveStateRef.current.items,
          nextSelectedIds
        );
        commitCanvasSelectionUI({
          itemIds: nextSelectedIds,
          connectionIds: nextSelectedConnectionIds,
        });
        syncSessionLiveState({ items: nextItems });
        stageCanvasCommit({
          items: nextItems,
          selectedIds: nextSelectedIds,
          selectedId: nextPrimaryId,
          selectedConnectionIds: nextSelectedConnectionIds,
          saveSession: true,
        });

        finish();
      },
      onCancel: () => {
        finish();
        schedulePendingCanvasCommit();
      },
    });
  };
  const stableBeginCanvasMarquee = useStableEvent(beginCanvasMarquee);

  const handleCanvasPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    const activeElement = document.activeElement;
    if (activeElement instanceof HTMLElement && activeElement.closest('[data-zoom-control="true"]')) {
      activeElement.blur();
    }
    if (isEventInsideTextCardPanel(target)) {
      return;
    }

    if (target.dataset.canvas === 'true') {
      const gesture = resolveCanvasPointerGesture({
        tool,
        button: e.button,
        ctrlKey: e.ctrlKey,
        isSpacePressed,
        target: 'canvas',
      });
      if (gesture === 'marquee') {
        stableBeginCanvasMarquee(e);
        return;
      }
      if (gesture === 'pan') {
        beginCanvasPan(e, {
          clearSelectionOnClick: tool === 'select' && e.button === 0 && !isSpacePressed,
        });
        return;
      }
    }

    if (isPanningRef.current) cancelInteraction('viewport-handoff');
    cancelViewportAnimation();

    if (editingAnnotationTextId && !target.closest('[data-annotation-text-editor="true"]')) {
      finalizeAnnotationTextEditing(editingAnnotationTextId);
    }

    if (e.button === 0) {
      e.preventDefault();
    }

    if (connectionSessionRef.current && target.dataset.canvas === 'true') {
      resetConnectionInteraction();
      return;
    }

    if (e.button === 0 && tool === 'draw') {
      const relativePoint = getCanvasRelativePoint(e.clientX, e.clientY);
      if (!relativePoint) return;
      const canvasPoint = toCanvasPoint(relativePoint);
      const nextDraft: DraftStroke = {
        pointerId: e.pointerId,
        points: [{ x: canvasPoint.x, y: canvasPoint.y, pressure: e.pressure }],
        color: annotationColor,
        width: annotationStrokeWidth,
      };
      try {
        canvasRef.current?.setPointerCapture(e.pointerId);
      } catch {}
      draftStrokeRef.current = nextDraft;
      setDraftStroke(nextDraft);
      setSelectedConnectionIds([]);
      setSelectedId(null);
      setSelectedIds([]);
      e.preventDefault();
      return;
    }

    if (e.button === 0 && tool === 'annotation-text') {
      const relativePoint = getCanvasRelativePoint(e.clientX, e.clientY);
      if (!relativePoint) return;
      e.preventDefault();
      createAnnotationTextAtCanvasPoint(toCanvasPoint(relativePoint));
      return;
    }

  };

  const handleCanvasPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (isManagedPointer(e.pointerId)) return;
    const activeRegionDraft = regionDraftRef.current;
    if (activeRegionDraft && activeRegionDraft.pointerId === e.pointerId) {
      const item = itemsRef.current.find((candidate) => candidate.id === activeRegionDraft.imageItemId);
      if (!item) return;
      const current = getRegionImagePointFromClient(item, e.clientX, e.clientY);
      if (!current) return;
      activeRegionDraft.current = current;
      const content = getRegionImageContent(item);
      const startLocal = imageNormalizedToItemLocal({
        point: activeRegionDraft.start,
        content,
        naturalWidth: content.naturalWidth,
        naturalHeight: content.naturalHeight,
        fit: content.fit,
      });
      const currentLocal = imageNormalizedToItemLocal({
        point: current,
        content,
        naturalWidth: content.naturalWidth,
        naturalHeight: content.naturalHeight,
        fit: content.fit,
      });
      const visual = getRegionDraftVisualController();
      if (startLocal && currentLocal && visual) {
        const left = Math.min(startLocal.x, currentLocal.x);
        const top = Math.min(startLocal.y, currentLocal.y);
        const width = Math.abs(currentLocal.x - startLocal.x);
        const height = Math.abs(currentLocal.y - startLocal.y);
        visual.setBoxX(left);
        visual.setBoxY(top);
        visual.setBoxScaleX(Math.max(0.001, width));
        visual.setBoxScaleY(Math.max(0.001, height));
        visual.setMarkerX(left + width / 2);
        visual.setMarkerY(top + height / 2);
      }
      return;
    }
    const activeDraftStroke = draftStrokeRef.current;
    if (activeDraftStroke && activeDraftStroke.pointerId === e.pointerId) {
      const coalescedEvents = typeof e.nativeEvent.getCoalescedEvents === 'function'
        ? e.nativeEvent.getCoalescedEvents()
        : [e.nativeEvent];
      const nextPoints = coalescedEvents.flatMap((pointerEvent) => {
        const relativePoint = getCanvasRelativePoint(pointerEvent.clientX, pointerEvent.clientY);
        if (!relativePoint) return [];
        const canvasPoint = toCanvasPoint(relativePoint);
        return [{ x: canvasPoint.x, y: canvasPoint.y, pressure: pointerEvent.pressure }];
      });
      if (nextPoints.length > 0) {
        const nextDraft = {
          ...activeDraftStroke,
          points: [...activeDraftStroke.points, ...nextPoints],
        };
        draftStrokeRef.current = nextDraft;
        draftStrokePathRef.current?.setAttribute('d', buildStrokePath(nextDraft.points));
      }
      return;
    }

  };

  const handleCanvasPointerLeave = () => {};

  const handleCanvasPointerUp = (e?: React.PointerEvent<HTMLDivElement>) => {
    if (e && isManagedPointer(e.pointerId)) return;
    const activeRegionDraft = regionDraftRef.current;
    if (activeRegionDraft && (!e || activeRegionDraft.pointerId === e.pointerId)) {
      if (e) {
        try {
          canvasRef.current?.releasePointerCapture(e.pointerId);
        } catch {}
      }
      const item = itemsRef.current.find((candidate) => candidate.id === activeRegionDraft.imageItemId);
      const box = buildRegionBox(activeRegionDraft.start, activeRegionDraft.current);
      const existingRegionId = activeRegionDraft.existingRegionId;
      regionDraftRef.current = null;
      regionDraftVisualRef.current = null;
      setRegionDraftPreview(null);
      setRegionRefineId(null);
      if (item?.src) {
        const region: RegionSelection = {
          id: existingRegionId || `region-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          imageItemId: item.id,
          imageSrc: item.src,
          mode: box ? 'box' : 'point',
          point: box
            ? { x: box.x + box.width / 2, y: box.y + box.height / 2 }
            : activeRegionDraft.start,
          ...(box ? { box } : {}),
          candidates: [],
          status: 'recognizing',
          confirmationStatus: 'pending',
          ...(existingRegionId ? { recognitionRevision: getRecognitionRevision(existingRegionId) } : {}),
        };
        regionEvidenceByIdRef.current.delete(region.id);
        setRegionSelections((previous) => existingRegionId
          ? previous.map((candidate) => candidate.id === existingRegionId ? region : candidate)
          : [...previous, region]);
        setChatReferenceTokens((previous) => {
          const token = buildRegionReferenceToken(region);
          const hasToken = previous.some((candidate) => candidate.regionId === region.id);
          return (hasToken
            ? previous.map((candidate) => candidate.regionId === region.id ? token : candidate)
            : [...previous, token]
          ).slice(0, 14);
        });
        void startRegionRecognition(region);
      }
      return;
    }
    const activeDraftStroke = draftStrokeRef.current;
    if (activeDraftStroke && (!e || activeDraftStroke.pointerId === e.pointerId)) {
      if (e) {
        try {
          canvasRef.current?.releasePointerCapture(e.pointerId);
        } catch {}
      }
      const strokeItem = createStrokeCanvasItem(activeDraftStroke);
      draftStrokeRef.current = null;
      setDraftStroke(null);
      if (strokeItem) {
        recordCurrentCanvasUndoSnapshot();
        setItems((prev) => [...prev, strokeItem]);
        setSelectedConnectionIds([]);
        setSelectedId(strokeItem.id);
        setSelectedIds([strokeItem.id]);
      }
      if (currentSessionId) scheduleCurrentSessionSave();
      return;
    }

    const completedCornerResize = isCornerResizingRef.current;
    if (completedCornerResize) commitCornerResizePreview();
    isCornerResizingRef.current = false;
    updateCanvasInteractionPhase('idle');
    draggingItemIdsRef.current = [];
    dragItemStartPositionsRef.current = {};

    commitPendingCanvasUndoSnapshot();

    if (completedCornerResize) {
      schedulePendingCanvasCommit();
    } else if (currentSessionId) {
      scheduleCurrentSessionSave();
    }
  };

  const applyViewportScale = useCallback(
    (nextScale: number, anchor?: { x: number; y: number }) => {
      const nextViewport = getScaledViewportAtAnchor(
        visualViewportRef.current,
        nextScale,
        anchor
      );
      animateViewportTo(nextViewport);
    },
    [animateViewportTo, getScaledViewportAtAnchor]
  );

  const fitCanvasItemsToViewport = useCallback(() => {
    const canvas = canvasRef.current;
    const bounds = getCanvasItemsVisualBounds(itemsRef.current);
    if (!canvas || !bounds) return;

    const padding = 80;
    const { width: canvasWidth, height: canvasHeight } = canvasMetricsRef.current;
    const safeAreaWidth = chatPanelIsDesktopRef.current ? chatSafeAreaWidthRef.current : 0;
    const visibleCanvasWidth = Math.max(1, canvasWidth - safeAreaWidth);
    const availableWidth = Math.max(1, visibleCanvasWidth - padding * 2);
    const availableHeight = Math.max(1, canvasHeight - padding * 2);
    const scaleX = bounds.width > 0 ? availableWidth / bounds.width : visualViewportRef.current.scale;
    const scaleY = bounds.height > 0 ? availableHeight / bounds.height : visualViewportRef.current.scale;
    const nextScale = Math.min(Math.max(Math.min(scaleX, scaleY), 0.1), 10);
    const nextViewport = getViewportCenteredOnBounds(
      { ...visualViewportRef.current, scale: nextScale },
      bounds,
      visibleCanvasWidth,
      canvasHeight
    );

    animateViewportTo(nextViewport);
  }, [animateViewportTo]);

  const handleNativeCanvasWheel = useCallback((event: WheelEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest('[data-canvas-wheel-scroll-region="true"], .panel-scrollbar')) {
      return;
    }

    if (event.cancelable) event.preventDefault();
    event.stopPropagation();
    if (hasActivePointerSession()) return;
    panReactViewportCommitCountRef.current = 0;
    const metrics = canvasMetricsRef.current;
    if (metrics.width <= 0 || metrics.height <= 0) return;
    const anchor = clampCanvasAnchor({
      x: event.clientX - metrics.left,
      y: event.clientY - metrics.top,
    }, metrics);
    const normalizedDeltaY = normalizeCanvasWheelDelta(
      event.deltaY,
      event.deltaMode,
      metrics.height
    );
    if (normalizedDeltaY === 0) return;

    const token = handoffCanvasViewportMotion('wheel');
    const nextViewport = applyDirectZoom(
      visualViewportRef.current,
      normalizedDeltaY,
      anchor
    );
    previewCanvasViewport(nextViewport);
    syncSessionLiveState({ viewport: nextViewport });
    stageCanvasCommit({ viewport: nextViewport, viewportToken: token, saveSession: true });
  }, [handoffCanvasViewportMotion, hasActivePointerSession, previewCanvasViewport, stageCanvasCommit, syncSessionLiveState]);

  const handleConnectionPointerDown = useCallback(
    (e: React.PointerEvent<SVGPathElement>, connectionId: string) => {
      const gesture = resolveCanvasPointerGesture({
        tool,
        button: e.button,
        ctrlKey: e.ctrlKey,
        isSpacePressed,
        target: 'item',
      });
      if (gesture === 'marquee') {
        stableBeginCanvasMarquee(e);
        return;
      }
      if (gesture === 'pan') {
        beginCanvasPan(e);
        return;
      }
      if (tool !== 'select' || e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      if (connectionSessionRef.current) {
        resetConnectionInteraction();
      }
      if (e.shiftKey) {
        const nextConnectionIds = toggleSelectionId(selectedConnectionIdsRef.current, connectionId);
        selectedConnectionIdsRef.current = nextConnectionIds;
        setSelectedConnectionIds(nextConnectionIds);
        return;
      }
      selectedConnectionIdsRef.current = [connectionId];
      selectedIdsRef.current = [];
      selectedIdRef.current = null;
      setSelectedConnectionIds([connectionId]);
      setSelectedId(null);
      setSelectedIds([]);
    },
    [beginCanvasPan, isSpacePressed, resetConnectionInteraction, stableBeginCanvasMarquee, tool]
  );

  const handleInputPortEnter = useCallback((itemId: string) => {
    setHoveredItem(itemId);
  }, [setHoveredItem]);

  const handleInputPortLeave = useCallback(
    (itemId: string) => {
      if (connectionSessionRef.current?.snapTargetId === itemId) return;
      setHoveredItem(null);
    },
    [setHoveredItem]
  );

  const handleOutputPortEnter = useCallback((itemId: string) => {
    setHoveredItem(itemId);
  }, [setHoveredItem]);

  const handleOutputPortLeave = useCallback((itemId: string) => {
    if (connectionSessionRef.current?.fromItemId === itemId) return;
    setHoveredItem(null);
  }, [setHoveredItem]);

  const handleOutputPortPointerDown = (e: React.PointerEvent<HTMLElement>, item: CanvasItem) => {
    if (e.button !== 0) return;
    if (tool !== 'select') return;
    e.preventDefault();
    e.stopPropagation();
    const liveItem = itemByIdRef.current.get(item.id) ?? item;
    beginConnectionDragFromItem(liveItem, e.pointerId, e.clientX, e.clientY);
  };

  const handleSelectionGroupPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const gesture = resolveCanvasPointerGesture({
        tool,
        button: e.button,
        ctrlKey: e.ctrlKey,
        isSpacePressed,
        target: 'item',
      });
      if (gesture === 'marquee') {
        stableBeginCanvasMarquee(e);
        return;
      }
      if (gesture === 'pan') {
        beginCanvasPan(e);
        return;
      }
      if (gesture !== 'item') return;
      e.preventDefault();
      e.stopPropagation();
      const activeSelectedIds = selectedIdsRef.current;
      if (e.altKey) {
        beginAltDragCopiedItems(
          e.clientX,
          e.clientY,
          activeSelectedIds,
          getPrimarySelectedId(activeSelectedIds),
          e.pointerId,
          e.pointerType
        );
        return;
      }
      beginDraggingSelectedItems(
        e.clientX,
        e.clientY,
        activeSelectedIds,
        getPrimarySelectedId(activeSelectedIds),
        e.pointerId,
        e.pointerType
      );
    },
    [beginAltDragCopiedItems, beginCanvasPan, beginDraggingSelectedItems, getPrimarySelectedId, isSpacePressed, stableBeginCanvasMarquee, tool]
  );

  const handleItemMouseEnter = useCallback((itemId: string) => {
    setHoveredItem(itemId);
  }, [setHoveredItem]);

  const handleItemMouseLeave = useCallback((itemId: string) => {
    if (connectionSessionRef.current?.fromItemId === itemId) return;
    setHoveredItem(null);
  }, [setHoveredItem]);

  const syncCanvasSelectionDom = useCallback((itemIds: readonly string[]) => {
    const visibleItemId = itemIds.length === 1 ? itemIds[0] : null;
    const affectedIds = new Set([
      ...sessionLiveStateRef.current.items.map((item) => item.id),
      ...canvasDomSelectedIdsRef.current,
      ...itemIds,
    ]);
    affectedIds.forEach((itemId) => {
      const targets = getItemTargets([itemId]);
      const resizeTarget = targets.find((target) => (
        target.role === 'node-resize' || target.role === 'annotation-resize'
      ));
      if (!resizeTarget) return;
      const selected = itemId === visibleItemId;
      if (selected) resizeTarget.element.dataset.canvasSelected = 'true';
      else delete resizeTarget.element.dataset.canvasSelected;
      const outlineTarget = targets.find((target) => target.role === 'node-selection-outline');
      if (outlineTarget) outlineTarget.element.style.visibility = selected ? 'visible' : 'hidden';
      const dragTarget = targets.find((target) => (
        target.role === 'node-drag' || target.role === 'annotation-drag'
      ));
      if (dragTarget) {
        dragTarget.element.style.willChange = selected
          ? 'transform'
          : '';
      }
    });
    canvasDomSelectedIdsRef.current = [...itemIds];
  }, [getItemTargets]);

  const restoreCanvasSelectionGesture = useCallback(() => {
    const gesture = pendingCanvasSelectionGestureRef.current;
    if (!gesture) return;
    pendingCanvasSelectionGestureRef.current = null;
    selectedIdRef.current = gesture.previousSelectedId;
    selectedIdsRef.current = gesture.previousSelectedIds;
    selectedConnectionIdsRef.current = gesture.previousConnectionIds;
    syncCanvasSelectionDom(gesture.previousSelectedIds);
    gesture.overlayVisibility.forEach((snapshot) => {
      if (!snapshot.root.isConnected) return;
      snapshot.root.style.visibility = snapshot.visibility;
      snapshot.root.style.pointerEvents = snapshot.pointerEvents;
    });
  }, [syncCanvasSelectionDom]);
  restoreCanvasSelectionGestureRef.current = restoreCanvasSelectionGesture;

  const previewCanvasSelectionDom = useCallback((itemIds: string[]) => {
    restoreCanvasSelectionGestureRef.current();
    const primaryId = getPrimarySelectedId(itemIds);
    if (!primaryId) return null;
    const gesture: PendingCanvasSelectionGesture = {
      itemIds: [...itemIds],
      primaryId,
      previousSelectedId: selectedIdRef.current,
      previousSelectedIds: [...selectedIdsRef.current],
      previousConnectionIds: [...selectedConnectionIdsRef.current],
      overlayVisibility: [],
      pointerDownAt: performance.now(),
      firstDragVisualAt: null,
      activated: false,
    };
    pendingCanvasSelectionGestureRef.current = gesture;
    canvasSelectionReactCommitDuringInteractionCountRef.current = 0;
    selectedIdRef.current = primaryId;
    selectedIdsRef.current = gesture.itemIds;
    selectedConnectionIdsRef.current = [];
    syncCanvasSelectionDom(gesture.itemIds);
    return gesture;
  }, [getPrimarySelectedId, syncCanvasSelectionDom]);

  const cancelPendingCanvasSelectionFinalize = useCallback(() => {
    if (pendingCanvasSelectionFinalizeFrameRef.current === null) return;
    cancelAnimationFrame(pendingCanvasSelectionFinalizeFrameRef.current);
    pendingCanvasSelectionFinalizeFrameRef.current = null;
  }, []);
  cancelPendingCanvasSelectionFinalizeRef.current = cancelPendingCanvasSelectionFinalize;

  const commitCanvasSelectionUI = useCallback(({
    itemIds,
    connectionIds = [],
  }: {
    itemIds: string[];
    connectionIds?: string[];
  }) => {
    const primaryId = getPrimarySelectedId(itemIds);
    const primaryItem = primaryId ? itemByIdRef.current.get(primaryId) : null;
    const pendingGesture = pendingCanvasSelectionGestureRef.current;
    if (isCanvasCommitBlocked()) {
      canvasSelectionReactCommitDuringInteractionCountRef.current += 1;
    }
    const hasSelectedOverlay = Boolean(
      primaryItem && (
        isImageAssetItem(primaryItem) ||
        isImageCardItem(primaryItem) ||
        (primaryItem.type === 'text' && primaryItem.textVariant === 'card')
      )
    );
    if (
      primaryId &&
      hasSelectedOverlay &&
      (Boolean(pendingGesture) || selectedIdRef.current !== primaryId) &&
      canvasPerformanceEnabledRef.current
    ) {
      const releasedAt = performance.now();
      pendingCanvasOverlayMountMeasureRef.current = {
        itemId: primaryId,
        startedAt: pendingGesture?.pointerDownAt ?? releasedAt,
        releasedAt,
        firstDragVisualAt: pendingGesture?.firstDragVisualAt ?? null,
        selectionReactCommitDuringInteractionCount:
          canvasSelectionReactCommitDuringInteractionCountRef.current,
      };
      canvasOverlaySyncWriteCountRef.current = 0;
      canvasOverlayReactCommitDuringInteractionCountRef.current = 0;
    }
    const sameItemIds =
      selectedIds.length === itemIds.length &&
      selectedIds.every((itemId, index) => itemId === itemIds[index]);
    const sameConnectionIds =
      selectedConnectionIds.length === connectionIds.length &&
      selectedConnectionIds.every((connectionId, index) => connectionId === connectionIds[index]);
    const samePrimaryId = selectedId === primaryId;
    selectedConnectionIdsRef.current = connectionIds;
    selectedIdsRef.current = itemIds;
    selectedIdRef.current = primaryId;
    syncCanvasSelectionDom(itemIds);
    if (!sameConnectionIds) setSelectedConnectionIds(connectionIds);
    if (!sameItemIds) setSelectedIds(itemIds);
    if (!samePrimaryId) setSelectedId(primaryId);
    return primaryId;
  }, [getPrimarySelectedId, isCanvasCommitBlocked, selectedConnectionIds, selectedId, selectedIds, syncCanvasSelectionDom]);

  const finalizeCanvasSelectionGesture = useCallback(({
    itemIds: requestedItemIds,
    items: preparedItems,
    reason,
    saveSession = true,
  }: FinalizeCanvasSelectionGestureOptions) => {
    const gesture = pendingCanvasSelectionGestureRef.current;
    const itemIds = requestedItemIds ?? gesture?.itemIds ?? selectedIdsRef.current;
    const primaryId = getPrimarySelectedId(itemIds);
    if (!preparedItems && (reason === 'click' || reason === 'drag')) {
      cancelPendingCanvasSelectionFinalize();
      pendingCanvasSelectionFinalizeFrameRef.current = requestAnimationFrame(() => {
        pendingCanvasSelectionFinalizeFrameRef.current = null;
        if (gesture && pendingCanvasSelectionGestureRef.current !== gesture) return;
        const connectionIds: string[] = [];
        commitCanvasSelectionUI({ itemIds, connectionIds });
        pendingCanvasSelectionGestureRef.current = null;
        stageCanvasCommit({
          selectedConnectionIds: connectionIds,
          selectedIds: itemIds,
          selectedId: primaryId,
          saveSession,
        });
        if (canvasPerformanceEnabledRef.current) {
          console.info('[canvas-selection-gesture-perf]', {
            reason,
            pointerDownToFinalize:
              gesture ? performance.now() - gesture.pointerDownAt : null,
            firstDragVisual: null,
            selectionReactCommitDuringInteractionCount:
              canvasSelectionReactCommitDuringInteractionCountRef.current,
          });
        }
        schedulePendingCanvasCommit();
      });
      return;
    }
    const baseItems = preparedItems ?? sessionLiveStateRef.current.items.map((item) => {
      const liveItem = itemByIdRef.current.get(item.id);
      if (!liveItem || liveItem === item) return item;
      return {
        ...item,
        x: liveItem.x,
        y: liveItem.y,
        width: liveItem.width,
        height: liveItem.height,
      };
    });
    const nextItems = preparedItems ?? moveCanvasItemsToFront(baseItems, itemIds);
    syncSessionLiveState({ items: nextItems });
    commitCanvasSelectionUI({ itemIds, connectionIds: [] });
    pendingCanvasSelectionGestureRef.current = null;
    stageCanvasCommit({
      items: nextItems,
      selectedConnectionIds: [],
      selectedIds: itemIds,
      selectedId: primaryId,
      saveSession,
    });
    if (canvasPerformanceEnabledRef.current) {
      console.info('[canvas-selection-gesture-perf]', {
        reason,
        pointerDownToFinalize:
          gesture ? performance.now() - gesture.pointerDownAt : null,
        firstDragVisual:
          gesture?.firstDragVisualAt === null || gesture?.firstDragVisualAt === undefined
            ? null
            : gesture.firstDragVisualAt - gesture.pointerDownAt,
        selectionReactCommitDuringInteractionCount:
          canvasSelectionReactCommitDuringInteractionCountRef.current,
      });
    }
    schedulePendingCanvasCommit();
  }, [cancelPendingCanvasSelectionFinalize, commitCanvasSelectionUI, getPrimarySelectedId, schedulePendingCanvasCommit, stageCanvasCommit, syncSessionLiveState]);
  finalizeCanvasSelectionGestureRef.current = finalizeCanvasSelectionGesture;

  useLayoutEffect(() => {
    syncCanvasSelectionDom(selectedIds);
  }, [items, selectedIds, syncCanvasSelectionDom]);

  const applyCanvasSelection = useCallback((
    nextSelectedIds: string[],
    options: { defer?: boolean } = {}
  ) => {
    const nextPrimaryId = commitCanvasSelectionUI({ itemIds: nextSelectedIds });
    const liveItems = sessionLiveStateRef.current.items.map((item) => {
      const liveItem = itemByIdRef.current.get(item.id);
      if (!liveItem || liveItem === item) return item;
      return {
        ...item,
        x: liveItem.x,
        y: liveItem.y,
        width: liveItem.width,
        height: liveItem.height,
      };
    });
    const nextItems = moveCanvasItemsToFront(liveItems, nextSelectedIds);
    syncSessionLiveState({ items: nextItems });
    stageCanvasCommit({
      items: nextItems,
      selectedConnectionIds: [],
      selectedIds: nextSelectedIds,
      selectedId: nextPrimaryId,
    });
    if (!options.defer) flushPendingCanvasCommit('selection');
  }, [commitCanvasSelectionUI, flushPendingCanvasCommit, stageCanvasCommit, syncSessionLiveState]);

  const handleItemClick = useCallback((e: React.MouseEvent<HTMLDivElement>, itemId: string) => {
    e.stopPropagation();
    if (tool !== 'select') return;
    const suppressedItemClickId = suppressNextItemClickRef.current;
    if (suppressedItemClickId) {
      suppressNextItemClickRef.current = null;
      if (suppressNextItemClickTimerRef.current) {
        clearTimeout(suppressNextItemClickTimerRef.current);
        suppressNextItemClickTimerRef.current = null;
      }
      if (suppressedItemClickId === itemId) {
        return;
      }
    }
    if (e.shiftKey) {
      applyCanvasSelection(toggleSelectionId(selectedIdsRef.current, itemId));
      return;
    }
    if (selectedIdsRef.current.includes(itemId) || selectedIdRef.current === itemId) return;
    applyCanvasSelection([itemId]);
  }, [applyCanvasSelection, tool]);

  const handleItemPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>, itemId: string) => {
      const target = e.target as HTMLElement;
      if (target.dataset.cornerResize) return;
      if (target.dataset.port) return;
      const gesture = resolveCanvasPointerGesture({
        tool,
        button: e.button,
        ctrlKey: e.ctrlKey,
        isSpacePressed,
        target: 'item',
      });
      if (gesture === 'marquee') {
        stableBeginCanvasMarquee(e);
        return;
      }
      if (gesture === 'pan') {
        beginCanvasPan(e);
        return;
      }
      if (tool === 'target') {
        if (e.button !== 0) return;
        const item = itemsRef.current.find((candidate) => candidate.id === itemId);
        if (!item || item.type !== 'image' || !item.src) return;
        const refineRegion = regionRefineId
          ? regionSelectionsRef.current.find((candidate) => candidate.id === regionRefineId)
          : null;
        if (refineRegion && refineRegion.imageItemId !== item.id) return;
        const point = getRegionImagePointFromClient(item, e.clientX, e.clientY);
        if (!point) return;
        e.preventDefault();
        e.stopPropagation();
        regionDraftRef.current = {
          pointerId: e.pointerId,
          imageItemId: item.id,
          ...(refineRegion ? { existingRegionId: refineRegion.id } : {}),
          start: point,
          current: point,
        };
        regionDraftVisualRef.current = null;
        setRegionDraftPreview({
          id: '__region-draft__',
          imageItemId: item.id,
          imageSrc: item.src,
          mode: 'box',
          point,
          box: { x: point.x, y: point.y, width: 0, height: 0 },
          candidates: [],
          status: 'recognizing',
          confirmationStatus: 'pending',
        });
        try {
          canvasRef.current?.setPointerCapture(e.pointerId);
        } catch {}
        setSelectedConnectionIds([]);
        return;
      }
      if (gesture !== 'item') return;
      if (e.shiftKey) return;
      if (editingTextCardId === itemId) {
        finalizeManualTextCardEditing(itemId);
      }
      const activeSelectedIds = selectedIdsRef.current;
      const itemIsSelected = activeSelectedIds.includes(itemId);
      if (!itemIsSelected) {
        previewCanvasSelectionDom([itemId]);
      }
      e.preventDefault();
      e.stopPropagation();
      const draggingIds = itemIsSelected ? activeSelectedIds : [itemId];
      if (e.altKey) {
        beginAltDragCopiedItems(e.clientX, e.clientY, draggingIds, itemId, e.pointerId, e.pointerType);
        return;
      }
      beginDraggingSelectedItems(e.clientX, e.clientY, draggingIds, itemId, e.pointerId, e.pointerType);
    },
    [beginAltDragCopiedItems, beginCanvasPan, beginDraggingSelectedItems, editingTextCardId, finalizeManualTextCardEditing, getRegionImagePointFromClient, isSpacePressed, previewCanvasSelectionDom, regionRefineId, stableBeginCanvasMarquee, tool]
  );

  const handleCornerResizePointerDown = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>, item: CanvasItem) => {
      const gesture = resolveCanvasPointerGesture({
        tool,
        button: e.button,
        ctrlKey: e.ctrlKey,
        isSpacePressed,
        target: 'item',
      });
      if (gesture === 'marquee') {
        stableBeginCanvasMarquee(e);
        return;
      }
      if (gesture === 'pan') {
        beginCanvasPan(e);
        return;
      }
      if (gesture !== 'item') return;
      interruptCanvasCommitForInteraction('resize');
      const liveItem = itemByIdRef.current.get(item.id) ?? item;
      pendingCanvasHistorySnapshotRef.current = createCurrentCanvasUndoSnapshot();
      if (isPanningRef.current) cancelInteraction('viewport-handoff');
      cancelZoomAnimation();
      e.preventDefault();
      e.stopPropagation();
      if (!selectedIdsRef.current.includes(liveItem.id)) {
        previewCanvasSelectionDom([liveItem.id]);
      }
      isCornerResizingRef.current = true;
      updateCanvasInteractionPhase('resize');
      const overlayVisibility = hideCanvasSelectionOverlayGroups();
      const target = getItemTargets([liveItem.id]).find((candidate) => (
        candidate.role === 'node-drag' || candidate.role === 'annotation-drag'
      )) ?? null;
      if (target) {
        target.element.style.willChange = 'width,height';
      }
      cornerResizePreviewRef.current = {
        itemId: liveItem.id,
        target,
        startWidth: liveItem.width,
        startHeight: liveItem.height,
        nextWidth: liveItem.width,
        nextHeight: liveItem.height,
        overlayVisibility,
      };
      const startX = e.clientX;
      const startY = e.clientY;
      startPointerSession({
        mode: 'item-resize',
        pointerId: e.pointerId,
        startPoint: { x: startX, y: startY },
        onFrame: (pointerX, pointerY) => {
          const preview = cornerResizePreviewRef.current;
          if (!preview || preview.itemId !== liveItem.id) return;
          const deltaX = (pointerX - startX) / Math.max(0.001, viewportRef.current.scale);
          const deltaY = (pointerY - startY) / Math.max(0.001, viewportRef.current.scale);
          const nextSize = applyDirectItemResize({
            item: liveItem,
            startWidth: preview.startWidth,
            startHeight: preview.startHeight,
            deltaX,
            deltaY,
            minWidth: liveItem.textVariant === 'card' ? 260 : 40,
            minHeight: liveItem.textVariant === 'card' ? 300 : 40,
            preserveAspectRatio: liveItem.textVariant !== 'card',
          });
          preview.nextWidth = nextSize.width;
          preview.nextHeight = nextSize.height;
          if (target) {
            target.element.style.width = `${nextSize.width}px`;
            target.element.style.height = `${nextSize.height}px`;
          }
          syncCanvasItemPortPositions({ ...liveItem, ...nextSize });
          flushAffectedConnectionWork();
          markCanvasInteractionVisualFrame('resize');
        },
        onEnd: () => {
          const preview = cornerResizePreviewRef.current;
          if (preview) {
            refreshDirectItemConnectionPaths(preview.itemId, {
              width: preview.nextWidth,
              height: preview.nextHeight,
            });
          }
          commitCornerResizePreview();
          isCornerResizingRef.current = false;
          updateCanvasInteractionPhase('idle');
          commitPendingCanvasUndoSnapshot();
          if (pendingCanvasSelectionGestureRef.current?.primaryId === liveItem.id) {
            finalizeCanvasSelectionGestureRef.current({ reason: 'click' });
          }
          requestAnimationFrame(() => {
            syncSelectedCanvasOverlayPositions(visualViewportRef.current, [liveItem.id]);
            if (preview) restoreCanvasOverlayVisibility(preview.overlayVisibility);
          });
        },
        onCancel: () => {
          const preview = cornerResizePreviewRef.current;
          if (!preview) return;
          if (target) {
            target.element.style.width = `${preview.startWidth}px`;
            target.element.style.height = `${preview.startHeight}px`;
          }
          syncCanvasItemPortPositions(liveItem);
          syncSelectedCanvasOverlayPositions(visualViewportRef.current, [preview.itemId]);
          refreshDirectItemConnectionPaths(preview.itemId, {
            width: preview.startWidth,
            height: preview.startHeight,
          });
          if (target) restoreCanvasItemDragHint(target, preview.itemId);
          clearPendingCanvasUndoSnapshot();
          cornerResizePreviewRef.current = null;
          isCornerResizingRef.current = false;
          updateCanvasInteractionPhase('idle');
          restoreCanvasOverlayVisibility(preview.overlayVisibility);
          restoreCanvasSelectionGestureRef.current();
          schedulePendingCanvasCommit();
        },
      });
    },
    [beginCanvasPan, cancelInteraction, cancelZoomAnimation, clearPendingCanvasUndoSnapshot, commitCornerResizePreview, commitPendingCanvasUndoSnapshot, createCurrentCanvasUndoSnapshot, flushAffectedConnectionWork, getItemTargets, hideCanvasSelectionOverlayGroups, interruptCanvasCommitForInteraction, isSpacePressed, markCanvasInteractionVisualFrame, previewCanvasSelectionDom, refreshDirectItemConnectionPaths, restoreCanvasItemDragHint, restoreCanvasOverlayVisibility, schedulePendingCanvasCommit, stableBeginCanvasMarquee, startPointerSession, syncCanvasItemPortPositions, syncSelectedCanvasOverlayPositions, tool, updateCanvasInteractionPhase]
  );

  useEffect(() => {
    if (isHydratingSessionRef.current) {
      return;
    }

    const validIds = new Set(canvasItemMembershipKey ? canvasItemMembershipKey.split('\u0000') : []);
    setConnections((prev) => {
      const next = prev.filter((connection) => validIds.has(connection.fromItemId) && validIds.has(connection.toItemId));
      return next.length === prev.length ? prev : next;
    });
    setSelectedConnectionIds((prev) =>
      prev.filter((id) =>
        connections.some(
          (connection) =>
            connection.id === id &&
            validIds.has(connection.fromItemId) &&
            validIds.has(connection.toItemId)
        )
      )
    );
    if (
      connectionSessionRef.current?.snapTargetId &&
      !validIds.has(connectionSessionRef.current.snapTargetId)
    ) {
      connectionSessionRef.current.snapTargetId = null;
      clearConnectionSnapTargetVisualRef.current();
    }
    if (connectionSessionRef.current?.fromItemId && !validIds.has(connectionSessionRef.current.fromItemId)) {
      resetConnectionInteraction();
    }
  }, [canvasItemMembershipKey, connectionPointerId, connections, resetConnectionInteraction, setConnections]);

  useEffect(() => {
    if (isHydratingSessionRef.current) {
      isHydratingSessionRef.current = false;
    }
  });

  useEffect(() => {
    return () => {
      viewportTweenRef.current?.cancel();
      const resizePreview = cornerResizePreviewRef.current;
      if (resizePreview?.target) resizePreview.target.element.style.willChange = resizePreview.target.initialWillChange;
      cornerResizePreviewRef.current = null;
      flushPendingCanvasCommit('unmount');
    };
  }, [flushPendingCanvasCommit]);

  const handleCanvasTextGenerate = useCallback(
    async ({
      itemId,
      input,
      linkedImagePreviews,
      modelId,
    }: {
      itemId: string;
      input: string;
      linkedImagePreviews: Array<{ id: string; src: string; label: string; alt?: string }>;
      modelId: string;
    }) => {
      const trimmedInput = input.trim();
      if (!itemId || !trimmedInput) return;

      if (
        !canStartCanvasTextGeneration({
          itemId,
          activeGenerations: activeCanvasTextGenerations,
        })
      ) {
        const isDuplicateGeneration = !!activeCanvasTextGenerations[itemId];
        if (!isDuplicateGeneration) {
          setCanvasTextGenerationErrorById((prev) => ({
            ...prev,
            [itemId]: `当前最多同时生成 ${CANVAS_TEXT_GENERATION_CONCURRENCY_LIMIT} 个文本节点`,
          }));
        }
        return;
      }

      setCanvasTextGenerationErrorById((prev) => {
        if (!prev[itemId]) return prev;
        const next = { ...prev };
        delete next[itemId];
        return next;
      });

      const generationSessionId = currentSessionIdRef.current;
      const generationStartedAt = Date.now();
      const controller = new AbortController();
      canvasTextGenerateAbortControllersRef.current.set(itemId, controller);
      setActiveCanvasTextGenerations((prev) => ({
        ...prev,
        [itemId]: {
          status: 'running',
          startedAt: generationStartedAt,
        },
      }));
      setShowTextPanelProviderMenu(false);
      setShowTextPanelModelMenu(false);

      try {
        const response = await fetch('/api/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(
            buildCanvasTextGenerationRequest({
              input: trimmedInput,
              linkedImagePreviews,
              modelId,
              allowedModelIds: selectedTextCardProviderModelOptions.map((option) => option.id),
              fallbackModel: defaultWorkspaceTextModelOption.id,
              chatProviderId: selectedTextPanelModel.providerId,
            })
          ),
          signal: controller.signal,
        });

        if (!response.ok) {
          const errorText = await response.text();
          let errorMessage = `API Error: ${response.status} ${response.statusText}`;
          let failureClass: string | null = null;
          try {
            const errorData = JSON.parse(errorText) as { error?: string; failureClass?: string };
            if (errorData.error) {
              errorMessage = errorData.error;
            }
            if (typeof errorData.failureClass === 'string' && errorData.failureClass) {
              failureClass = errorData.failureClass;
            }
          } catch {
            if (errorText) {
              errorMessage = errorText;
            }
          }
          const requestError = new Error(errorMessage) as Error & { failureClass?: string; statusCode?: number };
          requestError.failureClass = failureClass || undefined;
          requestError.statusCode = response.status;
          throw requestError;
        }

        const result = await response.json();
        if (result.status !== 'completed' || result.result?.type !== 'chat' || typeof result.result?.content !== 'string') {
          throw new Error(result.error || '未收到有效文本响应，请重试');
        }

        if (
          currentSessionIdRef.current !== generationSessionId ||
          !itemsRef.current.some((item) => item.id === itemId)
        ) {
          return;
        }

        recordCurrentCanvasUndoSnapshot();
        setItems((prev) =>
          prev.map((item) =>
            item.id === itemId
              ? {
                  ...item,
                  text: result.result.content,
                  textMode: 'ai',
                  lastGenerationDurationMs: Math.max(0, Date.now() - generationStartedAt),
                  lastGenerationCompletedAt: Date.now(),
                }
              : item
          )
        );
      } catch (error) {
        if (
          currentSessionIdRef.current !== generationSessionId ||
          !itemsRef.current.some((item) => item.id === itemId)
        ) {
          return;
        }

        if (error instanceof Error && error.name === 'AbortError') {
          if (suppressCanvasTextAbortErrorItemIdsRef.current.has(itemId)) {
            return;
          }
          setCanvasTextGenerationErrorById((prev) => ({
            ...prev,
            [itemId]: '任务已终止',
          }));
          return;
        }

        console.error('Canvas text generation failed:', error);
        setCanvasTextGenerationErrorById((prev) => ({
          ...prev,
          [itemId]: `生成失败: ${error instanceof Error ? error.message : '未知错误'}`,
        }));
      } finally {
        suppressCanvasTextAbortErrorItemIdsRef.current.delete(itemId);
        canvasTextGenerateAbortControllersRef.current.delete(itemId);
        setActiveCanvasTextGenerations((prev) =>
          removeCanvasTextGenerationEntry({
            activeGenerations: prev,
            itemId,
          })
        );
      }
    },
    [
      activeCanvasTextGenerations,
      defaultWorkspaceTextModelOption.id,
      recordCurrentCanvasUndoSnapshot,
      selectedTextPanelModel.providerId,
      selectedTextCardProviderModelOptions,
      setItems,
    ]
  );

  const handleCancelCanvasTextGenerate = useCallback((itemId?: string | null) => {
    if (!itemId) return;
    canvasTextGenerateAbortControllersRef.current.get(itemId)?.abort();
  }, []);

  const appendGeneratedImageHistoryForSession = useCallback((
    sessionId: string | null | undefined,
    entries: GeneratedImageHistoryEntry[]
  ) => {
    const normalizedSessionId = typeof sessionId === 'string' ? sessionId.trim() : '';
    if (!normalizedSessionId) {
      return;
    }

    setGeneratedImageHistoryBySession((prev) => {
      const baseEntries = prev[normalizedSessionId] ?? persistedGeneratedImageHistoryBySessionRef.current[normalizedSessionId] ?? [];
      const nextSessionEntries = appendGeneratedImageHistoryEntries(baseEntries, entries);
      return {
        ...prev,
        [normalizedSessionId]: nextSessionEntries,
      };
    });
  }, [setGeneratedImageHistoryBySession]);

  const materializeImageCardHistoryForSession = useCallback((
    sessionId: string | null | undefined,
    item: CanvasItem | null | undefined
  ) => {
    const normalizedSessionId = typeof sessionId === 'string' ? sessionId.trim() : '';
    if (!normalizedSessionId || !item || !isImageCardItem(item)) {
      return;
    }

    const existingImageCardHistoryEntries = buildGeneratedHistoryEntriesFromImageCard({
      item,
      sourceItemId: item.id,
    });
    if (existingImageCardHistoryEntries.length === 0) {
      return;
    }

    setGeneratedImageHistoryBySession((prev) => {
      const baseEntries = prev[normalizedSessionId] ?? persistedGeneratedImageHistoryBySessionRef.current[normalizedSessionId] ?? [];
      const nextSessionEntries = appendMissingGeneratedHistoryEntries(baseEntries, existingImageCardHistoryEntries);
      return {
        ...prev,
        [normalizedSessionId]: nextSessionEntries,
      };
    });
  }, [setGeneratedImageHistoryBySession]);

  const handleCanvasImageGenerate = useCallback(
    async ({
      itemId,
      input,
      linkedImagePreviews,
      modelId,
      size,
      quality,
      count,
      aspectRatio,
    }: {
      itemId: string;
      input: string;
      linkedImagePreviews: Array<{ id: string; src: string; label: string; alt?: string }>;
      modelId: string;
      size: string;
      quality: string;
      count: number;
      aspectRatio: string;
    }) => {
      if (!itemId) return;
      if (activeCanvasImageGenerations[itemId]) return;

      const trimmedInput = typeof input === 'string' ? input.trim() : '';
      const hasReferences = linkedImagePreviews.length > 0;
      if (!trimmedInput && !hasReferences) return;

      const requestImageGeneration = async (requestBody: Record<string, unknown>, signal: AbortSignal) => {
        const response = await fetch('/api/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestBody),
          signal,
        });

        if (!response.ok) {
          const errorText = await response.text();
          let errorMessage = `API Error: ${response.status} ${response.statusText}`;
          try {
            const errorData = JSON.parse(errorText) as { error?: string };
            if (errorData.error) {
              errorMessage = errorData.error;
            }
          } catch {
            if (errorText) {
              errorMessage = errorText;
            }
          }
          throw new Error(errorMessage);
        }

        const result = await response.json();
        if (result.status !== 'completed' || result.result?.type !== 'image') {
          throw new Error(result.error || '未收到有效图片响应，请重试');
        }

        const outputUrls = extractCanvasGeneratedImageUrls(result);
        if (outputUrls.length === 0) {
          throw new Error('未收到有效图片响应，请重试');
        }

        const outputMetas = await Promise.all(outputUrls.map((localUrl) => loadCanvasGeneratedImageMeta(localUrl)));

        return {
          acceptedOutputs: outputMetas,
          warningCount: 0,
          warningMessage: null,
        };
      };

      setCanvasImageGenerationErrorById((prev) => {
        if (!prev[itemId]) return prev;
        const next = { ...prev };
        delete next[itemId];
        return next;
      });

      const generationSessionId = currentSessionIdRef.current;
      const generationStartedAt = Date.now();
      const controller = new AbortController();
      canvasImageGenerateAbortControllersRef.current.set(itemId, controller);
      setActiveCanvasImageGenerations((prev) => ({
        ...prev,
        [itemId]: {
          status: 'running',
          startedAt: generationStartedAt,
          total: count > 1 ? count : 1,
          completed: 0,
          failed: 0,
        },
      }));
      setShowImageCardProviderMenu(false);
      setShowImageCardModelMenu(false);
      setShowImageCardSettingsMenu(false);
      const currentImageCardItem = itemsRef.current.find((item) => item.id === itemId) ?? null;
      materializeImageCardHistoryForSession(generationSessionId, currentImageCardItem);
      recordCurrentCanvasUndoSnapshot();
      setItems((prev) =>
        prev.map((item) =>
          item.id === itemId && isImageCardItem(item)
            ? {
                ...item,
                src: '',
                naturalWidth: undefined,
                naturalHeight: undefined,
                imageOutputs: [],
                activeImageOutputIndex: 0,
              }
            : item
        )
      );

      try {
        const asyncRequests = buildAsyncImageTaskRequests({
          input: trimmedInput,
          linkedImagePreviews,
          modelId,
          allowedModelIds: workspaceImageModelOptions.map((option) => option.id),
          fallbackModel: defaultWorkspaceImageModelOption.id,
          imageProviderId:
            imageCardProviderById[itemId] ||
            selectedImageCardModel.providerId ||
            defaultWorkspaceImageModelOption.providerId,
          providerImageOptionProfiles,
          size,
          quality,
          count,
          aspectRatio,
        });
        const taskExecutionMode = resolveCanvasImageTaskExecutionMode({
          modelId: resolveImageCardModel(modelId),
          size,
          count,
        });

        const taskResults = await settleCanvasImageGenerationRequests({
          requests: asyncRequests,
          executionMode: taskExecutionMode,
          runTask: async (requestBody) => {
            try {
              const { acceptedOutputs, warningCount, warningMessage } = await requestImageGeneration(requestBody, controller.signal);

              if (
                currentSessionIdRef.current !== generationSessionId ||
                !itemsRef.current.some((item) => item.id === itemId)
              ) {
                return { completed: 0, failed: 0, failureReason: null, warningCount: 0, warningMessage: null };
              }

              if (acceptedOutputs.length > 0) {
                const historyTimestamp = Date.now();
                appendGeneratedImageHistoryForSession(
                  generationSessionId,
                  acceptedOutputs.map((outputMeta, index) =>
                    createGeneratedImageHistoryEntry({
                      src: outputMeta.src,
                      naturalWidth: outputMeta.naturalWidth,
                      naturalHeight: outputMeta.naturalHeight,
                      timestamp: historyTimestamp,
                      sequence: index,
                      source: 'image-card',
                      sourceItemId: itemId,
                    })
                  )
                );
              }

              for (const outputMeta of acceptedOutputs) {
                setItems((prev) =>
                  prev.map((item) => {
                    if (item.id !== itemId) {
                      return item;
                    }

                    const nextOutputState = appendImageCardOutput({
                      existingOutputs: item.imageOutputs,
                      existingActiveIndex: item.activeImageOutputIndex ?? 0,
                      nextOutput: outputMeta,
                    });

                    return {
                      ...resizeImageCardItemToNaturalImage(
                        {
                          ...item,
                          imageVariant: 'card',
                          ...nextOutputState,
                        },
                        nextOutputState.naturalWidth ?? item.naturalWidth ?? IMAGE_CARD_DEFAULT_FRAME_WIDTH,
                        nextOutputState.naturalHeight ?? item.naturalHeight ?? IMAGE_CARD_DEFAULT_FRAME_WIDTH
                      ),
                      imageVariant: 'card',
                      ...nextOutputState,
                    };
                  })
                );
              }

              setActiveCanvasImageGenerations((prev) => {
                const entry = prev[itemId];
                if (!entry) return prev;
                return {
                  ...prev,
                  [itemId]: {
                    ...entry,
                    completed: Math.min(entry.total, entry.completed + acceptedOutputs.length),
                    failed: entry.failed,
                  },
                };
              });

              return {
                completed: acceptedOutputs.length,
                failed: 0,
                failureReason: null,
                warningCount,
                warningMessage,
              };
            } catch (error) {
              if (
                controller.signal.aborted ||
                currentSessionIdRef.current !== generationSessionId ||
                !itemsRef.current.some((item) => item.id === itemId)
              ) {
                throw error;
              }

              setActiveCanvasImageGenerations((prev) => {
                const entry = prev[itemId];
                if (!entry) return prev;
                return {
                  ...prev,
                  [itemId]: {
                    ...entry,
                    failed: Math.min(entry.total, entry.failed + 1),
                  },
                };
              });

              throw error;
            }
          },
        });

        if (
          currentSessionIdRef.current !== generationSessionId ||
          !itemsRef.current.some((item) => item.id === itemId)
        ) {
          return;
        }

        const failures = taskResults.filter((result) => result.status === 'rejected');
        const requestFailureCount = failures.length;
        const transportFailureCount = failures.reduce((total, result) => {
          const failureClass =
            result.reason && typeof result.reason === 'object' && 'failureClass' in result.reason
              ? (result.reason as { failureClass?: string }).failureClass
              : null;
          return total + (failureClass === 'transport' ? 1 : 0);
        }, 0);
        const completedCount = taskResults.reduce((total, result) => {
          if (result.status !== 'fulfilled') return total;
          return total + (result.value?.completed ?? 0);
        }, 0);
        const failedCount = requestFailureCount;
        if (completedCount > 0) {
          const generationCompletedAt = Date.now();
          setItems((prev) =>
            prev.map((item) =>
              item.id === itemId
                ? {
                    ...item,
                    lastGenerationDurationMs: Math.max(0, generationCompletedAt - generationStartedAt),
                    lastGenerationCompletedAt: generationCompletedAt,
                  }
                : item
            )
          );
        }

        if (controller.signal.aborted) {
          throw new DOMException('Aborted', 'AbortError');
        }

        if (failedCount > 0) {
          setActiveCanvasImageGenerations((prev) => {
            const entry = prev[itemId];
            if (!entry) return prev;
            return {
              ...prev,
              [itemId]: {
                ...entry,
                failed: Math.min(entry.total, failedCount),
              },
            };
          });

          if (completedCount === 0) {
            const firstReason = failures[0]?.reason;
            throw firstReason instanceof Error ? firstReason : new Error('未收到有效图片响应，请重试');
          }

          const failureMessage =
            transportFailureCount > 0 && transportFailureCount === requestFailureCount
              ? `连接中断，请重试剩余 ${failedCount} 张`
              : buildCanvasImageGenerationFailureMessage({
                  requestedCount: asyncRequests.length,
                  completedCount,
                  requestFailureCount,
                }) || `请求 ${asyncRequests.length} 张，成功 ${completedCount} 张；请手动补生成剩余 ${failedCount} 张`;

          setCanvasImageGenerationErrorById((prev) => ({
            ...prev,
            [itemId]: failureMessage,
          }));
        }
      } catch (error) {
        if (
          currentSessionIdRef.current !== generationSessionId ||
          !itemsRef.current.some((item) => item.id === itemId)
        ) {
          return;
        }

        if (error instanceof Error && error.name === 'AbortError') {
          if (suppressCanvasImageAbortErrorItemIdsRef.current.has(itemId)) {
            return;
          }
          setCanvasImageGenerationErrorById((prev) => ({
            ...prev,
            [itemId]: '任务已终止',
          }));
          return;
        }

        console.error('Canvas image generation failed:', error);
        setCanvasImageGenerationErrorById((prev) => ({
          ...prev,
          [itemId]: `生成失败: ${error instanceof Error ? error.message : '未知错误'}`,
        }));
      } finally {
        suppressCanvasImageAbortErrorItemIdsRef.current.delete(itemId);
        canvasImageGenerateAbortControllersRef.current.delete(itemId);
        setActiveCanvasImageGenerations((prev) => {
          if (!prev[itemId]) return prev;
          const next = { ...prev };
          delete next[itemId];
          return next;
        });
      }
    },
    [
      activeCanvasImageGenerations,
      appendGeneratedImageHistoryForSession,
      defaultWorkspaceImageModelOption.id,
      defaultWorkspaceImageModelOption.providerId,
      imageCardProviderById,
      materializeImageCardHistoryForSession,
      providerImageOptionProfiles,
      recordCurrentCanvasUndoSnapshot,
      selectedImageCardModel.providerId,
      setItems,
      workspaceImageModelOptions,
    ]
  );

  const handleCancelCanvasImageGenerate = useCallback((itemId?: string | null) => {
    if (!itemId) return;
    canvasImageGenerateAbortControllersRef.current.get(itemId)?.abort();
  }, []);

  const handleCancelGenerate = async () => {
    updateActiveStreamMessageStatus('cancelled', '任务已终止');
    const activeMessageId = activeSkillJobMessageIdRef.current || pendingAssistantMessageIdRef.current;
    if (activeMessageId) updateChatMessageById(activeMessageId, (msg) => ({
      ...msg,
      taskStatus: 'cancelled',
      content: '任务已终止',
      agentRunProgress: msg.agentRunProgress
        ? reduceAgentRunProgress(msg.agentRunProgress, { type: 'agent_error' }) || undefined
        : undefined,
    }));
    stopStreamTypewriter();

    if (activeSkillJobId) {
      try {
        await fetch(`/api/skills/jobs/${activeSkillJobId}`, { method: 'DELETE' });
      } catch (error) {
        console.error('Cancel skill job failed:', error);
      }

      const skillPrefix = `${activeSkillJobType || 'logo'}:`;
      setChatMessages(prev => prev.map((msg) => {
        if (msg.taskKey?.startsWith(skillPrefix) && msg.taskStatus !== 'completed') {
          return {
            ...msg,
            taskStatus: 'cancelled',
            content: msg.imageName ? `${msg.imageName} 已终止` : '任务已终止',
          };
        }
        return msg;
      }));

      setActiveSkillJobId(null);
      setActiveSkillJobType(null);
      setIsGenerating(false);
      activeSkillJobMessageIdRef.current = null;
      pendingAssistantMessageIdRef.current = null;
      return;
    }

    if (generateAbortRef.current) {
      generateAbortRef.current.abort();
      generateAbortRef.current = null;
    }

    setIsGenerating(false);
    pendingAssistantMessageIdRef.current = null;
  };

  const extractMaterialRequests = (input: string): string[] => {
    const normalized = input.toLowerCase();
    const materialMatchers: Array<{ key: string; patterns: string[] }> = [
      { key: 'tshirt', patterns: ['t恤', 't-shirt', 'tshirt'] },
      { key: 'hoodie', patterns: ['卫衣', 'hoodie'] },
      { key: 'cap', patterns: ['帽子', '棒球帽', 'cap'] },
      { key: 'socks', patterns: ['袜子', 'socks'] },
      { key: 'tote_bag', patterns: ['帆布袋', 'tote', '包袋'] },
      { key: 'notebook', patterns: ['笔记本', 'notebook'] },
      { key: 'phone_case', patterns: ['手机壳', 'phone case'] },
      { key: 'mug', patterns: ['杯子', '马克杯', 'mug'] },
      { key: 'sticker_pack', patterns: ['贴纸', 'sticker'] },
      { key: 'lanyard', patterns: ['挂绳', 'lanyard'] },
      { key: 'keychain', patterns: ['钥匙扣', 'keychain'] },
      { key: 'mouse_pad', patterns: ['鼠标垫', 'mouse pad'] },
      { key: 'water_bottle', patterns: ['水壶', '水杯', 'bottle'] },
      { key: 'signage', patterns: ['导视', '标识牌', 'signage'] },
      { key: 'packaging_box', patterns: ['包装盒', 'box packaging', 'box'] },
    ];

    return materialMatchers
      .filter((item) => item.patterns.some((pattern) => normalized.includes(pattern)))
      .map((item) => item.key);
  };

  const extractUploadedLogoReferences = (): string[] => {
    const logoKeywordPattern = /(logo|标志|商标)/i;

    const byKeyword = [...chatMessages]
      .reverse()
      .find((msg) => msg.role === 'user' && msg.referenceImages?.length && logoKeywordPattern.test(msg.content || ''))
      ?.referenceImages || [];

    if (byKeyword.length > 0) {
      return [...byKeyword];
    }

    const latestUserImages = [...chatMessages]
      .reverse()
      .find((msg) => msg.role === 'user' && msg.referenceImages?.length)
      ?.referenceImages || [];

    return [...latestUserImages];
  };

  const findLatestMatch = (messages: ChatMessage[], pattern: RegExp): string | null => {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const content = messages[i]?.content || '';
      const match = content.match(pattern);
      if (match?.[1]) {
        return match[1].trim();
      }
    }
    return null;
  };

  const resolveBrandIdentity = (currentInput: string): { brandName: string; industry: string } => {
    const brandInInput = currentInput.match(/(?:品牌名称?|品牌|名称)[:：]?\s*([^\n，,。；;]+)/i)?.[1]?.trim();
    const industryInInput = currentInput.match(/(?:行业|类型)[:：]?\s*([^\n，,。；;]+)/i)?.[1]?.trim();

    const brandFromUserHistory = findLatestMatch(chatMessages.filter((m) => m.role === 'user'), /(?:品牌名称?|品牌|名称)[:：]?\s*([^\n，,。；;]+)/i);
    const industryFromUserHistory = findLatestMatch(chatMessages.filter((m) => m.role === 'user'), /(?:行业|类型)[:：]?\s*([^\n，,。；;]+)/i);

    const brandFromAssistant = findLatestMatch(chatMessages.filter((m) => m.role === 'assistant'), /品牌名称[：:]\s*([^\n，,。；;]+)/i);
    const industryFromAssistant = findLatestMatch(chatMessages.filter((m) => m.role === 'assistant'), /行业[：:]\s*([^\n，,。；;]+)/i);

    return {
      brandName: brandInInput || brandFromUserHistory || brandFromAssistant || 'MyBrand',
      industry: industryInInput || industryFromUserHistory || industryFromAssistant || '消费品',
    };
  };

  const isNoiseAssistantMessage = (msg: ChatMessage): boolean => {
    const content = msg.content || '';
    if (!content.trim()) return true;
    if (msg.taskKey) return true;
    if (/^🎯|^🧩|^✅|^⚠️|^❌|^⏹️/.test(content)) return true;
    if (content.includes('已提交') || content.includes('生成中') || content.includes('生成失败') || content.includes('已终止')) return true;
    if (content.includes('"action"') || content.includes('"action_input"') || content.includes('"thought"')) return true;
    return false;
  };

  const extractStructuredBrandContext = (): { brandBrief: string; viGuide: string } => {
    const cleanAssistantMessages = chatMessages
      .filter((msg) => msg.role === 'assistant' && !isNoiseAssistantMessage(msg))
      .map((msg) => msg.content.trim())
      .filter(Boolean);

    const briefKeywords = ['行业心智解析', '品牌名语义解码', '品牌内核推演', '差异化定位'];
    const viKeywords = ['标志设计', '标准字体', '品牌色彩系统', '标识系统扩展'];

    let brandBrief = '';
    let viGuide = '';

    for (let i = cleanAssistantMessages.length - 1; i >= 0; i -= 1) {
      const content = cleanAssistantMessages[i];
      const briefHitCount = briefKeywords.filter((k) => content.includes(k)).length;
      const viHitCount = viKeywords.filter((k) => content.includes(k)).length;

      if (!brandBrief && briefHitCount >= 2) {
        brandBrief = content;
      }
      if (!viGuide && viHitCount >= 2) {
        viGuide = content;
      }
      if (brandBrief && viGuide) break;
    }

    if (!brandBrief && cleanAssistantMessages.length > 0) {
      brandBrief = cleanAssistantMessages[cleanAssistantMessages.length - 1];
    }
    if (!viGuide && cleanAssistantMessages.length > 1) {
      viGuide = cleanAssistantMessages[cleanAssistantMessages.length - 2];
    }

    return { brandBrief, viGuide };
  };

  const handleGenerate = async (options?: {
    input?: string;
    skill?: { id: string; label: string } | null;
    referenceImagesOverride?: Array<{ id?: string; src: string; label: string; alt?: string }>;
    modelOverride?: string;
    agentConfirmation?: AgentConfirmationPayload;
    agentClarification?: AgentClarificationPayload;
    agentClarificationResponse?: AgentClarificationResponse;
    selectedContextEntityIds?: string[];
    suppressUserMessage?: boolean;
  }) => {
    const currentChatInput = options?.input ?? latestChatInputRef.current;
    if (!currentChatInput.trim()) return;
    if (
      !options?.agentConfirmation
      && pendingAgentConfirmation
      && AGENT_RETRY_CONFIRMATION_PATTERN.test(currentChatInput)
    ) {
      setChatInput('');
      submitAgentConfirmation();
      return;
    }

    const latestConversationMessageIndex = chatMessages.findLastIndex(
      (message) => message.role === 'user' || message.role === 'assistant'
    );
    const latestConversationMessage = latestConversationMessageIndex >= 0
      ? chatMessages[latestConversationMessageIndex]
      : null;
    const retrySourceMessage = !options?.agentClarification
      && AGENT_RETRY_CONFIRMATION_PATTERN.test(currentChatInput)
      && latestConversationMessage?.role === 'assistant'
      && (
        latestConversationMessage.taskStatus === 'failed'
        || latestConversationMessage.agentRunProgress?.outcome === 'failed'
      )
      ? [...chatMessages.slice(0, latestConversationMessageIndex)]
          .reverse()
          .find((message) => message.role === 'user' && message.agentClarificationResponsePayload)
      : undefined;
    const effectiveAgentClarification = options?.agentClarification
      || retrySourceMessage?.agentClarificationResponsePayload?.clarification;
    const effectiveAgentClarificationResponse = options?.agentClarificationResponse
      || retrySourceMessage?.agentClarificationResponsePayload?.response;

    const overrideReferencePayload = options?.referenceImagesOverride
      ? buildReferenceImageRequestPayload(options.referenceImagesOverride)
      : null;
    const persistedReferenceContext = effectiveAgentClarification?.state.referenceContext;
    const currentReferenceImages = overrideReferencePayload
      ? [...overrideReferencePayload.referenceImages]
      : chatReferenceImages.length > 0
        ? [...chatReferenceImages]
        : [...(persistedReferenceContext?.references || []).map((reference) => reference.src)];
    const currentComposerSegments: ChatComposerSegment[] = options?.input === undefined
      ? replaceChatComposerTextPreservingReferences(chatComposerSegmentsRef.current, currentChatInput)
      : [{ type: 'text', text: currentChatInput }];
    const composerReferenceIds = new Set(
      currentComposerSegments
        .filter((segment): segment is Extract<ChatComposerSegment, { type: 'reference' }> => segment.type === 'reference')
        .map((segment) => segment.tokenId)
    );
    const composerReferenceTokens = resolvedChatReferenceTokens
      .filter((token) => composerReferenceIds.has(token.id));
    const unresolvedRegionToken = composerReferenceTokens.find((token) => (
      token.role === 'region_target' && token.confirmationStatus !== 'confirmed'
    ));
    if (unresolvedRegionToken?.regionId) {
      setActiveRegionMenuId(unresolvedRegionToken.regionId);
      const unresolvedRegion = regionSelectionsRef.current.find((region) => region.id === unresolvedRegionToken.regionId);
      setRegionCustomLabelDraft(unresolvedRegion?.customLabel || '');
      return;
    }
    const currentReferenceContext: AgentReferenceContext | undefined = options?.input === undefined
      && (composerReferenceTokens.length > 0 || !persistedReferenceContext)
      ? {
          references: composerReferenceTokens
            .map((token) => ({
              id: token.id,
              src: token.src,
              plannerPreviewSrc: token.previewSrc || token.src,
              label: token.label,
              source: token.source,
              ...(token.canvasItemId ? { canvasItemId: token.canvasItemId } : {}),
              role: token.role,
              ...(token.annotationCount ? { annotationCount: token.annotationCount } : {}),
              ...(token.regionId ? { regionId: token.regionId } : {}),
              ...(token.candidateId ? { candidateId: token.candidateId } : {}),
              ...(token.description ? { description: token.description } : {}),
              ...(token.aliases?.length ? { aliases: token.aliases } : {}),
              ...(token.confidence ? { confidence: token.confidence } : {}),
              ...(token.confirmationStatus ? { confirmationStatus: token.confirmationStatus } : {}),
              ...(token.source === 'history' && token.sourceTaskId ? { sourceTaskId: token.sourceTaskId } : {}),
              ...(token.source === 'history' && token.sourceVersionId ? { sourceVersionId: token.sourceVersionId } : {}),
              ...(token.targetPoint ? { targetPoint: token.targetPoint } : {}),
              ...(token.targetBox ? { targetBox: token.targetBox } : {}),
            })),
          composerSegments: currentComposerSegments.map((segment) => segment.type === 'text'
            ? { type: 'text' as const, text: segment.text }
            : { type: 'reference' as const, referenceId: segment.tokenId }),
          evidenceImages: composerReferenceTokens.flatMap((token) => (
            token.role === 'region_target' && token.regionId && token.previewSrc && token.previewSrc !== token.src
              ? [{
                  id: `${token.id}:region-crop`,
                  referenceId: token.id,
                  src: token.previewSrc,
                  kind: 'region_crop' as const,
                }]
              : []
          )),
        }
      : persistedReferenceContext;
    const regionSelectionSnapshot = buildAgentRegionSelectionSnapshot({
      references: currentReferenceContext?.references || [],
      regions: regionSelectionsRef.current,
    });
    if (regionSelectionSnapshot.missingRegionIds.length > 0) {
      setChatMessages((previous) => [...previous, {
        id: `msg-${Date.now()}-invalid-region`,
        role: 'assistant',
        content: '定位对象数据已失效，请重新定位。',
        taskStatus: 'failed',
      }]);
      return;
    }
    const currentSkill = options?.skill ?? retrySourceMessage?.skill ?? activeSkill;
    const selectedChatProviderId = resolvedChatSelection.providerId || chatProviderId || undefined;
    const selectedChatModelId = resolvedChatSelection.model || chatModelId || undefined;
    const selectedImageProviderId = resolvedImageSelection.providerId || imageProviderId || undefined;
    const selectedImageModelId = resolvedImageSelection.model || imageModelId || undefined;
    const currentViewport = { ...viewport };
    const currentImageCount = imageCount;
    const generationSessionId = currentSessionIdRef.current;
    const currentTopicId = getCurrentSession()?.activeTopicId || 'default';
    const topicGeneratedImages = (generationSessionId
      ? generatedImageHistoryBySession[generationSessionId] || []
      : []).filter((entry) => !entry.topicId || entry.topicId === currentTopicId);
    const contextEntities = buildAgentContextEntities({
      messages: chatMessages,
      canvasItems: items,
      selectedItemIds: selectedIds,
      generatedImages: topicGeneratedImages,
    }) as AgentContextEntity[];
    const uploadedLogoRefs = extractUploadedLogoReferences();
    const existingBrandLogoUrl = [...chatMessages]
      .reverse()
      .find((msg) => msg.imageUrl && msg.imageName === 'brand-logo')
      ?.imageUrl;
    const mergedBrandLogoReferences = Array.from(
      new Set([
        ...currentReferenceImages,
        ...uploadedLogoRefs,
        ...(existingBrandLogoUrl ? [existingBrandLogoUrl] : []),
      ])
    );
    
    if (isGenerating || activeSkillJobId) {
      const errorMessage: ChatMessage = {
        id: `msg-${Date.now()}-error`,
        role: 'assistant',
        content: '当前有任务正在执行，可点击发送按钮终止任务',
      };
      setChatMessages(prev => [...prev, errorMessage]);
      return;
    }
    
    const confirmPatterns = ['确认出图', '开始出图', '生成全部'];
    const normalizedInput = currentChatInput.trim().toLowerCase();
    const brandMaterialRequests = currentSkill?.id === 'brand' ? extractMaterialRequests(currentChatInput) : [];
    const isLogoConfirm =
      currentSkill?.id === 'logo' &&
      !options?.agentConfirmation &&
      !effectiveAgentClarification &&
      confirmPatterns.some((pattern) => normalizedInput.includes(pattern.toLowerCase()));
    const isBrandGenerate =
      currentSkill?.id === 'brand' &&
      !options?.agentConfirmation &&
      !effectiveAgentClarification &&
      (
        confirmPatterns.some((pattern) => normalizedInput.includes(pattern.toLowerCase())) ||
        brandMaterialRequests.length > 0
      );
    
    if (isLogoConfirm) {
      let brandName = 'MyBrand';
      let industry = '咖啡';
      
      const brandMatch = currentChatInput.match(/(?:品牌名称?|品牌|名称)[:：]?\s*(\S+)/i);
      if (brandMatch) brandName = brandMatch[1];
      
      const industryMatch = currentChatInput.match(/(?:行业|类型)[:：]?\s*(\S+)/i);
      if (industryMatch) industry = industryMatch[1];
      
      const brandNameInHistory = chatMessages.find(m => 
        m.role === 'assistant' && m.content && /品牌名称/i.test(m.content)
      );
      if (brandNameInHistory?.content) {
        const extractedBrand = brandNameInHistory.content.match(/品牌名称[：:]\s*(\S+)/);
        if (extractedBrand) brandName = extractedBrand[1];
      }
      
      const userMessageId = `msg-${Date.now()}`;
      const assistantPlaceholderId = `msg-${Date.now()}-assistant-pending`;
      pendingAssistantMessageIdRef.current = assistantPlaceholderId;
      setChatMessages(prev => [...prev, {
        id: userMessageId,
        role: 'user',
        content: currentChatInput,
        referenceContext: currentReferenceContext,
        skill: currentSkill,
      }, {
        id: assistantPlaceholderId,
        role: 'assistant',
        content: '...',
        taskStatus: 'running',
      }]);
      setChatInput('');
      setIsGenerating(true);
      setHasStartedChat(true);
      clearSentChatReferenceTokens();
      
      try {
        const response = await fetch('/api/skills/jobs', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            skillType: 'logo',
            payload: {
              brandName,
              industry,
              providerId: selectedImageProviderId,
              model: selectedImageModelId,
            },
          }),
        });
        
        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(errorData.error || 'Failed to create logo job');
        }
        
        const data = await response.json();
        processedSkillJobUrlsRef.current = new Set();
        setActiveSkillJobId(data.jobId);
        setActiveSkillJobType('logo');
        setActiveSkillJobStatus({
          completed: 0,
          failed: 0,
          total: data.total,
          items: data.items,
        });

        const placeholders: ChatMessage[] = (data.items || []).map((item: { key?: string; component?: string; name: string }) => {
          const itemKey = item.key || item.component || `item-${Math.random().toString(36).slice(2, 6)}`;
          const messageId = `msg-${Date.now()}-logo-${itemKey}-${Math.random().toString(36).slice(2, 6)}`;
          return {
            id: messageId,
            role: 'assistant',
            content: `${item.name} 生成中...`,
            imageName: item.name,
            model: selectedImageModelId,
            taskKey: `logo:${itemKey}`,
            taskStatus: 'running',
          };
        });
        
        updatePendingAssistantMessage((msg) => ({
          ...msg,
          content: `🎨 已提交 ${data.total} 个 VI 素材到供应商（${industry} - ${brandName}），正在并发生成...`,
          taskStatus: 'running',
        }));
        setChatMessages(prev => [...prev, ...placeholders]);
      } catch (error) {
        updatePendingAssistantMessage((msg) => ({
          ...msg,
          content: `创建任务失败: ${error instanceof Error ? error.message : '未知错误'}`,
          taskStatus: 'failed',
        }));
        setIsGenerating(false);
        pendingAssistantMessageIdRef.current = null;
      }
      return;
    }

    if (isBrandGenerate) {
      const { brandName, industry } = resolveBrandIdentity(currentChatInput);
      const { brandBrief, viGuide } = extractStructuredBrandContext();

      const logoHint =
        mergedBrandLogoReferences.length > 0
          ? 'Follow the provided logo silhouette, line rhythm, and contrast hierarchy.'
          : 'No explicit logo uploaded. Keep a strong central logo-like motif consistent with the brand tone.';

      if (mergedBrandLogoReferences.length === 0) {
        const missingLogoMessage: ChatMessage = {
          id: `msg-${Date.now()}-brand-logo-required`,
          role: 'assistant',
          content: '请先上传一个 logo 参考图，再生成品牌物料。',
        };
        setChatMessages(prev => [...prev, missingLogoMessage]);
        return;
      }

      const userMessageId = `msg-${Date.now()}`;
      const assistantPlaceholderId = `msg-${Date.now()}-assistant-pending`;
      pendingAssistantMessageIdRef.current = assistantPlaceholderId;
      setChatMessages(prev => [...prev, {
        id: userMessageId,
        role: 'user',
        content: currentChatInput,
        referenceContext: currentReferenceContext,
        skill: currentSkill,
      }, {
        id: assistantPlaceholderId,
        role: 'assistant',
        content: '...',
        taskStatus: 'running',
      }]);
      setChatInput('');
      setIsGenerating(true);
      setHasStartedChat(true);
      clearSentChatReferenceTokens();

      try {
        const response = await fetch('/api/skills/jobs', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            skillType: 'brand',
            payload: {
              brandName,
              industry,
              userRequirement: currentChatInput,
              materialRequests: brandMaterialRequests,
              logoReferenceImages: mergedBrandLogoReferences,
              brandBrief,
              viGuide,
              logoReferenceHint: logoHint,
              providerId: selectedImageProviderId,
              model: selectedImageModelId,
            },
          }),
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(errorData.error || 'Failed to create brand job');
        }

        const data = await response.json();
        processedSkillJobUrlsRef.current = new Set();
        setActiveSkillJobId(data.jobId);
        setActiveSkillJobType('brand');
        setActiveSkillJobStatus({
          completed: 0,
          failed: 0,
          total: data.total,
          items: data.items,
        });

        const placeholders: ChatMessage[] = (data.items || []).map((item: { key?: string; component?: string; name: string }) => {
          const itemKey = item.key || item.component || `item-${Math.random().toString(36).slice(2, 6)}`;
          return {
            id: `msg-${Date.now()}-brand-${itemKey}-${Math.random().toString(36).slice(2, 6)}`,
            role: 'assistant',
            content: `${item.name} 生成中...`,
            imageName: item.name,
            model: selectedImageModelId,
            taskKey: `brand:${itemKey}`,
            taskStatus: 'running',
          };
        });

        const isSpecificMaterial = brandMaterialRequests.length > 0;
        updatePendingAssistantMessage((msg) => ({
          ...msg,
          content: isSpecificMaterial
            ? `🎯 已提交 ${data.total} 个指定品牌物料任务（${industry} - ${brandName}），正在异步生成...`
            : `🧩 已提交品牌九宫格物料任务（${industry} - ${brandName}），正在异步生成...`,
          taskStatus: 'running',
        }));
        setChatMessages(prev => [...prev, ...placeholders]);
      } catch (error) {
        updatePendingAssistantMessage((msg) => ({
          ...msg,
          content: `创建任务失败: ${error instanceof Error ? error.message : '未知错误'}`,
          taskStatus: 'failed',
        }));
        setIsGenerating(false);
        pendingAssistantMessageIdRef.current = null;
      }
      return;
    }
    
    const userMessage: ChatMessage = {
      id: `msg-${Date.now()}`,
      role: 'user',
      content: currentChatInput,
      referenceContext: currentReferenceContext,
      skill: currentSkill || undefined,
      agentClarificationResponsePayload: effectiveAgentClarification && effectiveAgentClarificationResponse
        ? {
            clarification: effectiveAgentClarification,
            response: effectiveAgentClarificationResponse,
          }
        : undefined,
    };
    const assistantPlaceholderId = `msg-${Date.now()}-assistant-pending`;
    const agentRunId = `agent-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    if (generationMode === 'agent') {
      setActiveAgentRunMarker({
        runId: agentRunId,
        userMessageId: userMessage.id,
        assistantMessageId: assistantPlaceholderId,
        startedAt: Date.now(),
        status: 'running',
      });
    }
    
    const messagesForAPI = chatMessages
      .filter(msg => msg.role === 'user' || msg.role === 'assistant')
      .flatMap(msg => {
        const content = (msg.content || '')
          .replace(GENERATED_IMAGE_HISTORY_PLACEHOLDER_PATTERN, '')
          .trim();
        if (msg.imageUrl && !content) return [];
        return [{
          role: msg.role === 'user' ? 'user' as const : 'assistant' as const,
          content,
        }];
      });
    messagesForAPI.push({ role: 'user', content: currentChatInput });
    
    pendingAssistantMessageIdRef.current = assistantPlaceholderId;
    setChatMessages(prev => [...prev, ...(options?.suppressUserMessage ? [] : [userMessage]), {
      id: assistantPlaceholderId,
      role: 'assistant',
      content: generationMode === 'agent' ? '' : '...',
      taskStatus: 'running',
      agentRunProgress: generationMode === 'agent'
        ? createInitialAgentRunProgress(agentRunId)
        : undefined,
    }]);
    if (!options?.suppressUserMessage) setChatInput('');
    setIsGenerating(true);
    setHasStartedChat(true);
    const processedAgentActionKeysForRun = new Set<string>();
    let runController: AbortController | null = null;

    try {
      const isBrandBootstrapPrompt =
        currentSkill?.id === 'brand' &&
        currentChatInput.includes('请按品牌识别系统流程开始信息收集');

      if (
        currentSkill?.id === 'brand' &&
        !isBrandBootstrapPrompt &&
        mergedBrandLogoReferences.length === 0
      ) {
        const brandMatch = currentChatInput.match(/(?:品牌名称?|品牌|名称)[:：]?\s*(\S+)/i);
        const industryMatch = currentChatInput.match(/(?:行业|类型)[:：]?\s*(\S+)/i);
        const brandName = brandMatch?.[1] || 'MyBrand';
        const industry = industryMatch?.[1] || '消费品';

        const logoPrompt = `${brandName} ${industry} 品牌logo设计，简洁现代，高识别度，矢量风格，白底，适合数字媒体与印刷`; 
        const bootstrapMessageId = `msg-${Date.now()}-brand-logo-bootstrap`;

        setChatMessages(prev => [...prev, {
          id: bootstrapMessageId,
          role: 'assistant',
          content: '品牌识别系统：未检测到 logo，正在为你生成基础 logo... ',
          taskStatus: 'running',
          model: selectedImageModelId,
        }]);

        try {
          const logoResponse = await fetch('/api/generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              messages: [{ role: 'user', content: logoPrompt }],
              size: '1024x1024',
              intent: 'image',
              imageProviderId: selectedImageProviderId,
              model: selectedImageModelId,
            }),
          });

          if (!logoResponse.ok) {
            const errorText = await logoResponse.text();
            throw new Error(errorText || `API Error: ${logoResponse.status}`);
          }

          const logoResult = await logoResponse.json();
          const logoData = logoResult?.result;
          const logoUrl = logoData?.localUrl || logoData?.data?.[0]?.url;
          if (!logoUrl) {
            throw new Error('未返回可用 logo 图片');
          }
          const brandLogoMessageId = `msg-${Date.now()}-brand-logo`;

          setImageCount((prev) => prev + 1);

          setChatMessages(prev => prev.flatMap((msg) => {
            if (msg.id !== bootstrapMessageId) return [msg];
            return [
              {
                ...msg,
                taskStatus: 'completed',
                content: `已生成基础 logo（${industry} - ${brandName}）`,
              },
              {
                id: brandLogoMessageId,
                role: 'assistant',
                content: '',
                imageUrl: logoUrl,
                model: selectedImageModelId,
                imageName: 'brand-logo',
              },
            ];
          }));

          const img = new window.Image();
          img.crossOrigin = 'anonymous';
          img.onload = () => {
            const spawnPosition = getSpawnPosition(
              {
                width: getConstrainedImageDisplaySize(img.width, img.height).width,
                height: getConstrainedImageDisplaySize(img.width, img.height).height,
              },
              0,
              currentViewport
            );
            const newItem = createImageCanvasItem({
              id: `generated-${Date.now()}-brand-logo`,
              src: logoUrl,
              naturalWidth: img.width,
              naturalHeight: img.height,
              x: spawnPosition.x,
              y: spawnPosition.y,
            });
            appendGeneratedImageHistoryForSession(
              generationSessionId,
              [
                createGeneratedImageHistoryEntry({
                  src: logoUrl,
                  naturalWidth: img.width,
                  naturalHeight: img.height,
                  source: 'chat',
                  messageId: brandLogoMessageId,
                }),
              ]
            );
            recordCurrentCanvasUndoSnapshot();
            setItems(prev => [...prev, newItem]);
          };
          img.src = logoUrl;
        } catch (bootstrapError) {
          setChatMessages(prev => prev.map((msg) => {
            if (msg.id !== bootstrapMessageId) return msg;
            return {
              ...msg,
              taskStatus: 'failed',
              content: `基础 logo 生成失败: ${bootstrapError instanceof Error ? bootstrapError.message : '未知错误'}`,
            };
          }));
        }
      }

      const requestBody: Record<string, unknown> = {
        messages: messagesForAPI,
        intent: generationMode,
      };
      if (generationMode === 'image' && imageAspectRatio !== 'auto') {
        requestBody.aspect_ratio = imageAspectRatio;
      }

      if (currentSkill?.id === 'brand') {
        requestBody.intent = 'chat';
      }
      const directRequestUsesImageModel = requestBody.intent === 'image';
      requestBody.model = typeof options?.modelOverride === 'string' && options.modelOverride.trim()
        ? options.modelOverride.trim()
        : directRequestUsesImageModel
          ? selectedImageModelId
          : selectedChatModelId;
      if (directRequestUsesImageModel) {
        requestBody.imageProviderId = selectedImageProviderId;
      } else {
        requestBody.chatProviderId = selectedChatProviderId;
      }
      const clarificationReferenceImages = effectiveAgentClarification?.state.referenceImages || [];
      const baseReferencesForRequest = currentSkill?.id === 'brand'
        ? mergedBrandLogoReferences
        : clarificationReferenceImages.length > 0
          ? clarificationReferenceImages
          : overrideReferencePayload
            ? overrideReferencePayload.referenceImages
            : currentReferenceImages;
      const baseReferenceLabelsForRequest = currentSkill?.id === 'brand'
        ? mergedBrandLogoReferences.map((_, index) => `image${index + 1}`)
        : clarificationReferenceImages.length > 0
          ? clarificationReferenceImages.map((_, index) => `image${index + 1}`)
          : overrideReferencePayload
            ? overrideReferencePayload.referenceLabels
            : currentReferenceImages.map((_, index) => `image${index + 1}`);
      const annotationContextForRequest: CanvasAnnotationContext = {
        ...selectedCanvasAnnotationContext,
        annotations: selectedCanvasAnnotationContext.annotations.map((annotation) => ({ ...annotation })),
        annotationItemIds: [...selectedCanvasAnnotationContext.annotationItemIds],
      };
      if (
        generationMode === 'agent' &&
        annotationContextForRequest.targetImage &&
        annotationContextForRequest.annotationCount > 0 &&
        !annotationContextForRequest.ambiguousImageTarget
      ) {
        const compositeResult = await uploadAnnotationCompositePreview({
          context: annotationContextForRequest,
          items,
        });
        if (compositeResult.url) {
          annotationContextForRequest.compositePreviewUrl = compositeResult.url;
        }
        if (compositeResult.error) {
          annotationContextForRequest.compositePreviewError = compositeResult.error;
        }
      }
      const referencesForRequest = [...baseReferencesForRequest];
      const referenceLabelsForRequest = [...baseReferenceLabelsForRequest];
      if (
        annotationContextForRequest.compositePreviewUrl &&
        !referencesForRequest.includes(annotationContextForRequest.compositePreviewUrl)
      ) {
        referencesForRequest.push(annotationContextForRequest.compositePreviewUrl);
        referenceLabelsForRequest.push('annotation-preview');
      }
      const referenceContextForRequest: AgentReferenceContext | undefined = currentReferenceContext
        ? {
            references: currentReferenceContext.references.map((reference) => ({ ...reference })),
            composerSegments: currentReferenceContext.composerSegments.map((segment) => ({ ...segment })),
            ...(currentReferenceContext.evidenceImages?.length
              ? { evidenceImages: currentReferenceContext.evidenceImages.map((evidence) => ({ ...evidence })) }
              : {}),
          }
        : undefined;
      if (annotationContextForRequest.compositePreviewUrl && referenceContextForRequest) {
        const targetCanvasItemId = annotationContextForRequest.targetImage?.id;
        const parentReference = referenceContextForRequest.references.find((reference) => (
          reference.role === 'annotation_bundle'
          || Boolean(targetCanvasItemId && reference.canvasItemId === targetCanvasItemId)
        ));
        if (parentReference) {
          const evidenceImages = referenceContextForRequest.evidenceImages || [];
          if (!evidenceImages.some((evidence) => evidence.src === annotationContextForRequest.compositePreviewUrl)) {
            evidenceImages.push({
              id: `${parentReference.id}:annotation-composite`,
              referenceId: parentReference.id,
              src: annotationContextForRequest.compositePreviewUrl,
              kind: 'annotation_composite',
            });
          }
          referenceContextForRequest.evidenceImages = evidenceImages;
        }
      }
      if (referenceContextForRequest !== currentReferenceContext) {
        setChatMessages((previous) => previous.map((message) => (
          message.id === userMessage.id
            ? { ...message, referenceContext: referenceContextForRequest }
            : message
        )));
      }
      const shouldRequestStream = generationMode !== 'image' && referencesForRequest.length === 0;
      if (shouldRequestStream) {
        requestBody.stream = true;
      }

      if (referencesForRequest.length > 0) {
        requestBody.reference_images = referencesForRequest;
        requestBody.reference_labels = referenceLabelsForRequest;
      }
      
      if (currentSkill) {
        requestBody.skill = currentSkill.id;
      }
      
      const controller = new AbortController();
      runController = controller;
      generateAbortRef.current = controller;

      const requestSession = getCurrentSession();
      const requestTopicId = requestSession?.activeTopicId || 'default';
      const agentRequestBody = {
        runId: agentRunId,
        topicId: requestTopicId,
        messages: messagesForAPI,
        contextEntities,
        selectedContextEntityIds: options?.selectedContextEntityIds ?? selectedIds.map((id) => `canvas:${id}`),
        activeSkillId: currentSkill?.id,
        referenceImages: referencesForRequest,
        referenceContext: referenceContextForRequest,
        canvasContext: {
          itemCount: items.length,
          selectedItemIds: selectedIds,
          selectedItems: items
            .filter((item) => selectedIds.includes(item.id))
            .map((item) => ({
              id: item.id,
              type: item.type,
              textVariant: item.textVariant,
              text: item.text,
              src: item.src,
              x: item.x,
              y: item.y,
              width: item.width,
              height: item.height,
            })),
          annotationContext: annotationContextForRequest,
          regionSelections: regionSelectionSnapshot.regionSelections,
        },
        chatOptions: {
          providerId: selectedChatProviderId,
          model: selectedChatModelId,
        },
        imageOptions: {
          providerId: selectedImageProviderId,
          model: selectedImageModelId,
          aspectRatio: agentImageAspectRatio,
          size: '2048x2048',
          quality: 'auto',
          count: 1,
        },
        confirmation: options?.agentConfirmation,
        clarificationState: effectiveAgentClarification?.state,
        clarificationRequest: effectiveAgentClarification?.request,
        clarificationResponse: effectiveAgentClarificationResponse,
      };
      const hasRegionTarget = (currentReferenceContext?.references || []).some((reference) => reference.role === 'region_target');
      const requestEndpoint = generationMode === 'agent' ? '/api/agent' : '/api/generate';
      const resolvedRequestEndpoint = hasRegionTarget ? '/api/agent' : requestEndpoint;
      if (!options?.suppressUserMessage) clearSentChatReferenceTokens();

      const response = await fetch(resolvedRequestEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(generationMode === 'agent' || hasRegionTarget ? agentRequestBody : requestBody),
        signal: controller.signal,
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        let errorMessage = `API Error: ${response.status} ${response.statusText}`;
        try {
          const errorData = JSON.parse(errorText) as { error?: string };
          if (errorData.error) {
            errorMessage = errorData.error;
          }
        } catch {
          if (errorText) {
            errorMessage = errorText;
          }
        }
        throw new Error(errorMessage);
      }

      const contentType = response.headers.get('content-type') || '';
      if (contentType.includes('application/x-ndjson') && response.body) {
        const assistantId = pendingAssistantMessageIdRef.current || `msg-${Date.now()}-assistant-stream`;
        stopStreamTypewriter();
        streamMessageIdRef.current = assistantId;
        updatePendingAssistantMessage((msg) => ({
          ...msg,
          content: '',
          taskStatus: 'running',
        }));

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        let doneReceived = false;
        let generatedAssetFailureCount = 0;
        let generatedAssetPreloadFailureCount = 0;
        let generatedAssetSucceededCount = 0;
        let generatedAssetExpectedCount = 0;
        let streamedAssetOrdinal = 0;
        let generatedAssetModel = '';
        let nextGeneratedImageNumber = currentImageCount + 1;
        let progressEventRouter = createAgentProgressEventRouter();
        let suppressAssistantContentForDecision = false;
        let generatedAssetPreloadChain = Promise.resolve();

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;

            let event: {
              type?: string;
              content?: string;
              delta?: string;
              channel?: 'content' | 'reasoning';
              model?: string;
              error?: string;
              message?: string;
              stage?: string;
              reason?: 'transport' | 'invalid_reference' | 'invalid_context' | 'invalid_plan' | 'vision_unsupported' | 'vision_unavailable' | 'missing_original_asset';
              retryable?: boolean;
              runId?: string;
              title?: string;
              operation?: 'generate' | 'edit';
              succeeded?: number;
              failed?: number;
              addedToCanvas?: boolean;
              intent?: 'chat' | 'image' | 'skill_action';
              summary?: string;
              label?: string;
              skillId?: string;
              source?: 'manual' | 'auto';
              operationId?: string;
              sequence?: number;
              stepId?: string;
              phase?: string;
              status?: 'active' | 'waiting' | 'completed' | 'failed';
              toolCallId?: string;
              toolName?: string;
              action?: {
                type?: string;
                runId?: string;
                model?: string;
                providerId?: string;
                sourceReferenceId?: string;
                sourceTaskId?: string;
                sourceVersionId?: string;
                taskId?: string;
                contractVersion?: number;
                batchId?: string;
                presentation?: { title?: string; summary?: string; operation?: 'generate' | 'edit' };
                assets?: Array<{
                  src?: string;
                  plannerPreviewSrc?: string;
                  naturalWidth?: number;
                  naturalHeight?: number;
                  model?: string;
                  itemId?: string;
                  index?: number;
                  label?: string;
                  slotId?: string;
                  versionId?: string;
                  parentVersionId?: string;
                  promptTrace?: ChatMessage['promptTrace'];
                }>;
                batch?: { total?: number; settled?: number; succeeded?: number; failed?: number };
              };
              request?: {
                confirmationId?: string;
                toolName?: string;
                message?: string;
                id?: string;
                taskId?: string;
                question?: string;
                dimension?: string;
                options?: AgentClarificationOption[];
                allowCustom?: true;
                allowProceed?: true;
                failed?: boolean;
              };
              state?: AgentClarificationState;
              result?: Record<string, unknown>;
              proposal?: AgentProposal;
              entityIds?: string[];
              labels?: string[];
              kind?: string;
              confidence?: 'high' | 'medium';
              resolvedEntityIds?: string[];
              mustPreserveCount?: number;
              taskSnapshot?: TaskSnapshot;
            };
            try {
              event = JSON.parse(trimmed) as {
                type?: string;
                content?: string;
                channel?: 'content' | 'reasoning';
                model?: string;
                error?: string;
                delta?: string;
                message?: string;
                stage?: string;
                reason?: 'transport' | 'invalid_reference' | 'invalid_context' | 'invalid_plan' | 'vision_unsupported' | 'vision_unavailable' | 'missing_original_asset';
                retryable?: boolean;
                intent?: 'chat' | 'image' | 'skill_action';
                summary?: string;
                label?: string;
                skillId?: string;
                source?: 'manual' | 'auto';
                runId?: string;
                operationId?: string;
                sequence?: number;
                timestampMs?: number;
                stepId?: string;
                phase?: string;
                status?: 'active' | 'waiting' | 'completed' | 'failed';
                toolCallId?: string;
                toolName?: string;
                action?: {
                  type?: string;
                  runId?: string;
                  model?: string;
                  providerId?: string;
                  sourceReferenceId?: string;
                  sourceTaskId?: string;
                  sourceVersionId?: string;
                  taskId?: string;
                  contractVersion?: number;
                  batchId?: string;
                  presentation?: { title?: string; summary?: string; operation?: 'generate' | 'edit' };
                  assets?: Array<{ src?: string; plannerPreviewSrc?: string; naturalWidth?: number; naturalHeight?: number; model?: string; itemId?: string; index?: number; label?: string; slotId?: string; versionId?: string; parentVersionId?: string; promptTrace?: ChatMessage['promptTrace'] }>;
                  batch?: { total?: number; settled?: number; succeeded?: number; failed?: number };
                };
                request?: {
                  confirmationId?: string;
                  toolName?: string;
                  message?: string;
                  id?: string;
                  taskId?: string;
                  question?: string;
                  dimension?: string;
                  options?: AgentClarificationOption[];
                  allowCustom?: true;
                  allowProceed?: true;
                  failed?: boolean;
                };
                state?: AgentClarificationState;
                result?: Record<string, unknown>;
                proposal?: AgentProposal;
                entityIds?: string[];
                labels?: string[];
                kind?: string;
                confidence?: 'high' | 'medium';
                resolvedEntityIds?: string[];
                mustPreserveCount?: number;
                taskSnapshot?: TaskSnapshot;
              };
            } catch {
              continue;
            }

            if (event.type === 'start' && event.model) {
              updateChatMessageById(assistantId, (msg) => ({
                ...msg,
                model: msg.model || event.model,
              }));
              continue;
            }

            if (event.type === 'proposal_presented' && event.proposal) {
              suppressAssistantContentForDecision = event.proposal.requiresSelection === true;
              updatePendingAssistantMessage((msg) => ({
                ...msg,
                ...(suppressAssistantContentForDecision ? { content: '' } : {}),
                agentProposal: event.proposal,
                agentProposalDismissed: false,
                agentProposalResolved: false,
              }));
              if (event.proposal.requiresSelection) {
                setPendingAgentProposal(event.proposal);
                setShowAgentProposalModal(true);
              }
              continue;
            }

            if (event.type === 'context_resolved' && event.entityIds?.length && event.labels?.length) {
              updatePendingAssistantMessage((msg) => ({
                ...msg,
                resolvedContext: {
                  entityIds: event.entityIds || [],
                  labels: event.labels || [],
                  kind: event.kind || 'context',
                  confidence: event.confidence || 'high',
                },
              }));
              continue;
            }

            if (event.type === 'brief_compiled' && event.summary) {
              updatePendingAssistantMessage((msg) => ({ ...msg, executionBriefSummary: event.summary }));
              continue;
            }

            if (event.type === 'progress_update') {
              const routed = routeAgentProgressEvent(progressEventRouter, event);
              progressEventRouter = routed.router;
              if (routed.events.length > 0) {
                updatePendingAssistantMessage((msg) => applyAgentRunProgressEvents(
                  msg,
                  routed.events as AgentRunProgressEvent[],
                ));
              }
              continue;
            }

            if (event.type === 'intent_resolved') {
              const intent = event.intent || 'chat';
              const routed = routeAgentProgressEvent(progressEventRouter, {
                type: 'intent_resolved',
                intent,
              });
              progressEventRouter = routed.router;
              updatePendingAssistantMessage((msg) => applyAgentRunProgressEvents(msg, [
                { type: 'intent_resolved', intent },
                ...(routed.events as AgentRunProgressEvent[]),
              ]));
              if (effectiveAgentClarification) {
                resolveAgentClarificationMessage(effectiveAgentClarification.request.id);
              }
              continue;
            }

            if (event.type === 'routing_start') {
              continue;
            }

            if (event.type === 'clarification_required') {
              suppressAssistantContentForDecision = true;
              const requestPayload = event.request;
              if (
                requestPayload?.id
                && requestPayload.taskId
                && requestPayload.question
                && requestPayload.dimension
                && event.state
              ) {
                const clarificationPayload: AgentClarificationPayload = {
                  request: {
                    id: requestPayload.id,
                    taskId: requestPayload.taskId,
                    question: requestPayload.question,
                    dimension: requestPayload.dimension,
                    options: Array.isArray(requestPayload.options) ? requestPayload.options : [],
                    allowCustom: true,
                    allowProceed: true,
                    failed: requestPayload.failed,
                  },
                  state: event.state,
                };
                updatePendingAssistantMessage((msg) => ({
                  ...msg,
                  content: '',
                  taskStatus: undefined,
                  agentClarification: clarificationPayload,
                  agentClarificationDismissed: false,
                  agentClarificationResolved: false,
                }));
                setPendingAgentClarification(clarificationPayload);
                setAgentClarificationCustomText('');
                setShowAgentClarificationModal(true);
              }
              continue;
            }

            if (event.type === 'skill_selected' && event.label && !currentSkill) {
              updatePendingAssistantMessage((msg) => ({
                ...msg,
                skill: { id: event.skillId || 'auto', label: event.label || 'Skill' },
              }));
              continue;
            }

            if (
              event.type === 'prompt_optimization_start'
              || event.type === 'prompt_optimization_done'
              || event.type === 'tool_update'
            ) {
              continue;
            }

            if (event.type === 'confirmation_required') {
              suppressAssistantContentForDecision = true;
              const confirmation = event.request?.confirmationId && event.request?.toolName
                ? {
                    confirmationId: event.request.confirmationId,
                    toolName: event.request.toolName,
                    message: event.request.message || '此操作需要你的确认。',
                  }
                : undefined;
              updatePendingAssistantMessage((msg) => ({
                ...msg,
                content: '',
                taskStatus: undefined,
                agentConfirmation: confirmation,
                agentConfirmationDismissed: false,
                agentConfirmationResolved: false,
              }));
              if (confirmation) {
                setPendingAgentConfirmation(confirmation);
                setShowAgentConfirmationModal(true);
              }
              continue;
            }

            if (event.type === 'tool_result' && typeof event.result?.jobId === 'string') {
              const skillType = event.result.skillType === 'brand' ? 'brand' : 'logo';
              const total = typeof event.result.total === 'number' ? event.result.total : 0;
              const completed = typeof event.result.completed === 'number' ? event.result.completed : 0;
              const failed = typeof event.result.failed === 'number' ? event.result.failed : 0;
              const items = Array.isArray(event.result.items)
                ? event.result.items.map((item) => {
                    const row = item && typeof item === 'object' ? item as Record<string, unknown> : {};
                    return {
                      component: String(row.key || row.component || ''),
                      name: String(row.name || ''),
                      status: String(row.status || 'queued'),
                    };
                  })
                : [];
              setActiveSkillJobId(event.result.jobId);
              setActiveSkillJobType(skillType);
              setActiveSkillJobStatus({ completed, failed, total, items });
              activeSkillJobMessageIdRef.current = assistantId;
              updateChatMessageById(assistantId, (msg) => applyAgentRunProgressEvents({
                ...msg,
                content: `已启动 ${total} 个${skillType === 'brand' ? '品牌物料' : '视觉素材'}任务。`,
                taskStatus: 'running',
                agentConfirmation: undefined,
              }, [
                { type: 'assets_pending', count: total },
                { type: 'assets_progress', total, succeeded: completed, failed },
              ]));
              continue;
            }

            if (event.type === 'tool_result' && event.result?.kind === 'image_generation') {
              const requestStats = event.result.requestStats && typeof event.result.requestStats === 'object'
                ? event.result.requestStats as Record<string, unknown>
                : {};
              generatedAssetFailureCount = typeof requestStats.failed === 'number'
                ? Math.max(0, requestStats.failed)
                : 0;
              const requestedAssetCount = typeof requestStats.requested === 'number'
                ? Math.max(0, requestStats.requested)
                : 0;
              if (requestedAssetCount > generatedAssetExpectedCount) {
                generatedAssetExpectedCount = requestedAssetCount;
                updateChatMessageById(assistantId, (msg) => updateAgentRunProgress(msg, {
                  type: 'assets_pending',
                  count: generatedAssetExpectedCount,
                }));
              }
              updateChatMessageById(assistantId, (msg) => updateAgentRunProgress(msg, {
                type: 'assets_settled',
                succeeded: generatedAssetSucceededCount,
                failed: generatedAssetFailureCount + generatedAssetPreloadFailureCount,
              }));
              const resolvedImageOptions = event.result.resolvedImageOptions && typeof event.result.resolvedImageOptions === 'object'
                ? event.result.resolvedImageOptions as Record<string, unknown>
                : {};
              generatedAssetModel = typeof event.result.model === 'string'
                ? event.result.model
                : typeof resolvedImageOptions.model === 'string'
                  ? resolvedImageOptions.model
                  : generatedAssetModel;
              continue;
            }

            if (event.type === 'assistant_delta' && event.delta) {
              if (event.channel === 'reasoning') {
                continue;
              } else {
                if (suppressAssistantContentForDecision) continue;
                if (event.model) {
                  updatePendingAssistantMessage((msg) => ({
                    ...msg,
                    model: msg.model || event.model,
                  }));
                }
                enqueueStreamDelta(assistantId, event.delta);
              }
              continue;
            }

            if (event.type === 'client_action' && event.action?.type === 'add_generated_assets') {
              const actionRunId = event.action.runId || agentRunId;
              const assets = (event.action.assets || []).filter(
                (asset): asset is {
                  src: string;
                  naturalWidth?: number;
                  naturalHeight?: number;
                  model?: string;
                  itemId?: string;
                  index?: number;
                  label?: string;
                  plannerPreviewSrc?: string;
                  slotId?: string;
                  versionId?: string;
                  parentVersionId?: string;
                  promptTrace?: ChatMessage['promptTrace'];
                } => Boolean(asset.src)
              );
              const getAssetActionKey = (asset: typeof assets[number]) => {
                const itemKey = asset.itemId || (typeof asset.index === 'number' ? `index-${asset.index}` : asset.src);
                return `${actionRunId}:${itemKey}:${asset.src}`;
              };
              const batchTotal = typeof event.action.batch?.total === 'number'
                ? Math.max(0, event.action.batch.total)
                : 0;
              if (batchTotal > generatedAssetExpectedCount) {
                generatedAssetExpectedCount = batchTotal;
                updateChatMessageById(assistantId, (msg) => updateAgentRunProgress(msg, {
                  type: 'assets_pending',
                  count: generatedAssetExpectedCount,
                }));
              }
              if (typeof event.action.batch?.failed === 'number') {
                generatedAssetFailureCount = Math.max(generatedAssetFailureCount, event.action.batch.failed);
              }
              const freshAssets = assets.filter((asset) => {
                const key = getAssetActionKey(asset);
                if (processedAgentActionsRef.current.has(key)) return false;
                processedAgentActionsRef.current.add(key);
                processedAgentActionKeysForRun.add(key);
                return true;
              });
              if (freshAssets.length > 0) {
                if (generatedAssetExpectedCount === 0) {
                  generatedAssetExpectedCount = freshAssets.length + generatedAssetFailureCount;
                  updateChatMessageById(assistantId, (msg) => updateAgentRunProgress(msg, {
                    type: 'assets_pending',
                    count: generatedAssetExpectedCount,
                  }));
                }
                generatedAssetPreloadChain = generatedAssetPreloadChain.then(async () => {
                  const preloadStartedAt = performance.now();
                  const preloadResults = await runGeneratedAssetPreloadQueue(
                    freshAssets,
                    (asset) => preloadGeneratedAsset(asset, {
                      timeoutMs: 15_000,
                      signal: controller.signal,
                    }),
                    {
                      concurrency: 2,
                      signal: controller.signal,
                    }
                  );
                  if (
                    currentSessionIdRef.current !== generationSessionId
                    || generateAbortRef.current !== controller
                    || controller.signal.aborted
                  ) {
                    for (const asset of freshAssets) {
                      const key = getAssetActionKey(asset);
                      processedAgentActionsRef.current.delete(key);
                      processedAgentActionKeysForRun.delete(key);
                    }
                    return;
                  }
                  const loadedAssets = preloadResults.flatMap((result) => (
                    result.status === 'fulfilled' ? [result.value] : []
                  ));
                  const failedAssets = preloadResults.flatMap((result, index) => (
                    result.status === 'rejected'
                      ? [{ asset: freshAssets[index], error: result.reason }]
                      : []
                  ));
                  failedAssets.forEach(({ asset }) => {
                    const key = getAssetActionKey(asset);
                    processedAgentActionsRef.current.delete(key);
                    processedAgentActionKeysForRun.delete(key);
                  });
                  const preloadFailureCount = failedAssets.length;
                  generatedAssetPreloadFailureCount += preloadFailureCount;
                  if (loadedAssets.length > 0) {
                  const firstImageNumber = nextGeneratedImageNumber;
                  nextGeneratedImageNumber += loadedAssets.length;
                  const firstStreamedOrdinal = streamedAssetOrdinal;
                  streamedAssetOrdinal += loadedAssets.length;
                  generatedAssetSucceededCount += loadedAssets.length;
                  const resolvedModel = event.action.model
                    || loadedAssets.find(({ asset }) => asset.model)?.asset.model
                    || generatedAssetModel
                    || selectedImageModelId;
                  const imageMessages: ChatMessage[] = loadedAssets.map(({ asset }, index) => ({
                    id: `${assistantId}-asset-${asset.itemId || asset.index || firstStreamedOrdinal + index}-${Date.now()}`,
                    role: 'assistant',
                    content: '',
                    imageUrl: asset.src,
                    imageName: asset.label || `image ${firstImageNumber + index}`,
                    model: asset.model || resolvedModel,
                    ...(event.action?.providerId ? { imageProviderId: event.action.providerId } : {}),
                    ...(event.action?.sourceReferenceId ? { sourceReferenceId: event.action.sourceReferenceId } : {}),
                    ...(asset.promptTrace ? { promptTrace: asset.promptTrace } : {}),
                    ...(index === 0 && event.action?.presentation?.title
                      ? { resultTitle: event.action.presentation.title }
                      : {}),
                    ...(index === 0 && event.action?.presentation?.operation
                      ? { imageOperation: event.action.presentation.operation }
                      : {}),
                  }));
                  const canvasItems = loadedAssets.map(({ asset, naturalWidth, naturalHeight }, index) => {
                    const displaySize = getConstrainedImageDisplaySize(naturalWidth, naturalHeight);
                    const spawnPosition = getSpawnPosition(
                      displaySize,
                      firstStreamedOrdinal + index,
                      currentViewport
                    );
                    return createImageCanvasItem({
                      id: `generated-${Date.now()}-${asset.itemId || asset.index || firstStreamedOrdinal + index}-${index}`,
                      src: asset.src,
                      naturalWidth,
                      naturalHeight,
                      x: spawnPosition.x,
                      y: spawnPosition.y,
                    });
                  });
                  appendGeneratedImageHistoryForSession(
                    generationSessionId,
                    loadedAssets.map(({ asset, naturalWidth, naturalHeight }, index) => createGeneratedImageHistoryEntry({
                      src: asset.src,
                      plannerPreviewSrc: asset.plannerPreviewSrc || asset.src,
                      naturalWidth,
                      naturalHeight,
                      source: 'chat',
                      topicId: requestTopicId,
                      messageId: imageMessages[index]?.id,
                      operation: event.action?.presentation?.operation,
                      sourceReferenceId: event.action?.sourceReferenceId,
                      sourceTaskId: event.action?.sourceTaskId,
                      sourceVersionId: event.action?.sourceVersionId,
                      providerId: event.action?.providerId,
                      model: asset.model || resolvedModel,
                      promptTrace: asset.promptTrace,
                      taskId: event.action?.taskId,
                      contractVersion: event.action?.contractVersion,
                      batchId: event.action?.batchId,
                      slotId: asset.slotId,
                      versionId: asset.versionId,
                      parentVersionId: asset.parentVersionId,
                    })),
                  );
                  flushQueuedChatMessageUpdates();
                  setChatMessages(prev => [...prev, ...imageMessages]);
                  recordCurrentCanvasUndoSnapshot();
                  setItems(prev => [...prev, ...canvasItems]);
                    setImageCount((prev) => prev + loadedAssets.length);
                  }
                  updateChatMessageById(assistantId, (msg) => updateAgentRunProgress(msg, {
                    type: 'assets_settled',
                    succeeded: generatedAssetSucceededCount,
                    failed: generatedAssetFailureCount + generatedAssetPreloadFailureCount,
                  }));
                  if (canvasPerformanceEnabledRef.current) {
                    console.info('[generated-asset-preload-perf]', {
                      count: freshAssets.length,
                      loaded: loadedAssets.length,
                      failed: failedAssets.length,
                      durationMs: performance.now() - preloadStartedAt,
                    });
                  }
                }).catch((error) => {
                  console.error('Generated asset preload queue failed:', error);
                });
              }
              continue;
            }

            if (event.type === 'agent_completion_summary') {
              const summaryRunId = event.runId || agentRunId;
              if (
                event.summary
                && event.succeeded
                && event.succeeded > 0
                && !processedAgentCompletionSummariesRef.current.has(summaryRunId)
              ) {
                processedAgentCompletionSummariesRef.current.add(summaryRunId);
                flushQueuedChatMessageUpdates();
                setChatMessages(prev => [...prev, {
                  id: `${assistantId}-completion-${summaryRunId}`,
                  role: 'assistant',
                  content: event.summary,
                }]);
              }
              continue;
            }

            if (event.type === 'agent_error') {
              updatePendingAssistantMessage((msg) => {
                const failedClarificationOwnsMessage = msg.agentClarification?.request.failed === true;
                return {
                  ...updateAgentRunProgress(msg, { type: 'agent_error' }),
                  taskStatus: 'failed',
                  ...(event.stage === 'planning' && event.message && !failedClarificationOwnsMessage
                    ? { content: event.message }
                    : {}),
                };
              });
              if (event.stage === 'planning' && event.retryable) {
                continue;
              }
              throw new Error(event.message || event.error || 'Agent 运行失败');
            }

            if (event.type === 'agent_done') {
              updatePendingAssistantMessage((msg) => ({
                ...updateAgentRunProgress(msg, { type: 'agent_done' }),
                ...(event.taskSnapshot ? { taskSnapshot: event.taskSnapshot } : {}),
              }));
              continue;
            }

            if (event.type === 'delta' && event.content) {
              const channel = event.channel || 'content';
              if (channel !== 'reasoning') {
                enqueueStreamDelta(assistantId, event.content);
              }
              continue;
            }

            if (event.type === 'error') {
              throw new Error(event.error || '流式响应失败');
            }

            if (event.type === 'done') {
              doneReceived = true;
            }
          }
        }

        if (buffer.trim()) {
          try {
            const event = JSON.parse(buffer.trim()) as {
              type?: string;
              content?: string;
              channel?: 'content' | 'reasoning';
              error?: string;
            };
            if (event.type === 'delta' && event.content) {
              const channel = event.channel || 'content';
              if (channel !== 'reasoning') {
                enqueueStreamDelta(assistantId, event.content);
              }
            }
            if (event.type === 'error') {
              throw new Error(event.error || '流式响应失败');
            }
            if (event.type === 'done') {
              doneReceived = true;
            }
          } catch {
            // ignore malformed trailing chunk
          }
        }

        await generatedAssetPreloadChain;

        if (doneReceived) {
          await waitForStreamFlush();
        }

        flushStreamQueueNow(assistantId);

        let extractedChoice: SkillChoicePayload | null = null;
        setChatMessages(prev => prev.map((msg) => {
          if (msg.id !== assistantId) return msg;
          const processed = processAssistantContentWithChoice(msg.content, currentSkill?.id);
          extractedChoice = processed.skillChoice || null;
          return {
            ...msg,
            content: processed.content,
            taskStatus: undefined,
            skillChoice: processed.skillChoice,
            skillChoiceDismissed: false,
            skillChoiceResolved: false,
          };
        }));

        if (extractedChoice) {
          setPendingSkillChoice(extractedChoice);
          setShowSkillChoiceModal(true);
        }

        stopStreamTypewriter();

        return;
      }
      
      const result = await response.json();
      
      if (result.status === 'completed') {
        const data = result.result;
        
        if (data.type === 'chat') {
          const processed = processAssistantContentWithChoice(data.content, currentSkill?.id);
          updatePendingAssistantMessage((msg) => ({
            ...msg,
            content: processed.content,
            reasoningContent: data.reasoningContent,
            model: data.model,
            taskStatus: undefined,
            skillChoice: processed.skillChoice,
            skillChoiceDismissed: false,
            skillChoiceResolved: false,
          }));
          if (processed.skillChoice) {
            setPendingSkillChoice(processed.skillChoice);
            setShowSkillChoiceModal(true);
          }
        } else if (data.data && data.data.length > 0) {
          const imageUrl = data.localUrl || data.data[0].url;
          const newImageCount = currentImageCount + 1;
          const assistantImageMessageId = pendingAssistantMessageIdRef.current || assistantPlaceholderId;
          setImageCount(newImageCount);
          
          updatePendingAssistantMessage((msg) => ({
            ...msg,
            content: '',
            imageUrl,
            model: data.model,
            imageName: `image ${newImageCount}`,
            taskStatus: undefined,
          }));
          
          const img = new window.Image();
          img.crossOrigin = 'anonymous';
          img.onload = () => {
            const spawnPosition = getSpawnPosition(
              {
                width: getConstrainedImageDisplaySize(img.width, img.height).width,
                height: getConstrainedImageDisplaySize(img.width, img.height).height,
              },
              0,
              currentViewport
            );
            const newItem = createImageCanvasItem({
              id: `generated-${Date.now()}`,
              src: imageUrl,
              naturalWidth: img.width,
              naturalHeight: img.height,
              x: spawnPosition.x,
              y: spawnPosition.y,
            });
            appendGeneratedImageHistoryForSession(
              generationSessionId,
              [
                createGeneratedImageHistoryEntry({
                  src: imageUrl,
                  naturalWidth: img.width,
                  naturalHeight: img.height,
                  source: 'chat',
                  messageId: assistantImageMessageId,
                }),
              ]
            );
            recordCurrentCanvasUndoSnapshot();
            setItems(prev => [...prev, newItem]);
          };
          img.src = imageUrl;
        } else {
          updatePendingAssistantMessage((msg) => ({
            ...msg,
            content: '未收到有效响应，请重试',
            taskStatus: 'failed',
          }));
        }
        
      } else if (result.status === 'error') {
        updatePendingAssistantMessage((msg) => ({
          ...msg,
          content: result.error || '生成失败',
          taskStatus: 'failed',
        }));
      }
      
    } catch (error) {
      console.error('Generation failed:', error);

      if (error instanceof Error && error.name === 'AbortError') {
        updateActiveStreamMessageStatus('cancelled', '任务已终止');
        updatePendingAssistantMessage((msg) => ({
          ...updateAgentRunProgress(msg, { type: 'agent_error' }),
          taskStatus: 'cancelled',
          content: '任务已终止',
        }));
        return;
      }

      updateActiveStreamMessageStatus('failed', '生成失败，请重试');
      updatePendingAssistantMessage((msg) => generationMode === 'agent'
        ? {
            ...updateAgentRunProgress(msg, { type: 'agent_error' }),
            taskStatus: 'failed',
            content: `生成失败: ${error instanceof Error ? error.message : '未知错误'}`,
          }
        : {
            ...msg,
            taskStatus: 'failed',
            content: `生成失败: ${error instanceof Error ? error.message : '未知错误'}`,
          });
    } finally {
      stopStreamTypewriter();
      if (generationMode === 'agent') setActiveAgentRunMarker(undefined);
      for (const key of processedAgentActionKeysForRun) {
        processedAgentActionsRef.current.delete(key);
      }
      if (!runController || generateAbortRef.current === runController) {
        if (runController) generateAbortRef.current = null;
        if (!activeSkillJobMessageIdRef.current) {
          setIsGenerating(false);
          if (pendingAssistantMessageIdRef.current === assistantPlaceholderId) {
            pendingAssistantMessageIdRef.current = null;
          }
        }
      }
    }
  };

  const handleSelectedTextCardPanelSubmit = useCallback(() => {
    if (!selectedTextCardPanelItem || activeCanvasTextGenerations[selectedTextCardPanelItem.id]) return;
    const input = selectedTextCardPanelSubmitInput;
    if (!input) return;

    commitPendingCanvasUndoSnapshot();
    void handleCanvasTextGenerate({
      itemId: selectedTextCardPanelItem.id,
      input,
      linkedImagePreviews: selectedTextCardPanelLinkedImagePreviews,
      modelId: selectedTextPanelModel.id,
    });
  }, [
    activeCanvasTextGenerations,
    commitPendingCanvasUndoSnapshot,
    handleCanvasTextGenerate,
    selectedTextCardPanelItem,
    selectedTextCardPanelLinkedImagePreviews,
    selectedTextCardPanelSubmitInput,
    selectedTextPanelModel.id,
  ]);

  const handleSelectedImageCardPanelSubmit = useCallback(() => {
    if (!selectedImageCardPanelItem || activeCanvasImageGenerations[selectedImageCardPanelItem.id]) return;

    const input = selectedImageCardPanelSubmitInput;
    const hasReferences = selectedImageCardPanelLinkedImagePreviews.length > 0;
    if (!input.trim() && !hasReferences) return;

    commitPendingCanvasUndoSnapshot();
    void handleCanvasImageGenerate({
      itemId: selectedImageCardPanelItem.id,
      input,
      linkedImagePreviews: selectedImageCardPanelLinkedImagePreviews,
      modelId: selectedImageCardPanelModelId,
      size: selectedImageCardPanelSize,
      quality: selectedImageCardPanelQuality,
      count: selectedImageCardPanelCount,
      aspectRatio: selectedImageCardPanelAspectRatio,
    });
  }, [
    activeCanvasImageGenerations,
    commitPendingCanvasUndoSnapshot,
    handleCanvasImageGenerate,
    selectedImageCardPanelQuality,
    selectedImageCardPanelCount,
    selectedImageCardPanelAspectRatio,
    selectedImageCardPanelItem,
    selectedImageCardPanelLinkedImagePreviews,
    selectedImageCardPanelSubmitInput,
    selectedImageCardPanelModelId,
    selectedImageCardPanelSize,
  ]);

  const openAgentConfirmationModal = (confirmation: AgentConfirmationPayload) => {
    setPendingAgentConfirmation(confirmation);
    setShowAgentConfirmationModal(true);
    setChatMessages((prev) => prev.map((message) => (
      message.agentConfirmation?.confirmationId === confirmation.confirmationId
        ? { ...message, agentConfirmationDismissed: false }
        : message
    )));
  };

  const closeAgentConfirmationModal = () => {
    if (pendingAgentConfirmation) {
      setChatMessages((prev) => prev.map((message) => (
        message.agentConfirmation?.confirmationId === pendingAgentConfirmation.confirmationId
          ? { ...message, agentConfirmationDismissed: true }
          : message
      )));
    }
    setShowAgentConfirmationModal(false);
  };

  const submitAgentConfirmation = () => {
    const confirmation = pendingAgentConfirmation;
    if (!confirmation || pendingAgentConfirmationsRef.current.has(confirmation.confirmationId)) return;
    const messageIndex = chatMessages.findIndex((message) => (
      message.agentConfirmation?.confirmationId === confirmation.confirmationId
    ));
    const sourceMessage = [...chatMessages.slice(0, messageIndex)]
      .reverse()
      .find((message) => message.role === 'user');
    if (!sourceMessage) return;
    pendingAgentConfirmationsRef.current.add(confirmation.confirmationId);
    setPendingAgentConfirmation(null);
    setShowAgentConfirmationModal(false);
    setChatMessages((prev) => prev.map((message) => (
      message.agentConfirmation?.confirmationId === confirmation.confirmationId
        ? {
            ...message,
            content: '',
            agentRunProgress: reduceAgentRunProgress(message.agentRunProgress || null, {
              type: 'confirmation_submitted',
              toolName: confirmation.toolName,
            }) || undefined,
            agentConfirmationResolved: true,
            agentConfirmationDismissed: false,
            taskStatus: 'running',
          }
        : message
    )));
    void handleGenerate({
      input: sourceMessage.content,
      skill: sourceMessage.skill,
      agentConfirmation: confirmation,
    }).finally(() => pendingAgentConfirmationsRef.current.delete(confirmation.confirmationId));
  };

  const openAgentProposalModal = (proposal: AgentProposal) => {
    setPendingAgentProposal(proposal);
    setShowAgentProposalModal(true);
    setChatMessages((prev) => prev.map((message) => message.agentProposal?.id === proposal.id
      ? { ...message, agentProposalDismissed: false }
      : message));
  };

  const closeAgentProposalModal = () => {
    if (pendingAgentProposal) {
      setChatMessages((prev) => prev.map((message) => message.agentProposal?.id === pendingAgentProposal.id
        ? { ...message, agentProposalDismissed: true }
        : message));
    }
    setShowAgentProposalModal(false);
  };

  const submitAgentProposal = (proposal: AgentProposal, option: AgentProposal['options'][number]) => {
    setChatMessages((prev) => prev.map((message) => message.agentProposal?.id === proposal.id
      ? { ...message, agentProposalResolved: true, agentProposalDismissed: false }
      : message));
    setPendingAgentProposal(null);
    setShowAgentProposalModal(false);
    void handleGenerate({
      input: `选择 ${option.label}，按该方案继续执行。`,
      selectedContextEntityIds: [option.entityId],
    });
  };

  const openSkillChoiceModal = (choice: SkillChoicePayload) => {
    setPendingSkillChoice(choice);
    setShowSkillChoiceModal(true);
    setChatMessages((prev) => prev.map((msg) => {
      if (msg.skillChoice?.id !== choice.id) return msg;
      return { ...msg, skillChoiceDismissed: false };
    }));
  };

  const handleCloseSkillChoiceModal = () => {
    if (pendingSkillChoice) {
      setChatMessages((prev) => prev.map((msg) => {
        if (msg.skillChoice?.id !== pendingSkillChoice.id) return msg;
        return { ...msg, skillChoiceDismissed: true };
      }));
    }
    setShowSkillChoiceModal(false);
  };

  const handleSubmitSkillChoice = (choice: SkillChoicePayload, option: SkillChoiceOption) => {
    processedSkillChoiceIdsRef.current.add(choice.id);
    setPendingSkillChoice(null);
    setShowSkillChoiceModal(false);
    setChatMessages((prev) => prev.map((msg) => {
      if (msg.skillChoice?.id !== choice.id) return msg;
      return {
        ...msg,
        skillChoiceResolved: true,
      };
    }));
    void handleGenerate({
      input: option.submitText,
      skill: activeSkill || { id: 'brand', label: '品牌识别系统' },
    });
  };

  const openAgentClarificationModal = (clarification: AgentClarificationPayload) => {
    setPendingAgentClarification(clarification);
    setAgentClarificationCustomText('');
    setShowAgentClarificationModal(true);
    setChatMessages((prev) => prev.map((message) => message.agentClarification?.request.id === clarification.request.id
      ? { ...message, agentClarificationDismissed: false }
      : message));
  };

  const closeAgentClarificationModal = () => {
    if (pendingAgentClarification) {
      setChatMessages((prev) => prev.map((message) =>
        message.agentClarification?.request.id === pendingAgentClarification.request.id
          ? { ...message, agentClarificationDismissed: true }
          : message));
    }
    setShowAgentClarificationModal(false);
  };

  const resolveAgentClarificationMessage = (requestId: string) => {
    setChatMessages((prev) => prev.map((message) =>
      message.agentClarification?.request.id === requestId
        ? {
            ...message,
            agentClarificationResolved: true,
            agentClarificationDismissed: false,
          }
        : message));
  };

  const submitAgentClarification = (proceedWithCurrent = false, selectedOptionId = '') => {
    const clarification = pendingAgentClarification;
    if (!clarification || isGenerating) return;
    const selectedOption = clarification.request.options.find(
      (option) => option.id === selectedOptionId
    );
    const customText = selectedOptionId === 'custom' ? agentClarificationCustomText.trim() : '';
    if (!proceedWithCurrent && !selectedOption && !customText) return;
    const answer = proceedWithCurrent
      ? '按当前信息开始制作，其余创作细节由 Agent 决定。'
      : [selectedOption?.answer, customText].filter(Boolean).join('；');
    const response: AgentClarificationResponse = {
      requestId: clarification.request.id,
      ...(selectedOption ? { selectedOptionId: selectedOption.id } : {}),
      ...(customText ? { customText } : {}),
      ...(proceedWithCurrent ? { proceedWithCurrent: true } : {}),
    };
    setChatMessages((prev) => prev.map((message) =>
      message.agentClarification?.request.id === clarification.request.id
        ? {
            ...message,
            agentClarificationResolved: false,
            agentClarificationDismissed: true,
          }
        : message));
    setPendingAgentClarification(null);
    setShowAgentClarificationModal(false);
    setAgentClarificationCustomText('');
    void handleGenerate({
      input: answer,
      agentClarification: clarification,
      agentClarificationResponse: response,
    });
  };

  const retryAgentClarification = () => {
    const clarification = pendingAgentClarification;
    if (!clarification || isGenerating || agentReanalysisInFlightRef.current) return;
    agentReanalysisInFlightRef.current = true;
    resolveAgentClarificationMessage(clarification.request.id);
    setPendingAgentClarification(null);
    setShowAgentClarificationModal(false);
    void handleGenerate({
      input: clarification.state.originalRequest,
      agentClarification: clarification,
      suppressUserMessage: true,
      agentClarificationResponse: {
        requestId: clarification.request.id,
        retry: true,
        retryMode: 'replan',
      },
    }).finally(() => {
      agentReanalysisInFlightRef.current = false;
    });
  };

  const hasPendingAgentDecision = (message: ChatMessage) => Boolean(
    (message.agentConfirmation && !message.agentConfirmationResolved)
    || (message.agentClarification && !message.agentClarificationResolved)
    || (message.agentProposal?.requiresSelection && !message.agentProposalResolved)
    || (message.skillChoice && !message.skillChoiceResolved)
  );

  const openPendingAgentDecision = (message: ChatMessage) => {
    if (message.agentConfirmation && !message.agentConfirmationResolved) {
      openAgentConfirmationModal(message.agentConfirmation);
      return;
    }
    if (message.agentClarification && !message.agentClarificationResolved) {
      openAgentClarificationModal(message.agentClarification);
      return;
    }
    if (message.agentProposal?.requiresSelection && !message.agentProposalResolved) {
      openAgentProposalModal(message.agentProposal);
      return;
    }
    if (message.skillChoice && !message.skillChoiceResolved) {
      openSkillChoiceModal(message.skillChoice);
    }
  };

  const getPendingAgentDecisionLabel = (message: ChatMessage) => {
    if (message.agentConfirmation) return message.agentConfirmation.message;
    if (message.agentClarification) return message.agentClarification.request.question;
    if (message.agentProposal) return `等待选择：${message.agentProposal.title}`;
    if (message.skillChoice) return `等待选择：${message.skillChoice.title}`;
    return '等待你的选择';
  };

  const handleQuickSkillSelect = (
    action: { id: string; label: string },
    source: SkillSelectSource
  ) => {
    const selectedSkill = { id: action.id, label: action.label };
    setActiveSkillForCurrentTopic(selectedSkill);
    if (source === 'center_quick_action') {
      setHideWelcomeByCenterSkillPick(true);
    }

    if (source === 'center_quick_action' && !latestChatInputRef.current.trim()) {
      const prompt = SKILL_DEFAULT_PROMPTS[action.id];
      if (prompt) {
        setChatInput(prompt);
      }
    }
  };

  const buildCurrentSessionSnapshot = useCallback((session: ProjectSession) => {
    const liveState = sessionLiveStateRef.current;
    let topics = session.topics || [];
    const activeId = session.activeTopicId;

    if (activeId) {
      topics = topics.map((topic) => {
        if (topic.id !== activeId) return topic;

        let title = topic.title;
        if ((title === '新对话' || !title) && liveState.chatMessages.length > 0) {
          title = liveState.chatMessages[0].content.substring(0, 20) || '对话项目';
        }

        return {
          ...topic,
          title,
          messages: liveState.chatMessages,
          activeSkill: liveState.activeSkill || null,
          activeSkillExplicit: Boolean(liveState.activeSkill),
          updatedAt: Date.now(),
        };
      });
    }

    return buildPersistedSession(session, {
      updatedAt: Date.now(),
      items: liveState.items,
      textCardPanelDrafts: liveState.textCardPanelDrafts,
      textCardProviderById: liveState.textCardProviderById,
      textCardModelById: liveState.textCardModelById,
      imageCardPanelDrafts: liveState.imageCardPanelDrafts,
      imageCardProviderById: liveState.imageCardProviderById,
      imageCardModelById: liveState.imageCardModelById,
      imageCardSizeById: liveState.imageCardSizeById,
      imageCardQualityById: liveState.imageCardQualityById,
      imageCardCountById: liveState.imageCardCountById,
      imageCardAspectRatioById: liveState.imageCardAspectRatioById,
      connections: liveState.connections,
      messages: liveState.chatMessages,
      chatProviderId: liveState.chatProviderId,
      chatModelId: liveState.chatModelId,
      imageProviderId: liveState.imageProviderId,
      imageModelId: liveState.imageModelId,
      topics,
      activeTopicId: activeId,
      activeAgentRun: activeAgentRunMarkerRef.current,
      generatedImageHistory:
        liveState.generatedImageHistoryBySession[session.id] ??
        persistedGeneratedImageHistoryBySessionRef.current[session.id] ??
        session.generatedImageHistory ??
        [],
      viewport: liveState.viewport,
      regionSelections: liveState.regionSelections,
    });
  }, []);

  const resolveCurrentSessionPresentationState = useCallback((session: ProjectSession) => {
    return resolveSessionPresentationState({
      session,
      now: Date.now(),
      normalizeSession: normalizeProjectSession,
      normalizeItems: (sessionItems: CanvasItem[]) => normalizeCanvasItems(sessionItems || []),
      inferTopicSkill: (topic: ChatTopic | null) => inferTopicSkill(topic),
    });
  }, [inferTopicSkill]);

  const applyResolvedSessionState = useCallback((resolvedState: any) => {
    flushPendingCanvasCommit('session-switch');
    resetPendingCanvasInteractionCommits();
    isHydratingSessionRef.current = true;
    const interruptedRun = resolvedState.normalizedSession?.activeAgentRun?.status === 'running'
      ? resolvedState.normalizedSession.activeAgentRun as NonNullable<ProjectSession['activeAgentRun']>
      : null;
    const resolvedChatMessages = (resolvedState.chatMessages || []).map((message: ChatMessage) => (
      interruptedRun && message.id === interruptedRun.assistantMessageId
        ? {
            ...message,
            taskStatus: 'failed' as const,
            content: message.content || '上次任务因页面异常中断，请重试。',
            agentRunProgress: message.agentRunProgress
              ? reduceAgentRunProgress(message.agentRunProgress, { type: 'agent_error' }) || undefined
              : undefined,
          }
        : message
    ));
    activeAgentRunMarkerRef.current = undefined;
    setActiveAgentRunMarker(undefined);
    setInterruptedRunRecoveryPending(Boolean(interruptedRun));
    syncSessionLiveState({
      items: resolvedState.items,
      connections: resolvedState.connections || [],
      chatMessages: resolvedChatMessages,
      activeSkill: resolvedState.activeSkill || null,
      chatProviderId: resolvedState.normalizedSession?.chatProviderId || '',
      chatModelId: resolvedState.normalizedSession?.chatModelId || '',
      imageProviderId: resolvedState.normalizedSession?.imageProviderId || '',
      imageModelId: resolvedState.normalizedSession?.imageModelId || '',
      textCardPanelDrafts: resolvedState.normalizedSession?.textCardPanelDrafts || {},
      textCardProviderById: resolvedState.normalizedSession?.textCardProviderById || {},
      textCardModelById: resolvedState.normalizedSession?.textCardModelById || {},
      imageCardPanelDrafts: resolvedState.normalizedSession?.imageCardPanelDrafts || {},
      imageCardProviderById: resolvedState.normalizedSession?.imageCardProviderById || {},
      imageCardModelById: resolvedState.normalizedSession?.imageCardModelById || {},
      imageCardSizeById: resolvedState.normalizedSession?.imageCardSizeById || {},
      imageCardQualityById: resolvedState.normalizedSession?.imageCardQualityById || {},
      imageCardCountById: resolvedState.normalizedSession?.imageCardCountById || {},
      imageCardAspectRatioById: resolvedState.normalizedSession?.imageCardAspectRatioById || {},
      viewport: resolvedState.viewport || { x: 0, y: 0, scale: 1 },
      regionSelections: resolvedState.normalizedSession?.regionSelections || [],
    });
    setItemsState(resolvedState.items);
    setConnectionsState(resolvedState.connections || []);
    setChatMessagesState(resolvedChatMessages);
    setActiveSkillState(resolvedState.activeSkill || null);
    setChatProviderIdState(resolvedState.normalizedSession?.chatProviderId || '');
    setChatModelIdState(resolvedState.normalizedSession?.chatModelId || '');
    setImageProviderIdState(resolvedState.normalizedSession?.imageProviderId || '');
    setImageModelIdState(resolvedState.normalizedSession?.imageModelId || '');
    const resolvedRegionSelections = resolvedState.normalizedSession?.regionSelections || [];
    regionEvidenceByIdRef.current.clear();
    regionSelectionsRef.current = resolvedRegionSelections;
    setRegionSelectionsState(resolvedRegionSelections);
    setEditingTextCardId(null);
    setSelectedConnectionIds([]);
    clearConnectionSnapTargetVisualRef.current();
    setPendingConnectionMenu(null);
    setFrozenPreviewConnection(null);
    setTextCardPanelDraftsState(resolvedState.normalizedSession?.textCardPanelDrafts || {});
    setTextCardProviderByIdState(resolvedState.normalizedSession?.textCardProviderById || {});
    setTextCardModelByIdState(resolvedState.normalizedSession?.textCardModelById || {});
    setImageCardPanelDraftsState(resolvedState.normalizedSession?.imageCardPanelDrafts || {});
    setImageCardProviderByIdState(resolvedState.normalizedSession?.imageCardProviderById || {});
    setImageCardModelByIdState(resolvedState.normalizedSession?.imageCardModelById || {});
    setImageCardSizeByIdState(resolvedState.normalizedSession?.imageCardSizeById || {});
    setImageCardQualityByIdState(resolvedState.normalizedSession?.imageCardQualityById || {});
    setImageCardCountByIdState(resolvedState.normalizedSession?.imageCardCountById || {});
    setImageCardAspectRatioByIdState(resolvedState.normalizedSession?.imageCardAspectRatioById || {});
    if (resolvedState.shouldResetWelcome) {
      setHideWelcomeByCenterSkillPick(false);
    }
    setViewportState(resolvedState.viewport || { x: 0, y: 0, scale: 1 });
    setImageCount(resolvedState.imageCount || 0);
    setShowProjectMenu(false);
    setShowHistoryPanel(false);
    connectionSessionRef.current = null;
  }, [flushPendingCanvasCommit, resetPendingCanvasInteractionCommits, syncSessionLiveState]);

  const isHighFrequencyInteractionActive =
    isCornerResizingRef.current ||
    isDraggingRef.current ||
    isPanningRef.current ||
    Boolean(canvasItemDragTransactionRef.current) ||
    Boolean(pendingCanvasCommitRef.current);

  useLayoutEffect(() => {
    activeAgentRunMarkerRef.current = activeAgentRunMarker;
  }, [activeAgentRunMarker]);

  const sessionSaveSignal = React.useMemo(
    () => ({
      items,
      textCardPanelDrafts,
      imageCardPanelDrafts,
      imageCardProviderById,
      imageCardModelById,
      imageCardSizeById,
      imageCardQualityById,
      imageCardCountById,
      imageCardAspectRatioById,
      connections,
      chatMessages,
      chatProviderId,
      chatModelId,
      imageProviderId,
      imageModelId,
      viewport,
      imageCount,
      activeSkill,
      activeAgentRunMarker,
      generatedImageHistoryBySession,
      regionSelections,
    }),
    [activeAgentRunMarker, activeSkill, chatMessages, chatModelId, chatProviderId, connections, generatedImageHistoryBySession, imageCardAspectRatioById, imageCardCountById, imageCardModelById, imageCardPanelDrafts, imageCardProviderById, imageCardQualityById, imageCardSizeById, imageCount, imageModelId, imageProviderId, items, regionSelections, textCardPanelDrafts, viewport]
  );

  const {
    sessions,
    currentSessionId,
    pendingSessionAction,
    sessionActionError,
    setSessions,
    createNewProject,
    renameSession: persistRenameSession,
    deleteSession,
    loadSession,
    leaveEditor,
    enterEditor,
    scheduleCurrentSessionSave,
  } = useWorkspaceSessionController({
    resolveSessionPresentationState: resolveCurrentSessionPresentationState,
    applyResolvedSessionState,
    buildCurrentSessionSnapshot,
    viewMode,
    setViewMode,
    isHighFrequencyInteractionActive,
    sessionSaveSignal,
  });
  scheduleCurrentSessionSaveRef.current = scheduleCurrentSessionSave;

  useEffect(() => {
    if (!currentSessionId) return;
    const getMigrationKey = (src: string) => `${currentSessionId}:${src.length}:${src.slice(-64)}`;
    const pendingSources = Array.from(new Set(items.flatMap((item) => {
      if (item.type !== 'image') return [];
      return [
        typeof item.src === 'string' ? item.src : '',
        ...(Array.isArray(item.imageOutputs)
          ? item.imageOutputs.map((output) => output?.src || '')
          : []),
      ].filter((src) => src.startsWith('data:image/'));
    }))).filter((src) => !attemptedLegacyCanvasImageMigrationsRef.current.has(getMigrationKey(src)));
    if (pendingSources.length === 0) return;

    const migrationSessionId = currentSessionId;
    const migratePendingSources = () => void (async () => {
      pendingSources.forEach((src) => attemptedLegacyCanvasImageMigrationsRef.current.add(getMigrationKey(src)));
      const migrated = new Map<string, string>();
      for (const [index, src] of pendingSources.entries()) {
        if (currentSessionIdRef.current !== migrationSessionId) return;
        try {
          const response = await fetch('/api/upload', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              imageData: src,
              fileName: `migrated-canvas-image-${Date.now()}-${index}.png`,
            }),
          });
          const payload = response.ok ? await response.json() : null;
          if (typeof payload?.url === 'string' && payload.url) migrated.set(src, payload.url);
        } catch (error) {
          console.warn('Legacy canvas image migration failed:', error);
        }
      }
      if (currentSessionIdRef.current !== migrationSessionId || migrated.size === 0) return;
      setItems((currentItems) => currentItems.map((item) => {
        if (item.type !== 'image') return item;
        const migratedSrc = typeof item.src === 'string' ? migrated.get(item.src) : undefined;
        const imageOutputs = Array.isArray(item.imageOutputs)
          ? item.imageOutputs.map((output) => {
              const migratedOutputSrc = migrated.get(output.src);
              return migratedOutputSrc ? { ...output, src: migratedOutputSrc } : output;
            })
          : item.imageOutputs;
        const outputsChanged = imageOutputs !== item.imageOutputs && imageOutputs.some(
          (output, index) => output !== item.imageOutputs?.[index]
        );
        if (!migratedSrc && !outputsChanged) return item;
        return {
          ...item,
          ...(migratedSrc ? { src: migratedSrc } : {}),
          ...(outputsChanged ? { imageOutputs } : {}),
        };
      }));
    })();
    const schedule = typeof window.requestIdleCallback === 'function'
      ? window.requestIdleCallback(migratePendingSources, { timeout: 2000 })
      : window.setTimeout(migratePendingSources, 250);
    return () => {
      if (typeof window.cancelIdleCallback === 'function') window.cancelIdleCallback(schedule);
      else window.clearTimeout(schedule);
    };
  }, [currentSessionId, items, setItems]);

  useEffect(() => {
    if (!currentSessionId) return;
    const getMigrationKey = (src: string) => `${currentSessionId}:${src.length}:${src.slice(-64)}`;
    const pendingSources = Array.from(new Set(
      chatMessages.flatMap((message) => (
        message.referenceContext?.references
          .map((reference) => reference.src)
          .filter((src) => src.startsWith('data:image/')) || []
      ))
    )).filter((src) => !attemptedLegacyChatReferenceMigrationsRef.current.has(getMigrationKey(src)));
    if (pendingSources.length === 0) return;

    const migrationSessionId = currentSessionId;
    pendingSources.forEach((src) => attemptedLegacyChatReferenceMigrationsRef.current.add(getMigrationKey(src)));
    void (async () => {
      const migrated = new Map<string, string>();
      for (const [index, src] of pendingSources.entries()) {
        if (currentSessionIdRef.current !== migrationSessionId) return;
        try {
          const response = await fetch('/api/upload', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              imageData: src,
              fileName: `migrated-chat-reference-${Date.now()}-${index}.png`,
            }),
          });
          const payload = response.ok ? await response.json() : null;
          if (typeof payload?.url === 'string' && payload.url) migrated.set(src, payload.url);
        } catch (error) {
          console.warn('Legacy chat reference migration failed:', error);
        }
      }
      if (currentSessionIdRef.current !== migrationSessionId || migrated.size === 0) return;
      setChatMessages((messages) => messages.map((message) => {
        if (!message.referenceContext) return message;
        let changed = false;
        const references = message.referenceContext.references.map((reference) => {
          const migratedSrc = migrated.get(reference.src);
          if (!migratedSrc) return reference;
          changed = true;
          return { ...reference, src: migratedSrc };
        });
        const evidenceImages = message.referenceContext.evidenceImages?.map((evidence) => {
          const migratedSrc = migrated.get(evidence.src);
          if (!migratedSrc) return evidence;
          changed = true;
          return { ...evidence, src: migratedSrc };
        });
        return changed ? {
          ...message,
          referenceContext: {
            ...message.referenceContext,
            references,
            ...(evidenceImages ? { evidenceImages } : {}),
          },
        } : message;
      }));
    })();
  }, [chatMessages, currentSessionId, setChatMessages]);

  useEffect(() => {
    setVisibleChatMessageLimit(80);
  }, [currentSessionId]);

  const hiddenChatMessageCount = Math.max(0, chatMessages.length - visibleChatMessageLimit);
  const visibleChatMessages = React.useMemo(
    () => chatMessages.slice(Math.max(0, chatMessages.length - visibleChatMessageLimit)),
    [chatMessages, visibleChatMessageLimit]
  );

  useEffect(() => {
    if (!interruptedRunRecoveryPending || !currentSessionId) return;
    scheduleCurrentSessionSave();
    setInterruptedRunRecoveryPending(false);
  }, [currentSessionId, interruptedRunRecoveryPending, scheduleCurrentSessionSave]);

  useEffect(() => {
    persistedGeneratedImageHistoryBySessionRef.current = sessions.reduce<Record<string, GeneratedImageHistoryEntry[]>>((result, session) => {
      if (Array.isArray(session.generatedImageHistory) && session.generatedImageHistory.length > 0) {
        result[session.id] = session.generatedImageHistory;
      }
      return result;
    }, {});
  }, [sessions]);

  useEffect(() => {
    let cancelled = false;

    const loadArchiveGeneratedImageHistory = async () => {
      try {
        const response = await fetch('/api/generated-images/history', {
          cache: 'no-store',
        });
        if (!response.ok) {
          return;
        }

        const data = await response.json().catch(() => null);
        if (cancelled) {
          return;
        }

        setArchiveGeneratedImageHistoryEntries(Array.isArray(data?.entries) ? data.entries : []);
      } catch (error) {
        if (!cancelled) {
          console.error('Failed to load generated image archive history:', error);
        }
      }
    };

    void loadArchiveGeneratedImageHistory();

    return () => {
      cancelled = true;
    };
  }, []);

  // 项目管理函数
  const getCurrentSession = () => sessions.find(s => s.id === currentSessionId);
  const sessionsWithGeneratedImageHistory = React.useMemo(() => {
    return sessions.map((session) => {
      const liveEntries = generatedImageHistoryBySession[session.id];
      if (!liveEntries) {
        return session;
      }

      return {
        ...session,
        generatedImageHistory: liveEntries,
      };
    });
  }, [generatedImageHistoryBySession, sessions]);
  const currentSessionHistorySnapshot = React.useMemo(() => {
    const currentSession = sessionsWithGeneratedImageHistory.find((session) => session.id === currentSessionId);
    if (!currentSession) {
      return null;
    }

    return buildCurrentSessionSnapshot(currentSession);
  }, [buildCurrentSessionSnapshot, currentSessionId, sessionsWithGeneratedImageHistory]);
  const generatedImageHistoryEntries = React.useMemo(
    () => getGeneratedImageHistoryEntries({
      sessions: sessionsWithGeneratedImageHistory,
      currentSessionSnapshot: currentSessionHistorySnapshot,
      archiveEntries: archiveGeneratedImageHistoryEntries,
    }),
    [archiveGeneratedImageHistoryEntries, currentSessionHistorySnapshot, sessionsWithGeneratedImageHistory]
  );

  const closeChatComposerPopovers = useCallback(() => {
    setShowChatComposerMoreMenu(false);
    setShowChatAssetPicker(false);
    setShowSkillsMenu(false);
    setShowGenerationModeMenu(false);
    setShowModelPreferencePopover(false);
    setShowChatModelSelector(false);
    setShowImageModelSelector(false);
  }, []);

  useEffect(() => {
    if (
      showAgentConfirmationModal
      || showAgentProposalModal
      || showAgentClarificationModal
      || showSkillChoiceModal
    ) {
      closeChatComposerPopovers();
    }
  }, [
    closeChatComposerPopovers,
    showAgentClarificationModal,
    showAgentConfirmationModal,
    showAgentProposalModal,
    showSkillChoiceModal,
  ]);

  useEffect(() => {
    if (!showChatAssetPicker) return;
    const frameId = window.requestAnimationFrame(() => chatAssetPickerRef.current?.focus());
    return () => window.cancelAnimationFrame(frameId);
  }, [showChatAssetPicker]);

  useEffect(() => {
    if (!showModelPreferencePopover) return;
    const frameId = window.requestAnimationFrame(() => modelPreferencePopoverRef.current?.focus());
    return () => window.cancelAnimationFrame(frameId);
  }, [showModelPreferencePopover]);

  useEffect(() => {
    if (!isGenerating) return;
    closeChatComposerPopovers();
    setSelectedChatHistoryAssetIds([]);
  }, [closeChatComposerPopovers, isGenerating]);

  const handleAttachSelectedChatHistoryAssets = useCallback(() => {
    const selectedIds = new Set(selectedChatHistoryAssetIds);
    const selectedSources = generatedImageHistoryEntries
      .filter((entry) => selectedIds.has(entry.id))
      .map((entry) => ({ src: entry.src, taskId: entry.taskId, versionId: entry.versionId }));

    appendChatReferenceSources(selectedSources, 'history');
    setSelectedChatHistoryAssetIds([]);
    setShowChatAssetPicker(false);
  }, [appendChatReferenceSources, generatedImageHistoryEntries, selectedChatHistoryAssetIds]);
  
  const currentProjectName = getCurrentSession()?.name || '新画布';

  useEffect(() => {
    currentSessionIdRef.current = currentSessionId;
  }, [currentSessionId]);

  useEffect(() => {
    pendingCanvasHistorySnapshotRef.current = null;
  }, [currentSessionId, viewMode]);

  useEffect(() => {
    const activeSessionIds = new Set(sessions.map((session) => session.id));
    canvasHistoryBySessionRef.current = Object.fromEntries(
      Object.entries(canvasHistoryBySessionRef.current).filter(([sessionId]) => activeSessionIds.has(sessionId))
    );
  }, [sessions]);

  useEffect(() => {
    cancelAllRecognitions();
    canvasTextGenerateAbortControllersRef.current.forEach((controller, itemId) => {
      suppressCanvasTextAbortErrorItemIdsRef.current.add(itemId);
      controller.abort();
    });
    canvasTextGenerateAbortControllersRef.current.clear();
    canvasImageGenerateAbortControllersRef.current.forEach((controller, itemId) => {
      suppressCanvasImageAbortErrorItemIdsRef.current.add(itemId);
      controller.abort();
    });
    canvasImageGenerateAbortControllersRef.current.clear();
    setActiveCanvasTextGenerations({});
    setActiveCanvasImageGenerations({});
    setCanvasTextGenerationErrorById({});
    setCanvasImageGenerationErrorById({});
  }, [cancelAllRecognitions, currentSessionId, viewMode]);

  // 对话项目管理函数
  const getCurrentTopic = () => {
    const session = getCurrentSession();
    if (!session || !session.topics) return null;
    return session.topics.find(t => t.id === session.activeTopicId) || null;
  };

  const setActiveSkillForCurrentTopic = (skill: { id: string; label: string } | null) => {
    setActiveSkill(skill);
    if (!skill && chatMessages.length === 0) {
      setHideWelcomeByCenterSkillPick(false);
    }
    if (!currentSessionId) return;

    setSessions((prev) => prev.map((session) => {
      if (session.id !== currentSessionId || !session.topics || !session.activeTopicId) return session;
      return {
        ...session,
        updatedAt: Date.now(),
        topics: session.topics.map((topic) =>
          topic.id === session.activeTopicId
            ? { ...topic, activeSkill: skill, activeSkillExplicit: Boolean(skill) }
            : topic
        ),
      };
    }));
  };

  const createNewTopic = () => {
    if (!currentSessionId) return;
    
    const newTopic: ChatTopic = {
      id: `topic-${Date.now()}`,
      title: '新对话',
      messages: [],
      activeSkill: null,
      activeSkillExplicit: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    
    setSessions(prev => prev.map(s => {
      if (s.id === currentSessionId) {
        const topics = s.topics || [];
        return {
          ...s,
          topics: [newTopic, ...topics],
          activeTopicId: newTopic.id,
          updatedAt: Date.now()
        };
      }
      return s;
    }));
    
    setChatMessages([]);
    setActiveSkill(null);
    setHideWelcomeByCenterSkillPick(false);
    setImageCount(0);
    setShowHistoryPanel(false);
  };

  const switchTopic = (topicId: string) => {
    const session = getCurrentSession();
    if (!session || !session.topics) return;
    
    const topic = session.topics.find(t => t.id === topicId);
    if (!topic) return;
    
    setSessions(prev => prev.map(s => {
      if (s.id === currentSessionId) {
        return { ...s, activeTopicId: topicId };
      }
      return s;
    }));
    
    setChatMessages(topic.messages);
    setActiveSkill(inferTopicSkill(topic));
    if (topic.messages.length === 0) {
      setHideWelcomeByCenterSkillPick(false);
    }
    setImageCount(topic.messages.filter(m => m.imageName).length);
    setShowHistoryPanel(false);
  };

  const deleteTopic = (topicId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm('确定要删除这个对话吗？')) return;
    
    setSessions(prev => prev.map(s => {
      if (s.id === currentSessionId && s.topics) {
        const newTopics = s.topics.filter(t => t.id !== topicId);
        let nextActiveId = s.activeTopicId;
        
        if (s.activeTopicId === topicId) {
          nextActiveId = newTopics.length > 0 ? newTopics[0].id : '';
        }
        
        return {
          ...s,
          topics: newTopics,
          activeTopicId: nextActiveId
        };
      }
      return s;
    }));
    
    // 如果删除的是当前活跃的对话，需要刷新聊天框
    const session = getCurrentSession();
    if (session && session.activeTopicId === topicId) {
      const newTopics = (session.topics || []).filter(t => t.id !== topicId);
      if (newTopics.length > 0) {
        setChatMessages(newTopics[0].messages);
        setActiveSkill(inferTopicSkill(newTopics[0]));
        if (newTopics[0].messages.length === 0) {
          setHideWelcomeByCenterSkillPick(false);
        }
      } else {
        setChatMessages([]);
        setActiveSkill(null);
        setHideWelcomeByCenterSkillPick(false);
      }
    }
  };

  const renameSession = useCallback(async (sessionId: string, newName: string) => {
    const trimmedName = newName.trim();
    if (!trimmedName) {
      setEditingSessionId(null);
      return;
    }

    const renamed = await persistRenameSession(sessionId, trimmedName);
    if (renamed) {
      setEditingSessionId(null);
    }
  }, [persistRenameSession]);

  const handleToolClick = (toolId: string) => {
    if (toolId === 'image') {
      addImageCard();
    } else if (toolId === 'text') {
      addText();
    } else {
      setTool(toolId as Tool);
    }
  };

  const handleAddNodeMenuAction = (optionId: 'text' | 'image' | 'video') => {
    if (optionId === 'video') return;
    clearPendingConnectionMenu();
    setShowAddNodeMenu(false);

    if (optionId === 'text') {
      addText();
      return;
    }

    if (optionId === 'image') {
      addImageCard();
    }
  };

  const handleCanvasBottomToolbarAction = (
    toolId: (typeof CANVAS_BOTTOM_TOOLBAR_ITEMS)[number]['id'],
    action?: CanvasBottomToolbarAction
  ) => {
    if (toolId === 'target') {
      clearPendingConnectionMenu();
      setShowAddNodeMenu(false);
      setEditingAnnotationTextId(null);
      setTool('target');
      return;
    }

    if (toolId === 'select' || toolId === 'draw' || toolId === 'text') {
      clearPendingConnectionMenu();
      setShowAddNodeMenu(false);
      setEditingAnnotationTextId(null);
      setTool(toolId === 'text' ? 'annotation-text' : toolId);
      return;
    }

    if (!action || action === 'video-placeholder') return;
    clearPendingConnectionMenu();
    setShowAddNodeMenu(false);
    setTool('select');

    if (action === 'add-image-card') {
      addImageCard();
      return;
    }

    addText();
  };

  const handleOpenChatPanel = useCallback(() => {
    chatPanelMotionControllerRef.current?.open();
  }, []);

  const handleCloseChatPanel = useCallback(() => {
    chatPanelMotionControllerRef.current?.close();
  }, []);

  const showImageToolbarNoticeWithTimeout = useCallback((message: string, autoHideMs?: number) => {
    setImageToolbarNotice(message);
    if (imageToolbarNoticeTimeoutRef.current) {
      clearTimeout(imageToolbarNoticeTimeoutRef.current);
      imageToolbarNoticeTimeoutRef.current = null;
    }

    if (Number.isFinite(autoHideMs) && autoHideMs && autoHideMs > 0) {
      imageToolbarNoticeTimeoutRef.current = setTimeout(() => {
        setImageToolbarNotice(null);
      imageToolbarNoticeTimeoutRef.current = null;
      }, autoHideMs);
    }
  }, []);

  const applyProviderSettingsResponse = useCallback((data: ProviderSettingsResponse) => {
    const providers = Array.isArray(data.providers)
      ? data.providers.map((provider) => ({
          ...provider,
          modelProtocols: normalizeProviderSettingsModelProtocols(provider.modelProtocols),
        }))
      : [];
    const nextSelectedProviderId =
      providers.find((provider) => provider.primary)?.id ||
      providers[0]?.id ||
      'comfly';
    const nextSelectedProvider = providers.find((provider) => provider.id === nextSelectedProviderId) || providers[0] || null;
    setProviderSettingsProviders(providers);
    setProviderSettingsEditableProviderIds([]);
    setProviderSettingsSelectedProviderId(nextSelectedProviderId);
    setProviderSettingsApiKey(nextSelectedProvider?.apiKey || '');
    setProviderSettingsImageApiKeys(normalizeProviderSettingsImageApiKeyRows(nextSelectedProvider?.imageApiKeys));
    setProviderSettingsError(null);
    setProviderSettingsTestResult(null);
    setIsProviderSettingsApiKeyVisible(false);
  }, []);

  const selectedProviderSettings = providerSettingsProviders.find(
    (provider) => provider.id === providerSettingsSelectedProviderId
  ) || providerSettingsProviders[0] || null;
  const isSelectedProviderSettingsIdEditable = selectedProviderSettings
    ? providerSettingsEditableProviderIds.includes(selectedProviderSettings.id)
    : false;
  const selectedProviderSettingsApiKey = selectedProviderSettings
    ? providerSettingsApiKey || selectedProviderSettings.apiKey
    : '';
  const providerSettingsApiKeyInputValue = isProviderSettingsApiKeyVisible
    ? selectedProviderSettingsApiKey
    : maskProviderSettingsApiKeyForDisplay(selectedProviderSettingsApiKey);
  const providerSettingsFetchedModelRows = React.useMemo(() => {
    const models = uniqueModelIds(providerSettingsFetchedModels?.allModels || []);
    const search = providerSettingsModelPickerSearch.trim().toLowerCase();

    return models
      .map((modelId) => ({
        id: modelId,
        category: getFetchedModelCategory(modelId, providerSettingsFetchedModels, providerSettingsFetchedModelCategoryById),
        sources: providerSettingsFetchedModels?.modelSources?.[modelId] || [],
      }))
      .filter((model) => {
        const matchesCategory =
          providerSettingsModelPickerCategory === 'all' || model.category === providerSettingsModelPickerCategory;
        const matchesSearch = !search || model.id.toLowerCase().includes(search);
        return matchesCategory && matchesSearch;
      });
  }, [
    providerSettingsFetchedModelCategoryById,
    providerSettingsFetchedModels,
    providerSettingsModelPickerCategory,
    providerSettingsModelPickerSearch,
  ]);
  const providerSettingsFetchedModelTotals = React.useMemo(() => {
    const totals = { all: 0, image: 0, chat: 0 };
    for (const modelId of uniqueModelIds(providerSettingsFetchedModels?.allModels || [])) {
      const category = getFetchedModelCategory(modelId, providerSettingsFetchedModels, providerSettingsFetchedModelCategoryById);
      totals.all += 1;
      totals[category] += 1;
    }
    return totals;
  }, [providerSettingsFetchedModelCategoryById, providerSettingsFetchedModels]);
  const providerSettingsSelectedFetchedModelTotals = React.useMemo(() => {
    const totals = { all: 0, image: 0, chat: 0 };
    for (const [modelId, isSelected] of Object.entries(providerSettingsSelectedFetchedModels)) {
      if (!isSelected) continue;
      const category = getFetchedModelCategory(modelId, providerSettingsFetchedModels, providerSettingsFetchedModelCategoryById);
      totals.all += 1;
      totals[category] += 1;
    }
    return totals;
  }, [providerSettingsFetchedModelCategoryById, providerSettingsFetchedModels, providerSettingsSelectedFetchedModels]);
  const providerSettingsSelectedModelRows = React.useMemo(() => ({
    image: uniqueModelIds(selectedProviderSettings?.imageModels || []).map((modelId) => ({ id: modelId, category: 'image' as const })),
    chat: uniqueModelIds(selectedProviderSettings?.chatModels || []).map((modelId) => ({ id: modelId, category: 'chat' as const })),
  }), [selectedProviderSettings]);

  const loadProviderSettings = useCallback(async () => {
    const requestId = providerSettingsLoadRequestIdRef.current + 1;
    providerSettingsLoadRequestIdRef.current = requestId;
    setProviderSettingsLoading(true);
    setProviderSettingsError(null);

    try {
      const response = await fetch('/api/settings/providers', {
        cache: 'no-store',
      });
      const data = (await response.json().catch(() => null)) as ProviderSettingsResponse | { error?: string } | null;
      if (!response.ok || !data || typeof data !== 'object' || !('providers' in data)) {
        throw new Error(
          data && typeof data === 'object' && 'error' in data && typeof data.error === 'string'
            ? data.error
            : '加载供应商配置失败'
        );
      }

      if (providerSettingsLoadRequestIdRef.current !== requestId) {
        return;
      }
      applyProviderSettingsResponse(data);
      setProviderSettingsLoaded(true);
    } catch (error) {
      if (providerSettingsLoadRequestIdRef.current !== requestId) {
        return;
      }
      setProviderSettingsError(error instanceof Error ? error.message : '加载供应商配置失败');
    } finally {
      if (providerSettingsLoadRequestIdRef.current === requestId) {
        setProviderSettingsLoading(false);
      }
    }
  }, [applyProviderSettingsResponse]);

  const openProviderSettingsModal = useCallback(() => {
    setShowHistoryPanel(false);
    setShowGeneratedImageHistoryPanel(false);
    setShowProviderSettingsModal(true);
    void loadProviderSettings();
  }, [loadProviderSettings]);

  useEffect(() => {
    void loadProviderSettings();
  }, [loadProviderSettings]);

  const closeProviderSettingsModal = useCallback(() => {
    setShowProviderSettingsModal(false);
    setProviderSettingsApiKey('');
    setProviderSettingsImageApiKeys(normalizeProviderSettingsImageApiKeyRows());
    setProviderSettingsError(null);
    setProviderSettingsLoading(false);
    setProviderSettingsSaving(false);
    setProviderSettingsTesting(false);
    setProviderSettingsTestResult(null);
    setProviderSettingsFetchedModels(null);
    setProviderSettingsModelPickerOpen(false);
    setProviderSettingsModelPickerCategory('all');
    setProviderSettingsModelPickerSearch('');
    setProviderSettingsSelectedFetchedModels({});
    setProviderSettingsFetchedModelCategoryById({});
    setProviderSettingsEditableProviderIds([]);
    setIsProviderSettingsApiKeyVisible(false);
  }, []);

  const handleProviderSettingsProviderChange = useCallback((nextProviderId: ProviderSettingsProviderId) => {
    const nextProvider = providerSettingsProviders.find((provider) => provider.id === nextProviderId);
    setProviderSettingsSelectedProviderId(nextProviderId);
    setProviderSettingsApiKey(nextProvider?.apiKey || '');
    setProviderSettingsImageApiKeys(normalizeProviderSettingsImageApiKeyRows(nextProvider?.imageApiKeys));
    setProviderSettingsError(null);
    setProviderSettingsTestResult(null);
    setProviderSettingsFetchedModels(null);
    setProviderSettingsModelPickerOpen(false);
    setProviderSettingsModelPickerCategory('all');
    setProviderSettingsModelPickerSearch('');
    setProviderSettingsSelectedFetchedModels({});
    setProviderSettingsFetchedModelCategoryById({});
    setIsProviderSettingsApiKeyVisible(false);
  }, [providerSettingsProviders]);

  const updateSelectedProviderSettings = useCallback((updater: (provider: ProviderSettingsItem) => ProviderSettingsItem) => {
    setProviderSettingsProviders((prev) =>
      prev.map((provider) =>
        provider.id === providerSettingsSelectedProviderId ? updater(provider) : provider
      )
    );
  }, [providerSettingsSelectedProviderId]);

  const updateProviderSettingsImageApiKeyRows = useCallback((updater: (rows: ProviderSettingsImageApiKeyRow[]) => ProviderSettingsImageApiKeyRow[]) => {
    setProviderSettingsImageApiKeys((prev) => {
      const nextRows = updater(prev);
      updateSelectedProviderSettings((provider) => ({
        ...provider,
        imageApiKeys: persistProviderSettingsImageApiKeys(nextRows),
      }));
      return nextRows;
    });
  }, [updateSelectedProviderSettings]);

  const handleProviderSettingsAddImageApiKey = useCallback(() => {
    updateProviderSettingsImageApiKeyRows((rows) => [
      ...rows,
      {
        ...createProviderSettingsImageApiKeyRow(),
        isVisible: true,
      },
    ]);
  }, [updateProviderSettingsImageApiKeyRows]);

  const handleProviderSettingsRemoveImageApiKey = useCallback((rowId: string) => {
    updateProviderSettingsImageApiKeyRows((rows) => {
      const nextRows = rows.filter((row) => row.id !== rowId);
      return nextRows.length > 0 ? nextRows : normalizeProviderSettingsImageApiKeyRows();
    });
  }, [updateProviderSettingsImageApiKeyRows]);

  const handleProviderSettingsAddProvider = useCallback(() => {
    const nextDraftProvider = createProviderSettingsDraftProvider(providerSettingsProviders);
    setProviderSettingsProviders((prev) => [...prev, nextDraftProvider]);
    setProviderSettingsEditableProviderIds((prev) => [...prev, nextDraftProvider.id]);
    setProviderSettingsSelectedProviderId(nextDraftProvider.id);
    setProviderSettingsApiKey('');
    setProviderSettingsImageApiKeys(normalizeProviderSettingsImageApiKeyRows());
    setProviderSettingsError(null);
    setProviderSettingsTestResult(null);
    setProviderSettingsFetchedModels(null);
    setProviderSettingsModelPickerOpen(false);
    setProviderSettingsModelPickerCategory('all');
    setProviderSettingsModelPickerSearch('');
    setProviderSettingsSelectedFetchedModels({});
    setProviderSettingsFetchedModelCategoryById({});
    setIsProviderSettingsApiKeyVisible(true);
  }, [providerSettingsProviders]);

  const handleProviderSettingsDeleteProvider = useCallback((providerId: ProviderSettingsProviderId) => {
    if (providerId === 'comfly') return;

    const remainingProviders = providerSettingsProviders.filter((provider) => provider.id !== providerId);
    const deletedProviderIndex = providerSettingsProviders.findIndex((provider) => provider.id === providerId);
    const nextSelectedProvider =
      remainingProviders[Math.min(deletedProviderIndex, remainingProviders.length - 1)] ||
      remainingProviders[remainingProviders.length - 1] ||
      null;
    const providerDeletionFallbacks = resolveProviderDeletionFallbacks({
      deletedProviderId: providerId,
      remainingProviders,
      textCardProviderById,
      imageCardProviderById,
      imageCardSizeById,
      imageCardAspectRatioById,
      imageCardQualityById,
      textFallbackOptions: TEXT_PANEL_MODEL_OPTIONS,
      imageFallbackOptions: IMAGE_CARD_MODEL_OPTIONS,
      defaultTextModelId: defaultWorkspaceTextModelOption.id,
      defaultImageModelId: defaultWorkspaceImageModelOption.id,
      defaultImageSizeId: IMAGE_CARD_SIZE_OPTIONS[0].id,
      defaultImageQualityId: IMAGE_CARD_QUALITY_OPTIONS[0].id,
      providerImageOptionProfiles,
      getProviderLabel: getProviderSettingsProviderLabel,
    });

    setProviderSettingsProviders((prev) => prev.filter((provider) => provider.id !== providerId));
    setProviderSettingsEditableProviderIds((prev) => prev.filter((id) => id !== providerId));
    setProviderSettingsSelectedProviderId(nextSelectedProvider?.id || 'comfly');
    setProviderSettingsApiKey(nextSelectedProvider?.apiKey || '');
    setProviderSettingsImageApiKeys(normalizeProviderSettingsImageApiKeyRows(nextSelectedProvider?.imageApiKeys));
    setProviderSettingsError(null);
    setProviderSettingsTestResult(null);
    setProviderSettingsFetchedModels(null);
    setProviderSettingsModelPickerOpen(false);
    setProviderSettingsModelPickerCategory('all');
    setProviderSettingsModelPickerSearch('');
    setProviderSettingsSelectedFetchedModels({});
    setProviderSettingsFetchedModelCategoryById({});
    setIsProviderSettingsApiKeyVisible(false);

    setTextCardProviderById((prev) => {
      const next = { ...prev };
      let changed = false;
      for (const [itemId, currentProviderId] of Object.entries(prev)) {
        if (currentProviderId !== providerId) continue;
        changed = true;
        if (providerDeletionFallbacks.fallbackTextProvider) {
          next[itemId] = providerDeletionFallbacks.textProviderByItemId[itemId];
        } else {
          delete next[itemId];
        }
      }
      return changed ? next : prev;
    });
    setTextCardModelById((prev) => {
      const next = { ...prev };
      let changed = false;
      for (const [itemId, currentProviderId] of Object.entries(textCardProviderById)) {
        if (currentProviderId !== providerId) continue;
        changed = true;
        if (providerDeletionFallbacks.fallbackTextProvider) {
          next[itemId] = providerDeletionFallbacks.textModelByItemId[itemId];
        } else {
          delete next[itemId];
        }
      }
      return changed ? next : prev;
    });

    setImageCardProviderById((prev) => {
      const next = { ...prev };
      let changed = false;
      for (const [itemId, currentProviderId] of Object.entries(prev)) {
        if (currentProviderId !== providerId) continue;
        changed = true;
        if (providerDeletionFallbacks.fallbackImageProvider) {
          next[itemId] = providerDeletionFallbacks.imageProviderByItemId[itemId];
        } else {
          delete next[itemId];
        }
      }
      return changed ? next : prev;
    });
    setImageCardModelById((prev) => {
      if (!providerDeletionFallbacks.fallbackImageProvider) return prev;
      const next = { ...prev };
      let changed = false;
      for (const [itemId, currentProviderId] of Object.entries(imageCardProviderById)) {
        if (currentProviderId !== providerId) continue;
        next[itemId] = providerDeletionFallbacks.imageModelByItemId[itemId];
        changed = true;
      }
      return changed ? next : prev;
    });
    setImageCardSizeById((prev) => {
      if (!providerDeletionFallbacks.fallbackImageProvider) return prev;
      const next = { ...prev };
      let changed = false;
      for (const [itemId, currentProviderId] of Object.entries(imageCardProviderById)) {
        if (currentProviderId !== providerId) continue;
        next[itemId] = providerDeletionFallbacks.imageSizeByItemId[itemId];
        changed = true;
      }
      return changed ? next : prev;
    });
    setImageCardAspectRatioById((prev) => {
      if (!providerDeletionFallbacks.fallbackImageProvider) return prev;
      const next = { ...prev };
      let changed = false;
      for (const [itemId, currentProviderId] of Object.entries(imageCardProviderById)) {
        if (currentProviderId !== providerId) continue;
        next[itemId] = providerDeletionFallbacks.imageAspectRatioByItemId[itemId];
        changed = true;
      }
      return changed ? next : prev;
    });
    setImageCardQualityById((prev) => {
      if (!providerDeletionFallbacks.fallbackImageProvider) return prev;
      const next = { ...prev };
      let changed = false;
      for (const [itemId, currentProviderId] of Object.entries(imageCardProviderById)) {
        if (currentProviderId !== providerId) continue;
        next[itemId] = providerDeletionFallbacks.imageQualityByItemId[itemId];
        changed = true;
      }
      return changed ? next : prev;
    });
    setItems((prev) =>
      !providerDeletionFallbacks.fallbackImageProvider
        ? prev
        : prev.map((item) => {
            if (!isImageCardItem(item)) return item;
            if (imageCardProviderById[item.id] !== providerId) return item;
            return resizeImageCardItemToAspectRatio(item, providerDeletionFallbacks.imageAspectRatioByItemId[item.id]);
          })
    );
  }, [
    defaultWorkspaceTextModelOption.id,
    defaultWorkspaceImageModelOption.id,
    imageCardAspectRatioById,
    imageCardProviderById,
    imageCardQualityById,
    imageCardSizeById,
    providerImageOptionProfiles,
    providerSettingsProviders,
    setTextCardModelById,
    setTextCardProviderById,
    setImageCardModelById,
    setImageCardAspectRatioById,
    setImageCardProviderById,
    setImageCardQualityById,
    setImageCardSizeById,
    setItems,
    textCardProviderById,
  ]);

  const handleProviderSettingsSave = useCallback(async () => {
    setProviderSettingsSaving(true);
    setProviderSettingsError(null);

    try {
      const nextProviders = providerSettingsProviders.map((provider) => ({
        id: provider.id,
        name: provider.name,
        baseUrl: provider.baseUrl,
        protocol: provider.protocol,
        imageRequestMode: provider.imageRequestMode,
        imageGenerationEndpoint: provider.imageGenerationEndpoint,
        imageEditEndpoint: provider.imageEditEndpoint,
        enabled: provider.enabled,
        primary: provider.primary,
        imageModels: provider.imageModels,
        chatModels: provider.chatModels,
        modelProtocols: provider.modelProtocols,
        apiKey: provider.id === providerSettingsSelectedProviderId ? providerSettingsApiKey : provider.apiKey,
        imageApiKeys: provider.id === providerSettingsSelectedProviderId
          ? persistProviderSettingsImageApiKeys(providerSettingsImageApiKeys)
          : provider.imageApiKeys,
      }));
      const response = await fetch('/api/settings/providers', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          providers: nextProviders,
        }),
      });
      const data = (await response.json().catch(() => null)) as ProviderSettingsResponse | { error?: string } | null;
      if (!response.ok || !data || typeof data !== 'object' || !('providers' in data)) {
        throw new Error(
          data && typeof data === 'object' && 'error' in data && typeof data.error === 'string'
            ? data.error
            : '保存供应商配置失败'
        );
      }

      applyProviderSettingsResponse(data);
      setShowProviderSettingsModal(false);
      showImageToolbarNoticeWithTimeout('供应商配置已保存', 2200);
    } catch (error) {
      setProviderSettingsError(error instanceof Error ? error.message : '保存供应商配置失败');
    } finally {
      setProviderSettingsSaving(false);
    }
  }, [
    applyProviderSettingsResponse,
    providerSettingsApiKey,
    providerSettingsImageApiKeys,
    providerSettingsProviders,
    providerSettingsSelectedProviderId,
    showImageToolbarNoticeWithTimeout,
  ]);

  const handleProviderSettingsTestConnection = useCallback(async () => {
    if (!selectedProviderSettings) return;
    if (!selectedProviderSettings.hasApiKey && providerSettingsApiKey.trim().length === 0) {
      setProviderSettingsError('请先填写或保存 API Key');
      setProviderSettingsTestResult({
        ok: false,
        status: 400,
        message: '连接失败：请先填写或保存 API Key',
        modelCount: 0,
        imageModels: [],
        chatModels: [],
        imageRequestMode: selectedProviderSettings.imageRequestMode,
      });
      return;
    }

    setProviderSettingsTesting(true);
    setProviderSettingsError(null);
    setProviderSettingsTestResult(null);

    try {
      const response = await fetch('/api/settings/providers/test-connection', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          providerId: selectedProviderSettings.id,
          baseUrl: selectedProviderSettings.baseUrl,
          protocol: selectedProviderSettings.protocol,
          imageRequestMode: selectedProviderSettings.imageRequestMode,
          apiKey: providerSettingsApiKey,
        }),
      });
      const data = (await response.json().catch(() => null)) as ProviderConnectionTestResult | { error?: string } | null;
      if (!response.ok || !data || typeof data !== 'object' || !('ok' in data)) {
        throw new Error(
          data && typeof data === 'object' && 'error' in data && typeof data.error === 'string'
            ? data.error
            : '连接测试失败'
        );
      }

      setProviderSettingsTestResult(data);
      if (data.ok) {
        updateSelectedProviderSettings((provider) => ({
          ...provider,
          apiKey: providerSettingsApiKey,
          hasApiKey: providerSettingsApiKey.trim().length > 0 || provider.hasApiKey,
          maskedApiKey: maskProviderSettingsApiKeyForDisplay(providerSettingsApiKey) || provider.maskedApiKey,
          imageRequestMode: data.imageRequestMode,
        }));
      }
    } catch (error) {
      setProviderSettingsError(error instanceof Error ? error.message : '连接测试失败');
    } finally {
      setProviderSettingsTesting(false);
    }
  }, [providerSettingsApiKey, selectedProviderSettings, updateSelectedProviderSettings]);

  const handleProviderSettingsFetchModels = useCallback(async () => {
    if (!selectedProviderSettings) return;
    const imageApiKeys = persistProviderSettingsImageApiKeys(providerSettingsImageApiKeys);
    if (!selectedProviderSettings.hasApiKey && providerSettingsApiKey.trim().length === 0 && imageApiKeys.length === 0) {
      setProviderSettingsError('请先填写或保存 API Key 或生图 API Key');
      setProviderSettingsTestResult({
        ok: false,
        status: 400,
        message: '连接失败：请先填写或保存 API Key 或生图 API Key',
        modelCount: 0,
        imageModels: [],
        chatModels: [],
        imageRequestMode: selectedProviderSettings.imageRequestMode,
      });
      return;
    }

    setProviderSettingsFetchingModels(true);
    setProviderSettingsError(null);
    setProviderSettingsModelPickerOpen(false);

    try {
      const response = await fetch('/api/settings/providers/fetch-models', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          providerId: selectedProviderSettings.id,
          baseUrl: selectedProviderSettings.baseUrl,
          protocol: selectedProviderSettings.protocol,
          imageRequestMode: selectedProviderSettings.imageRequestMode,
          apiKey: providerSettingsApiKey,
          imageApiKeys,
        }),
      });
      const data = (await response.json().catch(() => null)) as ProviderFetchedModelsResult | { error?: string } | null;
      if (!response.ok || !data || typeof data !== 'object' || !('ok' in data)) {
        throw new Error(
          data && typeof data === 'object' && 'error' in data && typeof data.error === 'string'
            ? data.error
            : '拉取模型失败'
        );
      }
      if (!data.ok) {
        throw new Error(data.message || '拉取模型失败');
      }

      const imageModels = uniqueModelIds(data.imageModels);
      const chatModels = uniqueModelIds(data.chatModels);
      const configuredImageModels = uniqueModelIds(selectedProviderSettings.imageModels);
      const configuredChatModels = uniqueModelIds(selectedProviderSettings.chatModels);
      const allModels = uniqueModelIds([
        ...data.allModels,
        ...configuredImageModels,
        ...configuredChatModels,
      ]);
      const categoryById = allModels.reduce<Record<string, 'image' | 'chat'>>((result, modelId) => {
        if (configuredImageModels.includes(modelId) || imageModels.includes(modelId)) {
          result[modelId] = 'image';
        } else {
          result[modelId] = 'chat';
        }
        return result;
      }, {});
      const selectedById = allModels.reduce<Record<string, boolean>>((result, modelId) => {
        result[modelId] = configuredImageModels.includes(modelId) || configuredChatModels.includes(modelId);
        return result;
      }, {});

      setProviderSettingsFetchedModels({
        ...data,
        allModels,
        imageModels,
        chatModels,
      });
      setProviderSettingsFetchedModelCategoryById(categoryById);
      setProviderSettingsSelectedFetchedModels(selectedById);
      setProviderSettingsModelPickerCategory('all');
      setProviderSettingsModelPickerSearch('');
      setProviderSettingsModelPickerOpen(true);
      setProviderSettingsTestResult({
        ok: true,
        status: data.status,
        message: data.message || `拉取成功，找到 ${allModels.length} 个模型`,
        modelCount: allModels.length,
        imageModels,
        chatModels,
        imageRequestMode: data.imageRequestMode,
      });
      updateSelectedProviderSettings((provider) => ({
        ...provider,
        apiKey: providerSettingsApiKey,
        hasApiKey: providerSettingsApiKey.trim().length > 0 || provider.hasApiKey,
        maskedApiKey: maskProviderSettingsApiKeyForDisplay(providerSettingsApiKey) || provider.maskedApiKey,
        imageRequestMode: data.imageRequestMode,
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : '拉取模型失败';
      setProviderSettingsError(message);
      setProviderSettingsTestResult({
        ok: false,
        status: 0,
        message,
        modelCount: 0,
        imageModels: [],
        chatModels: [],
        imageRequestMode: selectedProviderSettings.imageRequestMode,
      });
    } finally {
      setProviderSettingsFetchingModels(false);
    }
  }, [providerSettingsApiKey, providerSettingsImageApiKeys, selectedProviderSettings, updateSelectedProviderSettings]);

  const handleProviderSettingsApplyFetchedModels = useCallback(() => {
    if (!selectedProviderSettings || !providerSettingsFetchedModels) return;
    const selectedModels = Object.entries(providerSettingsSelectedFetchedModels)
      .filter(([, isSelected]) => isSelected)
      .map(([modelId]) => modelId);
    const nextImageModels = selectedModels.filter(
      (modelId) => getFetchedModelCategory(modelId, providerSettingsFetchedModels, providerSettingsFetchedModelCategoryById) === 'image'
    );
    const nextChatModels = selectedModels.filter(
      (modelId) => getFetchedModelCategory(modelId, providerSettingsFetchedModels, providerSettingsFetchedModelCategoryById) === 'chat'
    );

    updateSelectedProviderSettings((provider) => ({
      ...provider,
      imageModels: nextImageModels,
      chatModels: nextChatModels,
      modelProtocols: normalizeProviderSettingsModelProtocols(provider.modelProtocols, [
        ...nextImageModels,
        ...nextChatModels,
      ]),
    }));
    setProviderSettingsModelPickerOpen(false);
    setProviderSettingsTestResult({
      ok: true,
      status: 200,
      message: `已应用选择：图片 ${nextImageModels.length} 个，聊天 ${nextChatModels.length} 个；点击保存后写入本地`,
      modelCount: nextImageModels.length + nextChatModels.length,
      imageModels: nextImageModels,
      chatModels: nextChatModels,
      imageRequestMode: selectedProviderSettings.imageRequestMode,
    });
  }, [
    providerSettingsFetchedModelCategoryById,
    providerSettingsFetchedModels,
    providerSettingsSelectedFetchedModels,
    selectedProviderSettings,
    updateSelectedProviderSettings,
  ]);

  const handleProviderSettingsRemoveModel = useCallback((category: 'image' | 'chat', modelId: string) => {
    updateSelectedProviderSettings((provider) => ({
      ...provider,
      imageModels: category === 'image' ? provider.imageModels.filter((id) => id !== modelId) : provider.imageModels,
      chatModels: category === 'chat' ? provider.chatModels.filter((id) => id !== modelId) : provider.chatModels,
      modelProtocols: Object.fromEntries(
        Object.entries(provider.modelProtocols).filter(([protocolModelId]) => protocolModelId !== modelId)
      ) as Record<string, ProviderProtocol>,
    }));
    setProviderSettingsSelectedFetchedModels((prev) => {
      if (!(modelId in prev)) return prev;
      return {
        ...prev,
        [modelId]: false,
      };
    });
  }, [updateSelectedProviderSettings]);

  const handleProviderSettingsModelProtocolChange = useCallback((modelId: string, protocol: ProviderProtocol | '') => {
    updateSelectedProviderSettings((provider) => {
      const nextModelProtocols = { ...provider.modelProtocols };
      if (protocol) {
        nextModelProtocols[modelId] = protocol;
      } else {
        delete nextModelProtocols[modelId];
      }
      return {
        ...provider,
        modelProtocols: nextModelProtocols,
      };
    });
  }, [updateSelectedProviderSettings]);

  const handleImageToolbarAction = useCallback(async (actionId: (typeof IMAGE_NODE_TOOLBAR_ACTIONS)[number]['id']) => {
    if (!selectedImageToolbarTarget?.src) return;

    if (actionId === 'export') {
      showImageToolbarNoticeWithTimeout('导出中…');

      try {
        const response = await fetch(`/api/image-tools/export?src=${encodeURIComponent(selectedImageToolbarTarget.src)}`);
        if (!response.ok) {
          const data = await response.json().catch(() => null);
          throw new Error(
            (data && typeof data.error === 'string' && data.error) ||
              `导出失败: ${response.status}`
          );
        }

        const blob = await response.blob();
        const fileName =
          getDownloadFileNameFromDisposition(response.headers.get('Content-Disposition')) ||
          getFallbackImageDownloadName(selectedImageToolbarTarget.src);
        const downloadUrl = URL.createObjectURL(blob);
        const link = document.createElement('a');

        link.href = downloadUrl;
        link.download = fileName;
        link.style.display = 'none';
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(downloadUrl);

        showImageToolbarNoticeWithTimeout('导出完成', 2200);
      } catch (error) {
        console.error('Image export failed:', error);
        showImageToolbarNoticeWithTimeout('导出失败', 2800);
      }

      return;
    }

    if (actionId !== 'cutout') return;

    showImageToolbarNoticeWithTimeout('抠图中…');

    try {
      const response = await fetch('/api/image-tools/remove-background', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          imageUrl: selectedImageToolbarTarget.src,
          sourceItemId: selectedImageToolbarTarget.itemId,
        }),
      });

      const data = await response.json().catch(() => null);
      if (!response.ok || !data || typeof data.url !== 'string' || data.url.length === 0) {
        throw new Error(
          (data && typeof data.error === 'string' && data.error) ||
            `抠图失败: ${response.status}`
        );
      }

      await addBackgroundRemovedImageToCanvas({
        src: data.url,
        naturalWidth:
          Number.isFinite(data.naturalWidth) && data.naturalWidth > 0 ? data.naturalWidth : undefined,
        naturalHeight:
          Number.isFinite(data.naturalHeight) && data.naturalHeight > 0 ? data.naturalHeight : undefined,
        sourceItemId: selectedImageToolbarTarget.itemId,
      });

      showImageToolbarNoticeWithTimeout('抠图完成', 2200);
    } catch (error) {
      console.error('Background removal failed:', error);
      showImageToolbarNoticeWithTimeout('抠图失败', 2800);
    }
  }, [addBackgroundRemovedImageToCanvas, selectedImageToolbarTarget, showImageToolbarNoticeWithTimeout]);

  const handleLeftRailItemClick = useCallback((itemId: (typeof LEFT_RAIL_ITEMS)[number]['id']) => {
    if (itemId === 'history') {
      setShowProviderSettingsModal(false);
      setShowGeneratedImageHistoryPanel((prev) => !prev);
      return;
    }
    if (itemId === 'theme') {
      return;
    }
    if (itemId === 'settings') {
      openProviderSettingsModal();
    }
  }, [openProviderSettingsModal]);

  const handlePendingConnectionMenuAction = useCallback(
    (optionId: (typeof CONNECTION_MENU_OPTIONS)[number]['id']) => {
      if (!pendingConnectionMenu) return;

      if (optionId !== 'text' && optionId !== 'image') {
        clearPendingConnectionMenu();
        return;
      }

      const spawnPoint = toCanvasPoint(pendingConnectionMenu.position);
      recordCurrentCanvasUndoSnapshot();
      const newItem =
        optionId === 'image'
          ? createImageCardItemAtCanvasPoint(spawnPoint)
          : createTextItemAtCanvasPoint(spawnPoint);

      setConnections((prev) => [
        ...prev,
        {
          id: `conn-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          fromItemId: pendingConnectionMenu.fromItemId,
          toItemId: newItem.id,
        },
      ]);

      clearPendingConnectionMenu();
    },
    [pendingConnectionMenu, toCanvasPoint, createImageCardItemAtCanvasPoint, createTextItemAtCanvasPoint, clearPendingConnectionMenu, recordCurrentCanvasUndoSnapshot, setConnections]
  );

  const isEditableUndoRedoTarget = (target: EventTarget | null) => {
    const resolvedTarget =
      target instanceof Node && target.nodeType === Node.TEXT_NODE
        ? target.parentElement
        : target;

    if (resolvedTarget instanceof HTMLInputElement || resolvedTarget instanceof HTMLTextAreaElement) {
      return true;
    }

    if (!(resolvedTarget instanceof HTMLElement)) {
      return false;
    }

    if (resolvedTarget.isContentEditable) {
      return true;
    }

    return !!resolvedTarget.closest('[contenteditable="true"]');
  };

  const hasActiveNonEditableTextSelection = useCallback(() => {
    const isEditableSelectionTarget = (target: EventTarget | null) => {
      const resolvedTarget =
        target instanceof Node && target.nodeType === Node.TEXT_NODE
          ? target.parentElement
          : target;

      if (resolvedTarget instanceof HTMLInputElement || resolvedTarget instanceof HTMLTextAreaElement) {
        return true;
      }

      if (!(resolvedTarget instanceof HTMLElement)) {
        return false;
      }

      if (resolvedTarget.isContentEditable) {
        return true;
      }

      return !!resolvedTarget.closest('[contenteditable="true"]');
    };

    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return false;

    if (hasActiveAssistantTextSelection()) {
      return true;
    }

    const selectedText = selection.toString();
    if (!selectedText.trim()) {
      return false;
    }

    return !isEditableSelectionTarget(selection.anchorNode) && !isEditableSelectionTarget(selection.focusNode);
  }, [hasActiveAssistantTextSelection]);

  const copySelectedCanvasItemsToClipboard = useCallback(() => {
    const snapshot = createCanvasClipboardSnapshot({
      items: itemsRef.current,
      selectedIds,
      textCardPanelDrafts,
      textCardProviderById,
      textCardModelById,
      imageCardPanelDrafts,
      imageCardProviderById,
      imageCardModelById,
      imageCardSizeById,
      imageCardQualityById,
      imageCardCountById,
      imageCardAspectRatioById,
    }) as CanvasClipboardSnapshot | null;

    if (!snapshot) {
      return false;
    }

    canvasClipboardRef.current = {
      snapshot,
      pasteCount: 0,
    };
    return true;
  }, [
    imageCardProviderById,
    imageCardAspectRatioById,
    imageCardCountById,
    imageCardModelById,
    imageCardPanelDrafts,
    imageCardQualityById,
    imageCardSizeById,
    selectedIds,
    textCardModelById,
    textCardProviderById,
    textCardPanelDrafts,
  ]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isEditableUndoRedoTarget(e.target)) return;

      if ((e.metaKey || e.ctrlKey) && (e.key === '+' || e.key === '=')) {
        e.preventDefault();
        applyViewportScale(visualViewportRef.current.scale + 0.1);
        return;
      }

      if ((e.metaKey || e.ctrlKey) && e.key === '-') {
        e.preventDefault();
        applyViewportScale(visualViewportRef.current.scale - 0.1);
        return;
      }

      if (e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey && e.code === 'Digit1') {
        e.preventDefault();
        fitCanvasItemsToViewport();
        return;
      }

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        const isRedoShortcut = e.shiftKey || (!e.metaKey && e.ctrlKey && e.key.toLowerCase() === 'y');
        if (isRedoShortcut) {
          redoCanvasEdit();
        } else {
          undoCanvasEdit();
        }
        return;
      }

      if (!e.metaKey && e.ctrlKey && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        redoCanvasEdit();
        return;
      }

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'c') {
        if (hasActiveNonEditableTextSelection()) {
          return;
        }

        if (selectedIds.length === 0) {
          return;
        }

        if (copySelectedCanvasItemsToClipboard()) {
          e.preventDefault();
        }
        return;
      }

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'v') {
        if (hasActiveNonEditableTextSelection()) {
          return;
        }

        if (!canvasClipboardRef.current?.snapshot) {
          return;
        }
      }

      if (e.code === 'Space') {
        e.preventDefault();
        setIsSpacePressed(true);
        return;
      }

      if (e.key === 'Escape') {
        if (tool !== 'select' || draftStrokeRef.current) {
          draftStrokeRef.current = null;
          setDraftStroke(null);
          setTool('select');
          return;
        }
        if (connectionSessionRef.current) {
          resetConnectionInteraction();
          return;
        }
        if (pendingConnectionMenu) {
          clearPendingConnectionMenu();
          return;
        }
      }

      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedIds.length > 0 || selectedConnectionIds.length > 0) {
          const idsToDelete = [...selectedIds];
          const connectionIdsToDelete = new Set(selectedConnectionIds);
          recordCurrentCanvasUndoSnapshot();
          setItems(prev => prev.filter(item => !idsToDelete.includes(item.id)));
          setConnections((prev) =>
            prev.filter(
              (connection) =>
                !connectionIdsToDelete.has(connection.id) &&
                !idsToDelete.includes(connection.fromItemId) &&
                !idsToDelete.includes(connection.toItemId)
            )
          );
          setSelectedIds([]);
          setSelectedId(null);
          setSelectedConnectionIds([]);
          return;
        }

        if (selectedId) deleteItem(selectedId);
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        e.preventDefault();
        setIsSpacePressed(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [selectedId, selectedIds, connectionPointerId, selectedConnectionIds, pendingConnectionMenu, applyViewportScale, clearPendingConnectionMenu, copySelectedCanvasItemsToClipboard, deleteItem, fitCanvasItemsToViewport, hasActiveNonEditableTextSelection, recordCurrentCanvasUndoSnapshot, redoCanvasEdit, resetConnectionInteraction, setConnections, setItems, tool, undoCanvasEdit]);

  useEffect(() => {
    const handleWindowPaste = (e: ClipboardEvent) => {
      if (e.defaultPrevented) return;
      if (!shouldHandleCanvasImagePaste(e.target)) return;
      void handleCanvasPaste(e);
    };

    window.addEventListener('paste', handleWindowPaste);
    return () => {
      window.removeEventListener('paste', handleWindowPaste);
    };
  }, [handleCanvasPaste]);

  useEffect(() => {
    if (!pendingConnectionMenu) return;

    const handlePointerDownOutsideMenu = (e: PointerEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest('[data-connection-create-menu="true"]')) return;
      clearPendingConnectionMenu();
    };

    document.addEventListener('pointerdown', handlePointerDownOutsideMenu);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDownOutsideMenu);
    };
  }, [pendingConnectionMenu, clearPendingConnectionMenu]);

  useEffect(() => {
    const handlePointerDownOutside = (e: PointerEvent) => {
      if (editingSessionId) return;
      const now = Date.now();
      const selectionSession = assistantTextSelectionRef.current;
      const targetNode = e.target as Node | null;
      if (
        now < selectionSession.suppressOutsideClickUntil ||
        (isNodeInsideAssistantSelectable(targetNode) &&
          (selectionSession.startedInAssistant || hasActiveAssistantTextSelection()))
      ) {
        return;
      }
      if (projectMenuRef.current && !projectMenuRef.current.contains(e.target as Node)) {
        setShowProjectMenu(false);
      }
      if (addNodeMenuRef.current && !addNodeMenuRef.current.contains(e.target as Node)) {
        setShowAddNodeMenu(false);
      }
      if (generatedImageHistoryPanelRef.current && !generatedImageHistoryPanelRef.current.contains(e.target as Node)) {
        setShowGeneratedImageHistoryPanel(false);
      }
      if (generationModeMenuRef.current && !generationModeMenuRef.current.contains(e.target as Node)) {
        setShowGenerationModeMenu(false);
      }
      if (chatModelSelectorRef.current && !chatModelSelectorRef.current.contains(e.target as Node)) {
        setShowChatModelSelector(false);
      }
      if (imageModelSelectorRef.current && !imageModelSelectorRef.current.contains(e.target as Node)) {
        setShowImageModelSelector(false);
      }
      if (skillsMenuRef.current && !skillsMenuRef.current.contains(e.target as Node)) {
        setShowSkillsMenu(false);
      }
      if (chatComposerMoreMenuRef.current && !chatComposerMoreMenuRef.current.contains(e.target as Node)) {
        setShowChatComposerMoreMenu(false);
      }
      if (chatAssetPickerRef.current && !chatAssetPickerRef.current.contains(e.target as Node)) {
        setShowChatAssetPicker(false);
        setSelectedChatHistoryAssetIds([]);
      }
      if (modelPreferenceContainerRef.current && !modelPreferenceContainerRef.current.contains(e.target as Node)) {
        setShowModelPreferencePopover(false);
      }
      if (textPanelProviderMenuRef.current && !textPanelProviderMenuRef.current.contains(e.target as Node)) {
        setShowTextPanelProviderMenu(false);
      }
      if (textPanelModelMenuRef.current && !textPanelModelMenuRef.current.contains(e.target as Node)) {
        setShowTextPanelModelMenu(false);
      }
      const isInsideImageCardProviderMenu =
        !!imageCardProviderMenuRef.current?.contains(e.target as Node) ||
        !!imageCardProviderPopoverRef.current?.contains(e.target as Node);
      if (!isInsideImageCardProviderMenu) {
        setShowImageCardProviderMenu(false);
      }
      const isInsideImageCardModelMenu =
        !!imageCardModelMenuRef.current?.contains(e.target as Node) ||
        !!imageCardModelPopoverRef.current?.contains(e.target as Node);
      if (!isInsideImageCardModelMenu) {
        setShowImageCardModelMenu(false);
      }
      const isInsideImageCardSettingsMenu =
        !!imageCardSettingsMenuRef.current?.contains(e.target as Node) ||
        !!imageCardSettingsPopoverRef.current?.contains(e.target as Node);
      if (!isInsideImageCardSettingsMenu) {
        setShowImageCardSettingsMenu(false);
      }
      setShowAvatarMenu(false);
      setShowHistoryPanel(false);
    };
    if (showAvatarMenu || showProjectMenu || showAddNodeMenu || showGeneratedImageHistoryPanel || showHistoryPanel || showGenerationModeMenu || showChatModelSelector || showImageModelSelector || showSkillsMenu || showChatComposerMoreMenu || showChatAssetPicker || showModelPreferencePopover || showTextPanelProviderMenu || showImageCardProviderMenu || showImageCardModelMenu || showImageCardSettingsMenu || showTextPanelModelMenu) {
      document.addEventListener('pointerdown', handlePointerDownOutside);
      return () => document.removeEventListener('pointerdown', handlePointerDownOutside);
    }
  }, [showAvatarMenu, showProjectMenu, showAddNodeMenu, showGeneratedImageHistoryPanel, showHistoryPanel, showGenerationModeMenu, showChatModelSelector, showImageModelSelector, showSkillsMenu, showChatComposerMoreMenu, showChatAssetPicker, showModelPreferencePopover, showTextPanelProviderMenu, showImageCardProviderMenu, showImageCardModelMenu, showImageCardSettingsMenu, showTextPanelModelMenu, editingSessionId, hasActiveAssistantTextSelection, isNodeInsideAssistantSelectable]);

  useEffect(() => {
    if (!showChatModelSelector && !showImageModelSelector && !showChatComposerMoreMenu && !showChatAssetPicker && !showModelPreferencePopover && !showSkillsMenu && !showGenerationModeMenu) return;
    const closeChatComposerPopoversOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      const restoreMoreButtonFocus = showChatComposerMoreMenu || showChatAssetPicker;
      const restoreModelButtonFocus = showModelPreferencePopover || showChatModelSelector || showImageModelSelector;
      closeChatComposerPopovers();
      setSelectedChatHistoryAssetIds([]);
      window.requestAnimationFrame(() => {
        if (restoreModelButtonFocus) {
          modelPreferenceButtonRef.current?.focus();
        } else if (restoreMoreButtonFocus) {
          chatComposerMoreButtonRef.current?.focus();
        }
      });
    };
    window.addEventListener('keydown', closeChatComposerPopoversOnEscape);
    return () => window.removeEventListener('keydown', closeChatComposerPopoversOnEscape);
  }, [closeChatComposerPopovers, showChatAssetPicker, showChatComposerMoreMenu, showChatModelSelector, showGenerationModeMenu, showImageModelSelector, showModelPreferencePopover, showSkillsMenu]);

  useEffect(() => {
    const handleSelectionChange = () => {
      const hasSelection = hasActiveAssistantTextSelection();
      assistantTextSelectionRef.current.hasSelection = hasSelection;

      if (hasSelection) {
        assistantTextSelectionRef.current.startedInAssistant = true;
        assistantTextSelectionRef.current.suppressOutsideClickUntil = Date.now() + 250;
        return;
      }

      assistantTextSelectionRef.current.startedInAssistant = false;
      assistantTextSelectionRef.current.suppressOutsideClickUntil = 0;
    };

    const handlePointerEnd = () => {
      assistantTextSelectionRef.current.isPointerDown = false;
      if (hasActiveAssistantTextSelection()) {
        assistantTextSelectionRef.current.hasSelection = true;
        assistantTextSelectionRef.current.startedInAssistant = true;
        assistantTextSelectionRef.current.suppressOutsideClickUntil = Date.now() + 300;
        return;
      }

      assistantTextSelectionRef.current.hasSelection = false;
      assistantTextSelectionRef.current.startedInAssistant = false;
      assistantTextSelectionRef.current.suppressOutsideClickUntil = 0;
    };

    document.addEventListener('selectionchange', handleSelectionChange);
    window.addEventListener('pointerup', handlePointerEnd);
    window.addEventListener('pointercancel', handlePointerEnd);

    return () => {
      document.removeEventListener('selectionchange', handleSelectionChange);
      window.removeEventListener('pointerup', handlePointerEnd);
      window.removeEventListener('pointercancel', handlePointerEnd);
    };
  }, [hasActiveAssistantTextSelection]);

  useEffect(() => {
    const shouldFollowLatest = isChatNearBottomRef.current;
    const frameId = window.requestAnimationFrame(() => {
      if (shouldFollowLatest) {
        scrollChatToBottom('auto');
      } else {
        updateChatNearBottomState();
      }
    });
    return () => window.cancelAnimationFrame(frameId);
  }, [chatMessages, scrollChatToBottom, updateChatNearBottomState]);

  useEffect(() => {
    const content = chatMessagesContentRef.current;
    if (!content || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      if (isChatNearBottomRef.current) {
        scrollChatToBottom('auto');
      } else {
        updateChatNearBottomState();
      }
    });
    observer.observe(content);
    return () => observer.disconnect();
  }, [chatMessages.length, scrollChatToBottom, updateChatNearBottomState]);

  useEffect(() => {
    isChatNearBottomRef.current = true;
    setIsChatNearBottom(true);
    const frameId = window.requestAnimationFrame(() => scrollChatToBottom('auto'));
    return () => window.cancelAnimationFrame(frameId);
  }, [currentSessionId, scrollChatToBottom]);

  useEffect(() => {
    if (lastSyncedChatInputRevisionRef.current === chatInputSyncRevision) return;
    if (isChatInputComposingRef.current) {
      pendingChatEditorSyncRef.current = true;
      return;
    }
    lastSyncedChatInputRevisionRef.current = chatInputSyncRevision;
    syncEditorTextFromState(latestChatInputRef.current);
  }, [chatInputSyncRevision, syncEditorTextFromState]);

  useEffect(() => {
    syncEditorTextFromState(latestChatInputRef.current);
  }, [resolvedChatReferenceTokens, syncEditorTextFromState]);

  useEffect(() => {
    syncEditorTextFromState(latestChatInputRef.current, true);
  }, [activeSkill?.id, syncEditorTextFromState]);

  useEffect(() => {
    if (!activeSkillJobId) return;

    const skillJobMessageId = activeSkillJobMessageIdRef.current;
    let stopped = false;
    let pollCount = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const pollOnce = async () => {
      if (stopped) return;

      try {
        const response = await fetch(`/api/skills/jobs?jobId=${activeSkillJobId}&t=${Date.now()}`, {
          cache: 'no-store',
        });
        if (!response.ok) {
          if (response.status === 404) {
            stopped = true;
            const errorPayload = await response.json().catch(() => ({}));
            const reason = typeof errorPayload?.error === 'string' ? errorPayload.error : '任务不存在';
            if (skillJobMessageId) {
              updateChatMessageById(skillJobMessageId, (msg) => ({
                ...updateAgentRunProgress(msg, { type: 'agent_error' }),
                content: `⚠️ 任务状态丢失（${reason}），请重新发起一次出图。`,
                taskStatus: 'failed',
              }));
            }
            setActiveSkillJobId(null);
            setActiveSkillJobType(null);
            setIsGenerating(false);
            activeSkillJobMessageIdRef.current = null;
            pendingAssistantMessageIdRef.current = null;
            return;
          }
          const nextDelay = pollCount < 10 ? 2000 : 5000;
          pollCount += 1;
          timer = setTimeout(pollOnce, nextDelay);
          return;
        }
        
        const data = await response.json();
        setActiveSkillJobStatus({
          completed: data.completed,
          failed: data.failed,
          total: data.total,
          items: data.items,
        });
        if (skillJobMessageId) {
          updateChatMessageById(skillJobMessageId, (msg) => updateAgentRunProgress(msg, {
            type: 'assets_progress',
            total: data.total,
            succeeded: data.completed,
            failed: data.failed,
          }));
        }

        const skillPrefix = `${activeSkillJobType || 'logo'}:`;
        const skillLabel = activeSkillJobType === 'brand' ? '品牌物料' : 'VI 素材';

        setChatMessages((prev) => prev.map((msg) => {
          if (!msg.taskKey?.startsWith(skillPrefix)) return msg;
          const key = msg.taskKey.replace(skillPrefix, '');
          const item = data.items.find((entry: { key?: string; component?: string }) => (entry.key || entry.component) === key);
          if (!item) return msg;

          if (item.status === 'completed' && item.localUrl) {
            return {
              ...msg,
              content: '',
              imageUrl: item.localUrl,
              taskStatus: 'completed',
              model: 'gemini-3.1-flash-image-preview',
            };
          }

          if (item.status === 'failed') {
            return {
              ...msg,
              content: `${item.name} 生成失败${item.error ? `: ${item.error}` : ''}`,
              taskStatus: 'failed',
            };
          }

          if (item.status === 'cancelled') {
            return {
              ...msg,
              content: `${item.name} 已终止`,
              taskStatus: 'cancelled',
            };
          }

          return {
            ...msg,
            content: `${item.name} 生成中...`,
            taskStatus: item.status === 'queued' ? 'queued' : 'running',
          };
        }));

        const completedItems = data.items.filter(
          (item: { key?: string; component?: string; status: string; localUrl?: string }) => item.status === 'completed' && item.localUrl
        );

        const historyTimestamp = Date.now();
        completedItems.forEach((item: { key?: string; component?: string; localUrl: string }, index: number) => {
          const itemKey = item.key || item.component || 'logo-item';
          if (processedSkillJobUrlsRef.current.has(item.localUrl)) return;
          processedSkillJobUrlsRef.current.add(item.localUrl);

          setImageCount((prev) => prev + 1);

          const img = new window.Image();
          img.crossOrigin = 'anonymous';
          img.onload = () => {
            const orderOffset = processedSkillJobUrlsRef.current.size - 1;
            const spawnPosition = getSpawnPosition(
              {
                width: getConstrainedImageDisplaySize(img.width, img.height).width,
                height: getConstrainedImageDisplaySize(img.width, img.height).height,
              },
              orderOffset
            );

            const newItem = createImageCanvasItem({
              id: `generated-${Date.now()}-${itemKey}`,
              src: item.localUrl,
              naturalWidth: img.width,
              naturalHeight: img.height,
              x: spawnPosition.x,
              y: spawnPosition.y,
            });
            appendGeneratedImageHistoryForSession(
              currentSessionIdRef.current,
              [
                createGeneratedImageHistoryEntry({
                  src: item.localUrl,
                  naturalWidth: img.width,
                  naturalHeight: img.height,
                  timestamp: historyTimestamp,
                  sequence: index,
                  source: 'chat',
                }),
              ]
            );
            recordCurrentCanvasUndoSnapshot();
            setItems(prev => [...prev, newItem]);
          };
          img.src = item.localUrl;
        });
        
        if (data.status === 'completed' || data.status === 'failed' || data.status === 'partial' || data.status === 'cancelled') {
          stopped = true;
          
          let summaryText = '';
          if (data.status === 'completed') {
            summaryText = `✅ 全部 ${data.total} 个${skillLabel}已生成完成！`;
          } else if (data.status === 'partial') {
            summaryText = `⚠️ 已完成 ${data.completed} 个，失败 ${data.failed} 个`;
          } else if (data.status === 'cancelled') {
            summaryText = `⏹️ 任务已终止，已完成 ${data.completed} 个`;
          } else {
            summaryText = `❌ 生成失败，请重试`;
          }
          
          if (skillJobMessageId) {
            updateChatMessageById(skillJobMessageId, (msg) => ({
              ...updateAgentRunProgress(msg, {
                type: 'assets_settled',
                succeeded: data.completed,
                failed: Math.max(data.failed, data.total - data.completed - data.failed),
              }),
              content: summaryText,
              taskStatus: data.status === 'failed' ? 'failed' : data.status === 'cancelled' ? 'cancelled' : 'completed',
            }));
          }
          setActiveSkillJobId(null);
          setActiveSkillJobType(null);
          setIsGenerating(false);
          activeSkillJobMessageIdRef.current = null;
          pendingAssistantMessageIdRef.current = null;
          return;
        }
        const nextDelay = pollCount < 10 ? 2000 : 5000;
        pollCount += 1;
        timer = setTimeout(pollOnce, nextDelay);
      } catch (error) {
        console.error('Skill job polling error:', error);
        const nextDelay = pollCount < 10 ? 2000 : 5000;
        pollCount += 1;
        timer = setTimeout(pollOnce, nextDelay);
      }
    };

    pollOnce();

    return () => {
      stopped = true;
      if (timer) {
        clearTimeout(timer);
      }
    };
  }, [
    activeSkillJobId,
    activeSkillJobType,
    appendGeneratedImageHistoryForSession,
    getSpawnPosition,
    recordCurrentCanvasUndoSnapshot,
    setChatMessages,
    setItems,
    updateChatMessageById,
  ]);

  const handleWorkspaceProfilerRender = useCallback((
    _id: string,
    _phase: 'mount' | 'update' | 'nested-update',
    actualDuration: number
  ) => {
    if (!canvasPerformanceEnabledRef.current) return;
    const now = performance.now();
    const samples = workspaceCommitPerformanceSamplesRef.current;
    if (samples.length >= 120) samples.shift();
    samples.push(actualDuration);
    const windowSample = workspaceCommitWindowRef.current;
    if (windowSample.startedAt === 0) windowSample.startedAt = now;
    windowSample.count += 1;
    const elapsed = now - windowSample.startedAt;
    if (elapsed < 1000) return;
    const sorted = [...samples].sort((left, right) => left - right);
    const p95 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] || 0;
    console.info('[workspace-commit-perf]', {
      commitsPerSecond: windowSample.count * 1000 / elapsed,
      commitDurationP95: p95,
      sampleCount: samples.length,
    });
    workspaceCommitWindowRef.current = { startedAt: now, count: 0 };
  }, []);

  const stableCanvasPointerDown = useStableEvent(handleCanvasPointerDown);
  const stableCanvasPointerMove = useStableEvent(handleCanvasPointerMove);
  const stableCanvasPointerUp = useStableEvent(handleCanvasPointerUp);
  const stableCanvasPointerLeave = useStableEvent(handleCanvasPointerLeave);
  const stableOutputPortPointerDown = useStableEvent(handleOutputPortPointerDown);
  const stableCanvasItemClick = useStableEvent(handleItemClick);
  const handlePendingMenuPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    event.stopPropagation();
  }, []);

  if (viewMode === 'gallery') {
    return (
      <>
        {sessionActionError && <SessionActionErrorBanner message={sessionActionError} />}
        <GalleryView 
          sessions={sessions} 
          onEnterEditor={enterEditor} 
          onCreateNew={() => createNewProject()} 
          onBack={() => {}} 
          onDeleteSession={(id, e) => deleteSession(id, e)}
          editingSessionId={editingSessionId}
          editingName={editingName}
          onStartEdit={(sessionId, name, e) => {
            if (pendingSessionAction) return;
            e.stopPropagation();
            setEditingSessionId(sessionId);
            setEditingName(name);
          }}
          onEditNameChange={(value) => setEditingName(value)}
          onEditNameSubmit={(sessionId, name) => renameSession(sessionId, name)}
          onCancelEdit={() => {
            setEditingSessionId(null);
            setEditingName('');
          }}
          pendingSessionAction={pendingSessionAction}
        />
      </>
    );
  }

  return (
    <React.Profiler id="workspace-performance" onRender={handleWorkspaceProfilerRender}>
      <div
        ref={editorShellRef}
        className="workspace-editor-shell relative isolate flex h-screen w-full overflow-hidden"
      >
      {sessionActionError && <SessionActionErrorBanner message={sessionActionError} />}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={handleFileUpload}
      />

      {/* Floating Toolbar - Left Side */}
      <div data-canvas-overlay-root="true" className="absolute left-4 top-1/2 z-[120] -translate-y-1/2">
        <div className="relative" ref={addNodeMenuRef}>
          {showAddNodeMenu && (
            <div className="pointer-events-none absolute left-full top-0 z-[130] ml-4">
              <div
                className="workspace-menu-panel pointer-events-auto w-[min(320px,calc(100vw-7rem))] overflow-hidden rounded-[26px]"
                onPointerDown={(e) => {
                  e.stopPropagation();
                }}
              >
                <div className="p-3.5">
                  <div className="mb-2.5 px-1 text-xs font-medium tracking-[-0.01em] text-zinc-500/80">
                    添加节点
                  </div>
                  <div className="space-y-1.5">
                    {ADD_NODE_MENU_OPTIONS.map((option) => {
                      return (
                        <CanvasActionMenuItem
                          key={option.id}
                          title={option.title}
                          description={option.description}
                          Icon={option.icon}
                          disabled={option.disabled}
                          onClick={() => handleAddNodeMenuAction(option.id)}
                        />
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          )}
          <div ref={generatedImageHistoryPanelRef} className="relative">
            <div className="workspace-left-rail flex w-[72px] flex-col items-center rounded-[36px] px-2 py-3">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  clearPendingConnectionMenu();
                  setShowAddNodeMenu((prev) => !prev);
                }}
                className="workspace-add-button mb-4 inline-flex h-12 w-12 items-center justify-center rounded-full "
                aria-label="添加节点"
                title="添加节点"
              >
                <Plus size={24} strokeWidth={2.5} />
              </button>
              <div className="flex w-full flex-col items-center gap-3">
                {LEFT_RAIL_ITEMS.map((item) => {
                  if (item.id === 'theme') {
                    return <WorkspaceThemeToggle key={item.id} theme={theme} onToggle={toggleTheme} />;
                  }

                  const isActive =
                    (item.id === 'history' && showGeneratedImageHistoryPanel) ||
                    (item.id === 'settings' && showProviderSettingsModal);

                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleLeftRailItemClick(item.id);
                      }}
                      className={`workspace-rail-item ${isActive ? 'is-active' : ''}`}
                      title={item.label}
                      aria-label={item.label}
                    >
                      <item.icon size={19} strokeWidth={2.1} />
                      <span className="text-[10px] font-medium tracking-[-0.03em] leading-none">{item.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
            {showGeneratedImageHistoryPanel && (
              <div className="workspace-popover-panel absolute left-full top-0 z-[150] ml-3 w-[384px] overflow-hidden rounded-[28px]">
                <div className="workspace-subtle-divider flex items-center justify-between border-b px-5 py-4">
                  <div className="min-w-0 flex-1">
                    <div className="workspace-text-primary text-[13px] font-semibold tracking-[-0.02em]">生成历史</div>
                    <div className="workspace-text-muted mt-1 pr-4 text-[11px] leading-5">所有 session 的生成图片，最新添加优先</div>
                  </div>
                  <div className="workspace-count-pill ml-3 shrink-0 rounded-full px-2.5 py-1 text-[11px] font-medium">
                    {generatedImageHistoryEntries.length}
                  </div>
                </div>
                {generatedImageHistoryEntries.length > 0 ? (
                  <div className="panel-scrollbar max-h-[520px] overflow-y-auto p-5" onWheel={stopCanvasWheelFromScrollableRegion}>
                    <div className="grid grid-cols-2 gap-3">
                      {generatedImageHistoryEntries.map((entry) => (
                        <button
                          key={entry.id}
                          type="button"
                          onClick={() => {
                            void addGeneratedHistoryImageToCanvas(entry);
                          }}
                          className="workspace-history-card group overflow-hidden rounded-[20px] text-left"
                        >
                          <div className="workspace-preview-tile relative aspect-square overflow-hidden">
                            <Image
                              src={entry.src}
                              alt="历史生成图"
                              fill
                              unoptimized
                              sizes="160px"
                              className="object-cover group-hover:scale-[1.03]"
                              draggable={false}
                            />
                          </div>
                          <div className="flex items-center justify-between gap-2 px-3 py-2.5">
                            <span className="workspace-text-primary truncate text-[11px] font-medium">
                              {GENERATED_HISTORY_SOURCE_LABELS[entry.source as GeneratedImageHistoryEntry['source']] || '本地生成'}
                            </span>
                            <span className="workspace-text-muted shrink-0 text-[10px] uppercase tracking-[0.08em]">
                              Add
                            </span>
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="workspace-text-muted px-5 py-10 text-center text-[12px] leading-6">
                    暂无生成图片历史
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Canvas Avatar & Project Menu - Top Left */}
      <div className="absolute left-[34px] top-4 z-[120] flex items-center gap-2">
        <div className="relative">
          <button 
            className="workspace-floating-control flex h-10 w-10 items-center justify-center overflow-hidden rounded-full text-sm font-medium "
            onClick={(e) => { 
              e.stopPropagation(); 
              leaveEditor();
            }}
            aria-label="返回画廊"
          >
            <Image src="/z-flow-logo.svg" alt="" width={40} height={40} />
          </button>
          {showAvatarMenu && (
            <div className="workspace-popover-panel absolute left-0 top-12 z-[130] w-48 rounded-2xl py-2">
              <button className="w-full px-4 py-2 text-left text-sm hover:bg-[var(--workspace-control-hover)]">个人资料</button>
              <button className="w-full px-4 py-2 text-left text-sm hover:bg-[var(--workspace-control-hover)]">设置</button>
              <hr className="my-2 workspace-divider-dark" />
              <button className="w-full px-4 py-2 text-left text-sm hover:bg-[var(--workspace-control-hover)]">退出登录</button>
            </div>
          )}
        </div>

        {/* Project Name Dropdown */}
        <div className="relative" ref={projectMenuRef}>
          <button 
            onClick={(e) => { e.stopPropagation(); setShowProjectMenu(!showProjectMenu); }}
            className="workspace-floating-control flex items-center gap-1.5 rounded-xl px-3 py-2 "
            aria-label="打开画布列表"
          >
            <span className="max-w-[120px] truncate text-sm font-medium">{currentProjectName}</span>
            <ChevronDown size={14} className="workspace-text-muted flex-shrink-0" />
          </button>

          {showProjectMenu && (
            <div className="workspace-popover-panel absolute left-0 top-12 z-[130] w-64 overflow-hidden rounded-2xl">
              <div className="p-2">
                <button 
                  disabled={pendingSessionAction !== null}
                  onClick={(e) => { e.stopPropagation(); createNewProject(); }}
                  className="flex min-h-[44px] w-full items-center gap-2 rounded-xl px-3 py-2 text-sm  hover:bg-[var(--workspace-control-hover)] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <span className="text-lg">+</span>
                  <span>{pendingSessionAction?.type === 'create' ? '新建中...' : '新建画布'}</span>
                </button>
              </div>
              <div className="panel-scrollbar workspace-divider-dark max-h-64 overflow-y-auto border-t">
                {sessions.map(session => (
                  <div 
                    key={session.id}
                    onClick={(e) => { e.stopPropagation(); loadSession(session.id); }}
                    className={`workspace-menu-item group relative flex cursor-pointer items-center gap-2 border-l-2 border-transparent px-4 py-3 ${
                      session.id === currentSessionId ? 'is-selected' : ''
                    }`}
                  >
                    {editingSessionId === session.id ? (
                      <input
                        autoFocus
                        value={editingName}
                        disabled={pendingSessionAction !== null}
                        onChange={(e) => setEditingName(e.target.value)}
                        onBlur={() => renameSession(session.id, editingName)}
                        onKeyDown={(e) => { if (e.key === 'Enter') renameSession(session.id, editingName); }}
                        onClick={(e) => e.stopPropagation()}
                        className="workspace-panel-input workspace-text-primary flex-1 rounded-lg px-2 py-1 text-sm focus:outline-none"
                      />
                    ) : (
                      <>
                        <div className="flex-1 min-w-0">
                          <div className="truncate text-sm font-medium">{session.name}</div>
                          <div className="workspace-text-muted text-xs">
                            {session.messages.length} 条对话 · {new Date(session.updatedAt).toLocaleDateString()}
                          </div>
                        </div>
                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100">
                        <button
                          disabled={pendingSessionAction !== null}
                          onClick={(e) => { e.stopPropagation(); setEditingSessionId(session.id); setEditingName(session.name); }}
                          className="inline-flex h-11 w-11 items-center justify-center rounded-lg  hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
                          title="重命名"
                          aria-label={`重命名 ${session.name}`}
                        >
                          <Edit3 size={12} className="text-zinc-500" />
                        </button>
                        <button
                          disabled={pendingSessionAction !== null}
                          onClick={(e) => { e.stopPropagation(); deleteSession(session.id, e); }}
                          className="inline-flex h-11 w-11 items-center justify-center rounded-lg  hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40"
                          title="删除"
                          aria-label={`删除 ${session.name}`}
                        >
                          <Trash2 size={12} className="text-red-500" />
                        </button>
                      </div>
                    </>
                  )}
                </div>
              ))}
            </div>
            </div>
          )}
        </div>
      </div>

        <CanvasViewport
        canvasRef={canvasRef}
        canvasSceneRef={setCanvasSceneRef}
        canvasSize={canvasSize}
        canvasRect={canvasMetricsRef.current}
        widthStyle="100%"
        tool={tool}
        isSpacePressed={isSpacePressed}
        viewport={viewport}
        themePalette={themePalette}
        items={items}
        connections={connections}
        itemById={itemById}
        selectedIds={selectedIds}
        selectedId={selectedId}
        selectedConnectionIds={selectedConnectionIds}
        regionSelections={regionDraftPreview
          ? [...regionSelections.filter((region) => region.id !== regionRefineId), regionDraftPreview]
          : regionSelections}
        activeRegionId={activeRegionMenuId}
        hoveredCanvasItemId={hoveredCanvasItemId}
        hoveredInputPortItemId={hoveredInputPortItemId}
        hoveredOutputPortItemId={hoveredOutputPortItemId}
        connectionMode={connectionMode}
        connectionFromItemId={connectionFromItemId}
        frozenPreviewConnection={frozenPreviewConnection}
        pendingConnectionMenu={pendingConnectionMenu}
        multiSelectionBounds={multiSelectionBounds}
        marqueeElementRef={setMarqueeElementRef}
        marqueePathRef={setMarqueePathRef}
        getConnectionAnchorCanvasPoint={getConnectionAnchorCanvasPoint}
        toCanvasScreenPoint={toCanvasScreenPoint}
        buildConnectionPath={buildConnectionPath}
        getItemTargetRef={getItemTargetRef}
        getSelectionGroupRef={getSelectionGroupRef}
        getConnectionPathRef={getConnectionPathRef}
        connectionPreviewPathRef={connectionPreviewPathRef}
        getViewportOverlayRef={getViewportOverlayRef}
        onPointerDown={stableCanvasPointerDown}
        onPointerMove={stableCanvasPointerMove}
        onPointerUp={stableCanvasPointerUp}
        onPointerLeave={stableCanvasPointerLeave}
        onNativeWheel={handleNativeCanvasWheel}
        onMetricsChange={handleCanvasMetricsChange}
        onPaste={handleCanvasPaste}
        onConnectionPointerDown={handleConnectionPointerDown}
        onInputPortEnter={handleInputPortEnter}
        onInputPortLeave={handleInputPortLeave}
        onOutputPortEnter={handleOutputPortEnter}
        onOutputPortLeave={handleOutputPortLeave}
        onOutputPortPointerDown={stableOutputPortPointerDown}
        onSelectionGroupPointerDown={handleSelectionGroupPointerDown}
        onItemMouseEnter={handleItemMouseEnter}
        onItemMouseLeave={handleItemMouseLeave}
        onItemClick={stableCanvasItemClick}
        onItemPointerDown={handleItemPointerDown}
        onRegionClick={handleRegionClick}
        onCornerResizePointerDown={handleCornerResizePointerDown}
        onPendingMenuPointerDown={handlePendingMenuPointerDown}
        onPendingMenuAction={handlePendingConnectionMenuAction}
        selectedTextCardPanelItem={selectedTextCardPanelItem}
        linkedImagePreviews={selectedTextCardPanelLinkedImagePreviews}
        selectedTextCardPanelLinkedTexts={selectedTextCardPanelLinkedTexts}
        selectedImageCardPanelItem={selectedImageCardPanelItem}
        selectedImageCardPanelLinkedImagePreviews={selectedImageCardPanelLinkedImagePreviews}
        activeCanvasTextGenerationItemIds={activeCanvasTextGenerationItemIds}
        activeCanvasImageGenerationItemIds={activeCanvasImageGenerationItemIds}
        activeCanvasTextGenerations={activeCanvasTextGenerations}
        activeCanvasImageGenerations={activeCanvasImageGenerations}
        activeCanvasImageIds={activeCanvasImageIds}
        selectedTextPanelModel={selectedTextPanelModel}
        textPanelModelOptions={selectedTextCardProviderModelOptions}
        selectedTextCardProviderLabel={selectedTextCardProviderLabel}
        selectableTextProviders={selectableTextProviders}
        selectedTextCardProviderId={selectedTextCardProviderId}
        showTextPanelProviderMenu={showTextPanelProviderMenu}
        textPanelProviderMenuRef={textPanelProviderMenuRef}
        textPanelProviderPopoverRef={textPanelProviderPopoverRef}
        showTextPanelModelMenu={showTextPanelModelMenu}
        textPanelModelMenuRef={textPanelModelMenuRef}
        textPanelModelPopoverRef={textPanelModelPopoverRef}
        selectedTextCardPanelInput={selectedTextCardPanelInput}
        selectedTextCardPanelCanSubmit={selectedTextCardPanelCanSubmit}
        selectedTextCardPanelError={selectedTextCardPanelError}
        isSelectedTextCardGenerating={isSelectedTextCardGenerating}
        selectedImageCardPanelInput={selectedImageCardPanelInput}
        selectedImageCardPanelCanSubmit={selectedImageCardPanelCanSubmit}
        selectedImageCardPanelError={selectedImageCardPanelError}
        selectedImageCardModel={selectedImageCardModel}
        imageCardModelOptions={selectedImageCardProviderModelOptions}
        selectedImageCardAspectRatioOptions={selectedImageCardAspectRatioOptions}
        selectedImageCardPanelSize={selectedImageCardPanelSize}
        selectedImageCardSizeOptions={selectedImageCardSizeOptions}
        selectedImageCardEnabledAspectRatios={selectedImageCardEnabledAspectRatios}
        selectedImageCardPanelQuality={selectedImageCardPanelQuality}
        selectedImageCardQualityOptions={selectedImageCardQualityOptions}
        selectedImageCardPanelCount={selectedImageCardPanelCount}
        selectedImageCardPanelAspectRatio={selectedImageCardPanelAspectRatio}
        isSelectedImageCardGenerating={isSelectedImageCardGenerating}
        selectedImageCardProviderLabel={selectedImageCardProviderLabel}
        selectableImageProviders={selectableImageProviders}
        selectedImageCardProviderId={selectedImageCardProviderId}
        showImageCardProviderMenu={showImageCardProviderMenu}
        imageCardProviderMenuRef={imageCardProviderMenuRef}
        imageCardProviderPopoverRef={imageCardProviderPopoverRef}
        showImageCardModelMenu={showImageCardModelMenu}
        imageCardModelMenuRef={imageCardModelMenuRef}
        imageCardModelPopoverRef={imageCardModelPopoverRef}
        showImageCardSettingsMenu={showImageCardSettingsMenu}
        imageCardSettingsMenuRef={imageCardSettingsMenuRef}
        imageCardSettingsPopoverRef={imageCardSettingsPopoverRef}
        editingTextCardId={editingTextCardId}
        editingTextCardTextareaRef={editingTextCardTextareaRef}
        editingAnnotationTextId={editingAnnotationTextId}
        editingAnnotationTextRef={editingAnnotationTextRef}
        draftStroke={draftStroke}
        draftStrokePathRef={draftStrokePathRef}
        onToggleTextPanelProviderMenu={() => {
          setShowTextPanelModelMenu(false);
          setShowTextPanelProviderMenu((prev) => !prev);
        }}
        onSelectTextPanelProvider={(providerId) => {
          if (!selectedTextCardPanelItem) return;
          const nextModel = findWorkspaceModelOption(workspaceTextModelOptions, '', providerId);
          recordCurrentCanvasUndoSnapshot();
          setTextCardProviderById((prev) => ({
            ...prev,
            [selectedTextCardPanelItem.id]: providerId,
          }));
          setTextCardModelById((prev) => ({
            ...prev,
            [selectedTextCardPanelItem.id]: nextModel?.id || defaultWorkspaceTextModelOption.id,
          }));
          setShowTextPanelProviderMenu(false);
        }}
        onToggleTextPanelModelMenu={() => {
          setShowTextPanelProviderMenu(false);
          setShowTextPanelModelMenu((prev) => !prev);
        }}
        onSelectTextPanelModel={(modelId) => {
          if (!selectedTextCardPanelItem) return;
          const nextModel = findWorkspaceModelOption(selectedTextCardProviderModelOptions, modelId, selectedTextCardProviderId);
          recordCurrentCanvasUndoSnapshot();
          setTextCardModelById((prev) => ({
            ...prev,
            [selectedTextCardPanelItem.id]: nextModel?.id || modelId,
          }));
          setShowTextPanelModelMenu(false);
        }}
        onSelectedTextCardPanelInputChange={handleSelectedTextCardPanelInputChange}
        onSelectedTextCardPanelBlur={commitPendingCanvasUndoSnapshot}
        onSelectedTextCardPanelSubmit={handleSelectedTextCardPanelSubmit}
        onSelectedTextCardPanelCancel={() => handleCancelCanvasTextGenerate(selectedTextCardPanelItem?.id ?? null)}
        onToggleImageCardProviderMenu={() => {
          setShowImageCardModelMenu(false);
          setShowImageCardSettingsMenu(false);
          setShowImageCardProviderMenu((prev) => !prev);
        }}
        onSelectImageCardProvider={(providerId) => {
          if (!selectedImageCardPanelItem) return;
          const nextProvider = selectableImageProviders.find((provider) => provider.id === providerId);
          const nextModel = findWorkspaceModelOption(workspaceImageModelOptions, '', providerId);
          const resolvedModelId = resolveWorkspaceImageCardModel(
            nextModel?.id || '',
            workspaceImageModelOptions.map((option) => option.id),
            defaultWorkspaceImageModelOption.id
          );
          const syncedOptions = syncImageCardOptionsForProviderModel(
            providerId,
            resolvedModelId,
            imageCardSizeById[selectedImageCardPanelItem.id] ?? IMAGE_CARD_SIZE_OPTIONS[0].id,
            imageCardAspectRatioById[selectedImageCardPanelItem.id] ?? '1:1',
            imageCardQualityById[selectedImageCardPanelItem.id] ?? IMAGE_CARD_QUALITY_OPTIONS[0].id
          );
          const resolvedSizeId = syncedOptions.sizeId;
          recordCurrentCanvasUndoSnapshot();
          setImageCardProviderById((prev) => ({
            ...prev,
            [selectedImageCardPanelItem.id]: providerId,
          }));
          setImageCardModelById((prev) => ({
            ...prev,
            [selectedImageCardPanelItem.id]: resolvedModelId,
          }));
          setImageCardSizeById((prev) => ({
            ...prev,
            [selectedImageCardPanelItem.id]: resolvedSizeId,
          }));
          setImageCardAspectRatioById((prev) => ({
            ...prev,
            [selectedImageCardPanelItem.id]: syncedOptions.aspectRatioId,
          }));
          setImageCardQualityById((prev) => ({
            ...prev,
            [selectedImageCardPanelItem.id]: syncedOptions.qualityId,
          }));
          setItems((prev) =>
            prev.map((item) =>
              item.id === selectedImageCardPanelItem.id && isImageCardItem(item)
                ? resizeImageCardItemToAspectRatio(item, syncedOptions.aspectRatioId)
                : item
            )
          );
          setShowImageCardProviderMenu(false);
        }}
        onToggleImageCardModelMenu={() => {
          setShowImageCardProviderMenu(false);
          setShowImageCardSettingsMenu(false);
          setShowImageCardModelMenu((prev) => !prev);
        }}
        onSelectImageCardModel={(modelId) => {
          if (!selectedImageCardPanelItem) return;
          const nextModel = findWorkspaceModelOption(selectedImageCardProviderModelOptions, modelId, selectedImageCardProviderId);
          const resolvedModelId = resolveWorkspaceImageCardModel(
            nextModel?.id || modelId,
            selectedImageCardProviderModelOptions.map((option) => option.id),
            selectedImageCardProviderModelOptions[0]?.id || defaultWorkspaceImageModelOption.id
          );
          const nextProviderId = nextModel?.providerId || selectedImageCardProviderId;
          const syncedOptions = syncImageCardOptionsForProviderModel(
            nextProviderId,
            resolvedModelId,
            imageCardSizeById[selectedImageCardPanelItem.id] ?? IMAGE_CARD_SIZE_OPTIONS[0].id,
            imageCardAspectRatioById[selectedImageCardPanelItem.id] ?? '1:1',
            imageCardQualityById[selectedImageCardPanelItem.id] ?? IMAGE_CARD_QUALITY_OPTIONS[0].id
          );
          const resolvedSizeId = syncedOptions.sizeId;
          recordCurrentCanvasUndoSnapshot();
          setImageCardProviderById((prev) => ({
            ...prev,
            [selectedImageCardPanelItem.id]: nextProviderId,
          }));
          setImageCardModelById((prev) => ({
            ...prev,
            [selectedImageCardPanelItem.id]: resolvedModelId,
          }));
          setImageCardSizeById((prev) => ({
            ...prev,
            [selectedImageCardPanelItem.id]: resolvedSizeId,
          }));
          setImageCardAspectRatioById((prev) => ({
            ...prev,
            [selectedImageCardPanelItem.id]: syncedOptions.aspectRatioId,
          }));
          setImageCardQualityById((prev) => ({
            ...prev,
            [selectedImageCardPanelItem.id]: syncedOptions.qualityId,
          }));
          setItems((prev) =>
            prev.map((item) =>
              item.id === selectedImageCardPanelItem.id && isImageCardItem(item)
                ? resizeImageCardItemToAspectRatio(item, syncedOptions.aspectRatioId)
                : item
            )
          );
          setShowImageCardModelMenu(false);
        }}
        onToggleImageCardSettingsMenu={() => {
          setShowImageCardProviderMenu(false);
          setShowImageCardModelMenu(false);
          setShowImageCardSettingsMenu((prev) => !prev);
        }}
        onSelectImageCardSize={(sizeId) => {
          if (!selectedImageCardPanelItem) return;
          const syncedOptions = syncImageCardOptionsForProviderModel(
            selectedImageCardProviderId,
            selectedImageCardPanelModelId,
            sizeId,
            imageCardAspectRatioById[selectedImageCardPanelItem.id] ?? '1:1',
            imageCardQualityById[selectedImageCardPanelItem.id] ?? IMAGE_CARD_QUALITY_OPTIONS[0].id
          );
          const resolvedSizeId = syncedOptions.sizeId;
          recordCurrentCanvasUndoSnapshot();
          setImageCardSizeById((prev) => ({
            ...prev,
            [selectedImageCardPanelItem.id]: resolvedSizeId,
          }));
          setImageCardAspectRatioById((prev) => ({
            ...prev,
            [selectedImageCardPanelItem.id]: syncedOptions.aspectRatioId,
          }));
          setImageCardQualityById((prev) => ({
            ...prev,
            [selectedImageCardPanelItem.id]: syncedOptions.qualityId,
          }));
          setItems((prev) =>
            prev.map((item) =>
              item.id === selectedImageCardPanelItem.id && isImageCardItem(item)
                ? resizeImageCardItemToAspectRatio(item, syncedOptions.aspectRatioId)
                : item
            )
          );
        }}
        onSelectImageCardQuality={(qualityId) => {
          if (!selectedImageCardPanelItem) return;
          const resolvedQualityId =
            selectedImageCardQualityOptions.find((option) => option.id === qualityId)?.id ||
            selectedImageCardQualityOptions[0]?.id ||
            IMAGE_CARD_QUALITY_OPTIONS[0].id;
          recordCurrentCanvasUndoSnapshot();
          setImageCardQualityById((prev) => ({
            ...prev,
            [selectedImageCardPanelItem.id]: resolvedQualityId,
          }));
        }}
        onSelectImageCardCount={(count) => {
          if (!selectedImageCardPanelItem) return;
          const nextCount = clampImageCardCount(count);
          recordCurrentCanvasUndoSnapshot();
          setImageCardCountById((prev) => ({
            ...prev,
            [selectedImageCardPanelItem.id]: nextCount,
          }));
        }}
        onSelectImageCardAspectRatio={(aspectRatioId) => {
          if (!selectedImageCardPanelItem) return;
          const normalizedAspectRatio = normalizeProviderModelAspectRatioForSize(
            selectedImageCardProviderId,
            selectedImageCardPanelModelId,
            selectedImageCardPanelSize,
            aspectRatioId,
            providerImageOptionProfiles
          );
          recordCurrentCanvasUndoSnapshot();
          setImageCardAspectRatioById((prev) => ({
            ...prev,
            [selectedImageCardPanelItem.id]: normalizedAspectRatio,
          }));
          setItems((prev) =>
            prev.map((item) =>
              item.id === selectedImageCardPanelItem.id && isImageCardItem(item)
                ? resizeImageCardItemToAspectRatio(item, normalizedAspectRatio)
                : item
            )
          );
        }}
        onSelectedImageCardPanelInputChange={handleSelectedImageCardPanelInputChange}
        onSelectedImageCardPanelBlur={commitPendingCanvasUndoSnapshot}
        onSelectedImageCardPanelSubmit={handleSelectedImageCardPanelSubmit}
        onSelectedImageCardPanelCancel={() => handleCancelCanvasImageGenerate(selectedImageCardPanelItem?.id ?? null)}
        onItemDoubleClick={handleCanvasItemDoubleClick}
        onManualTextCardInputChange={handleManualTextCardInputChange}
        onManualTextCardBlur={finalizeManualTextCardEditing}
        onAnnotationTextChange={handleAnnotationTextChange}
        onAnnotationTextBlur={finalizeAnnotationTextEditing}
        onImageCardOutputSelect={handleImageCardOutputSelect}
        draggingPanelReference={draggingPanelReference}
        dragOverPanelReference={dragOverPanelReference}
        onPanelReferenceDragStart={handlePanelReferenceDragStart}
        onPanelReferenceDragOver={handlePanelReferenceDragOver}
        onPanelReferenceDrop={handlePanelReferenceDrop}
        onPanelReferenceDragEnd={handlePanelReferenceDragEnd}
      />

      {typeof document !== 'undefined' &&
        selectedImageToolbarTarget &&
        selectedImageToolbarAnchors &&
        createPortal(
          <div
            ref={getViewportOverlayRef('selected-image-toolbar')}
            data-canvas-overlay-root="true"
            data-canvas-viewport-overlay="true"
            data-canvas-overlay-item-id={selectedImageToolbarTarget.itemId}
            className="pointer-events-none fixed left-0 top-0 z-[114]"
            style={{
              transform: `translate3d(${selectedImageToolbarAnchors.centerX}px, ${selectedImageToolbarAnchors.topToolbarY}px, 0) translate(-50%, -100%)`,
              transformOrigin: 'bottom center',
              willChange: 'transform',
            }}
          >
            <div
              data-image-node-toolbar="true"
              className="workspace-menu-panel pointer-events-auto flex items-center gap-1 rounded-full px-2 py-1.5"
              style={{ contain: 'layout paint style', isolation: 'isolate' }}
              onPointerDown={(e) => {
                e.stopPropagation();
              }}
            >
              {IMAGE_NODE_TOOLBAR_ACTIONS.map((action) => {
                const Icon = action.icon;

                return (
                  <button
                    key={action.id}
                    data-image-node-toolbar-action={action.id}
                    type="button"
                    disabled={!action.enabled}
                    onClick={() => {
                      if (!action.enabled) return;
                      void handleImageToolbarAction(action.id);
                    }}
                    onPointerDown={(e) => {
                      e.stopPropagation();
                    }}
                    className={`workspace-control-chip inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[12px] font-medium tracking-[-0.02em] ${
                      action.enabled
                        ? ''
                        : 'is-disabled'
                    }`}
                    title={action.enabled ? action.label : action.disabledReason ?? `${action.label} 即将支持`}
                  >
                    <Icon size={13} strokeWidth={2} className="shrink-0" />
                    <span className="whitespace-nowrap">{action.label}</span>
                  </button>
                );
              })}
            </div>
          </div>,
          document.body
        )}

      {typeof document !== 'undefined' &&
        showProviderSettingsModal &&
        createPortal(
          <div className="fixed inset-0 z-[230] flex items-center justify-center p-4">
            <button
              type="button"
              className="absolute inset-0 bg-black/40"
              data-gsap-no-interaction="true"
              aria-label="关闭供应商配置"
              onClick={closeProviderSettingsModal}
            />
            <div
              className="workspace-popover-panel relative z-[1] flex max-h-[min(88vh,760px)] w-full max-w-[920px] flex-col overflow-hidden rounded-[28px]"
              onClick={(e) => {
                e.stopPropagation();
              }}
            >
              <div className="workspace-subtle-divider flex items-start justify-between border-b px-6 py-5">
                <div>
                  <div className="text-[18px] font-semibold tracking-[-0.03em]">供应商配置</div>
                  <div className="workspace-text-muted mt-1 text-[12px] leading-5">
                    管理多供应商、协议、端点和模型清单；未指定时使用主供应商
                  </div>
                </div>
                <button
                  type="button"
                  className="rounded-full border border-[var(--workspace-border)] bg-[var(--workspace-surface-soft)] p-2 text-[var(--workspace-text-muted)]  hover:bg-[var(--workspace-control-hover)] hover:text-[var(--workspace-text-primary)]"
                  onClick={closeProviderSettingsModal}
                  aria-label="关闭供应商配置"
                >
                  <X size={16} />
                </button>
              </div>

              <div className="flex min-h-0 flex-1 flex-col px-6 py-5">
                {providerSettingsError && (
                  <div className="mb-4 rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-[12px] font-medium text-red-700 dark:text-red-300">
                    {providerSettingsError}
                  </div>
                )}

                {providerSettingsLoading ? (
                  <div className="rounded-[22px] border border-[var(--workspace-border)] bg-[var(--workspace-surface-soft)] px-4 py-6 text-center text-[13px] text-[var(--workspace-text-muted)]">
                    加载供应商配置中…
                  </div>
                ) : selectedProviderSettings ? (
                  <div className="grid min-h-0 flex-1 gap-5 md:grid-cols-[220px_minmax(0,1fr)]">
                    <div className="flex min-h-0 flex-col gap-2">
                      <div className="workspace-text-muted text-[11px] font-medium uppercase tracking-[0.18em]">Providers</div>
                      <div className="workspace-menu-panel panel-scrollbar min-h-0 flex-1 overflow-y-auto rounded-[18px] p-1.5">
                        {providerSettingsProviders.map((provider) => {
                          const isSelected = provider.id === selectedProviderSettings.id;
                          const isDeletable = provider.id !== 'comfly';

                          return (
                            <div
                              key={provider.id}
                              className={`workspace-menu-item flex items-start gap-2 rounded-[14px] px-3 py-2.5 ${
                                isSelected ? 'is-selected' : ''
                              }`}
                            >
                              <button
                                type="button"
                                className="min-w-0 flex-1 text-left"
                                onClick={() => handleProviderSettingsProviderChange(provider.id)}
                              >
                                <span className="block text-[13px] font-semibold tracking-[-0.02em]">{provider.name || provider.id || getProviderSettingsProviderLabel(provider.id)}</span>
                                <span className="workspace-text-muted mt-1 block max-w-full truncate text-[11px]">{provider.protocol} · {provider.primary ? '主供应商' : '备用'}</span>
                              </button>
                              {isDeletable && (
                                <button
                                  type="button"
                                  className="workspace-text-muted inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full  hover:bg-[var(--workspace-control-hover)] hover:text-red-500"
                                  onClick={() => handleProviderSettingsDeleteProvider(provider.id)}
                                  aria-label={`删除供应商 ${provider.name || provider.id}`}
                                  title={`删除供应商 ${provider.name || provider.id}`}
                                >
                                  <Trash2 size={14} />
                                </button>
                              )}
                            </div>
                          );
                        })}
                      </div>
                      <button
                        type="button"
                        className="workspace-control-chip inline-flex h-11 items-center justify-center rounded-[14px] px-3 text-[13px] font-semibold tracking-[-0.02em]"
                        onClick={handleProviderSettingsAddProvider}
                      >
                        增加供应商
                      </button>
                    </div>

                    <div className="panel-scrollbar min-h-0 space-y-4 overflow-y-auto pr-1">
                      <div className="grid gap-3 sm:grid-cols-2">
                        <label className="block">
                          <div className="mb-2 text-[12px] font-medium">名称</div>
                          <input
                            value={selectedProviderSettings.name}
                            onChange={(e) => {
                              const nextName = e.target.value;
                              updateSelectedProviderSettings((provider) => ({ ...provider, name: nextName }));
                              setProviderSettingsError(null);
                            }}
                            className="w-full rounded-2xl border border-[var(--workspace-border)] bg-[var(--workspace-surface-soft)] px-4 py-3 text-[14px] text-[var(--workspace-text-primary)] outline-none  placeholder:text-[var(--workspace-text-soft)] focus:border-[var(--workspace-border-strong)] focus:bg-[var(--workspace-surface-elevated)]"
                          />
                        </label>
                        <label className="block">
                          <div className="mb-2 text-[12px] font-medium">ID</div>
                          <input
                            value={selectedProviderSettings.id}
                            disabled={!isSelectedProviderSettingsIdEditable}
                            placeholder={isSelectedProviderSettingsIdEditable ? 'provider-id' : ''}
                            onChange={(e) => {
                              const nextId = e.target.value.trim().toLowerCase().replace(/\s+/g, '-');
                              const previousId = selectedProviderSettings.id;
                              updateSelectedProviderSettings((provider) => ({ ...provider, id: nextId }));
                              setProviderSettingsEditableProviderIds((prev) => prev.map((providerId) => providerId === selectedProviderSettings.id ? nextId : providerId));
                              if (providerSettingsSelectedProviderId === previousId) {
                                setProviderSettingsSelectedProviderId(nextId);
                              }
                              setProviderSettingsError(null);
                              setProviderSettingsTestResult(null);
                              setProviderSettingsFetchedModels(null);
                              setProviderSettingsModelPickerOpen(false);
                            }}
                            className={`w-full rounded-2xl border border-[var(--workspace-border)] px-4 py-3 text-[14px] outline-none ${
                              isSelectedProviderSettingsIdEditable
                                ? 'bg-[var(--workspace-surface-soft)] text-[var(--workspace-text-primary)]  placeholder:text-[var(--workspace-text-soft)] focus:border-[var(--workspace-border-strong)] focus:bg-[var(--workspace-surface-elevated)]'
                                : 'bg-[var(--workspace-surface-soft)] text-[var(--workspace-text-muted)]'
                            }`}
                          />
                        </label>
                      </div>

                      <label className="block">
                        <div className="mb-2 text-[12px] font-medium">Base URL</div>
                        <input
                          value={selectedProviderSettings.baseUrl}
                          id="provider-base-url-input"
                          name="provider-base-url-input"
                          autoComplete="off"
                          autoCorrect="off"
                          autoCapitalize="none"
                          spellCheck={false}
                          onChange={(e) => {
                            const nextBaseUrl = e.target.value;
                            updateSelectedProviderSettings((provider) => ({ ...provider, baseUrl: nextBaseUrl }));
                            setProviderSettingsError(null);
                            setProviderSettingsTestResult(null);
                          }}
                          placeholder="https://your-provider.example.com/v1"
                          className="w-full rounded-2xl border border-[var(--workspace-border)] bg-[var(--workspace-surface-soft)] px-4 py-3 text-[14px] text-[var(--workspace-text-primary)] outline-none  placeholder:text-[var(--workspace-text-soft)] focus:border-[var(--workspace-border-strong)] focus:bg-[var(--workspace-surface-elevated)]"
                        />
                      </label>

                      <div className="grid gap-3 sm:grid-cols-2">
                        <label className="block">
                          <div className="mb-2 text-[12px] font-medium">协议</div>
                          <div className="relative">
                            <select
                              value={selectedProviderSettings.protocol}
                              onChange={(e) => {
                                const nextProtocol = e.target.value as ProviderProtocol;
                                updateSelectedProviderSettings((provider) => ({ ...provider, protocol: nextProtocol }));
                                setProviderSettingsError(null);
                              }}
                              className="w-full appearance-none rounded-2xl border border-[var(--workspace-border)] bg-[var(--workspace-surface-soft)] px-4 py-3 text-[14px] text-[var(--workspace-text-primary)] outline-none  focus:border-[var(--workspace-border-strong)] focus:bg-[var(--workspace-surface-elevated)]"
                            >
                              {PROVIDER_PROTOCOL_OPTIONS.map((option) => (
                                <option key={option.id} value={option.id}>
                                  {option.label}
                                </option>
                              ))}
                            </select>
                            <ChevronDown size={16} className="workspace-text-muted pointer-events-none absolute right-4 top-1/2 -translate-y-1/2" />
                          </div>
                        </label>
                        <label className="block">
                          <div className="mb-2 text-[12px] font-medium">图片请求模式</div>
                          <div className="relative">
                            <select
                              value={selectedProviderSettings.imageRequestMode}
                              onChange={(e) => {
                                const nextMode = e.target.value as ProviderImageRequestMode;
                                updateSelectedProviderSettings((provider) => ({ ...provider, imageRequestMode: nextMode }));
                                setProviderSettingsError(null);
                              }}
                              className="w-full appearance-none rounded-2xl border border-[var(--workspace-border)] bg-[var(--workspace-surface-soft)] px-4 py-3 text-[14px] text-[var(--workspace-text-primary)] outline-none  focus:border-[var(--workspace-border-strong)] focus:bg-[var(--workspace-surface-elevated)]"
                            >
                              {PROVIDER_IMAGE_REQUEST_MODE_OPTIONS.map((option) => (
                                <option key={option.id} value={option.id}>
                                  {option.label}
                                </option>
                              ))}
                            </select>
                            <ChevronDown size={16} className="workspace-text-muted pointer-events-none absolute right-4 top-1/2 -translate-y-1/2" />
                          </div>
                        </label>
                      </div>

                      <div className="grid gap-3 sm:grid-cols-2">
                        <label className="block">
                          <div className="mb-2 text-[12px] font-medium">文生图端点</div>
                          <input
                            value={selectedProviderSettings.imageGenerationEndpoint}
                            name="provider-image-generation-endpoint"
                            autoComplete="off"
                            autoCorrect="off"
                            autoCapitalize="none"
                            spellCheck={false}
                            onChange={(e) => {
                              const nextEndpoint = e.target.value;
                              updateSelectedProviderSettings((provider) => ({ ...provider, imageGenerationEndpoint: nextEndpoint }));
                              setProviderSettingsError(null);
                            }}
                            placeholder="/v1/images/generations"
                            className="w-full rounded-2xl border border-[var(--workspace-border)] bg-[var(--workspace-surface-soft)] px-4 py-3 text-[14px] text-[var(--workspace-text-primary)] outline-none  placeholder:text-[var(--workspace-text-soft)] focus:border-[var(--workspace-border-strong)] focus:bg-[var(--workspace-surface-elevated)]"
                          />
                        </label>
                        <label className="block">
                          <div className="mb-2 text-[12px] font-medium">图生图/编辑端点</div>
                          <input
                            value={selectedProviderSettings.imageEditEndpoint}
                            name="provider-image-edit-endpoint"
                            autoComplete="off"
                            autoCorrect="off"
                            autoCapitalize="none"
                            spellCheck={false}
                            onChange={(e) => {
                              const nextEndpoint = e.target.value;
                              updateSelectedProviderSettings((provider) => ({ ...provider, imageEditEndpoint: nextEndpoint }));
                              setProviderSettingsError(null);
                            }}
                            placeholder="/v1/images/edits"
                            className="w-full rounded-2xl border border-[var(--workspace-border)] bg-[var(--workspace-surface-soft)] px-4 py-3 text-[14px] text-[var(--workspace-text-primary)] outline-none  placeholder:text-[var(--workspace-text-soft)] focus:border-[var(--workspace-border-strong)] focus:bg-[var(--workspace-surface-elevated)]"
                          />
                        </label>
                      </div>

                      <label className="block">
                        <div className="mb-2 flex items-center justify-between gap-3 text-[12px] font-medium">
                          <span>主 API Key</span>
                          <span className="workspace-text-muted text-[11px] font-normal">
                            {selectedProviderSettings.hasApiKey
                              ? `当前已保存 ${selectedProviderSettings.maskedApiKey || '已配置'}`
                              : '当前未保存 API Key'}
                          </span>
                        </div>
                        <div className="relative">
                          <input
                            type="text"
                            id="provider-api-secret-input"
                            name="provider-api-secret-input"
                            autoComplete="new-password"
                            autoCorrect="off"
                            autoCapitalize="none"
                            spellCheck={false}
                            data-1p-ignore="true"
                            data-lpignore="true"
                            value={providerSettingsApiKeyInputValue}
                            onChange={(e) => {
                              const nextApiKey = isProviderSettingsApiKeyVisible
                                ? e.target.value
                                : e.target.value.replace(/\*/g, '');
                              setProviderSettingsApiKey(nextApiKey);
                              updateSelectedProviderSettings((provider) => ({
                                ...provider,
                                apiKey: nextApiKey,
                                hasApiKey: nextApiKey.trim().length > 0,
                                maskedApiKey: maskProviderSettingsApiKeyForDisplay(nextApiKey),
                              }));
                              setProviderSettingsError(null);
                            }}
                            placeholder="输入 API Key"
                            className="w-full rounded-2xl border border-[var(--workspace-border)] bg-[var(--workspace-surface-soft)] px-4 py-3 pr-11 text-[14px] text-[var(--workspace-text-primary)] outline-none  placeholder:text-[var(--workspace-text-soft)] focus:border-[var(--workspace-border-strong)] focus:bg-[var(--workspace-surface-elevated)]"
                          />
                          <button
                            type="button"
                            onClick={() => {
                              setIsProviderSettingsApiKeyVisible((prev) => !prev);
                            }}
                            className="workspace-text-muted absolute right-3 top-1/2 inline-flex -translate-y-1/2 items-center justify-center rounded-full p-1.5  hover:bg-[var(--workspace-control-hover)] hover:text-[var(--workspace-text-primary)]"
                            aria-label={isProviderSettingsApiKeyVisible ? '隐藏 API Key' : '显示 API Key'}
                            title={isProviderSettingsApiKeyVisible ? '隐藏 API Key' : '显示 API Key'}
                          >
                            {isProviderSettingsApiKeyVisible ? <EyeOff size={16} /> : <Eye size={16} />}
                          </button>
                        </div>
                      </label>

                      <div className="block">
                        <div className="mb-2 flex items-center justify-between gap-3 text-[12px] font-medium">
                          <span>生图 API Key</span>
                          <span className="workspace-text-muted text-[11px] font-normal">默认使用主 API Key</span>
                        </div>
                        <div className="space-y-2">
                          {providerSettingsImageApiKeys.map((imageApiKeyRow) => (
                            <div key={imageApiKeyRow.id} className="flex items-center gap-2">
                              <div className="relative min-w-0 flex-1">
                                <input
                                  type="text"
                                  id={`provider-image-api-secret-input-${imageApiKeyRow.id}`}
                                  name="provider-image-api-secret-input"
                                  autoComplete="new-password"
                                  autoCorrect="off"
                                  autoCapitalize="none"
                                  spellCheck={false}
                                  data-1p-ignore="true"
                                  data-lpignore="true"
                                  value={imageApiKeyRow.isVisible ? imageApiKeyRow.apiKey : maskProviderSettingsApiKeyForDisplay(imageApiKeyRow.apiKey)}
                                  onChange={(e) => {
                                    const nextImageApiKey = imageApiKeyRow.isVisible
                                      ? e.target.value
                                      : e.target.value.replace(/\*/g, '');
                                    updateProviderSettingsImageApiKeyRows((rows) =>
                                      rows.map((row) =>
                                        row.id === imageApiKeyRow.id
                                          ? {
                                              ...row,
                                              apiKey: nextImageApiKey,
                                              hasApiKey: nextImageApiKey.trim().length > 0,
                                              maskedApiKey: maskProviderSettingsApiKeyForDisplay(nextImageApiKey),
                                            }
                                          : row
                                      )
                                    );
                                    setProviderSettingsError(null);
                                  }}
                                  placeholder="默认使用主 API Key"
                                  className={`w-full rounded-2xl border border-[var(--workspace-border)] bg-[var(--workspace-surface-soft)] px-4 py-3 pr-11 text-[14px] outline-none  placeholder:text-[var(--workspace-text-soft)] focus:border-[var(--workspace-border-strong)] focus:bg-[var(--workspace-surface-elevated)] ${
                                    imageApiKeyRow.apiKey ? 'text-[var(--workspace-text-primary)]' : 'text-[var(--workspace-text-muted)]'
                                  }`}
                                />
                                <button
                                  type="button"
                                  onClick={() => {
                                    updateProviderSettingsImageApiKeyRows((rows) =>
                                      rows.map((row) =>
                                        row.id === imageApiKeyRow.id
                                          ? { ...row, isVisible: !row.isVisible }
                                          : row
                                      )
                                    );
                                  }}
                                  className="workspace-text-muted absolute right-3 top-1/2 inline-flex -translate-y-1/2 items-center justify-center rounded-full p-1.5  hover:bg-[var(--workspace-control-hover)] hover:text-[var(--workspace-text-primary)]"
                                  aria-label={imageApiKeyRow.isVisible ? '隐藏生图 API Key' : '显示生图 API Key'}
                                  title={imageApiKeyRow.isVisible ? '隐藏生图 API Key' : '显示生图 API Key'}
                                >
                                  {imageApiKeyRow.isVisible ? <EyeOff size={16} /> : <Eye size={16} />}
                                </button>
                              </div>
                              <div className="relative shrink-0">
                                <select
                                  value={imageApiKeyRow.scope}
                                  onChange={(e) => {
                                    const nextScope = e.target.value as ProviderImageApiKeyScope;
                                    updateProviderSettingsImageApiKeyRows((rows) =>
                                      rows.map((row) =>
                                        row.id === imageApiKeyRow.id ? { ...row, scope: nextScope } : row
                                      )
                                    );
                                    setProviderSettingsError(null);
                                  }}
                                  className="h-11 appearance-none rounded-2xl border border-[var(--workspace-border)] bg-[var(--workspace-surface-soft)] py-2 pl-3 pr-8 text-[12px] text-[var(--workspace-text-primary)] outline-none  focus:border-[var(--workspace-border-strong)] focus:bg-[var(--workspace-surface-elevated)]"
                                >
                                  {PROVIDER_IMAGE_API_KEY_SCOPE_OPTIONS.map((option) => (
                                    <option key={option.id} value={option.id}>
                                      {option.label}
                                    </option>
                                  ))}
                                </select>
                                <ChevronDown size={14} className="workspace-text-muted pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2" />
                              </div>
                              <button
                                type="button"
                                className="workspace-text-muted inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-[var(--workspace-border)] bg-[var(--workspace-surface-soft)]  hover:bg-[var(--workspace-control-hover)] hover:text-red-500"
                                onClick={() => handleProviderSettingsRemoveImageApiKey(imageApiKeyRow.id)}
                                aria-label="删除生图 API"
                                title="删除生图 API"
                              >
                                <Trash2 size={15} />
                              </button>
                            </div>
                          ))}
                        </div>
                        <button
                          type="button"
                          className="workspace-control-chip mt-2 inline-flex h-9 items-center justify-center rounded-[14px] px-3 text-[12px] font-semibold tracking-[-0.02em]"
                          onClick={handleProviderSettingsAddImageApiKey}
                        >
                          添加生图 API
                        </button>
                      </div>

                      <div className="rounded-2xl border border-[var(--workspace-border)] bg-[var(--workspace-surface-soft)] p-4">
                        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                          <div>
                            <div className="text-[12px] font-medium text-[var(--workspace-text-primary)]">模型列表</div>
                            <div className="workspace-text-muted mt-1 text-[11px]">
                              拉取模型后分类选择，应用并保存到当前供应商
                            </div>
                          </div>
                          <button
                            type="button"
                            className="rounded-full border border-[var(--workspace-border)] px-3 py-1.5 text-[12px] font-medium text-[var(--workspace-text-muted)]  hover:bg-[var(--workspace-control-hover)] hover:text-[var(--workspace-text-primary)] disabled:cursor-not-allowed disabled:opacity-50"
                            onClick={() => {
                              void handleProviderSettingsFetchModels();
                            }}
                            disabled={providerSettingsFetchingModels}
                          >
                            {providerSettingsFetchingModels ? '拉取中…' : '拉取模型'}
                          </button>
                        </div>

                        <div className="grid gap-3 sm:grid-cols-2">
                          <div className="rounded-[18px] border border-[var(--workspace-border)] bg-[var(--workspace-surface-elevated)] p-3">
                            <div className="mb-2 flex items-center justify-between gap-2">
                              <div className="text-[12px] font-medium">图片模型</div>
                              <div className="workspace-text-muted text-[11px]">{selectedProviderSettings.imageModels.length} 个</div>
                            </div>
                            <div className="panel-scrollbar h-[156px] overflow-y-auto rounded-[16px] border border-[var(--workspace-border)]">
                              {providerSettingsSelectedModelRows.image.length > 0 ? (
                                providerSettingsSelectedModelRows.image.map((model) => (
                                  <div
                                    key={`image-${model.id}`}
                                    className="flex items-center justify-between gap-3 border-b border-[var(--workspace-border)] px-3 py-2.5 last:border-b-0"
                                  >
                                    <div className="min-w-0">
                                      <div className="truncate text-[13px] font-medium text-[var(--workspace-text-primary)]">{model.id}</div>
                                      <div className="workspace-text-muted mt-0.5 text-[11px]">图片模型</div>
                                    </div>
                                    <div className="flex shrink-0 items-center gap-2">
                                      <select
                                        className="h-7 rounded-full border border-[var(--workspace-border)] bg-[var(--workspace-surface)] px-2 text-[11px] text-[var(--workspace-text-primary)] outline-none  hover:border-[var(--workspace-text-muted)] focus:border-[var(--workspace-accent)]"
                                        value={selectedProviderSettings.modelProtocols?.[model.id] || ''}
                                        onChange={(event) => {
                                          handleProviderSettingsModelProtocolChange(model.id, event.target.value as ProviderProtocol | '');
                                        }}
                                        aria-label={`图片模型协议 ${model.id}`}
                                      >
                                        <option value="">默认</option>
                                        {PROVIDER_PROTOCOL_OPTIONS.map((protocol) => (
                                          <option key={`image-${model.id}-${protocol.id}`} value={protocol.id}>
                                            {protocol.id === 'openai' ? 'OpenAI' : protocol.label}
                                          </option>
                                        ))}
                                      </select>
                                      <button
                                        type="button"
                                        className="workspace-text-muted inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full  hover:bg-[var(--workspace-control-hover)] hover:text-red-500"
                                        onClick={() => {
                                          handleProviderSettingsRemoveModel('image', model.id);
                                        }}
                                        aria-label={`移除图片模型 ${model.id}`}
                                        title={`移除图片模型 ${model.id}`}
                                      >
                                        <Trash2 size={13} />
                                      </button>
                                    </div>
                                  </div>
                                ))
                              ) : (
                                <div className="workspace-text-muted flex h-full items-center justify-center px-3 text-[12px]">尚未选择图片模型</div>
                              )}
                            </div>
                          </div>
                          <div className="rounded-[18px] border border-[var(--workspace-border)] bg-[var(--workspace-surface-elevated)] p-3">
                            <div className="mb-2 flex items-center justify-between gap-2">
                              <div className="text-[12px] font-medium">聊天模型</div>
                              <div className="workspace-text-muted text-[11px]">{selectedProviderSettings.chatModels.length} 个</div>
                            </div>
                            <div className="panel-scrollbar h-[156px] overflow-y-auto rounded-[16px] border border-[var(--workspace-border)]">
                              {providerSettingsSelectedModelRows.chat.length > 0 ? (
                                providerSettingsSelectedModelRows.chat.map((model) => (
                                  <div
                                    key={`chat-${model.id}`}
                                    className="flex items-center justify-between gap-3 border-b border-[var(--workspace-border)] px-3 py-2.5 last:border-b-0"
                                  >
                                    <div className="min-w-0">
                                      <div className="truncate text-[13px] font-medium text-[var(--workspace-text-primary)]">{model.id}</div>
                                      <div className="workspace-text-muted mt-0.5 text-[11px]">聊天模型</div>
                                    </div>
                                    <div className="flex shrink-0 items-center gap-2">
                                      <select
                                        className="h-7 rounded-full border border-[var(--workspace-border)] bg-[var(--workspace-surface)] px-2 text-[11px] text-[var(--workspace-text-primary)] outline-none  hover:border-[var(--workspace-text-muted)] focus:border-[var(--workspace-accent)]"
                                        value={selectedProviderSettings.modelProtocols?.[model.id] || ''}
                                        onChange={(event) => {
                                          handleProviderSettingsModelProtocolChange(model.id, event.target.value as ProviderProtocol | '');
                                        }}
                                        aria-label={`聊天模型协议 ${model.id}`}
                                      >
                                        <option value="">默认</option>
                                        {PROVIDER_PROTOCOL_OPTIONS.map((protocol) => (
                                          <option key={`chat-${model.id}-${protocol.id}`} value={protocol.id}>
                                            {protocol.id === 'openai' ? 'OpenAI' : protocol.label}
                                          </option>
                                        ))}
                                      </select>
                                      <button
                                        type="button"
                                        className="workspace-text-muted inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full  hover:bg-[var(--workspace-control-hover)] hover:text-red-500"
                                        onClick={() => {
                                          handleProviderSettingsRemoveModel('chat', model.id);
                                        }}
                                        aria-label={`移除聊天模型 ${model.id}`}
                                        title={`移除聊天模型 ${model.id}`}
                                      >
                                        <Trash2 size={13} />
                                      </button>
                                    </div>
                                  </div>
                                ))
                              ) : (
                                <div className="workspace-text-muted flex h-full items-center justify-center px-3 text-[12px]">尚未选择聊天模型</div>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[var(--workspace-border)] bg-[var(--workspace-surface-soft)] px-4 py-3 text-[12px] leading-5 text-[var(--workspace-text-muted)]">
                        <div>
                          配置来源：
                          <span className="ml-1 text-[var(--workspace-text-primary)]">{selectedProviderSettings.source === 'runtime' ? '运行时配置' : '环境变量回退'}</span>
                          <span className="mx-2">·</span>
                          {selectedProviderSettings.primary ? '当前主供应商' : '备用供应商'}
                        </div>
                        <div className="flex items-center gap-2">
                          {providerSettingsTesting && (
                            <span className="text-[12px] font-medium text-[var(--workspace-text-primary)]">测试中…</span>
                          )}
                          {!providerSettingsTesting && providerSettingsTestResult && (
                            <span className={`text-[12px] font-medium ${
                              providerSettingsTestResult.ok
                                ? 'text-emerald-700 dark:text-emerald-300'
                                : 'text-red-700 dark:text-red-300'
                            }`}>
                              {providerSettingsTestResult.ok
                                ? `连接成功${providerSettingsTestResult.modelCount > 0 ? `，找到 ${providerSettingsTestResult.modelCount} 个模型` : ''}`
                                : providerSettingsTestResult.message}
                            </span>
                          )}
                          <button
                            type="button"
                            className="rounded-full border border-[var(--workspace-border)] px-3 py-1.5 text-[12px] font-medium text-[var(--workspace-text-muted)]  hover:bg-[var(--workspace-control-hover)] hover:text-[var(--workspace-text-primary)]"
                            onClick={() => {
                              setProviderSettingsProviders((prev) =>
                                prev.map((provider) => ({
                                  ...provider,
                                  primary: provider.id === selectedProviderSettings.id,
                                }))
                              );
                            }}
                          >
                            设为主供应商
                          </button>
                          <button
                            type="button"
                            className="rounded-full border border-[var(--workspace-border)] px-3 py-1.5 text-[12px] font-medium text-[var(--workspace-text-muted)]  hover:bg-[var(--workspace-control-hover)] hover:text-[var(--workspace-text-primary)] disabled:cursor-not-allowed disabled:opacity-50"
                            onClick={() => {
                              void handleProviderSettingsTestConnection();
                            }}
                            disabled={providerSettingsTesting}
                          >
                            {providerSettingsTesting ? '测试中…' : '测试连接'}
                          </button>
                        </div>
                      </div>

                      {providerSettingsTestResult && (
                        <div className={`rounded-2xl border px-4 py-3 text-[12px] leading-5 ${
                          providerSettingsTestResult.ok
                            ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                            : 'border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300'
                        }`}>
                          {providerSettingsTestResult.ok ? providerSettingsTestResult.message : `连接失败：${providerSettingsTestResult.message.replace(/^连接失败：/, '')}`}
                          {providerSettingsTestResult.ok && providerSettingsTestResult.modelCount > 0
                            ? ` · 找到 ${providerSettingsTestResult.modelCount} 个模型`
                            : ''}
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="rounded-[22px] border border-[var(--workspace-border)] bg-[var(--workspace-surface-soft)] px-4 py-6 text-center text-[13px] text-[var(--workspace-text-muted)]">
                    暂无供应商配置
                  </div>
                )}
              </div>

              {providerSettingsModelPickerOpen && providerSettingsFetchedModels && selectedProviderSettings && (
                <div className="absolute inset-0 z-[2]">
                  <button
                    type="button"
                    className="absolute inset-0 bg-black/30"
                    aria-label="关闭模型选择"
                    onClick={() => {
                      setProviderSettingsModelPickerOpen(false);
                    }}
                  />
                  <div className="relative z-[1] flex h-full items-center justify-center p-6">
                    <div className="workspace-popover-panel flex h-[420px] max-h-[52vh] min-h-[320px] w-full max-w-[640px] flex-col rounded-[24px] p-4">
                      <div className="mb-3 flex shrink-0 flex-wrap items-center justify-between gap-3">
                        <div>
                          <div className="text-[13px] font-semibold text-[var(--workspace-text-primary)]">模型选择</div>
                          <div className="workspace-text-muted mt-1 text-[11px]">
                            已选图片 {providerSettingsSelectedFetchedModelTotals.image} 个，聊天 {providerSettingsSelectedFetchedModelTotals.chat} 个
                          </div>
                        </div>
                        <button
                          type="button"
                          className="rounded-full border border-[var(--workspace-border)] px-3 py-1.5 text-[12px] font-medium text-[var(--workspace-text-muted)]  hover:bg-[var(--workspace-control-hover)] hover:text-[var(--workspace-text-primary)]"
                          onClick={() => {
                            setProviderSettingsModelPickerOpen(false);
                          }}
                        >
                          收起
                        </button>
                      </div>
                      <input
                        value={providerSettingsModelPickerSearch}
                        name="provider-model-picker-search"
                        autoComplete="off"
                        autoCorrect="off"
                        autoCapitalize="none"
                        spellCheck={false}
                        onChange={(e) => {
                          setProviderSettingsModelPickerSearch(e.target.value);
                        }}
                        placeholder="搜索模型"
                        className="mb-3 w-full shrink-0 rounded-2xl border border-[var(--workspace-border)] bg-[var(--workspace-surface-soft)] px-4 py-2.5 text-[13px] text-[var(--workspace-text-primary)] outline-none  placeholder:text-[var(--workspace-text-soft)] focus:border-[var(--workspace-border-strong)] focus:bg-[var(--workspace-surface-elevated)]"
                      />
                      <div className="mb-3 flex shrink-0 flex-wrap gap-2">
                        {PROVIDER_SETTINGS_MODEL_PICKER_CATEGORIES.map((category) => (
                          <button
                            key={category}
                            type="button"
                            className={`workspace-control-chip rounded-full px-3 py-1.5 text-[12px] font-medium ${providerSettingsModelPickerCategory === category ? 'is-active' : ''}`}
                            onClick={() => {
                              setProviderSettingsModelPickerCategory(category);
                            }}
                          >
                            {PROVIDER_SETTINGS_MODEL_PICKER_LABELS[category]}
                            <span className="ml-1 opacity-70">
                              {providerSettingsSelectedFetchedModelTotals[category]}/{providerSettingsFetchedModelTotals[category]}
                            </span>
                          </button>
                        ))}
                      </div>
                      <div className="panel-scrollbar min-h-0 flex-1 overflow-y-auto rounded-[16px] border border-[var(--workspace-border)]">
                        {providerSettingsFetchedModelRows.length > 0 ? (
                          providerSettingsFetchedModelRows.map((model) => {
                            const isSelected = !!providerSettingsSelectedFetchedModels[model.id];
                            return (
                              <button
                                key={model.id}
                                type="button"
                                className={`workspace-menu-item flex w-full items-center justify-between gap-3 border-b border-[var(--workspace-border)] px-3 py-2.5 text-left last:border-b-0 ${isSelected ? 'is-selected' : ''}`}
                                onClick={() => {
                                  setProviderSettingsSelectedFetchedModels((prev) => ({
                                    ...prev,
                                    [model.id]: !prev[model.id],
                                  }));
                                }}
                              >
                                <div className="min-w-0">
                                  <div className="truncate text-[13px] font-medium text-[var(--workspace-text-primary)]">{model.id}</div>
                                  <div className="workspace-text-muted mt-0.5 text-[11px]">
                                    {model.category === 'image' ? '图片模型' : '聊天模型'}
                                    {model.sources.length > 0 ? ` · 来源：${model.sources.join('、')}` : ''}
                                  </div>
                                </div>
                                <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${isSelected ? 'border-[var(--workspace-border-strong)] bg-[var(--workspace-control-active)]' : 'border-[var(--workspace-border)]'}`}>
                                  {isSelected && <Check size={13} />}
                                </span>
                              </button>
                            );
                          })
                        ) : (
                          <div className="workspace-text-muted px-3 py-6 text-center text-[12px]">没有匹配的模型</div>
                        )}
                      </div>
                      <div className="mt-3 flex shrink-0 flex-wrap items-center justify-between gap-3">
                        <div className="workspace-text-muted text-[11px]">
                          共 {providerSettingsFetchedModelTotals.all} 个模型，已选 {providerSettingsSelectedFetchedModelTotals.all} 个
                        </div>
                        <button
                          type="button"
                          className="rounded-full bg-[var(--workspace-inverse-bg)] px-4 py-2 text-[13px] font-semibold text-[var(--workspace-inverse-fg)]  hover:opacity-90"
                          onClick={handleProviderSettingsApplyFetchedModels}
                        >
                          应用选择
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              <div className="workspace-subtle-divider flex items-center justify-end gap-3 border-t px-6 py-4">
                <button
                  type="button"
                  className="rounded-full border border-[var(--workspace-border)] px-4 py-2 text-[13px] font-medium text-[var(--workspace-text-muted)]  hover:bg-[var(--workspace-control-hover)] hover:text-[var(--workspace-text-primary)]"
                  onClick={closeProviderSettingsModal}
                  disabled={providerSettingsSaving}
                >
                  取消
                </button>
                <button
                  type="button"
                  className="rounded-full bg-[var(--workspace-inverse-bg)] px-4 py-2 text-[13px] font-semibold text-[var(--workspace-inverse-fg)]  hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                  onClick={() => {
                    void handleProviderSettingsSave();
                  }}
                  disabled={providerSettingsLoading || providerSettingsSaving}
                >
                  {providerSettingsSaving ? '保存中…' : '保存'}
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}

      {(modelSelectionNotice || imageToolbarNotice) && (
        <div
          className="pointer-events-none fixed inset-x-0 top-4 flex justify-center px-4"
          style={{ zIndex: GLOBAL_NOTICE_Z }}
        >
          <div className="workspace-floating-control rounded-full px-4 py-2 text-[12px] font-medium tracking-[-0.02em]" data-gsap-enter="true">
            {modelSelectionNotice || imageToolbarNotice}
          </div>
        </div>
      )}

      <div
        data-canvas-bottom-toolbar="true"
        data-canvas-overlay-root="true"
        className="absolute bottom-4 left-1/2 z-50 -translate-x-1/2"
      >
        <div
          ref={canvasBottomToolbarMotionRef}
          className="workspace-bottom-toolbar workspace-bottom-toolbar-motion relative flex items-center gap-2 rounded-[14px] px-1.5 py-1.5"
        >
        {tool === 'draw' && (
          <div
            className="workspace-menu-panel absolute bottom-full left-1/2 mb-2 flex -translate-x-1/2 items-center gap-2 rounded-xl px-2.5 py-2"
            role="group"
            aria-label="画笔设置"
          >
            <div className="flex items-center gap-1" aria-label="画笔颜色">
              {ANNOTATION_COLORS.map((color) => (
                <button
                  key={color}
                  type="button"
                  onClick={() => setAnnotationColor(color)}
                  className={`h-5 w-5 rounded-full border  ${
                    annotationColor === color
                      ? 'border-[var(--workspace-text)] ring-1 ring-[var(--workspace-text)]'
                      : 'border-[var(--workspace-border)]'
                  }`}
                  style={{ backgroundColor: color }}
                  aria-label={`选择画笔颜色 ${color}`}
                  aria-pressed={annotationColor === color}
                />
              ))}
            </div>
            <div className="h-5 w-px bg-[var(--workspace-border)]" />
            <div className="flex items-center gap-1" aria-label="画笔粗细">
              {ANNOTATION_STROKE_WIDTHS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setAnnotationStrokeWidth(option.value)}
                  className={`workspace-control-chip inline-flex h-7 min-w-7 items-center justify-center rounded-lg px-1.5 text-[10px] ${
                    annotationStrokeWidth === option.value ? 'is-active' : ''
                  }`}
                  aria-pressed={annotationStrokeWidth === option.value}
                  title={`${option.label}画笔`}
                >
                  <span
                    className="block rounded-full bg-current"
                    style={{ width: 14, height: Math.max(2, Math.min(8, option.value)) }}
                  />
                </button>
              ))}
            </div>
          </div>
        )}
        {CANVAS_BOTTOM_TOOLBAR_ITEMS.map((item) => {
          const isActive =
            (item.id === 'select' && tool === 'select') ||
            (item.id === 'target' && tool === 'target') ||
            (item.id === 'draw' && tool === 'draw') ||
            (item.id === 'text' && tool === 'annotation-text');
          const svgOpacity = 'svgOpacity' in item ? item.svgOpacity : 0.9;

          return (
            <button
              key={item.id}
              type="button"
              aria-label={item.label}
              title={item.label}
              onClick={() => handleCanvasBottomToolbarAction(item.id, 'action' in item ? item.action : undefined)}
              className={`workspace-bottom-toolbar-item inline-flex h-8 w-8 items-center justify-center rounded-[9px]  ${
                isActive
                  ? 'is-active'
                  : ''
              }`}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path fill="currentColor" fillOpacity={svgOpacity} d={item.svgPath} />
              </svg>
            </button>
          );
        })}
        </div>
      </div>

      {/* Zoom Controller - Outside Canvas */}
      <div
        ref={zoomControlRef}
        data-canvas-overlay-root="true"
        className="absolute left-4 bottom-4 z-[130]"
        data-zoom-control="true"
        onPointerEnter={() => setZoomMenuOpen(true)}
        onPointerLeave={() => setZoomMenuOpen(false)}
        onFocus={() => setZoomMenuOpen(true)}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setZoomMenuOpen(false);
        }}
      >
        <div ref={zoomMenuRef} className="invisible pointer-events-none absolute bottom-full left-0 mb-2 opacity-0">
          <div className="workspace-menu-panel pointer-events-auto w-[198px] rounded-xl p-2">
            <button
              type="button"
              className="workspace-menu-item flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-xs"
              onClick={() => applyViewportScale(visualViewportRef.current.scale + 0.1)}
            >
              <span>放大</span>
              <span className="workspace-text-soft">⌘ +</span>
            </button>
            <button
              type="button"
              className="workspace-menu-item flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-xs"
              onClick={() => applyViewportScale(visualViewportRef.current.scale - 0.1)}
            >
              <span>缩小</span>
              <span className="workspace-text-soft">⌘ -</span>
            </button>
            <button
              type="button"
              className="workspace-menu-item flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-xs"
              onClick={fitCanvasItemsToViewport}
            >
              <span>显示画布所有元素</span>
              <span className="workspace-text-soft">⇧ 1</span>
            </button>
            <div className="my-1 border-t border-[var(--workspace-border)]" />
            <button
              type="button"
              className="workspace-menu-item flex w-full items-center rounded-md px-2 py-1.5 text-left text-xs"
              onClick={() => applyViewportScale(0.5)}
            >
              缩放至 50%
            </button>
            <button
              type="button"
              className="workspace-menu-item flex w-full items-center rounded-md px-2 py-1.5 text-left text-xs"
              onClick={() => applyViewportScale(1)}
            >
              缩放至 100%
            </button>
            <button
              type="button"
              className="workspace-menu-item flex w-full items-center rounded-md px-2 py-1.5 text-left text-xs"
              onClick={() => applyViewportScale(2)}
            >
              缩放至 200%
            </button>
          </div>
        </div>
        <button
          type="button"
          className="workspace-text-muted rounded-md px-2 py-1 text-xs font-medium  hover:bg-[var(--workspace-control-hover)] focus-visible:outline-none group-hover:bg-[var(--workspace-control-hover)] group-focus-within:bg-[var(--workspace-control-hover)]"
          aria-label="画布缩放菜单"
        >
          <span ref={zoomPercentageRef}>{Math.round(viewport.scale * 100)}%</span>
        </button>
      </div>

      {/* Right Chat Panel */}
      {typeof document !== 'undefined' &&
        createPortal(
          <>
            <div
              ref={chatPanelOpenButtonRef}
              className="workspace-floating-control fixed right-4 top-4 isolate flex h-9 w-9 items-center justify-center rounded-xl"
              style={{
                zIndex: CHAT_PANEL_Z,
                pointerEvents: 'none',
                visibility: 'hidden',
              }}
              aria-hidden="true"
            >
              <button
                className="p-1  hover:text-[var(--workspace-text-primary)]"
                onClick={handleOpenChatPanel}
                title="展开对话"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="15 18 9 12 15 6" />
                </svg>
              </button>
            </div>
            <div
              ref={chatPanelRef}
              className="workspace-chat-panel fixed inset-y-0 left-0 right-0 isolate flex w-auto flex-col overflow-hidden transform-gpu sm:left-auto sm:w-[500px]"
              aria-hidden="false"
              style={{
                zIndex: CHAT_PANEL_Z,
                pointerEvents: 'auto',
                visibility: 'visible',
              }}
            >
          {/* Header */}
          <div className="workspace-subtle-divider flex flex-shrink-0 items-center justify-between border-b px-6 py-4">
            <div className="flex items-center gap-3">
              <h1 className="text-base font-medium">{currentProjectName}</h1>
            </div>
            <div className="flex items-center gap-1">
              <button className="rounded-lg p-2  hover:bg-[var(--workspace-control-hover)]" title="分享">
                <Share2 size={18} className="workspace-text-muted" />
              </button>
              <div className="relative">
                <button 
                  className={`rounded-lg p-2  ${showHistoryPanel ? 'bg-[var(--workspace-control-active)]' : 'hover:bg-[var(--workspace-control-hover)]'}`}
                  title="历史"
                  onClick={() => setShowHistoryPanel(!showHistoryPanel)}
                >
                  <History size={18} className={showHistoryPanel ? "workspace-text-primary" : "workspace-text-muted"} />
                </button>
              </div>
              <button
                className="rounded-lg p-2  hover:bg-[var(--workspace-control-hover)]"
                title="设置"
                onClick={openProviderSettingsModal}
              >
                <Settings size={18} className="workspace-text-muted" />
              </button>
              <button 
                className="rounded-lg p-2  hover:bg-[var(--workspace-control-hover)]"
                title="收缩"
                onClick={handleCloseChatPanel}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="workspace-text-muted">
                  <polyline points="9 18 15 12 9 6" />
                </svg>
              </button>
            </div>
          </div>

          {/* History Panel */}
          {showHistoryPanel && (
            <div className="workspace-subtle-divider border-b bg-[var(--workspace-surface-soft)]">
              <div className="p-3">
                <button 
                  onClick={(e) => { e.stopPropagation(); createNewTopic(); }}
                  className="flex w-full items-center justify-center gap-2 rounded-xl border border-[var(--workspace-border)] bg-[var(--workspace-inverse-bg)] px-3 py-2 text-[var(--workspace-inverse-fg)]  hover:opacity-90"
                >
                  <span className="text-lg">+</span>
                  <span className="text-sm font-medium">新建对话</span>
                </button>
              </div>
              <div className="panel-scrollbar max-h-48 overflow-y-auto pb-2">
                {(getCurrentSession()?.topics || []).map(topic => (
                  <div 
                    key={topic.id}
                    onClick={(e) => { e.stopPropagation(); switchTopic(topic.id); }}
                    className={`workspace-menu-item group flex cursor-pointer items-center gap-2 border-l-2 border-transparent px-4 py-3 ${
                      topic.id === (getCurrentSession()?.activeTopicId) ? 'is-selected' : ''
                    }`}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="truncate text-sm font-medium">{topic.title || '无标题对话'}</div>
                      <div className="workspace-text-muted text-xs">
                        {topic.messages.length} 条消息 · {new Date(topic.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </div>
                    </div>
                    <div className="flex items-center gap-1 opacity-0" data-gsap-hover-reveal="true">
                      <button
                        onClick={(e) => deleteTopic(topic.id, e)}
                        className="rounded-lg p-1.5  hover:bg-red-500/10"
                        title="删除对话"
                      >
                        <Trash2 size={12} className="text-red-500" />
                      </button>
                    </div>
                  </div>
                ))}
                {(getCurrentSession()?.topics || []).length === 0 && (
                  <div className="px-4 py-6 text-center text-xs text-zinc-500">
                    暂无历史对话
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Main Content - Welcome Text Only */}
          {chatMessages.length === 0 && (
            <div className="flex-1 px-6 py-8 flex items-center justify-center">
              {!hideWelcomeByCenterSkillPick && (
                <div>
                  <div className="flex justify-center">
                    <div className="flex flex-col gap-1.5">
                      <div className="flex gap-1.5 justify-center">
                        {quickActions.slice(0, 3).map((action) => (
                          <button
                            key={action.id}
                            onClick={() => handleQuickSkillSelect(action, 'center_quick_action')}
                            className="workspace-token-chip flex items-center gap-1.5 rounded-full px-2 py-1.5 "
                          >
                            <Sparkles size={10} />
                            <span className="text-xs font-medium whitespace-nowrap">{action.label}</span>
                          </button>
                        ))}
                      </div>
                      <div className="flex gap-1.5 justify-center">
                        {quickActions.slice(3, 5).map((action) => (
                          <button
                            key={action.id}
                            onClick={() => handleQuickSkillSelect(action, 'center_quick_action')}
                            className="workspace-token-chip flex items-center gap-1.5 rounded-full px-2 py-1.5 "
                          >
                            <Sparkles size={10} />
                            <span className="text-xs font-medium whitespace-nowrap">{action.label}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Chat Messages */}
          {chatMessages.length > 0 && (
            <div className="relative min-h-0 flex-1">
              <div
                ref={chatContainerRef}
                className="panel-scrollbar h-full overflow-y-auto px-6 py-4"
                onScroll={handleChatContainerScroll}
                onWheel={cancelProgrammaticChatScroll}
                onPointerDown={cancelProgrammaticChatScroll}
              >
              <div ref={chatMessagesContentRef} className="space-y-4 pb-11">
                {hiddenChatMessageCount > 0 && (
                  <div className="flex justify-center pb-1">
                    <button
                      type="button"
                      className="workspace-control-chip rounded-full px-3 py-1.5 text-[11px]"
                      onClick={() => setVisibleChatMessageLimit((current) => current + 80)}
                    >
                      加载更早的消息（剩余 {hiddenChatMessageCount} 条）
                    </button>
                  </div>
                )}
                {visibleChatMessages.map((msg) => {
                  const isAgentProgressMessage = msg.role === 'assistant'
                    && shouldShowAgentRunProgress(msg.agentRunProgress);
                  const userInlineContent = msg.role === 'user'
                    ? resolveChatMessageInlineContent(msg)
                    : [];
                  return (
                    <div
                      key={msg.id}
                      className={`chat-message-window-row flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                    >
                  {msg.role === 'user' ? (
                    <div className="flex flex-col items-end max-w-[90%]">
                      {msg.skill && (
                        <div className="workspace-token-chip mb-[10px] flex w-fit items-center gap-0.5 rounded-md px-1 py-0.5">
                          <Sparkles size={8} className="flex-shrink-0" />
                          <span className="text-[10px] font-bold leading-none">{msg.skill.label}</span>
                        </div>
                      )}
                      <div
                        className="workspace-message-user panel-scrollbar overflow-y-auto rounded-[20px] px-3.5 py-2.5"
                        style={{ maxHeight: '240px' }}
                      >
                        <div className="text-sm leading-7 whitespace-pre-wrap break-words">
                          {userInlineContent.map((segment, index) => segment.type === 'text' ? (
                            <React.Fragment key={`${msg.id}-text-${index}`}>{segment.text}</React.Fragment>
                          ) : (
                            <span
                              key={`${msg.id}-reference-${segment.id}-${index}`}
                              className="workspace-reference-token mx-0.5 inline-flex h-7 max-w-[172px] items-center gap-1 rounded-lg px-1.5 align-middle text-[11px] leading-none"
                              title={segment.label}
                            >
                              <span className="relative h-5 w-5 shrink-0 overflow-hidden rounded-md">
                                <Image
                                  src={segment.src}
                                  alt=""
                                  fill
                                  unoptimized
                                  sizes="20px"
                                  className="object-cover"
                                />
                              </span>
                              <span className="min-w-0 truncate font-medium">{segment.label}</span>
                              {segment.annotationCount ? (
                                <span className="shrink-0 rounded-md bg-red-500/12 px-1 py-0.5 text-[9px] font-medium text-red-500">
                                  {segment.annotationCount} 条
                                </span>
                              ) : null}
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>
                  ) : msg.role === 'skill' ? (
                    <div className="workspace-message-assistant group relative flex max-w-[90%] items-center gap-2 rounded-2xl p-3" data-gsap-hover-root="true" data-gsap-no-scale="true">
                      <Sparkles size={14} className="flex-shrink-0" />
                      <span className="text-sm font-medium">{msg.skill?.label}</span>
                      <button
                        onClick={() => {
                          const nextMessages = chatMessages.filter((m) => m.id !== msg.id);
                          setChatMessages(nextMessages);
                          if (nextMessages.length === 0) {
                            setHideWelcomeByCenterSkillPick(false);
                          }
                          setActiveSkillForCurrentTopic(null);
                        }}
                        className="absolute -right-2 -top-2 flex h-5 w-5 items-center justify-center rounded-full border border-[var(--workspace-border)] bg-[var(--workspace-surface-elevated)] text-xs opacity-0 hover:bg-[var(--workspace-control-hover)]"
                        data-gsap-hover-reveal="true"
                      >
                        ×
                      </button>
                    </div>
                  ) : (
                    <div className={`group relative max-w-[90%] ${isAgentProgressMessage ? 'py-1' : 'workspace-message-assistant rounded-[22px] px-3.5 py-3'}`} data-gsap-hover-root="true" data-gsap-no-scale="true">
                      {!isAgentProgressMessage && msg.content && !(msg.content === '...' && msg.taskStatus === 'running') && (
                        <button
                          type="button"
                          onPointerDown={(e) => {
                            e.stopPropagation();
                          }}
                          onMouseDown={(e) => {
                            e.stopPropagation();
                          }}
                          onClick={(e) => {
                            e.stopPropagation();
                            void handleCopyAssistantMessage(msg.id, msg.content);
                          }}
                          className="workspace-control-chip absolute right-3 top-3 z-[2] inline-flex h-7 items-center gap-1 rounded-lg px-2 text-[11px] opacity-0"
                          data-gsap-hover-reveal="true"
                          aria-label="复制正文"
                          title="复制正文"
                        >
                          {copiedAssistantMessageId === msg.id ? (
                            <>
                              <Check size={12} />
                              <span>已复制</span>
                            </>
                          ) : (
                            <>
                              <Copy size={12} />
                              <span>复制</span>
                            </>
                          )}
                        </button>
                      )}
                      {msg.resolvedContext && (
                        <div className="workspace-token-chip mb-2 inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11px]">
                          <span aria-hidden="true">🔗</span>
                          <span>{`已采用：${msg.resolvedContext.labels.join('、')}`}</span>
                        </div>
                      )}
                      {isAgentProgressMessage && msg.agentRunProgress && (
                        <div
                          className="space-y-1 py-0.5 text-[13px] leading-5"
                          role="status"
                          aria-live="polite"
                        >
                          {msg.agentRunProgress.steps.map((step) => {
                            const canOpenDecision = step.status === 'waiting' && hasPendingAgentDecision(msg);
                            const className = `agent-progress-enter flex min-h-7 items-center gap-2.5 rounded-md text-left ${
                              canOpenDecision ? '-mx-1 px-1  hover:bg-[var(--workspace-control-hover)]' : ''
                            } ${
                              step.status === 'failed'
                                ? 'text-red-600 dark:text-red-300'
                                : step.status === 'completed'
                                  ? 'workspace-text-muted'
                                  : 'workspace-text-primary'
                            }`;
                            const content = (
                              <>
                                <span className="w-3 flex-none text-center text-[12px]" aria-hidden="true">
                                  {getAgentProgressMarker(step.status)}
                                </span>
                                <span>
                                  {formatAgentProgressLabel(step)}
                                  {getAgentProgressDurationLabel(step, generationClockMs)
                                    ? ` · ${getAgentProgressDurationLabel(step, generationClockMs)}`
                                    : ''}
                                </span>
                              </>
                            );
                            return canOpenDecision ? (
                              <button
                                key={`${step.stepId}:${step.toolCallId || ''}`}
                                type="button"
                                className={className}
                                onClick={() => openPendingAgentDecision(msg)}
                                aria-label={`重新打开选择：${getPendingAgentDecisionLabel(msg)}`}
                              >
                                {content}
                              </button>
                            ) : (
                              <div key={`${step.stepId}:${step.toolCallId || ''}`} className={className}>
                                {content}
                              </div>
                            );
                          })}
                          {['completed', 'warning', 'failed'].includes(msg.agentRunProgress.outcome) && (
                            <div className={`agent-progress-enter flex min-h-7 items-center gap-2.5 ${
                              msg.agentRunProgress.outcome === 'failed'
                                ? 'text-red-600 dark:text-red-300'
                                : msg.agentRunProgress.outcome === 'warning'
                                  ? 'text-amber-600 dark:text-amber-300'
                                  : 'workspace-text-primary'
                            }`}>
                              <span className="w-3 flex-none text-center text-[12px]" aria-hidden="true">
                                {getAgentProgressMarker(msg.agentRunProgress.outcome)}
                              </span>
                              <span>
                                {getAgentProgressCompletionLabel(msg.agentRunProgress)}
                              </span>
                              {msg.agentRunProgress.outcome === 'failed' && (
                              <button
                                type="button"
                                className="workspace-control-chip ml-1 rounded-md px-2 py-0.5 text-[11px]"
                                onClick={() => {
                                  const messageIndex = chatMessages.findIndex((item) => item.id === msg.id);
                                  const sourceMessage = [...chatMessages.slice(0, messageIndex)]
                                    .reverse()
                                    .find((item) => item.role === 'user');
                                  if (sourceMessage && !isGenerating) {
                                    if (sourceMessage.agentClarificationResponsePayload) {
                                      void handleGenerate({
                                        input: sourceMessage.content,
                                        skill: sourceMessage.skill,
                                        agentClarification: sourceMessage.agentClarificationResponsePayload.clarification,
                                        agentClarificationResponse: sourceMessage.agentClarificationResponsePayload.response,
                                      });
                                      return;
                                    }
                                    void handleGenerate({
                                      input: sourceMessage.content,
                                      skill: sourceMessage.skill,
                                    });
                                  }
                                }}
                              >
                                {msg.agentRunProgress.intent === 'image' ? '重试生成' : '重试'}
                              </button>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                      {isAgentProgressMessage && msg.content && (
                        <div className="workspace-message-assistant mt-2 rounded-[22px] px-3.5 py-3">
                          <MarkdownMessage
                            content={msg.content}
                            onPointerDown={handleAssistantSelectablePointerDown}
                            onMouseDown={handleAssistantSelectableMouseDown}
                            onClick={handleAssistantSelectableClick}
                          />
                          {msg.model && <div className="mt-1.5 text-xs text-zinc-500">模型: {msg.model}</div>}
                        </div>
                      )}
                      {!isAgentProgressMessage && msg.taskStatus && (
                        <div className="mb-1.5">
                          {msg.taskStatus === 'queued' && (
                            <span className="workspace-status-pill inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px]">排队中</span>
                          )}
                          {msg.taskStatus === 'completed' && !msg.imageUrl && (
                            <span className="workspace-status-pill inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] text-emerald-700 dark:text-emerald-300">已完成</span>
                          )}
                          {msg.taskStatus === 'failed' && (
                            <span className="workspace-status-pill inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] text-red-700 dark:text-red-300">失败</span>
                          )}
                          {msg.taskStatus === 'cancelled' && (
                            <span className="workspace-status-pill inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px]">已终止</span>
                          )}
                        </div>
                      )}
                      {!isAgentProgressMessage && (msg.content === '...' && msg.taskStatus === 'running' ? (
                        <p className="text-sm whitespace-pre-wrap inline-flex items-center gap-1" aria-label="加载中">
                          <span className="gsap-bounce w-1.5 h-1.5 rounded-full bg-zinc-400" data-gsap-delay="0" />
                          <span className="gsap-bounce w-1.5 h-1.5 rounded-full bg-zinc-400" data-gsap-delay="0.15" />
                          <span className="gsap-bounce w-1.5 h-1.5 rounded-full bg-zinc-400" data-gsap-delay="0.3" />
                        </p>
                      ) : (
                        msg.content && (
                          <div className="pr-14">
                            <MarkdownMessage
                              content={msg.content}
                              onPointerDown={handleAssistantSelectablePointerDown}
                              onMouseDown={handleAssistantSelectableMouseDown}
                              onClick={handleAssistantSelectableClick}
                            />
                          </div>
                        )
                      ))}
                      {hasPendingAgentDecision(msg)
                        && !msg.agentRunProgress?.steps.some((step) => step.status === 'waiting') && (
                        <button
                          type="button"
                          onClick={() => openPendingAgentDecision(msg)}
                          className="agent-progress-enter workspace-text-primary mt-2 flex min-h-7 items-center gap-2.5 rounded-md px-1 text-left text-[13px] leading-5  hover:bg-[var(--workspace-control-hover)]"
                        >
                          <span className="w-3 flex-none text-center text-[12px]" aria-hidden="true">⏸</span>
                          <span>{getPendingAgentDecisionLabel(msg)}</span>
                        </button>
                      )}
                      {msg.imageUrl && msg.resultTitle && msg.model && (
                        <div className="workspace-text-muted mb-2 text-xs">{msg.model}</div>
                      )}
                      {(msg.resultTitle || msg.imageName) && (
                        <div className="workspace-text-primary mb-2 text-sm font-semibold">
                          {msg.resultTitle || msg.imageName}
                        </div>
                      )}
                      {msg.imageUrl && (
                        <Image
                          src={msg.imageUrl}
                          alt="Generated"
                          width={1024}
                          height={1024}
                          unoptimized
                          sizes="(max-width: 768px) 90vw, 720px"
                          className="h-auto w-full rounded-lg"
                        />
                      )}
                      {!isAgentProgressMessage && msg.model && !msg.resultTitle && (
                        <div className="workspace-text-muted mt-1.5 text-xs">模型: {msg.model}</div>
                      )}
                    </div>
                  )}
                    </div>
                  );
                })}
              </div>
              </div>
              {!isChatNearBottom && (
                <button
                  type="button"
                  className="workspace-chat-scroll-bottom absolute bottom-3 left-1/2 z-10 inline-flex h-8 w-8 -translate-x-1/2 items-center justify-center rounded-full"
                  data-gsap-enter="true"
                  onClick={() => scrollChatToBottom()}
                  aria-label="滚动到最新消息"
                  title="滚动到最新消息"
                >
                  <ArrowDown size={15} strokeWidth={2} />
                </button>
              )}
            </div>
          )}

          <div className="relative flex-shrink-0">
          {showAgentConfirmationModal && pendingAgentConfirmation && (
            <AgentDecisionPopover
              title={pendingAgentConfirmation.message}
              options={[{
                id: 'confirm',
                label: pendingAgentConfirmation.toolName === 'generate_image' ? '确认生成图片' : '确认执行操作',
                description: '确认后立即开始执行。',
                recommended: true,
              }]}
              onSelect={() => submitAgentConfirmation()}
              onClose={closeAgentConfirmationModal}
              skipLabel="暂不执行"
              onSkip={closeAgentConfirmationModal}
            />
          )}

          {showAgentProposalModal && pendingAgentProposal && (
            <AgentDecisionPopover
              title={pendingAgentProposal.title}
              options={pendingAgentProposal.options.map((option) => ({
                id: option.entityId,
                label: option.label,
                description: option.summary,
              }))}
              onSelect={(entityId) => {
                const option = pendingAgentProposal.options.find((item) => item.entityId === entityId);
                if (option) submitAgentProposal(pendingAgentProposal, option);
              }}
              onClose={closeAgentProposalModal}
              skipLabel="稍后选择"
              onSkip={closeAgentProposalModal}
            />
          )}

          {showAgentClarificationModal && pendingAgentClarification && (
            <AgentDecisionPopover
              title={pendingAgentClarification.request.question}
              options={pendingAgentClarification.request.failed
                ? [{ id: 'retry', label: '重新分析', description: '保留当前任务并发起一次新的多模态分析。', recommended: true, disabled: isGenerating }]
                : pendingAgentClarification.request.options.map((option, index) => ({
                    id: option.id,
                    label: option.label,
                    description: option.description,
                    recommended: index === 0,
                  }))}
              onSelect={(optionId) => {
                if (optionId === 'retry') retryAgentClarification();
                else submitAgentClarification(false, optionId);
              }}
              onClose={closeAgentClarificationModal}
              {...(!pendingAgentClarification.request.failed
                && !['creative_direction', 'context_reference'].includes(pendingAgentClarification.request.dimension)
                ? { skipLabel: '按当前信息开始制作', onSkip: () => submitAgentClarification(true) }
                : {})}
              {...(!pendingAgentClarification.request.failed
                ? {
                    custom: {
                      label: '自定义回答',
                      placeholder: '输入你希望调整的方向…',
                      value: agentClarificationCustomText,
                      onChange: setAgentClarificationCustomText,
                      onSubmit: () => submitAgentClarification(false, 'custom'),
                    },
                  }
                : {})}
            />
          )}

          {showSkillChoiceModal && pendingSkillChoice && (
            <AgentDecisionPopover
              title={pendingSkillChoice.message || pendingSkillChoice.title}
              options={pendingSkillChoice.options.map((option, index) => ({
                id: String(index),
                label: option.label,
                recommended: index === 0,
              }))}
              onSelect={(optionId) => {
                const option = pendingSkillChoice.options[Number(optionId)];
                if (option) handleSubmitSkillChoice(pendingSkillChoice, option);
              }}
              onClose={handleCloseSkillChoiceModal}
              skipLabel="稍后再选"
              onSkip={handleCloseSkillChoiceModal}
            />
          )}

          {/* Input Bar */}
          <div className="p-4 flex-shrink-0">
            <input ref={chatFileInputRef} type="file" accept="image/*" multiple className="hidden" onChange={handleChatImageUpload} />
            <div className="workspace-chat-input relative flex min-h-[148px] flex-col rounded-[24px]">
              <ImageRegionCandidatePopover
                region={activeRegionSelection}
                customLabelDraft={regionCustomLabelDraft}
                onCustomLabelDraftChange={setRegionCustomLabelDraft}
                onSelectCandidate={(regionId, candidateId) => {
                  updateRegionCandidate(regionId, candidateId);
                  setActiveRegionMenuId(null);
                }}
                onUseCustomLabel={(regionId, candidateId, label) => {
                  updateRegionCandidate(regionId, candidateId, label);
                  setActiveRegionMenuId(null);
                }}
                onRefineRegion={beginRegionRefine}
                onDeleteRegion={removeRegionSelection}
              />
              <div
                className="flex-1 px-4 pb-2 pt-4"
                onClick={() => chatInputEditorRef.current?.focus()}
              >
                <div className="relative min-w-[120px]">
                  <div
                    ref={chatInputEditorRef}
                    contentEditable
                    suppressContentEditableWarning
                    onInput={handleChatEditorInput}
                    onCompositionStart={handleChatCompositionStart}
                    onCompositionEnd={handleChatCompositionEnd}
                    onPaste={handleChatPaste}
                    onKeyDown={handleChatEditorKeyDown}
                    onMouseDown={(event) => {
                      const target = event.target as HTMLElement;
                      if (target.closest('[data-reference-action]')) {
                        event.preventDefault();
                      }
                    }}
                    onClick={(event) => {
                      const target = event.target as HTMLElement;
                      const action = target.closest('[data-reference-action]')?.getAttribute('data-reference-action');
                      if (!action) return;
                      const tokenNode = target.closest(REFERENCE_TOKEN_SELECTOR) as HTMLElement | null;
                      const tokenId = tokenNode?.getAttribute('data-reference-id');
                      const token = resolvedChatReferenceTokens.find((candidate) => candidate.id === tokenId);
                      if (!token) return;
                      event.stopPropagation();
                      if (action === 'pin') toggleChatReferenceTokenPin(token);
                      if (action === 'retry') retryChatReferenceUpload(token);
                      if (action === 'remove') removeChatReferenceToken(token);
                      if (action === 'candidates' && token.regionId) {
                        setActiveRegionMenuId(token.regionId);
                        setRegionCustomLabelDraft(
                          regionSelectionsRef.current.find((region) => region.id === token.regionId)?.customLabel
                          || token.label
                          || ''
                        );
                      }
                    }}
                    onKeyUp={rememberChatEditorCaretOffset}
                    onMouseUp={rememberChatEditorCaretOffset}
                    onFocus={() => {
                      setChatInputFocused(true);
                      rememberChatEditorCaretOffset();
                    }}
                    onBlur={() => {
                      rememberChatEditorCaretOffset();
                      setChatInputFocused(false);
                    }}
                    className="panel-scrollbar w-full overflow-y-auto bg-transparent text-sm leading-5 outline-none whitespace-pre-wrap break-words"
                    style={{ minHeight: '72px', maxHeight: '240px', height: `${chatInputHeightRef.current}px` }}
                  />
                  <span
                    ref={chatComposerPlaceholderRef}
                    hidden={Boolean(latestChatInputRef.current.trim()) || Boolean(activeSkill) || resolvedChatReferenceTokens.length > 0 || chatInputFocused}
                    className="workspace-text-muted pointer-events-none absolute left-0 top-0 text-sm leading-5"
                  >
                      请输入你的设计需求
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-1 px-3 pb-3 pt-1">
                <div className="flex min-w-0 flex-1 items-center gap-1">
                  <div className="relative" ref={chatComposerMoreMenuRef} data-chat-composer-control="more">
                    {showChatComposerMoreMenu && (
                      <div className="workspace-menu-panel absolute bottom-full left-0 z-30 mb-2 w-[210px] rounded-2xl p-1.5" role="menu" aria-label="更多操作">
                        <button
                          type="button"
                          role="menuitem"
                          className="workspace-menu-item flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-xs"
                          onClick={() => {
                            setShowChatComposerMoreMenu(false);
                            chatFileInputRef.current?.click();
                          }}
                        >
                          <Upload size={14} />
                          <span>上传文件</span>
                        </button>
                        <button
                          type="button"
                          role="menuitem"
                          className="workspace-menu-item flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-xs"
                          onClick={() => {
                            setShowChatComposerMoreMenu(false);
                            setSelectedChatHistoryAssetIds([]);
                            setShowChatAssetPicker(true);
                          }}
                        >
                          <Library size={14} />
                          <span>从素材库选取</span>
                        </button>
                        <button
                          type="button"
                          role="menuitem"
                          disabled
                          aria-label="联网搜索 · 即将支持"
                          className="workspace-menu-item flex w-full cursor-not-allowed items-center gap-2 rounded-xl px-3 py-2 text-left text-xs opacity-45"
                        >
                          <Search size={14} />
                          <span className="flex-1">联网搜索</span>
                          <span className="workspace-text-muted text-[10px]">即将支持</span>
                        </button>
                      </div>
                    )}
                    {showChatAssetPicker && (
                      <div
                        ref={chatAssetPickerRef}
                        className="workspace-menu-panel absolute bottom-full left-0 z-30 mb-2 w-[min(340px,calc(100vw-2rem))] rounded-[20px] p-3"
                        aria-label="从素材库选取参考图"
                        role="dialog"
                        aria-modal="false"
                        tabIndex={-1}
                      >
                        <div className="mb-2 flex items-center justify-between gap-3">
                          <div>
                            <div className="text-xs font-semibold">素材库</div>
                            <div className="workspace-text-muted mt-0.5 text-[10px]">
                              还可添加 {Math.max(0, 14 - chatReferenceTokenCount)} 张参考图
                            </div>
                          </div>
                          <button
                            type="button"
                            className="workspace-control-chip inline-flex h-7 w-7 items-center justify-center rounded-full"
                            onClick={() => {
                              setShowChatAssetPicker(false);
                              setSelectedChatHistoryAssetIds([]);
                              window.requestAnimationFrame(() => chatComposerMoreButtonRef.current?.focus());
                            }}
                            aria-label="关闭素材库"
                          >
                            <X size={13} />
                          </button>
                        </div>
                        {generatedImageHistoryEntries.length > 0 ? (
                          <div className="panel-scrollbar grid max-h-[264px] grid-cols-3 gap-2 overflow-y-auto pr-1">
                            {generatedImageHistoryEntries.map((entry, index) => {
                              const isAttached = chatReferenceImages.includes(entry.src);
                              const isSelected = selectedChatHistoryAssetIds.includes(entry.id);
                              const selectionLimitReached = selectedChatHistoryAssetIds.length >= Math.max(0, 14 - chatReferenceTokenCount);
                              return (
                                <button
                                  key={entry.id}
                                  type="button"
                                  disabled={isAttached || (selectionLimitReached && !isSelected)}
                                  onClick={() => {
                                    setSelectedChatHistoryAssetIds((current) =>
                                      current.includes(entry.id)
                                        ? current.filter((id) => id !== entry.id)
                                        : [...current, entry.id]
                                    );
                                  }}
                                  className={`relative aspect-square overflow-hidden rounded-xl border  ${
                                    isSelected
                                      ? 'border-[var(--workspace-text)] ring-1 ring-[var(--workspace-text)]'
                                      : 'border-[var(--workspace-border)]'
                                  } ${isAttached ? 'cursor-not-allowed opacity-45' : ''}`}
                                  aria-pressed={isSelected}
                                  aria-label={`选择历史生成素材 ${index + 1}`}
                                  title={isAttached ? '已添加到当前对话' : '选择素材'}
                                >
                                  <Image src={entry.src} alt={`历史生成素材 ${index + 1}`} fill unoptimized sizes="96px" className="object-cover" />
                                  {(isSelected || isAttached) && (
                                    <span className="absolute right-1.5 top-1.5 inline-flex h-5 w-5 items-center justify-center rounded-full bg-zinc-950 text-white">
                                      <Check size={12} />
                                    </span>
                                  )}
                                </button>
                              );
                            })}
                          </div>
                        ) : (
                          <div className="workspace-text-muted flex min-h-28 items-center justify-center rounded-xl border border-dashed border-[var(--workspace-border)] px-4 text-center text-xs">
                            还没有生成过图片，完成一次生图后会出现在这里。
                          </div>
                        )}
                        <div className="mt-3 flex items-center justify-between gap-2">
                          <span className="workspace-text-muted text-[10px]">已选 {selectedChatHistoryAssetIds.length} 张</span>
                          <button
                            type="button"
                            disabled={selectedChatHistoryAssetIds.length === 0}
                            onClick={handleAttachSelectedChatHistoryAssets}
                            className="rounded-full bg-zinc-950 px-3 py-1.5 text-xs font-medium text-white disabled:cursor-not-allowed disabled:opacity-35 dark:bg-zinc-100 dark:text-zinc-950"
                          >
                            添加到对话
                          </button>
                        </div>
                      </div>
                    )}
                    <button
                      ref={chatComposerMoreButtonRef}
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        const nextOpen = !showChatComposerMoreMenu;
                        closeChatComposerPopovers();
                        setShowChatComposerMoreMenu(nextOpen);
                      }}
                      disabled={isGenerating}
                      aria-label="更多"
                      aria-expanded={showChatComposerMoreMenu || showChatAssetPicker}
                      className={`workspace-chat-icon-control inline-flex h-8 w-8 items-center justify-center rounded-lg ${showChatComposerMoreMenu || showChatAssetPicker ? 'is-active' : ''}`}
                    >
                      <MoreHorizontal size={17} />
                    </button>
                  </div>
                  <div className="relative" ref={skillsMenuRef}>
                    {showSkillsMenu && (
                      <div className="workspace-menu-panel absolute bottom-full left-0 z-20 mb-2 min-w-[180px] rounded-2xl p-1">
                        {quickActions.map((action) => {
                          const isActive = activeSkill?.id === action.id;
                          return (
                            <button
                              key={action.id}
                              onClick={() => {
                                handleQuickSkillSelect(action, 'bottom_skill_bar');
                                setShowSkillsMenu(false);
                                setTimeout(() => {
                                  chatInputEditorRef.current?.focus();
                                  moveCaretToEditorEnd();
                                }, 0);
                              }}
                              className={`workspace-menu-item flex w-full items-center justify-between gap-2 rounded-xl border border-transparent px-3 py-1.5 text-xs ${isActive ? 'is-selected' : ''}`}
                            >
                              <span className="flex items-center gap-1.5">
                                <Sparkles size={11} />
                                <span>{action.label}</span>
                              </span>
                              {isActive && <span className="workspace-text-muted text-[10px]">✓</span>}
                            </button>
                          );
                        })}
                      </div>
                    )}
                    <button
                      data-chat-composer-control="skills"
                      onClick={(e) => {
                        e.stopPropagation();
                        const nextOpen = !showSkillsMenu;
                        closeChatComposerPopovers();
                        setShowSkillsMenu(nextOpen);
                      }}
                      disabled={isGenerating}
                      aria-label="Skills"
                      aria-expanded={showSkillsMenu}
                      title="Skills"
                      className={`workspace-chat-icon-control inline-flex h-8 w-8 items-center justify-center rounded-lg ${showSkillsMenu ? 'is-active' : ''}`}
                    >
                      <span
                        aria-hidden="true"
                        className="inline-block h-3.5 w-3.5 shrink-0 bg-current"
                        style={{
                          maskImage: "url('/icons/lovart-skills.svg')",
                          WebkitMaskImage: "url('/icons/lovart-skills.svg')",
                          maskRepeat: 'no-repeat',
                          WebkitMaskRepeat: 'no-repeat',
                          maskPosition: 'center',
                          WebkitMaskPosition: 'center',
                          maskSize: 'contain',
                          WebkitMaskSize: 'contain',
                        }}
                      />
                    </button>
                  </div>
                  <div className="relative" ref={generationModeMenuRef}>
                    {showGenerationModeMenu && (
                      <div className="workspace-menu-panel absolute bottom-full left-0 z-20 mb-2 min-w-[80px] rounded-2xl p-1">
                        {[
                          { id: 'agent' as const, label: 'Agent' },
                          { id: 'image' as const, label: '生图' },
                          { id: 'chat' as const, label: '对话' },
                        ].map((option) => (
                          <button
                            key={option.id}
                            onClick={() => {
                              setGenerationMode(option.id);
                              setShowGenerationModeMenu(false);
                              setShowChatModelSelector(false);
                              setShowImageModelSelector(false);
                            }}
                            className={`workspace-menu-item w-full rounded-xl border border-transparent px-3 py-1.5 text-left text-xs ${generationMode === option.id ? 'is-selected' : ''}`}
                          >
                            {option.label}
                          </button>
                        ))}
                      </div>
                    )}
                    <button
                      data-chat-composer-control="mode"
                      onClick={(e) => {
                        e.stopPropagation();
                        const nextOpen = !showGenerationModeMenu;
                        closeChatComposerPopovers();
                        setShowGenerationModeMenu(nextOpen);
                      }}
                      disabled={isGenerating}
                      aria-expanded={showGenerationModeMenu}
                      className={`workspace-chat-icon-control flex h-8 items-center gap-1 rounded-lg px-2.5 text-xs font-medium ${showGenerationModeMenu ? 'is-active' : ''}`}
                    >
                      <SlidersHorizontal size={12} />
                      <span>{generationMode === 'agent' ? 'Agent' : generationMode === 'image' ? '生图' : '对话'}</span>
                    </button>
                  </div>
                  <button
                    type="button"
                    data-chat-composer-control="reasoning"
                    disabled
                    aria-label="深度思考 · 即将支持"
                    title="深度思考 · 即将支持"
                    className="workspace-chat-icon-control ml-auto inline-flex h-8 w-8 items-center justify-center rounded-lg"
                  >
                    <BrainCircuit size={16} />
                  </button>
                  <div className="relative" ref={modelPreferenceContainerRef} data-chat-composer-control="models">
                    {showModelPreferencePopover && (
                      <div
                        ref={modelPreferencePopoverRef}
                        className="workspace-menu-panel absolute bottom-full right-0 z-30 mb-2 w-[min(360px,calc(100vw-2rem))] rounded-[20px] p-3"
                        aria-label="模型偏好设置"
                        role="dialog"
                        aria-modal="false"
                        tabIndex={-1}
                      >
                        <div className="mb-2 flex items-center justify-between">
                          <div>
                            <div className="text-xs font-semibold">模型偏好</div>
                            <div className="workspace-text-muted mt-0.5 text-[10px]">按当前模式配置本项目</div>
                          </div>
                          <button
                            type="button"
                            className="workspace-control-chip inline-flex h-7 w-7 items-center justify-center rounded-full"
                            onClick={() => {
                              closeChatComposerPopovers();
                              window.requestAnimationFrame(() => modelPreferenceButtonRef.current?.focus());
                            }}
                            aria-label="关闭模型偏好"
                          >
                            <X size={13} />
                          </button>
                        </div>
                        <div className="space-y-2">
                          {(generationMode === 'agent' || generationMode === 'chat') && (
                            <ChatPanelModelSelector
                              purpose="chat"
                              providers={enabledProviderSettingsProviders}
                              providerId={resolvedChatSelection.providerId}
                              model={resolvedChatSelection.model}
                              open={showChatModelSelector}
                              disabled={isGenerating}
                              loading={providerSettingsLoading && !providerSettingsLoaded}
                              loadFailed={Boolean(providerSettingsError && !providerSettingsLoaded)}
                              containerRef={chatModelSelectorRef}
                              onToggle={() => {
                                setShowChatModelSelector((prev) => !prev);
                                setShowImageModelSelector(false);
                              }}
                              onSelect={(providerId, model) => {
                                setChatProviderId(providerId);
                                setChatModelId(model);
                                setShowChatModelSelector(false);
                              }}
                              onOpenSettings={() => {
                                closeChatComposerPopovers();
                                openProviderSettingsModal();
                              }}
                              onRetry={() => { void loadProviderSettings(); }}
                            />
                          )}
                          {(generationMode === 'agent' || generationMode === 'image') && (
                            <ChatPanelModelSelector
                              purpose="image"
                              providers={enabledProviderSettingsProviders}
                              providerId={resolvedImageSelection.providerId}
                              model={resolvedImageSelection.model}
                              open={showImageModelSelector}
                              disabled={isGenerating}
                              loading={providerSettingsLoading && !providerSettingsLoaded}
                              loadFailed={Boolean(providerSettingsError && !providerSettingsLoaded)}
                              align="right"
                              containerRef={imageModelSelectorRef}
                              onToggle={() => {
                                setShowImageModelSelector((prev) => !prev);
                                setShowChatModelSelector(false);
                              }}
                              onSelect={(providerId, model) => {
                                setImageProviderId(providerId);
                                setImageModelId(model);
                                setShowImageModelSelector(false);
                              }}
                              onOpenSettings={() => {
                                closeChatComposerPopovers();
                                openProviderSettingsModal();
                              }}
                              onRetry={() => { void loadProviderSettings(); }}
                            />
                          )}
                          {(generationMode === 'agent' || generationMode === 'image') && (
                            <div className="rounded-xl border border-[var(--workspace-border)] p-2.5">
                              <div className="workspace-text-muted mb-2 text-[10px] font-medium">画幅比例</div>
                              <div className="grid grid-cols-3 gap-1">
                                {ASPECT_RATIOS
                                  .filter((option) => generationMode !== 'agent' || option.id !== 'auto')
                                  .map((option) => (
                                  <button
                                    key={option.id}
                                    type="button"
                                    onClick={() => generationMode === 'agent'
                                      ? setAgentImageAspectRatio(option.id)
                                      : setImageAspectRatio(option.id)}
                                    className={`workspace-menu-item rounded-lg px-2 py-1.5 text-[11px] ${activeChatImageAspectRatio === option.id ? 'is-selected' : ''}`}
                                  >
                                    {option.name}
                                  </button>
                                  ))}
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                    <button
                      ref={modelPreferenceButtonRef}
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        const nextOpen = !showModelPreferencePopover;
                        closeChatComposerPopovers();
                        setShowModelPreferencePopover(nextOpen);
                      }}
                      disabled={isGenerating}
                      aria-label="模型偏好"
                      aria-expanded={showModelPreferencePopover}
                      title="模型偏好"
                      className={`workspace-chat-icon-control inline-flex h-8 w-8 items-center justify-center rounded-lg ${showModelPreferencePopover ? 'is-active' : ''}`}
                    >
                      <Settings2 size={16} />
                    </button>
                  </div>
                </div>
                <button
                    ref={chatSendButtonRef}
                    data-chat-composer-control="send"
                    onClick={isGenerating ? handleCancelGenerate : () => { void handleGenerate(); }}
                    disabled={!isGenerating && (!latestChatInputRef.current.trim() || hasPendingChatReferenceUploads)}
                    aria-label={isGenerating ? '终止任务' : '发送'}
                    title={isGenerating ? '终止任务' : '发送'}
                    className="ml-2 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-zinc-950 text-white disabled:cursor-not-allowed disabled:opacity-30 dark:bg-zinc-100 dark:text-zinc-950"
                    data-gsap-interactive="true"
                  >
                    {isGenerating ? (
                      <Square size={13} fill="currentColor" />
                    ) : (
                      <ArrowUp size={17} strokeWidth={2.4} />
                    )}
                  </button>
              </div>
            </div>
          </div>
            </div>
          </div>
          </>,
          document.body
        )}
      <style jsx global>{`
        .panel-scrollbar {
          scrollbar-width: thin;
          scrollbar-color: rgba(161, 161, 170, 0.34) rgba(255, 255, 255, 0.04);
        }

        .chat-message-window-row {
          content-visibility: auto;
          contain-intrinsic-size: auto 96px;
        }

        [data-assistant-selectable],
        [data-assistant-selectable] *,
        .assistant-selectable,
        .assistant-selectable *,
        .assistant-selectable-node,
        .assistant-selectable-node * {
          user-select: text !important;
          -webkit-user-select: text !important;
          cursor: text;
        }

        [data-assistant-selectable]::selection,
        [data-assistant-selectable] *::selection,
        .assistant-selectable::selection,
        .assistant-selectable *::selection,
        .assistant-selectable-node::selection,
        .assistant-selectable-node *::selection {
          background: rgba(148, 163, 184, 0.38);
          color: #f8fafc;
        }

        [data-assistant-selectable]::-moz-selection,
        [data-assistant-selectable] *::-moz-selection,
        .assistant-selectable::-moz-selection,
        .assistant-selectable *::-moz-selection,
        .assistant-selectable-node::-moz-selection,
        .assistant-selectable-node *::-moz-selection {
          background: rgba(148, 163, 184, 0.38);
          color: #f8fafc;
        }

        .assistant-selectable button,
        .assistant-selectable summary,
        .assistant-selectable [role='button'],
        [data-assistant-selectable] button,
        [data-assistant-selectable] summary,
        [data-assistant-selectable] [role='button'] {
          user-select: none !important;
          -webkit-user-select: none !important;
        }

        .panel-scrollbar::-webkit-scrollbar {
          width: 10px;
          height: 10px;
        }

        .panel-scrollbar::-webkit-scrollbar-track {
          background: rgba(255, 255, 255, 0.04);
          border-radius: 9999px;
        }

        .panel-scrollbar::-webkit-scrollbar-thumb {
          background: rgba(161, 161, 170, 0.34);
          border: 2px solid rgba(0, 0, 0, 0);
          background-clip: padding-box;
          border-radius: 9999px;
        }

        .panel-scrollbar::-webkit-scrollbar-thumb:hover {
          background: rgba(212, 212, 216, 0.46);
          border: 2px solid rgba(0, 0, 0, 0);
          background-clip: padding-box;
        }
      `}</style>
      </div>
    </React.Profiler>
  );
}
