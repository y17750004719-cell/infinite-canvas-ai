import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { POST as generatePost } from '../generate/route';
import { chat, chatStream } from '../../lib/api-client';
import { optimizeImagePrompt } from '../../lib/agent/image-pipeline.mjs';
import {
  listSkillManifests,
  loadSkillContent,
} from '../../lib/agent/skill-registry.mjs';
import { buildMainAgentMessages } from '../../lib/agent/main-agent.mjs';
import { routeAgentRequest } from '../../lib/agent/skill-router.mjs';
import { runAgentLoop } from '../../lib/agent/agent-loop.mjs';
import { createAgentToolRegistry, executeAgentTool, getAgentModelTools } from '../../lib/agent/tool-registry.mjs';
import { createSkillJob, getSkillJob, toJobSummary } from '../../lib/skill-jobs';
import { readProviderRegistry } from '../../lib/provider-config.mjs';
import { resolveProviderModelSelection } from '../../lib/provider-model-selection.mjs';
import type { AgentEvent } from '../../lib/agent/events';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_AGENT_TURNS = 6;
const MAX_TOOL_CALLS = 4;
const DEFAULT_AGENT_MODEL = 'gemini-3.1-flash-lite-preview-thinking-medium';
const CONFIRMATION_TTL_MS = 10 * 60 * 1000;
const encoder = new TextEncoder();

type ConfirmationRecord = {
  skillId: string | null;
  toolName: string;
  toolArgs: Record<string, unknown>;
  allowedTools: string[];
  userMessage: string;
  referenceImages: string[];
  canvasContext?: Record<string, unknown>;
  imageOptions?: AgentRequestBody['imageOptions'];
  expiresAt: number;
  execution?: Promise<Record<string, unknown>>;
  result?: Record<string, unknown>;
};

const agentGlobals = globalThis as unknown as {
  __agentConfirmationStore?: Map<string, ConfirmationRecord>;
};
const confirmationStore = agentGlobals.__agentConfirmationStore || new Map<string, ConfirmationRecord>();
agentGlobals.__agentConfirmationStore = confirmationStore;

type AgentRequestBody = {
  runId?: string;
  topicId?: string;
  messages?: Array<{ role: 'user' | 'assistant'; content: string }>;
  activeSkillId?: string;
  referenceImages?: string[];
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
};

function writeEvent(controller: ReadableStreamDefaultController, event: AgentEvent) {
  controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
}

function getLatestUserMessage(messages: AgentRequestBody['messages']) {
  return [...(messages || [])].reverse().find((message) => message.role === 'user')?.content?.trim() || '';
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
      let intent: 'chat' | 'image' | 'skill_action' = 'chat';
      let selectedSkill = body.activeSkillId
        ? skillManifests.find((manifest) => manifest.id === body.activeSkillId) || null
        : null;
      const generateImagePayload = async (
        prompt: string,
        optimizePrompt = true,
        imageOptions = body.imageOptions,
        referenceImages = body.referenceImages,
      ) => {
        const optimized = optimizePrompt && process.env.PROMPT_PIPELINE_AGENT_ENABLED !== '0'
          ? await optimizeImagePrompt({
              userPrompt: prompt,
              skillLabel: selectedSkill?.name,
              providerId: process.env.PROMPT_OPTIMIZER_PROVIDER_ID,
              optimizerModel: process.env.PROMPT_OPTIMIZER_MODEL || process.env.AGENT_CHAT_MODEL || DEFAULT_AGENT_MODEL,
              signal: runSignal,
              chatFn: chat,
            })
          : { prompt, optimized: false };
        const generationRequest = new NextRequest(new URL('/api/generate', request.url), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: runSignal,
          body: JSON.stringify({
            messages: [{ role: 'user', content: optimized.prompt }],
            intent: 'image',
            reference_images: referenceImages,
            providerId: imageOptions?.providerId,
            imageProviderId: imageOptions?.providerId,
            model: imageOptions?.model,
            aspect_ratio: imageOptions?.aspectRatio,
            size: imageOptions?.size,
            quality: imageOptions?.quality,
            n: imageOptions?.count,
            cancelWithRequest: true,
          }),
        });
        const generationResponse = await generatePost(generationRequest);
        const generationPayload = await generationResponse.json().catch(() => null);
        if (!generationResponse.ok || generationPayload?.status !== 'completed') {
          throw new Error(generationPayload?.error || `Image generation failed (${generationResponse.status})`);
        }
        return generationPayload;
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
          selectedSkill = confirmationRecord.skillId
            ? skillManifests.find((manifest) => manifest.id === confirmationRecord.skillId) || null
            : null;
          if (confirmationRecord.skillId && !selectedSkill) throw new Error('Confirmed skill is no longer available');
          intent = confirmationRecord.toolName === 'generate_image' ? 'image' : 'skill_action';
          writeEvent(controller, { type: 'routing_start' });
          writeEvent(controller, { type: 'intent_resolved', intent });
          if (selectedSkill) {
            writeEvent(controller, {
              type: 'skill_selected',
              skillId: selectedSkill.id,
              label: selectedSkill.name,
              source: 'manual',
            });
          }
          const toolCallId = `${runId}-${confirmationRecord.toolName}-confirmed`;
          writeEvent(controller, { type: 'tool_start', toolCallId, toolName: confirmationRecord.toolName });
          if (!confirmationRecord.execution && !confirmationRecord.result) {
            confirmationRecord.execution = (async () => {
              if (confirmationRecord.toolName === 'generate_image') {
                const prompt = typeof confirmationRecord.toolArgs.prompt === 'string'
                  ? confirmationRecord.toolArgs.prompt
                  : confirmationRecord.userMessage;
                return generateImagePayload(
                  prompt,
                  confirmationRecord.toolArgs.optimizePrompt !== false,
                  confirmationRecord.imageOptions,
                  confirmationRecord.referenceImages,
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
            const assets = generatedAssetsFromResult(result);
            writeEvent(controller, { type: 'tool_result', toolCallId, result: { assets } });
            if (assets.length > 0) {
              writeEvent(controller, { type: 'client_action', action: { type: 'add_generated_assets', runId, assets } });
            }
          } else {
            writeEvent(controller, { type: 'tool_result', toolCallId, result });
          }
          writeEvent(controller, { type: 'agent_done', stopReason: 'confirmed_tool_completed' });
          return;
        }
        writeEvent(controller, { type: 'routing_start' });
        const routingDecision = await routeAgentRequest({
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
        intent = routingDecision.intent === 'image' && selectedSkill && !selectedSkill.allowedTools.includes('generate_image')
          ? 'chat'
          : routingDecision.intent;
        writeEvent(controller, { type: 'intent_resolved', intent });
        if (selectedSkill) {
          writeEvent(controller, {
            type: 'skill_selected',
            skillId: selectedSkill.id,
            label: selectedSkill.name,
            source: routingDecision.source === 'manual' ? 'manual' : 'auto',
          });
        }
        if (routingDecision.needsClarification && routingDecision.clarificationQuestion) {
          writeEvent(controller, {
            type: 'clarification_required',
            message: routingDecision.clarificationQuestion,
          });
          writeEvent(controller, {
            type: 'assistant_delta',
            delta: routingDecision.clarificationQuestion,
            channel: 'content',
            model: resolvedChatSelection.model,
          });
          writeEvent(controller, { type: 'agent_done', stopReason: 'clarification_required' });
          return;
        }

        if (intent === 'image' && !selectedSkill) {
          turns += 1;
          writeEvent(controller, { type: 'prompt_optimization_start' });
          const optimizerModel = process.env.PROMPT_OPTIMIZER_MODEL || process.env.AGENT_CHAT_MODEL || DEFAULT_AGENT_MODEL;
          const optimized = process.env.PROMPT_PIPELINE_AGENT_ENABLED === '0'
            ? { prompt: latestUserMessage, optimized: false, summary: '已保留你的原始设计要求' }
            : await optimizeImagePrompt({
                userPrompt: latestUserMessage,
                skillLabel: selectedSkill?.name,
                providerId: process.env.PROMPT_OPTIMIZER_PROVIDER_ID,
                optimizerModel,
                signal: runSignal,
                chatFn: chat,
              });
          writeEvent(controller, {
            type: 'prompt_optimization_done',
            summary: optimized.summary,
            optimized: optimized.optimized,
          });

          if ((body.imageOptions?.count || 1) > 1) {
            const confirmationId = randomUUID();
            confirmationStore.set(confirmationId, {
              skillId: selectedSkill?.id || null,
              toolName: 'generate_image',
              toolArgs: { prompt: optimized.prompt, optimizePrompt: false },
              allowedTools: ['generate_image'],
              userMessage: latestUserMessage,
              referenceImages: [...(body.referenceImages || [])],
              canvasContext: body.canvasContext ? structuredClone(body.canvasContext) : undefined,
              imageOptions: body.imageOptions ? structuredClone(body.imageOptions) : undefined,
              expiresAt: Date.now() + CONFIRMATION_TTL_MS,
            });
            writeEvent(controller, {
              type: 'confirmation_required',
              request: {
                confirmationId,
                toolName: 'generate_image',
                message: `本次将生成 ${body.imageOptions?.count} 张图片，确认后继续。`,
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
          writeEvent(controller, { type: 'tool_start', toolCallId, toolName: 'generate_image' });
          writeEvent(controller, { type: 'tool_update', toolCallId, message: '正在渲染高分辨率画面' });

          const toolRegistry = createAgentToolRegistry({
            generateImage: async () => {
              const generationRequest = new NextRequest(new URL('/api/generate', request.url), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                signal: runSignal,
                body: JSON.stringify({
                  messages: [{ role: 'user', content: optimized.prompt }],
                  intent: 'image',
                  reference_images: body.referenceImages,
                  providerId: body.imageOptions?.providerId,
                  imageProviderId: body.imageOptions?.providerId,
                  model: body.imageOptions?.model,
                  aspect_ratio: body.imageOptions?.aspectRatio,
                  size: body.imageOptions?.size,
                  quality: body.imageOptions?.quality,
                  n: body.imageOptions?.count,
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
          });
          const generationPayload = await executeAgentTool(toolRegistry, 'generate_image', {}, {
            allowedTools: selectedSkill?.allowedTools || ['generate_image', 'get_canvas_context'],
            canvasContext: body.canvasContext,
          }) as any;
          const assets = generatedAssetsFromResult(generationPayload);
          if (assets.length === 0) throw new Error('Image generation returned no usable assets');
          writeEvent(controller, { type: 'tool_result', toolCallId, result: { assets, optimized: optimized.optimized } });
          writeEvent(controller, { type: 'client_action', action: { type: 'add_generated_assets', runId, assets } });
          writeEvent(controller, { type: 'agent_done', stopReason: 'image_generated' });
          return;
        }

        turns += 1;
        const skillContent = selectedSkill ? await loadSkillContent(selectedSkill.id) : '';
        const chatMessages = buildMainAgentMessages({
          messages: body.messages,
          skillContent,
          canvasContext: body.canvasContext,
          referenceImages: body.referenceImages,
        });
        const model = resolvedChatSelection.model!;
        const allowedTools = selectedSkill?.allowedTools || [];
        const toolRegistry = createAgentToolRegistry({
          createSkillJob,
          getSkillJob,
          generateImage: async (args: Record<string, unknown>) => {
            const prompt = typeof args.prompt === 'string' && args.prompt.trim()
              ? args.prompt.trim()
              : latestUserMessage;
            return generateImagePayload(prompt, true);
          },
        });
        const modelTools = getAgentModelTools(toolRegistry, allowedTools);
        if (modelTools.length > 0) {
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
            executeTool: (toolName, args) => {
              if (toolName === 'generate_image' && (body.imageOptions?.count || 1) > 1) {
                return Promise.resolve({
                  confirmationRequired: true,
                  toolName,
                  message: `本次将生成 ${body.imageOptions?.count} 张图片，确认后继续。`,
                });
              }
              return executeAgentTool(toolRegistry, toolName, args, {
                allowedTools,
                confirmed: false,
                canvasContext: body.canvasContext,
              });
            },
            isReadOnlyTool: (toolName) => toolRegistry.get(toolName)?.readOnly === true,
            onToolStart: ({ id, name }) => {
              writeEvent(controller, { type: 'tool_start', toolCallId: id, toolName: name });
            },
            onToolResult: ({ id, name, result }) => {
              if (name === 'generate_image') {
                const assets = generatedAssetsFromResult(result);
                writeEvent(controller, { type: 'tool_result', toolCallId: id, result: { assets } });
                if (assets.length > 0) {
                  writeEvent(controller, {
                    type: 'client_action',
                    action: { type: 'add_generated_assets', runId, assets },
                  });
                }
                return;
              }
              writeEvent(controller, { type: 'tool_result', toolCallId: id, result });
            },
          });
          if (loopResult.stopReason === 'confirmation_required') {
            const confirmationId = randomUUID();
            confirmationStore.set(confirmationId, {
              skillId: selectedSkill!.id,
              toolName: String(loopResult.confirmation?.toolName || 'start_skill_job'),
              toolArgs: (loopResult.confirmation?.arguments && typeof loopResult.confirmation.arguments === 'object')
                ? loopResult.confirmation.arguments as Record<string, unknown>
                : {},
              allowedTools: [...allowedTools],
              userMessage: latestUserMessage,
              referenceImages: [...(body.referenceImages || [])],
              canvasContext: body.canvasContext ? structuredClone(body.canvasContext) : undefined,
              imageOptions: body.imageOptions ? structuredClone(body.imageOptions) : undefined,
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
          if (loopResult.content) {
            writeEvent(controller, {
              type: 'assistant_delta',
              delta: loopResult.content,
              channel: 'content',
              model,
            });
          }
          writeEvent(controller, { type: 'agent_done', stopReason: loopResult.stopReason });
          return;
        }
        for await (const event of chatStream({
          providerId: resolvedChatSelection.providerId || undefined,
          model,
          messages: chatMessages,
          signal: runSignal,
          stream: true,
        })) {
          if (event.type === 'delta' && event.channel === 'content' && event.content) {
            writeEvent(controller, {
              type: 'assistant_delta',
              delta: event.content,
              channel: event.channel,
              model,
            });
          }
        }
        writeEvent(controller, { type: 'agent_done', stopReason: 'completed' });
      } catch (error) {
        const aborted = request.signal.aborted;
        const timedOut = timeoutSignal.aborted && !aborted;
        writeEvent(controller, {
          type: 'agent_error',
          stage: aborted ? 'cancelled' : timedOut ? 'timeout' : intent === 'image' ? 'image_pipeline' : 'chat',
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
