import {
  runAgentLoop,
  runAgentLoopContinue,
} from '@earendil-works/pi-agent-core';
import { materializeChatMessageImages } from '../reference-image-source.mjs';
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
    input: Array.isArray(metadata.input) && metadata.input.length > 0 ? metadata.input : ['text'],
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
          ...(typeof part.thoughtSignature === 'string' ? { thoughtSignature: part.thoughtSignature } : {}),
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
      ...(Array.isArray(message.geminiParts)
        ? {
            geminiParts: message.geminiParts,
            geminiSourceModel: text(message.geminiSourceModel) || text(message.model),
          }
        : {}),
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
          ...(typeof call?.thoughtSignature === 'string' ? { thoughtSignature: call.thoughtSignature } : {}),
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
        ...(Array.isArray(message.geminiParts)
          ? { geminiParts: message.geminiParts, geminiSourceModel: text(message.geminiSourceModel) || text(message.model) }
          : {}),
      }];
    }
    return [];
  });
}

function createAssistantMessage(model, content = [], stopReason = 'pending', errorMessage, geminiParts) {
  return {
    role: 'assistant',
    content,
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: emptyUsage(),
    stopReason,
    ...(errorMessage ? { errorMessage } : {}),
    ...(Array.isArray(geminiParts) ? { geminiParts, geminiSourceModel: model.id } : {}),
    timestamp: Date.now(),
  };
}

function createProviderStreamFn({ chatStream, resolveToolChoice = () => 'auto' }) {
  return async (model, context, options = {}) => {
    const stream = createStream();
    void (async () => {
      const content = [];
      const toolCalls = new Map();
      const toolArgumentBuffers = new Map();
      let geminiParts;
      let textIndex = -1;
      let thinkingIndex = -1;
      let malformedToolArguments = false;
      const makeAssistantMessage = (stopReason = 'pending', errorMessage) => (
        createAssistantMessage(model, content, stopReason, errorMessage, geminiParts)
      );
      let finalMessage = makeAssistantMessage();
      const emit = (event) => stream.push(event);
      try {
        emit({ type: 'start', partial: finalMessage });
        const request = {
          providerId: model.provider,
          model: model.id,
          messages: [
            ...(text(context.systemPrompt).trim() ? [{ role: 'system', content: context.systemPrompt }] : []),
            ...convertPiMessagesToChatMessages(context.messages),
          ],
          tools: (Array.isArray(context.tools) ? context.tools : []).map((tool) => ({
            type: 'function',
            function: {
              name: tool.name,
              description: tool.description,
              parameters: tool.parameters,
              ...(typeof tool.strict === 'boolean' ? { strict: tool.strict } : {}),
            },
          })),
          toolChoice: resolveToolChoice(),
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
            if (typeof event.thoughtSignature === 'string') content[textIndex].textSignature = event.thoughtSignature;
            finalMessage = makeAssistantMessage('pending');
            emit({ type: 'text_delta', contentIndex: textIndex, delta: event.content, partial: finalMessage });
          } else if (event.type === 'delta' && event.channel === 'reasoning') {
            if (thinkingIndex < 0) {
              content.push({ type: 'thinking', thinking: '' });
              thinkingIndex = content.length - 1;
              emit({ type: 'thinking_start', contentIndex: thinkingIndex, partial: finalMessage });
            }
            content[thinkingIndex].thinking += event.content;
            if (typeof event.thoughtSignature === 'string') content[thinkingIndex].thinkingSignature = event.thoughtSignature;
            finalMessage = makeAssistantMessage('pending');
            emit({ type: 'thinking_delta', contentIndex: thinkingIndex, delta: event.content, partial: finalMessage });
          } else if (event.type === 'tool_call_start') {
            const block = { type: 'toolCall', id: event.toolCallId, name: event.name || '', arguments: {} };
            toolCalls.set(event.index, block);
            toolArgumentBuffers.set(event.index, '');
            content.push(block);
            finalMessage = makeAssistantMessage('toolUse');
            emit({ type: 'toolcall_start', contentIndex: content.length - 1, partial: finalMessage });
          } else if (event.type === 'tool_call_delta') {
            toolArgumentBuffers.set(event.index, `${toolArgumentBuffers.get(event.index) || ''}${event.argumentsDelta}`);
            finalMessage = makeAssistantMessage('toolUse');
            emit({ type: 'toolcall_delta', contentIndex: content.findIndex((part) => part === toolCalls.get(event.index)), delta: event.argumentsDelta, partial: finalMessage });
          } else if (event.type === 'tool_call_end') {
            const block = toolCalls.get(event.index);
            if (block) {
              block.name = event.name || block.name;
              if (typeof event.thoughtSignature === 'string') block.thoughtSignature = event.thoughtSignature;
              try {
                const parsed = JSON.parse(event.arguments || toolArgumentBuffers.get(event.index) || '{}');
                if (!isObject(parsed)) throw new Error('Tool arguments must be an object');
                block.arguments = parsed;
              } catch {
                malformedToolArguments = true;
                block.arguments = {};
              }
              finalMessage = makeAssistantMessage(malformedToolArguments ? 'length' : 'toolUse');
              emit({ type: 'toolcall_end', contentIndex: content.findIndex((part) => part === block), toolCall: block, partial: finalMessage });
            }
          } else if (event.type === 'gemini_parts') {
            geminiParts = event.parts;
            finalMessage = makeAssistantMessage(toolCalls.size > 0 ? 'toolUse' : 'pending');
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
        finalMessage = makeAssistantMessage(stopReason);
        emit({ type: 'done', reason: stopReason, message: finalMessage });
        stream.end(finalMessage);
      } catch (error) {
        const aborted = options.signal?.aborted === true;
        finalMessage = makeAssistantMessage(
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
    mayRequireConfirmation: entry?.mayRequireConfirmation === true,
    confirmationMessage: text(entry?.confirmationMessage),
    ...(typeof entry?.strict === 'boolean' ? { strict: entry.strict } : {}),
  };
}

function continuationMessages(transcript, pendingCall, toolResult, resumeMessage = '') {
  if (!pendingCall) {
    const messages = structuredClone(Array.isArray(transcript) ? transcript : []);
    if (messages.at(-1)?.role === 'assistant') {
      messages.push({
        role: 'user',
        content: [{ type: 'text', text: text(resumeMessage) || 'Resume the saved task now.' }],
        timestamp: Date.now(),
      });
    }
    return messages;
  }
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

function mergePiUserMessages(primary, additions) {
  const base = Array.isArray(primary) ? primary : [];
  const extra = Array.isArray(additions) ? additions : [];
  if (extra.length === 0 || base.length === 0) return extra.length === 0 ? base : extra;
  const supplementalText = extra.flatMap((message) => Array.isArray(message?.content)
    ? message.content
      .filter((part) => part?.type === 'text' && text(part.text))
      .map((part) => text(part.text))
    : [],
  ).join('\n\n');
  if (!supplementalText) return base;
  return [{
    ...base[0],
    content: [
      ...(Array.isArray(base[0]?.content) ? base[0].content : []),
      { type: 'text', text: `\n\nUser update:\n${supplementalText}` },
    ],
  }];
}

/** @param {Record<string, any>} input */
export async function runZFlowAgentBrain({
  messages = [],
  systemPrompt = '',
  providerId,
  model,
  modelMetadata,
  tools = [],
  initialToolNames,
  getNextTurnToolNames,
  toolChoice = 'auto',
  requireInitialTool = '',
  maxTurns = 6,
  maxToolCalls = 4,
  reserveClosingTurn = false,
  repairInvalidTerminalToolOnce = '',
  repairInvalidTerminalToolsOnce = [],
  terminalToolContext = null,
  requireTerminalTool = '',
  getRequiredTerminalToolName,
  requireMutationTool = false,
  signal,
  chatStream,
  executeTool,
  onEvent,
  onAssistantTurnComplete,
  onToolPending,
  onToolStart,
  onToolUpdate,
  onToolResult,
  getExternalSteeringMessages,
  getExternalFollowUpMessages,
  continuation,
} = {}) {
  if (typeof providerId !== 'string' || !providerId || typeof model !== 'string' || !model) {
    throw new Error('Agent provider and model are required');
  }
  if (typeof chatStream !== 'function') throw new Error('Agent chat stream is unavailable');
  if (typeof executeTool !== 'function') throw new Error('Agent tool executor is unavailable');

  const piModel = createPiModel({ providerId, model, metadata: modelMetadata });
  const repairableTerminalTools = new Set([
    ...(Array.isArray(repairInvalidTerminalToolsOnce) ? repairInvalidTerminalToolsOnce : []),
    repairInvalidTerminalToolOnce,
  ].map(text).filter(Boolean));
  const counters = {
    turnCount: Number(continuation?.budgets?.turnsUsed) || 0,
    toolCallCount: Number(continuation?.budgets?.toolCallsUsed) || 0,
    mutationToolCallCount: Number(continuation?.budgets?.mutationToolCallsUsed) || 0,
    budgetedToolCallCount: Number(continuation?.budgets?.budgetedToolCallsUsed) || 0,
    executionCorrectionUsed: false,
    terminalCorrectionUsed: false,
    initialCorrectionUsed: false,
    initialToolExecuted: !requireInitialTool,
    initialToolError: '',
    budgetExceeded: false,
    executionRequired: false,
    invalidToolArguments: '',
    lastToolError: '',
    truncatedToolCall: false,
    closingError: '',
    pendingConfirmation: null,
    terminal: null,
  };
  const rawResults = new Map();
  const pendingToolStarts = new Map();
  const publishedToolStarts = new Set();
  const publishedToolPendings = new Set();
  const completedAssistantTurns = new Set();
  const batchCounts = new WeakMap();
  const toolCallBatches = new Map();
  const normalizedTools = (Array.isArray(tools) ? tools : []).map(normalizeToolDefinition);
  if (toolChoice && typeof toolChoice === 'object') {
    const requiredToolName = text(toolChoice?.function?.name);
    if (!requiredToolName || !normalizedTools.some((tool) => tool.name === requiredToolName)) {
      throw new Error(`Required Agent tool is unavailable: ${requiredToolName || 'unknown'}`);
    }
  }
  if (requireInitialTool && !normalizedTools.some((tool) => tool.name === requireInitialTool)) {
    throw new Error(`Required initial Agent tool is unavailable: ${requireInitialTool}`);
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
    ...(typeof entry.strict === 'boolean' ? { strict: entry.strict } : {}),
    executionMode: 'sequential',
    execute: async (toolCallId, args, toolSignal, onUpdate) => {
      let result;
      try {
        result = await executeTool(entry.name, args, { toolCallId, signal: toolSignal, onUpdate });
      } catch (error) {
        counters.lastToolError = error instanceof Error ? error.message : String(error);
        if (repairableTerminalTools.has(entry.name) && !closingState.active) {
          activateClosingTurn('terminal_tool_repair', entry.name);
        }
        throw error;
      }
      rawResults.set(toolCallId, result);
      if (entry.name === requireInitialTool) counters.initialToolExecuted = true;
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
      if (entry.terminal === true || result?.terminate === true) counters.terminal = result;
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
  const selectPiTools = (names) => {
    if (!Array.isArray(names)) return piTools;
    const allowed = new Set(names);
    return piTools.filter((tool) => allowed.has(tool.name));
  };
  const closingPiTools = piTools.filter((tool) => closingToolNames.has(tool.name));
  const requiredToolChoice = (name) => ({ type: 'function', function: { name } });
  const closingState = {
    active: reserveClosingTurn && (
      counters.budgetedToolCallCount >= maxToolCalls
      || counters.turnCount >= Math.max(0, maxTurns - 1)
    ),
    steeringPending: false,
    skipCurrentStop: false,
    requested: false,
    reason: '',
    toolName: '',
  };
  if (closingState.active) closingState.steeringPending = true;
  const activateClosingTurn = (reason = '', toolName = '') => {
    if (closingState.active) return;
    closingState.active = true;
    closingState.steeringPending = true;
    closingState.skipCurrentStop = true;
    closingState.reason = reason;
    closingState.toolName = text(toolName);
  };

  const resolveClosingToolName = () => (
    closingState.reason === 'terminal_tool_repair'
      ? closingState.toolName || repairInvalidTerminalToolOnce || requireTerminalTool
      : closingState.reason === 'terminal_tool_required'
        ? (typeof getRequiredTerminalToolName === 'function' ? getRequiredTerminalToolName() : requireTerminalTool)
        : ''
  );
  const resolveRequiredTerminalToolName = () => (
    typeof getRequiredTerminalToolName === 'function' ? getRequiredTerminalToolName() : requireTerminalTool
  );
  const resolveClosingPiTools = () => {
    const requiredName = resolveClosingToolName();
    return requiredName ? selectPiTools([requiredName]) : closingPiTools;
  };
  const terminalContextSuffix = isObject(terminalToolContext)
    ? ` Locked runtime contract: ${JSON.stringify(terminalToolContext)}`
    : '';
  const actualStreamFn = createProviderStreamFn({
    chatStream,
    resolveToolChoice: () => {
      if (!counters.initialToolExecuted && requireInitialTool) {
        return counters.initialCorrectionUsed ? 'required' : requiredToolChoice(requireInitialTool);
      }
      const closingToolName = resolveClosingToolName();
      return closingToolName ? requiredToolChoice(closingToolName) : toolChoice;
    },
  });
  const resolvedSystemPrompt = systemPrompt || (Array.isArray(messages) ? messages : [])
    .filter((message) => message?.role === 'system' && typeof message.content === 'string')
    .map((message) => message.content)
    .join('\n\n');
  const materializedMessages = continuation
    ? messages
    : (await materializeChatMessageImages(messages)).messages;
  const piMessages = convertChatMessagesToPiMessages(materializedMessages, piModel);
  const prompt = piMessages.at(-1);
  if (!continuation && (!prompt || prompt.role !== 'user')) throw new Error('Agent prompt must end with a user message');
  const initialContext = {
    systemPrompt: resolvedSystemPrompt,
    messages: piMessages.slice(0, -1),
    tools: closingState.active
      ? resolveClosingPiTools()
      : selectPiTools(!counters.initialToolExecuted && requireInitialTool ? [requireInitialTool] : initialToolNames),
  };
  const publishToolStart = async (toolCallId) => {
    if (publishedToolStarts.has(toolCallId)) return;
    const event = pendingToolStarts.get(toolCallId);
    if (!event) return;
    const tool = normalizedTools.find((entry) => entry.name === event.toolName);
    if (tool?.mayRequireConfirmation) return;
    pendingToolStarts.delete(toolCallId);
    publishedToolStarts.add(toolCallId);
    await onToolStart?.({ id: event.toolCallId, name: event.toolName, args: event.args });
    await onEvent?.(event);
  };
  const publishToolPending = async (toolCall) => {
    if (!toolCall?.id || publishedToolPendings.has(toolCall.id)) return;
    publishedToolPendings.add(toolCall.id);
    await onToolPending?.({ id: toolCall.id, name: toolCall.name, args: toolCall.args || {} });
  };
  const publishAssistantTurnComplete = async (assistantMessage, disposition) => {
    if (!assistantMessage) return;
    const calls = Array.isArray(assistantMessage?.content)
      ? assistantMessage.content.filter((part) => part?.type === 'toolCall')
      : [];
    const textContent = calls.length === 0
      ? assistantMessage.content?.filter((part) => part?.type === 'text').map((part) => part.text || '').join('') || ''
      : '';
    const key = calls.length > 0
      ? `tool:${calls.map((call) => call.id).join(':')}`
      : `final:${assistantMessage.timestamp || ''}:${textContent}`;
    if (completedAssistantTurns.has(key)) return;
    completedAssistantTurns.add(key);
    await onAssistantTurnComplete?.({
      message: assistantMessage,
      toolCalls: calls,
      disposition: disposition || (calls.length > 0 ? 'commentary' : 'final'),
    });
  };

  const config = {
    model: piModel,
    toolExecution: 'sequential',
    convertToLlm: (items) => items.filter((item) => item?.role === 'user' || item?.role === 'assistant' || item?.role === 'toolResult'),
    transformContext: async (items) => items,
    beforeToolCall: async ({ assistantMessage, toolCall }) => {
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
          const repairableCall = batch.length === 1 && repairableTerminalTools.has(batch[0].name);
          if (repairableCall && !closingState.active) {
            batchCounts.set(assistantMessage, calls.length);
            activateClosingTurn('terminal_tool_repair', batch[0].name);
            return { block: true, reason: error instanceof Error ? error.message : String(error) };
          }
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
        await publishAssistantTurnComplete(assistantMessage, 'commentary');
        for (const call of batch) await publishToolPending(call);
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
      await publishToolStart(toolCall.id);
      return undefined;
    },
    prepareNextTurn: async ({ message, toolResults, context }) => {
      const usedTool = message?.content?.some((part) => part?.type === 'toolCall') === true;
      const hasText = message?.content?.some((part) => part?.type === 'text' && part.text.trim()) === true;
      if (!counters.initialToolExecuted && requireInitialTool) {
        if (!usedTool && counters.initialCorrectionUsed) {
          counters.initialToolError = `Provider did not call required tool ${requireInitialTool}`;
          return undefined;
        }
        if (!usedTool) counters.initialCorrectionUsed = true;
        return { context: { ...context, tools: selectPiTools([requireInitialTool]) } };
      }
      const invalidRepairCall = message?.content?.find((part) => (
        part?.type === 'toolCall'
        && repairableTerminalTools.has(part.name)
        && !rawResults.has(part.id)
        && toolResults?.some((result) => result?.toolCallId === part.id && result?.isError)
      ));
      if (invalidRepairCall && !closingState.active) activateClosingTurn('terminal_tool_repair', invalidRepairCall.name);
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
      if (
        resolveRequiredTerminalToolName()
        && !closingState.active
        && !counters.terminal
        && !counters.pendingConfirmation
        && !usedTool
        && !counters.terminalCorrectionUsed
      ) {
        counters.terminalCorrectionUsed = true;
        activateClosingTurn('terminal_tool_required');
      }
      if (!closingState.active) {
        const nextToolNames = typeof getNextTurnToolNames === 'function'
          ? await getNextTurnToolNames({ message, toolResults, context, rawResults })
          : null;
        return Array.isArray(nextToolNames)
          ? { context: { ...context, tools: selectPiTools(nextToolNames) } }
          : undefined;
      }
      return {
        context: {
          ...context,
          tools: resolveClosingPiTools(),
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
      if (counters.initialToolError) return true;
      if (!counters.initialToolExecuted && requireInitialTool) return false;
      if (closingState.skipCurrentStop) {
        closingState.skipCurrentStop = false;
        return false;
      }
      if (closingState.active) {
        if (counters.closingError) return true;
        if (counters.terminal) return true;
        if (counters.lastToolError) {
          counters.closingError = counters.lastToolError;
          return true;
        }
        const closingToolCalls = message?.content?.filter((part) => part?.type === 'toolCall') || [];
        const unavailableCall = closingToolCalls.find((part) => !closingToolNames.has(part.name));
        if (unavailableCall) {
          counters.closingError = `Closing turn cannot call ${unavailableCall.name}`;
          return true;
        }
        const hasToolCall = closingToolCalls.length > 0;
        const hasFinalText = message?.content?.some((part) => part?.type === 'text' && part.text.trim()) === true;
        if (!hasToolCall && hasFinalText && !['terminal_tool_repair', 'terminal_tool_required'].includes(closingState.reason)) return true;
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
      const internal = !closingState.steeringPending ? [] : [{
        role: 'user',
        content: [{
          type: 'text',
          text: closingState.reason === 'terminal_tool_repair'
            ? `Your ${resolveClosingToolName() || 'terminal'} call was invalid. This is the only repair turn. Do not read more context or answer with prose. Call ${resolveClosingToolName() || 'the terminal tool'} with corrected arguments.${terminalContextSuffix}`
            : closingState.reason === 'terminal_tool_required'
              ? `This task requires a structured terminal decision. Do not answer or ask questions with prose. Call ${resolveRequiredTerminalToolName()} now with decision execute, or decision clarify when user input is required.${terminalContextSuffix}`
            : 'Context reading is finished. Do not call read or memory tools. Finish now with ordinary final text, submit_image_execution_plan, or request_context_selection. Do not return draft commentary without a final answer.',
        }],
        timestamp: Date.now(),
      }];
      closingState.steeringPending = false;
      const external = typeof getExternalSteeringMessages === 'function'
        ? await getExternalSteeringMessages()
        : [];
      return mergePiUserMessages(internal, external);
    },
    getFollowUpMessages: async () => {
      const external = typeof getExternalFollowUpMessages === 'function'
        ? await getExternalFollowUpMessages()
        : [];
      if (!counters.initialToolExecuted && requireInitialTool && counters.initialCorrectionUsed) {
        return mergePiUserMessages([{
          role: 'user',
          content: [{ type: 'text', text: `Call ${requireInitialTool} now. Do not answer with prose or call another tool.` }],
          timestamp: Date.now(),
        }], external);
      }
      if (requireMutationTool && counters.mutationToolCallCount === 0 && !counters.executionCorrectionUsed) {
        counters.executionCorrectionUsed = true;
        return mergePiUserMessages([{
          role: 'user',
          content: [{ type: 'text', text: 'This is an execution request. Call one allowed mutation tool now. Do not claim execution started without a real tool call.' }],
          timestamp: Date.now(),
        }], external);
      }
      return Array.isArray(external) ? external : [];
    },
  };

  const emit = async (event) => {
    if (event.type === 'turn_start') counters.turnCount += 1;
    if (event.type === 'turn_end' && event.message?.role === 'assistant') {
      const hasToolCall = Array.isArray(event.message.content)
        && event.message.content.some((part) => part?.type === 'toolCall');
      await publishAssistantTurnComplete(event.message, hasToolCall ? 'commentary' : 'final');
    }
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
    if (event.type === 'tool_execution_update') {
      await onToolUpdate?.({ id: event.toolCallId, name: event.toolName, partialResult: event.partialResult });
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
    messages: continuationMessages(
      continuation.transcript,
      continuation.pendingCall,
      continuation.toolResult,
      continuation.resumeMessage,
    ),
    tools: closingState.active
      ? resolveClosingPiTools()
      : selectPiTools(!counters.initialToolExecuted && requireInitialTool ? [requireInitialTool] : initialToolNames),
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
      : counters.initialToolError
        ? 'error'
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
    ...(counters.invalidToolArguments || counters.truncatedToolCall || counters.initialToolError || counters.closingError || assistant?.errorMessage
      ? {
        errorMessage: counters.invalidToolArguments
          || (counters.truncatedToolCall
            ? 'Model returned an incomplete tool call; the tool was not executed.'
            : counters.initialToolError || counters.closingError || assistant.errorMessage),
      }
      : {}),
    ...(['terminal_tool_repair', 'terminal_tool_required'].includes(closingState.reason) && stopReason === 'error'
      ? { failureStage: 'terminal_contract' }
      : {}),
    ...(counters.pendingConfirmation ? { confirmation: counters.pendingConfirmation } : {}),
    ...(counters.terminal ? { terminal: counters.terminal } : {}),
    rawResults,
  };
}
