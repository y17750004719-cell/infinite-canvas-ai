import { resolveProviderRequestTargets } from './provider-config.mjs';
import { createChatStreamEventDecoder } from './chat-stream-events.mjs';
import {
  extractGeminiToolCalls,
  geminiToolCallToPart,
  isSyntheticGeminiToolCallId,
  normalizeGeminiParts,
  replayGeminiParts,
} from './gemini-tool-calls.mjs';

export function geminiChatEndpoint(baseUrl, model, stream = false) {
  const root = resolveProviderRequestTargets(baseUrl).geminiBaseUrl.replace(/\/v1beta$/, '');
  const action = stream ? 'streamGenerateContent?alt=sse' : 'generateContent';
  return `${root}/v1beta/models/${encodeURIComponent(model)}:${action}`;
}

export function geminiChatHeaders(apiKey) {
  return {
    'content-type': 'application/json',
    'x-goog-api-key': String(apiKey || '').replace(/^Bearer\s+/i, ''),
  };
}

export function resolveGeminiFunctionCallingConfig(toolChoice) {
  if (toolChoice === 'none') return { mode: 'NONE' };
  if (toolChoice === 'required') return { mode: 'ANY' };
  if (toolChoice && typeof toolChoice === 'object') {
    return { mode: 'ANY', allowedFunctionNames: [toolChoice.function.name] };
  }
  return { mode: 'AUTO' };
}

export async function convertChatMessagesToGeminiRequest(messages, options = {}) {
  const { signal, model, resolveImage } = options;
  const systemTexts = messages
    .filter((message) => message.role === 'system')
    .flatMap((message) => typeof message.content === 'string'
      ? [message.content]
      : message.content.filter((part) => part.type === 'text').map((part) => part.text))
    .filter(Boolean);
  const contents = [];
  let pendingToolResponses = [];
  const flushToolResponses = () => {
    if (!pendingToolResponses.length) return;
    contents.push({ role: 'user', parts: pendingToolResponses });
    pendingToolResponses = [];
  };

  for (const message of messages.filter((item) => item.role !== 'system')) {
    if (message.role === 'tool') {
      let response = message.content;
      if (Array.isArray(message.content)) {
        const text = message.content.filter((part) => part.type === 'text').map((part) => part.text).filter(Boolean).join('\n');
        try { response = JSON.parse(text); } catch { response = { content: text }; }
      } else if (typeof message.content === 'string') {
        try { response = JSON.parse(message.content); } catch { response = { content: message.content }; }
      }
      pendingToolResponses.push({
        functionResponse: {
          name: message.name || 'tool',
          response: response && typeof response === 'object' ? response : { result: response },
          ...(message.tool_call_id && !isSyntheticGeminiToolCallId(message.tool_call_id) ? { id: message.tool_call_id } : {}),
        },
      });
      if (Array.isArray(message.content) && resolveImage) {
        for (const part of message.content) {
          if (part.type === 'image_url') pendingToolResponses.push(await resolveImage(part.image_url.url, signal));
        }
      }
      continue;
    }

    flushToolResponses();
    const replayed = message.role === 'assistant'
      ? replayGeminiParts(message.geminiParts || [], message.geminiSourceModel, model)
      : null;
    const parts = replayed || (typeof message.content === 'string'
      ? (message.content ? [{ text: message.content }] : [])
      : await Promise.all(message.content.map(async (part) => {
          if (part.type === 'text') return { text: part.text };
          if (!resolveImage) throw new Error('Gemini image resolver is required');
          return resolveImage(part.image_url.url, signal);
        })));
    if (!replayed && message.role === 'assistant' && Array.isArray(message.tool_calls)) {
      for (const toolCall of message.tool_calls) parts.push(geminiToolCallToPart(toolCall));
    }
    if (parts.length) contents.push({ role: message.role === 'assistant' ? 'model' : 'user', parts });
  }
  flushToolResponses();
  return {
    ...(systemTexts.length ? { systemInstruction: { parts: [{ text: systemTexts.join('\n\n') }] } } : {}),
    contents,
  };
}

export function validateGeminiContents(contents) {
  for (const [contentIndex, content] of contents.entries()) {
    for (const [partIndex, part] of (Array.isArray(content.parts) ? content.parts : []).entries()) {
      if (!part || typeof part !== 'object' || Array.isArray(part)) throw new Error(`Invalid Gemini Part at contents[${contentIndex}].parts[${partIndex}]`);
      if ('inline_data' in part || 'file_data' in part || 'thought_signature' in part) throw new Error(`Invalid Gemini Part field at contents[${contentIndex}].parts[${partIndex}]`);
      const hasData = (typeof part.text === 'string' && part.text.length > 0)
        || part.functionCall || part.functionResponse || part.inlineData || part.fileData
        || part.executableCode || part.codeExecutionResult;
      if (!hasData) throw new Error(`Empty Gemini Part at contents[${contentIndex}].parts[${partIndex}]`);
      if (part.inlineData && (!String(part.inlineData.mimeType || '').startsWith('image/') || !part.inlineData.data)) {
        throw new Error(`Invalid Gemini inlineData at contents[${contentIndex}].parts[${partIndex}]`);
      }
      if (part.functionResponse && typeof part.functionResponse === 'object' && !Array.isArray(part.functionResponse)
        && 'thoughtSignature' in part.functionResponse) {
        throw new Error(`Gemini functionResponse cannot contain thoughtSignature at contents[${contentIndex}].parts[${partIndex}]`);
      }
    }
  }
}

export function extractGeminiTextResponse(payload) {
  const parts = normalizeGeminiParts(Array.isArray(payload?.candidates?.[0]?.content?.parts)
    ? payload.candidates[0].content.parts
    : []);
  let content = '';
  let reasoning = '';
  const toolCalls = extractGeminiToolCalls(parts);
  for (const part of parts) {
    if (typeof part.text !== 'string' || !part.text) continue;
    if (part.thought) reasoning += part.text;
    else content += part.text;
  }
  return { content, reasoning, toolCalls, geminiParts: parts };
}

export async function openGeminiChatStream({ provider, model, body, signal }) {
  let response;
  try {
    response = await fetch(geminiChatEndpoint(provider.baseUrl, model, true), {
      method: 'POST', headers: geminiChatHeaders(provider.apiKey), body: JSON.stringify(body), signal,
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw Object.assign(new Error('Gemini provider connection failed'), { code: 'provider_transport', retryable: true });
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    const error = new Error(`供应商返回 HTTP ${response.status}`);
    error.status = response.status;
    error.code = response.status === 401 || response.status === 403
      ? 'provider_unauthorized'
      : [502, 503, 504].includes(response.status) ? 'provider_unavailable' : `provider_http_${response.status}`;
    error.retryable = [408, 429, 500, 502, 503, 504].includes(response.status);
    throw error;
  }
  if (!response.body) throw Object.assign(new Error('供应商返回空响应流'), { code: 'provider_empty_stream' });
  return response;
}

export async function requestGeminiChatStream(input) {
  const response = await openGeminiChatStream(input);
  const decoder = createChatStreamEventDecoder();
  const events = [];
  for await (const payload of iterateGeminiSsePayloads(response)) events.push(...decoder.decode(payload));
  events.push(...decoder.flush());
  const toolCalls = events.filter((event) => event.type === 'tool_call_end').map((event) => ({
    id: event.toolCallId,
    type: 'function',
    ...(typeof event.thoughtSignature === 'string' ? { thoughtSignature: event.thoughtSignature } : {}),
    function: { name: event.name, arguments: event.arguments },
  }));
  const rawParts = events.findLast((event) => event.type === 'gemini_parts')?.parts || [];
  return {
    content: events.filter((event) => event.type === 'delta' && event.channel === 'content').map((event) => event.content).join(''),
    reasoning: events.filter((event) => event.type === 'delta' && event.channel === 'reasoning').map((event) => event.content).join(''),
    toolCalls,
    geminiParts: rawParts,
  };
}

export async function* iterateGeminiSsePayloads(response) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let terminal = false;
  let receivedBytes = 0;
  try {
    while (!terminal) {
      const { done, value } = await reader.read();
      if (done) break;
      receivedBytes += value.byteLength;
      if (receivedBytes > 4 * 1024 * 1024) throw Object.assign(new Error('Gemini 流超过检测上限'), { code: 'provider_stream_too_large' });
      buffer += decoder.decode(value, { stream: true });
      let newline;
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline).replace(/\r$/, '');
        buffer = buffer.slice(newline + 1);
        if (!line.startsWith('data:')) continue;
        const raw = line.slice(5).trim();
        if (!raw) continue;
        if (raw === '[DONE]') { terminal = true; break; }
        let payload;
        try { payload = JSON.parse(raw); } catch { throw Object.assign(new Error('供应商返回损坏的 Gemini 流'), { code: 'provider_malformed_stream' }); }
        const finishReasons = (payload?.candidates || []).map((candidate) => candidate.finishReason).filter(Boolean);
        const blocked = finishReasons.find((reason) => !['STOP', 'MAX_TOKENS'].includes(reason));
        if (blocked) throw Object.assign(new Error('Gemini 响应被供应商阻止'), { code: 'provider_blocked_response', finishReason: blocked });
        yield payload;
        if (finishReasons.length) { terminal = true; break; }
      }
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  if (!terminal) throw Object.assign(new Error('Gemini 流在完成事件前结束'), { code: 'provider_truncated_stream' });
}
