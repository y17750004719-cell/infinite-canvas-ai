import { createHash } from 'node:crypto';

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
  return new ChatCompletionsError(message, status === 401 || status === 403 ? 'provider_unauthorized' : `provider_http_${status}`, retryable);
}

async function requestStream({ provider, body, signal }) {
  let response;
  try { response = await fetch(`${provider.baseUrl.replace(/\/$/, '')}/chat/completions`, { method: 'POST', headers: { authorization: `Bearer ${provider.apiKey || ''}`, 'content-type': 'application/json', accept: 'text/event-stream' }, body: JSON.stringify({ ...body, stream: true }), signal }); }
  catch (error) { throw new ChatCompletionsError(error?.message || 'Provider connection failed', 'provider_transport', true); }
  if (!response.ok) throw parseError(response.status, await response.json().catch(() => ({})));
  if (!response.body) throw new ChatCompletionsError('Provider returned no stream', 'provider_empty_stream');
  const result = { text: '', toolCalls: new Map(), usage: null };
  let buffer = '';
  const consume = (line) => {
    if (!line.startsWith('data:')) return;
    const value = line.slice(5).trim(); if (!value || value === '[DONE]') return;
    let event; try { event = JSON.parse(value); } catch { throw new ChatCompletionsError('Provider returned malformed SSE JSON', 'provider_malformed_stream'); }
    result.usage ||= event.usage || null;
    const choice = event.choices?.[0]; const delta = choice?.delta || {};
    if (typeof delta.content === 'string') result.text += delta.content;
    for (const call of delta.tool_calls || []) {
      const index = Number(call.index || 0); const current = result.toolCalls.get(index) || { id: '', name: '', arguments: '' };
      if (call.id) current.id = call.id; if (call.function?.name) current.name += call.function.name; if (call.function?.arguments) current.arguments += call.function.arguments;
      result.toolCalls.set(index, current);
    }
  };
  for await (const chunk of response.body) { buffer += Buffer.from(chunk).toString('utf8'); let index; while ((index = buffer.indexOf('\n')) >= 0) { const line = buffer.slice(0, index).replace(/\r$/, ''); buffer = buffer.slice(index + 1); consume(line); } }
  if (buffer.trim()) consume(buffer.trim());
  return { ...result, toolCalls: [...result.toolCalls.values()] };
}

function userContent(input) {
  const content = [{ type: 'text', text: input.userText }];
  for (const image of input.images || []) content.push({ type: 'image_url', image_url: { url: image } });
  return content;
}

function toolDefinitions(tools) { return tools.map((tool) => ({ type: 'function', function: { name: tool.name, description: tool.description, parameters: tool.parameters } })); }

export async function runChatCompletionsTurn(input) {
  if (!input?.provider?.baseUrl || !input.provider.model) throw new ChatCompletionsError('Chat provider is not configured', 'provider_required');
  const messages = [{ role: 'system', content: input.baseInstructions }, { role: 'developer', content: input.developerInstructions }, { role: 'user', content: userContent(input) }];
  const tools = Array.isArray(input.tools) ? input.tools : [];
  const maxTurns = Number.isInteger(input.maxTurns) ? input.maxTurns : 12;
  let turnId = `chat-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  let finalText = '';
  for (let sample = 1; sample <= maxTurns; sample += 1) {
    if (input.signal?.aborted) return { status: 'cancelled', text: finalText, turnId };
    const result = await requestStream({ provider: input.provider, body: { model: input.provider.model, messages, tools: toolDefinitions(tools), max_tokens: 4096 }, signal: input.signal });
    await input.onEvent?.({ method: 'zflow/model_sample_completed', params: { modelSampleIndex: sample, protocol: 'chat_completions', hadPublicCommentary: result.text.length >= 20, promptHash: hash(JSON.stringify(messages)) }, ...input.identity, threadId: input.threadId || '', turnId });
    if (!result.toolCalls.length) { finalText = result.text.trim(); return { status: 'completed', text: finalText, threadId: input.threadId || '', turnId }; }
    const call = result.toolCalls[0];
    if (!call.id || !call.name) throw new ChatCompletionsError('Tool call is missing identity', 'provider_tool_call_invalid');
    if (!result.text.trim() || result.text.trim().length < 20) throw new ChatCompletionsError('decision_commentary_missing: model task description is required before a tool call', 'decision_commentary_missing', sample === 1);
    await input.onEvent?.({ method: 'item/started', params: { turnId, item: { id: call.id, type: 'dynamicToolCall', tool: call.name, status: 'in_progress' } }, ...input.identity, threadId: input.threadId || '', turnId });
    let args; try { args = call.arguments ? JSON.parse(call.arguments) : {}; } catch { throw new ChatCompletionsError('Tool arguments are malformed', 'invalid_tool_arguments'); }
    const definition = tools.find((tool) => tool.name === call.name); if (!definition) throw new ChatCompletionsError(`Tool is not allowed: ${call.name}`, 'tool_not_allowed');
    const toolResult = await input.executeTool(call.name, args, { threadId: input.threadId || '', turnId, toolCallId: call.id, signal: input.signal, onProgress: (event) => input.onEvent?.({ method: 'zflow/tool/progress', params: { ...event, callId: call.id, tool: call.name }, ...input.identity, threadId: input.threadId || '', turnId }) });
    await input.onEvent?.({ method: 'item/completed', params: { turnId, item: { id: call.id, type: 'dynamicToolCall', tool: call.name, status: toolResult?.isError ? 'failed' : 'completed', success: !toolResult?.isError } }, ...input.identity, threadId: input.threadId || '', turnId });
    messages.push({ role: 'assistant', content: result.text || null, tool_calls: [{ id: call.id, type: 'function', function: { name: call.name, arguments: call.arguments || '{}' } }] });
    messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(toolResult?.modelResult ?? toolResult ?? null) });
    if (toolResult?.confirmationRequired) return { status: 'waiting', text: finalText, threadId: input.threadId || '', turnId, pendingConfirmation: toolResult };
  }
  throw new ChatCompletionsError('Chat Completions turn budget exceeded', 'turn_budget_exceeded');
}

export { requestStream as requestChatCompletionsStream };
