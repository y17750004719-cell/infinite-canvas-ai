import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { POST as generatePost } from '../generate/route';
import { chat, chatStream } from '../../lib/api-client';
import { optimizeImagePrompt } from '../../lib/agent/image-pipeline.mjs';
import {
  applyImagePromptDeliveryContract,
  resolveAgentConversationIntent,
  resolveImageDeliveryPlan,
} from '../../lib/agent/prompt-optimizer.mjs';
import {
  listSkillManifests,
  loadSkillContent,
  selectSkillForPrompt,
} from '../../lib/agent/skill-registry.mjs';
import { buildMainAgentMessages } from '../../lib/agent/main-agent.mjs';
import { routeAgentRequest } from '../../lib/agent/skill-router.mjs';
import {
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
  runAgentLoop,
} from '../../lib/agent/agent-loop.mjs';
import { createAgentToolRegistry, executeAgentTool, getAgentModelTools } from '../../lib/agent/tool-registry.mjs';
import { createSkillJob, getSkillJob, toJobSummary } from '../../lib/skill-jobs';
import { readProviderRegistry } from '../../lib/provider-config.mjs';
import { resolveProviderModelSelection } from '../../lib/provider-model-selection.mjs';
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
  ensureOptimizedPromptCoverage,
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
  AgentPlannerSourceDetail,
} from '../../lib/agent/execution-planner.types';
import type {
  AgentClarificationRequest,
  AgentClarificationState,
  AgentEvent,
  AgentProgressPhase,
  AgentProgressStatus,
  AgentProgressStepId,
} from '../../lib/agent/events';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_AGENT_TURNS = 6;
const MAX_TOOL_CALLS = 4;
const DEFAULT_AGENT_MODEL = 'gemini-3.1-flash-lite-preview-thinking-medium';
const CONFIRMATION_TTL_MS = 10 * 60 * 1000;
const encoder = new TextEncoder();

type ConfirmationRecord = {
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
  requestedTotalImageCount?: number;
  imageBatchPlan?: AgentImageBatchPlan;
  nextConfirmationId?: string;
  imageBatchMode?: AgentImageBatchMode;
  imageDeliveryPlan?: ImageDeliveryPlan;
  generationItems?: AgentImageGenerationItem[];
  remainingGenerationItems?: AgentImageGenerationItem[];
  optimizePrompt?: boolean;
  generationBrief?: string;
  executionBrief?: ExecutionBrief;
  expiresAt: number;
  execution?: Promise<Record<string, unknown>>;
  result?: Record<string, unknown>;
};

type AgentImageCountSource = 'clarification' | 'prompt' | 'interface' | 'default' | 'batch';
type AgentImageBatchMode = 'series' | 'variants' | 'composite';
type ImageDeliveryPlan = ReturnType<typeof resolveImageDeliveryPlan>;

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

const agentGlobals = globalThis as unknown as {
  __agentConfirmationStore?: Map<string, ConfirmationRecord>;
  __agentClarificationSubmissionStore?: Map<string, number>;
};
const confirmationStore = agentGlobals.__agentConfirmationStore || new Map<string, ConfirmationRecord>();
agentGlobals.__agentConfirmationStore = confirmationStore;
const clarificationSubmissionStore = agentGlobals.__agentClarificationSubmissionStore || new Map<string, number>();
agentGlobals.__agentClarificationSubmissionStore = clarificationSubmissionStore;

type AgentRequestBody = {
  runId?: string;
  topicId?: string;
  messages?: Array<{ role: 'user' | 'assistant'; content: string }>;
  activeSkillId?: string;
  referenceImages?: string[];
  contextEntities?: AgentContextEntity[];
  selectedContextEntityIds?: string[];
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
  };
};

function writeEvent(controller: ReadableStreamDefaultController, event: AgentEvent) {
  controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
}

function getLatestUserMessage(messages: AgentRequestBody['messages']) {
  return [...(messages || [])].reverse().find((message) => message.role === 'user')?.content?.trim() || '';
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

  const runId = typeof body.runId === 'string' && body.runId.trim()
    ? body.runId.trim()
    : `agent-${Date.now()}`;
  const latestUserMessage = getLatestUserMessage(body.messages);
  if (!latestUserMessage) {
    return NextResponse.json({ error: 'A user message is required' }, { status: 400 });
  }
  const unifiedPlannerEnabled = process.env.AGENT_UNIFIED_PLANNER_ENABLED !== '0';
  const plannerShadowMode = process.env.AGENT_PLANNER_SHADOW_MODE === '1';
  const plannerAuthoritative = unifiedPlannerEnabled && !plannerShadowMode;
  const conversationIntent = plannerAuthoritative
    ? { intent: 'chat' as const, brief: latestUserMessage, inherited: false, needsDirectionConfirmation: false }
    : resolveAgentConversationIntent(
        body.messages,
        Boolean(body.referenceImages?.length),
      );
  const contextEntities = Array.isArray(body.contextEntities)
    ? body.contextEntities.filter((entity) => entity && typeof entity.id === 'string').slice(-200)
    : [];
  const selectedContextEntityIds = Array.isArray(body.selectedContextEntityIds)
    ? body.selectedContextEntityIds.filter((id): id is string => typeof id === 'string').slice(0, 8)
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
  const explicitBatchImageRequest = !body.activeSkillId
    && (
      conversationIntent.intent === 'image'
      || isPotentialDesignExecutionRequest(initialBriefSource)
    )
    && initialDeliveryPlan.outputCount > 1;
  const shouldResolveInitialContext = !explicitBatchImageRequest
    || selectedContextEntityIds.length > 0
    || isReferentialShorthand(latestUserMessage);
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
    topicId: body.topicId || 'default',
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
  const deterministicImageSkill = !plannerAuthoritative && !body.activeSkillId
    && (
      conversationIntent.intent === 'image'
      || isPotentialDesignExecutionRequest(initialBriefSource)
    )
    ? selectSkillForPrompt(
        initialBriefSource,
        skillManifests.filter((manifest) => manifest.executionMode === 'image_pipeline'),
      )
    : null;

  const providers = (await readProviderRegistry()).providers;
  const providerImageOptionProfiles = buildProviderImageOptionProfiles(providers);
  const requestedInterfaceImageCount = normalizeAgentImageCount(body.imageOptions?.count);
  const requestedChatModel = body.chatOptions?.model || process.env.AGENT_CHAT_MODEL || DEFAULT_AGENT_MODEL;
  const resolvedChatSelection = resolveProviderModelSelection({
    providers,
    purpose: 'chat',
    requestedProviderId: body.chatOptions?.providerId || process.env.AGENT_CHAT_PROVIDER_ID,
    requestedModel: requestedChatModel,
  });
  if (!resolvedChatSelection.model || !resolvedChatSelection.providerId) {
    return NextResponse.json({ error: 'No enabled chat provider and model are configured' }, { status: 400 });
  }
  const requestedRouterSelection = resolveProviderModelSelection({
    providers,
    purpose: 'chat',
    requestedProviderId: process.env.AGENT_ROUTER_PROVIDER_ID || resolvedChatSelection.providerId || undefined,
    requestedModel: process.env.AGENT_ROUTER_MODEL || resolvedChatSelection.model,
  });
  const resolvedRouterSelection = requestedRouterSelection.reason === 'exact'
    ? requestedRouterSelection
    : resolvedChatSelection;

  const timeoutMs = Math.min(300_000, Math.max(10_000, Number(process.env.AGENT_RUN_TIMEOUT_MS) || 180_000));
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const runSignal = AbortSignal.any([request.signal, timeoutSignal]);
  const stream = new ReadableStream({
    async start(controller) {
      let toolCalls = 0;
      let turns = 0;
      let skillSource: 'manual' | 'auto' | null = body.activeSkillId ? 'manual' : null;
      let intent: 'chat' | 'image' | 'skill_action' = 'chat';
      let selectedSkill = body.activeSkillId
        ? skillManifests.find((manifest) => manifest.id === body.activeSkillId) || null
        : null;
      let skillContent = '';
      let contextResolution = structuredClone(initialContextResolution) as AgentContextResolution;
      let executionBriefData = structuredClone(initialExecutionBrief) as ExecutionBrief;
      let executionBrief = executionBriefData.plainText;
      let executionReferenceImages = [...(body.referenceImages || [])];
      let activeClarificationState = body.clarificationState
        ? structuredClone(body.clarificationState)
        : null;
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
      let executionPlan: AgentExecutionPlan | null = activeClarificationState?.executionPlan || null;
      let executionPlanSource: 'model' | 'fallback' | null = executionPlan ? 'model' : null;
      let executionPlanSourceDetail: AgentPlannerSourceDetail | null = executionPlan ? 'tool_call' : null;
      let executionKind: AgentExecutionPlan['execution']['kind'] | null = executionPlan?.execution.kind || null;
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
        optimizePrompt = true,
        imageOptions = body.imageOptions,
        referenceImages = body.referenceImages,
        generationPrompt = sourcePrompt,
        countMetadata?: { source?: AgentImageCountSource; totalCount?: number },
        generationItems: AgentImageGenerationItem[] = [],
        streamOptions?: { enabled?: boolean; toolCallId?: string },
        deliveryPlan?: ImageDeliveryPlan,
      ) => {
        const payloadOutputCount = normalizeAgentImageCount(imageOptions?.count);
        const payloadDeliveryPlan = deliveryPlan
          || (executionPlan
            ? executionPlanToImageDeliveryPlan(executionPlan) as ImageDeliveryPlan
            : resolveImageDeliveryPlan(sourcePrompt, payloadOutputCount));
        const payloadBatchMode = payloadDeliveryPlan.mode;
        if (optimizePrompt && process.env.PROMPT_PIPELINE_AGENT_ENABLED !== '0') {
          writeProgress({ stepId: 'prompt_optimization', phase: 'optimizing', status: 'active', label: '正在优化图片提示词' });
        }
        const optimizedResult = optimizePrompt && process.env.PROMPT_PIPELINE_AGENT_ENABLED !== '0'
          ? await optimizeImagePrompt({
              userPrompt: generationPrompt,
              skillLabel: selectedSkill?.name,
              skillContent,
              promptStyle: selectedSkill?.promptStyle || 'text',
              providerId: process.env.PROMPT_OPTIMIZER_PROVIDER_ID,
              optimizerModel: process.env.PROMPT_OPTIMIZER_MODEL || process.env.AGENT_CHAT_MODEL || DEFAULT_AGENT_MODEL,
              signal: runSignal,
              chatFn: chat,
              outputCount: payloadOutputCount,
              batchMode: payloadBatchMode,
            })
          : { prompt: generationPrompt, optimized: false };
        const optimized = {
          ...optimizedResult,
          prompt: applyImagePromptDeliveryContract(selectedSkill?.promptStyle === 'json-text'
            ? optimizedResult.prompt
            : ensureOptimizedPromptCoverage(optimizedResult.prompt, executionBriefData), payloadDeliveryPlan),
        };
        const optimizedItems = 'items' in optimizedResult && Array.isArray(optimizedResult.items)
          ? optimizedResult.items
          : [];
        const effectiveGenerationItems: AgentImageGenerationItem[] = generationItems.length
          ? generationItems.map((item) => ({
              ...item,
              prompt: applyImagePromptDeliveryContract(item.prompt, payloadDeliveryPlan),
            }))
          : optimizedItems.length
            ? optimizedItems.map((item: any) => ({
              id: `series-${item.index}`,
              index: item.index,
              label: item.label,
              subject: item.subject,
              prompt: applyImagePromptDeliveryContract(selectedSkill?.promptStyle === 'json-text'
                ? item.prompt
                : ensureOptimizedPromptCoverage(item.prompt, executionBriefData), payloadDeliveryPlan),
            }))
            : payloadOutputCount > 1
              ? Array.from({ length: payloadOutputCount }, (_, index) => ({
                  id: `${payloadBatchMode}-${index + 1}`,
                  index: index + 1,
                  label: payloadBatchMode === 'composite' ? `多宫格 ${index + 1}` : `变体 ${index + 1}`,
                  subject: payloadBatchMode === 'composite' ? 'composite image' : 'image variant',
                  prompt: optimized.prompt,
                }))
              : [];
        if (payloadBatchMode === 'series' && payloadOutputCount > 1 && effectiveGenerationItems.length !== payloadOutputCount) {
          throw new Error(`未能形成完整的 ${payloadOutputCount} 期系列生成计划，请重试。`);
        }
        if (optimizePrompt && process.env.PROMPT_PIPELINE_AGENT_ENABLED !== '0') {
          writeProgress({ stepId: 'prompt_optimization', phase: 'optimizing', status: 'completed', label: '图片提示词优化完成' });
        }
        const resolvedImageSelection = resolveProviderModelSelection({
          providers,
          purpose: 'image',
          requestedProviderId: imageOptions?.providerId,
          requestedModel: imageOptions?.model,
        });
        if (!resolvedImageSelection.providerId || !resolvedImageSelection.model) {
          throw new Error('No enabled image provider and model are configured');
        }
        const resolvedProvider = providers.find((provider) => provider.id === resolvedImageSelection.providerId);
        const allowedModelIds = Array.isArray(resolvedProvider?.imageModels)
          ? resolvedProvider.imageModels
          : [resolvedImageSelection.model];
        const { options: resolvedImageOptions, requests } = buildAgentImageGenerationRequests({
          prompt: sourcePrompt,
          generationPrompt: optimized.prompt,
          generationPrompts: effectiveGenerationItems.map((item) => item.prompt),
          referenceImages,
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
        void contextLogger.info('image.requests_built', 'Agent image requests built', {
          requestedCount: payloadOutputCount,
          actualRequestCount: requests.length,
          countSource: countMetadata?.source || 'default',
          deliveryMode: payloadDeliveryPlan.mode,
          panelCount: payloadDeliveryPlan.panelCount || null,
          promptCount: effectiveGenerationItems.length || 1,
          streamed: streamOptions?.enabled === true && requests.length > 1,
        });
        const executionMode = resolveCanvasImageTaskExecutionMode({
          modelId: resolvedImageSelection.model,
          size: resolvedImageOptions.size,
          count: resolvedImageOptions.count,
        });
        const streamIncrementally = streamOptions?.enabled === true && requests.length > 1;
        let streamedSettled = 0;
        let streamedSucceeded = 0;
        let streamedFailed = 0;
        const taskResults = await settleCanvasImageGenerationRequests({
          requests,
          executionMode,
          runTask: async (requestBody: Record<string, unknown>) => {
            const generationRequest = new NextRequest(new URL('/api/generate', request.url), {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              signal: runSignal,
              body: JSON.stringify({
                ...requestBody,
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
                    writeEvent(controller, {
                      type: 'client_action',
                      action: {
                        type: 'add_generated_assets',
                        runId,
                        model: resolvedImageSelection.model,
                        assets: assets.map((asset) => ({
                          src: asset.src,
                          naturalWidth: asset.naturalWidth,
                          naturalHeight: asset.naturalHeight,
                          model: resolvedImageSelection.model,
                          ...(item?.id ? { itemId: item.id } : {}),
                          index: item?.index || requestIndex + 1,
                          label: item?.label || `图片 ${requestIndex + 1}`,
                        })),
                        batch: {
                          total: requests.length,
                          settled: streamedSettled,
                          succeeded: streamedSucceeded,
                          failed: streamedFailed,
                        },
                      },
                    });
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
        const assets = successfulPayloads.flatMap((payload: any) => generatedAssetsFromResult(payload));
        if (assets.length === 0) throw new Error('Image generation returned no usable assets');
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
            })),
          },
          optimized: optimized.optimized,
          requestStats: {
            requested: requests.length,
            succeeded: successfulPayloads.length,
            failed: requestFailureCount,
            ...(effectiveGenerationItems.length ? { succeededItemIds, failedItemIds } : {}),
          },
          partialFailureMessage,
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
          if (
            body.confirmation?.toolName !== confirmationRecord.toolName ||
            confirmationRecord.userMessage !== latestUserMessage
          ) {
            throw new Error('Confirmation does not match this request');
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
                  confirmationRecord.optimizePrompt !== false,
                  confirmationRecord.imageOptions,
                  confirmationRecord.referenceImages,
                  prompt,
                  {
                    source: confirmationRecord.imageCountSource,
                    totalCount: confirmationRecord.requestedTotalImageCount,
                  },
                  confirmationRecord.generationItems || [],
                  {
                    enabled: (confirmationRecord.generationItems?.length || confirmationRecord.imageOptions?.count || 1) > 1,
                    toolCallId,
                  },
                  confirmationRecord.imageDeliveryPlan,
                );
              }
              const registry = createAgentToolRegistry({ createSkillJob, getSkillJob });
              const rawResult = await executeAgentTool(
                registry,
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
              throw error;
            }
          }
          confirmationRecord.result = result;
          confirmationRecord.execution = undefined;
          if (confirmationRecord.toolName === 'generate_image') {
            writeResolvedImageOptionUpdate(toolCallId, result);
          }
          for (const event of createAgentToolResultEvents({
            source: 'confirmed',
            runId,
            toolCallId,
            toolName: confirmationRecord.toolName,
            rawResult: result,
            includeAssets: !(result as any)?.streamedAssets,
          })) writeEvent(controller, event as AgentEvent);
          writeToolProgress(confirmationRecord.toolName, 'completed', toolCallId);
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
              const nextConfirmationId = confirmationRecord.nextConfirmationId || randomUUID();
              confirmationRecord.nextConfirmationId = nextConfirmationId;
              if (!confirmationStore.has(nextConfirmationId)) {
                const checkpoint = progressTracker.snapshot();
                confirmationStore.set(nextConfirmationId, {
                  ...confirmationRecord,
                  operationId: checkpoint.operationId,
                  lastSequence: checkpoint.lastSequence,
                  progressToolCallId: `${checkpoint.operationId}-generate-image-batch-${completedCount + 1}`,
                  imageOptions: { ...structuredClone(confirmationRecord.imageOptions || {}), count: nextItems.length },
                  imageCountSource: 'batch',
                  requestedTotalImageCount: totalCount,
                  generationItems: structuredClone(nextItems),
                  remainingGenerationItems: structuredClone(continuation.remainingItems),
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
              writeEvent(controller, { type: 'agent_done', stopReason: 'awaiting_confirmation' });
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
              const nextConfirmationId = confirmationRecord.nextConfirmationId || randomUUID();
              confirmationRecord.nextConfirmationId = nextConfirmationId;
              if (!confirmationStore.has(nextConfirmationId)) {
                const checkpoint = progressTracker.snapshot();
                confirmationStore.set(nextConfirmationId, {
                  ...confirmationRecord,
                  operationId: checkpoint.operationId,
                  lastSequence: checkpoint.lastSequence,
                  progressToolCallId: `${checkpoint.operationId}-generate-image-batch-${completedCount + 1}`,
                  imageOptions: { ...structuredClone(confirmationRecord.imageOptions || {}), count: nextCount },
                  imageCountSource: 'batch',
                  requestedTotalImageCount: nextBatchPlan.totalCount,
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
              writeEvent(controller, { type: 'agent_done', stopReason: 'awaiting_confirmation' });
              return;
            }
          }
          writeEvent(controller, { type: 'agent_done', stopReason: 'confirmed_tool_completed' });
          return;
        }
        if (activeClarificationState?.operationId) {
          progressTracker.resume({
            operationId: activeClarificationState.operationId,
            lastSequence: activeClarificationState.lastSequence,
          });
          skillSource = activeClarificationState.skillSource ?? skillSource;
        }
        if (
          !body.clarificationResponse
          && !activeClarificationState
          && process.env.AGENT_UNIFIED_PLANNER_ENABLED !== '0'
        ) {
          const plannerStartedAt = Date.now();
          const plannerResult = await planAgentExecutionRequest({
            userMessage: latestUserMessage,
            messages: body.messages,
            manifests: skillManifests,
            contextEntities,
            selectedContextEntityIds,
            activeSkillId: body.activeSkillId,
            hasReferenceImages: Boolean(body.referenceImages?.length),
            imageOptions: body.imageOptions,
            canvasContext: body.canvasContext,
            model: process.env.AGENT_PLANNER_MODEL || resolvedRouterSelection.model,
            providerId: process.env.AGENT_PLANNER_PROVIDER_ID || resolvedRouterSelection.providerId || undefined,
            signal: runSignal,
            chatFn: chat,
          });
          if (plannerShadowMode) {
            const shadowPlan = plannerResult.plan;
            void contextLogger.info('planner.shadow', 'Unified planner shadow result', {
              durationMs: Date.now() - plannerStartedAt,
              providerId: process.env.AGENT_PLANNER_PROVIDER_ID || resolvedRouterSelection.providerId || null,
              model: process.env.AGENT_PLANNER_MODEL || resolvedRouterSelection.model,
              usage: plannerResult.usage || null,
              decisionSource: plannerResult.source,
              sourceDetail: plannerResult.sourceDetail,
              attempts: plannerResult.attempts,
              repairAttempted: plannerResult.repairAttempted,
              error: plannerResult.error || null,
              validationErrors: plannerResult.validationErrors || [],
              normalizedFields: plannerResult.normalizedFields || [],
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
              } : null,
              legacy: {
                intent: conversationIntent.intent,
                skillId: deterministicImageSkill?.id || null,
                deliveryMode: initialDeliveryPlan.mode,
                outputCount: initialDeliveryPlan.outputCount,
                contextStatus: initialContextResolution.status,
              },
              disagreements: {
                intent: shadowPlan ? (shadowPlan.intent === 'analysis' ? 'chat' : shadowPlan.intent) !== conversationIntent.intent : null,
                skill: shadowPlan ? (shadowPlan.skillId || null) !== (deterministicImageSkill?.id || null) : null,
                deliveryMode: shadowPlan ? (shadowPlan.delivery.mode === 'single' ? 'variants' : shadowPlan.delivery.mode) !== initialDeliveryPlan.mode : null,
                outputCount: shadowPlan ? shadowPlan.delivery.outputCount !== initialDeliveryPlan.outputCount : null,
              },
            });
          } else {
            if (!plannerResult.plan) {
              void contextLogger.warn('planner.failed', 'Unified planner failed closed before execution', {
                durationMs: Date.now() - plannerStartedAt,
                providerId: process.env.AGENT_PLANNER_PROVIDER_ID || resolvedRouterSelection.providerId || null,
                model: process.env.AGENT_PLANNER_MODEL || resolvedRouterSelection.model,
                decisionSource: plannerResult.source,
                sourceDetail: plannerResult.sourceDetail,
                attempts: plannerResult.attempts,
                repairAttempted: plannerResult.repairAttempted,
                error: plannerResult.error || null,
                validationErrors: plannerResult.validationErrors || [],
                normalizedFields: plannerResult.normalizedFields || [],
                diagnostics: plannerResult.diagnostics || [],
                mutationBlocked: true,
              });
              writeProgress({ stepId: 'routing', phase: 'planning', status: 'failed', label: '需求规划失败，已停止执行' });
              writeEvent(controller, {
                type: 'agent_error',
                stage: 'planning',
                message: '模型暂时无法形成有效的执行计划，已停止工具调用。请重试当前请求。',
              });
              writeEvent(controller, { type: 'agent_done', stopReason: 'planner_failed' });
              return;
            }
            executionPlan = plannerResult.plan;
            executionPlanSource = plannerResult.source as 'model' | 'fallback';
            executionPlanSourceDetail = plannerResult.sourceDetail as AgentPlannerSourceDetail;
            executionKind = executionPlan.execution.kind;
            imageDeliveryPlan = executionPlanToImageDeliveryPlan(executionPlan) as ImageDeliveryPlan;
            executionBriefData = executionPlanToBrief(executionPlan, latestUserMessage, contextEntities) as ExecutionBrief;
            executionBrief = executionBriefData.plainText;
            executionReferenceImages = Array.from(new Set([
              ...executionReferenceImages,
              ...executionBriefData.referenceImageUrls,
            ]));
            intent = executionPlan.intent === 'analysis' ? 'chat' : executionPlan.intent;
            selectedSkill = executionPlan.skillId
              ? skillManifests.find((manifest) => manifest.id === executionPlan?.skillId) || null
              : null;
            skillSource = selectedSkill ? (body.activeSkillId ? 'manual' : 'auto') : null;
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
            void contextLogger.info('planner.resolved', 'Unified agent execution plan resolved', {
              durationMs: Date.now() - plannerStartedAt,
              providerId: process.env.AGENT_PLANNER_PROVIDER_ID || resolvedRouterSelection.providerId || null,
              model: process.env.AGENT_PLANNER_MODEL || resolvedRouterSelection.model,
              usage: plannerResult.usage || null,
              decisionSource: plannerResult.source,
              sourceDetail: plannerResult.sourceDetail,
              attempts: plannerResult.attempts,
              repairAttempted: plannerResult.repairAttempted,
              error: plannerResult.error || null,
              validationErrors: plannerResult.validationErrors || [],
              normalizedFields: plannerResult.normalizedFields || [],
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
              writeEvent(controller, { type: 'agent_done', stopReason: 'clarification_required' });
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
                originalRequest: latestUserMessage,
                workingBrief: executionBrief,
                askedDimensions: [],
                answers: [],
                referenceImages: executionReferenceImages,
                requestedImageCountTotal: executionPlan.delivery.outputCount,
                resolvedImageCount: executionPlan.delivery.outputCount,
                resolvedImageCountSource: 'prompt',
                resolvedImageDeliveryMode: executionPlan.delivery.mode === 'single' ? 'variants' : executionPlan.delivery.mode,
                resolvedImagePanelCount: executionPlan.delivery.panelCount || undefined,
                executionPlan: structuredClone(executionPlan),
              },
            });
            writeEvent(controller, { type: 'agent_done', stopReason: 'clarification_required' });
            return;
          }
          }
        }
        if (!body.clarificationResponse && contextResolution.detected) {
          writeProgress({ stepId: 'context_resolution', phase: 'resolving', status: 'active', label: '正在解析上下文引用' });
          if (contextResolution.status === 'resolved') {
            executionBriefData = executionPlan
              ? executionPlanToBrief(executionPlan, latestUserMessage, contextEntities) as ExecutionBrief
              : compileExecutionBrief({ userMessage: latestUserMessage, contextResolution });
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
                originalRequest: latestUserMessage,
                workingBrief: latestUserMessage,
                askedDimensions: [],
                answers: [],
                referenceImages: executionReferenceImages,
                contextCandidates: candidates,
              },
            });
            writeEvent(controller, { type: 'agent_done', stopReason: 'context_reference_required' });
            void contextLogger.info('context.waiting', 'Agent context reference requires user input', {
              status: contextResolution.status,
              confidence: contextResolution.confidence,
              candidateIds: candidates.map((candidate) => candidate.id),
            });
            return;
          }
        }
        writeProgress({ stepId: 'routing', phase: 'routing', status: 'active', label: '正在理解并路由请求' });
        writeEvent(controller, { type: 'routing_start' });
        let routingDecision = null;
        if (body.clarificationResponse && activeClarificationState && body.clarificationRequest) {
          const retryClarification = body.clarificationResponse.retry === true;
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
            : deterministicImageSkill
            ? {
                version: 1,
                intent: 'image' as const,
                skillId: deterministicImageSkill.id,
                confidence: 1,
                needsClarification: false,
                source: 'deterministic_image_skill',
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
            : await routeAgentRequest({
                userMessage: latestUserMessage,
                manifests: skillManifests,
                manualSkillId: body.activeSkillId,
                hasReferenceImages: Boolean(body.referenceImages?.length),
                routerModel: resolvedRouterSelection.model,
                providerId: resolvedRouterSelection.providerId || undefined,
                signal: runSignal,
                chatFn: chat,
              });
          selectedSkill = routingDecision.skillId
            ? skillManifests.find((manifest) => manifest.id === routingDecision.skillId) || null
            : null;
          skillSource = selectedSkill ? (body.activeSkillId ? 'manual' : 'auto') : null;
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
          if (!executionPlan && intent === 'chat' && !selectedSkill && isPotentialDesignExecutionRequest(latestUserMessage)) {
            intent = 'image';
          }
        }
        const selectedSkillMayExecute = Boolean(selectedSkill?.allowedTools?.some(
          (toolName) => toolName === 'generate_image' || toolName === 'start_skill_job'
        ));
        const selectedSkillExecutionRequest = selectedSkillMayExecute
          && (
            conversationIntent.inherited
            || (
              /(生成|制作|设计|开始执行|开始制作|输出|出图)/i.test(executionBrief)
              && !/(信息收集|访谈|分析|解释|点评|总结)/i.test(executionBrief)
            )
          );
        if (!executionPlan && intent === 'chat' && selectedSkillExecutionRequest) {
          intent = 'skill_action';
        }
        void contextLogger.info('routing.resolved', 'Agent routing decision resolved', {
          decisionSource: executionPlanSource || routingDecision?.source || null,
          sourceDetail: executionPlanSourceDetail,
          plannerConfidence: executionPlan?.confidence || null,
          conversationIntent: conversationIntent.intent,
          routerIntent: routingDecision?.intent || null,
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
          writeEvent(controller, { type: 'agent_done', stopReason: 'clarification_required' });
          return;
        }

        if (selectedSkill) {
          writeProgress({ stepId: 'skill_loading', phase: 'loading', status: 'active', label: `正在加载 ${selectedSkill.name}` });
        }
        skillContent = selectedSkill ? await loadSkillContent(selectedSkill.id) : '';
        if (selectedSkill) {
          writeProgress({ stepId: 'skill_loading', phase: 'loading', status: 'completed', label: `${selectedSkill.name} 已加载` });
        }
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
            writeEvent(controller, { type: 'agent_done', stopReason: 'image_delivery_scope_required' });
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
            writeEvent(controller, { type: 'agent_done', stopReason: 'output_count_required' });
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
            ...(executionPlan ? { executionPlan: structuredClone(executionPlan) } : {}),
          };
          const clarification = await resolveBriefClarification({
            userMessage: executionBrief,
            intent: clarificationState.intent,
            skillContent,
            referenceImageCount: executionReferenceImages.length,
            state: clarificationState,
            requireCreativeDirectionConfirmation: conversationIntent.needsDirectionConfirmation,
            providerId: resolvedRouterSelection.providerId || undefined,
            model: resolvedRouterSelection.model,
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
            writeEvent(controller, { type: 'agent_done', stopReason: 'clarification_failed' });
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
            writeEvent(controller, { type: 'agent_done', stopReason: 'clarification_required' });
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
          if (
            (
              (imageBatchMode === 'series' && requestedTotalImageCount > 1)
              || selectedSkill?.promptStyle === 'json-text'
            )
            && process.env.PROMPT_PIPELINE_AGENT_ENABLED === '0'
          ) {
            throw new Error('当前 Skill 需要启用提示词优化流程。');
          }
          writeProgress({ stepId: 'prompt_optimization', phase: 'optimizing', status: 'active', label: '正在优化图片提示词' });
          writeEvent(controller, { type: 'prompt_optimization_start' });
          const optimizerModel = process.env.PROMPT_OPTIMIZER_MODEL || process.env.AGENT_CHAT_MODEL || DEFAULT_AGENT_MODEL;
          const optimizedResult = process.env.PROMPT_PIPELINE_AGENT_ENABLED === '0'
            ? { prompt: executionBrief, optimized: false, summary: '已保留你的原始设计要求' }
            : await optimizeImagePrompt({
                userPrompt: executionBrief,
                skillLabel: selectedSkill?.name,
                skillContent,
                promptStyle: selectedSkill?.promptStyle || 'text',
                providerId: process.env.PROMPT_OPTIMIZER_PROVIDER_ID,
                optimizerModel,
                signal: runSignal,
                chatFn: chat,
                outputCount: requestedTotalImageCount,
                batchMode: imageBatchMode,
                plannerItems: executionPlan?.delivery.items || [],
              });
          const optimized = {
            ...optimizedResult,
            prompt: selectedSkill?.promptStyle === 'json-text'
              ? optimizedResult.prompt
              : ensureOptimizedPromptCoverage(optimizedResult.prompt, executionBriefData),
          };
          const optimizedItems = 'items' in optimizedResult && Array.isArray(optimizedResult.items)
            ? optimizedResult.items
            : [];
          const optimizedSubject = 'structured' in optimizedResult
            ? optimizedResult.structured?.subject
            : undefined;
          const plannerSeriesItems = executionPlan?.delivery?.items || [];
          const allGenerationItems: AgentImageGenerationItem[] = requestedTotalImageCount > 1
            ? imageBatchMode === 'series'
              ? (optimizedItems.length > 0 ? optimizedItems : plannerSeriesItems).map((item: any) => ({
                  id: `series-${item.index}`,
                  index: item.index,
                  label: item.label || `系列 ${item.index}`,
                  subject: item.subject || optimizedSubject || 'series item',
                  prompt: selectedSkill?.promptStyle === 'json-text'
                    ? item.prompt || executionBrief
                    : ensureOptimizedPromptCoverage(item.prompt || `${optimized.prompt}\n\nSpecific direction: ${item.variation || item.subject || item.label}`, executionBriefData),
                }))
              : Array.from({ length: requestedTotalImageCount }, (_, index) => ({
                  id: `${imageBatchMode}-${index + 1}`,
                  index: index + 1,
                  label: imageBatchMode === 'composite' ? `多宫格 ${index + 1}` : `变体 ${index + 1}`,
                  subject: optimizedSubject || (imageBatchMode === 'composite' ? 'composite image' : 'image variant'),
                  prompt: optimized.prompt,
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
          writeEvent(controller, {
            type: 'prompt_optimization_done',
            summary: optimized.summary,
            optimized: optimized.optimized,
          });
          writeProgress({ stepId: 'prompt_optimization', phase: 'optimizing', status: 'completed', label: '图片提示词优化完成' });

          if (requestedImageCount > 1 || executionPlan?.execution.requiresConfirmation === true) {
            const generationItems = allGenerationItems.slice(0, requestedImageCount);
            const confirmationId = randomUUID();
            const progressToolCallId = `${runId}-generate-image-confirmation`;
            writeToolProgress('generate_image', 'waiting', progressToolCallId);
            const confirmationCheckpoint = progressTracker.snapshot();
            confirmationStore.set(confirmationId, {
              operationId: confirmationCheckpoint.operationId,
              skillSource,
              lastSequence: confirmationCheckpoint.lastSequence,
              progressToolCallId,
              skillId: selectedSkill?.id || null,
              toolName: 'generate_image',
              toolArgs: { prompt: optimized.prompt },
              allowedTools: ['generate_image'],
              userMessage: latestUserMessage,
              generationBrief: executionBrief,
              executionBrief: structuredClone(executionBriefData),
              referenceImages: [...executionReferenceImages],
              canvasContext: body.canvasContext ? structuredClone(body.canvasContext) : undefined,
              imageOptions: { ...structuredClone(body.imageOptions || {}), count: requestedImageCount },
              imageCountSource: requestedImageCountSource,
              requestedTotalImageCount,
              imageBatchPlan: imageBatchPlan ? structuredClone(imageBatchPlan) : undefined,
              imageBatchMode,
              imageDeliveryPlan: structuredClone(imageDeliveryPlan),
              generationItems: structuredClone(generationItems),
              remainingGenerationItems: structuredClone(allGenerationItems.slice(generationItems.length)),
              optimizePrompt: false,
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
            writeEvent(controller, { type: 'agent_done', stopReason: 'awaiting_confirmation' });
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
              false,
              body.imageOptions,
              executionReferenceImages,
              optimized.prompt,
              { source: requestedImageCountSource, totalCount: requestedTotalImageCount },
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
          for (const event of createAgentToolResultEvents({
            source: 'direct',
            runId,
            toolCallId,
            toolName: 'generate_image',
            rawResult: generationPayload,
          })) writeEvent(controller, event as AgentEvent);
          writeToolProgress('generate_image', 'completed', toolCallId);
          writeEvent(controller, { type: 'agent_done', stopReason: 'image_generated' });
          return;
        }

        turns += 1;
        const chatMessages = buildMainAgentMessages({
          messages: body.messages,
          skillContent,
          canvasContext: body.canvasContext,
          referenceImages: executionReferenceImages,
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
              true,
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
        const modelTools = getAgentModelTools(toolRegistry, allowedTools);
        if (modelTools.length > 0) {
          const rawToolResults = new Map<string, unknown>();
          writeProgress({ stepId: 'composing', phase: 'planning', status: 'active', label: '正在规划下一步操作' });
          const loopResult = await runAgentLoop({
            messages: chatMessages,
            tools: modelTools,
            maxTurns: MAX_AGENT_TURNS,
            maxToolCalls: MAX_TOOL_CALLS,
            modelFn: ({ messages, tools }) => chat({
              providerId: resolvedChatSelection.providerId || undefined,
              model,
              messages,
              tools,
              toolChoice: 'auto',
              signal: runSignal,
            }),
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
              const rawResult = await executeAgentTool(toolRegistry, toolName, args, {
                allowedTools,
                confirmed: false,
                canvasContext: body.canvasContext,
              });
              rawToolResults.set(context.toolCallId, rawResult);
              return rawResult;
            },
            isReadOnlyTool: (toolName) => toolRegistry.get(toolName)?.readOnly === true,
            requireMutationTool: executionPlan
              ? Boolean(executionPlan.execution.tool)
              : intent === 'image' || intent === 'skill_action',
            serializeToolResultForModel: (toolName, result) => createAgentToolResultViews(toolName, result).modelResult,
            serializeToolResultForPublic: (toolName, result) => createAgentToolResultViews(toolName, result).publicResult,
            onToolStart: ({ id, name }) => {
              writeToolProgress(name, 'active', id);
              writeEvent(controller, { type: 'tool_start', toolCallId: id, toolName: name });
            },
            onToolResult: ({ id, name, result }) => {
              const rawResult = rawToolResults.get(id);
              if (name === 'generate_image') {
                writeResolvedImageOptionUpdate(id, rawResult);
              }
              for (const event of createAgentToolResultEvents({
                source: 'loop',
                runId,
                toolCallId: id,
                toolName: name,
                rawResult: rawResult ?? result,
              })) writeEvent(controller, event as AgentEvent);
              writeToolProgress(name, 'completed', id);
            },
          });
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
              },
            });
            writeEvent(controller, { type: 'agent_done', stopReason: 'awaiting_user_intent' });
            return;
          }
          if (loopResult.stopReason === 'confirmation_required') {
            const confirmationId = randomUUID();
            const progressToolCallId = String(loopResult.confirmation?.toolCallId || `${runId}-confirmation`);
            writeToolProgress(
              String(loopResult.confirmation?.toolName || 'start_skill_job'),
              'waiting',
              progressToolCallId,
            );
            const confirmationCheckpoint = progressTracker.snapshot();
            confirmationStore.set(confirmationId, {
              operationId: confirmationCheckpoint.operationId,
              skillSource,
              lastSequence: confirmationCheckpoint.lastSequence,
              progressToolCallId,
              skillId: selectedSkill!.id,
              toolName: String(loopResult.confirmation?.toolName || 'start_skill_job'),
              toolArgs: (loopResult.confirmation?.arguments && typeof loopResult.confirmation.arguments === 'object')
                ? loopResult.confirmation.arguments as Record<string, unknown>
                : {},
              allowedTools: [...allowedTools],
              userMessage: latestUserMessage,
              generationBrief: executionBrief,
              executionBrief: structuredClone(executionBriefData),
              referenceImages: [...executionReferenceImages],
              canvasContext: body.canvasContext ? structuredClone(body.canvasContext) : undefined,
              imageOptions: { ...structuredClone(body.imageOptions || {}), count: requestedImageCount },
              imageCountSource: requestedImageCountSource,
              requestedTotalImageCount,
              imageBatchPlan: imageBatchPlan ? structuredClone(imageBatchPlan) : undefined,
              imageDeliveryPlan: structuredClone(imageDeliveryPlan),
              optimizePrompt: true,
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
            writeEvent(controller, { type: 'agent_done', stopReason: 'awaiting_confirmation' });
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
          writeEvent(controller, { type: 'agent_done', stopReason: loopResult.stopReason });
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
        writeEvent(controller, { type: 'agent_done', stopReason: 'completed' });
      } catch (error) {
        if (clarificationSubmissionKey) {
          clarificationSubmissionStore.delete(clarificationSubmissionKey);
        }
        const aborted = request.signal.aborted;
        const timedOut = timeoutSignal.aborted && !aborted;
        progressTracker.settleActive(
          'failed',
          aborted ? '运行已取消' : timedOut ? '运行超时' : '运行失败',
        );
        writeEvent(controller, {
          type: 'agent_error',
          stage: aborted ? 'cancelled' : timedOut ? 'timeout' : executionKind || (intent === 'image' ? 'image_pipeline' : 'chat'),
          message: aborted ? '运行已取消' : timedOut ? '运行超时，请重试' : error instanceof Error ? error.message : 'Agent run failed',
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
