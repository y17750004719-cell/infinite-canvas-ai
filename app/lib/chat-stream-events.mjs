const text = (value) => (typeof value === 'string' ? value : '');

function normalizeToolCallIndex(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

export function createChatStreamEventDecoder() {
  const openCalls = new Map();
  let geminiSequence = 0;

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
    return events;
  };

  const decodeGemini = (payload) => {
    const parts = Array.isArray(payload?.candidates?.[0]?.content?.parts)
      ? payload.candidates[0].content.parts
      : [];
    const events = [];
    for (const part of parts) {
      if (typeof part?.text === 'string' && part.text) {
        events.push({
          type: 'delta',
          channel: part.thought ? 'reasoning' : 'content',
          content: part.text,
        });
      }
      if (part?.functionCall?.name) {
        const index = geminiSequence;
        geminiSequence += 1;
        const toolCallId = `gemini-tool-${index + 1}`;
        const args = JSON.stringify(part.functionCall.args || {});
        events.push({ type: 'tool_call_start', toolCallId, index, name: part.functionCall.name });
        events.push({ type: 'tool_call_delta', toolCallId, index, argumentsDelta: args });
        events.push({
          type: 'tool_call_end',
          toolCallId,
          index,
          name: part.functionCall.name,
          arguments: args,
        });
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
