const text = (value) => (typeof value === 'string' ? value : '');

function normalizeToolCallIndex(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

export function createChatStreamEventDecoder() {
  const openCalls = new Map();
  let geminiSequence = 0;
  const geminiCallIndexes = new Map();
  const geminiCallKeysByPartIndex = new Map();
  const geminiCallArguments = new Map();
  const geminiCallStarted = new Set();
  const geminiCallEnded = new Set();
  const geminiParts = [];
  let geminiLastFunctionCallIndex = -1;
  let geminiFunctionCallSeenInPayload = false;

  const cloneGeminiPart = (part) => ({
    ...part,
    ...(part?.thoughtSignature === undefined && typeof part?.thought_signature === 'string'
      ? { thoughtSignature: part.thought_signature }
      : {}),
    ...(part?.functionCall
      ? {
          functionCall: {
            ...part.functionCall,
            ...(text(part.functionCall.id) ? { id: text(part.functionCall.id) } : {}),
            ...(part.functionCall.args && typeof part.functionCall.args === 'object'
              ? { args: { ...part.functionCall.args } }
              : {}),
          },
        }
      : {}),
  });

  const hasGeminiPartData = (part) => Boolean(
    (typeof part?.text === 'string' && part.text.length > 0)
      || part?.functionCall
      || part?.functionResponse
      || part?.inlineData
      || part?.fileData
      || part?.executableCode
      || part?.codeExecutionResult,
  );

  const mergeGeminiPart = (part) => {
    const normalized = cloneGeminiPart(part);
    const last = geminiParts.at(-1);
    if (!hasGeminiPartData(normalized)) {
      if (last && typeof normalized.thoughtSignature === 'string') last.thoughtSignature = normalized.thoughtSignature;
      if (last && normalized.thought === true) last.thought = true;
      return last || null;
    }
    if (normalized?.functionCall?.name) {
      const id = text(normalized.functionCall.id);
      const existingIndex = id
        ? geminiParts.findIndex((candidate) => candidate?.functionCall?.id === id)
        : -1;
      const fallbackExistingIndex = existingIndex >= 0
        ? existingIndex
        : !geminiFunctionCallSeenInPayload && geminiLastFunctionCallIndex >= 0
          ? geminiLastFunctionCallIndex
          : -1;
      if (fallbackExistingIndex >= 0) {
        const existing = geminiParts[fallbackExistingIndex];
        if (!id && text(existing.functionCall.id)) normalized.functionCall.id = existing.functionCall.id;
        existing.functionCall = {
          ...existing.functionCall,
          ...normalized.functionCall,
          ...(existing.functionCall.args || normalized.functionCall.args
            ? { args: { ...(existing.functionCall.args || {}), ...(normalized.functionCall.args || {}) } }
            : {}),
        };
        if (typeof normalized.thoughtSignature === 'string') {
          existing.thoughtSignature = normalized.thoughtSignature;
        }
        geminiLastFunctionCallIndex = fallbackExistingIndex;
        geminiFunctionCallSeenInPayload = true;
        return existing;
      }
      geminiParts.push(normalized);
      geminiLastFunctionCallIndex = geminiParts.length - 1;
      geminiFunctionCallSeenInPayload = true;
      return normalized;
    }
    if (
      last
      && typeof last.text === 'string'
      && typeof normalized?.text === 'string'
      && last.thought === normalized.thought
    ) {
      last.text += normalized.text;
      if (typeof normalized.thoughtSignature === 'string') last.thoughtSignature = normalized.thoughtSignature;
      return last;
    }
    geminiParts.push(normalized);
    return normalized;
  };

  const finishOpenCalls = () => {
    const events = [];
    for (const [index, call] of [...openCalls.entries()].sort((left, right) => left[0] - right[0])) {
      if (!call.started) continue;
      events.push({
        type: 'tool_call_end',
        toolCallId: call.id,
        index,
        name: call.name,
        arguments: call.arguments,
      });
    }
    openCalls.clear();
    for (const [callKey, index] of [...geminiCallIndexes.entries()].sort((left, right) => left[1] - right[1])) {
      if (geminiCallEnded.has(callKey)) continue;
      const part = geminiParts.find((candidate) => {
        if (!candidate?.functionCall) return false;
        const id = text(candidate?.functionCall?.id);
        return id ? id === callKey : geminiCallIndexes.get(callKey) === index;
      });
      const call = part?.functionCall;
      if (!call?.name) continue;
      const args = JSON.stringify(geminiCallArguments.get(callKey) || call.args || {});
      events.push({
        type: 'tool_call_end',
        toolCallId: text(call.id) || `gemini-tool-${index + 1}`,
        index,
        name: call.name,
        arguments: args,
        ...(typeof part.thoughtSignature === 'string' ? { thoughtSignature: part.thoughtSignature } : {}),
      });
      geminiCallEnded.add(callKey);
    }
    if (geminiParts.length > 0) {
      events.push({ type: 'gemini_parts', parts: geminiParts });
    }
    return events;
  };

  const decodeGemini = (payload) => {
    const parts = Array.isArray(payload?.candidates?.[0]?.content?.parts)
      ? payload.candidates[0].content.parts
      : [];
    const events = [];
    geminiFunctionCallSeenInPayload = false;
    for (const part of parts) {
      const mergedPart = mergeGeminiPart(part);
      if (typeof part?.text === 'string' && part.text) {
        events.push({
          type: 'delta',
          channel: part.thought ? 'reasoning' : 'content',
          content: part.text,
          ...(typeof part.thoughtSignature === 'string'
            ? { thoughtSignature: part.thoughtSignature }
            : {}),
        });
      }
      if (part?.functionCall?.name) {
        const providedId = text(mergedPart?.functionCall?.id) || text(part.functionCall.id);
        const partIndex = geminiParts.indexOf(mergedPart);
        const callKey = providedId
          || geminiCallKeysByPartIndex.get(partIndex)
          || `gemini-call-${geminiSequence + 1}`;
        if (!providedId) geminiCallKeysByPartIndex.set(partIndex, callKey);
        let index = geminiCallIndexes.get(callKey);
        if (index === undefined) {
          index = geminiSequence;
          geminiSequence += 1;
          geminiCallIndexes.set(callKey, index);
        }
        const toolCallId = providedId || `gemini-tool-${index + 1}`;
        const argsObject = mergedPart?.functionCall?.args || {};
        const previousArgs = geminiCallArguments.get(callKey) || {};
        const args = JSON.stringify({ ...previousArgs, ...argsObject });
        geminiCallArguments.set(callKey, { ...previousArgs, ...argsObject });
        const isNewCall = !geminiCallStarted.has(callKey);
        if (isNewCall) {
          geminiCallStarted.add(callKey);
          events.push({ type: 'tool_call_start', toolCallId, index, name: part.functionCall.name });
          events.push({ type: 'tool_call_delta', toolCallId, index, argumentsDelta: args });
        }
      }
    }
    return events;
  };

  const decodeOpenAiToolCalls = (toolCalls, complete = false) => {
    const events = [];
    for (const [fallbackIndex, item] of (Array.isArray(toolCalls) ? toolCalls : []).entries()) {
      const index = normalizeToolCallIndex(item?.index, fallbackIndex);
      const call = openCalls.get(index) || { id: '', name: '', arguments: '', started: false };
      if (text(item?.id)) call.id = text(item.id);
      if (!call.id) call.id = `tool-call-${index + 1}`;
      if (text(item?.function?.name)) call.name += text(item.function.name);
      const argumentsDelta = text(item?.function?.arguments);
      if (!call.started) {
        call.started = true;
        events.push({
          type: 'tool_call_start',
          toolCallId: call.id,
          index,
          ...(call.name ? { name: call.name } : {}),
        });
      }
      if (argumentsDelta) {
        call.arguments += argumentsDelta;
        events.push({ type: 'tool_call_delta', toolCallId: call.id, index, argumentsDelta });
      }
      openCalls.set(index, call);
      if (complete) {
        events.push({
          type: 'tool_call_end',
          toolCallId: call.id,
          index,
          name: call.name,
          arguments: call.arguments,
        });
        openCalls.delete(index);
      }
    }
    return events;
  };

  return {
    decode(payload) {
      if (payload && typeof payload === 'object' && 'candidates' in payload) {
        return decodeGemini(payload);
      }
      const choice = payload?.choices?.[0] || {};
      const events = [];
      const reasoning = text(choice?.delta?.reasoning_content ?? choice?.message?.reasoning_content);
      const content = text(choice?.delta?.content ?? choice?.message?.content);
      if (reasoning) events.push({ type: 'delta', channel: 'reasoning', content: reasoning });
      if (content) events.push({ type: 'delta', channel: 'content', content });
      events.push(...decodeOpenAiToolCalls(choice?.delta?.tool_calls));
      events.push(...decodeOpenAiToolCalls(choice?.message?.tool_calls, true));
      if (choice?.finish_reason === 'tool_calls') events.push(...finishOpenCalls());
      return events;
    },
    flush: finishOpenCalls,
  };
}
