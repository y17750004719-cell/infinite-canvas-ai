import { createHash } from 'node:crypto';
import { loadThread, updateThreadState } from './thread-journal.mjs';
import {
  acquireNativeCodexHost,
  invalidateNativeCodexHost,
  nativeProviderFingerprint,
  prepareNativeTurnInput,
} from './native-codex-host.mjs';
import type { ResponseItem } from './native-codex-protocol/ResponseItem';
import type { DynamicToolCallParams } from './native-codex-protocol/v2/DynamicToolCallParams';
import type { RawResponseCompletedNotification } from './native-codex-protocol/v2/RawResponseCompletedNotification';
import type { RawResponseItemCompletedNotification } from './native-codex-protocol/v2/RawResponseItemCompletedNotification';
import type { ThreadStartParams } from './native-codex-protocol/v2/ThreadStartParams';
import type { TurnStartParams } from './native-codex-protocol/v2/TurnStartParams';
import { runChatCompletionsTurn } from './chat-completions-adapter.mjs';
import { CURRENT_CONTRACT_VERSION } from '../compatibility-gate.mjs';
import { CODEX_MAIN_SNAPSHOT } from './codex-main-snapshot.mjs';
import { validateApplicationToolName } from './application-tool-dispatcher.mjs';

export type NativeAgentIdentity = {
  taskId: string;
  operationId: string;
  runId: string;
};

export type NativeAgentProvider = {
  id: string;
  model: string;
  baseUrl: string;
  apiKey: string;
  protocol: 'openai' | 'responses' | 'gemini';
};

export type NativeAgentSkill = {
  id: string;
  name: string;
  content: string;
  hash: string;
};

export type NativeAgentTool = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  requiresCommentary?: boolean;
};

export type NativeAgentEvent = {
  method: string;
  params: Record<string, any>;
  threadId: string;
  turnId?: string;
  taskId: string;
  operationId: string;
  runId: string;
};

export type NativeAgentTurnResult = {
  status: 'completed' | 'failed' | 'cancelled' | 'waiting';
  text: string;
  threadId: string;
  turnId: string;
  pendingConfirmation?: Record<string, unknown>;
  error?: { code: string; message: string; retryable: boolean };
};

type NativeAgentHost = Awaited<ReturnType<typeof acquireNativeCodexHost>>;

export type RunNativeAgentTurnInput = {
  sessionId: string;
  identity: NativeAgentIdentity;
  provider: NativeAgentProvider;
  userText: string;
  images?: string[];
  skills?: NativeAgentSkill[];
  baseInstructions: string;
  developerInstructions: string;
  tools: NativeAgentTool[];
  executeTool: (
    name: string,
    args: Record<string, unknown>,
    context: {
      threadId: string;
      turnId: string;
      toolCallId: string;
      signal?: AbortSignal;
      onProgress: (event: Record<string, unknown>) => void;
    },
  ) => Promise<Record<string, any>>;
  onEvent?: (event: NativeAgentEvent) => void | Promise<void>;
  signal?: AbortSignal;
  turnTimeoutMs?: number;
  acquireHost?: typeof acquireNativeCodexHost;
};

const sessionQueues = new Map<string, Promise<unknown>>();
const sessionQueueDepth = new Map<string, number>();
const MAX_SESSION_QUEUE_DEPTH = 8;

function text(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function requiredText(value: unknown, label: string) {
  const result = text(value);
  if (!result) throw new TypeError(`${label} is required`);
  return result;
}

function toolResultContent(result: Record<string, any>) {
  const contentItems: Array<Record<string, unknown>> = [{
    type: 'inputText',
    text: JSON.stringify(result?.modelResult ?? result ?? null),
  }];
  for (const reference of Array.isArray(result?.visualReferences) ? result.visualReferences : []) {
    const src = text(reference?.src || reference?.url || reference?.imageUrl);
    if (/^data:image\/[a-z0-9.+-]+;base64,/i.test(src)) {
      contentItems.push({ type: 'inputImage', imageUrl: src });
    }
  }
  return contentItems;
}

function nativeError(value: any) {
  const message = text(value?.message || value?.error?.message) || 'Native Codex turn failed';
  const code = text(value?.code || value?.error?.codexErrorInfo?.code) || 'native_turn_failed';
  return { code, message, retryable: value?.retryable === true };
}

function toolFailure(error: any): Record<string, any> {
  const outcomeUnknown = error?.outcomeUnknown === true;
  return {
    isError: true,
    modelResult: {
      code: text(error?.failureCode || error?.code) || 'business_tool_failed',
      failureStage: text(error?.failureStage) || 'business_tool',
      message: text(error?.message) || 'Business tool failed',
      retryable: outcomeUnknown ? false : error?.retryable === true || error?.isRetryable === true,
      outcomeUnknown,
    },
  };
}

function responseMessageText(item: Extract<ResponseItem, { type: 'message' }>) {
  return item.content
    .flatMap((part: any) => typeof part?.text === 'string' ? [part.text] : [])
    .join('')
    .trim();
}

const PRIVATE_TEXT_PATTERN = /(?:<\/?(?:skill|system|developer|tool)(?:\s|>)|api[_ -]?key|authorization\s*:\s*bearer|chain[- ]of[- ]thought|hidden reasoning|system prompt|developer instructions|raw[_ -]?arguments)/i;

function sanitizePublicMessage(value: unknown, maxLength = 16_000) {
  const result = text(value);
  if (!result || PRIVATE_TEXT_PATTERN.test(result)) return '';
  return result.slice(0, maxLength);
}

function isMeaningfulPublicCommentary(value: unknown) {
  const result = sanitizePublicMessage(value, 2_000);
  if (result.length < 20) return false;
  return /[A-Za-z\u3400-\u9fff]/.test(result);
}

function queueSession<T>(sessionId: string, task: () => Promise<T>): Promise<T> {
  const depth = sessionQueueDepth.get(sessionId) || 0;
  if (depth >= MAX_SESSION_QUEUE_DEPTH) {
    return Promise.reject(Object.assign(new Error('Native Agent session queue is full'), { code: 'native_session_queue_full' }));
  }
  sessionQueueDepth.set(sessionId, depth + 1);
  const previous = sessionQueues.get(sessionId) || Promise.resolve();
  const current = previous.then(task, task);
  const tail = current.then(() => undefined, () => undefined).finally(() => {
    sessionQueueDepth.set(sessionId, Math.max(0, (sessionQueueDepth.get(sessionId) || 1) - 1));
    if (sessionQueueDepth.get(sessionId) === 0) sessionQueueDepth.delete(sessionId);
    if (sessionQueues.get(sessionId) === tail) sessionQueues.delete(sessionId);
  });
  sessionQueues.set(sessionId, tail);
  return current;
}

function safeNativeEvent(method: string, params: Record<string, any>) {
  const turnId = text(params?.turnId || params?.turn?.id);
  if (method === 'turn/started') return { turnId, status: 'running' };
  if (method === 'turn/failed' || method === 'error') return {
    turnId,
    status: 'failed',
    error: nativeError(params?.error || params?.turn?.error || params),
  };
  if (method === 'turn/completed') return {
    turnId,
    status: text(params?.turn?.status),
    ...(params?.turn?.error ? { error: nativeError(params.turn.error) } : {}),
    ...(params?.turn?.usage ? { usage: params.turn.usage } : {}),
  };
  if (method === 'item/agentMessage/delta' || method === 'item/reasoning/summaryTextDelta' || method === 'item/plan/delta') {
    const delta = text(params?.delta || params?.text || params?.content);
    if (!delta) return null;
    return {
      turnId,
      item: {
        id: text(params?.itemId || params?.item?.id),
        type: method === 'item/agentMessage/delta' ? 'agentMessage' : method === 'item/plan/delta' ? 'plan' : 'reasoning',
        delta,
      },
    };
  }
  if (method === 'item/started' || method === 'item/updated' || method === 'item/completed') {
    const item = params?.item || {};
    if (item.type === 'agentMessage') {
      const safeText = sanitizePublicMessage(item.text || item.delta);
      if (!safeText) return null;
      return {
        turnId, item: { id: text(item.id), type: 'agentMessage', phase: text(item.phase), text: safeText, delta: method === 'item/updated' ? safeText : undefined, delivery: item.delivery || null },
      };
    }
    if (item.type === 'dynamicToolCall') return {
      turnId,
      item: { id: text(item.id || item.callId), type: 'dynamicToolCall', tool: text(item.tool), status: text(item.status), success: item.success === true },
    };
  }
  return null;
}

export async function runNativeAgentTurn(input: RunNativeAgentTurnInput): Promise<NativeAgentTurnResult> {
  const sessionId = requiredText(input.sessionId, 'sessionId');
  if (input.provider?.protocol === 'openai' || input.provider?.protocol === 'gemini') {
    return queueSession(sessionId, () => runChatCompletionsTurn(input as any) as Promise<NativeAgentTurnResult>);
  }
  if (input.provider?.protocol !== 'responses') {
    throw Object.assign(new Error('Unsupported provider protocol'), {
      code: 'native_protocol_unsupported',
    });
  }
  if (!Array.isArray(input.tools) || input.tools.some((tool) => !text(tool?.name))) {
    throw new TypeError('tools must contain named tool definitions');
  }
  if (typeof input.executeTool !== 'function') throw new TypeError('executeTool is required');
  if (input.signal?.aborted) {
    return {
      status: 'cancelled', text: '', threadId: '', turnId: '',
      error: { code: 'cancelled', message: 'Native Agent request was cancelled', retryable: false },
    };
  }

  return queueSession(sessionId, async () => {
    const acquireHost = input.acquireHost || acquireNativeCodexHost;
    const host = await acquireHost({ provider: input.provider, ownerId: 'local' }) as NativeAgentHost;
    const stored = await loadThread(sessionId);
    const persistedNative = stored.state.nativeCodex && typeof stored.state.nativeCodex === 'object'
      ? stored.state.nativeCodex as Record<string, unknown>
      : null;
    const sameScope = text(persistedNative?.scopeId) === text(host.scopeId)
      && text(persistedNative?.providerFingerprint) === nativeProviderFingerprint(input.provider);
    const dynamicTools = input.tools.map((tool) => ({
      type: 'function',
      name: tool.name,
      description: tool.description,
      inputSchema: tool.parameters,
    }));
    const threadParams: ThreadStartParams & {
      environments: [];
      dynamicTools: Array<Record<string, unknown>>;
      experimentalRawEvents: true;
    } = {
      cwd: host.cwd,
      environments: [],
      model: input.provider.model,
      modelProvider: 'zflow_provider',
      baseInstructions: input.baseInstructions,
      developerInstructions: input.developerInstructions,
      dynamicTools,
      experimentalRawEvents: true,
    };
    const resumedThreadId = sameScope ? text(persistedNative?.threadId) : '';
    const threadResponse = resumedThreadId
      ? await host.client.request('thread/resume', { threadId: resumedThreadId, excludeTurns: true, ...threadParams })
      : await host.client.request('thread/start', threadParams);
    const threadId = requiredText(threadResponse?.thread?.id, 'native threadId');
    await updateThreadState(sessionId, {
      nativeCodex: {
        threadId,
        scopeId: host.scopeId,
        providerFingerprint: nativeProviderFingerprint(input.provider),
        sourceCommit: host.capabilitySnapshot?.sourceCommit || null,
        targetCodexMainCommit: CODEX_MAIN_SNAPSHOT.sourceCommit,
        wireApi: CODEX_MAIN_SNAPSHOT.wireApi,
        protocolSchema: CODEX_MAIN_SNAPSHOT.protocolSchema,
        source: 'app_server',
        contractVersion: CURRENT_CONTRACT_VERSION,
      },
    });

    let turnId = '';
    let finalText = '';
    let pendingConfirmation: Record<string, unknown> | undefined;
    let completed = false;
    let modelSampleIndex = 1;
    let sampleHasCommentary = false;
    const sampledToolCalls = new Map<string, { modelSampleIndex: number; hasCommentary: boolean }>();
    let missingCommentaryAttempts = 0;
    const toolCalls = new Map<string, { argsHash: string; promise: Promise<Record<string, any>> }>();
    let resolveTurn!: (value: NativeAgentTurnResult) => void;
    const turnFinished = new Promise<NativeAgentTurnResult>((resolve) => {
      resolveTurn = resolve;
    });

    const emit = async (method: string, params: Record<string, any>) => {
      const safeParams = safeNativeEvent(method, params);
      if (!safeParams) return;
      await input.onEvent?.({
        method,
        params: safeParams,
        threadId,
        turnId: text(params?.turnId || params?.turn?.id) || turnId || undefined,
        ...input.identity,
      });
    };
    const finish = (result: NativeAgentTurnResult) => {
      if (completed) return;
      completed = true;
      resolveTurn(result);
    };
    const unregister = host.registerThreadHandler(threadId, {
      onNotification: async ({ method, params }: { method: string; params: Record<string, any> }) => {
        const eventTurnId = text(params?.turnId || params?.turn?.id);
        if (eventTurnId) turnId = eventTurnId;
        if (method === 'rawResponseItem/completed') {
          const raw = params as Partial<RawResponseItemCompletedNotification>;
          const rawItem = raw.item as ResponseItem | undefined;
          if (
            rawItem?.type === 'message'
            && rawItem.role === 'assistant'
            && rawItem.phase === 'commentary'
            && isMeaningfulPublicCommentary(responseMessageText(rawItem))
          ) {
            sampleHasCommentary = true;
          } else if (rawItem?.type === 'function_call') {
            sampledToolCalls.set(rawItem.call_id, { modelSampleIndex, hasCommentary: sampleHasCommentary });
          }
          return;
        }
        if (method === 'rawResponse/completed') {
          const raw = params as Partial<RawResponseCompletedNotification>;
          await input.onEvent?.({
            method: 'zflow/model_sample_completed',
            params: { modelSampleIndex, responseId: text(raw.responseId), hadPublicCommentary: sampleHasCommentary },
            threadId, turnId, ...input.identity,
          });
          modelSampleIndex += 1;
          sampleHasCommentary = false;
          return;
        }
        const item = params?.item;
        if ((method === 'item/started' || method === 'item/updated' || method === 'item/completed') && item?.type === 'agentMessage') {
          const safeText = sanitizePublicMessage(item.text || item.delta);
          if (item.phase !== 'commentary' && safeText) finalText = method === 'item/updated' ? `${finalText}${safeText}` : safeText;
        }
        await emit(method, params);
        if (method !== 'turn/completed') return;
        const status = text(params?.turn?.status);
        if (pendingConfirmation) {
          finish({ status: 'waiting', text: finalText, threadId, turnId, pendingConfirmation });
        } else if (status === 'completed') {
          finish({ status: 'completed', text: finalText, threadId, turnId });
        } else if (status === 'interrupted') {
          finish({ status: input.signal?.aborted ? 'cancelled' : 'failed', text: finalText, threadId, turnId,
            ...(input.signal?.aborted ? {} : { error: nativeError(params?.turn?.error || { code: 'native_turn_interrupted', message: 'Native Codex turn was interrupted' }) }),
          });
        } else {
          finish({ status: 'failed', text: finalText, threadId, turnId, error: nativeError(params?.turn?.error) });
        }
      },
      onToolCall: async ({ params }: { params: DynamicToolCallParams }) => {
        const name = text(params?.tool);
        const callId = requiredText(params?.callId, 'native tool callId');
        if (text(params?.threadId) !== threadId || (turnId && text(params?.turnId) !== turnId)) {
          return { success: false, contentItems: [{ type: 'inputText', text: JSON.stringify({ code: 'stale_native_tool_call' }) }] };
        }
        const allowedTools = input.tools.map((tool) => tool.name);
        const definition = input.tools.find((tool) => tool.name === name);
        const validation = validateApplicationToolName(name, allowedTools);
        if (!definition || !validation.ok) {
          return { success: false, contentItems: [{ type: 'inputText', text: JSON.stringify({
            ...(validation.error || { code: 'tool_not_allowed', failureStage: 'tool_dispatch', retryable: false, requestedTool: name, allowedTools }),
          }) }] };
        }
        if (pendingConfirmation) {
          return { success: false, contentItems: [{ type: 'inputText', text: JSON.stringify({ code: 'confirmation_pending' }) }] };
        }
        const args = params?.arguments && typeof params.arguments === 'object' && !Array.isArray(params.arguments)
          ? params.arguments as Record<string, unknown>
          : {};
        const argsHash = createHash('sha256').update(JSON.stringify(args)).digest('hex');
        const existing = toolCalls.get(callId);
        if (existing) {
          if (existing.argsHash !== argsHash) return { success: false, contentItems: [{ type: 'inputText', text: JSON.stringify({ code: 'tool_call_identity_conflict' }) }] };
          const result = await existing.promise;
          return { success: result?.isError !== true && result?.confirmationRequired !== true, contentItems: toolResultContent(result) };
        }
        const sampledCall = sampledToolCalls.get(callId);
        if (definition.requiresCommentary && sampledCall?.hasCommentary !== true) {
          missingCommentaryAttempts += 1;
          if (missingCommentaryAttempts > 1) {
            queueMicrotask(() => { void host.client.request('turn/interrupt', { threadId, turnId }).catch(() => {}); });
          }
          return { success: false, contentItems: [{ type: 'inputText', text: JSON.stringify({
            code: 'decision_commentary_missing',
            retryable: missingCommentaryAttempts === 1,
            instruction: missingCommentaryAttempts === 1 ? 'Explain the immediate action to the user before calling this tool again.' : undefined,
          }) }] };
        }
        const execution: Promise<Record<string, any>> = input.executeTool(name, args, {
            threadId,
            turnId,
            toolCallId: callId,
            signal: input.signal,
            onProgress: (progress) => { void input.onEvent?.({
              method: 'zflow/tool/progress',
              params: { status: text(progress?.status), phase: text(progress?.phase), message: text(progress?.message), callId, tool: name },
              threadId, turnId, ...input.identity,
            }); },
          }).catch((error) => toolFailure(error));
        toolCalls.set(callId, { argsHash, promise: execution });
        const result = await execution;
        if (result?.confirmationRequired === true) {
          pendingConfirmation = result;
          queueMicrotask(() => { void host.client.request('turn/interrupt', { threadId, turnId }).catch(() => {}); });
        }
        return { success: result?.isError !== true && result?.confirmationRequired !== true, contentItems: toolResultContent(result) };
      },
    });

    const abort = () => {
      if (!turnId) return;
      void host.client.request('turn/interrupt', { threadId, turnId }).catch(() => {});
    };
    input.signal?.addEventListener('abort', abort, { once: true });
    try {
      const turnInput = await prepareNativeTurnInput(host, {
        userText: input.userText,
        images: input.images || [],
        skills: input.skills || [],
      }) as TurnStartParams['input'];
      const turnParams: TurnStartParams & { environments: [] } = {
        threadId,
        environments: [],
        input: turnInput,
      };
      const started = await host.client.request('turn/start', turnParams);
      turnId = requiredText(started?.turn?.id, 'native turnId');
      if (input.signal?.aborted) abort();
      const processExited = host.client.exitPromise?.then(() => ({
        status: 'failed' as const,
        text: finalText,
        threadId,
        turnId,
        error: { code: 'native_process_exited', message: 'Native Codex process exited before the turn completed', retryable: true },
      }));
      const timeoutMs = Number.isSafeInteger(input.turnTimeoutMs) && Number(input.turnTimeoutMs) > 0
        ? Number(input.turnTimeoutMs)
        : 10 * 60 * 1000;
      let timeout: ReturnType<typeof setTimeout> | undefined;
      const timedOut = new Promise<NativeAgentTurnResult>((resolve) => {
        timeout = setTimeout(() => {
          abort();
          void invalidateNativeCodexHost(host);
          resolve({
            status: 'failed', text: finalText, threadId, turnId,
            error: { code: 'native_turn_timeout', message: 'Native Codex turn timed out', retryable: true },
          });
        }, timeoutMs);
        timeout.unref?.();
      });
      try {
        return await Promise.race([turnFinished, timedOut, ...(processExited ? [processExited] : [])]);
      } finally {
        if (timeout) clearTimeout(timeout);
      }
    } catch (error) {
      const code = (error as { code?: string })?.code;
      if (code === 'request_timeout' || code === 'process_exited' || code === 'transport_unavailable'
        || code === 'stdout_error' || code === 'stdin_error' || code === 'process_error') {
        await invalidateNativeCodexHost(host).catch(() => {});
      }
      throw error;
    } finally {
      input.signal?.removeEventListener('abort', abort);
      unregister();
    }
  });
}
