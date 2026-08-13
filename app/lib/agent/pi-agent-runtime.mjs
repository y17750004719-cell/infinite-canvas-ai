import {
  runAgentLoop,
  runAgentLoopContinue,
} from '@earendil-works/pi-agent-core';
import { validateAgentToolArguments } from './tool-registry.mjs';

const emptyUsage = () => ({
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
});

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function text(value) {
  return typeof value === 'string' ? value : '';
}

function createStream() {
  const queue = [];
  const waiters = [];
  let ended = false;
  let finalResult;

  const settle = () => {
    while (waiters.length > 0 && queue.length > 0) {
      waiters.shift()({ value: queue.shift(), done: false });
    }
    if (ended && queue.length === 0) {
      while (waiters.length > 0) waiters.shift()({ value: undefined, done: true });
    }
  };

  return {
    push(event) {
      if (ended) return;
      queue.push(event);
      settle();
    },
    end(result) {
      if (ended) return;
      finalResult = result;
      ended = true;
      settle();
    },
    result: async () => finalResult,
    [Symbol.asyncIterator]() {
      return {
        next: () => {
          if (queue.length > 0) return Promise.resolve({ value: queue.shift(), done: false });
          if (ended) return Promise.resolve({ value: undefined, done: true });
          return new Promise((resolve) => waiters.push(resolve));
        },
      };
    },
  };
}

function createPiModel({ providerId, model, metadata = {} }) {
  return {
    id: model,
    name: model,
    api: 'zflow-provider-bridge',
    provider: providerId,
    baseUrl: '',
    reasoning: metadata.reasoning === true,
    input: Array.isArray(metadata.input) && metadata.input.length > 0 ? metadata.input : ['text', 'image'],
    cost: metadata.cost || { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: Number.isFinite(Number(metadata.contextWindow)) ? Number(metadata.contextWindow) : 32_000,
    maxTokens: Number.isFinite(Number(metadata.maxTokens)) ? Number(metadata.maxTokens) : 4096,
  };
}

function piContentToChatContent(content) {
  if (typeof content === 'string') return content;
  const parts = Array.isArray(content) ? content : [];
  const result = [];
  for (const part of parts) {
    if (part?.type === 'text' && typeof part.text === 'string') {
      result.push({ type: 'text', text: part.text });
    } else if (part?.type === 'image' && typeof part.data === 'string' && typeof part.mimeType === 'string') {
      result.push({
        type: 'image_url',
        image_url: { url: `data:${part.mimeType};base64,${part.data}` },
      });
    }
  }
  return result.length > 0 ? result : '';
}

function piMessageToChatMessage(message) {
  if (message?.role === 'user') {
    return { role: 'user', content: piContentToChatContent(message.content) };
  }
  if (message?.role === 'toolResult') {
    const content = Array.isArray(message.content)
      ? message.content.filter((part) => part?.type === 'text').map((part) => part.text).join('\n')
      : text(message.content);
    const toolMessage = {
      role: 'tool',
      tool_call_id: message.toolCallId,
      name: message.toolName,
      content: content || JSON.stringify(message.details ?? null),
    };
    const visualReferences = Array.isArray(message.details?.visualReferences)
      ? message.details.visualReferences
        .filter((reference) => typeof reference?.src === 'string' && reference.src.trim())
        .slice(0, 4)
      : [];
    if (visualReferences.length === 0) return toolMessage;
    return [
      toolMessage,
      {
        // Chat Completions tool messages do not consistently accept image parts.
        // Preserve the tool result, then attach the validated visuals as the next input.
        role: 'user',
        content: visualReferences.flatMap((reference, index) => [
          { type: 'text', text: `Visual reference ${index + 1}${reference.id ? ` (ID: ${reference.id})` : ''}${reference.label ? `: ${reference.label}` : ''}.` },
          { type: 'image_url', image_url: { url: reference.src } },
        ]),
      },
    ];
  }
  if (message?.role === 'assistant') {
    const textParts = [];
    const reasoningParts = [];
    const toolCalls = [];
    for (const part of Array.isArray(message.content) ? message.content : []) {
      if (part?.type === 'text' && typeof part.text === 'string') textParts.push(part.text);
      if (part?.type === 'thinking' && typeof part.thinking === 'string') reasoningParts.push(part.thinking);
      if (part?.type === 'toolCall') {
        toolCalls.push({
          id: text(part.id),
          type: 'function',
          function: {
            name: text(part.name),
            arguments: JSON.stringify(part.arguments || {}),
          },
        });
      }
    }
    return {
      role: 'assistant',
      content: textParts.join(''),
      ...(reasoningParts.length > 0 ? { reasoning_content: reasoningParts.join('') } : {}),
      ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
    };
  }
  return null;
}

export function convertPiMessagesToChatMessages(messages) {
  return (Array.isArray(messages) ? messages : [])
    .flatMap((message) => piMessageToChatMessage(message) || [])
    .filter(Boolean);
}

function chatContentToPiContent(content) {
  if (typeof content === 'string') return content ? [{ type: 'text', text: content }] : [];
  return (Array.isArray(content) ? content : []).flatMap((part) => {
    if (part?.type === 'text' && typeof part.text === 'string') return [{ type: 'text', text: part.text }];
    if (part?.type === 'image_url' && typeof part.image_url?.url === 'string') {
      const match = /^data:([^;]+);base64,(.*)$/s.exec(part.image_url.url);
      return match ? [{ type: 'image', mimeType: match[1], data: match[2] }] : [];
    }
    return [];
  });
}

export function convertChatMessagesToPiMessages(messages, model) {
  return (Array.isArray(messages) ? messages : []).flatMap((message) => {
    if (message?.role === 'system') return [];
    if (message?.role === 'user') {
      return [{ role: 'user', content: chatContentToPiContent(message.content), timestamp: Date.now() }];
    }
    if (message?.role === 'tool') {
      return [{
        role: 'toolResult',
        toolCallId: text(message.tool_call_id),
        toolName: text(message.name) || 'tool',
        content: [{ type: 'text', text: text(message.content) }],
        details: message.content,
        isError: false,
        timestamp: Date.now(),
      }];
    }
    if (message?.role === 'assistant') {
      const content = [];
      if (typeof message.content === 'string' && message.content) content.push({ type: 'text', text: message.content });
      if (typeof message.reasoning_content === 'string' && message.reasoning_content) {
        content.push({ type: 'thinking', thinking: message.reasoning_content });
      }
      for (const call of Array.isArray(message.tool_calls) ? message.tool_calls : []) {
        let args = {};
        try {
          const parsed = JSON.parse(call?.function?.arguments || '{}');
          if (isObject(parsed)) args = parsed;
        } catch {
          args = {};
        }
        content.push({
          type: 'toolCall',
          id: text(call?.id),
          name: text(call?.function?.name),
          arguments: args,
        });
      }
      return [{
        role: 'assistant',
        content,
        api: model.api,
        provider: model.provider,
        model: model.id,
        usage: emptyUsage(),
        stopReason: content.some((part) => part.type === 'toolCall') ? 'toolUse' : 'stop',
        timestamp: Date.now(),
      }];
    }
    return [];
  });
}

function createAssistantMessage(model, content = [], stopReason = 'pending', errorMessage) {
  return {
    role: 'assistant',
    content,
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: emptyUsage(),
    stopReason,
    ...(errorMessage ? { errorMessage } : {}),
    timestamp: Date.now(),
  };
}

function createProviderStreamFn({ chatStream, toolChoice = 'auto' }) {
  return async (model, context, options = {}) => {
    const stream = createStream();
    void (async () => {
      const content = [];
      const toolCalls = new Map();
      const toolArgumentBuffers = new Map();
      let textIndex = -1;
      let thinkingIndex = -1;
      let malformedToolArguments = false;
      let finalMessage = createAssistantMessage(model, content);
      const emit = (event) => stream.push(event);
      try {
        emit({ type: 'start', partial: finalMessage });
        const request = {
          providerId: model.provider,
          model: model.id,
          messages: convertPiMessagesToChatMessages(context.messages),
          tools: (Array.isArray(context.tools) ? context.tools : []).map((tool) => ({
            type: 'function',
            function: {
              name: tool.name,
              description: tool.description,
              parameters: tool.parameters,
            },
          })),
          toolChoice,
          signal: options.signal,
          stream: true,
        };
        for await (const event of chatStream(request)) {
          if (event.type === 'delta' && event.channel === 'content') {
            if (textIndex < 0) {
              content.push({ type: 'text', text: '' });
              textIndex = content.length - 1;
              emit({ type: 'text_start', contentIndex: textIndex, partial: finalMessage });
            }
            content[textIndex].text += event.content;
            finalMessage = createAssistantMessage(model, content, 'pending');
            emit({ type: 'text_delta', contentIndex: textIndex, delta: event.content, partial: finalMessage });
          } else if (event.type === 'delta' && event.channel === 'reasoning') {
            if (thinkingIndex < 0) {
              content.push({ type: 'thinking', thinking: '' });
              thinkingIndex = content.length - 1;
              emit({ type: 'thinking_start', contentIndex: thinkingIndex, partial: finalMessage });
            }
            content[thinkingIndex].thinking += event.content;
            finalMessage = createAssistantMessage(model, content, 'pending');
            emit({ type: 'thinking_delta', contentIndex: thinkingIndex, delta: event.content, partial: finalMessage });
          } else if (event.type === 'tool_call_start') {
            const block = { type: 'toolCall', id: event.toolCallId, name: event.name || '', arguments: {} };
            toolCalls.set(event.index, block);
            toolArgumentBuffers.set(event.index, '');
            content.push(block);
            finalMessage = createAssistantMessage(model, content, 'toolUse');
            emit({ type: 'toolcall_start', contentIndex: content.length - 1, partial: finalMessage });
          } else if (event.type === 'tool_call_delta') {
            toolArgumentBuffers.set(event.index, `${toolArgumentBuffers.get(event.index) || ''}${event.argumentsDelta}`);
            finalMessage = createAssistantMessage(model, content, 'toolUse');
            emit({ type: 'toolcall_delta', contentIndex: content.findIndex((part) => part === toolCalls.get(event.index)), delta: event.argumentsDelta, partial: finalMessage });
          } else if (event.type === 'tool_call_end') {
            const block = toolCalls.get(event.index);
            if (block) {
              block.name = event.name || block.name;
              try {
                const parsed = JSON.parse(event.arguments || toolArgumentBuffers.get(event.index) || '{}');
                if (!isObject(parsed)) throw new Error('Tool arguments must be an object');
                block.arguments = parsed;
              } catch {
                malformedToolArguments = true;
                block.arguments = {};
              }
              finalMessage = createAssistantMessage(model, content, malformedToolArguments ? 'length' : 'toolUse');
              emit({ type: 'toolcall_end', contentIndex: content.findIndex((part) => part === block), toolCall: block, partial: finalMessage });
            }
          }
        }
        if (textIndex >= 0) {
          emit({ type: 'text_end', contentIndex: textIndex, content: content[textIndex]?.text || '', partial: finalMessage });
        }
        if (thinkingIndex >= 0) {
          emit({ type: 'thinking_end', contentIndex: thinkingIndex, content: content[thinkingIndex]?.thinking || '', partial: finalMessage });
        }
        const stopReason = malformedToolArguments
          ? 'length'
          : toolCalls.size > 0
            ? 'toolUse'
            : 'stop';
        finalMessage = createAssistantMessage(model, content, stopReason);
        emit({ type: 'done', reason: stopReason, message: finalMessage });
        stream.end(finalMessage);
      } catch (error) {
        const aborted = options.signal?.aborted === true;
        finalMessage = createAssistantMessage(
          model,
          content,
          aborted ? 'aborted' : 'error',
          error instanceof Error ? error.message : String(error),
        );
        emit({ type: 'error', reason: aborted ? 'aborted' : 'error', error: finalMessage });
        stream.end(finalMessage);
      }
    })();
    return stream;
  };
}

function latestAssistantMessage(messages) {
  return [...(Array.isArray(messages) ? messages : [])].reverse().find((message) => message?.role === 'assistant') || null;
}

function normalizeToolDefinition(entry) {
  const fn = entry?.function;
  return {
    name: text(entry?.name || fn?.name),
    description: text(entry?.description || fn?.description),
    parameters: entry?.parameters || fn?.parameters || { type: 'object', properties: {} },
    readOnly: entry?.readOnly === true,
    terminal: entry?.terminal === true,
    countAgainstToolBudget: entry?.countAgainstToolBudget !== false,
    requiresConfirmation: entry?.requiresConfirmation === true,
    confirmationMessage: text(entry?.confirmationMessage),
  };
}

function continuationMessages(transcript, pendingCall, toolResult) {
  const batchCallIds = new Set(
    (Array.isArray(pendingCall?.batch) ? pendingCall.batch : [pendingCall])
      .map((call) => text(call?.id))
      .filter(Boolean),
  );
  const messages = (Array.isArray(transcript) ? transcript : [])
    .filter((message) => message?.role !== 'toolResult' || !batchCallIds.has(text(message.toolCallId)));
  const batch = Array.isArray(pendingCall?.batch) ? pendingCall.batch : [pendingCall];
  for (const call of batch) {
    const confirmed = text(call?.id) === text(pendingCall?.id);
    const result = confirmed ? toolResult : {
      modelResult: { skipped: true, reason: 'Another tool call in this batch required confirmation' },
      publicResult: { skipped: true },
    };
    messages.push({
      role: 'toolResult',
      toolCallId: text(call?.id),
      toolName: text(call?.name),
      content: [{ type: 'text', text: JSON.stringify(result?.modelResult ?? result ?? null) }],
      details: {
        ...(isObject(result?.publicResult) ? result.publicResult : { value: result?.publicResult ?? result }),
        ...(Array.isArray(result?.visualReferences) ? { visualReferences: result.visualReferences } : {}),
      },
      isError: false,
      timestamp: Date.now(),
    });
  }
  return messages;
}

/** @param {Record<string, any>} input */
export async function runZFlowAgentBrain({
  messages = [],
  systemPrompt = '',
  providerId,
  model,
  modelMetadata,
  tools = [],
  toolChoice = 'auto',
  maxTurns = 6,
  maxToolCalls = 4,
  reserveClosingTurn = false,
  requireMutationTool = false,
  signal,
  chatStream,
  executeTool,
  onEvent,
  onToolStart,
  onToolUpdate,
  onToolResult,
  continuation,
} = {}) {
  if (typeof providerId !== 'string' || !providerId || typeof model !== 'string' || !model) {
    throw new Error('Agent provider and model are required');
  }
  if (typeof chatStream !== 'function') throw new Error('Agent chat stream is unavailable');
  if (typeof executeTool !== 'function') throw new Error('Agent tool executor is unavailable');

  const piModel = createPiModel({ providerId, model, metadata: modelMetadata });
  const counters = {
    turnCount: Number(continuation?.budgets?.turnsUsed) || 0,
    toolCallCount: Number(continuation?.budgets?.toolCallsUsed) || 0,
    mutationToolCallCount: Number(continuation?.budgets?.mutationToolCallsUsed) || 0,
    budgetedToolCallCount: Number(continuation?.budgets?.budgetedToolCallsUsed) || 0,
    executionCorrectionUsed: false,
    budgetExceeded: false,
    executionRequired: false,
    invalidToolArguments: '',
    truncatedToolCall: false,
    closingError: '',
    pendingConfirmation: null,
    terminal: null,
  };
  const rawResults = new Map();
  const pendingToolStarts = new Map();
  const batchCounts = new WeakMap();
  const toolCallBatches = new Map();
  const normalizedTools = (Array.isArray(tools) ? tools : []).map(normalizeToolDefinition);
  if (toolChoice && typeof toolChoice === 'object') {
    const requiredToolName = text(toolChoice?.function?.name);
    if (!requiredToolName || !normalizedTools.some((tool) => tool.name === requiredToolName)) {
      throw new Error(`Required Agent tool is unavailable: ${requiredToolName || 'unknown'}`);
    }
  }
  const closingToolNames = new Set(
    normalizedTools
      .filter((tool) => tool.terminal === true && tool.countAgainstToolBudget === false)
      .map((tool) => tool.name),
  );
  const piTools = normalizedTools.map((entry) => ({
    name: entry.name,
    description: entry.description || entry.name,
    parameters: entry.parameters || { type: 'object', properties: {} },
    executionMode: 'sequential',
    execute: async (toolCallId, args, toolSignal, onUpdate) => {
      const result = await executeTool(entry.name, args, { toolCallId, signal: toolSignal, onUpdate });
      rawResults.set(toolCallId, result);
      if (result?.confirmationRequired === true) {
        counters.pendingConfirmation = {
          toolCallId,
          toolName: entry.name,
          arguments: args,
          batch: toolCallBatches.get(toolCallId) || [{ id: toolCallId, name: entry.name, args }],
          ...result,
        };
        return {
          content: [{ type: 'text', text: text(result.message) || `Confirmation required for ${entry.name}` }],
          details: result,
          terminate: true,
        };
      }
      const modelResult = result?.modelResult ?? result;
      const publicResult = result?.publicResult ?? result;
      if (entry.terminal === true) counters.terminal = result;
      return {
        content: [{ type: 'text', text: JSON.stringify(modelResult ?? null) }],
        details: {
          ...(isObject(publicResult) ? publicResult : { value: publicResult }),
          ...(Array.isArray(result?.visualReferences) ? { visualReferences: result.visualReferences } : {}),
        },
        terminate: result?.terminate === true || entry.terminal === true,
      };
    },
  }));
  const closingPiTools = piTools.filter((tool) => closingToolNames.has(tool.name));
  const closingState = {
    active: reserveClosingTurn && (
      counters.budgetedToolCallCount >= maxToolCalls
      || counters.turnCount >= Math.max(0, maxTurns - 1)
    ),
    steeringPending: false,
    skipCurrentStop: false,
    requested: false,
  };
  if (closingState.active) closingState.steeringPending = true;
  const activateClosingTurn = () => {
    if (closingState.active) return;
    closingState.active = true;
    closingState.steeringPending = true;
    closingState.skipCurrentStop = true;
  };

  const actualStreamFn = createProviderStreamFn({ chatStream, toolChoice });
  const resolvedSystemPrompt = systemPrompt || (Array.isArray(messages) ? messages : [])
    .filter((message) => message?.role === 'system' && typeof message.content === 'string')
    .map((message) => message.content)
    .join('\n\n');
  const piMessages = convertChatMessagesToPiMessages(messages, piModel);
  const prompt = piMessages.at(-1);
  if (!continuation && (!prompt || prompt.role !== 'user')) throw new Error('Agent prompt must end with a user message');
  const initialContext = {
    systemPrompt: resolvedSystemPrompt,
    messages: piMessages.slice(0, -1),
    tools: closingState.active ? closingPiTools : piTools,
  };

  const config = {
    model: piModel,
    toolExecution: 'sequential',
    convertToLlm: (items) => items.filter((item) => item?.role === 'user' || item?.role === 'assistant' || item?.role === 'toolResult'),
    transformContext: async (items) => items,
    beforeToolCall: async ({ assistantMessage }) => {
      if (counters.invalidToolArguments) return { block: true, reason: counters.invalidToolArguments };
      if (counters.budgetExceeded) return { block: true, reason: 'Agent tool call budget exceeded' };
      if (counters.pendingConfirmation) return { block: true, reason: 'Another tool call is awaiting confirmation' };
      if (!batchCounts.has(assistantMessage)) {
        const calls = assistantMessage.content.filter((part) => part?.type === 'toolCall');
        const batch = calls.map((call) => ({ id: call.id, name: call.name, args: call.arguments || {} }));
        for (const call of batch) toolCallBatches.set(call.id, batch);
        if (closingState.active) {
          const unavailableCall = calls.find((call) => !closingToolNames.has(call.name));
          if (unavailableCall) {
            counters.closingError = `Closing turn cannot call ${unavailableCall.name}`;
            batchCounts.set(assistantMessage, calls.length);
            return { block: true, reason: counters.closingError };
          }
        }
        try {
          for (const call of batch) {
            const tool = normalizedTools.find((entry) => entry.name === call.name);
            if (!tool) throw new Error(`Unknown tool: ${call.name}`);
            validateAgentToolArguments(tool.parameters, call.args, call.name);
          }
        } catch (error) {
          counters.invalidToolArguments = error instanceof Error ? error.message : String(error);
          batchCounts.set(assistantMessage, calls.length);
          return { block: true, reason: counters.invalidToolArguments };
        }
        const budgetedCalls = calls.filter((call) => (
          normalizedTools.find((tool) => tool.name === call.name)?.countAgainstToolBudget !== false
        ));
        const terminalOnly = calls.length > 0 && calls.every((call) => (
          normalizedTools.find((tool) => tool.name === call.name)?.terminal === true
        ));
        const nextCount = counters.budgetedToolCallCount + budgetedCalls.length;
        batchCounts.set(assistantMessage, calls.length);
        if (nextCount > maxToolCalls && reserveClosingTurn && !closingState.active) {
          closingState.requested = true;
          batchCounts.set(assistantMessage, calls.length);
          return { block: true, reason: 'Context query budget reached; finish without more reads' };
        }
        if (nextCount > maxToolCalls || (counters.turnCount >= maxTurns && !terminalOnly)) {
          counters.budgetExceeded = true;
          return { block: true, reason: 'Agent tool call budget exceeded' };
        }
        counters.toolCallCount += calls.length;
        counters.budgetedToolCallCount = nextCount;
        counters.mutationToolCallCount += calls.filter((call) => !normalizedTools.find((tool) => tool.name === call.name)?.readOnly).length;
        const confirmationCall = calls.find((call) => normalizedTools.find((tool) => tool.name === call.name)?.requiresConfirmation);
        if (confirmationCall) {
          const confirmationTool = normalizedTools.find((tool) => tool.name === confirmationCall.name);
          counters.pendingConfirmation = {
            toolCallId: confirmationCall.id,
            toolName: confirmationCall.name,
            arguments: confirmationCall.arguments || {},
            batch,
            message: confirmationTool?.confirmationMessage || `Confirmation required for ${confirmationCall.name}`,
          };
        }
      }
      if (counters.pendingConfirmation) return { block: true, reason: 'Tool batch paused for confirmation' };
      return undefined;
    },
    prepareNextTurn: async ({ message, context }) => {
      const usedTool = message?.content?.some((part) => part?.type === 'toolCall') === true;
      if (
        reserveClosingTurn
        && !closingState.active
        && !counters.terminal
        && !counters.pendingConfirmation
        && usedTool
        && (
          closingState.requested
          || counters.budgetedToolCallCount >= maxToolCalls
          || counters.turnCount >= Math.max(0, maxTurns - 1)
        )
      ) activateClosingTurn();
      if (!closingState.active) return undefined;
      return {
        context: {
          ...context,
          tools: closingPiTools,
        },
      };
    },
    shouldStopAfterTurn: async ({ message }) => {
      if (message?.stopReason === 'length' && message.content?.some((part) => part?.type === 'toolCall')) {
        counters.truncatedToolCall = true;
        return true;
      }
      if (counters.budgetExceeded) return true;
      if (counters.invalidToolArguments) return true;
      if (counters.pendingConfirmation) return true;
      if (counters.terminal) return true;
      if (closingState.skipCurrentStop) {
        closingState.skipCurrentStop = false;
        return false;
      }
      if (closingState.active) {
        if (counters.closingError) return true;
        if (counters.terminal) return true;
        const closingToolCalls = message?.content?.filter((part) => part?.type === 'toolCall') || [];
        const unavailableCall = closingToolCalls.find((part) => !closingToolNames.has(part.name));
        if (unavailableCall) {
          counters.closingError = `Closing turn cannot call ${unavailableCall.name}`;
          return true;
        }
        const hasToolCall = closingToolCalls.length > 0;
        const hasFinalText = message?.content?.some((part) => part?.type === 'text' && part.text.trim()) === true;
        if (!hasToolCall && hasFinalText) return true;
        counters.closingError = 'Agent closing turn ended without a final response or terminal control';
        return true;
      }
      if (counters.turnCount >= maxTurns) {
        counters.budgetExceeded = true;
        return true;
      }
      if (requireMutationTool && counters.executionCorrectionUsed && counters.mutationToolCallCount === 0 && !message.content.some((part) => part.type === 'toolCall')) {
        counters.executionRequired = true;
        return true;
      }
      return false;
    },
    getSteeringMessages: async () => {
      if (!closingState.steeringPending) return [];
      closingState.steeringPending = false;
      return [{
        role: 'user',
        content: [{
          type: 'text',
          text: 'Context reading is finished. Do not call read or memory tools. Finish now with ordinary final text, handoff_to_image_planner, or request_context_selection. Do not return draft commentary without a final answer.',
        }],
        timestamp: Date.now(),
      }];
    },
    getFollowUpMessages: async () => {
      if (requireMutationTool && counters.mutationToolCallCount === 0 && !counters.executionCorrectionUsed) {
        counters.executionCorrectionUsed = true;
        return [{
          role: 'user',
          content: [{ type: 'text', text: 'This is an execution request. Call one allowed mutation tool now. Do not claim execution started without a real tool call.' }],
          timestamp: Date.now(),
        }];
      }
      return [];
    },
  };

  const emit = async (event) => {
    if (event.type === 'turn_start') counters.turnCount += 1;
    if (event.type === 'tool_execution_start') {
      pendingToolStarts.set(event.toolCallId, event);
      return;
    }
    const deferredConfirmationCall = counters.pendingConfirmation?.batch?.some(
      (call) => call?.id === event.toolCallId,
    ) === true;
    if (deferredConfirmationCall && (event.type === 'tool_execution_update' || event.type === 'tool_execution_end')) {
      pendingToolStarts.delete(event.toolCallId);
      return;
    }
    if (event.type === 'tool_execution_update' || event.type === 'tool_execution_end') {
      const startEvent = pendingToolStarts.get(event.toolCallId);
      if (startEvent) {
        pendingToolStarts.delete(event.toolCallId);
        await onToolStart?.({ id: startEvent.toolCallId, name: startEvent.toolName, args: startEvent.args });
        await onEvent?.(startEvent);
      }
    }
    if (event.type === 'tool_execution_update') {
      await onToolUpdate?.({ id: event.toolCallId, name: event.toolName, result: event.partialResult });
    } else if (event.type === 'tool_execution_end') {
      const rawResult = rawResults.get(event.toolCallId);
      if (rawResult?.confirmationRequired !== true) {
        const errorMessage = event.isError
          ? event.result?.content?.filter((part) => part?.type === 'text').map((part) => part.text).join('\n') || 'Tool execution failed'
          : '';
        const resolvedRawResult = event.isError ? { error: errorMessage } : rawResult ?? event.result?.details ?? event.result;
        await onToolResult?.({
          id: event.toolCallId,
          name: event.toolName,
          result: event.isError ? resolvedRawResult : rawResult?.publicResult ?? event.result?.details ?? resolvedRawResult,
          rawResult: resolvedRawResult,
          isError: event.isError,
        });
      }
    }
    await onEvent?.(event);
  };

  const continuationContext = continuation ? {
    systemPrompt: resolvedSystemPrompt,
    messages: continuationMessages(continuation.transcript, continuation.pendingCall, continuation.toolResult),
    tools: closingState.active ? closingPiTools : piTools,
  } : null;
  const newMessages = continuationContext
    ? await runAgentLoopContinue(continuationContext, config, emit, signal, actualStreamFn)
    : await runAgentLoop([prompt], initialContext, config, emit, signal, actualStreamFn);
  const assistant = latestAssistantMessage(newMessages);
  const content = assistant?.content?.filter((part) => part.type === 'text').map((part) => part.text).join('') || '';
  const reasoningContent = assistant?.content?.filter((part) => part.type === 'thinking').map((part) => part.thinking).join('') || '';
  const stopReason = counters.pendingConfirmation
    ? 'confirmation_required'
      : counters.terminal
        ? 'completed'
      : counters.executionRequired
      ? 'execution_required'
      : counters.invalidToolArguments
        ? 'error'
      : counters.truncatedToolCall
        ? 'error'
      : counters.closingError
        ? 'error'
      : counters.budgetExceeded
        ? 'budget_exceeded'
        : signal?.aborted
          ? 'aborted'
          : assistant?.stopReason === 'error'
            ? 'error'
            : 'completed';

  return {
    content,
    reasoningContent,
    messages: newMessages,
    transcript: [...(continuationContext?.messages || initialContext.messages), ...newMessages],
    turns: counters.turnCount,
    toolCalls: counters.toolCallCount,
    budgetedToolCalls: counters.budgetedToolCallCount,
    mutationToolCalls: counters.mutationToolCallCount,
    stopReason,
    ...(counters.invalidToolArguments || counters.truncatedToolCall || counters.closingError || assistant?.errorMessage
      ? {
        errorMessage: counters.invalidToolArguments
          || (counters.truncatedToolCall
            ? 'Model returned an incomplete tool call; the tool was not executed.'
            : counters.closingError || assistant.errorMessage),
      }
      : {}),
    ...(counters.pendingConfirmation ? { confirmation: counters.pendingConfirmation } : {}),
    ...(counters.terminal ? { terminal: counters.terminal } : {}),
    rawResults,
  };
}
