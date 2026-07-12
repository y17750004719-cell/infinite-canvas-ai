function parseToolArguments(raw) {
  if (!raw) return {};
  if (typeof raw === 'object') return raw;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('Tool arguments must be an object');
    }
    return parsed;
  } catch (error) {
    throw new Error(`Invalid tool arguments: ${error instanceof Error ? error.message : 'invalid JSON'}`);
  }
}

function normalizeToolCalls(message) {
  return (Array.isArray(message?.tool_calls) ? message.tool_calls : [])
    .filter((call) => call?.function?.name)
    .map((call, index) => ({
      id: typeof call.id === 'string' && call.id ? call.id : `tool-call-${index + 1}`,
      type: 'function',
      function: {
        name: call.function.name,
        arguments: typeof call.function.arguments === 'string'
          ? call.function.arguments
          : JSON.stringify(call.function.arguments || {}),
      },
    }));
}

export async function runAgentLoop({
  messages,
  tools,
  modelFn,
  executeTool,
  isReadOnlyTool = (_name) => false,
  maxTurns = 6,
  maxToolCalls = 4,
  onToolStart,
  onToolResult,
}) {
  if (typeof modelFn !== 'function') throw new Error('Agent model is unavailable');
  if (typeof executeTool !== 'function') throw new Error('Agent tool executor is unavailable');
  const conversation = [...(Array.isArray(messages) ? messages : [])];
  let toolCallCount = 0;

  for (let turn = 1; turn <= maxTurns; turn += 1) {
    const response = await modelFn({ messages: conversation, tools });
    const message = response?.choices?.[0]?.message || {};
    const toolCalls = normalizeToolCalls(message);
    if (toolCalls.length === 0) {
      return {
        content: typeof message.content === 'string' ? message.content : '',
        reasoningContent: typeof message.reasoning_content === 'string' ? message.reasoning_content : '',
        turns: turn,
        toolCalls: toolCallCount,
        stopReason: 'completed',
      };
    }

    if (toolCallCount + toolCalls.length > maxToolCalls) {
      throw new Error('Agent tool call budget exceeded');
    }
    if (turn >= maxTurns) {
      throw new Error('Agent turn budget exceeded');
    }
    toolCallCount += toolCalls.length;
    conversation.push({
      role: 'assistant',
      content: typeof message.content === 'string' ? message.content : '',
      tool_calls: toolCalls,
    });

    const executeCall = async (call) => {
      const name = call.function.name;
      const args = parseToolArguments(call.function.arguments);
      await onToolStart?.({ id: call.id, name, args });
      const result = await executeTool(name, args, { toolCallId: call.id });
      await onToolResult?.({ id: call.id, name, result });
      return { call, result };
    };

    const readCalls = toolCalls.filter((call) => isReadOnlyTool(call.function.name));
    const mutationCalls = toolCalls.filter((call) => !isReadOnlyTool(call.function.name));
    const results = await Promise.all(readCalls.map(executeCall));
    for (const call of mutationCalls) {
      const executed = await executeCall(call);
      results.push(executed);
      if (executed.result?.confirmationRequired === true) {
        return {
          content: '',
          reasoningContent: '',
          turns: turn,
          toolCalls: toolCallCount,
          stopReason: 'confirmation_required',
          confirmation: {
            ...executed.result,
            arguments: parseToolArguments(executed.call.function.arguments),
          },
        };
      }
    }

    for (const { call, result } of results) {
      conversation.push({
        role: 'tool',
        tool_call_id: call.id,
        name: call.function.name,
        content: JSON.stringify(result ?? null),
      });
    }
  }

  throw new Error('Agent turn budget exceeded');
}
