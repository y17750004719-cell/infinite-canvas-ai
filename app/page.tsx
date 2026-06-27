'use client';

import React, { useState, useRef, useEffect, useLayoutEffect, useCallback, memo } from 'react';
import Image from 'next/image';
import { createPortal } from 'react-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { 
  MousePointer2, Type, Image as ImageIcon,
  Share2, History, Settings, Paperclip,
  Send, Sparkles, X, ChevronDown, Trash2, Edit3, ArrowLeft, Plus, SlidersHorizontal, Copy, Check, Video, Pencil, Package2, Workflow, Clock3, Eye, EyeOff, Moon, Sun
} from 'lucide-react';
import { GeneratedImageHistoryEntry, ProjectSession } from './lib/db';
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
import {
  areCanvasUndoSnapshotsEqual,
  createCanvasUndoSnapshot,
  createEmptySessionCanvasHistoryState,
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
  finalizeManualTextCardItem,
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
  resolveCanvasBackgroundDotGap,
  resolveFloatingPopoverOffset,
  resolveImageCardModel,
  resolveImageCardSize,
  resolveImageCardSizeForAspectRatio,
  resolveWorkspaceImageCardModel,
  resolveWorkspaceTextPanelChatModel,
  resolveSessionPresentationState,
  settleCanvasImageGenerationRequests,
  shouldPreventScrollableRegionWheelDefault,
  syncAutoResizedTextareaLayout,
} from './lib/workspace-session-view.mjs';
import { GalleryView, SessionActionErrorBanner } from './components/workspace/GalleryView';
import { useWorkspaceSessionController } from './hooks/useWorkspaceSessionController';

const DEBUG_CANVAS_CONNECTIONS = false;
const CANVAS_OVERLAY_Z = 120;
const CHAT_PANEL_Z = 180;
const GLOBAL_NOTICE_Z = 220;
const CANVAS_CLIPBOARD_PASTE_OFFSET = { x: 32, y: 32 };
const CANVAS_VIEWPORT_PASTE_ANIMATION_MS = 240;

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

interface CanvasItem {
  id: string;
  type: 'image' | 'frame' | 'shape' | 'text';
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  src?: string;
  naturalWidth?: number;
  naturalHeight?: number;
  imageVariant?: 'card';
  imageOutputs?: Array<{ src: string; naturalWidth: number; naturalHeight: number }>;
  activeImageOutputIndex?: number;
  fill?: string;
  text?: string;
  textVariant?: 'legacy' | 'card';
  textMode?: 'ai' | 'manual';
  lastGenerationDurationMs?: number;
  lastGenerationCompletedAt?: number;
  visible: boolean;
  locked: boolean;
}

interface Connection {
  id: string;
  fromItemId: string;
  toItemId: string;
}

interface CanvasUndoSnapshot {
  items: CanvasItem[];
  connections: Connection[];
  textCardPanelDrafts: Record<string, string>;
  imageCardPanelDrafts: Record<string, string>;
  imageCardProviderById: Record<string, string>;
  imageCardModelById: Record<string, string>;
  imageCardSizeById: Record<string, string>;
  imageCardQualityById: Record<string, string>;
  imageCardCountById: Record<string, number>;
  imageCardAspectRatioById: Record<string, string>;
}

interface SessionCanvasHistoryState {
  past: CanvasUndoSnapshot[];
  future: CanvasUndoSnapshot[];
}

type ConnectionMode = 'idle' | 'armed' | 'dragging';

interface ConnectionSession {
  mode: 'dragging';
  fromItemId: string;
  pointerId: number | null;
  startPoint: { x: number; y: number } | null;
  point: { x: number; y: number } | null;
  snapTargetId: string | null;
  moved: boolean;
}

type PortSide = 'left' | 'right';

interface MagneticPortState {
  itemId: string;
  side: PortSide;
  point: { x: number; y: number };
  isTracking: boolean;
  isReturning: boolean;
}

type MagneticPortMap = Record<string, MagneticPortState>;

interface FrozenPreviewConnection {
  from: { x: number; y: number };
  to: { x: number; y: number };
}

interface PendingConnectionMenu {
  fromItemId: string;
  position: { x: number; y: number };
}

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
  model?: string;
  imageName?: string;
  skillChoice?: SkillChoicePayload;
  skillChoiceDismissed?: boolean;
  skillChoiceResolved?: boolean;
}

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
  createdAt: number;
  updatedAt: number;
}

interface SessionLiveState {
  items: CanvasItem[];
  connections: Connection[];
  textCardPanelDrafts: Record<string, string>;
  imageCardPanelDrafts: Record<string, string>;
  imageCardProviderById: Record<string, string>;
  imageCardModelById: Record<string, string>;
  imageCardSizeById: Record<string, string>;
  imageCardQualityById: Record<string, string>;
  imageCardCountById: Record<string, number>;
  imageCardAspectRatioById: Record<string, string>;
  chatMessages: ChatMessage[];
  activeSkill: { id: string; label: string } | null;
  generatedImageHistoryBySession: Record<string, GeneratedImageHistoryEntry[]>;
  viewport: { x: number; y: number; scale: number };
}

type Tool = 'select' | 'text' | 'image';
type GenerationMode = 'auto' | 'image' | 'chat';
type ProviderSettingsProviderId = string;
type ProviderSettingsSource = 'runtime' | 'env';
type ProviderProtocol = 'openai' | 'gemini';
type ProviderImageRequestMode = 'openai' | 'openai-json';

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
  apiKey: string;
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
}

type ProviderSettingsModelPickerCategory = 'all' | 'image' | 'chat';

interface WorkspaceModelOption {
  id: string;
  label: string;
  providerId: string;
  providerName: string;
}

const tools = [
  { id: 'select', icon: MousePointer2, label: '选择' },
  { id: 'text', icon: Type, label: '文字' },
  { id: 'image', icon: ImageIcon, label: '图片' },
];

const quickActions = [
  { id: 'logo', label: 'Logo 与品牌' },
  { id: 'social', label: '社交媒体' },
  { id: 'illustration', label: '插画与海报' },
  { id: 'packaging', label: '包装设计' },
  { id: 'brand', label: '品牌识别系统' },
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

const PROVIDER_SETTINGS_MODEL_PICKER_CATEGORIES = ['all', 'image', 'chat'] as const;
const PROVIDER_SETTINGS_MODEL_PICKER_LABELS: Record<ProviderSettingsModelPickerCategory, string> = {
  all: '全部',
  image: '图片',
  chat: '聊天',
};

const uniqueModelIds = (models: string[]) =>
  Array.from(new Set(models.map((model) => model.trim()).filter(Boolean)));

const createFallbackWorkspaceModelOptions = (
  fallbackOptions: Array<{ id: string; label: string }>,
  provider: ProviderSettingsItem | null
): WorkspaceModelOption[] =>
  fallbackOptions.map((option) => ({
    ...option,
    providerId: provider?.id || 'comfly',
    providerName: provider?.name || '主供应商',
  }));

const createWorkspaceModelOptions = (
  providers: ProviderSettingsItem[],
  kind: 'image' | 'chat',
  fallbackOptions: Array<{ id: string; label: string }>
): WorkspaceModelOption[] => {
  const enabledProviders = providers.filter((provider) => provider.enabled !== false);
  const options = enabledProviders.flatMap((provider) => {
    const models = kind === 'image' ? provider.imageModels : provider.chatModels;
    return uniqueModelIds(models).map((model) => ({
      id: model,
      label: model,
      providerId: provider.id,
      providerName: provider.name || getProviderSettingsProviderLabel(provider.id),
    }));
  });

  if (options.length > 0) return options;
  return createFallbackWorkspaceModelOptions(
    fallbackOptions,
    enabledProviders.find((provider) => provider.primary) || enabledProviders[0] || null
  );
};

const findWorkspaceModelOption = (
  options: WorkspaceModelOption[],
  modelId: string,
  providerId?: string
): WorkspaceModelOption | null => {
  const normalizedModelId = modelId.trim();
  const normalizedProviderId = providerId?.trim();
  if (normalizedModelId && normalizedProviderId) {
    const exact = options.find((option) => option.id === normalizedModelId && option.providerId === normalizedProviderId);
    if (exact) return exact;
  }
  if (normalizedModelId) {
    const byModel = options.find((option) => option.id === normalizedModelId);
    if (byModel) return byModel;
  }
  if (normalizedProviderId) {
    const byProvider = options.find((option) => option.providerId === normalizedProviderId);
    if (byProvider) return byProvider;
  }
  return options[0] || null;
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

type SkillSelectSource = 'center_quick_action' | 'bottom_skill_bar';

const SKILL_DEFAULT_PROMPTS: Record<string, string> = {
  brand: '请按品牌识别系统流程开始信息收集，先询问我行业、品牌名称、补充说明和 logo 参考图（可选）。',
  logo: '请按 Logo 与品牌流程开始信息收集，先询问我品牌名称、行业、风格偏好和使用场景，再给出 2-3 个方向供我确认。',
};

const SKILL_CHOICE_START = '<<skill_choice>>';
const SKILL_CHOICE_END = '<</skill_choice>>';
const CANVAS_NODE_CORNER_RADIUS = 5;
const NODE_CORNER_RADIUS = 24;
const CORNER_HANDLE_GAP = 10;
const CORNER_HANDLE_STROKE = 4;
const HANDLE_ARC_RADIUS = NODE_CORNER_RADIUS + CORNER_HANDLE_GAP;
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
const PORT_ACTIVATION_RADIUS = 76;
const PORT_TRACKING_RADIUS = 112;
const PORT_RETURN_DURATION_MS = 220;
const CONNECTION_ANCHOR_EDGE_GAP = 8;
const IMAGE_DISPLAY_MIN_SIDE = 512;
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
const TEXT_CARD_GENERATION_PANEL_DEFAULT_WIDTH = 480;
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
const TEXT_CARD_BODY_TEXT_CLASSNAME = 'text-[15px] leading-7 tracking-[-0.02em] text-zinc-200';
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
const IMAGE_CARD_COUNT_OPTIONS = [
  { id: 1, label: 'X1' },
  { id: 2, label: 'X2' },
  { id: 4, label: 'X4' },
] as const;
const NODE_SELECTED_OUTLINE_COLOR = 'rgba(226, 232, 240, 0.76)';
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
  appBg: '#eef1f5',
  panel: 'rgba(255, 255, 255, 0.84)',
  panelElevated: 'rgba(255, 255, 255, 0.94)',
  panelSoft: 'rgba(248, 250, 252, 0.78)',
  border: 'rgba(15, 23, 42, 0.1)',
  borderStrong: 'rgba(15, 23, 42, 0.18)',
  textPrimary: '#111827',
  textMuted: '#667085',
  textSoft: '#98a2b3',
  accent: '#0f172a',
  accentSurface: 'rgba(15, 23, 42, 0.06)',
  accentSurfaceStrong: 'rgba(15, 23, 42, 0.1)',
  canvasDot: 'rgba(100, 116, 139, 0.3)',
  canvasLine: 'rgba(71, 85, 105, 0.58)',
  portFill: '#f8fafc',
  portStroke: 'rgba(51, 65, 85, 0.58)',
};
const DARK_THEME = {
  appBg: '#050608',
  panel: 'rgba(16, 18, 22, 0.88)',
  panelElevated: 'rgba(24, 27, 33, 0.96)',
  panelSoft: 'rgba(12, 14, 18, 0.76)',
  border: 'rgba(255, 255, 255, 0.09)',
  borderStrong: 'rgba(255, 255, 255, 0.16)',
  textPrimary: '#f5f7fb',
  textMuted: '#98a2b3',
  textSoft: '#6b7280',
  accent: '#d7dde8',
  accentSurface: 'rgba(255, 255, 255, 0.08)',
  accentSurfaceStrong: 'rgba(255, 255, 255, 0.12)',
  canvasDot: 'rgba(255,255,255,0.12)',
  canvasLine: 'rgba(229, 231, 235, 0.86)',
  portFill: '#090b0f',
  portStroke: 'rgba(229, 231, 235, 0.78)',
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

const IMAGE_CARD_QUALITY_OPTIONS = [
  { id: 'auto', label: 'Auto' },
  { id: 'high', label: 'High' },
  { id: 'medium', label: 'Medium' },
  { id: 'low', label: 'Low' },
];

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

const resolveImageToolbarViewportAnchor = ({
  itemBounds,
  toCanvasScreenPoint,
  canvasRect,
}: {
  itemBounds: { left: number; top: number; width: number; height: number } | null;
  toCanvasScreenPoint: (point: { x: number; y: number }) => { x: number; y: number };
  canvasRect: DOMRect | null | undefined;
}) => {
  if (!itemBounds || !canvasRect) {
    return null;
  }

  const canvasScreenPoint = toCanvasScreenPoint({
    x: itemBounds.left + itemBounds.width / 2,
    y: itemBounds.top,
  });

  return {
    x: canvasRect.left + canvasScreenPoint.x,
    y: canvasRect.top + canvasScreenPoint.y,
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
  naturalWidth,
  naturalHeight,
  timestamp = Date.now(),
  sequence = 0,
  source,
  sourceItemId,
  topicId,
  messageId,
}: {
  src: string;
  naturalWidth?: number;
  naturalHeight?: number;
  timestamp?: number;
  sequence?: number;
  source: GeneratedImageHistoryEntry['source'];
  sourceItemId?: string;
  topicId?: string;
  messageId?: string;
}): GeneratedImageHistoryEntry => {
  const normalizedCreatedAt = buildGeneratedImageHistorySortKey(timestamp, sequence);

  return {
    id: `generated-history-${normalizedCreatedAt}-${Math.random().toString(36).slice(2, 8)}`,
    src,
    naturalWidth,
    naturalHeight,
    createdAt: normalizedCreatedAt,
    source,
    sourceItemId,
    topicId,
    messageId,
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

const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

interface ViewportState {
  x: number;
  y: number;
  scale: number;
}

interface CanvasSize {
  width: number;
  height: number;
}

const CanvasBackgroundLayer = memo(function CanvasBackgroundLayer({
  theme,
  viewport,
}: {
  theme: typeof DARK_THEME;
  viewport: ViewportState;
}) {
  const dotGap = resolveCanvasBackgroundDotGap(viewport.scale);

  return (
    <div
      className="pointer-events-none absolute inset-0"
      style={{
        backgroundColor: theme.appBg,
        backgroundImage: `radial-gradient(${theme.canvasDot} 0.9px, transparent 0.9px)`,
        backgroundSize: `${dotGap}px ${dotGap}px`,
        backgroundPosition: `${viewport.x}px ${viewport.y}px`,
      }}
    />
  );
});

const CanvasConnectionsLayer = memo(function CanvasConnectionsLayer({
  canvasSize,
  connections,
  theme,
  itemById,
  selectedConnectionIds,
  viewport,
  previewFrom,
  previewTo,
  frozenPreviewConnection,
  onConnectionPointerDown,
  getConnectionAnchorCanvasPoint,
  toCanvasScreenPoint,
  buildConnectionPath,
}: {
  canvasSize: CanvasSize;
  connections: Connection[];
  theme: typeof DARK_THEME;
  itemById: Record<string, CanvasItem>;
  selectedConnectionIds: string[];
  viewport: ViewportState;
  previewFrom: { x: number; y: number } | null;
  previewTo: { x: number; y: number } | null;
  frozenPreviewConnection: FrozenPreviewConnection | null;
  onConnectionPointerDown: (e: React.PointerEvent<SVGPathElement>, connectionId: string) => void;
  getConnectionAnchorCanvasPoint: (item: CanvasItem, side: 'left' | 'right') => { x: number; y: number };
  toCanvasScreenPoint: (point: { x: number; y: number }) => { x: number; y: number };
  buildConnectionPath: (from: { x: number; y: number }, to: { x: number; y: number }) => string;
}) {
  const scaledConnectionStrokeWidth = 3.5 * viewport.scale;
  const scaledSelectedConnectionStrokeWidth = 4.5 * viewport.scale;
  const scaledDebugConnectionStrokeWidth = 3 * viewport.scale;
  const showConnectionTestLine = DEBUG_CANVAS_CONNECTIONS && !previewFrom;
  const resolvedConnections = connections
    .map((connection) => {
      const fromItem = itemById[connection.fromItemId];
      const toItem = itemById[connection.toItemId];
      if (!fromItem || !toItem) return null;

      const connectionFrom = toCanvasScreenPoint(getConnectionAnchorCanvasPoint(fromItem, 'right'));
      const connectionTo = toCanvasScreenPoint(getConnectionAnchorCanvasPoint(toItem, 'left'));

      return {
        connection,
        path: buildConnectionPath(connectionFrom, connectionTo),
        isSelectedConnection: selectedConnectionIds.includes(connection.id),
      };
    })
    .filter(Boolean) as Array<{
    connection: Connection;
    path: string;
    isSelectedConnection: boolean;
  }>;

  return (
    <>
      <svg
        className="pointer-events-none absolute inset-0 z-[1] h-full w-full overflow-hidden"
        width={canvasSize.width}
        height={canvasSize.height}
        viewBox={`0 0 ${Math.max(canvasSize.width, 1)} ${Math.max(canvasSize.height, 1)}`}
        preserveAspectRatio="none"
      >
        {resolvedConnections.map(({ connection, path, isSelectedConnection }) => (
          <path
            key={`visual-${connection.id}`}
            d={path}
            fill="none"
            stroke={theme.canvasLine}
            strokeOpacity={isSelectedConnection ? 0.98 : 0.9}
            strokeWidth={isSelectedConnection ? scaledSelectedConnectionStrokeWidth : scaledConnectionStrokeWidth}
            strokeLinecap="round"
            pointerEvents="none"
          />
        ))}
        {showConnectionTestLine && (
          <line
            x1={40}
            y1={40}
            x2={220}
            y2={120}
            stroke="#2563eb"
            strokeWidth={scaledDebugConnectionStrokeWidth}
            strokeOpacity={1}
            strokeLinecap="round"
          />
        )}
        {previewFrom && previewTo && (
          <path
            d={buildConnectionPath(previewFrom, previewTo)}
            fill="none"
            stroke={theme.canvasLine}
            strokeOpacity="0.9"
            strokeWidth={scaledConnectionStrokeWidth}
            strokeLinecap="round"
            pointerEvents="none"
          />
        )}
        {frozenPreviewConnection && (
          <path
            d={buildConnectionPath(frozenPreviewConnection.from, frozenPreviewConnection.to)}
            fill="none"
            stroke={theme.canvasLine}
            strokeOpacity="0.5"
            strokeWidth={scaledConnectionStrokeWidth}
            strokeLinecap="round"
            pointerEvents="none"
          />
        )}
      </svg>
      <svg
        className="pointer-events-none absolute inset-0 z-[1] h-full w-full overflow-hidden"
        width={canvasSize.width}
        height={canvasSize.height}
        viewBox={`0 0 ${Math.max(canvasSize.width, 1)} ${Math.max(canvasSize.height, 1)}`}
        preserveAspectRatio="none"
      >
        {resolvedConnections.map(({ connection, path }) => (
          <path
            key={`hit-${connection.id}`}
            d={path}
            fill="none"
            stroke="transparent"
            strokeWidth="20"
            strokeLinecap="round"
            className="pointer-events-auto cursor-pointer"
            onPointerDown={(e) => onConnectionPointerDown(e, connection.id)}
          />
        ))}
      </svg>
    </>
  );
});

const CanvasPortsLayer = memo(function CanvasPortsLayer({
  items,
  viewport,
  hoveredCanvasItemId,
  hoveredInputPortItemId,
  hoveredOutputPortItemId,
  magneticPorts,
  connectionFromItemId,
  connectionMode,
  connectionSnapTargetId,
  getMagneticPortKey,
  getRenderedPortOverlayPoint,
  onInputPortEnter,
  onInputPortLeave,
  onOutputPortEnter,
  onOutputPortLeave,
  onOutputPortPointerDown,
}: {
  items: CanvasItem[];
  viewport: ViewportState;
  hoveredCanvasItemId: string | null;
  hoveredInputPortItemId: string | null;
  hoveredOutputPortItemId: string | null;
  magneticPorts: MagneticPortMap;
  connectionFromItemId: string | null;
  connectionMode: ConnectionMode;
  connectionSnapTargetId: string | null;
  getMagneticPortKey: (itemId: string, side: PortSide) => string;
  getRenderedPortOverlayPoint: (item: CanvasItem, side: PortSide) => { x: number; y: number };
  onInputPortEnter: (itemId: string) => void;
  onInputPortLeave: (itemId: string) => void;
  onOutputPortEnter: (itemId: string) => void;
  onOutputPortLeave: (itemId: string) => void;
  onOutputPortPointerDown: (
    e: React.PointerEvent<HTMLElement>,
    item: CanvasItem,
    source: 'bridge' | 'button'
  ) => void;
}) {
  return (
    <div className="absolute inset-0 z-[90] pointer-events-none">
      <div
        className="absolute z-[90] overflow-visible"
        style={{
          transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.scale})`,
          transformOrigin: '0 0',
        }}
      >
        {items.map((item) => {
          const acceptsIncomingConnection = canItemAcceptIncomingConnection(item);
          const isHoveredItem = hoveredCanvasItemId === item.id;
          const isHoveredInputPort = hoveredInputPortItemId === item.id;
          const isHoveredOutputPort = hoveredOutputPortItemId === item.id;
          const inputMagneticState = magneticPorts[getMagneticPortKey(item.id, 'left')];
          const outputMagneticState = magneticPorts[getMagneticPortKey(item.id, 'right')];
          const isMagneticItem = Boolean(inputMagneticState || outputMagneticState);
          const isConnectionSource = connectionFromItemId === item.id;
          const isNearPort = isHoveredInputPort || isHoveredOutputPort;
          const showOutputPort = isHoveredItem || isNearPort || isConnectionSource || isMagneticItem;
          const showInputPort =
            acceptsIncomingConnection &&
            (isHoveredItem ||
              isNearPort ||
              isMagneticItem ||
              (connectionMode === 'dragging' && connectionSnapTargetId === item.id));
          const inputPoint = getRenderedPortOverlayPoint(item, 'left');
          const outputPoint = getRenderedPortOverlayPoint(item, 'right');
          const inputTransition =
            inputMagneticState && !inputMagneticState.isTracking
              ? `left ${PORT_RETURN_DURATION_MS}ms cubic-bezier(0.22, 1, 0.36, 1), top ${PORT_RETURN_DURATION_MS}ms cubic-bezier(0.22, 1, 0.36, 1), opacity 150ms ease`
              : inputMagneticState
                ? 'transform 100ms ease, opacity 150ms ease'
                : 'opacity 150ms ease';
          const outputTransition =
            outputMagneticState && !outputMagneticState.isTracking
              ? `left ${PORT_RETURN_DURATION_MS}ms cubic-bezier(0.22, 1, 0.36, 1), top ${PORT_RETURN_DURATION_MS}ms cubic-bezier(0.22, 1, 0.36, 1), opacity 150ms ease`
              : outputMagneticState
                ? 'transform 100ms ease, opacity 150ms ease'
                : 'opacity 150ms ease';

          return (
            <React.Fragment key={`port-overlay-${item.id}`}>
              {acceptsIncomingConnection && (
                <>
                  <div
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
                      transition: inputTransition,
                    }}
                  />
                  <div
                    data-port="in"
                    data-item-id={item.id}
                    className={`absolute -translate-x-1/2 -translate-y-1/2 pointer-events-none transition-opacity duration-150 ${
                      showInputPort ? 'opacity-100' : 'opacity-0'
                    }`}
                    style={{
                      left: inputPoint.x,
                      top: inputPoint.y,
                      width: PORT_ICON_SIZE,
                      height: PORT_ICON_SIZE,
                      transform: `translate(-50%, -50%) scale(${inputMagneticState?.isTracking ? 1.04 : 1})`,
                      transition: inputTransition,
                    }}
                  >
                    <ConnectionPortIcon className="h-full w-full" />
                  </div>
                </>
              )}
              <div
                data-port-bridge="out"
                data-item-id={item.id}
                onPointerEnter={() => onOutputPortEnter(item.id)}
                onPointerLeave={() => onOutputPortLeave(item.id)}
                onPointerDown={(e) => onOutputPortPointerDown(e, item, 'bridge')}
                className="absolute -translate-x-1/2 -translate-y-1/2 bg-transparent pointer-events-auto"
                style={{
                  left: outputPoint.x,
                  top: outputPoint.y,
                  width: PORT_PROXIMITY_SIZE,
                  height: PORT_PROXIMITY_SIZE,
                  transition: outputTransition,
                }}
              />
              <button
                type="button"
                data-port="out"
                data-item-id={item.id}
                onPointerEnter={() => onOutputPortEnter(item.id)}
                onPointerLeave={() => onOutputPortLeave(item.id)}
                onPointerDown={(e) => onOutputPortPointerDown(e, item, 'button')}
                className={`absolute -translate-x-1/2 -translate-y-1/2 rounded-full bg-transparent transition-opacity duration-150 ${
                  showOutputPort ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
                }`}
                style={{
                  left: outputPoint.x,
                  top: outputPoint.y,
                  width: PORT_ICON_SIZE,
                  height: PORT_ICON_SIZE,
                  transform: `translate(-50%, -50%) scale(${outputMagneticState?.isTracking ? 1.04 : 1})`,
                  transition: outputTransition,
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

const CanvasNodesLayer = memo(function CanvasNodesLayer({
  items,
  connections,
  viewport,
  multiSelectionBounds,
  selectedIds,
  selectedId,
  hoveredCanvasItemId,
  activeCanvasTextGenerationItemIds,
  activeCanvasImageGenerationItemIds,
  activeCanvasTextGenerations,
  activeCanvasImageGenerations,
  generationClockMs,
  editingTextCardId,
  editingTextCardTextareaRef,
  onImageCardOutputSelect,
  onSelectionGroupPointerDown,
  onItemMouseEnter,
  onItemMouseLeave,
  onItemClick,
  onItemDoubleClick,
  onItemPointerDown,
  onCornerResizePointerDown,
  onManualTextCardInputChange,
  onManualTextCardBlur,
}: {
  items: CanvasItem[];
  connections: Connection[];
  viewport: ViewportState;
  multiSelectionBounds: { left: number; top: number; width: number; height: number } | null;
  selectedIds: string[];
  selectedId: string | null;
  hoveredCanvasItemId: string | null;
  activeCanvasTextGenerationItemIds: Set<string>;
  activeCanvasImageGenerationItemIds: Set<string>;
  activeCanvasTextGenerations: Record<string, { status: 'running'; startedAt: number }>;
  activeCanvasImageGenerations: Record<string, { status: 'running'; startedAt: number; total: number; completed: number; failed: number }>;
  generationClockMs: number;
  editingTextCardId: string | null;
  editingTextCardTextareaRef: React.RefObject<HTMLTextAreaElement | null>;
  onImageCardOutputSelect: (itemId: string, outputIndex: number) => void;
  onSelectionGroupPointerDown: (e: React.PointerEvent<HTMLDivElement>) => void;
  onItemMouseEnter: (itemId: string) => void;
  onItemMouseLeave: (itemId: string) => void;
  onItemClick: (e: React.MouseEvent<HTMLDivElement>, itemId: string) => void;
  onItemDoubleClick: (itemId: string) => void;
  onItemPointerDown: (e: React.PointerEvent<HTMLDivElement>, itemId: string) => void;
  onCornerResizePointerDown: (e: React.PointerEvent<HTMLButtonElement>, item: CanvasItem) => void;
  onManualTextCardInputChange: (itemId: string, value: string) => void;
  onManualTextCardBlur: (itemId: string) => void;
}) {
  return (
    <div
      className="absolute z-[2]"
      style={{
        transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.scale})`,
        transformOrigin: '0 0',
      }}
    >
      {multiSelectionBounds && (
        <div
          data-selection-group="true"
          className="absolute rounded-[28px] border border-white/20 bg-white/[0.06]"
          style={{
            left: multiSelectionBounds.left - 10,
            top: multiSelectionBounds.top - 10,
            width: multiSelectionBounds.width + 20,
            height: multiSelectionBounds.height + 20,
          }}
          onPointerDown={onSelectionGroupPointerDown}
        />
      )}
      {items.map((item) => {
        const isItemSelected = selectedIds.includes(item.id) || selectedId === item.id;
        const showMultiSelectionGroup = selectedIds.length > 1;
        const isHoveredItem = hoveredCanvasItemId === item.id;
        const showCornerResizeHandle = isHoveredItem;
        const isTextCard = item.type === 'text' && item.textVariant === 'card';
        const isImageCard = isImageCardItem(item);
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
        const cardGenerationDurationLabel = getGenerationDurationDisplay(
          Number.isFinite(activeGenerationStartedAt)
            ? Math.max(0, generationClockMs - (activeGenerationStartedAt ?? 0))
            : item.lastGenerationDurationMs
        );
        const currentImageDimensionsLabel = isImageCard && currentImageOutput
          ? Number.isFinite(currentImageOutput.naturalWidth) &&
            currentImageOutput.naturalWidth > 0 &&
            Number.isFinite(currentImageOutput.naturalHeight) &&
            currentImageOutput.naturalHeight > 0
              ? `${currentImageOutput.naturalWidth}×${currentImageOutput.naturalHeight}`
              : null
          : null;

        return (
          <div
            key={item.id}
            data-canvas-item-id={item.id}
            className={`absolute group cursor-move ${!item.visible ? 'opacity-30' : ''}`}
            style={{
              left: item.x,
              top: item.y,
              width: item.width,
              height: item.height,
              transform: `rotate(${item.rotation}deg)`,
            }}
            onMouseEnter={() => onItemMouseEnter(item.id)}
            onMouseLeave={() => onItemMouseLeave(item.id)}
            onClick={(e) => onItemClick(e, item.id)}
            onDoubleClick={() => onItemDoubleClick(item.id)}
            onPointerDown={(e) => onItemPointerDown(e, item.id)}
          >
            {isImageAssetItem(item) && item.src && (
              <Image
                src={item.src}
                alt=""
                fill
                unoptimized
                sizes={`${Math.max(1, Math.round(item.width))}px`}
                className="h-full w-full object-contain pointer-events-none"
                style={{ borderRadius: `${itemCornerRadius}px` }}
                draggable={false}
              />
            )}
            {isImageCard && (
              <div className="relative h-full w-full">
                <div className="absolute inset-x-4 top-0 flex items-center justify-between gap-3 text-sm font-medium text-zinc-500">
                  <div className="inline-flex min-w-0 items-center gap-1.5">
                    <ImageIcon size={14} strokeWidth={2.1} />
                    <span>Image</span>
                  </div>
                  {(currentImageDimensionsLabel || cardGenerationDurationLabel) && (
                    <div className="inline-flex items-center gap-2">
                      {currentImageDimensionsLabel && (
                        <div className="workspace-control-chip inline-flex h-6 items-center gap-1 rounded-lg px-2 text-[11px]">
                          <span>{currentImageDimensionsLabel}</span>
                        </div>
                      )}
                      {cardGenerationDurationLabel && (
                        <div className="workspace-control-chip inline-flex h-6 items-center gap-1 rounded-lg px-2 text-[11px]">
                          <Clock3 size={12} strokeWidth={2} />
                          <span>{cardGenerationDurationLabel}</span>
                        </div>
                      )}
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
                        <span className="workspace-text-card-waiting text-[17px] font-medium tracking-[-0.03em] text-zinc-500">
                          图片生成中……
                        </span>
                      </div>
                    )}
                    {imageCardVisualState === 'content' && item.src && (() => {
                      return (
                        <div className="relative h-full w-full overflow-hidden bg-black/20">
                          <Image
                            src={item.src}
                            alt=""
                            fill
                            unoptimized
                            sizes={`${Math.max(1, Math.round(item.width - TEXT_CARD_FRAME_INSET_X * 2))}px`}
                            className="object-cover pointer-events-none"
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
                                className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-black/55 text-zinc-100 transition-colors hover:bg-black/70"
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
                                className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-black/55 text-zinc-100 transition-colors hover:bg-black/70"
                                aria-label="查看下一张"
                              >
                                <ArrowLeft size={15} className="rotate-180" />
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    })()}
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
                  {cardGenerationDurationLabel && (
                    <div className="workspace-control-chip inline-flex h-6 items-center gap-1 rounded-lg px-2 text-[11px]">
                      <Clock3 size={12} strokeWidth={2} />
                      <span>{cardGenerationDurationLabel}</span>
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
                        <span className="workspace-text-card-waiting text-[17px] font-medium tracking-[-0.03em] text-zinc-500">
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
            {isItemSelected &&
              !showMultiSelectionGroup &&
              ((isTextCard || isImageCard) && textCardFrameBounds ? (
                <div
                  className="absolute z-10 pointer-events-none"
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
                  className="absolute z-10 pointer-events-none"
                  style={{
                    inset: `${-NODE_SELECTED_OUTLINE_WIDTH}px`,
                    borderRadius: `${selectedOutlineCornerRadius}px`,
                    border: `${NODE_SELECTED_OUTLINE_WIDTH}px solid ${NODE_SELECTED_OUTLINE_COLOR}`,
                  }}
                />
              ))}
            {showCornerResizeHandle && (
              <button
                data-corner-resize="true"
                onPointerDown={(e) => onCornerResizePointerDown(e, item)}
                className="absolute flex cursor-nwse-resize items-center justify-center overflow-visible bg-transparent"
                style={{
                  width: `${CORNER_HANDLE_HIT_SIZE}px`,
                  height: `${CORNER_HANDLE_HIT_SIZE}px`,
                  right: isTextCard
                    ? `${TEXT_CARD_FRAME_INSET_X + CORNER_HANDLE_HIT_OFFSET}px`
                    : `${CORNER_HANDLE_HIT_OFFSET}px`,
                  bottom: isTextCard
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
                    d={`M ${CORNER_HANDLE_CENTER + HANDLE_ARC_RADIUS} ${CORNER_HANDLE_CENTER} A ${HANDLE_ARC_RADIUS} ${HANDLE_ARC_RADIUS} 0 0 1 ${CORNER_HANDLE_CENTER} ${CORNER_HANDLE_CENTER + HANDLE_ARC_RADIUS}`}
                    fill="none"
                    stroke="rgba(226,232,240,0.8)"
                    strokeWidth={CORNER_HANDLE_STROKE}
                    strokeLinecap="round"
                  />
                </svg>
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
});

const CanvasViewport = memo(function CanvasViewport({
  canvasRef,
  widthStyle,
  isSpacePressed,
  isPanning,
  viewport,
  themePalette,
  items,
  connections,
  itemById,
  selectedIds,
  selectedId,
  selectedConnectionIds,
  hoveredCanvasItemId,
  hoveredInputPortItemId,
  hoveredOutputPortItemId,
  magneticPorts,
  connectionMode,
  connectionSnapTargetId,
  connectionFromItemId,
  frozenPreviewConnection,
  pendingConnectionMenu,
  multiSelectionBounds,
  isMarqueeSelecting,
  marqueeRect,
  getPreviewRenderPoints,
  getConnectionAnchorCanvasPoint,
  toCanvasScreenPoint,
  buildConnectionPath,
  getRenderedPortOverlayPoint,
  getMagneticPortKey,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerLeave,
  onWheel,
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
  generationClockMs,
  selectedTextPanelModel,
  textPanelModelOptions,
  showTextPanelModelMenu,
  textPanelModelMenuRef,
  selectedTextCardPanelInput,
  selectedTextCardPanelCanSubmit,
  selectedTextCardPanelError,
  isSelectedTextCardGenerating,
  selectedImageCardPanelInput,
  selectedImageCardPanelCanSubmit,
  selectedImageCardPanelError,
  selectedImageCardModel,
  imageCardModelOptions,
  selectedImageCardPanelSize,
  selectedImageCardSizeOptions,
  selectedImageCardPanelQuality,
  selectedImageCardPanelCount,
  selectedImageCardPanelAspectRatio,
  isSelectedImageCardGenerating,
  showImageCardModelMenu,
  imageCardModelMenuRef,
  imageCardModelPopoverRef,
  showImageCardAspectRatioMenu,
  imageCardAspectRatioMenuRef,
  imageCardAspectRatioPopoverRef,
  showImageCardResolutionMenu,
  imageCardResolutionMenuRef,
  imageCardResolutionPopoverRef,
  showImageCardQualityMenu,
  imageCardQualityMenuRef,
  imageCardQualityPopoverRef,
  showImageCardCountMenu,
  imageCardCountMenuRef,
  imageCardCountPopoverRef,
  editingTextCardId,
  editingTextCardTextareaRef,
  onToggleTextPanelModelMenu,
  onSelectTextPanelModel,
  onSelectedTextCardPanelInputChange,
  onSelectedTextCardPanelBlur,
  onSelectedTextCardPanelSubmit,
  onSelectedTextCardPanelCancel,
  onToggleImageCardModelMenu,
  onSelectImageCardModel,
  onToggleImageCardAspectRatioMenu,
  onToggleImageCardResolutionMenu,
  onToggleImageCardQualityMenu,
  onSelectImageCardSize,
  onSelectImageCardQuality,
  onToggleImageCardCountMenu,
  onSelectImageCardCount,
  onSelectImageCardAspectRatio,
  onSelectedImageCardPanelInputChange,
  onSelectedImageCardPanelBlur,
  onSelectedImageCardPanelSubmit,
  onSelectedImageCardPanelCancel,
  onItemDoubleClick,
  onManualTextCardInputChange,
  onManualTextCardBlur,
  onImageCardOutputSelect,
  draggingPanelReference,
  dragOverPanelReference,
  onPanelReferenceDragStart,
  onPanelReferenceDragOver,
  onPanelReferenceDrop,
  onPanelReferenceDragEnd,
}: {
  canvasRef: React.RefObject<HTMLDivElement | null>;
  widthStyle: string;
  isSpacePressed: boolean;
  isPanning: boolean;
  viewport: ViewportState;
  themePalette: typeof DARK_THEME;
  items: CanvasItem[];
  connections: Connection[];
  itemById: Record<string, CanvasItem>;
  selectedIds: string[];
  selectedId: string | null;
  selectedConnectionIds: string[];
  hoveredCanvasItemId: string | null;
  hoveredInputPortItemId: string | null;
  hoveredOutputPortItemId: string | null;
  magneticPorts: MagneticPortMap;
  connectionMode: ConnectionMode;
  connectionSnapTargetId: string | null;
  connectionFromItemId: string | null;
  frozenPreviewConnection: FrozenPreviewConnection | null;
  pendingConnectionMenu: PendingConnectionMenu | null;
  multiSelectionBounds: { left: number; top: number; width: number; height: number } | null;
  isMarqueeSelecting: boolean;
  marqueeRect: { x: number; y: number; width: number; height: number } | null;
  getPreviewRenderPoints: () => { from: { x: number; y: number } | null; to: { x: number; y: number } | null };
  getConnectionAnchorCanvasPoint: (item: CanvasItem, side: 'left' | 'right') => { x: number; y: number };
  toCanvasScreenPoint: (point: { x: number; y: number }) => { x: number; y: number };
  buildConnectionPath: (from: { x: number; y: number }, to: { x: number; y: number }) => string;
  getRenderedPortOverlayPoint: (item: CanvasItem, side: PortSide) => { x: number; y: number };
  getMagneticPortKey: (itemId: string, side: PortSide) => string;
  onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => void;
  onPointerMove: (e: React.PointerEvent<HTMLDivElement>) => void;
  onPointerUp: (e?: React.PointerEvent<HTMLDivElement>) => void;
  onPointerLeave: () => void;
  onWheel: (e: React.WheelEvent<HTMLDivElement>) => void;
  onPaste: (e: React.ClipboardEvent<HTMLDivElement>) => void;
  onConnectionPointerDown: (e: React.PointerEvent<SVGPathElement>, connectionId: string) => void;
  onInputPortEnter: (itemId: string) => void;
  onInputPortLeave: (itemId: string) => void;
  onOutputPortEnter: (itemId: string) => void;
  onOutputPortLeave: (itemId: string) => void;
  onOutputPortPointerDown: (
    e: React.PointerEvent<HTMLElement>,
    item: CanvasItem,
    source: 'bridge' | 'button'
  ) => void;
  onSelectionGroupPointerDown: (e: React.PointerEvent<HTMLDivElement>) => void;
  onItemMouseEnter: (itemId: string) => void;
  onItemMouseLeave: (itemId: string) => void;
  onItemClick: (e: React.MouseEvent<HTMLDivElement>, itemId: string) => void;
  onItemPointerDown: (e: React.PointerEvent<HTMLDivElement>, itemId: string) => void;
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
  generationClockMs: number;
  selectedTextPanelModel: { id: string; label: string };
  textPanelModelOptions: Array<{ id: string; label: string }>;
  showTextPanelModelMenu: boolean;
  textPanelModelMenuRef: React.RefObject<HTMLDivElement | null>;
  selectedTextCardPanelInput: string;
  selectedTextCardPanelCanSubmit: boolean;
  selectedTextCardPanelError: string | null;
  isSelectedTextCardGenerating: boolean;
  selectedImageCardPanelInput: string;
  selectedImageCardPanelCanSubmit: boolean;
  selectedImageCardPanelError: string | null;
  selectedImageCardModel: { id: string; label: string };
  imageCardModelOptions: Array<{ id: string; label: string }>;
  selectedImageCardPanelSize: string;
  selectedImageCardSizeOptions: Array<{ id: string; label: string }>;
  selectedImageCardPanelQuality: string;
  selectedImageCardPanelCount: number;
  selectedImageCardPanelAspectRatio: string;
  isSelectedImageCardGenerating: boolean;
  showImageCardModelMenu: boolean;
  imageCardModelMenuRef: React.RefObject<HTMLDivElement | null>;
  imageCardModelPopoverRef: React.RefObject<HTMLDivElement | null>;
  showImageCardAspectRatioMenu: boolean;
  imageCardAspectRatioMenuRef: React.RefObject<HTMLDivElement | null>;
  imageCardAspectRatioPopoverRef: React.RefObject<HTMLDivElement | null>;
  showImageCardResolutionMenu: boolean;
  imageCardResolutionMenuRef: React.RefObject<HTMLDivElement | null>;
  imageCardResolutionPopoverRef: React.RefObject<HTMLDivElement | null>;
  showImageCardQualityMenu: boolean;
  imageCardQualityMenuRef: React.RefObject<HTMLDivElement | null>;
  imageCardQualityPopoverRef: React.RefObject<HTMLDivElement | null>;
  showImageCardCountMenu: boolean;
  imageCardCountMenuRef: React.RefObject<HTMLDivElement | null>;
  imageCardCountPopoverRef: React.RefObject<HTMLDivElement | null>;
  editingTextCardId: string | null;
  editingTextCardTextareaRef: React.RefObject<HTMLTextAreaElement | null>;
  onToggleTextPanelModelMenu: () => void;
  onSelectTextPanelModel: (modelId: string) => void;
  onSelectedTextCardPanelInputChange: (value: string) => void;
  onSelectedTextCardPanelBlur: () => void;
  onSelectedTextCardPanelSubmit: () => void;
  onSelectedTextCardPanelCancel: () => void;
  onToggleImageCardModelMenu: () => void;
  onSelectImageCardModel: (modelId: string) => void;
  onToggleImageCardAspectRatioMenu: () => void;
  onToggleImageCardResolutionMenu: () => void;
  onToggleImageCardQualityMenu: () => void;
  onSelectImageCardSize: (sizeId: string) => void;
  onSelectImageCardQuality: (qualityId: string) => void;
  onToggleImageCardCountMenu: () => void;
  onSelectImageCardCount: (count: number) => void;
  onSelectImageCardAspectRatio: (aspectRatioId: string) => void;
  onSelectedImageCardPanelInputChange: (value: string) => void;
  onSelectedImageCardPanelBlur: () => void;
  onSelectedImageCardPanelSubmit: () => void;
  onSelectedImageCardPanelCancel: () => void;
  onItemDoubleClick: (itemId: string) => void;
  onManualTextCardInputChange: (itemId: string, value: string) => void;
  onManualTextCardBlur: (itemId: string) => void;
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
  const { from, to } = getPreviewRenderPoints();
  const selectedTextCardPanelTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const selectedImageCardPanelTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const selectedImageCardPanelRootRef = useRef<HTMLDivElement | null>(null);
  const [selectedImageCardModelPopoverOffset, setSelectedImageCardModelPopoverOffset] = useState<{ left: number; top: number } | null>(null);
  const [selectedImageCardAspectRatioPopoverOffset, setSelectedImageCardAspectRatioPopoverOffset] = useState<{ left: number; top: number } | null>(null);
  const [selectedImageCardResolutionPopoverOffset, setSelectedImageCardResolutionPopoverOffset] = useState<{ left: number; top: number } | null>(null);
  const [selectedImageCardQualityPopoverOffset, setSelectedImageCardQualityPopoverOffset] = useState<{ left: number; top: number } | null>(null);
  const [selectedImageCardCountPopoverOffset, setSelectedImageCardCountPopoverOffset] = useState<{ left: number; top: number } | null>(null);
  const [selectedTextCardPanelInputMetrics, setSelectedTextCardPanelInputMetrics] = useState(() => ({
    height: TEXT_CARD_PANEL_INPUT_MIN_HEIGHT,
    isOverflowing: false,
  }));
  const [selectedImageCardPanelInputMetrics, setSelectedImageCardPanelInputMetrics] = useState(() => ({
    height: TEXT_CARD_PANEL_INPUT_MIN_HEIGHT,
    isOverflowing: false,
  }));
  const canvasRect = canvasRef.current?.getBoundingClientRect();
  const canvasSize = {
    width: canvasRect?.width ?? 0,
    height: canvasRect?.height ?? 0,
  };
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
    if (!selectedTextCardPanelItem) {
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
  }, [selectedTextCardPanelCanvasWidth, selectedTextCardPanelDisplayInput, selectedTextCardPanelItem]);
  useLayoutEffect(() => {
    if (!selectedImageCardPanelItem) {
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
  }, [selectedImageCardPanelCanvasWidth, selectedImageCardPanelDisplayInput, selectedImageCardPanelItem]);
  useLayoutEffect(() => {
    if (!showImageCardModelMenu || !selectedImageCardPanelItem) {
      setSelectedImageCardModelPopoverOffset(null);
      return;
    }

    const panelElement = selectedImageCardPanelRootRef.current;
    const anchorElement = imageCardModelMenuRef.current;
    if (!panelElement || !anchorElement || viewport.scale <= 0) {
      return;
    }

    const panelRect = panelElement.getBoundingClientRect();
    const anchorRect = anchorElement.getBoundingClientRect();

    setSelectedImageCardModelPopoverOffset(
      resolveFloatingPopoverOffset({
        panelRect,
        anchorRect,
        scale: viewport.scale,
        placement: 'below-panel',
        gap: 12,
      })
    );
  }, [imageCardModelMenuRef, selectedImageCardPanelItem, showImageCardModelMenu, viewport.scale]);
  useLayoutEffect(() => {
    if (!showImageCardAspectRatioMenu || !selectedImageCardPanelItem) {
      setSelectedImageCardAspectRatioPopoverOffset(null);
      return;
    }

    const panelElement = selectedImageCardPanelRootRef.current;
    const anchorElement = imageCardAspectRatioMenuRef.current;
    if (!panelElement || !anchorElement || viewport.scale <= 0) {
      return;
    }

    const panelRect = panelElement.getBoundingClientRect();
    const anchorRect = anchorElement.getBoundingClientRect();

    setSelectedImageCardAspectRatioPopoverOffset(
      resolveFloatingPopoverOffset({
        panelRect,
        anchorRect,
        scale: viewport.scale,
        placement: 'below-panel',
        gap: 12,
      })
    );
  }, [imageCardAspectRatioMenuRef, selectedImageCardPanelItem, showImageCardAspectRatioMenu, viewport.scale]);
  useLayoutEffect(() => {
    if (!showImageCardResolutionMenu || !selectedImageCardPanelItem) {
      setSelectedImageCardResolutionPopoverOffset(null);
      return;
    }

    const panelElement = selectedImageCardPanelRootRef.current;
    const anchorElement = imageCardResolutionMenuRef.current;
    if (!panelElement || !anchorElement || viewport.scale <= 0) {
      return;
    }

    const panelRect = panelElement.getBoundingClientRect();
    const anchorRect = anchorElement.getBoundingClientRect();

    setSelectedImageCardResolutionPopoverOffset(
      resolveFloatingPopoverOffset({
        panelRect,
        anchorRect,
        scale: viewport.scale,
        placement: 'below-panel',
        gap: 12,
      })
    );
  }, [imageCardResolutionMenuRef, selectedImageCardPanelItem, showImageCardResolutionMenu, viewport.scale]);
  useLayoutEffect(() => {
    if (!showImageCardQualityMenu || !selectedImageCardPanelItem) {
      setSelectedImageCardQualityPopoverOffset(null);
      return;
    }

    const panelElement = selectedImageCardPanelRootRef.current;
    const anchorElement = imageCardQualityMenuRef.current;
    if (!panelElement || !anchorElement || viewport.scale <= 0) {
      return;
    }

    const panelRect = panelElement.getBoundingClientRect();
    const anchorRect = anchorElement.getBoundingClientRect();

    setSelectedImageCardQualityPopoverOffset(
      resolveFloatingPopoverOffset({
        panelRect,
        anchorRect,
        scale: viewport.scale,
        placement: 'below-panel',
        gap: 12,
      })
    );
  }, [imageCardQualityMenuRef, selectedImageCardPanelItem, showImageCardQualityMenu, viewport.scale]);
  useLayoutEffect(() => {
    if (!showImageCardCountMenu || !selectedImageCardPanelItem) {
      setSelectedImageCardCountPopoverOffset(null);
      return;
    }

    const panelElement = selectedImageCardPanelRootRef.current;
    const anchorElement = imageCardCountMenuRef.current;
    if (!panelElement || !anchorElement || viewport.scale <= 0) {
      return;
    }

    const panelRect = panelElement.getBoundingClientRect();
    const anchorRect = anchorElement.getBoundingClientRect();

    setSelectedImageCardCountPopoverOffset(
      resolveFloatingPopoverOffset({
        panelRect,
        anchorRect,
        scale: viewport.scale,
        placement: 'below-panel',
        gap: 12,
      })
    );
  }, [imageCardCountMenuRef, selectedImageCardPanelItem, showImageCardCountMenu, viewport.scale]);

  const selectedTextCardPanelCanvasHeight =
    TEXT_CARD_GENERATION_PANEL_BASE_HEIGHT +
    (linkedImagePreviews.length > 0 ? TEXT_CARD_GENERATION_PANEL_PREVIEW_HEIGHT : 0) +
    Math.max(0, selectedTextCardPanelInputMetrics.height - TEXT_CARD_PANEL_INPUT_MIN_HEIGHT);
  const selectedImageCardPanelCanvasHeight =
    TEXT_CARD_GENERATION_PANEL_BASE_HEIGHT +
    (selectedImageCardPanelLinkedImagePreviews.length > 0 ? TEXT_CARD_GENERATION_PANEL_PREVIEW_HEIGHT : 0) +
    Math.max(0, selectedImageCardPanelInputMetrics.height - TEXT_CARD_PANEL_INPUT_MIN_HEIGHT);
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
          left:
            selectedImageCardPanelItem.x +
            selectedImageCardPanelFrameBounds.left +
            (selectedImageCardPanelFrameBounds.width - selectedImageCardPanelCanvasWidth) / 2,
          top:
            selectedImageCardPanelItem.y +
            selectedImageCardPanelFrameBounds.top +
            selectedImageCardPanelFrameBounds.height +
            18,
          width: selectedImageCardPanelCanvasWidth,
          height: selectedImageCardPanelCanvasHeight,
        }
      : null;
  const selectedTextCardPanelScreenPoint = selectedTextCardPanelCanvasRect
    ? toCanvasScreenPoint({
        x: selectedTextCardPanelCanvasRect.left,
        y: selectedTextCardPanelCanvasRect.top,
      })
    : null;
  const selectedTextCardPanelViewportOrigin = selectedTextCardPanelScreenPoint && canvasRect
    ? {
        left: canvasRect.left + selectedTextCardPanelScreenPoint.x,
        top: canvasRect.top + selectedTextCardPanelScreenPoint.y,
      }
    : null;
  const selectedImageCardPanelScreenPoint = selectedImageCardPanelCanvasRect
    ? toCanvasScreenPoint({
        x: selectedImageCardPanelCanvasRect.left,
        y: selectedImageCardPanelCanvasRect.top,
      })
    : null;
  const selectedImageCardPanelViewportOrigin = selectedImageCardPanelScreenPoint && canvasRect
    ? {
        left: canvasRect.left + selectedImageCardPanelScreenPoint.x,
        top: canvasRect.top + selectedImageCardPanelScreenPoint.y,
      }
    : null;
  const portaledSelectedImageCardPanel =
    typeof document !== 'undefined' &&
    selectedImageCardPanelItem &&
    selectedImageCardPanelFrameBounds &&
    selectedImageCardPanelCanvasRect &&
    selectedImageCardPanelViewportOrigin
      ? createPortal(
          <>
            <div className="pointer-events-none fixed inset-0 z-[115]">
              <div
              data-text-card-panel="true"
              ref={selectedImageCardPanelRootRef}
              className="workspace-panel-surface pointer-events-auto fixed overflow-hidden rounded-[26px]"
              style={{
                left: selectedImageCardPanelViewportOrigin.left,
                top: selectedImageCardPanelViewportOrigin.top,
                width: selectedImageCardPanelCanvasRect.width,
                transform: `scale(${viewport.scale})`,
                transformOrigin: 'top left',
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
                          className={`relative h-20 w-20 shrink-0 overflow-hidden rounded-[14px] border bg-black/25 transition-all ${
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
                <div className="grid min-w-0 flex-1 grid-cols-5 gap-2">
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
                      className={`workspace-control-chip flex min-h-[52px] w-full flex-col items-start justify-center rounded-[14px] px-3 py-2 text-left ${showImageCardModelMenu ? 'is-active' : ''}`}
                      aria-haspopup="menu"
                      aria-expanded={showImageCardModelMenu}
                    >
                      <span className="flex w-full items-center justify-between gap-2">
                        <span className="workspace-text-muted text-[11px] font-medium">模型</span>
                        <ChevronDown size={14} className={`shrink-0 transition-transform ${showImageCardModelMenu ? 'rotate-180' : ''}`} />
                      </span>
                      <span className="mt-1 flex w-full items-center gap-2 text-[13px] font-semibold tracking-[-0.02em]">
                        <Sparkles size={14} className="shrink-0" />
                        <span className="truncate">{selectedImageCardModel.label}</span>
                      </span>
                    </button>
                  </div>
                  <div className="relative" ref={imageCardAspectRatioMenuRef}>
                    <button
                      data-text-card-panel-control="true"
                      type="button"
                      onPointerDown={(e) => {
                        e.stopPropagation();
                      }}
                      onClick={() => {
                        onToggleImageCardAspectRatioMenu();
                      }}
                      className={`workspace-control-chip flex min-h-[52px] w-full flex-col items-start justify-center rounded-[14px] px-3 py-2 text-left ${showImageCardAspectRatioMenu ? 'is-active' : ''}`}
                      aria-haspopup="menu"
                      aria-expanded={showImageCardAspectRatioMenu}
                    >
                      <span className="flex w-full items-center justify-between gap-2">
                        <span className="workspace-text-muted text-[11px] font-medium">比例</span>
                        <ChevronDown size={14} className={`shrink-0 transition-transform ${showImageCardAspectRatioMenu ? 'rotate-180' : ''}`} />
                      </span>
                      <span className="mt-1 text-[13px] font-semibold tracking-[-0.02em]">
                        {getImageCardAspectRatioShortLabel(selectedImageCardPanelAspectRatio)}
                      </span>
                    </button>
                  </div>
                  <div className="relative" ref={imageCardResolutionMenuRef}>
                    <button
                      data-text-card-panel-control="true"
                      type="button"
                      onPointerDown={(e) => {
                        e.stopPropagation();
                      }}
                      onClick={() => {
                        onToggleImageCardResolutionMenu();
                      }}
                      className={`workspace-control-chip flex min-h-[52px] w-full flex-col items-start justify-center rounded-[14px] px-3 py-2 text-left ${showImageCardResolutionMenu ? 'is-active' : ''}`}
                      aria-haspopup="menu"
                      aria-expanded={showImageCardResolutionMenu}
                    >
                      <span className="flex w-full items-center justify-between gap-2">
                        <span className="workspace-text-muted text-[11px] font-medium">清晰度</span>
                        <ChevronDown size={14} className={`shrink-0 transition-transform ${showImageCardResolutionMenu ? 'rotate-180' : ''}`} />
                      </span>
                      <span className="mt-1 text-[13px] font-semibold tracking-[-0.02em]">
                        {selectedImageCardSizeOptions.find((item) => item.id === selectedImageCardPanelSize)?.label || selectedImageCardPanelSize}
                      </span>
                    </button>
                  </div>
                  <div className="relative" ref={imageCardQualityMenuRef}>
                    <button
                      data-text-card-panel-control="true"
                      type="button"
                      onPointerDown={(e) => {
                        e.stopPropagation();
                      }}
                      onClick={() => {
                        onToggleImageCardQualityMenu();
                      }}
                      className={`workspace-control-chip flex min-h-[52px] w-full flex-col items-start justify-center rounded-[14px] px-3 py-2 text-left ${showImageCardQualityMenu ? 'is-active' : ''}`}
                      aria-haspopup="menu"
                      aria-expanded={showImageCardQualityMenu}
                    >
                      <span className="flex w-full items-center justify-between gap-2">
                        <span className="workspace-text-muted text-[11px] font-medium">质量</span>
                        <ChevronDown size={14} className={`shrink-0 transition-transform ${showImageCardQualityMenu ? 'rotate-180' : ''}`} />
                      </span>
                      <span className="mt-1 text-[13px] font-semibold tracking-[-0.02em]">
                        {getImageCardQualityLabel(selectedImageCardPanelQuality)}
                      </span>
                    </button>
                  </div>
                  <div className="relative" ref={imageCardCountMenuRef}>
                    <button
                      data-text-card-panel-control="true"
                      type="button"
                      onPointerDown={(e) => {
                        e.stopPropagation();
                      }}
                      onClick={() => {
                        onToggleImageCardCountMenu();
                      }}
                      className={`workspace-control-chip flex min-h-[52px] w-full flex-col items-start justify-center rounded-[14px] px-3 py-2 text-left ${showImageCardCountMenu ? 'is-active' : ''}`}
                      aria-haspopup="menu"
                      aria-expanded={showImageCardCountMenu}
                    >
                      <span className="flex w-full items-center justify-between gap-2">
                        <span className="workspace-text-muted text-[11px] font-medium">张数</span>
                        <ChevronDown size={14} className={`shrink-0 transition-transform ${showImageCardCountMenu ? 'rotate-180' : ''}`} />
                      </span>
                      <span className="mt-1 text-[13px] font-semibold tracking-[-0.02em]">
                        {IMAGE_CARD_COUNT_OPTIONS.find((item) => item.id === selectedImageCardPanelCount)?.label || `X${selectedImageCardPanelCount}`}
                      </span>
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
                    className="workspace-add-button inline-flex h-11 w-11 items-center justify-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-50"
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
          </div>
            {showImageCardModelMenu && selectedImageCardModelPopoverOffset && (
              <div
                ref={imageCardModelPopoverRef}
                data-text-card-panel-control="true"
                className="workspace-menu-panel pointer-events-auto fixed z-[116] min-w-[248px] overflow-hidden rounded-[18px] p-1.5"
                style={{
                  left: selectedImageCardPanelViewportOrigin.left + selectedImageCardModelPopoverOffset.left * viewport.scale,
                  top: selectedImageCardPanelViewportOrigin.top + selectedImageCardModelPopoverOffset.top * viewport.scale,
                  transform: `scale(${viewport.scale})`,
                  transformOrigin: 'top left',
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
            {showImageCardAspectRatioMenu && selectedImageCardAspectRatioPopoverOffset && (
              <div
                ref={imageCardAspectRatioPopoverRef}
                data-text-card-panel-control="true"
                className="workspace-menu-panel pointer-events-auto fixed z-[116] overflow-hidden rounded-[22px] p-3"
                style={{
                  left: selectedImageCardPanelViewportOrigin.left + selectedImageCardAspectRatioPopoverOffset.left * viewport.scale,
                  top: selectedImageCardPanelViewportOrigin.top + selectedImageCardAspectRatioPopoverOffset.top * viewport.scale,
                  width: 292,
                  transform: `scale(${viewport.scale})`,
                  transformOrigin: 'top left',
                }}
                onPointerDown={(e) => {
                  e.stopPropagation();
                }}
              >
                <div className="workspace-panel-input rounded-[18px] p-3">
                  <div className="mb-2.5 flex items-center justify-between">
                    <span className="text-[11px] font-medium tracking-[0.04em] text-zinc-500">比例</span>
                    <span className="text-[11px] font-medium text-zinc-400">
                      {getImageCardAspectRatioShortLabel(selectedImageCardPanelAspectRatio)}
                    </span>
                  </div>
                  <div className="grid grid-cols-4 gap-1.5">
                    {ASPECT_RATIOS.filter((option) => option.id !== 'auto').map((option) => {
                      const isSelected = option.id === selectedImageCardPanelAspectRatio;
                      const previewSize = getImageCardAspectRatioPreviewSize(option.id);
                      return (
                        <button
                          key={option.id}
                          type="button"
                          onClick={() => {
                            onSelectImageCardAspectRatio(option.id);
                          }}
                          className={`workspace-control-chip flex min-h-[58px] flex-col items-center justify-center gap-1.5 rounded-[14px] px-1.5 py-2 text-center ${isSelected ? 'is-active' : ''}`}
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
              </div>
            )}
            {showImageCardResolutionMenu && selectedImageCardResolutionPopoverOffset && (
              <div
                ref={imageCardResolutionPopoverRef}
                data-text-card-panel-control="true"
                className="workspace-menu-panel pointer-events-auto fixed z-[116] overflow-hidden rounded-[22px] p-3"
                style={{
                  left: selectedImageCardPanelViewportOrigin.left + selectedImageCardResolutionPopoverOffset.left * viewport.scale,
                  top: selectedImageCardPanelViewportOrigin.top + selectedImageCardResolutionPopoverOffset.top * viewport.scale,
                  width: 292,
                  transform: `scale(${viewport.scale})`,
                  transformOrigin: 'top left',
                }}
                onPointerDown={(e) => {
                  e.stopPropagation();
                }}
              >
                <div className="workspace-panel-input rounded-[18px] p-3">
                  <div className="mb-2.5 flex items-center justify-between">
                    <span className="text-[11px] font-medium tracking-[0.04em] text-zinc-500">清晰度</span>
                    <span className="text-[11px] font-medium text-zinc-400">
                      {selectedImageCardSizeOptions.find((item) => item.id === selectedImageCardPanelSize)?.label || selectedImageCardPanelSize}
                    </span>
                  </div>
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
              </div>
            )}
            {showImageCardQualityMenu && selectedImageCardQualityPopoverOffset && (
              <div
                ref={imageCardQualityPopoverRef}
                data-text-card-panel-control="true"
                className="workspace-menu-panel pointer-events-auto fixed z-[116] overflow-hidden rounded-[22px] p-3"
                style={{
                  left: selectedImageCardPanelViewportOrigin.left + selectedImageCardQualityPopoverOffset.left * viewport.scale,
                  top: selectedImageCardPanelViewportOrigin.top + selectedImageCardQualityPopoverOffset.top * viewport.scale,
                  width: 292,
                  transform: `scale(${viewport.scale})`,
                  transformOrigin: 'top left',
                }}
                onPointerDown={(e) => {
                  e.stopPropagation();
                }}
              >
                <div className="workspace-panel-input rounded-[18px] p-3">
                  <div className="mb-2.5 flex items-center justify-between">
                    <span className="text-[11px] font-medium tracking-[0.04em] text-zinc-500">质量</span>
                    <span className="text-[11px] font-medium text-zinc-400">
                      {getImageCardQualityLabel(selectedImageCardPanelQuality)}
                    </span>
                  </div>
                  <div className="workspace-panel-input inline-flex w-full items-center rounded-[14px] p-1">
                    {IMAGE_CARD_QUALITY_OPTIONS.map((option) => {
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
            )}
            {showImageCardCountMenu && selectedImageCardCountPopoverOffset && (
              <div
                ref={imageCardCountPopoverRef}
                data-text-card-panel-control="true"
                className="workspace-menu-panel pointer-events-auto fixed z-[116] min-w-[124px] overflow-hidden rounded-[18px] p-1.5"
                style={{
                  left: selectedImageCardPanelViewportOrigin.left + selectedImageCardCountPopoverOffset.left * viewport.scale,
                  top: selectedImageCardPanelViewportOrigin.top + selectedImageCardCountPopoverOffset.top * viewport.scale,
                  transform: `scale(${viewport.scale})`,
                  transformOrigin: 'top left',
                }}
                onPointerDown={(e) => {
                  e.stopPropagation();
                }}
              >
                {IMAGE_CARD_COUNT_OPTIONS.map((option) => {
                  const isSelected = option.id === selectedImageCardPanelCount;
                  return (
                    <button
                      key={option.id}
                      type="button"
                      onClick={() => {
                        onSelectImageCardCount(option.id);
                      }}
                      className={`workspace-menu-item flex w-full items-center justify-between rounded-[14px] border border-transparent px-3 py-2.5 text-left ${isSelected ? 'is-selected' : ''}`}
                    >
                      <span className="text-[13px] font-semibold tracking-[-0.02em]">{option.label}</span>
                      {isSelected && <Check size={15} className="ml-3 shrink-0" />}
                    </button>
                  );
                })}
              </div>
            )}
          </>,
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
          <div className="pointer-events-none fixed inset-0 z-[115]">
            <div
              data-text-card-panel="true"
              className="workspace-panel-surface pointer-events-auto fixed overflow-hidden rounded-[26px]"
              style={{
                left: selectedTextCardPanelViewportOrigin.left,
                top: selectedTextCardPanelViewportOrigin.top,
                width: selectedTextCardPanelCanvasRect.width,
                transform: `scale(${viewport.scale})`,
                transformOrigin: 'top left',
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
                          className={`relative h-20 w-20 shrink-0 overflow-hidden rounded-[14px] border bg-black/25 transition-all ${
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
                className="workspace-panel-footer flex items-center justify-between px-5 py-3"
              >
                <div className="relative" ref={textPanelModelMenuRef}>
                  {showTextPanelModelMenu && (
                    <div
                      data-text-card-panel-control="true"
                      className="workspace-menu-panel absolute bottom-full left-0 mb-2 min-w-[248px] overflow-hidden rounded-[18px] p-1.5"
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
                  <button
                    data-text-card-panel-control="true"
                    type="button"
                    onPointerDown={(e) => {
                      e.stopPropagation();
                    }}
                    onClick={() => {
                      onToggleTextPanelModelMenu();
                    }}
                    className={`workspace-control-chip inline-flex items-center gap-2 rounded-full px-2.5 py-1.5 text-[13px] font-semibold tracking-[-0.02em] ${showTextPanelModelMenu ? 'is-active' : ''}`}
                    aria-haspopup="menu"
                    aria-expanded={showTextPanelModelMenu}
                  >
                    <Sparkles size={15} />
                    <span>{selectedTextPanelModel.label}</span>
                    <ChevronDown size={14} className={`transition-transform ${showTextPanelModelMenu ? 'rotate-180' : ''}`} />
                  </button>
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
                    className="workspace-add-button inline-flex h-11 w-11 items-center justify-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-50"
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
          </div>,
          document.body
        )
      : null;

  return (
    <div
      ref={canvasRef}
      data-canvas="true"
      tabIndex={0}
      className={`relative z-0 shrink-0 overflow-hidden select-none ${isSpacePressed ? (isPanning ? 'cursor-grabbing' : 'cursor-grab') : 'cursor-default'}`}
      style={{ width: widthStyle }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onPointerLeave={onPointerLeave}
      onWheel={onWheel}
      onPaste={onPaste}
    >
      <CanvasBackgroundLayer theme={themePalette} viewport={viewport} />
      <CanvasConnectionsLayer
        canvasSize={canvasSize}
        connections={connections}
        theme={themePalette}
        itemById={itemById}
        selectedConnectionIds={selectedConnectionIds}
        viewport={viewport}
        previewFrom={from}
        previewTo={to}
        frozenPreviewConnection={frozenPreviewConnection}
        onConnectionPointerDown={onConnectionPointerDown}
        getConnectionAnchorCanvasPoint={getConnectionAnchorCanvasPoint}
        toCanvasScreenPoint={toCanvasScreenPoint}
        buildConnectionPath={buildConnectionPath}
      />
      <CanvasPortsLayer
        items={items}
        viewport={viewport}
        hoveredCanvasItemId={hoveredCanvasItemId}
        hoveredInputPortItemId={hoveredInputPortItemId}
        hoveredOutputPortItemId={hoveredOutputPortItemId}
        magneticPorts={magneticPorts}
        connectionFromItemId={connectionFromItemId}
        connectionMode={connectionMode}
        connectionSnapTargetId={connectionSnapTargetId}
        getMagneticPortKey={getMagneticPortKey}
        getRenderedPortOverlayPoint={getRenderedPortOverlayPoint}
        onInputPortEnter={onInputPortEnter}
        onInputPortLeave={onInputPortLeave}
        onOutputPortEnter={onOutputPortEnter}
        onOutputPortLeave={onOutputPortLeave}
        onOutputPortPointerDown={onOutputPortPointerDown}
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
                {CONNECTION_MENU_OPTIONS.map((option) => {
                  return (
                    <CanvasActionMenuItem
                      key={option.id}
                      title={option.title}
                      description={option.description}
                      Icon={option.icon}
                      onClick={() => onPendingMenuAction(option.id)}
                    />
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}
      {portaledSelectedTextCardPanel}
      {portaledSelectedImageCardPanel}
      <CanvasNodesLayer
        items={items}
        connections={connections}
        viewport={viewport}
        multiSelectionBounds={multiSelectionBounds}
        selectedIds={selectedIds}
        selectedId={selectedId}
        hoveredCanvasItemId={hoveredCanvasItemId}
        activeCanvasTextGenerationItemIds={activeCanvasTextGenerationItemIds}
        activeCanvasImageGenerationItemIds={activeCanvasImageGenerationItemIds}
        activeCanvasTextGenerations={activeCanvasTextGenerations}
        activeCanvasImageGenerations={activeCanvasImageGenerations}
        generationClockMs={generationClockMs}
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
      />
      {isMarqueeSelecting && marqueeRect && (
        <div
          className="absolute pointer-events-none border border-dashed border-white/35 bg-white/5"
          style={{
            left: marqueeRect.x,
            top: marqueeRect.y,
            width: marqueeRect.width,
            height: marqueeRect.height,
          }}
        />
      )}
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
              <div className="group relative mt-4 first:mt-0">
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
                  className="workspace-control-chip absolute right-3 top-1/2 z-[2] inline-flex h-7 -translate-y-1/2 items-center gap-1 rounded-lg px-2 text-[11px] opacity-70 transition-opacity duration-200 hover:opacity-100 group-hover:opacity-100"
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
      className={`workspace-menu-item group flex min-h-[68px] w-full items-center gap-2.5 rounded-[20px] border border-transparent px-3 py-2.5 text-left duration-200 ${disabled ? 'is-disabled' : ''}`}
    >
      <div
        className="workspace-menu-icon flex h-12 w-12 shrink-0 items-center justify-center rounded-[11px] transition-colors duration-200"
      >
        <Icon size={21} strokeWidth={2} />
      </div>
      <div className="flex min-w-0 flex-1 items-center pl-1">
        <div className={`relative min-w-0 flex-1 ${disabled ? 'flex flex-col justify-center gap-0.5' : 'h-[38px]'}`}>
          <div
            className={`min-w-0 text-[16px] font-medium tracking-[-0.03em] ${
              disabled
                ? 'workspace-text-soft'
                : 'workspace-text-primary absolute left-0 top-1/2 -translate-y-1/2 transition-transform duration-200 ease-out group-hover:-translate-y-[18px]'
            }`}
          >
            {title}
          </div>
          <div
            className={`workspace-text-muted min-w-0 whitespace-normal break-words text-[11px] font-medium tracking-[-0.01em] ${
              disabled
                ? ''
                : 'pointer-events-none absolute left-0 top-[22px] opacity-0 transition-[opacity,transform] duration-200 ease-out translate-y-1 group-hover:translate-y-0 group-hover:opacity-100'
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
  const [viewMode, setViewMode] = useState<'gallery' | 'editor'>('gallery');
  const [tool, setTool] = useState<Tool>('select');
  const [items, setItemsState] = useState<CanvasItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [hoveredCanvasItemId, setHoveredCanvasItemId] = useState<string | null>(null);
  const [hoveredInputPortItemId, setHoveredInputPortItemId] = useState<string | null>(null);
  const [hoveredOutputPortItemId, setHoveredOutputPortItemId] = useState<string | null>(null);
  const [connectionMode, setConnectionMode] = useState<ConnectionMode>('idle');
  const [connectionFromItemId, setConnectionFromItemId] = useState<string | null>(null);
  const [connectionPoint, setConnectionPoint] = useState<{ x: number; y: number } | null>(null);
  const [connectionPointerId, setConnectionPointerId] = useState<number | null>(null);
  const [frozenPreviewConnection, setFrozenPreviewConnection] = useState<FrozenPreviewConnection | null>(null);
  const [pendingConnectionMenu, setPendingConnectionMenu] = useState<PendingConnectionMenu | null>(null);
  const [magneticPorts, setMagneticPorts] = useState<MagneticPortMap>({});
  const [viewport, setViewportState] = useState({ x: 0, y: 0, scale: 1 });
  const [isDragging, setIsDragging] = useState(false);
  const [isPanning, setIsPanning] = useState(false);
  const [isCornerResizing, setIsCornerResizing] = useState(false);
  const [isSpacePressed, setIsSpacePressed] = useState(false);
  const [isMarqueeSelecting, setIsMarqueeSelecting] = useState(false);
  const [marqueeRect, setMarqueeRect] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const [connections, setConnectionsState] = useState<Connection[]>([]);
  const [selectedConnectionIds, setSelectedConnectionIds] = useState<string[]>([]);
  const [connectionSnapTargetId, setConnectionSnapTargetId] = useState<string | null>(null);
  const dragStart = useRef({ x: 0, y: 0 });
  const panStartOffset = useRef({ x: 0, y: 0 });
  const latestInteractionPointerRef = useRef<{ x: number; y: number } | null>(null);
  const interactionFrameRef = useRef<number | null>(null);
  const zoomAnimationFrameRef = useRef<number | null>(null);
  const viewportAnimationFrameRef = useRef<number | null>(null);
  const viewportRef = useRef({ x: 0, y: 0, scale: 1 });
  const itemsRef = useRef<CanvasItem[]>([]);
  const selectedIdRef = useRef<string | null>(null);
  const reducedMotionRef = useRef(false);
  const dragItemStartPositionsRef = useRef<Record<string, { x: number; y: number }>>({});
  const wheelZoomTargetRef = useRef<{ scale: number; anchor: { x: number; y: number } | undefined } | null>(null);
  const viewportAnimationTargetRef = useRef<{
    from: { x: number; y: number; scale: number };
    to: { x: number; y: number; scale: number };
    startedAt: number;
    duration: number;
  } | null>(null);
  const marqueeStartRef = useRef<{ x: number; y: number } | null>(null);
  const draggingItemIdsRef = useRef<string[]>([]);
  const magneticPortResetTimerRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const cornerResizeStart = useRef<{
    mouseX: number;
    mouseY: number;
    width: number;
    height: number;
    itemId: string;
  } | null>(null);
  const marqueeToggleModeRef = useRef(false);
  const connectionDragMovedRef = useRef(false);
  const connectionSessionRef = useRef<ConnectionSession | null>(null);
  const detachConnectionWindowListenersRef = useRef<(() => void) | null>(null);
  
  const [chatInput, setChatInput] = useState('');
  const [chatInputRows, setChatInputRows] = useState(1);
  const [chatMessages, setChatMessagesState] = useState<ChatMessage[]>([]);
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
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [activeSkill, setActiveSkillState] = useState<{ id: string; label: string } | null>(null);
  const [generationMode, setGenerationMode] = useState<GenerationMode>('auto');
  const [showGenerationModeMenu, setShowGenerationModeMenu] = useState(false);
  const [showSkillsMenu, setShowSkillsMenu] = useState(false);
  const [showAspectRatioMenu, setShowAspectRatioMenu] = useState(false);
  const [imageAspectRatio, setImageAspectRatio] = useState('auto');
  const [hideWelcomeByCenterSkillPick, setHideWelcomeByCenterSkillPick] = useState(false);
  const [referenceImages, setReferenceImages] = useState<string[]>([]);
  const [chatReferenceImages, setChatReferenceImages] = useState<string[]>([]);
  const [draggingImageIndex, setDraggingImageIndex] = useState<number | null>(null);
  const [dragOverImageIndex, setDragOverImageIndex] = useState<number | null>(null);
  const [draggingPanelReference, setDraggingPanelReference] = useState<{
    targetItemId: string;
    sourceItemId: string;
  } | null>(null);
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
  const [providerSettingsSaving, setProviderSettingsSaving] = useState(false);
  const [providerSettingsTesting, setProviderSettingsTesting] = useState(false);
  const [providerSettingsFetchingModels, setProviderSettingsFetchingModels] = useState(false);
  const [providerSettingsError, setProviderSettingsError] = useState<string | null>(null);
  const [providerSettingsProviders, setProviderSettingsProviders] = useState<ProviderSettingsItem[]>([]);
  const [providerSettingsSelectedProviderId, setProviderSettingsSelectedProviderId] = useState<ProviderSettingsProviderId>('comfly');
  const [providerSettingsApiKey, setProviderSettingsApiKey] = useState('');
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
  const skillsMenuRef = useRef<HTMLDivElement>(null);
  const aspectRatioMenuRef = useRef<HTMLDivElement>(null);
  const textPanelModelMenuRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const chatFileInputRef = useRef<HTMLInputElement>(null);
  const chatInputEditorRef = useRef<HTMLDivElement>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const generateAbortRef = useRef<AbortController | null>(null);
  const canvasTextGenerateAbortControllersRef = useRef<Map<string, AbortController>>(new Map());
  const suppressCanvasTextAbortErrorItemIdsRef = useRef<Set<string>>(new Set());
  const canvasImageGenerateAbortControllersRef = useRef<Map<string, AbortController>>(new Map());
  const suppressCanvasImageAbortErrorItemIdsRef = useRef<Set<string>>(new Set());
  const processedSkillJobUrlsRef = useRef<Set<string>>(new Set());
  const processedSkillChoiceIdsRef = useRef<Set<string>>(new Set());
  const streamQueueRef = useRef('');
  const streamTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const streamMessageIdRef = useRef<string | null>(null);
  const pendingAssistantMessageIdRef = useRef<string | null>(null);
  const currentSessionIdRef = useRef<string | null>(null);
  const canvasHistoryBySessionRef = useRef<Record<string, SessionCanvasHistoryState>>({});
  const pendingCanvasHistorySnapshotRef = useRef<CanvasUndoSnapshot | null>(null);
  const suppressNextItemClickRef = useRef<string | null>(null);
  const suppressNextItemClickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestChatInputRef = useRef('');
  const isHydratingSessionRef = useRef(false);
  const imageToolbarNoticeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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
  const [chatInputFocused, setChatInputFocused] = useState(false);
  const [chatInputHeight, setChatInputHeight] = useState(24);
  const [copiedAssistantMessageId, setCopiedAssistantMessageId] = useState<string | null>(null);
  const [editingTextCardId, setEditingTextCardId] = useState<string | null>(null);
  const [textCardPanelDrafts, setTextCardPanelDraftsState] = useState<Record<string, string>>({});
  const [imageCardPanelDrafts, setImageCardPanelDraftsState] = useState<Record<string, string>>({});
  const [imageCardProviderById, setImageCardProviderByIdState] = useState<Record<string, string>>({});
  const [imageCardModelById, setImageCardModelByIdState] = useState<Record<string, string>>({});
  const [imageCardSizeById, setImageCardSizeByIdState] = useState<Record<string, string>>({});
  const [imageCardQualityById, setImageCardQualityByIdState] = useState<Record<string, string>>({});
  const [imageCardCountById, setImageCardCountByIdState] = useState<Record<string, number>>({});
  const [imageCardAspectRatioById, setImageCardAspectRatioByIdState] = useState<Record<string, string>>({});
  const [selectedTextPanelProviderId, setSelectedTextPanelProviderId] = useState<ProviderSettingsProviderId>('comfly');
  const [selectedTextPanelModelId, setSelectedTextPanelModelId] = useState(getDefaultTextPanelModelOption().id);
  const [showTextPanelModelMenu, setShowTextPanelModelMenu] = useState(false);
  const [showImageCardModelMenu, setShowImageCardModelMenu] = useState(false);
  const [showImageCardAspectRatioMenu, setShowImageCardAspectRatioMenu] = useState(false);
  const [showImageCardResolutionMenu, setShowImageCardResolutionMenu] = useState(false);
  const [showImageCardQualityMenu, setShowImageCardQualityMenu] = useState(false);
  const [showImageCardCountMenu, setShowImageCardCountMenu] = useState(false);
  const editingTextCardTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const imageCardModelMenuRef = useRef<HTMLDivElement | null>(null);
  const imageCardModelPopoverRef = useRef<HTMLDivElement | null>(null);
  const imageCardAspectRatioMenuRef = useRef<HTMLDivElement | null>(null);
  const imageCardAspectRatioPopoverRef = useRef<HTMLDivElement | null>(null);
  const imageCardResolutionMenuRef = useRef<HTMLDivElement | null>(null);
  const imageCardResolutionPopoverRef = useRef<HTMLDivElement | null>(null);
  const imageCardQualityMenuRef = useRef<HTMLDivElement | null>(null);
  const imageCardQualityPopoverRef = useRef<HTMLDivElement | null>(null);
  const imageCardCountMenuRef = useRef<HTMLDivElement | null>(null);
  const imageCardCountPopoverRef = useRef<HTMLDivElement | null>(null);
  const providerSettingsLoadRequestIdRef = useRef(0);
  const sessionLiveStateRef = useRef<SessionLiveState>({
    items,
    connections,
    textCardPanelDrafts,
    imageCardPanelDrafts,
    imageCardProviderById,
    imageCardModelById,
    imageCardSizeById,
    imageCardQualityById,
    imageCardCountById,
    imageCardAspectRatioById,
    chatMessages,
    activeSkill,
    generatedImageHistoryBySession,
    viewport,
  });
  const syncSessionLiveState = useCallback((patch: Partial<SessionLiveState>) => {
    if (Object.prototype.hasOwnProperty.call(patch, 'items')) {
      itemsRef.current = patch.items ?? [];
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'viewport')) {
      viewportRef.current = patch.viewport ?? { x: 0, y: 0, scale: 1 };
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
  const setItems = useCallback(
    (value: React.SetStateAction<CanvasItem[]>) =>
      applySessionLiveStateUpdate('items', value, setItemsState),
    [applySessionLiveStateUpdate]
  );
  const setConnections = useCallback(
    (value: React.SetStateAction<Connection[]>) =>
      applySessionLiveStateUpdate('connections', value, setConnectionsState),
    [applySessionLiveStateUpdate]
  );
  const setTextCardPanelDrafts = useCallback(
    (value: React.SetStateAction<Record<string, string>>) =>
      applySessionLiveStateUpdate('textCardPanelDrafts', value, setTextCardPanelDraftsState),
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
    (value: React.SetStateAction<{ x: number; y: number; scale: number }>) =>
      applySessionLiveStateUpdate('viewport', value, setViewportState),
    [applySessionLiveStateUpdate]
  );
  const multiSelectionBounds = React.useMemo(() => {
    if (selectedIds.length <= 1) return null;
    const selectedItems = items.filter((item) => selectedIds.includes(item.id));
    return selectedItems.length <= 1 ? null : getCanvasItemsVisualBounds(selectedItems);
  }, [items, selectedIds]);
  const itemById = React.useMemo(
    () => Object.fromEntries(items.map((item) => [item.id, item] as const)),
    [items]
  );
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
  const workspaceImageModelOptions = React.useMemo(
    () => createWorkspaceModelOptions(enabledProviderSettingsProviders, 'image', IMAGE_CARD_MODEL_OPTIONS),
    [enabledProviderSettingsProviders]
  );
  const workspaceTextModelOptions = React.useMemo(
    () => createWorkspaceModelOptions(enabledProviderSettingsProviders, 'chat', TEXT_PANEL_MODEL_OPTIONS),
    [enabledProviderSettingsProviders]
  );
  const defaultWorkspaceImageModelOption = workspaceImageModelOptions[0] || createFallbackWorkspaceModelOptions(IMAGE_CARD_MODEL_OPTIONS, null)[0];
  const defaultWorkspaceTextModelOption = workspaceTextModelOptions[0] || createFallbackWorkspaceModelOptions(TEXT_PANEL_MODEL_OPTIONS, null)[0];
  const selectedImageCardProviderId = selectedImageCardPanelItem
    ? imageCardProviderById[selectedImageCardPanelItem.id] || defaultWorkspaceImageModelOption.providerId
    : defaultWorkspaceImageModelOption.providerId;
  const selectedImageCardPanelModelId = selectedImageCardPanelItem
    ? resolveWorkspaceImageCardModel(
        imageCardModelById[selectedImageCardPanelItem.id],
        workspaceImageModelOptions.map((option) => option.id),
        defaultWorkspaceImageModelOption.id
      )
    : defaultWorkspaceImageModelOption.id;
  const selectedImageCardSizeOptions = React.useMemo(
    () => getSupportedImageCardSizeOptions(selectedImageCardPanelModelId),
    [selectedImageCardPanelModelId]
  );
  const selectedImageCardPanelAspectRatio = selectedImageCardPanelItem
    ? normalizeImageCardAspectRatio(imageCardAspectRatioById[selectedImageCardPanelItem.id], '1:1')
    : '1:1';
  const selectedImageCardPanelSize = selectedImageCardPanelItem
    ? resolveImageCardSize(
        selectedImageCardPanelModelId,
        imageCardSizeById[selectedImageCardPanelItem.id] ?? IMAGE_CARD_SIZE_OPTIONS[0].id
      )
    : IMAGE_CARD_SIZE_OPTIONS[0].id;
  const selectedImageCardPanelQuality = selectedImageCardPanelItem
    ? imageCardQualityById[selectedImageCardPanelItem.id] ?? IMAGE_CARD_QUALITY_OPTIONS[0].id
    : IMAGE_CARD_QUALITY_OPTIONS[0].id;
  const selectedImageCardPanelCount = selectedImageCardPanelItem
    ? imageCardCountById[selectedImageCardPanelItem.id] ?? IMAGE_CARD_COUNT_OPTIONS[0].id
    : IMAGE_CARD_COUNT_OPTIONS[0].id;
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
  useEffect(() => {
    if (
      Object.keys(activeCanvasTextGenerations).length === 0 &&
      Object.keys(activeCanvasImageGenerations).length === 0
    ) {
      return;
    }

    setGenerationClockMs(Date.now());
    const timer = window.setInterval(() => {
      setGenerationClockMs(Date.now());
    }, 1000);

    return () => {
      window.clearInterval(timer);
    };
  }, [activeCanvasTextGenerations, activeCanvasImageGenerations]);
  const isSelectedTextCardGenerating =
    !!selectedTextCardPanelItem && !!activeCanvasTextGenerations[selectedTextCardPanelItem.id];
  const isSelectedImageCardGenerating =
    !!selectedImageCardPanelItem && !!activeCanvasImageGenerations[selectedImageCardPanelItem.id];
  const selectedImageCardModel =
    findWorkspaceModelOption(workspaceImageModelOptions, selectedImageCardPanelModelId, selectedImageCardProviderId) ||
    defaultWorkspaceImageModelOption;
  const selectedTextPanelModel =
    findWorkspaceModelOption(workspaceTextModelOptions, selectedTextPanelModelId, selectedTextPanelProviderId) ||
    defaultWorkspaceTextModelOption;
  const SKILL_TOKEN_SELECTOR = '[data-skill-token="true"]';
  const copiedAssistantMessageTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  latestChatInputRef.current = chatInput;

  const createCurrentCanvasUndoSnapshot = useCallback(() => {
    const liveState = sessionLiveStateRef.current;
    return createCanvasUndoSnapshot({
      items: liveState.items,
      connections: liveState.connections,
      textCardPanelDrafts: liveState.textCardPanelDrafts,
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
    setConnectionPoint(null);
    setConnectionPointerId(null);
    setFrozenPreviewConnection(null);
    setPendingConnectionMenu(null);
    setMagneticPorts({});
    setConnectionSnapTargetId(null);
    setEditingTextCardId(null);
    setShowTextPanelModelMenu(false);
    setShowImageCardModelMenu(false);
    setShowImageCardQualityMenu(false);
    setShowImageCardCountMenu(false);
    setCanvasTextGenerationErrorById({});
    setCanvasImageGenerationErrorById({});
    pendingCanvasHistorySnapshotRef.current = null;
    connectionSessionRef.current = null;
  }, []);

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
    viewportRef.current = viewport;
  }, [viewport]);

  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  useEffect(() => {
    if (!editingTextCardId) return;
    if (!items.some((item) => item.id === editingTextCardId && item.type === 'text' && item.textVariant === 'card')) {
      setEditingTextCardId(null);
    }
  }, [editingTextCardId, items]);

  useEffect(() => {
    const imageCardIds = new Set(items.filter((item) => isImageCardItem(item)).map((item) => item.id));

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
  }, [items]);

  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);

  useEffect(() => {
    return () => {
      if (imageToolbarNoticeTimeoutRef.current) {
        clearTimeout(imageToolbarNoticeTimeoutRef.current);
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
    if (topic.activeSkill) return topic.activeSkill;

    const messageWithSkill = [...topic.messages].reverse().find((message) => message.skill);
    return messageWithSkill?.skill || null;
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
    const next = Math.min(editor.scrollHeight || 24, 240);
    editor.style.height = `${next}px`;
    setChatInputHeight(next);
  }, []);

  const extractEditorPlainText = useCallback((root: HTMLElement): string => {
    const cloned = root.cloneNode(true) as HTMLElement;
    cloned.querySelectorAll(SKILL_TOKEN_SELECTOR).forEach((node) => node.remove());
    return (cloned.innerText || "").replace(/\u00A0/g, " ");
  }, [SKILL_TOKEN_SELECTOR]);

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

    const currentPlain = extractEditorPlainText(editor);
    const currentTokenLabel = editor.querySelector(SKILL_TOKEN_SELECTOR)?.getAttribute("data-skill-label") || "";
    const targetTokenLabel = activeSkill?.label || "";

    const shouldRebuild = currentPlain !== value || currentTokenLabel !== targetTokenLabel;
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

      editor.appendChild(document.createTextNode(value));
      if (moveCaretToEnd) {
        moveCaretToEditorEnd();
      }
    }

    syncEditorHeight();
  }, [activeSkill, extractEditorPlainText, moveCaretToEditorEnd, syncEditorHeight]);

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
    wrapper.querySelectorAll(SKILL_TOKEN_SELECTOR).forEach((node) => node.remove());
    return (wrapper.textContent || "").replace(/\u00A0/g, "").length === 0;
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

  const stopStreamTypewriter = () => {
    if (streamTimerRef.current) {
      clearInterval(streamTimerRef.current);
      streamTimerRef.current = null;
    }
    streamQueueRef.current = '';
    streamMessageIdRef.current = null;
  };

  const ensureStreamTypewriterRunning = () => {
    if (streamTimerRef.current) return;

    streamTimerRef.current = setInterval(() => {
      const messageId = streamMessageIdRef.current;
      if (!messageId) return;
      if (!streamQueueRef.current) return;

      const nextChunk = streamQueueRef.current.slice(0, 2);
      streamQueueRef.current = streamQueueRef.current.slice(2);

      setChatMessages((prev) => prev.map((msg) => {
        if (msg.id !== messageId) return msg;
        return {
          ...msg,
          content: `${msg.content}${nextChunk}`,
        };
      }));
    }, 30);
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
    setChatMessages((prev) => prev.map((msg) => {
      if (msg.id !== targetMessageId) return msg;
      return {
        ...msg,
        content: `${msg.content}${remaining}`,
      };
    }));
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

    setChatMessages((prev) => prev.map((msg) => {
      if (msg.id !== messageId) return msg;
      return {
        ...msg,
        taskStatus: status,
        content: msg.content || fallbackContent || msg.content,
      };
    }));
  };

  const updatePendingAssistantMessage = (
    updater: (msg: ChatMessage) => ChatMessage
  ) => {
    const messageId = pendingAssistantMessageIdRef.current;
    if (!messageId) return;
    setChatMessages((prev) => prev.map((msg) => {
      if (msg.id !== messageId) return msg;
      return updater(msg);
    }));
  };

  const readAsDataURL = (file: File) => {
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (event) => resolve(event.target?.result as string);
      reader.onerror = () => reject(new Error(`读取文件失败: ${file.name}`));
      reader.readAsDataURL(file);
    });
  };

  const getViewportCenterCanvasPoint = useCallback(
    (overrideViewport?: { x: number; y: number; scale: number }) => {
      const activeViewport = overrideViewport ?? viewport;
      const canvasRect = canvasRef.current?.getBoundingClientRect();
      const canvasWidth = canvasRect?.width ?? 0;
      const canvasHeight = canvasRect?.height ?? 0;

      return {
        x: (canvasWidth / 2 - activeViewport.x) / activeViewport.scale,
        y: (canvasHeight / 2 - activeViewport.y) / activeViewport.scale,
      };
    },
    [viewport]
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
    [getSpawnPosition, recordCurrentCanvasUndoSnapshot]
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
    [getSpawnPosition, recordCurrentCanvasUndoSnapshot]
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
    [getSpawnPosition, recordCurrentCanvasUndoSnapshot]
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
    [recordCurrentCanvasUndoSnapshot]
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
      animateViewportTo(centerViewportOnPastedCanvasItems(viewportRef.current, pastedCanvasClipboard.items));

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
      uploadImageFilesToCanvas,
      centerViewportOnPastedCanvasItems,
      animateViewportTo,
    ]
  );

  const handleChatImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;

    const currentCount = chatReferenceImages.length;
    const remainingSlots = 14 - currentCount;
    
    if (remainingSlots <= 0) {
      alert('最多只能上传14张参考图');
      return;
    }

    const filesToProcess = Array.from(files).slice(0, remainingSlots);

    try {
      const uploadedImages = await Promise.all(filesToProcess.map((file) => readAsDataURL(file)));
      setChatReferenceImages(prev => [...prev, ...uploadedImages]);
    } catch (error) {
      console.error('Chat reference upload failed:', error);
    }
    
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
      const editorText = chatInputEditorRef.current ? extractEditorPlainText(chatInputEditorRef.current) : '';
      setChatInput(editorText);
      syncEditorHeight();
      return;
    }

    e.preventDefault();

    const currentCount = chatReferenceImages.length;
    const remainingSlots = 14 - currentCount;

    if (remainingSlots <= 0) {
      alert('最多只能上传14张参考图');
      return;
    }

    const filesToProcess = imageFiles.slice(0, remainingSlots);

    const readAsDataURL = (file: File) => {
      return new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (event) => resolve(event.target?.result as string);
        reader.onerror = () => reject(new Error(`读取文件失败: ${file.name}`));
        reader.readAsDataURL(file);
      });
    };

    try {
      const uploadedImages = await Promise.all(filesToProcess.map((file) => readAsDataURL(file)));
      setChatReferenceImages(prev => [...prev, ...uploadedImages]);
    } catch (error) {
      console.error('Chat paste image upload failed:', error);
    }
  };

  const handleChatEditorInput = () => {
    const editorText = chatInputEditorRef.current ? extractEditorPlainText(chatInputEditorRef.current) : '';
    setChatInput(editorText);
    syncEditorHeight();
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
    [capturePendingCanvasUndoSnapshot, selectedTextCardPanelItem]
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
    [capturePendingCanvasUndoSnapshot, selectedImageCardPanelItem]
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
  }, []);

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
  }, [recordCurrentCanvasUndoSnapshot]);

  const finalizeManualTextCardEditing = useCallback((itemId: string) => {
    commitPendingCanvasUndoSnapshot();
    setItems((prev) =>
      prev.map((item) => (item.id === itemId ? finalizeManualTextCardItem(item) : item))
    );
    setEditingTextCardId((prev) => (prev === itemId ? null : prev));
  }, [commitPendingCanvasUndoSnapshot]);

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
  }, [activeCanvasTextGenerationItemIds, connections, createCurrentCanvasUndoSnapshot]);

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
  }, [items]);

  const handleChatEditorKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if ((e.key === 'Backspace' || e.key === 'Delete') && activeSkill && isCaretAtEditorStart()) {
      e.preventDefault();
      setActiveSkillForCurrentTopic(null);
      return;
    }

    if (e.key === 'Enter' && !e.shiftKey && !e.altKey) {
      e.preventDefault();
      if (isGenerating) {
        void handleCancelGenerate();
      } else {
        void handleGenerate();
      }
    }
  };

  const removeChatImage = (index: number) => {
    setChatReferenceImages(prev => prev.filter((_, i) => i !== index));
  };

  const reorderChatImages = (fromIndex: number, toIndex: number) => {
    if (fromIndex === toIndex) return;
    setChatReferenceImages((prev) => {
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
  };

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
  }, [getSpawnPosition, recordCurrentCanvasUndoSnapshot]);

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
  }, []);

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
  }, []);

  const getPortCanvasPoint = (item: CanvasItem, side: 'left' | 'right') => ({
    x:
      side === 'left'
        ? item.x - PORT_ICON_RADIUS - PORT_OUTER_GAP
        : item.x + item.width + PORT_ICON_RADIUS + PORT_OUTER_GAP,
    y: item.y + item.height / 2,
  });

  const getConnectionAnchorCanvasPoint = (item: CanvasItem, side: 'left' | 'right') => ({
    x:
      side === 'left'
        ? item.x - CONNECTION_ANCHOR_EDGE_GAP
        : item.x + item.width + CONNECTION_ANCHOR_EDGE_GAP,
    y: item.y + item.height / 2,
  });

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
  const selectedImageToolbarAnchor = resolveImageToolbarViewportAnchor({
    itemBounds: selectedImageToolbarBounds,
    toCanvasScreenPoint,
    canvasRect: canvasRef.current?.getBoundingClientRect(),
  });
  const selectedImageToolbarTop = selectedImageToolbarAnchor
    ? selectedImageToolbarAnchor.y
    : null;

  const buildConnectionPath = (from: { x: number; y: number }, to: { x: number; y: number }) => {
    const dx = Math.max(64, Math.abs(to.x - from.x) * 0.42);
    const c1x = from.x + dx;
    const c2x = to.x - dx;
    return `M ${from.x} ${from.y} C ${c1x} ${from.y}, ${c2x} ${to.y}, ${to.x} ${to.y}`;
  };

  const getPreviewRenderPoints = () => {
    const session = connectionSessionRef.current;
    if (!session || session.mode !== 'dragging' || !session.point) {
      return { from: null, to: null };
    }

    const fromItem = items.find((item) => item.id === session.fromItemId);
    if (!fromItem) {
      return { from: null, to: null };
    }

    return {
      from: toCanvasScreenPoint(getConnectionAnchorCanvasPoint(fromItem, 'right')),
      to: session.point,
    };
  };

  const clearPendingConnectionMenu = useCallback(() => {
    setPendingConnectionMenu(null);
    setFrozenPreviewConnection(null);
  }, []);

  const toCanvasPoint = useCallback((screenPoint: { x: number; y: number }) => ({
    x: (screenPoint.x - viewport.x) / viewport.scale,
    y: (screenPoint.y - viewport.y) / viewport.scale,
  }), [viewport.x, viewport.y, viewport.scale]);

  const getMagneticPortKey = useCallback((itemId: string, side: PortSide) => `${itemId}:${side}`, []);

  const clearMagneticPortResetTimer = useCallback((key?: string) => {
    if (key) {
      const timer = magneticPortResetTimerRef.current[key];
      if (timer) {
        clearTimeout(timer);
        delete magneticPortResetTimerRef.current[key];
      }
      return;
    }

    Object.values(magneticPortResetTimerRef.current).forEach((timer) => clearTimeout(timer));
    magneticPortResetTimerRef.current = {};
  }, []);

  const getRenderedPortOverlayPoint = useCallback(
    (item: CanvasItem, side: PortSide) => {
      const key = getMagneticPortKey(item.id, side);
      const originalPoint = getPortCanvasPoint(item, side);
      if (magneticPorts[key]) {
        return magneticPorts[key].point;
      }
      return originalPoint;
    },
    [magneticPorts, getMagneticPortKey]
  );

  const releaseMagneticPort = useCallback(
    (port: MagneticPortState) => {
      const key = getMagneticPortKey(port.itemId, port.side);
      const item = items.find((entry) => entry.id === port.itemId);
      if (!item) {
        clearMagneticPortResetTimer(key);
        setMagneticPorts((prev) => {
          if (!prev[key]) return prev;
          const next = { ...prev };
          delete next[key];
          return next;
        });
        return;
      }

      const origin = getPortCanvasPoint(item, port.side);
      clearMagneticPortResetTimer(key);
      setMagneticPorts((prev) => ({
        ...prev,
        [key]: {
          itemId: port.itemId,
          side: port.side,
          point: origin,
          isTracking: false,
          isReturning: true,
        },
      }));
      magneticPortResetTimerRef.current[key] = setTimeout(() => {
        setMagneticPorts((prev) => {
          const current = prev[key];
          if (!current?.isReturning) return prev;
          const next = { ...prev };
          delete next[key];
          return next;
        });
        delete magneticPortResetTimerRef.current[key];
      }, PORT_RETURN_DURATION_MS);
    },
    [items, clearMagneticPortResetTimer, getMagneticPortKey]
  );

  const updateMagneticPort = useCallback(
    (point: { x: number; y: number }) => {
      if (connectionMode === 'dragging' || pendingConnectionMenu) {
        Object.values(magneticPorts).forEach((port) => {
          if (port.isTracking) releaseMagneticPort(port);
        });
        return;
      }

      let nearest:
        | {
            key: string;
            itemId: string;
            side: PortSide;
            distance: number;
          }
        | null = null;

      for (const item of items) {
        for (const side of ['left', 'right'] as const) {
          const origin = getPortCanvasPoint(item, side);
          const key = getMagneticPortKey(item.id, side);
          const existingPort = magneticPorts[key];
          const threshold = existingPort?.isTracking ? PORT_TRACKING_RADIUS : PORT_ACTIVATION_RADIUS;
          const distance = Math.hypot(point.x - origin.x, point.y - origin.y);
          if (distance > threshold) continue;
          if (!nearest || distance < nearest.distance) {
            nearest = {
              key,
              itemId: item.id,
              side,
              distance,
            };
          }
        }
      }

      const nearestKey = nearest?.key ?? null;

      Object.entries(magneticPorts).forEach(([key, port]) => {
        if (!port.isTracking) return;
        if (key === nearestKey) return;
        releaseMagneticPort(port);
      });

      if (!nearest) return;

      clearMagneticPortResetTimer(nearest.key);
      setMagneticPorts((prev) => ({
        ...prev,
        [nearest.key]: {
          itemId: nearest.itemId,
          side: nearest.side,
          point,
          isTracking: true,
          isReturning: false,
        },
      }));
    },
    [
      connectionMode,
      pendingConnectionMenu,
      magneticPorts,
      items,
      releaseMagneticPort,
      clearMagneticPortResetTimer,
      getMagneticPortKey,
    ]
  );

  const beginConnectionDragFromItem = (
    item: CanvasItem,
    pointerId: number,
    source: 'bridge' | 'button'
  ) => {
    clearPendingConnectionMenu();
    clearMagneticPortResetTimer();
    setMagneticPorts({});
    setSelectedConnectionIds([]);
    const wasHoveredOutput = hoveredOutputPortItemId === item.id;
    const isHoveredCanvasItem = hoveredCanvasItemId === item.id;
    const isConnectionSource = connectionSessionRef.current?.fromItemId === item.id;
    const isNearPort = hoveredInputPortItemId === item.id || wasHoveredOutput;
    const showOutputPort = isHoveredCanvasItem || isNearPort || isConnectionSource;

    debugCanvasConnection('begin-connection-drag', {
      source,
      itemId: item.id,
      pointerId,
      hoveredOutputPortItemId,
      hoveredInputPortItemId,
      hoveredCanvasItemId,
      connectionMode,
      showOutputPort,
    });

    setHoveredOutputPortItemId((prev) => (prev === item.id ? null : prev));
    connectionDragMovedRef.current = false;

    let capturedPointerId: number | null = null;
    if (canvasRef.current) {
      try {
        canvasRef.current.setPointerCapture(pointerId);
        capturedPointerId = pointerId;
      } catch {}
    }

    const portPoint = toCanvasScreenPoint(getRenderedPortOverlayPoint(item, 'right'));
    const initialPoint = { x: portPoint.x + 12, y: portPoint.y };
    connectionSessionRef.current = {
      mode: 'dragging',
      fromItemId: item.id,
      pointerId: capturedPointerId ?? null,
      startPoint: portPoint,
      point: initialPoint,
      snapTargetId: null,
      moved: false,
    };
    syncConnectionState(connectionSessionRef.current);
    setIsDragging(false);
    setIsMarqueeSelecting(false);
    setMarqueeRect(null);
    marqueeStartRef.current = null;
    setSelectedConnectionIds([]);
    connectionDragMovedRef.current = false;
    debugCanvasConnection('start-dragging-connection', {
      itemId: item.id,
      pointerId: capturedPointerId ?? null,
      startPoint: portPoint,
      initialPoint,
      connectionModeBeforeSync: connectionMode,
      hoveredOutputPortItemId,
    });
    attachConnectionWindowListeners();
    debugCanvasConnection('port-pointerdown', {
      fromItemId: item.id,
      x: portPoint.x,
      y: portPoint.y,
      pointerId: capturedPointerId ?? null,
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
    const dx = Math.max(40, Math.abs(to.x - from.x) * 0.35);
    return {
      c1: { x: from.x + dx, y: from.y },
      c2: { x: to.x - dx, y: to.y },
    };
  };

  const getConnectionHitIdsForMarquee = (rect: { x: number; y: number; width: number; height: number }) => {
    const rectLeft = rect.x;
    const rectRight = rect.x + rect.width;
    const rectTop = rect.y;
    const rectBottom = rect.y + rect.height;
    const HIT_PADDING = 8;
    const SAMPLE_COUNT = 24;

    return connections
      .filter((connection) => {
        const fromItem = items.find((item) => item.id === connection.fromItemId);
        const toItem = items.find((item) => item.id === connection.toItemId);
        if (!fromItem || !toItem) return false;

        const from = toCanvasScreenPoint(getConnectionAnchorCanvasPoint(fromItem, 'right'));
        const to = toCanvasScreenPoint(getConnectionAnchorCanvasPoint(toItem, 'left'));
        const { c1, c2 } = getConnectionControlPoints(from, to);

        const minX = Math.min(from.x, c1.x, c2.x, to.x) - HIT_PADDING;
        const maxX = Math.max(from.x, c1.x, c2.x, to.x) + HIT_PADDING;
        const minY = Math.min(from.y, c1.y, c2.y, to.y) - HIT_PADDING;
        const maxY = Math.max(from.y, c1.y, c2.y, to.y) + HIT_PADDING;

        const intersectsBoundingBox = !(
          maxX < rectLeft ||
          minX > rectRight ||
          maxY < rectTop ||
          minY > rectBottom
        );

        if (!intersectsBoundingBox) return false;

        for (let step = 0; step <= SAMPLE_COUNT; step += 1) {
          const point = cubicBezierPoint(from, c1, c2, to, step / SAMPLE_COUNT);
          if (
            point.x >= rectLeft &&
            point.x <= rectRight &&
            point.y >= rectTop &&
            point.y <= rectBottom
          ) {
            return true;
          }
        }

        return false;
      })
      .map((connection) => connection.id);
  };

  const findNearestInputPort = (x: number, y: number, fromItemId: string): { targetId: string; x: number; y: number } | null => {
    const SNAP_DISTANCE = 28;
    let nearest: { targetId: string; x: number; y: number; distance: number } | null = null;

    for (const item of items) {
      if (item.id === fromItemId) continue;
      if (!canItemAcceptIncomingConnection(item)) continue;
      const port = toCanvasScreenPoint(getConnectionAnchorCanvasPoint(item, 'left'));
      const distance = Math.hypot(port.x - x, port.y - y);
      if (distance > SNAP_DISTANCE) continue;
      if (!nearest || distance < nearest.distance) {
        nearest = { targetId: item.id, x: port.x, y: port.y, distance };
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
  }, [recordCurrentCanvasUndoSnapshot, selectedId]);

  const deleteConnection = (connectionId: string) => {
    recordCurrentCanvasUndoSnapshot();
    setConnections((prev) => prev.filter((connection) => connection.id !== connectionId));
    setSelectedConnectionIds((prev) => prev.filter((id) => id !== connectionId));
  };

  const syncConnectionState = useCallback((session: ConnectionSession | null) => {
    if (!session) {
      setConnectionMode('idle');
      setConnectionFromItemId(null);
      setConnectionPoint(null);
      setConnectionPointerId(null);
      setConnectionSnapTargetId(null);
      return;
    }

    setConnectionMode(session.mode);
    setConnectionFromItemId(session.fromItemId);
    setConnectionPoint(session.point);
    setConnectionPointerId(session.pointerId);
    setConnectionSnapTargetId(session.snapTargetId);
  }, []);

  const getCanvasRelativePoint = (clientX: number, clientY: number) => {
    const canvasRect = canvasRef.current?.getBoundingClientRect();
    if (!canvasRect) return null;
    return {
      x: clientX - canvasRect.left,
      y: clientY - canvasRect.top,
    };
  };

  const detachConnectionWindowListeners = useCallback(() => {
    if (detachConnectionWindowListenersRef.current) {
      detachConnectionWindowListenersRef.current();
      detachConnectionWindowListenersRef.current = null;
    }
  }, []);

  const debugCanvasConnection = useCallback((event: string, payload?: Record<string, unknown>) => {
    if (!DEBUG_CANVAS_CONNECTIONS) return;
    console.debug('[canvas-conn]', event, payload || {});
  }, []);

  const attachConnectionWindowListeners = () => {
    detachConnectionWindowListeners();
    debugCanvasConnection('attach-window-listeners');

    const handleWindowPointerMove = (e: PointerEvent) => {
      const session = connectionSessionRef.current;
      if (!session) return;
      if (session.pointerId !== null && e.pointerId !== session.pointerId) return;

      const point = getCanvasRelativePoint(e.clientX, e.clientY);
      if (!point) return;

      debugCanvasConnection('window-pointermove', {
        fromItemId: session.fromItemId,
        x: point.x,
        y: point.y,
      });
      updateConnectionPreview(point.x, point.y);
    };

    const handleWindowPointerEnd = (e: PointerEvent) => {
      const session = connectionSessionRef.current;
      if (!session) return;
      if (session.pointerId !== null && e.pointerId !== session.pointerId) return;
      debugCanvasConnection('window-pointerend', {
        fromItemId: session.fromItemId,
        snapTargetId: session.snapTargetId,
        pointerId: e.pointerId,
      });
      finalizeConnectionInteraction();
    };

    window.addEventListener('pointermove', handleWindowPointerMove);
    window.addEventListener('pointerup', handleWindowPointerEnd);
    window.addEventListener('pointercancel', handleWindowPointerEnd);

    detachConnectionWindowListenersRef.current = () => {
      window.removeEventListener('pointermove', handleWindowPointerMove);
      window.removeEventListener('pointerup', handleWindowPointerEnd);
      window.removeEventListener('pointercancel', handleWindowPointerEnd);
    };
  };

  const resetConnectionInteraction = useCallback(() => {
    const session = connectionSessionRef.current;
    debugCanvasConnection('reset-start', {
      fromItemId: session?.fromItemId ?? null,
      mode: session?.mode ?? null,
      pointerId: session?.pointerId ?? null,
      snapTargetId: session?.snapTargetId ?? null,
      moved: session?.moved ?? null,
      point: session?.point ?? null,
    });
    if (canvasRef.current && session?.pointerId !== null && canvasRef.current.hasPointerCapture(session.pointerId)) {
      canvasRef.current.releasePointerCapture(session.pointerId);
    }
    detachConnectionWindowListeners();
    connectionSessionRef.current = null;
    syncConnectionState(null);
    connectionDragMovedRef.current = false;
    debugCanvasConnection('reset');
  }, [debugCanvasConnection, detachConnectionWindowListeners, syncConnectionState]);

  const updateConnectionPreview = (rawX: number, rawY: number) => {
    const session = connectionSessionRef.current;
    if (!session) return;
    const startPoint = session.startPoint;
    const movedDistance = startPoint ? Math.hypot(rawX - startPoint.x, rawY - startPoint.y) : 0;
    const hasMoved = movedDistance >= 3;
    connectionDragMovedRef.current = hasMoved;
    const nearest = findNearestInputPort(rawX, rawY, session.fromItemId);
    session.point = nearest ? { x: nearest.x, y: nearest.y } : { x: rawX, y: rawY };
    session.snapTargetId = nearest?.targetId || null;
    session.moved = hasMoved;
    syncConnectionState(session);
    debugCanvasConnection('session-point-updated', {
      fromItemId: session.fromItemId,
      x: session.point.x,
      y: session.point.y,
      snapTargetId: session.snapTargetId,
      moved: hasMoved,
    });
  };

  const finalizeConnectionInteraction = () => {
    const session = connectionSessionRef.current;
    debugCanvasConnection('finalize-connection-interaction', {
      fromItemId: session?.fromItemId ?? null,
      snapTargetId: session?.snapTargetId ?? null,
      moved: session?.moved ?? null,
      point: session?.point ?? null,
    });
    if (session && session.mode === 'dragging' && session.fromItemId && session.snapTargetId && session.fromItemId !== session.snapTargetId) {
      clearPendingConnectionMenu();
      recordCurrentCanvasUndoSnapshot();
      setConnections((prev) => {
        const exists = prev.some(
          (connection) =>
            connection.fromItemId === session.fromItemId &&
            connection.toItemId === session.snapTargetId
        );
        if (exists) return prev;
        return [
          ...prev,
          {
            id: `conn-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            fromItemId: session.fromItemId,
            toItemId: session.snapTargetId,
          },
        ];
      });
    } else if (session && session.mode === 'dragging' && session.fromItemId && session.point) {
      const fromItem = items.find((item) => item.id === session.fromItemId);
      if (fromItem) {
        setFrozenPreviewConnection({
          from: toCanvasScreenPoint(getConnectionAnchorCanvasPoint(fromItem, 'right')),
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
    resetConnectionInteraction();
  };

  const cancelZoomAnimation = useCallback(() => {
    if (zoomAnimationFrameRef.current !== null) {
      cancelAnimationFrame(zoomAnimationFrameRef.current);
      zoomAnimationFrameRef.current = null;
    }
    wheelZoomTargetRef.current = null;
  }, []);

  const cancelViewportAnimation = useCallback(() => {
    if (viewportAnimationFrameRef.current !== null) {
      cancelAnimationFrame(viewportAnimationFrameRef.current);
      viewportAnimationFrameRef.current = null;
    }
    viewportAnimationTargetRef.current = null;
  }, []);

  const flushViewportAnimation = useCallback(
    (now: number) => {
      viewportAnimationFrameRef.current = null;
      const target = viewportAnimationTargetRef.current;
      if (!target) return;

      const elapsed = Math.max(0, now - target.startedAt);
      const progress = Math.min(1, elapsed / target.duration);
      const easedProgress = easeOutCubic(progress);
      const nextViewport = {
        ...target.from,
        x: target.from.x + (target.to.x - target.from.x) * easedProgress,
        y: target.from.y + (target.to.y - target.from.y) * easedProgress,
      };

      setViewport(nextViewport);
      if (progress >= 1) {
        viewportAnimationTargetRef.current = null;
        return;
      }

      viewportAnimationFrameRef.current = requestAnimationFrame(flushViewportAnimation);
    },
    [setViewport]
  );

  function animateViewportTo(nextViewport: { x: number; y: number; scale: number }) {
    const currentViewport = viewportRef.current;
    const fromViewport = {
      ...currentViewport,
    };

    const hasNoMovement =
      fromViewport.x === nextViewport.x &&
      fromViewport.y === nextViewport.y &&
      fromViewport.scale === nextViewport.scale;

    cancelViewportAnimation();

    if (reducedMotionRef.current || hasNoMovement) {
      setViewport(nextViewport);
      return;
    }

    viewportAnimationTargetRef.current = {
      from: fromViewport,
      to: nextViewport,
      startedAt: performance.now(),
      duration: CANVAS_VIEWPORT_PASTE_ANIMATION_MS,
    };
    viewportAnimationFrameRef.current = requestAnimationFrame(flushViewportAnimation);
  }

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
        (canvasRef.current
          ? { x: canvasRef.current.clientWidth / 2, y: canvasRef.current.clientHeight / 2 }
          : undefined);

      if (!resolvedAnchor) {
        return {
          ...currentViewport,
          scale: clampedScale,
        };
      }

      const canvasPoint = {
        x: (resolvedAnchor.x - currentViewport.x) / currentViewport.scale,
        y: (resolvedAnchor.y - currentViewport.y) / currentViewport.scale,
      };

      return {
        ...currentViewport,
        scale: clampedScale,
        x: resolvedAnchor.x - canvasPoint.x * clampedScale,
        y: resolvedAnchor.y - canvasPoint.y * clampedScale,
      };
    },
    []
  );

  const flushInteractionFrame = useCallback(() => {
    interactionFrameRef.current = null;
    const pointer = latestInteractionPointerRef.current;
    if (!pointer) return;

    if (isCornerResizing && selectedIdRef.current && cornerResizeStart.current) {
      const { mouseX, mouseY, width, height, itemId } = cornerResizeStart.current;
      if (itemId !== selectedIdRef.current) return;

      const resizingItem = itemsRef.current.find((item) => item.id === itemId);
      if (!resizingItem) {
        setIsCornerResizing(false);
        cornerResizeStart.current = null;
        return;
      }

      const deltaX = (pointer.x - mouseX) / viewportRef.current.scale;
      const deltaY = (pointer.y - mouseY) / viewportRef.current.scale;

      if (resizingItem.textVariant === 'card') {
        const minWidth = 260;
        const minHeight = 300;
        const newWidth = Math.max(minWidth, width + deltaX);
        const newHeight = Math.max(minHeight, height + deltaY);

        setItems((prev) =>
          prev.map((item) =>
            item.id === selectedIdRef.current ? { ...item, width: newWidth, height: newHeight } : item
          )
        );
        return;
      }

      const minSize = 40;
      const aspect = width / height;
      const proposedWidth = width + deltaX;
      const proposedHeight = height + deltaY;
      const scaleX = proposedWidth / width;
      const scaleY = proposedHeight / height;
      const scale = Math.abs(scaleX - 1) >= Math.abs(scaleY - 1) ? scaleX : scaleY;
      const nextScale = Number.isFinite(scale) ? scale : 1;
      const newWidth = Math.max(minSize, width * nextScale);
      const newHeight = Math.max(minSize, Math.max(height * nextScale, newWidth / aspect));

      setItems((prev) =>
        prev.map((item) =>
          item.id === selectedIdRef.current ? { ...item, width: newWidth, height: newHeight } : item
        )
      );
      return;
    }

    if (isPanning) {
      const dx = pointer.x - dragStart.current.x;
      const dy = pointer.y - dragStart.current.y;
      setViewport((prev) => ({
        ...prev,
        x: panStartOffset.current.x + dx,
        y: panStartOffset.current.y + dy,
      }));
      return;
    }

    if (isDragging && selectedIdRef.current) {
      const dx = (pointer.x - dragStart.current.x) / viewportRef.current.scale;
      const dy = (pointer.y - dragStart.current.y) / viewportRef.current.scale;

      setItems((prev) =>
        prev.map((item) =>
          draggingItemIdsRef.current.includes(item.id)
            ? {
                ...item,
                x: (dragItemStartPositionsRef.current[item.id]?.x ?? item.x) + dx,
                y: (dragItemStartPositionsRef.current[item.id]?.y ?? item.y) + dy,
              }
            : item
        )
      );
    }
  }, [isCornerResizing, isDragging, isPanning]);

  const scheduleInteractionFrame = useCallback(() => {
    if (interactionFrameRef.current !== null) return;
    interactionFrameRef.current = requestAnimationFrame(flushInteractionFrame);
  }, [flushInteractionFrame]);

  const flushWheelZoom = useCallback(() => {
    zoomAnimationFrameRef.current = null;
    const target = wheelZoomTargetRef.current;
    if (!target) return;
    wheelZoomTargetRef.current = null;

    setViewport((prev) => getScaledViewportAtAnchor(prev, target.scale, target.anchor));
  }, [getScaledViewportAtAnchor]);

  const scheduleWheelZoom = useCallback(() => {
    if (reducedMotionRef.current) {
      flushWheelZoom();
      return;
    }
    if (zoomAnimationFrameRef.current !== null) return;
    zoomAnimationFrameRef.current = requestAnimationFrame(flushWheelZoom);
  }, [flushWheelZoom]);

  const beginDraggingSelectedItems = React.useCallback(
    (clientX: number, clientY: number, itemIds: string[], primaryId: string | null) => {
      if (itemIds.length === 0 || !primaryId) return;
      pendingCanvasHistorySnapshotRef.current = createCurrentCanvasUndoSnapshot();
      cancelZoomAnimation();
      cancelViewportAnimation();
      clearPendingConnectionMenu();
      setSelectedConnectionIds([]);
      setIsDragging(true);
      draggingItemIdsRef.current = itemIds;
      setSelectedId(primaryId);
      setSelectedIds(itemIds);
      setItems((prev) => moveCanvasItemsToFront(prev, itemIds));
      dragStart.current = { x: clientX, y: clientY };
      dragItemStartPositionsRef.current = Object.fromEntries(
        itemsRef.current
          .filter((item) => itemIds.includes(item.id))
          .map((item) => [item.id, { x: item.x, y: item.y }])
      );
    },
    [cancelViewportAnimation, cancelZoomAnimation, clearPendingConnectionMenu, createCurrentCanvasUndoSnapshot]
  );

  const beginAltDragCopiedItems = React.useCallback(
    (clientX: number, clientY: number, sourceIds: string[], primaryId: string | null) => {
      if (sourceIds.length === 0 || !primaryId) return;

      const snapshot = createCanvasClipboardSnapshot({
        items: itemsRef.current,
        selectedIds: sourceIds,
        textCardPanelDrafts,
        imageCardPanelDrafts,
        imageCardProviderById,
        imageCardModelById,
        imageCardSizeById,
        imageCardQualityById,
        imageCardCountById,
        imageCardAspectRatioById,
      }) as CanvasClipboardSnapshot | null;
      if (!snapshot) return;

      const copiedItems = materializeCanvasClipboardPaste({
        clipboard: snapshot,
        pasteCount: 0,
        offsetStep: { x: 0, y: 0 },
        createId: (sourceId: string, index: number) =>
          `${sourceId}-alt-copy-${Date.now()}-${index + 1}-${Math.random().toString(36).slice(2, 7)}`,
      }) as MaterializedCanvasClipboardPaste | null;
      if (!copiedItems) return;

      const primarySourceIndex = snapshot.items.findIndex((item) => item.id === primaryId);
      const copiedPrimaryId = copiedItems.items[Math.max(0, primarySourceIndex)]?.id ?? getPrimarySelectedId(copiedItems.selectedIds);
      if (!copiedPrimaryId) return;

      pendingCanvasHistorySnapshotRef.current = createCurrentCanvasUndoSnapshot();
      cancelZoomAnimation();
      cancelViewportAnimation();
      clearPendingConnectionMenu();
      setSelectedConnectionIds([]);
      setIsDragging(true);
      draggingItemIdsRef.current = copiedItems.selectedIds;
      if (suppressNextItemClickTimerRef.current) {
        clearTimeout(suppressNextItemClickTimerRef.current);
      }
      suppressNextItemClickRef.current = primaryId;
      suppressNextItemClickTimerRef.current = setTimeout(() => {
        suppressNextItemClickRef.current = null;
        suppressNextItemClickTimerRef.current = null;
      }, 350);
      setSelectedId(copiedPrimaryId);
      setSelectedIds(copiedItems.selectedIds);
      setTextCardPanelDrafts((prev) => ({ ...prev, ...copiedItems.textCardPanelDrafts }));
      setImageCardPanelDrafts((prev) => ({ ...prev, ...copiedItems.imageCardPanelDrafts }));
      setImageCardProviderById((prev) => ({ ...prev, ...copiedItems.imageCardProviderById }));
      setImageCardModelById((prev) => ({ ...prev, ...copiedItems.imageCardModelById }));
      setImageCardSizeById((prev) => ({ ...prev, ...copiedItems.imageCardSizeById }));
      setImageCardQualityById((prev) => ({ ...prev, ...copiedItems.imageCardQualityById }));
      setImageCardCountById((prev) => ({ ...prev, ...copiedItems.imageCardCountById }));
      setImageCardAspectRatioById((prev) => ({ ...prev, ...copiedItems.imageCardAspectRatioById }));
      setItems((prev) => [...prev, ...copiedItems.items]);
      dragStart.current = { x: clientX, y: clientY };
      dragItemStartPositionsRef.current = Object.fromEntries(
        copiedItems.items.map((item) => [item.id, { x: item.x, y: item.y }])
      );
    },
    [
      cancelZoomAnimation,
      cancelViewportAnimation,
      clearPendingConnectionMenu,
      createCurrentCanvasUndoSnapshot,
      getPrimarySelectedId,
      imageCardAspectRatioById,
      imageCardCountById,
      imageCardProviderById,
      imageCardModelById,
      imageCardPanelDrafts,
      imageCardQualityById,
      imageCardSizeById,
      setImageCardAspectRatioById,
      setImageCardCountById,
      setImageCardProviderById,
      setImageCardModelById,
      setImageCardPanelDrafts,
      setImageCardQualityById,
      setImageCardSizeById,
      setItems,
      setTextCardPanelDrafts,
      textCardPanelDrafts,
    ]
  );

  const handleCanvasPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    cancelViewportAnimation();
    Object.values(magneticPorts).forEach((port) => {
      if (port.isTracking) releaseMagneticPort(port);
    });
    debugCanvasConnection('canvas-pointerdown', {
      button: e.button,
      pointerId: e.pointerId,
      dataset: {
        canvas: target.dataset.canvas ?? null,
        port: target.dataset.port ?? null,
        portBridge: target.dataset.portBridge ?? null,
        itemId: target.dataset.itemId ?? null,
        cornerResize: target.dataset.cornerResize ?? null,
      },
      connectionMode,
      activeFromItemId: connectionSessionRef.current?.fromItemId ?? null,
    });

    if (isEventInsideTextCardPanel(target)) {
      return;
    }

    if (e.button === 0) {
      e.preventDefault();
    }

    if (connectionSessionRef.current && target.dataset.canvas === 'true') {
      resetConnectionInteraction();
      return;
    }

    if (e.button === 0 && isSpacePressed) {
      cancelZoomAnimation();
      cancelViewportAnimation();
      clearPendingConnectionMenu();
      e.preventDefault();
      setIsPanning(true);
      panStartOffset.current = { x: viewport.x, y: viewport.y };
      dragStart.current = { x: e.clientX, y: e.clientY };
      return;
    }

    if (e.button === 1) {
      cancelZoomAnimation();
      cancelViewportAnimation();
      clearPendingConnectionMenu();
      e.preventDefault();
      setIsPanning(true);
      panStartOffset.current = { x: viewport.x, y: viewport.y };
      dragStart.current = { x: e.clientX, y: e.clientY };
      return;
    }

    if (e.button === 0 && target.dataset.canvas === 'true') {
      if (pendingConnectionMenu) {
        clearPendingConnectionMenu();
        return;
      }
      const canvasRect = canvasRef.current?.getBoundingClientRect();
      if (!canvasRect) return;
      const startX = e.clientX - canvasRect.left;
      const startY = e.clientY - canvasRect.top;

      marqueeToggleModeRef.current = e.shiftKey;
      if (!e.shiftKey) {
        setSelectedConnectionIds([]);
        setSelectedId(null);
        setSelectedIds([]);
      }
      setIsMarqueeSelecting(true);
      marqueeStartRef.current = { x: startX, y: startY };
      setMarqueeRect({ x: startX, y: startY, width: 0, height: 0 });
    }
  };

  const handleCanvasPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (isCornerResizing && selectedId && cornerResizeStart.current) {
      latestInteractionPointerRef.current = { x: e.clientX, y: e.clientY };
      scheduleInteractionFrame();
      return;
    }

    if (isPanning) {
      latestInteractionPointerRef.current = { x: e.clientX, y: e.clientY };
      scheduleInteractionFrame();
      return;
    }

    if (isMarqueeSelecting && marqueeStartRef.current && canvasRef.current) {
      const canvasRect = canvasRef.current.getBoundingClientRect();
      const currentX = e.clientX - canvasRect.left;
      const currentY = e.clientY - canvasRect.top;
      const startX = marqueeStartRef.current.x;
      const startY = marqueeStartRef.current.y;

      setMarqueeRect({
        x: Math.min(startX, currentX),
        y: Math.min(startY, currentY),
        width: Math.abs(currentX - startX),
        height: Math.abs(currentY - startY),
      });
      return;
    }

    if (!isDragging) {
      const point = getCanvasRelativePoint(e.clientX, e.clientY);
      if (point) {
        updateMagneticPort(toCanvasPoint(point));
      }
    }

    if (isDragging && selectedId) {
      latestInteractionPointerRef.current = { x: e.clientX, y: e.clientY };
      scheduleInteractionFrame();
    }
  };

  const handleCanvasPointerLeave = () => {
    Object.values(magneticPorts).forEach((port) => {
      if (port.isTracking) releaseMagneticPort(port);
    });
  };

  const handleCanvasPointerUp = (e?: React.PointerEvent<HTMLDivElement>) => {
    debugCanvasConnection('canvas-pointerup', {
      button: e?.button ?? null,
      pointerId: e?.pointerId ?? null,
      connectionMode,
      activeFromItemId: connectionSessionRef.current?.fromItemId ?? null,
      marqueeSelecting: isMarqueeSelecting,
      dragging: isDragging,
      panning: isPanning,
    });
    if (isMarqueeSelecting && marqueeRect) {
      const rectInCanvas = {
        left: (marqueeRect.x - viewport.x) / viewport.scale,
        right: (marqueeRect.x + marqueeRect.width - viewport.x) / viewport.scale,
        top: (marqueeRect.y - viewport.y) / viewport.scale,
        bottom: (marqueeRect.y + marqueeRect.height - viewport.y) / viewport.scale,
      };

      const hitIds = items
        .filter((item) => {
          const itemLeft = item.x;
          const itemRight = item.x + item.width;
          const itemTop = item.y;
          const itemBottom = item.y + item.height;

          return !(
            itemRight < rectInCanvas.left ||
            itemLeft > rectInCanvas.right ||
            itemBottom < rectInCanvas.top ||
            itemTop > rectInCanvas.bottom
          );
        })
        .map((item) => item.id);
      const hitConnectionIds = getConnectionHitIdsForMarquee(marqueeRect);

      if (marqueeToggleModeRef.current) {
        setSelectedIds((prev) => {
          const next = hitIds.reduce((ids, id) => toggleSelectionId(ids, id), prev);
          setSelectedId(getPrimarySelectedId(next));
          setItems((prev) => moveCanvasItemsToFront(prev, next));
          return next;
        });
        setSelectedConnectionIds((prev) =>
          hitConnectionIds.reduce((ids, id) => toggleSelectionId(ids, id), prev)
        );
      } else {
        setSelectedIds(hitIds);
        setSelectedId(getPrimarySelectedId(hitIds));
        setSelectedConnectionIds(hitConnectionIds);
        setItems((prev) => moveCanvasItemsToFront(prev, hitIds));
      }
    }

    setIsDragging(false);
    setIsPanning(false);
    setIsCornerResizing(false);
    setIsMarqueeSelecting(false);
    setMarqueeRect(null);
    marqueeStartRef.current = null;
    marqueeToggleModeRef.current = false;
    draggingItemIdsRef.current = [];
    dragItemStartPositionsRef.current = {};
    latestInteractionPointerRef.current = null;
    cornerResizeStart.current = null;
    if (interactionFrameRef.current !== null) {
      cancelAnimationFrame(interactionFrameRef.current);
      interactionFrameRef.current = null;
    }

    commitPendingCanvasUndoSnapshot();

    if (currentSessionId) {
      scheduleCurrentSessionSave();
    }
  };

  const applyViewportScale = useCallback(
    (nextScale: number, anchor?: { x: number; y: number }) => {
      wheelZoomTargetRef.current = {
        scale: nextScale,
        anchor,
      };
      scheduleWheelZoom();
    },
    [scheduleWheelZoom]
  );

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    cancelViewportAnimation();

    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const pointerX = e.clientX - rect.left;
    const pointerY = e.clientY - rect.top;

    const oldScale = wheelZoomTargetRef.current?.scale ?? viewportRef.current.scale;

    const direction = e.deltaY > 0 ? -1 : 1;
    const scaleBy = 1.1;
    const newScale = direction > 0 ? oldScale * scaleBy : oldScale / scaleBy;

    applyViewportScale(newScale, { x: pointerX, y: pointerY });
  };

  const handleConnectionPointerDown = useCallback(
    (e: React.PointerEvent<SVGPathElement>, connectionId: string) => {
      e.preventDefault();
      e.stopPropagation();
      if (connectionSessionRef.current) {
        resetConnectionInteraction();
      }
      if (e.shiftKey) {
        setSelectedConnectionIds((prev) => toggleSelectionId(prev, connectionId));
        return;
      }
      setSelectedConnectionIds([connectionId]);
      setSelectedId(null);
      setSelectedIds([]);
    },
    [resetConnectionInteraction]
  );

  const handleInputPortEnter = useCallback((itemId: string) => {
    setHoveredInputPortItemId(itemId);
  }, []);

  const handleInputPortLeave = useCallback(
    (itemId: string) => {
      if (connectionMode === 'dragging' && connectionSnapTargetId === itemId) return;
      setHoveredInputPortItemId((prev) => (prev === itemId ? null : prev));
    },
    [connectionMode, connectionSnapTargetId]
  );

  const handleOutputPortEnter = useCallback((itemId: string) => {
    setHoveredOutputPortItemId(itemId);
  }, []);

  const handleOutputPortLeave = useCallback((itemId: string) => {
    if (connectionSessionRef.current?.fromItemId === itemId) return;
    setHoveredOutputPortItemId((prev) => (prev === itemId ? null : prev));
  }, []);

  const handleOutputPortPointerDown = (e: React.PointerEvent<HTMLElement>, item: CanvasItem, source: 'bridge' | 'button') => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    debugCanvasConnection(source === 'bridge' ? 'out-bridge-pointerdown' : 'out-button-pointerdown', {
      itemId: item.id,
      pointerId: e.pointerId,
      connectionMode,
      hoveredOutputPortItemId,
    });
    beginConnectionDragFromItem(item, e.pointerId, source);
  };

  const handleSelectionGroupPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      if (isSpacePressed) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.altKey) {
        beginAltDragCopiedItems(
          e.clientX,
          e.clientY,
          selectedIds,
          getPrimarySelectedId(selectedIds)
        );
        return;
      }
      beginDraggingSelectedItems(
        e.clientX,
        e.clientY,
        selectedIds,
        getPrimarySelectedId(selectedIds)
      );
    },
    [beginAltDragCopiedItems, beginDraggingSelectedItems, getPrimarySelectedId, isSpacePressed, selectedIds]
  );

  const handleItemMouseEnter = useCallback((itemId: string) => {
    setHoveredCanvasItemId(itemId);
  }, []);

  const handleItemMouseLeave = useCallback((itemId: string) => {
    if (connectionSessionRef.current?.fromItemId === itemId) return;
    setHoveredCanvasItemId((prev) => (prev === itemId ? null : prev));
  }, []);

  const handleItemClick = useCallback((e: React.MouseEvent<HTMLDivElement>, itemId: string) => {
    e.stopPropagation();
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
      setSelectedIds((prev) => {
        const next = toggleSelectionId(prev, itemId);
        setSelectedId(getPrimarySelectedId(next));
        setItems((prev) => moveCanvasItemsToFront(prev, next));
        return next;
      });
      return;
    }

    setSelectedConnectionIds([]);
    setSelectedId(itemId);
    setSelectedIds([itemId]);
    setItems((prev) => moveCanvasItemsToFront(prev, [itemId]));
  }, [getPrimarySelectedId]);

  const handleItemPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>, itemId: string) => {
      const target = e.target as HTMLElement;
      if (target.dataset.cornerResize) return;
      if (target.dataset.port) return;
      if (isSpacePressed) return;
      if (e.shiftKey) return;
      if (editingTextCardId === itemId) {
        finalizeManualTextCardEditing(itemId);
      }
      e.preventDefault();
      e.stopPropagation();
      const draggingIds = selectedIds.includes(itemId) ? selectedIds : [itemId];
      if (e.altKey) {
        beginAltDragCopiedItems(e.clientX, e.clientY, draggingIds, itemId);
        return;
      }
      beginDraggingSelectedItems(e.clientX, e.clientY, draggingIds, itemId);
    },
    [beginAltDragCopiedItems, beginDraggingSelectedItems, editingTextCardId, finalizeManualTextCardEditing, isSpacePressed, selectedIds]
  );

  const handleCornerResizePointerDown = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>, item: CanvasItem) => {
      pendingCanvasHistorySnapshotRef.current = createCurrentCanvasUndoSnapshot();
      cancelZoomAnimation();
      e.preventDefault();
      e.stopPropagation();
      setSelectedId(item.id);
      setSelectedIds([item.id]);
      setItems((prev) => moveCanvasItemsToFront(prev, [item.id]));
      setIsCornerResizing(true);
      cornerResizeStart.current = {
        mouseX: e.clientX,
        mouseY: e.clientY,
        width: item.width,
        height: item.height,
        itemId: item.id,
      };
    },
    [cancelZoomAnimation, createCurrentCanvasUndoSnapshot]
  );

  useEffect(() => {
    if (isHydratingSessionRef.current) {
      return;
    }

    const validIds = new Set(items.map((item) => item.id));
    setConnections((prev) =>
      prev.filter((connection) => validIds.has(connection.fromItemId) && validIds.has(connection.toItemId))
    );
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
    setConnectionSnapTargetId((prev) => (prev && validIds.has(prev) ? prev : null));
    if (connectionSessionRef.current?.fromItemId && !validIds.has(connectionSessionRef.current.fromItemId)) {
      resetConnectionInteraction();
    }
  }, [items, connectionPointerId, connections, resetConnectionInteraction, setConnections]);

  useEffect(() => {
    if (isHydratingSessionRef.current) {
      isHydratingSessionRef.current = false;
    }
  });

  useEffect(() => {
    return () => {
      if (interactionFrameRef.current !== null) {
        cancelAnimationFrame(interactionFrameRef.current);
      }
      if (zoomAnimationFrameRef.current !== null) {
        cancelAnimationFrame(zoomAnimationFrameRef.current);
      }
      if (viewportAnimationFrameRef.current !== null) {
        cancelAnimationFrame(viewportAnimationFrameRef.current);
      }
    };
  }, []);

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
              allowedModelIds: workspaceTextModelOptions.map((option) => option.id),
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
      workspaceTextModelOptions,
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
  }, []);

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
  }, []);

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
      setShowImageCardModelMenu(false);
      setShowImageCardQualityMenu(false);
      setShowImageCardCountMenu(false);
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
        const validationFailureCount = taskResults.reduce((total, result) => {
          if (result.status !== 'fulfilled') return total;
          return total + (result.value?.failed ?? 0);
        }, 0);
        const firstValidationFailureReason = taskResults.find(
          (result): result is PromiseFulfilledResult<{ completed: number; failed: number; failureReason: string | null }> =>
            result.status === 'fulfilled' && typeof result.value?.failureReason === 'string' && result.value.failureReason.length > 0
        )?.value.failureReason;
        const failedCount = requestFailureCount + validationFailureCount;
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
            if (firstValidationFailureReason) {
              throw new Error(firstValidationFailureReason);
            }
            const firstReason = failures[0]?.reason;
            throw firstReason instanceof Error ? firstReason : new Error('未收到有效图片响应，请重试');
          }

          const failureMessage =
            transportFailureCount > 0 && transportFailureCount === requestFailureCount
              ? `连接中断，请重试剩余 ${failedCount} 张`
              : buildCanvasImageGenerationFailureMessage({
                  requestedCount: asyncRequests.length,
                  completedCount,
                  validationFailureCount,
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
      recordCurrentCanvasUndoSnapshot,
      selectedImageCardModel.providerId,
      workspaceImageModelOptions,
    ]
  );

  const handleCancelCanvasImageGenerate = useCallback((itemId?: string | null) => {
    if (!itemId) return;
    canvasImageGenerateAbortControllersRef.current.get(itemId)?.abort();
  }, []);

  const handleCancelGenerate = async () => {
    updateActiveStreamMessageStatus('cancelled', '任务已终止');
    updatePendingAssistantMessage((msg) => ({
      ...msg,
      taskStatus: 'cancelled',
      content: '任务已终止',
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
  }) => {
    const currentChatInput = options?.input ?? chatInput;
    if (!currentChatInput.trim()) return;

    const overrideReferencePayload = options?.referenceImagesOverride
      ? buildReferenceImageRequestPayload(options.referenceImagesOverride)
      : null;
    const currentReferenceImages = overrideReferencePayload
      ? [...overrideReferencePayload.referenceImages]
      : [...chatReferenceImages];
    const currentSkill = options?.skill ?? activeSkill;
    const currentViewport = { ...viewport };
    const currentImageCount = imageCount;
    const generationSessionId = currentSessionIdRef.current;
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
      confirmPatterns.some((pattern) => normalizedInput.includes(pattern.toLowerCase()));
    const isBrandGenerate =
      currentSkill?.id === 'brand' &&
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
        referenceImages: currentReferenceImages.length > 0 ? currentReferenceImages : undefined,
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
      setChatReferenceImages([]);
      
      try {
        const response = await fetch('/api/skills/jobs', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            skillType: 'logo',
            payload: { brandName, industry },
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
            model: 'gemini-3.1-flash-image-preview',
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
        referenceImages: currentReferenceImages.length > 0 ? currentReferenceImages : undefined,
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
      setChatReferenceImages([]);

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
            model: 'gemini-3.1-flash-image-preview',
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
      referenceImages: currentReferenceImages.length > 0 ? currentReferenceImages : undefined,
      skill: currentSkill || undefined,
    };
    const assistantPlaceholderId = `msg-${Date.now()}-assistant-pending`;
    
    const messagesForAPI = chatMessages
      .filter(msg => msg.role === 'user' || msg.role === 'assistant')
      .map(msg => ({
        role: msg.role === 'user' ? 'user' : 'assistant',
        content: msg.content || msg.imageUrl || ''
      }));
    messagesForAPI.push({ role: 'user', content: currentChatInput });
    
    pendingAssistantMessageIdRef.current = assistantPlaceholderId;
    setChatMessages(prev => [...prev, userMessage, {
      id: assistantPlaceholderId,
      role: 'assistant',
      content: '...',
      taskStatus: 'running',
    }]);
    setChatInput('');
    setIsGenerating(true);
    setHasStartedChat(true);
    setChatReferenceImages([]);

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
          model: 'gemini-3.1-flash-image-preview',
        }]);

        try {
          const logoResponse = await fetch('/api/generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              messages: [{ role: 'user', content: logoPrompt }],
              size: '1024x1024',
              intent: 'image',
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
                model: 'gemini-3.1-flash-image-preview',
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
      if (typeof options?.modelOverride === 'string' && options.modelOverride.trim()) {
        requestBody.model = options.modelOverride.trim();
      }
      if (generationMode === 'image' && imageAspectRatio !== 'auto') {
        requestBody.aspect_ratio = imageAspectRatio;
      }

      if (currentSkill?.id === 'brand') {
        requestBody.intent = 'chat';
      }
      const referencesForRequest = currentSkill?.id === 'brand'
        ? mergedBrandLogoReferences
        : overrideReferencePayload
          ? overrideReferencePayload.referenceImages
          : currentReferenceImages;
      const referenceLabelsForRequest = currentSkill?.id === 'brand'
        ? mergedBrandLogoReferences.map((_, index) => `image${index + 1}`)
        : overrideReferencePayload
          ? overrideReferencePayload.referenceLabels
          : currentReferenceImages.map((_, index) => `image${index + 1}`);
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
      generateAbortRef.current = controller;

      const response = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
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
          model: 'gemini-3.1-flash-lite-preview-thinking-medium',
          taskStatus: 'running',
        }));

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        let doneReceived = false;

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
              channel?: 'content' | 'reasoning';
              model?: string;
              error?: string;
            };
            try {
              event = JSON.parse(trimmed) as {
                type?: string;
                content?: string;
                channel?: 'content' | 'reasoning';
                model?: string;
                error?: string;
              };
            } catch {
              continue;
            }

            if (event.type === 'start' && event.model) {
              setChatMessages(prev => prev.map((msg) => {
                if (msg.id !== assistantId) return msg;
                return { ...msg, model: event.model };
              }));
              continue;
            }

            if (event.type === 'delta' && event.content) {
              const channel = event.channel || 'content';
              if (channel === 'reasoning') {
                setChatMessages(prev => prev.map((msg) => {
                  if (msg.id !== assistantId) return msg;
                  return {
                    ...msg,
                    reasoningContent: `${msg.reasoningContent || ''}${event.content || ''}`,
                  };
                }));
              } else {
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
              if (channel === 'reasoning') {
                setChatMessages(prev => prev.map((msg) => {
                  if (msg.id !== assistantId) return msg;
                  return {
                    ...msg,
                    reasoningContent: `${msg.reasoningContent || ''}${event.content || ''}`,
                  };
                }));
              } else {
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
            
            setTimeout(() => {
              chatContainerRef.current?.scrollTo({
                top: chatContainerRef.current.scrollHeight,
                behavior: 'smooth'
              });
            }, 100);
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
          ...msg,
          taskStatus: 'cancelled',
          content: '任务已终止',
        }));
        return;
      }

      updateActiveStreamMessageStatus('failed', '生成失败，请重试');
      updatePendingAssistantMessage((msg) => ({
        ...msg,
        taskStatus: 'failed',
        content: `生成失败: ${error instanceof Error ? error.message : '未知错误'}`,
      }));
    } finally {
      stopStreamTypewriter();
      generateAbortRef.current = null;
      setIsGenerating(false);
      if (!activeSkillJobId) {
        pendingAssistantMessageIdRef.current = null;
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
      const waitMessage: ChatMessage = {
        id: `msg-${Date.now()}-skill-choice-wait`,
        role: 'assistant',
        content: '已暂停，等待你的选择。你可以点击“重新选择”继续流程。',
      };
      setChatMessages((prev) => [...prev, waitMessage]);
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

  const handleQuickSkillSelect = (
    action: { id: string; label: string },
    source: SkillSelectSource
  ) => {
    const selectedSkill = { id: action.id, label: action.label };
    setActiveSkillForCurrentTopic(selectedSkill);
    if (source === 'center_quick_action') {
      setHideWelcomeByCenterSkillPick(true);
    }

    if (source === 'center_quick_action' && !chatInput.trim()) {
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
          updatedAt: Date.now(),
        };
      });
    }

    return buildPersistedSession(session, {
      updatedAt: Date.now(),
      items: liveState.items,
      textCardPanelDrafts: liveState.textCardPanelDrafts,
      imageCardPanelDrafts: liveState.imageCardPanelDrafts,
      imageCardProviderById: liveState.imageCardProviderById,
      imageCardModelById: liveState.imageCardModelById,
      imageCardSizeById: liveState.imageCardSizeById,
      imageCardQualityById: liveState.imageCardQualityById,
      imageCardCountById: liveState.imageCardCountById,
      imageCardAspectRatioById: liveState.imageCardAspectRatioById,
      connections: liveState.connections,
      messages: liveState.chatMessages,
      topics,
      activeTopicId: activeId,
      generatedImageHistory:
        liveState.generatedImageHistoryBySession[session.id] ??
        persistedGeneratedImageHistoryBySessionRef.current[session.id] ??
        session.generatedImageHistory ??
        [],
      viewport: liveState.viewport,
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
    isHydratingSessionRef.current = true;
    syncSessionLiveState({
      items: resolvedState.items,
      connections: resolvedState.connections || [],
      chatMessages: resolvedState.chatMessages || [],
      activeSkill: resolvedState.activeSkill || null,
      textCardPanelDrafts: resolvedState.normalizedSession?.textCardPanelDrafts || {},
      imageCardPanelDrafts: resolvedState.normalizedSession?.imageCardPanelDrafts || {},
      imageCardProviderById: resolvedState.normalizedSession?.imageCardProviderById || {},
      imageCardModelById: resolvedState.normalizedSession?.imageCardModelById || {},
      imageCardSizeById: resolvedState.normalizedSession?.imageCardSizeById || {},
      imageCardQualityById: resolvedState.normalizedSession?.imageCardQualityById || {},
      imageCardCountById: resolvedState.normalizedSession?.imageCardCountById || {},
      imageCardAspectRatioById: resolvedState.normalizedSession?.imageCardAspectRatioById || {},
      viewport: resolvedState.viewport || { x: 0, y: 0, scale: 1 },
    });
    setItemsState(resolvedState.items);
    setConnectionsState(resolvedState.connections || []);
    setChatMessagesState(resolvedState.chatMessages || []);
    setActiveSkillState(resolvedState.activeSkill || null);
    setEditingTextCardId(null);
    setSelectedConnectionIds([]);
    setConnectionSnapTargetId(null);
    setPendingConnectionMenu(null);
    setFrozenPreviewConnection(null);
    setTextCardPanelDraftsState(resolvedState.normalizedSession?.textCardPanelDrafts || {});
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
  }, [syncSessionLiveState]);

  const isHighFrequencyInteractionActive =
    isDragging || isCornerResizing || isPanning || isMarqueeSelecting;

  const sessionSaveSignal = React.useMemo(
    () => ({
      items,
      textCardPanelDrafts,
      imageCardPanelDrafts,
      imageCardProviderById,
      imageCardModelById,
      imageCardSizeById,
      imageCardCountById,
      imageCardAspectRatioById,
      connections,
      chatMessages,
      viewport,
      imageCount,
      activeSkill,
      generatedImageHistoryBySession,
    }),
    [activeSkill, chatMessages, connections, generatedImageHistoryBySession, imageCardAspectRatioById, imageCardCountById, imageCardModelById, imageCardPanelDrafts, imageCardProviderById, imageCardQualityById, imageCardSizeById, imageCount, items, textCardPanelDrafts, viewport]
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
  }, [currentSessionId, viewMode]);

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
          topic.id === session.activeTopicId ? { ...topic, activeSkill: skill } : topic
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
    const providers = Array.isArray(data.providers) ? data.providers : [];
    const nextSelectedProviderId =
      providers.find((provider) => provider.primary)?.id ||
      providers[0]?.id ||
      'comfly';
    const nextSelectedProvider = providers.find((provider) => provider.id === nextSelectedProviderId) || providers[0] || null;
    setProviderSettingsProviders(providers);
    setProviderSettingsSelectedProviderId(nextSelectedProviderId);
    setProviderSettingsApiKey(nextSelectedProvider?.apiKey || '');
    setProviderSettingsError(null);
    setProviderSettingsTestResult(null);
    setIsProviderSettingsApiKeyVisible(false);
  }, []);

  const selectedProviderSettings = providerSettingsProviders.find(
    (provider) => provider.id === providerSettingsSelectedProviderId
  ) || providerSettingsProviders[0] || null;
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
    setIsProviderSettingsApiKeyVisible(false);
  }, []);

  const handleProviderSettingsProviderChange = useCallback((nextProviderId: ProviderSettingsProviderId) => {
    const nextProvider = providerSettingsProviders.find((provider) => provider.id === nextProviderId);
    setProviderSettingsSelectedProviderId(nextProviderId);
    setProviderSettingsApiKey(nextProvider?.apiKey || '');
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
        apiKey: provider.id === providerSettingsSelectedProviderId ? providerSettingsApiKey : provider.apiKey,
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
  }, [providerSettingsApiKey, selectedProviderSettings, updateSelectedProviderSettings]);

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
    }));
    setProviderSettingsSelectedFetchedModels((prev) => {
      if (!(modelId in prev)) return prev;
      return {
        ...prev,
        [modelId]: false,
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
    [pendingConnectionMenu, toCanvasPoint, createImageCardItemAtCanvasPoint, createTextItemAtCanvasPoint, clearPendingConnectionMenu, recordCurrentCanvasUndoSnapshot]
  );

  useEffect(() => {
    return () => {
      detachConnectionWindowListeners();
      clearMagneticPortResetTimer();
    };
  }, [clearMagneticPortResetTimer, detachConnectionWindowListeners]);

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
      imageCardPanelDrafts,
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
    imageCardAspectRatioById,
    imageCardCountById,
    imageCardModelById,
    imageCardPanelDrafts,
    imageCardQualityById,
    imageCardSizeById,
    selectedIds,
    textCardPanelDrafts,
  ]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isEditableUndoRedoTarget(e.target)) return;

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
  }, [selectedId, selectedIds, connectionPointerId, selectedConnectionIds, pendingConnectionMenu, clearPendingConnectionMenu, copySelectedCanvasItemsToClipboard, deleteItem, hasActiveNonEditableTextSelection, recordCurrentCanvasUndoSnapshot, redoCanvasEdit, resetConnectionInteraction, undoCanvasEdit]);

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
      if (skillsMenuRef.current && !skillsMenuRef.current.contains(e.target as Node)) {
        setShowSkillsMenu(false);
      }
      if (aspectRatioMenuRef.current && !aspectRatioMenuRef.current.contains(e.target as Node)) {
        setShowAspectRatioMenu(false);
      }
      if (textPanelModelMenuRef.current && !textPanelModelMenuRef.current.contains(e.target as Node)) {
        setShowTextPanelModelMenu(false);
      }
      const isInsideImageCardModelMenu =
        !!imageCardModelMenuRef.current?.contains(e.target as Node) ||
        !!imageCardModelPopoverRef.current?.contains(e.target as Node);
      if (!isInsideImageCardModelMenu) {
        setShowImageCardModelMenu(false);
      }
      const isInsideImageCardAspectRatioMenu =
        !!imageCardAspectRatioMenuRef.current?.contains(e.target as Node) ||
        !!imageCardAspectRatioPopoverRef.current?.contains(e.target as Node);
      if (!isInsideImageCardAspectRatioMenu) {
        setShowImageCardAspectRatioMenu(false);
      }
      const isInsideImageCardResolutionMenu =
        !!imageCardResolutionMenuRef.current?.contains(e.target as Node) ||
        !!imageCardResolutionPopoverRef.current?.contains(e.target as Node);
      if (!isInsideImageCardResolutionMenu) {
        setShowImageCardResolutionMenu(false);
      }
      const isInsideImageCardQualityMenu =
        !!imageCardQualityMenuRef.current?.contains(e.target as Node) ||
        !!imageCardQualityPopoverRef.current?.contains(e.target as Node);
      if (!isInsideImageCardQualityMenu) {
        setShowImageCardQualityMenu(false);
      }
      const isInsideImageCardCountMenu =
        !!imageCardCountMenuRef.current?.contains(e.target as Node) ||
        !!imageCardCountPopoverRef.current?.contains(e.target as Node);
      if (!isInsideImageCardCountMenu) {
        setShowImageCardCountMenu(false);
      }
      setShowAvatarMenu(false);
      setShowHistoryPanel(false);
    };
    if (showAvatarMenu || showProjectMenu || showAddNodeMenu || showGeneratedImageHistoryPanel || showHistoryPanel || showGenerationModeMenu || showSkillsMenu || showAspectRatioMenu || showImageCardModelMenu || showImageCardAspectRatioMenu || showImageCardResolutionMenu || showImageCardQualityMenu || showImageCardCountMenu || showTextPanelModelMenu) {
      document.addEventListener('pointerdown', handlePointerDownOutside);
      return () => document.removeEventListener('pointerdown', handlePointerDownOutside);
    }
  }, [showAvatarMenu, showProjectMenu, showAddNodeMenu, showGeneratedImageHistoryPanel, showHistoryPanel, showGenerationModeMenu, showSkillsMenu, showAspectRatioMenu, showImageCardModelMenu, showImageCardAspectRatioMenu, showImageCardResolutionMenu, showImageCardQualityMenu, showImageCardCountMenu, showTextPanelModelMenu, editingSessionId, hasActiveAssistantTextSelection, isNodeInsideAssistantSelectable]);

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
    const container = chatContainerRef.current;
    if (container) {
      setTimeout(() => {
        container.scrollTo({
          top: container.scrollHeight,
          behavior: 'smooth'
        });
      }, 150);
    }
  }, [chatMessages]);

  useEffect(() => {
    syncEditorTextFromState(chatInput);
  }, [chatInput, syncEditorTextFromState]);

  useEffect(() => {
    syncEditorTextFromState(latestChatInputRef.current, true);
  }, [activeSkill?.id, syncEditorTextFromState]);

  useEffect(() => {
    if (!activeSkillJobId) return;

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
            updatePendingAssistantMessage((msg) => ({
              ...msg,
              content: `⚠️ 任务状态丢失（${reason}），请重新发起一次出图。`,
              taskStatus: 'failed',
            }));
            setActiveSkillJobId(null);
            setActiveSkillJobType(null);
            setIsGenerating(false);
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
          
          updatePendingAssistantMessage((msg) => ({
            ...msg,
            content: summaryText,
            taskStatus: data.status === 'failed' ? 'failed' : data.status === 'cancelled' ? 'cancelled' : 'completed',
          }));
          setActiveSkillJobId(null);
          setActiveSkillJobType(null);
          setIsGenerating(false);
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
  }, [activeSkillJobId, activeSkillJobType, appendGeneratedImageHistoryForSession, getSpawnPosition, recordCurrentCanvasUndoSnapshot]);

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
    <div className="workspace-editor-shell relative isolate flex h-screen w-full overflow-hidden">
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
      <div className="absolute left-4 top-1/2 z-[120] -translate-y-1/2">
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
            <div className="workspace-left-rail flex w-[72px] flex-col items-center rounded-[36px] px-2 py-3 backdrop-blur-xl">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  clearPendingConnectionMenu();
                  setShowAddNodeMenu((prev) => !prev);
                }}
                className="workspace-add-button mb-4 inline-flex h-12 w-12 items-center justify-center rounded-full transition-colors"
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
              <div className="workspace-popover-panel absolute left-full top-0 z-[150] ml-3 w-[384px] overflow-hidden rounded-[28px] backdrop-blur-xl">
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
                          className="workspace-history-card group overflow-hidden rounded-[20px] text-left transition-all hover:-translate-y-0.5"
                        >
                          <div className="workspace-preview-tile relative aspect-square overflow-hidden">
                            <Image
                              src={entry.src}
                              alt="历史生成图"
                              fill
                              unoptimized
                              sizes="160px"
                              className="object-cover transition-transform duration-200 group-hover:scale-[1.03]"
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
            className="workspace-floating-control flex h-10 w-10 items-center justify-center rounded-full text-sm font-medium transition-colors"
            onClick={(e) => { 
              e.stopPropagation(); 
              leaveEditor();
            }}
            aria-label="返回画廊"
          >
            L
          </button>
          {showAvatarMenu && (
            <div className="workspace-popover-panel absolute left-0 top-12 z-[130] w-48 rounded-2xl py-2 backdrop-blur-xl">
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
            className="workspace-floating-control flex items-center gap-1.5 rounded-xl px-3 py-2 transition-colors"
            aria-label="打开画布列表"
          >
            <span className="max-w-[120px] truncate text-sm font-medium">{currentProjectName}</span>
            <ChevronDown size={14} className="workspace-text-muted flex-shrink-0" />
          </button>

          {showProjectMenu && (
            <div className="workspace-popover-panel absolute left-0 top-12 z-[130] w-64 overflow-hidden rounded-2xl backdrop-blur-xl">
              <div className="p-2">
                <button 
                  disabled={pendingSessionAction !== null}
                  onClick={(e) => { e.stopPropagation(); createNewProject(); }}
                  className="flex min-h-[44px] w-full items-center gap-2 rounded-xl px-3 py-2 text-sm transition-colors hover:bg-[var(--workspace-control-hover)] disabled:cursor-not-allowed disabled:opacity-50"
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
                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          disabled={pendingSessionAction !== null}
                          onClick={(e) => { e.stopPropagation(); setEditingSessionId(session.id); setEditingName(session.name); }}
                          className="inline-flex h-11 w-11 items-center justify-center rounded-lg transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
                          title="重命名"
                          aria-label={`重命名 ${session.name}`}
                        >
                          <Edit3 size={12} className="text-zinc-500" />
                        </button>
                        <button
                          disabled={pendingSessionAction !== null}
                          onClick={(e) => { e.stopPropagation(); deleteSession(session.id, e); }}
                          className="inline-flex h-11 w-11 items-center justify-center rounded-lg transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40"
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
        widthStyle={sidebarCollapsed ? '100%' : 'calc(100% - 500px)'}
        isSpacePressed={isSpacePressed}
        isPanning={isPanning}
        viewport={viewport}
        themePalette={themePalette}
        items={items}
        connections={connections}
        itemById={itemById}
        selectedIds={selectedIds}
        selectedId={selectedId}
        selectedConnectionIds={selectedConnectionIds}
        hoveredCanvasItemId={hoveredCanvasItemId}
        hoveredInputPortItemId={hoveredInputPortItemId}
        hoveredOutputPortItemId={hoveredOutputPortItemId}
        magneticPorts={magneticPorts}
        connectionMode={connectionMode}
        connectionSnapTargetId={connectionSnapTargetId}
        connectionFromItemId={connectionFromItemId}
        frozenPreviewConnection={frozenPreviewConnection}
        pendingConnectionMenu={pendingConnectionMenu}
        multiSelectionBounds={multiSelectionBounds}
        isMarqueeSelecting={isMarqueeSelecting}
        marqueeRect={marqueeRect}
        getPreviewRenderPoints={getPreviewRenderPoints}
        getConnectionAnchorCanvasPoint={getConnectionAnchorCanvasPoint}
        toCanvasScreenPoint={toCanvasScreenPoint}
        buildConnectionPath={buildConnectionPath}
        getRenderedPortOverlayPoint={getRenderedPortOverlayPoint}
        getMagneticPortKey={getMagneticPortKey}
        onPointerDown={handleCanvasPointerDown}
        onPointerMove={handleCanvasPointerMove}
        onPointerUp={handleCanvasPointerUp}
        onPointerLeave={handleCanvasPointerLeave}
        onWheel={handleWheel}
        onPaste={handleCanvasPaste}
        onConnectionPointerDown={handleConnectionPointerDown}
        onInputPortEnter={handleInputPortEnter}
        onInputPortLeave={handleInputPortLeave}
        onOutputPortEnter={handleOutputPortEnter}
        onOutputPortLeave={handleOutputPortLeave}
        onOutputPortPointerDown={handleOutputPortPointerDown}
        onSelectionGroupPointerDown={handleSelectionGroupPointerDown}
        onItemMouseEnter={handleItemMouseEnter}
        onItemMouseLeave={handleItemMouseLeave}
        onItemClick={handleItemClick}
        onItemPointerDown={handleItemPointerDown}
        onCornerResizePointerDown={handleCornerResizePointerDown}
        onPendingMenuPointerDown={(e) => {
          e.stopPropagation();
        }}
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
        generationClockMs={generationClockMs}
        selectedTextPanelModel={selectedTextPanelModel}
        textPanelModelOptions={workspaceTextModelOptions}
        showTextPanelModelMenu={showTextPanelModelMenu}
        textPanelModelMenuRef={textPanelModelMenuRef}
        selectedTextCardPanelInput={selectedTextCardPanelInput}
        selectedTextCardPanelCanSubmit={selectedTextCardPanelCanSubmit}
        selectedTextCardPanelError={selectedTextCardPanelError}
        isSelectedTextCardGenerating={isSelectedTextCardGenerating}
        selectedImageCardPanelInput={selectedImageCardPanelInput}
        selectedImageCardPanelCanSubmit={selectedImageCardPanelCanSubmit}
        selectedImageCardPanelError={selectedImageCardPanelError}
        selectedImageCardModel={selectedImageCardModel}
        imageCardModelOptions={workspaceImageModelOptions}
        selectedImageCardPanelSize={selectedImageCardPanelSize}
        selectedImageCardSizeOptions={selectedImageCardSizeOptions}
        selectedImageCardPanelQuality={selectedImageCardPanelQuality}
        selectedImageCardPanelCount={selectedImageCardPanelCount}
        selectedImageCardPanelAspectRatio={selectedImageCardPanelAspectRatio}
        isSelectedImageCardGenerating={isSelectedImageCardGenerating}
        showImageCardModelMenu={showImageCardModelMenu}
        imageCardModelMenuRef={imageCardModelMenuRef}
        imageCardModelPopoverRef={imageCardModelPopoverRef}
        showImageCardAspectRatioMenu={showImageCardAspectRatioMenu}
        imageCardAspectRatioMenuRef={imageCardAspectRatioMenuRef}
        imageCardAspectRatioPopoverRef={imageCardAspectRatioPopoverRef}
        showImageCardResolutionMenu={showImageCardResolutionMenu}
        imageCardResolutionMenuRef={imageCardResolutionMenuRef}
        imageCardResolutionPopoverRef={imageCardResolutionPopoverRef}
        showImageCardQualityMenu={showImageCardQualityMenu}
        imageCardQualityMenuRef={imageCardQualityMenuRef}
        imageCardQualityPopoverRef={imageCardQualityPopoverRef}
        showImageCardCountMenu={showImageCardCountMenu}
        imageCardCountMenuRef={imageCardCountMenuRef}
        imageCardCountPopoverRef={imageCardCountPopoverRef}
        editingTextCardId={editingTextCardId}
        editingTextCardTextareaRef={editingTextCardTextareaRef}
        onToggleTextPanelModelMenu={() => setShowTextPanelModelMenu((prev) => !prev)}
        onSelectTextPanelModel={(modelId) => {
          const nextModel = findWorkspaceModelOption(workspaceTextModelOptions, modelId, selectedTextPanelProviderId);
          setSelectedTextPanelModelId(nextModel?.id || modelId);
          if (nextModel?.providerId) {
            setSelectedTextPanelProviderId(nextModel.providerId as ProviderSettingsProviderId);
          }
          setShowTextPanelModelMenu(false);
        }}
        onSelectedTextCardPanelInputChange={handleSelectedTextCardPanelInputChange}
        onSelectedTextCardPanelBlur={commitPendingCanvasUndoSnapshot}
        onSelectedTextCardPanelSubmit={handleSelectedTextCardPanelSubmit}
        onSelectedTextCardPanelCancel={() => handleCancelCanvasTextGenerate(selectedTextCardPanelItem?.id ?? null)}
        onToggleImageCardModelMenu={() => {
          setShowImageCardAspectRatioMenu(false);
          setShowImageCardResolutionMenu(false);
          setShowImageCardQualityMenu(false);
          setShowImageCardCountMenu(false);
          setShowImageCardModelMenu((prev) => !prev);
        }}
        onSelectImageCardModel={(modelId) => {
          if (!selectedImageCardPanelItem) return;
          const nextModel = findWorkspaceModelOption(workspaceImageModelOptions, modelId, selectedImageCardProviderId);
          const resolvedModelId = resolveWorkspaceImageCardModel(
            nextModel?.id || modelId,
            workspaceImageModelOptions.map((option) => option.id),
            defaultWorkspaceImageModelOption.id
          );
          const resolvedSizeId = resolveImageCardSize(
            resolvedModelId,
            imageCardSizeById[selectedImageCardPanelItem.id] ?? IMAGE_CARD_SIZE_OPTIONS[0].id
          );
          recordCurrentCanvasUndoSnapshot();
          setImageCardProviderById((prev) => ({
            ...prev,
            [selectedImageCardPanelItem.id]: nextModel?.providerId || selectedImageCardProviderId,
          }));
          setImageCardModelById((prev) => ({
            ...prev,
            [selectedImageCardPanelItem.id]: resolvedModelId,
          }));
          setImageCardSizeById((prev) => ({
            ...prev,
            [selectedImageCardPanelItem.id]: resolvedSizeId,
          }));
          setShowImageCardModelMenu(false);
        }}
        onToggleImageCardQualityMenu={() => {
          setShowImageCardModelMenu(false);
          setShowImageCardCountMenu(false);
          setShowImageCardQualityMenu((prev) => !prev);
        }}
        onSelectImageCardSize={(sizeId) => {
          if (!selectedImageCardPanelItem) return;
          const resolvedSizeId = resolveImageCardSize(selectedImageCardPanelModelId, sizeId);
          recordCurrentCanvasUndoSnapshot();
          setImageCardSizeById((prev) => ({
            ...prev,
            [selectedImageCardPanelItem.id]: resolvedSizeId,
          }));
          setShowImageCardResolutionMenu(false);
        }}
        onToggleImageCardAspectRatioMenu={() => {
          setShowImageCardModelMenu(false);
          setShowImageCardResolutionMenu(false);
          setShowImageCardQualityMenu(false);
          setShowImageCardCountMenu(false);
          setShowImageCardAspectRatioMenu((prev) => !prev);
        }}
        onToggleImageCardResolutionMenu={() => {
          setShowImageCardModelMenu(false);
          setShowImageCardAspectRatioMenu(false);
          setShowImageCardQualityMenu(false);
          setShowImageCardCountMenu(false);
          setShowImageCardResolutionMenu((prev) => !prev);
        }}
        onSelectImageCardQuality={(qualityId) => {
          if (!selectedImageCardPanelItem) return;
          recordCurrentCanvasUndoSnapshot();
          setImageCardQualityById((prev) => ({
            ...prev,
            [selectedImageCardPanelItem.id]: qualityId,
          }));
          setShowImageCardQualityMenu(false);
        }}
        onToggleImageCardCountMenu={() => {
          setShowImageCardModelMenu(false);
          setShowImageCardAspectRatioMenu(false);
          setShowImageCardResolutionMenu(false);
          setShowImageCardQualityMenu(false);
          setShowImageCardCountMenu((prev) => !prev);
        }}
        onSelectImageCardCount={(count) => {
          if (!selectedImageCardPanelItem) return;
          recordCurrentCanvasUndoSnapshot();
          setImageCardCountById((prev) => ({
            ...prev,
            [selectedImageCardPanelItem.id]: count,
          }));
          setShowImageCardCountMenu(false);
        }}
        onSelectImageCardAspectRatio={(aspectRatioId) => {
          if (!selectedImageCardPanelItem) return;
          const normalizedAspectRatio = normalizeImageCardAspectRatio(aspectRatioId);
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
          setShowImageCardAspectRatioMenu(false);
        }}
        onSelectedImageCardPanelInputChange={handleSelectedImageCardPanelInputChange}
        onSelectedImageCardPanelBlur={commitPendingCanvasUndoSnapshot}
        onSelectedImageCardPanelSubmit={handleSelectedImageCardPanelSubmit}
        onSelectedImageCardPanelCancel={() => handleCancelCanvasImageGenerate(selectedImageCardPanelItem?.id ?? null)}
        onItemDoubleClick={handleTextCardDoubleClick}
        onManualTextCardInputChange={handleManualTextCardInputChange}
        onManualTextCardBlur={finalizeManualTextCardEditing}
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
        selectedImageToolbarAnchor &&
        selectedImageToolbarTop !== null &&
        createPortal(
          <div className="pointer-events-none fixed inset-0 z-[114]">
            <div
            data-image-node-toolbar="true"
            className="workspace-menu-panel pointer-events-auto fixed flex items-center gap-1 rounded-full px-2 py-1.5"
            style={{
                left: selectedImageToolbarAnchor.x,
                top: selectedImageToolbarTop - 12 * viewport.scale,
                transform: `translate(-50%, -100%) scale(${viewport.scale})`,
                transformOrigin: 'top center',
              }}
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
              className="absolute inset-0 bg-black/40 backdrop-blur-sm"
              aria-label="关闭供应商配置"
              onClick={closeProviderSettingsModal}
            />
            <div
              className="workspace-popover-panel relative z-[1] flex max-h-[min(88vh,760px)] w-full max-w-[920px] flex-col overflow-hidden rounded-[28px] backdrop-blur-xl"
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
                  className="rounded-full border border-[var(--workspace-border)] bg-[var(--workspace-surface-soft)] p-2 text-[var(--workspace-text-muted)] transition-colors hover:bg-[var(--workspace-control-hover)] hover:text-[var(--workspace-text-primary)]"
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
                    <div className="space-y-2">
                      <div className="workspace-text-muted text-[11px] font-medium uppercase tracking-[0.18em]">Providers</div>
                      <div className="workspace-menu-panel rounded-[18px] p-1.5">
                        {providerSettingsProviders.map((provider) => {
                          const isSelected = provider.id === selectedProviderSettings.id;

                          return (
                            <button
                              key={provider.id}
                              type="button"
                              className={`workspace-menu-item flex w-full flex-col items-start rounded-[14px] px-3 py-2.5 text-left ${
                                isSelected ? 'is-selected' : ''
                              }`}
                              onClick={() => handleProviderSettingsProviderChange(provider.id)}
                            >
                              <span className="text-[13px] font-semibold tracking-[-0.02em]">{provider.name || getProviderSettingsProviderLabel(provider.id)}</span>
                              <span className="workspace-text-muted mt-1 max-w-full truncate text-[11px]">{provider.protocol} · {provider.primary ? '主供应商' : '备用'}</span>
                            </button>
                          );
                        })}
                      </div>
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
                            className="w-full rounded-2xl border border-[var(--workspace-border)] bg-[var(--workspace-surface-soft)] px-4 py-3 text-[14px] text-[var(--workspace-text-primary)] outline-none transition-colors placeholder:text-[var(--workspace-text-soft)] focus:border-[var(--workspace-border-strong)] focus:bg-[var(--workspace-surface-elevated)]"
                          />
                        </label>
                        <label className="block">
                          <div className="mb-2 text-[12px] font-medium">ID</div>
                          <input
                            value={selectedProviderSettings.id}
                            disabled
                            className="w-full rounded-2xl border border-[var(--workspace-border)] bg-[var(--workspace-surface-soft)] px-4 py-3 text-[14px] text-[var(--workspace-text-muted)] outline-none"
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
                          className="w-full rounded-2xl border border-[var(--workspace-border)] bg-[var(--workspace-surface-soft)] px-4 py-3 text-[14px] text-[var(--workspace-text-primary)] outline-none transition-colors placeholder:text-[var(--workspace-text-soft)] focus:border-[var(--workspace-border-strong)] focus:bg-[var(--workspace-surface-elevated)]"
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
                              className="w-full appearance-none rounded-2xl border border-[var(--workspace-border)] bg-[var(--workspace-surface-soft)] px-4 py-3 text-[14px] text-[var(--workspace-text-primary)] outline-none transition-colors focus:border-[var(--workspace-border-strong)] focus:bg-[var(--workspace-surface-elevated)]"
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
                              className="w-full appearance-none rounded-2xl border border-[var(--workspace-border)] bg-[var(--workspace-surface-soft)] px-4 py-3 text-[14px] text-[var(--workspace-text-primary)] outline-none transition-colors focus:border-[var(--workspace-border-strong)] focus:bg-[var(--workspace-surface-elevated)]"
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
                            className="w-full rounded-2xl border border-[var(--workspace-border)] bg-[var(--workspace-surface-soft)] px-4 py-3 text-[14px] text-[var(--workspace-text-primary)] outline-none transition-colors placeholder:text-[var(--workspace-text-soft)] focus:border-[var(--workspace-border-strong)] focus:bg-[var(--workspace-surface-elevated)]"
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
                            className="w-full rounded-2xl border border-[var(--workspace-border)] bg-[var(--workspace-surface-soft)] px-4 py-3 text-[14px] text-[var(--workspace-text-primary)] outline-none transition-colors placeholder:text-[var(--workspace-text-soft)] focus:border-[var(--workspace-border-strong)] focus:bg-[var(--workspace-surface-elevated)]"
                          />
                        </label>
                      </div>

                      <label className="block">
                        <div className="mb-2 flex items-center justify-between gap-3 text-[12px] font-medium">
                          <span>API Key</span>
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
                            className="w-full rounded-2xl border border-[var(--workspace-border)] bg-[var(--workspace-surface-soft)] px-4 py-3 pr-11 text-[14px] text-[var(--workspace-text-primary)] outline-none transition-colors placeholder:text-[var(--workspace-text-soft)] focus:border-[var(--workspace-border-strong)] focus:bg-[var(--workspace-surface-elevated)]"
                          />
                          <button
                            type="button"
                            onClick={() => {
                              setIsProviderSettingsApiKeyVisible((prev) => !prev);
                            }}
                            className="workspace-text-muted absolute right-3 top-1/2 inline-flex -translate-y-1/2 items-center justify-center rounded-full p-1.5 transition-colors hover:bg-[var(--workspace-control-hover)] hover:text-[var(--workspace-text-primary)]"
                            aria-label={isProviderSettingsApiKeyVisible ? '隐藏 API Key' : '显示 API Key'}
                            title={isProviderSettingsApiKeyVisible ? '隐藏 API Key' : '显示 API Key'}
                          >
                            {isProviderSettingsApiKeyVisible ? <EyeOff size={16} /> : <Eye size={16} />}
                          </button>
                        </div>
                      </label>

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
                            className="rounded-full border border-[var(--workspace-border)] px-3 py-1.5 text-[12px] font-medium text-[var(--workspace-text-muted)] transition-colors hover:bg-[var(--workspace-control-hover)] hover:text-[var(--workspace-text-primary)] disabled:cursor-not-allowed disabled:opacity-50"
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
                                    <button
                                      type="button"
                                      className="workspace-text-muted inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-[var(--workspace-control-hover)] hover:text-red-500"
                                      onClick={() => {
                                        handleProviderSettingsRemoveModel('image', model.id);
                                      }}
                                      aria-label={`移除图片模型 ${model.id}`}
                                      title={`移除图片模型 ${model.id}`}
                                    >
                                      <Trash2 size={13} />
                                    </button>
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
                                    <button
                                      type="button"
                                      className="workspace-text-muted inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-[var(--workspace-control-hover)] hover:text-red-500"
                                      onClick={() => {
                                        handleProviderSettingsRemoveModel('chat', model.id);
                                      }}
                                      aria-label={`移除聊天模型 ${model.id}`}
                                      title={`移除聊天模型 ${model.id}`}
                                    >
                                      <Trash2 size={13} />
                                    </button>
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
                            className="rounded-full border border-[var(--workspace-border)] px-3 py-1.5 text-[12px] font-medium text-[var(--workspace-text-muted)] transition-colors hover:bg-[var(--workspace-control-hover)] hover:text-[var(--workspace-text-primary)]"
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
                            className="rounded-full border border-[var(--workspace-border)] px-3 py-1.5 text-[12px] font-medium text-[var(--workspace-text-muted)] transition-colors hover:bg-[var(--workspace-control-hover)] hover:text-[var(--workspace-text-primary)] disabled:cursor-not-allowed disabled:opacity-50"
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
                    className="absolute inset-0 bg-black/30 backdrop-blur-sm"
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
                          className="rounded-full border border-[var(--workspace-border)] px-3 py-1.5 text-[12px] font-medium text-[var(--workspace-text-muted)] transition-colors hover:bg-[var(--workspace-control-hover)] hover:text-[var(--workspace-text-primary)]"
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
                        className="mb-3 w-full shrink-0 rounded-2xl border border-[var(--workspace-border)] bg-[var(--workspace-surface-soft)] px-4 py-2.5 text-[13px] text-[var(--workspace-text-primary)] outline-none transition-colors placeholder:text-[var(--workspace-text-soft)] focus:border-[var(--workspace-border-strong)] focus:bg-[var(--workspace-surface-elevated)]"
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
                          className="rounded-full bg-[var(--workspace-inverse-bg)] px-4 py-2 text-[13px] font-semibold text-[var(--workspace-inverse-fg)] transition-colors hover:opacity-90"
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
                  className="rounded-full border border-[var(--workspace-border)] px-4 py-2 text-[13px] font-medium text-[var(--workspace-text-muted)] transition-colors hover:bg-[var(--workspace-control-hover)] hover:text-[var(--workspace-text-primary)]"
                  onClick={closeProviderSettingsModal}
                  disabled={providerSettingsSaving}
                >
                  取消
                </button>
                <button
                  type="button"
                  className="rounded-full bg-[var(--workspace-inverse-bg)] px-4 py-2 text-[13px] font-semibold text-[var(--workspace-inverse-fg)] transition-colors hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
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

      {imageToolbarNotice && (
        <div
          className="pointer-events-none fixed inset-x-0 top-4 flex justify-center px-4"
          style={{ zIndex: GLOBAL_NOTICE_Z }}
        >
          <div className="workspace-floating-control rounded-full px-4 py-2 text-[12px] font-medium tracking-[-0.02em] backdrop-blur-xl">
            {imageToolbarNotice}
          </div>
        </div>
      )}

      {/* Zoom Controller - Outside Canvas */}
      <div className="workspace-floating-control absolute left-4 bottom-4 z-50 flex items-center gap-2 rounded-xl p-1.5 backdrop-blur-xl">
        <button 
          className="workspace-text-muted rounded-md p-1.5 hover:bg-[var(--workspace-control-hover)] hover:text-[var(--workspace-text-primary)]"
          onClick={() => applyViewportScale(viewport.scale - 0.1)}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        </button>
        <span className="min-w-[3rem] text-center text-xs font-medium">
          {Math.round(viewport.scale * 100)}%
        </span>
        <button 
          className="workspace-text-muted rounded-md p-1.5 hover:bg-[var(--workspace-control-hover)] hover:text-[var(--workspace-text-primary)]"
          onClick={() => applyViewportScale(viewport.scale + 0.1)}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        </button>
      </div>

      {/* Right Chat Panel */}
      {typeof document !== 'undefined' &&
        createPortal(
          sidebarCollapsed ? (
            <div
              className="workspace-floating-control fixed right-4 top-4 isolate flex h-9 w-9 items-center justify-center rounded-xl transition-all duration-300"
              style={{ zIndex: CHAT_PANEL_Z }}
            >
              <button 
                className="p-1 transition-colors hover:text-[var(--workspace-text-primary)]"
                onClick={() => setSidebarCollapsed(false)}
                title="展开对话"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="15 18 9 12 15 6" />
                </svg>
              </button>
            </div>
          ) : (
            <div
              className="workspace-chat-panel fixed inset-y-4 left-4 right-4 isolate flex w-auto flex-col overflow-hidden rounded-[28px] backdrop-blur-xl transition-all duration-300 sm:left-auto sm:w-[480px]"
              style={{ zIndex: CHAT_PANEL_Z }}
            >
          {/* Header */}
          <div className="workspace-subtle-divider flex flex-shrink-0 items-center justify-between border-b px-6 py-4">
            <div className="flex items-center gap-3">
              <h1 className="text-base font-medium">{currentProjectName}</h1>
            </div>
            <div className="flex items-center gap-1">
              <button className="rounded-lg p-2 transition-colors hover:bg-[var(--workspace-control-hover)]" title="分享">
                <Share2 size={18} className="workspace-text-muted" />
              </button>
              <div className="relative">
                <button 
                  className={`rounded-lg p-2 transition-colors ${showHistoryPanel ? 'bg-[var(--workspace-control-active)]' : 'hover:bg-[var(--workspace-control-hover)]'}`} 
                  title="历史"
                  onClick={() => setShowHistoryPanel(!showHistoryPanel)}
                >
                  <History size={18} className={showHistoryPanel ? "workspace-text-primary" : "workspace-text-muted"} />
                </button>
              </div>
              <button
                className="rounded-lg p-2 transition-colors hover:bg-[var(--workspace-control-hover)]"
                title="设置"
                onClick={openProviderSettingsModal}
              >
                <Settings size={18} className="workspace-text-muted" />
              </button>
              <button 
                className="rounded-lg p-2 transition-colors hover:bg-[var(--workspace-control-hover)]" 
                title="收缩"
                onClick={() => setSidebarCollapsed(true)}
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
                  className="flex w-full items-center justify-center gap-2 rounded-xl border border-[var(--workspace-border)] bg-[var(--workspace-inverse-bg)] px-3 py-2 text-[var(--workspace-inverse-fg)] transition-colors hover:opacity-90"
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
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={(e) => deleteTopic(topic.id, e)}
                        className="rounded-lg p-1.5 transition-colors hover:bg-red-500/10"
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
                  <div className="text-center mb-8">
                    <h2 className="mb-2 text-xl font-medium">你好，我是 Levert Skills</h2>
                    <p className="workspace-text-muted text-sm">描述你的设计需求，我来帮你实现</p>
                  </div>
                  <div className="flex justify-center">
                    <div className="flex flex-col gap-1.5">
                      <div className="flex gap-1.5 justify-center">
                        {quickActions.slice(0, 3).map((action) => (
                          <button
                            key={action.id}
                            onClick={() => handleQuickSkillSelect(action, 'center_quick_action')}
                            className="workspace-token-chip flex items-center gap-1.5 rounded-full px-2 py-1.5 transition-colors"
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
                            className="workspace-token-chip flex items-center gap-1.5 rounded-full px-2 py-1.5 transition-colors"
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
            <div ref={chatContainerRef} className="panel-scrollbar flex-1 overflow-y-auto px-6 py-4">
              <div className="space-y-4">
                {chatMessages.map((msg) => (
                <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  {msg.role === 'user' ? (
                    <div className="flex flex-col items-end max-w-[90%]">
                      {msg.skill && (
                        <div className="workspace-token-chip mb-[10px] flex w-fit items-center gap-0.5 rounded-md px-1 py-0.5">
                          <Sparkles size={8} className="flex-shrink-0" />
                          <span className="text-[10px] font-bold leading-none">{msg.skill.label}</span>
                        </div>
                      )}
                      {msg.referenceImages && msg.referenceImages.length > 0 && (
                        <div className="w-full flex justify-end mb-2">
                          <div className="flex flex-wrap justify-end gap-2">
                            {msg.referenceImages.map((img, index) => (
                              <div key={`${msg.id}-ref-${index}`} className="relative h-16 w-16">
                                <Image
                                  src={img}
                                  alt={`参考图 image${index + 1}`}
                                  fill
                                  unoptimized
                                  sizes="64px"
                                  className="rounded-md border border-[var(--workspace-border)] object-cover"
                                />
                                <span className="absolute left-0 top-0 px-1 py-0.5 rounded-br-md rounded-tl-md bg-black/75 text-white text-[9px] leading-none">
                                  {`image${index + 1}`}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                      <div
                        className="workspace-message-user panel-scrollbar overflow-y-auto rounded-[22px] p-4"
                        style={{ maxHeight: '240px' }}
                      >
                        <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
                      </div>
                    </div>
                  ) : msg.role === 'skill' ? (
                    <div className="workspace-message-assistant group relative flex max-w-[90%] items-center gap-2 rounded-2xl p-3">
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
                        className="absolute -right-2 -top-2 flex h-5 w-5 items-center justify-center rounded-full border border-[var(--workspace-border)] bg-[var(--workspace-surface-elevated)] text-xs opacity-0 transition-opacity group-hover:opacity-100 hover:bg-[var(--workspace-control-hover)]"
                      >
                        ×
                      </button>
                    </div>
                  ) : (
                    <div className="workspace-message-assistant group relative max-w-[90%] rounded-[22px] px-3.5 py-3">
                      {msg.content && !(msg.content === '...' && msg.taskStatus === 'running') && (
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
                          className="workspace-control-chip absolute right-3 top-3 z-[2] inline-flex h-7 items-center gap-1 rounded-lg px-2 text-[11px] opacity-0 transition-opacity duration-200 group-hover:opacity-100"
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
                      {msg.taskStatus && (
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
                      {msg.reasoningContent && (
                        <details className="mb-1.5 text-[11px] text-zinc-500">
                          <summary className="cursor-pointer select-none">模型推理</summary>
                          <div
                            data-assistant-selectable="true"
                            className="assistant-selectable relative z-[1] mt-0.5 pointer-events-auto"
                            onPointerDown={handleAssistantSelectablePointerDown}
                            onMouseDown={handleAssistantSelectableMouseDown}
                            onClick={handleAssistantSelectableClick}
                          >
                            <p className="whitespace-pre-wrap">{msg.reasoningContent}</p>
                          </div>
                        </details>
                      )}
                      {msg.content === '...' && msg.taskStatus === 'running' ? (
                        <p className="text-sm whitespace-pre-wrap inline-flex items-center gap-1" aria-label="加载中">
                          <span className="w-1.5 h-1.5 rounded-full bg-zinc-400 animate-bounce [animation-delay:0ms]" />
                          <span className="w-1.5 h-1.5 rounded-full bg-zinc-400 animate-bounce [animation-delay:150ms]" />
                          <span className="w-1.5 h-1.5 rounded-full bg-zinc-400 animate-bounce [animation-delay:300ms]" />
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
                      )}
                      {msg.skillChoice && !msg.skillChoiceResolved && (
                        <div className="mt-2.5">
                          <button
                            onClick={() => openSkillChoiceModal(msg.skillChoice as SkillChoicePayload)}
                            className="workspace-control-chip inline-flex items-center rounded-full px-3 py-1 text-xs"
                          >
                            重新选择
                          </button>
                        </div>
                      )}
                      {msg.imageName && <div className="mb-1.5 text-sm font-medium text-zinc-200">{msg.imageName}</div>}
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
                      {msg.model && <div className="mt-1.5 text-xs text-zinc-500">模型: {msg.model}</div>}
                    </div>
                  )}
                </div>
                ))}
              </div>
            </div>
          )}

          {showSkillChoiceModal && pendingSkillChoice && (
            <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/30 px-4">
              <div className="workspace-popover-panel w-full max-w-md rounded-[24px] p-5">
                <div className="mb-1 text-base font-semibold">{pendingSkillChoice.title}</div>
                {pendingSkillChoice.message && (
                  <p className="workspace-text-muted mb-4 whitespace-pre-wrap text-sm">{pendingSkillChoice.message}</p>
                )}
                <div className="space-y-2">
                  {pendingSkillChoice.options.map((option, index) => (
                    <button
                      key={`${pendingSkillChoice.id}-option-${index}`}
                      onClick={() => handleSubmitSkillChoice(pendingSkillChoice, option)}
                      className="w-full rounded-xl border border-[var(--workspace-border)] px-3 py-2 text-left text-sm hover:bg-[var(--workspace-control-hover)]"
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
                <div className="mt-4 flex justify-end">
                  <button
                    onClick={handleCloseSkillChoiceModal}
                    className="rounded-lg border border-[var(--workspace-border)] px-3 py-1.5 text-xs text-[var(--workspace-text-muted)] hover:bg-[var(--workspace-control-hover)]"
                  >
                    稍后再选
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Reference Images */}
          {chatReferenceImages.length > 0 && (
            <div className="workspace-divider-dark flex-shrink-0 border-t px-4 py-2">
              <div className="flex flex-wrap gap-2">
                {chatReferenceImages.map((img, index) => (
                  <div
                    key={index}
                    draggable
                    onDragStart={() => handleReferenceDragStart(index)}
                    onDragOver={(e) => handleReferenceDragOver(e, index)}
                    onDrop={(e) => handleReferenceDrop(e, index)}
                    onDragEnd={handleReferenceDragEnd}
                    className={`relative h-14 w-14 group cursor-move transition-all ${draggingImageIndex === index ? 'opacity-50' : ''} ${dragOverImageIndex === index ? 'rounded-md ring-1 ring-zinc-100' : ''}`}
                  >
                    <Image
                      src={img}
                      alt={`参考图 ${index + 1}`}
                      fill
                      unoptimized
                      sizes="56px"
                      className="rounded-md border border-white/10 object-cover"
                    />
                    <span className="absolute left-0 top-0 px-1 py-0.5 rounded-br-md rounded-tl-md bg-black/75 text-white text-[9px] leading-none">
                      {`image${index + 1}`}
                    </span>
                    <button onClick={() => removeChatImage(index)} className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 text-white rounded-full text-xs flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">×</button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Input Bar */}
          <div className="p-4 flex-shrink-0">
            <input ref={chatFileInputRef} type="file" accept="image/*" multiple className="hidden" onChange={handleChatImageUpload} />
            <div className="workspace-chat-input flex flex-col rounded-[24px]">
              <div
                className="px-4 py-3"
                onClick={() => chatInputEditorRef.current?.focus()}
              >
                <div className="relative min-w-[120px]">
                  <div
                    ref={chatInputEditorRef}
                    contentEditable
                    suppressContentEditableWarning
                    onInput={handleChatEditorInput}
                    onPaste={handleChatPaste}
                    onKeyDown={handleChatEditorKeyDown}
                    onFocus={() => setChatInputFocused(true)}
                    onBlur={() => setChatInputFocused(false)}
                    className="panel-scrollbar w-full overflow-y-auto bg-transparent text-sm leading-5 outline-none whitespace-pre-wrap break-words"
                    style={{ minHeight: '24px', maxHeight: '240px', height: `${chatInputHeight}px` }}
                  />
                  {!chatInput.trim() && !activeSkill && !chatInputFocused && (
                    <span className="workspace-text-muted pointer-events-none absolute left-0 top-0 text-sm leading-5">
                      请输入你的设计需求
                    </span>
                  )}
                </div>
              </div>
              <div className="workspace-subtle-divider flex items-center justify-between rounded-b-[24px] border-t px-4 py-2">
                <div className="flex items-center gap-2">
                  <button className="workspace-control-chip inline-flex h-7 w-7 items-center justify-center rounded-full" onClick={() => chatFileInputRef.current?.click()} title="上传参考图">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" /></svg>
                  </button>
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
                      onClick={(e) => {
                        e.stopPropagation();
                        setShowSkillsMenu((prev) => !prev);
                      }}
                      disabled={isGenerating}
                      className={`workspace-control-chip flex items-center gap-1 rounded-full px-2 py-1 text-xs font-medium ${showSkillsMenu ? 'is-active' : ''}`}
                    >
                      <Sparkles size={12} />
                      <span>Skills</span>
                    </button>
                  </div>
                  <div className="relative" ref={generationModeMenuRef}>
                    {showGenerationModeMenu && (
                      <div className="workspace-menu-panel absolute bottom-full left-0 z-20 mb-2 min-w-[80px] rounded-2xl p-1">
                        {[
                          { id: 'auto' as const, label: '默认' },
                          { id: 'image' as const, label: '生图' },
                          { id: 'chat' as const, label: '对话' },
                        ].map((option) => (
                          <button
                            key={option.id}
                            onClick={() => {
                              setGenerationMode(option.id);
                              setShowGenerationModeMenu(false);
                              if (option.id !== 'image') {
                                setShowAspectRatioMenu(false);
                              }
                            }}
                            className={`workspace-menu-item w-full rounded-xl border border-transparent px-3 py-1.5 text-left text-xs ${generationMode === option.id ? 'is-selected' : ''}`}
                          >
                            {option.label}
                          </button>
                        ))}
                      </div>
                    )}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setShowGenerationModeMenu((prev) => !prev);
                      }}
                      disabled={isGenerating}
                      className={`workspace-control-chip flex items-center gap-1 rounded-full px-2 py-1 text-xs font-medium ${showGenerationModeMenu ? 'is-active' : ''}`}
                    >
                      <SlidersHorizontal size={12} />
                      <span>{generationMode === 'auto' ? '默认' : generationMode === 'image' ? '生图' : '对话'}</span>
                    </button>
                  </div>
                  {generationMode === 'image' && (
                    <div className="relative" ref={aspectRatioMenuRef}>
                      {showAspectRatioMenu && (
                        <div className="workspace-menu-panel absolute bottom-full left-0 z-20 mb-2 min-w-[180px] rounded-2xl p-1">
                          {ASPECT_RATIOS.map((option) => (
                            <button
                              key={option.id}
                              onClick={() => {
                                setImageAspectRatio(option.id);
                                setShowAspectRatioMenu(false);
                              }}
                              className={`workspace-menu-item w-full rounded-xl border border-transparent px-3 py-1.5 text-left text-xs ${
                                imageAspectRatio === option.id ? 'is-selected' : ''
                              }`}
                            >
                              {option.name}
                            </button>
                          ))}
                        </div>
                      )}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setShowAspectRatioMenu((prev) => !prev);
                        }}
                        disabled={isGenerating}
                        className={`workspace-control-chip flex items-center gap-1 rounded-full px-2 py-1 text-xs font-medium ${showAspectRatioMenu ? 'is-active' : ''}`}
                      >
                        <span>
                          {ASPECT_RATIOS.find((item) => item.id === imageAspectRatio)?.name || imageAspectRatio}
                        </span>
                      </button>
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={isGenerating ? handleCancelGenerate : () => { void handleGenerate(); }}
                    disabled={!isGenerating && !chatInput.trim()}
                    title={isGenerating ? '终止任务' : '发送'}
                    className="workspace-add-button ml-1 rounded-xl p-1.5 transition-colors disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {isGenerating ? (
                      <svg className="animate-spin" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <circle cx="12" cy="12" r="9" opacity="0.25" />
                        <path d="M21 12a9 9 0 0 1-9 9" />
                      </svg>
                    ) : (
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" /></svg>
                    )}
                  </button>
                </div>
              </div>
            </div>
          </div>
            </div>
          ),
          document.body
        )}
      <style jsx global>{`
        .panel-scrollbar {
          scrollbar-width: thin;
          scrollbar-color: rgba(161, 161, 170, 0.34) rgba(255, 255, 255, 0.04);
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
  );
}
