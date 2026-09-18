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
import {
  completeNativeContextLedger,
  prepareBoundedNativeContext,
} from './native-context-budget.mjs';

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
  /**
   * Commentary remains useful public audit/progress information, but selected
   * tools may provide a safe application-generated fallback when the Native
   * host fails to correlate an otherwise valid commentary event.
   */
  commentaryPolicy?: 'required' | 'server_fallback';
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
  turnId: string | null;
  pendingConfirmation?: Record<string, unknown>;
  error?: { code: string; message: string; retryable: boolean; outcomeUnknown?: boolean; failureStage?: string };
};

type NativeAgentHost = Awaited<ReturnType<typeof acquireNativeCodexHost>>;

export type RunNativeAgentTurnInput = {
  sessionId: string;
  identity: NativeAgentIdentity;
  provider: NativeAgentProvider;
  userText: string;
  images?: string[];
  imageIdentities?: Array<{ assetId?: string; referenceId?: string; contentHash?: string }>;
  history?: Array<Record<string, unknown>>;
  agentMemory?: Record<string, unknown> | null;
  contextEvents?: Array<Record<string, unknown>>;
  modelEvents?: Array<Record<string, unknown>>;
  compactedWindows?: Array<Record<string, unknown>>;
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
      commentarySource?: string | null;
      commentaryFallbackUsed?: boolean;
      signal?: AbortSignal;
      onProgress: (event: Record<string, unknown>) => void;
    },
  ) => Promise<Record<string, any>>;
  onEvent?: (event: NativeAgentEvent) => void | Promise<void>;
  signal?: AbortSignal;
  turnTimeoutMs?: number;
  acquireHost?: typeof acquireNativeCodexHost;
};

/**
 * Normalize the provider/app-server variants of an application tool call into
 * the v2 `item/tool/call` shape.  Code-mode tools are deliberately not
 * aliases for application tools: accepting one here would route execution to
 * the disabled Native host instead of the application dispatcher.
 */
export function normalizeNativeToolCall(raw: any): {
  ok: true;
  protocol: 'item/tool/call';
  threadId: string;
  turnId: string;
  callId: string;
  tool: string;
  arguments: Record<string, unknown>;
} | {
  ok: false;
  error: Record<string, unknown>;
} {
  const params = raw?.params && typeof raw.params === 'object' ? raw.params : raw;
  const item = params?.item && typeof params.item === 'object' ? params.item : params;
  const threadId = text(params?.threadId || item?.threadId);
  const turnId = text(params?.turnId || item?.turnId);
  const callId = text(params?.callId || params?.toolCallId || item?.call_id || item?.callId || item?.id);
  const requestedTool = text(params?.tool || params?.name || item?.tool || item?.name);
  const disabled = new Set([
    'exec', 'code_mode', 'code-mode', 'code_mode_host', 'code-mode-host',
    'image_generation', 'image-generation', 'image_generation_host', 'image-generation-host',
  ]);
  const normalizedDisabled = requestedTool.toLowerCase();
  if (disabled.has(normalizedDisabled)) {
    return { ok: false, error: {
      code: normalizedDisabled.includes('code_mode_host') || normalizedDisabled.includes('code-mode-host')
        ? 'native_tool_host_disabled' : 'tool_not_allowed',
      failureStage: 'tool_dispatch', retryable: false, requestedTool,
    } };
  }
  if (!threadId || !turnId || !callId || !requestedTool) {
    return { ok: false, error: {
      code: 'provider_tool_protocol_invalid', failureStage: 'tool_dispatch', retryable: false,
      message: 'Native application tool call is missing threadId, turnId, callId, or tool',
    } };
  }
  let args = params?.arguments ?? params?.args ?? item?.arguments ?? item?.args ?? {};
  if (typeof args === 'string') {
    try { args = JSON.parse(args); } catch {
      return { ok: false, error: { code: 'provider_tool_protocol_invalid', failureStage: 'tool_dispatch', retryable: false, message: 'Native tool arguments are not valid JSON' } };
    }
  }
  if (!args || typeof args !== 'object' || Array.isArray(args)) {
    return { ok: false, error: { code: 'provider_tool_protocol_invalid', failureStage: 'tool_dispatch', retryable: false, message: 'Native tool arguments must be an object' } };
  }
  return { ok: true, protocol: 'item/tool/call', threadId, turnId, callId, tool: requestedTool, arguments: args };
}

// A Native session owns at most one active turn.  Requests must fail fast
// instead of accumulating behind a potentially stalled provider stream.
const activeSessions = new Set<string>();

/**
 * Adapter-level retries call this before starting a new attempt so a failure
 * that happened before `turn/start` cannot accidentally resume the same
 * possibly contaminated Native thread.
 */
export async function markNativeContextForRotation(sessionId: string, reason = 'adapter_retry') {
  const id = requiredText(sessionId, 'sessionId');
  const stored = await loadThread(id);
  const nativeCodex = stored.state.nativeCodex && typeof stored.state.nativeCodex === 'object'
    ? stored.state.nativeCodex as Record<string, any>
    : null;
  if (!nativeCodex?.threadId) return false;
  const contextLedger = nativeCodex.contextLedger && typeof nativeCodex.contextLedger === 'object'
    ? nativeCodex.contextLedger as Record<string, any>
    : {
        version: 1,
        generation: Math.max(1, Number(nativeCodex.generation) || 1),
        nativeThreadId: text(nativeCodex.threadId),
        turnCount: 0,
        estimatedInputTokens: 0,
        serializedInputBytes: 0,
        imageOccurrences: 0,
        uniqueImageHashes: [],
        residentAssetIds: [],
        summaryVersion: 0,
      };
  await updateThreadState(id, {
    nativeCodex: {
      ...nativeCodex,
      contextLedger: {
        ...contextLedger,
        lastTurnStatus: 'transport_incomplete',
        forcedRotationReason: text(reason) || 'adapter_retry',
      },
    },
  });
  return true;
}

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
  const rawCode = text(value?.code || value?.error?.codexErrorInfo?.code);
  const lower = message.toLowerCase();
  const code = rawCode || (lower.includes('code-mode host is disabled') || lower.includes('code mode host is disabled')
    ? 'native_tool_host_disabled'
    : lower.includes('servers are currently overloaded') || lower.includes('upstream overloaded')
      ? 'provider_overloaded'
      : lower.includes('stream disconnected')
        ? 'native_stream_disconnected'
        : 'native_turn_failed');
  return {
    code,
    message,
    retryable: value?.retryable === true && !['native_tool_host_disabled', 'provider_overloaded'].includes(code),
    ...(value?.outcomeUnknown === true ? { outcomeUnknown: true } : {}),
    ...(value?.failureStage ? { failureStage: text(value.failureStage) } : {}),
  };
}

function toolFailure(error: any): Record<string, any> {
  const outcomeUnknown = error?.outcomeUnknown === true;
  const rawCode = text(error?.failureCode || error?.code);
  const message = text(error?.message) || 'Business tool failed';
  const lower = message.toLowerCase();
  const code = rawCode === 'native_capability_disabled'
    || rawCode === 'code_mode_host_disabled'
    || lower.includes('code-mode host is disabled')
    || lower.includes('code mode host is disabled')
    ? 'native_tool_host_disabled'
    : rawCode || 'business_tool_failed';
  return {
    isError: true,
    modelResult: {
      code,
      failureStage: text(error?.failureStage) || 'business_tool',
      message,
      retryable: code === 'native_tool_host_disabled' || outcomeUnknown ? false : error?.retryable === true || error?.isRetryable === true,
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

function busyResult(sessionId: string): NativeAgentTurnResult {
  return {
    status: 'failed',
    text: '',
    threadId: sessionId,
    turnId: null,
    error: {
      code: 'native_session_busy',
      message: 'Native Agent session already has an active turn',
      retryable: true,
      outcomeUnknown: false,
      failureStage: 'native_runtime',
    },
  };
}

function queueSession<T>(sessionId: string, task: () => Promise<T>, busy: () => T): Promise<T> {
  if (activeSessions.has(sessionId)) return Promise.resolve(busy());
  activeSessions.add(sessionId);
  // The finally block is the single release path for completion, failure,
  // cancellation, timeout, process exit, transport errors, and aborts.
  return Promise.resolve().then(task).finally(() => {
    activeSessions.delete(sessionId);
  });
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
    return queueSession(sessionId, () => runChatCompletionsTurn(input as any) as Promise<NativeAgentTurnResult>, () => busyResult(sessionId));
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
    const providerFingerprint = nativeProviderFingerprint(input.provider);
    const boundedContext = prepareBoundedNativeContext({
      persistedNative,
      sameScope,
      scopeId: host.scopeId,
      providerFingerprint,
      model: input.provider.model,
      userText: input.userText,
      images: input.images || [],
      imageIdentities: input.imageIdentities || [],
      skills: input.skills || [],
      tools: dynamicTools,
      baseInstructions: input.baseInstructions,
      developerInstructions: input.developerInstructions,
      threadState: {
        ...stored.state,
        contextHistory: input.history,
        agentMemory: input.agentMemory,
        contextEvents: input.contextEvents,
        modelEvents: input.modelEvents,
        compactedWindows: input.compactedWindows,
      },
    });
    const resumedThreadId = boundedContext.resumeThreadId;
    const threadResponse = resumedThreadId
      ? await host.client.request('thread/resume', { threadId: resumedThreadId, excludeTurns: true, ...threadParams })
      : await host.client.request('thread/start', threadParams);
    const threadId = requiredText(threadResponse?.thread?.id, 'native threadId');
    await updateThreadState(sessionId, {
      nativeCodex: {
        ...(persistedNative || {}),
        threadId,
        scopeId: host.scopeId,
        providerFingerprint,
        sourceCommit: host.capabilitySnapshot?.sourceCommit || null,
        targetCodexMainCommit: CODEX_MAIN_SNAPSHOT.sourceCommit,
        wireApi: CODEX_MAIN_SNAPSHOT.wireApi,
        protocolSchema: CODEX_MAIN_SNAPSHOT.protocolSchema,
        source: 'app_server',
        contractVersion: CURRENT_CONTRACT_VERSION,
        generation: boundedContext.generation,
        contextLedger: { ...boundedContext.ledger, nativeThreadId: threadId },
      },
    });

    let turnId = '';
    let finalText = '';
    let pendingConfirmation: Record<string, unknown> | undefined;
    let completed = false;
    let modelSampleIndex = 1;
    let sampleHasCommentary = false;
    let sampleCommentarySource = '';
    type CommentaryObservation = { modelSampleIndex: number; source: string; turnId: string };
    const pendingCommentaryByTurn = new Map<string, CommentaryObservation>();
    const completedCommentaryByTurn = new Map<string, CommentaryObservation>();
    const commentaryBuffers = new Map<string, string>();
    const sampledToolCalls = new Map<string, { modelSampleIndex: number; hasCommentary: boolean; commentarySource?: string; turnId: string }>();
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
    const noteCommentary = (value: unknown, source: string, eventTurnId?: string) => {
      const safeText = sanitizePublicMessage(value, 2_000);
      if (!isMeaningfulPublicCommentary(safeText)) return false;
      const scopedTurnId = text(eventTurnId) || turnId;
      sampleHasCommentary = true;
      sampleCommentarySource = source;
      pendingCommentaryByTurn.set(scopedTurnId, { modelSampleIndex, source, turnId: scopedTurnId });
      // Some Native builds deliver the canonical agent message after the raw
      // function-call item. Backfill the observation for that same sample so
      // event ordering cannot turn valid commentary into a false denial.
      for (const [callId, sampledCall] of sampledToolCalls) {
        if (sampledCall.turnId === scopedTurnId && sampledCall.modelSampleIndex === modelSampleIndex) {
          sampledToolCalls.set(callId, { ...sampledCall, hasCommentary: true, commentarySource: source });
        }
      }
      return true;
    };
    const commentaryForTurn = (eventTurnId: string) => {
      const scopedTurnId = text(eventTurnId) || turnId;
      const pending = pendingCommentaryByTurn.get(scopedTurnId);
      if (pending?.modelSampleIndex === modelSampleIndex) return pending;
      const completed = completedCommentaryByTurn.get(scopedTurnId);
      // A response completion advances modelSampleIndex. Do not let the
      // previous sample's commentary authorize a later tool call when the
      // provider omitted a fresh commentary event.
      return completed?.modelSampleIndex === modelSampleIndex ? completed : null;
    };
    const noteSampledToolCall = (item: Record<string, any>, eventTurnId?: string) => {
      const itemType = text(item?.type).toLowerCase();
      if (!['function_call', 'functioncall', 'custom_tool_call', 'customtoolcall', 'dynamictoolcall'].includes(itemType)) return;
      const sampledCallId = text(item?.call_id || item?.callId || item?.id);
      if (!sampledCallId) return;
      const scopedTurnId = text(eventTurnId) || turnId;
      const commentary = commentaryForTurn(scopedTurnId);
      const previous = sampledToolCalls.get(sampledCallId);
      const sameTurn = previous?.turnId === scopedTurnId;
      const previousCommentary = sameTurn && previous?.hasCommentary === true;
      sampledToolCalls.set(sampledCallId, {
        // Native emits a canonical dynamicToolCall after the raw function
        // item. Preserve the raw sample's commentary observation instead of
        // overwriting it with the later lifecycle event's reset state.
        modelSampleIndex: previousCommentary ? previous!.modelSampleIndex : modelSampleIndex,
        hasCommentary: sampleHasCommentary || Boolean(commentary) || previousCommentary,
        ...((sampleCommentarySource || commentary?.source || (previousCommentary ? previous?.commentarySource : ''))
          ? { commentarySource: sampleCommentarySource || commentary?.source || previous?.commentarySource } : {}),
        turnId: scopedTurnId,
      });
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
            noteCommentary(responseMessageText(rawItem), 'raw_response_item', eventTurnId);
          } else if (rawItem?.type === 'function_call' || rawItem?.type === 'custom_tool_call') {
            const sampledCallId = text((rawItem as any).call_id || (rawItem as any).callId || (rawItem as any).id);
            const commentary = commentaryForTurn(eventTurnId);
            if (sampledCallId) sampledToolCalls.set(sampledCallId, {
              modelSampleIndex,
              hasCommentary: sampleHasCommentary || Boolean(commentary),
              ...(sampleCommentarySource || commentary?.source ? { commentarySource: sampleCommentarySource || commentary?.source } : {}),
              turnId: text(eventTurnId) || turnId,
            });
          }
          return;
        }
        if (method === 'rawResponse/completed') {
          const raw = params as Partial<RawResponseCompletedNotification>;
          const scopedTurnId = text(eventTurnId) || turnId;
          if (sampleHasCommentary) {
            completedCommentaryByTurn.set(scopedTurnId, {
              modelSampleIndex,
              source: sampleCommentarySource || 'native_sample',
              turnId: scopedTurnId,
            });
          } else {
            // A completed sample without commentary closes the previous
            // commentary credit. This prevents it from authorizing a later
            // tool call in the same turn.
            completedCommentaryByTurn.delete(scopedTurnId);
          }
          pendingCommentaryByTurn.delete(scopedTurnId);
          await input.onEvent?.({
            method: 'zflow/model_sample_completed',
            params: {
              modelSampleIndex,
              responseId: text(raw.responseId),
              hadPublicCommentary: sampleHasCommentary,
              commentarySource: sampleCommentarySource || null,
            },
            threadId, turnId, ...input.identity,
          });
          modelSampleIndex += 1;
          sampleHasCommentary = false;
          sampleCommentarySource = '';
          return;
        }
        const item = params?.item;
        if (item && (method === 'item/started' || method === 'item/updated' || method === 'item/completed')) {
          noteSampledToolCall(item, eventTurnId);
        }
        if (method === 'item/agentMessage/delta') {
          const deltaText = sanitizePublicMessage(item?.delta || params?.delta || params?.text);
          const phase = text(item?.phase || params?.phase);
          if (phase === 'commentary' && deltaText) {
            const itemId = text(item?.id) || `${text(eventTurnId) || turnId}:commentary`;
            const combined = `${commentaryBuffers.get(itemId) || ''}${deltaText}`.slice(-2_000);
            commentaryBuffers.set(itemId, combined);
            noteCommentary(combined, 'canonical_item_agent_message_delta', eventTurnId);
          }
          if (deltaText && phase !== 'commentary') finalText += deltaText;
        }
        if ((method === 'item/started' || method === 'item/updated' || method === 'item/completed') && item?.type === 'agentMessage') {
          const safeText = sanitizePublicMessage(item.text || item.delta);
          if (item.phase === 'commentary' && safeText) {
            const itemId = text(item.id) || `${text(eventTurnId) || turnId}:commentary`;
            commentaryBuffers.delete(itemId);
            noteCommentary(safeText, `canonical_${method.replaceAll('/', '_')}`, eventTurnId);
          }
          if (item.phase !== 'commentary' && safeText && !finalText.endsWith(safeText)) finalText = method === 'item/updated' ? `${finalText}${safeText}` : safeText;
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
        const normalized = normalizeNativeToolCall(params);
        if (!normalized.ok) {
          const error = (normalized as { ok: false; error: Record<string, unknown> }).error;
          return { success: false, contentItems: [{ type: 'inputText', text: JSON.stringify(error) }] };
        }
        const { threadId: callThreadId, turnId: callTurnId, tool: name, callId, arguments: normalizedArguments } = normalized;
        if (callThreadId !== threadId || (turnId && callTurnId !== turnId)) {
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
        const args = normalizedArguments;
        const argsHash = createHash('sha256').update(JSON.stringify(args)).digest('hex');
        const existing = toolCalls.get(callId);
        if (existing) {
          if (existing.argsHash !== argsHash) return { success: false, contentItems: [{ type: 'inputText', text: JSON.stringify({ code: 'tool_call_identity_conflict' }) }] };
          const result = await existing.promise;
          return { success: result?.isError !== true && result?.confirmationRequired !== true, contentItems: toolResultContent(result) };
        }
        const sampledCall = sampledToolCalls.get(callId);
        const scopedCommentary = commentaryForTurn(callTurnId);
        // Once the upstream event identified this call, its sample-local
        // observation is authoritative. Falling back to a turn-level
        // observation here would leak commentary from an earlier sample.
        const hasCommentary = sampledCall
          ? sampledCall.hasCommentary === true
          : Boolean(scopedCommentary);
        const commentarySource = sampledCall?.commentarySource || (sampledCall ? null : scopedCommentary?.source) || null;
        // `server_fallback` is deliberately restricted to the application
        // image boundary. Ordinary tools must keep the strict public
        // commentary contract even if a malformed definition carries the
        // policy field.
        const commentaryPolicy = name === 'generate_image' && definition.commentaryPolicy === 'server_fallback'
          ? 'server_fallback'
          : name === 'generate_image' ? 'server_fallback' : 'required';
        const commentaryFallbackUsed = definition.requiresCommentary && !hasCommentary && commentaryPolicy === 'server_fallback';
        if (definition.requiresCommentary && !hasCommentary && !commentaryFallbackUsed) {
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
        if (commentaryFallbackUsed) {
          try {
            await input.onEvent?.({
              method: 'zflow/tool/progress',
              params: {
                status: 'active',
                phase: 'preparing',
                message: '正在提交已验证的图片生成请求。',
                callId,
                tool: name,
                commentarySource,
                commentaryFallbackUsed: true,
              },
              threadId,
              turnId,
              ...input.identity,
            });
          } catch {
            // A progress projection must never prevent the image side effect.
          }
        }
        const execution: Promise<Record<string, any>> = input.executeTool(name, args, {
            threadId,
            turnId,
            toolCallId: callId,
            commentarySource,
            commentaryFallbackUsed,
            signal: input.signal,
            onProgress: (progress) => { void input.onEvent?.({
              method: 'zflow/tool/progress',
              params: { status: text(progress?.status), phase: text(progress?.phase), message: text(progress?.message), callId, tool: name },
              threadId, turnId, ...input.identity,
            }); },
          }).then((result) => {
            if (result?.isError === true) {
              const failure = result?.modelResult || result;
              return toolFailure(failure);
            }
            return result;
          }).catch((error) => toolFailure(error));
        toolCalls.set(callId, { argsHash, promise: execution });
        const result = await execution;
        const rawToolFailureCode = text(result?.modelResult?.code || result?.failureCode || result?.code);
        const toolFailureCode = rawToolFailureCode === 'native_capability_disabled' || rawToolFailureCode === 'code_mode_host_disabled'
          ? 'native_tool_host_disabled'
          : rawToolFailureCode;
        if (toolFailureCode === 'native_tool_host_disabled' && result?.modelResult) {
          result.modelResult = { ...result.modelResult, code: toolFailureCode };
        }
        if (toolFailureCode === 'native_tool_host_disabled') {
          // A disabled tool host cannot recover inside this turn. End it now so
          // callers receive a precise failure instead of waiting for timeout.
          finish({
            status: 'failed',
            text: finalText,
            threadId,
            turnId,
            error: {
              code: 'native_tool_host_disabled',
              message: text(result?.modelResult?.message) || 'Native tool host is disabled',
              retryable: false,
              failureStage: 'tool_dispatch',
            },
          });
          queueMicrotask(() => { void host.client.request('turn/interrupt', { threadId, turnId }).catch(() => {}); });
        }
        if (toolFailureCode === 'skill_lock_failed') {
          // Skill selection is a hard prerequisite for this interaction. Do
          // not let the model continue and later report a false image success.
          finish({
            status: 'failed',
            text: finalText,
            threadId,
            turnId,
            error: {
              code: 'skill_lock_failed',
              message: text(result?.modelResult?.message) || 'Visual Skill could not be locked',
              retryable: false,
              failureStage: 'interaction',
              ...(result?.modelResult?.skillId ? { skillId: result.modelResult.skillId } : {}),
            },
          });
          queueMicrotask(() => { void host.client.request('turn/interrupt', { threadId, turnId }).catch(() => {}); });
        }
        const imageToolFailed = name === 'generate_image'
          && (result?.isError === true
            || result?.success === false
            || result?.status === 'failed'
            || Boolean(result?.modelResult?.code || result?.failureCode || result?.code));
        if (imageToolFailed && toolFailureCode !== 'skill_lock_failed' && toolFailureCode !== 'native_tool_host_disabled') {
          const failureCode = rawToolFailureCode || 'image_execution_failed';
          finish({
            status: 'failed',
            text: finalText,
            threadId,
            turnId,
            error: {
              code: failureCode,
              message: text(result?.modelResult?.message || result?.message) || 'Image generation failed',
              retryable: false,
              failureStage: text(result?.modelResult?.failureStage) || 'image_execution',
              outcomeUnknown: result?.modelResult?.outcomeUnknown === true || result?.outcomeUnknown === true,
            },
          });
          queueMicrotask(() => { void host.client.request('turn/interrupt', { threadId, turnId }).catch(() => {}); });
        }
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
      await input.onEvent?.({
        method: 'zflow/native_context_prepared',
        params: {
          ...boundedContext.diagnostics,
          nativeThreadId: threadId,
        },
        threadId,
        ...input.identity,
      });
      const turnInput = await prepareNativeTurnInput(host, {
        userText: boundedContext.userText,
        images: boundedContext.images,
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
        const result = await Promise.race([turnFinished, timedOut, ...(processExited ? [processExited] : [])]);
        const completedLedger = completeNativeContextLedger(
          { ...boundedContext.ledger, nativeThreadId: threadId },
          {
            nativeThreadId: threadId,
            status: result.status,
            transportIncomplete: result.status === 'failed' && (
              result.error?.retryable === true
              || ['native_stream_disconnected', 'native_process_exited', 'native_turn_timeout'].includes(text(result.error?.code))
            ),
            userText: input.userText,
            assistantText: result.text,
          },
        );
        await updateThreadState(sessionId, {
          nativeCodex: {
            ...(persistedNative || {}),
            threadId,
            scopeId: host.scopeId,
            providerFingerprint,
            sourceCommit: host.capabilitySnapshot?.sourceCommit || null,
            targetCodexMainCommit: CODEX_MAIN_SNAPSHOT.sourceCommit,
            wireApi: CODEX_MAIN_SNAPSHOT.wireApi,
            protocolSchema: CODEX_MAIN_SNAPSHOT.protocolSchema,
            source: 'app_server',
            contractVersion: CURRENT_CONTRACT_VERSION,
            generation: boundedContext.generation,
            contextLedger: completedLedger,
          },
        });
        return result;
      } finally {
        if (timeout) clearTimeout(timeout);
      }
    } catch (error) {
      await updateThreadState(sessionId, {
        nativeCodex: {
          ...(persistedNative || {}),
          threadId,
          scopeId: host.scopeId,
          providerFingerprint,
          sourceCommit: host.capabilitySnapshot?.sourceCommit || null,
          targetCodexMainCommit: CODEX_MAIN_SNAPSHOT.sourceCommit,
          wireApi: CODEX_MAIN_SNAPSHOT.wireApi,
          protocolSchema: CODEX_MAIN_SNAPSHOT.protocolSchema,
          source: 'app_server',
          contractVersion: CURRENT_CONTRACT_VERSION,
          generation: boundedContext.generation,
          contextLedger: completeNativeContextLedger(
            { ...boundedContext.ledger, nativeThreadId: threadId },
            { nativeThreadId: threadId, status: 'failed', transportIncomplete: true, userText: input.userText, assistantText: finalText },
          ),
        },
      }).catch(() => {});
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
  }, () => busyResult(sessionId));
}
