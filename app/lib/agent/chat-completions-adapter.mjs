import { createHash } from 'node:crypto';
import {
  convertChatMessagesToGeminiRequest,
  requestGeminiChatStream,
  resolveGeminiFunctionCallingConfig,
  validateGeminiContents,
} from '../gemini-chat-transport.mjs';
import { assertGeminiSchemaCompatible, toGeminiSchema } from '../gemini-schema.mjs';
import { PRODUCTION_TIMEOUT_MS } from '../production-timeouts.mjs';

const clean = (v) => typeof v === 'string' ? v.trim() : '';
const hash = (v) => createHash('sha256').update(v).digest('hex');

export class ChatCompletionsError extends Error {
  constructor(message, code = 'chat_completions_error', retryable = false) {
    super(message); this.name = 'ChatCompletionsError'; this.code = code; this.retryable = retryable;
  }
}

function parseError(status, body) {
  const message = clean(body?.error?.message) || `Chat Completions request failed (${status})`;
  const retryable = [408, 429, 500, 502, 503, 504].includes(status);
  return Object.assign(new ChatCompletionsError(message, status === 401 || status === 403
    ? 'provider_unauthorized'
    : [502, 503, 504].includes(status) ? 'provider_unavailable' : `provider_http_${status}`, retryable), { status, structured: Boolean(body?.error && typeof body.error === 'object') });
}

export function chatCompletionsEndpoint(provider) {
  return `${String(provider?.baseUrl || '').replace(/\/+$/, '')}/chat/completions`;
}

export function chatCompletionsHeaders(provider) {
  return {
    authorization: `Bearer ${String(provider?.apiKey || '').replace(/^Bearer\s+/i, '')}`,
    'content-type': 'application/json',
    accept: 'text/event-stream',
  };
}

async function readErrorPayload(response) {
  if (!response.body) return {};
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = '';
  try {
    while (text.length < 65536) {
      const { done, value } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  try { return JSON.parse(text); } catch { return {}; }
}

export async function openChatCompletionsStream({ provider, body, signal }) {
  let response;
  try {
    response = await fetch(chatCompletionsEndpoint(provider), {
      method: 'POST',
      headers: chatCompletionsHeaders(provider),
      body: JSON.stringify({ ...body, stream: true }),
      signal,
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new ChatCompletionsError(error?.message || 'Provider connection failed', 'provider_transport', true);
  }
  if (!response.ok) throw parseError(response.status, await readErrorPayload(response));
  if (!response.body) throw new ChatCompletionsError('Provider returned no stream', 'provider_empty_stream');
  return response;
}

async function requestStreamOnce({ provider, body, signal }) {
  const controller = new AbortController();
  const onAbort = () => controller.abort(signal?.reason);
  signal?.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(() => controller.abort(new Error('provider_timeout')), PRODUCTION_TIMEOUT_MS);
  timer.unref?.();
  let response;
  try {
    response = await openChatCompletionsStream({ provider, body, signal: controller.signal });
  } catch (error) {
    if (controller.signal.aborted && !signal?.aborted) {
      throw new ChatCompletionsError('Provider request timed out', 'provider_timeout', true);
    }
    throw error;
  }
  const result = { text: '', toolCalls: new Map(), usage: null };
  let buffer = '';
  let terminal = false;
  let receivedBytes = 0;
  const decoder = new TextDecoder();
  const consume = (line) => {
    if (!line.startsWith('data:')) return;
    const value = line.slice(5).trim();
    if (!value) return;
    if (value === '[DONE]') { terminal = true; return; }
    let event; try { event = JSON.parse(value); } catch { throw new ChatCompletionsError('Provider returned malformed SSE JSON', 'provider_malformed_stream'); }
    if (event.error) throw new ChatCompletionsError('Provider returned a stream error', 'provider_stream_error');
    result.usage ||= event.usage || null;
    const choice = event.choices?.[0]; const delta = choice?.delta || {};
    if (typeof delta.content === 'string') result.text += delta.content;
    for (const call of delta.tool_calls || []) {
      const index = Number(call.index || 0); const current = result.toolCalls.get(index) || { id: '', name: '', arguments: '' };
      if (call.id) current.id = call.id; if (call.function?.name) current.name += call.function.name; if (call.function?.arguments) current.arguments += call.function.arguments;
      result.toolCalls.set(index, current);
    }
    if (choice?.finish_reason) terminal = true;
  };
  const reader = response.body.getReader();
  try {
    while (!terminal) {
      const { done, value } = await reader.read();
      if (done) break;
      receivedBytes += value.byteLength;
      if (receivedBytes > 4 * 1024 * 1024) throw new ChatCompletionsError('Provider stream exceeded the size limit', 'provider_stream_too_large');
      buffer += decoder.decode(value, { stream: true });
      let index;
      while ((index = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, index).replace(/\r$/, '');
        buffer = buffer.slice(index + 1);
        consume(line);
        if (terminal) break;
      }
    }
    buffer += decoder.decode();
    if (!terminal && buffer.trim()) consume(buffer.trim());
    if (!terminal) throw new ChatCompletionsError('Provider stream ended before completion', 'provider_incomplete_stream');
    if (!result.text.trim() && result.toolCalls.size === 0) throw new ChatCompletionsError('Provider returned an empty stream', 'provider_empty_stream');
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  return { ...result, toolCalls: [...result.toolCalls.values()] };
}

async function requestStream(input) {
  let lastError;
  const maxAttempts = Number.isInteger(input.maxAttempts) ? Math.max(1, input.maxAttempts) : 2;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try { return await requestStreamOnce(input); }
    catch (error) { lastError = error; if (!(error instanceof ChatCompletionsError) || !error.retryable || attempt === maxAttempts - 1) throw error; }
  }
  throw lastError;
}

function userContent(input) {
  const content = [{ type: 'text', text: input.userText }];
  for (const image of input.images || []) content.push({ type: 'image_url', image_url: { url: image } });
  return content;
}

function toolDefinitions(tools) { return tools.map((tool) => ({ type: 'function', function: { name: tool.name, description: tool.description, parameters: tool.parameters } })); }

function nativeGeminiImage(source) {
  const match = /^data:([^;,]+);base64,(.+)$/i.exec(String(source || ''));
  if (!match || !match[1].startsWith('image/') || !match[2]) {
    throw new ChatCompletionsError('Gemini image input must be a materialized data URL', 'provider_image_input_invalid');
  }
  return { inlineData: { mimeType: match[1], data: match[2] } };
}

async function requestAgentStream({ provider, body, signal }) {
  if (provider.protocol !== 'gemini') return requestStream({ provider, body, signal });
  const tools = Array.isArray(body.tools) ? body.tools : [];
  const converted = await convertChatMessagesToGeminiRequest(body.messages || [], {
    model: provider.model,
    signal,
    resolveImage: async (source) => nativeGeminiImage(source),
  });
  const requestBody = {
    ...converted,
    generationConfig: { maxOutputTokens: body.max_tokens || 4096 },
    ...(tools.length ? {
      tools: [{ functionDeclarations: tools.map((tool) => {
        const parameters = toGeminiSchema(tool.function?.parameters || { type: 'object', properties: {} });
        assertGeminiSchemaCompatible(parameters);
        return { name: tool.function?.name, description: tool.function?.description, parameters };
      }) }],
      toolConfig: { functionCallingConfig: resolveGeminiFunctionCallingConfig(body.tool_choice) },
    } : {}),
  };
  validateGeminiContents(requestBody.contents);
  let result;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      result = await requestGeminiChatStream({ provider, model: provider.model, body: requestBody, signal });
      break;
    } catch (error) {
      if (signal?.aborted || error?.retryable !== true || attempt === 1) throw error;
    }
  }
  return {
    text: result.content,
    toolCalls: result.toolCalls.map((call) => ({
      id: call.id,
      name: call.function?.name || '',
      arguments: call.function?.arguments || '',
      ...(call.thoughtSignature ? { thoughtSignature: call.thoughtSignature } : {}),
    })),
    usage: null,
    geminiParts: result.geminiParts,
  };
}

function agentToolResultContent(toolResult, includeImages) {
  const serialized = JSON.stringify(toolResult?.modelResult ?? toolResult ?? null);
  if (!includeImages) return serialized;
  const content = [{ type: 'text', text: serialized }];
  for (const reference of Array.isArray(toolResult?.visualReferences) ? toolResult.visualReferences : []) {
    const source = reference?.src || reference?.url || reference?.imageUrl;
    if (/^data:image\/[a-z0-9.+-]+;base64,/i.test(String(source || ''))) {
      content.push({ type: 'image_url', image_url: { url: source } });
    }
  }
  return content;
}

export async function runChatCompletionsTurn(input) {
  if (!input?.provider?.baseUrl || !input.provider.model) throw new ChatCompletionsError('Chat provider is not configured', 'provider_required');
  const isGemini = input.provider.protocol === 'gemini';
  const messages = isGemini
    ? [{ role: 'system', content: [input.baseInstructions, input.developerInstructions].filter(Boolean).join('\n\n') }, { role: 'user', content: userContent(input) }]
    : [{ role: 'system', content: input.baseInstructions }, { role: 'developer', content: input.developerInstructions }, { role: 'user', content: userContent(input) }];
  const tools = Array.isArray(input.tools) ? input.tools : [];
  const maxTurns = Number.isInteger(input.maxTurns) ? input.maxTurns : 12;
  let turnId = `chat-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  let finalText = '';
  for (let sample = 1; sample <= maxTurns; sample += 1) {
    if (input.signal?.aborted) return { status: 'cancelled', text: finalText, turnId };
    const result = await requestAgentStream({ provider: input.provider, body: { model: input.provider.model, messages, tools: toolDefinitions(tools), max_tokens: 4096 }, signal: input.signal });
    await input.onEvent?.({ method: 'zflow/model_sample_completed', params: { modelSampleIndex: sample, protocol: isGemini ? 'gemini' : 'chat_completions', hadPublicCommentary: result.text.length >= 20, promptHash: hash(JSON.stringify(messages)) }, ...input.identity, threadId: input.threadId || '', turnId });
    if (!result.toolCalls.length) { finalText = result.text.trim(); return { status: 'completed', text: finalText, threadId: input.threadId || '', turnId }; }
    const call = result.toolCalls[0];
    if (!call.id || !call.name) throw new ChatCompletionsError('Tool call is missing identity', 'provider_tool_call_invalid');
    if (!result.text.trim() || result.text.trim().length < 20) throw new ChatCompletionsError('decision_commentary_missing: model task description is required before a tool call', 'decision_commentary_missing', sample === 1);
    await input.onEvent?.({ method: 'item/started', params: { turnId, item: { id: call.id, type: 'dynamicToolCall', tool: call.name, status: 'in_progress' } }, ...input.identity, threadId: input.threadId || '', turnId });
    let args; try { args = call.arguments ? JSON.parse(call.arguments) : {}; } catch { throw new ChatCompletionsError('Tool arguments are malformed', 'invalid_tool_arguments'); }
    const definition = tools.find((tool) => tool.name === call.name); if (!definition) throw new ChatCompletionsError(`Tool is not allowed: ${call.name}`, 'tool_not_allowed');
    const toolResult = await input.executeTool(call.name, args, { threadId: input.threadId || '', turnId, toolCallId: call.id, signal: input.signal, onProgress: (event) => input.onEvent?.({ method: 'zflow/tool/progress', params: { ...event, callId: call.id, tool: call.name }, ...input.identity, threadId: input.threadId || '', turnId }) });
    await input.onEvent?.({ method: 'item/completed', params: { turnId, item: { id: call.id, type: 'dynamicToolCall', tool: call.name, status: toolResult?.isError ? 'failed' : 'completed', success: !toolResult?.isError } }, ...input.identity, threadId: input.threadId || '', turnId });
    messages.push({
      role: 'assistant', content: result.text || null,
      tool_calls: [{ id: call.id, type: 'function', ...(call.thoughtSignature ? { thoughtSignature: call.thoughtSignature } : {}), function: { name: call.name, arguments: call.arguments || '{}' } }],
      ...(isGemini ? { geminiParts: result.geminiParts, geminiSourceModel: input.provider.model } : {}),
    });
    messages.push({ role: 'tool', name: call.name, tool_call_id: call.id, content: agentToolResultContent(toolResult, isGemini) });
    if (toolResult?.confirmationRequired) return { status: 'waiting', text: finalText, threadId: input.threadId || '', turnId, pendingConfirmation: toolResult };
  }
  throw new ChatCompletionsError('Chat Completions turn budget exceeded', 'turn_budget_exceeded');
}

export { requestStream as requestChatCompletionsStream };
