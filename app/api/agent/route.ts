import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { POST as generatePost } from '../generate/route';
import { chat, chatStream } from '../../lib/api-client';
import { optimizeImagePrompt } from '../../lib/agent/image-pipeline.mjs';
import {
  getSkillManifest,
  listSkillManifests,
  loadSkillContent,
  selectSkillForPrompt,
} from '../../lib/agent/skill-registry.mjs';
import { resolveAgentIntent } from '../../lib/agent/prompt-optimizer.mjs';
import { createAgentToolRegistry, executeAgentTool } from '../../lib/agent/tool-registry.mjs';
import { createSkillJob, getSkillJob, toJobSummary } from '../../lib/skill-jobs';
import type { AgentEvent } from '../../lib/agent/events';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_AGENT_TURNS = 6;
const MAX_TOOL_CALLS = 4;
const DEFAULT_AGENT_MODEL = 'gemini-3.1-flash-lite-preview-thinking-medium';
const CONFIRMATION_TTL_MS = 10 * 60 * 1000;
const encoder = new TextEncoder();

type ConfirmationRecord = {
  skillId: string;
  userMessage: string;
  referenceImages: string[];
  canvasContext?: Record<string, unknown>;
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

  let selectedSkill = null;
  try {
    selectedSkill = body.activeSkillId
      ? await getSkillManifest(body.activeSkillId)
      : selectSkillForPrompt(latestUserMessage, await listSkillManifests());
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Invalid skill' }, { status: 400 });
  }

  const detectedIntent = resolveAgentIntent(latestUserMessage, Boolean(body.referenceImages?.length));
  const intent = detectedIntent === 'image' && selectedSkill && !selectedSkill.allowedTools.includes('generate_image')
    ? 'chat'
    : detectedIntent;
  const timeoutMs = Math.min(300_000, Math.max(10_000, Number(process.env.AGENT_RUN_TIMEOUT_MS) || 180_000));
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const runSignal = AbortSignal.any([request.signal, timeoutSignal]);
  const stream = new ReadableStream({
    async start(controller) {
      let toolCalls = 0;
      let turns = 0;
      try {
        writeEvent(controller, { type: 'agent_start', runId });
        writeEvent(controller, { type: 'intent_resolved', intent });
        if (selectedSkill) {
          writeEvent(controller, { type: 'skill_selected', skillId: selectedSkill.id, label: selectedSkill.name });
        }

        if (intent === 'skill_action') {
          if (!selectedSkill?.allowedTools.includes('start_skill_job')) {
            throw new Error('The selected skill cannot start a batch job');
          }
          pruneConfirmationStore();
          const requestedConfirmationId = body.confirmation?.confirmationId;
          if (!requestedConfirmationId || body.confirmation?.toolName !== 'start_skill_job') {
            const confirmationId = randomUUID();
            confirmationStore.set(confirmationId, {
              skillId: selectedSkill.id,
              userMessage: latestUserMessage,
              referenceImages: [...(body.referenceImages || [])],
              canvasContext: body.canvasContext ? structuredClone(body.canvasContext) : undefined,
              expiresAt: Date.now() + CONFIRMATION_TTL_MS,
            });
            writeEvent(controller, {
              type: 'confirmation_required',
              request: {
                confirmationId,
                toolName: 'start_skill_job',
                message: `确认后开始执行 ${selectedSkill.name} 批量任务`,
              },
            });
            writeEvent(controller, { type: 'agent_done', stopReason: 'awaiting_confirmation' });
            return;
          }
          const confirmationRecord = confirmationStore.get(requestedConfirmationId);
          if (!confirmationRecord || confirmationRecord.expiresAt <= Date.now()) {
            confirmationStore.delete(requestedConfirmationId);
            throw new Error('Confirmation expired; request a new confirmation');
          }
          if (confirmationRecord.skillId !== selectedSkill.id || confirmationRecord.userMessage !== latestUserMessage) {
            throw new Error('Confirmation does not match this request');
          }
          const toolCallId = `${runId}-start-skill-job-1`;
          writeEvent(controller, { type: 'tool_start', toolCallId, toolName: 'start_skill_job' });
          if (!confirmationRecord.execution && !confirmationRecord.result) {
            confirmationRecord.execution = (async () => {
              const toolRegistry = createAgentToolRegistry({ createSkillJob, getSkillJob });
              const job = await executeAgentTool(toolRegistry, 'start_skill_job', {
                skillType: confirmationRecord.skillId,
                payload: {
                  userRequirement: confirmationRecord.userMessage,
                  logoReferenceImages: confirmationRecord.referenceImages,
                },
              }, {
                allowedTools: selectedSkill.allowedTools,
                confirmed: true,
                canvasContext: confirmationRecord.canvasContext,
              }) as ReturnType<typeof createSkillJob>;
              return {
                ...toJobSummary(job),
                items: job.items.map((item) => ({ key: item.key, name: item.name, status: item.status })),
              };
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
          writeEvent(controller, { type: 'tool_result', toolCallId, result });
          writeEvent(controller, { type: 'agent_done', stopReason: 'skill_job_started' });
          return;
        }

        if (intent === 'image') {
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
        if (body.referenceImages?.length) {
          const multimodalRequest = new NextRequest(new URL('/api/generate', request.url), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            signal: runSignal,
            body: JSON.stringify({
              messages: body.messages,
              intent: 'chat',
              skill: selectedSkill?.id,
              reference_images: body.referenceImages,
              chatProviderId: process.env.AGENT_CHAT_PROVIDER_ID,
              model: process.env.AGENT_CHAT_MODEL || DEFAULT_AGENT_MODEL,
              cancelWithRequest: true,
            }),
          });
          const multimodalResponse = await generatePost(multimodalRequest);
          const multimodalPayload = await multimodalResponse.json().catch(() => null);
          if (!multimodalResponse.ok || multimodalPayload?.status !== 'completed') {
            throw new Error(multimodalPayload?.error || 'Visual analysis failed');
          }
          const result = multimodalPayload.result || {};
          if (result.reasoningContent) {
            writeEvent(controller, {
              type: 'assistant_delta',
              delta: result.reasoningContent,
              channel: 'reasoning',
              model: result.model,
            });
          }
          writeEvent(controller, {
            type: 'assistant_delta',
            delta: result.content || '',
            channel: 'content',
            model: result.model,
          });
          writeEvent(controller, { type: 'agent_done', stopReason: 'completed' });
          return;
        }
        const skillContent = selectedSkill ? await loadSkillContent(selectedSkill.id) : '';
        const chatMessages = [
          ...(skillContent ? [{ role: 'system' as const, content: skillContent }] : []),
          ...body.messages.map((message) => ({ role: message.role, content: message.content })),
        ];
        const model = process.env.AGENT_CHAT_MODEL || DEFAULT_AGENT_MODEL;
        for await (const event of chatStream({
          providerId: process.env.AGENT_CHAT_PROVIDER_ID,
          model,
          messages: chatMessages,
          signal: runSignal,
          stream: true,
        })) {
          if (event.type === 'delta' && event.content) {
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
