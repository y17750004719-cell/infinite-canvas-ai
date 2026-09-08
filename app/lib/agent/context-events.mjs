const TYPES = new Set(['user_text', 'assistant_text', 'tool_call', 'tool_result', 'image_input', 'image_output', 'confirmation', 'clarification', 'recovery', 'error', 'compaction']);
const text = (value) => typeof value === 'string' ? value : '';
const replayableImageSource = (value) => {
  const source = text(value).trim();
  return source && !source.toLowerCase().startsWith('data:') ? source : '';
};
const stableId = (sessionId, index, type) => `${text(sessionId) || 'session'}:event:${index + 1}:${type}`;

function sanitizeEventValue(value, depth = 0) {
  if (depth > 3) return '[omitted]';
  if (value == null || typeof value === 'boolean' || typeof value === 'number') return value;
  if (typeof value === 'string') {
    if (value.toLowerCase().startsWith('data:')) return '[binary omitted]';
    return value.length > 12000 ? `${value.slice(0, 12000)}...[truncated]` : value;
  }
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => sanitizeEventValue(item, depth + 1));
  if (typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).slice(0, 80).map(([key, item]) => [key, sanitizeEventValue(item, depth + 1)]));
  }
  return String(value);
}

/** Convert a streamed Agent event into an audit/replay event without persisting binary payloads. */
export function contextEventFromAgentEvent(agentEvent, { sessionId = '' } = {}) {
  if (!agentEvent || typeof agentEvent !== 'object') return null;
  const event = agentEvent;
  const owner = text(sessionId).trim();
  const sequence = Number.isFinite(Number(event.sequence)) ? Math.max(1, Math.floor(Number(event.sequence))) : 0;
  const eventId = `${owner || 'session'}:run:${text(event.runId) || 'runtime'}:${sequence || Date.now()}:${text(event.type) || 'event'}`;
  const base = {
    eventId,
    sessionId: owner,
    sequence: sequence || Date.now(),
    source: 'agent_runtime',
    ...(text(event.turnId) || text(event.runId) ? { turnId: text(event.turnId) || text(event.runId) } : {}),
  };
  switch (event.type) {
    case 'assistant_delta':
    case 'agent_activity_delta':
      if (event.channel === 'reasoning' || !text(event.delta).trim()) return null;
      return { ...base, type: 'assistant_text', content: text(event.delta) };
    case 'tool_start':
      return {
        ...base,
        type: 'tool_call',
        toolCallId: text(event.toolCallId),
        toolName: text(event.toolName) || 'tool',
        arguments: sanitizeEventValue(event.arguments && typeof event.arguments === 'object' ? event.arguments : {}),
      };
    case 'tool_result':
      return {
        ...base,
        type: 'tool_result',
        toolCallId: text(event.toolCallId),
        toolName: text(event.toolName) || 'tool',
        result: sanitizeEventValue(event.result),
        isError: event.isError === true,
      };
    case 'confirmation_required':
      return { ...base, type: 'confirmation', request: sanitizeEventValue(event.request) };
    case 'clarification_required':
      return { ...base, type: 'clarification', request: sanitizeEventValue(event.request), state: sanitizeEventValue(event.state) };
    case 'agent_error':
      return { ...base, type: 'error', stage: text(event.stage), reason: text(event.reason) || text(event.code), message: text(event.message) };
    case 'agent_cancelled':
      return { ...base, type: 'recovery', status: 'cancelled', message: text(event.message) };
    case 'client_action': {
      const action = event.action;
      if (!action || action.type !== 'add_generated_assets' || !Array.isArray(action.assets)) return null;
      return action.assets
        .filter((asset) => asset && (text(asset.assetId) || text(asset.id) || replayableImageSource(asset.src)))
        .map((asset, index) => ({
          ...base,
          eventId: `${eventId}:${index + 1}`,
          type: 'image_output',
          assetId: text(asset.assetId) || text(asset.id) || undefined,
          src: replayableImageSource(asset.src) || undefined,
          previewSrc: replayableImageSource(asset.previewSrc) || undefined,
          taskId: text(action.taskId),
          batchId: text(action.batchId),
          versionId: text(asset.versionId),
          toolCallId: text(action.toolCallId) || text(event.toolCallId) || undefined,
        }));
    }
    default:
      return null;
  }
}

export function estimateContextTokens(value) {
  if (value == null) return 0;
  if (Array.isArray(value)) return value.reduce((sum, item) => sum + estimateContextTokens(item), 0);
  if (typeof value === 'string') return Math.ceil(value.length / 4);
  if (typeof value === 'object') return estimateContextTokens(JSON.stringify(value));
  return 1;
}

export function estimateVisualTokens(asset = {}) {
  const width = Number(asset.naturalWidth || asset.width || 0);
  const height = Number(asset.naturalHeight || asset.height || 0);
  if (width > 0 && height > 0) return Math.max(256, Math.ceil((width * height) / 4096));
  return asset.assetId || asset.src || asset.durableSrc ? 512 : 0;
}

/** Estimate one event including tool payloads and visual content. */
export function estimateEventTokens(event = {}) {
  if (!event || typeof event !== 'object') return 0;
  let total = estimateContextTokens(event.content || event.summary || event.message || '');
  if (event.type === 'tool_call') total += estimateContextTokens(event.arguments || {});
  if (event.type === 'tool_result') total += estimateContextTokens(event.result || {});
  if (event.type === 'confirmation' || event.type === 'clarification') total += estimateContextTokens(event.request || {});
  return total + estimateVisualTokens(event);
}

export function normalizeContextEvents(events, sessionId = '') {
  const seen = new Set();
  const owner = text(sessionId).trim();
  return (Array.isArray(events) ? events : []).flatMap((event, index) => {
    if (!event || typeof event !== 'object' || !TYPES.has(event.type)) return [];
    const eventSessionId = text(event.sessionId).trim();
    if (owner && eventSessionId && eventSessionId !== owner) return [];
    const eventId = text(event.eventId).trim() || stableId(sessionId, index, event.type);
    if (seen.has(eventId)) return [];
    seen.add(eventId);
    const normalized = { ...event, eventId, sessionId: text(event.sessionId).trim() || text(sessionId).trim(), sequence: Number.isFinite(Number(event.sequence)) ? Math.max(1, Math.floor(Number(event.sequence))) : index + 1, source: text(event.source).trim() || 'runtime' };
    if (normalized.type === 'image_input' || normalized.type === 'image_output') {
      delete normalized.data;
      delete normalized.base64;
      delete normalized.bytes;
      delete normalized.blob;
      if (text(normalized.content).toLowerCase().startsWith('data:')) delete normalized.content;
      const src = replayableImageSource(normalized.src);
      const previewSrc = replayableImageSource(normalized.previewSrc);
      if (src) normalized.src = src;
      else delete normalized.src;
      if (previewSrc) normalized.previewSrc = previewSrc;
      else delete normalized.previewSrc;
    }
    return [normalized];
  }).sort((a, b) => a.sequence - b.sequence);
}

/** Collapse adjacent streamed assistant events into a single turn. */
export function aggregateAssistantTextEvents(events) {
  const output = [];
  for (const event of Array.isArray(events) ? events : []) {
    const previous = output.at(-1);
    if (previous?.type === 'assistant_text' && event?.type === 'assistant_text'
      && previous.turnId && event.turnId && previous.turnId === event.turnId) {
      previous.content = `${text(previous.content)}${text(event.content)}`;
      previous.endSequence = event.sequence;
    } else output.push(event && typeof event === 'object' ? { ...event } : event);
  }
  return output;
}

/** Ensure tool calls and results form valid replayable pairs. */
export function normalizeToolCallPairs(events, { sessionId = '' } = {}) {
  const normalized = normalizeContextEvents(events, sessionId);
  const calls = new Map();
  const results = new Set();
  for (const event of normalized) {
    const id = text(event.toolCallId || event.callId);
    if (!id) continue;
    if (event.type === 'tool_call') calls.set(id, event);
    if (event.type === 'tool_result') results.add(id);
  }
  const output = [];
  for (const event of normalized) {
    if (event.type === 'tool_result') {
      const id = text(event.toolCallId || event.callId);
      if (!id || !calls.has(id)) continue;
    }
    output.push(event);
    if (event.type === 'tool_call') {
      const id = text(event.toolCallId || event.callId);
      if (id && !results.has(id)) output.push({
        eventId: `${event.eventId}:aborted`, sessionId: text(sessionId) || event.sessionId,
        sequence: Number(event.sequence) + 0.1, type: 'tool_result', source: 'replay_normalizer',
        toolCallId: id, toolName: text(event.toolName || event.name) || 'tool',
        result: { status: 'aborted', reason: 'missing_tool_result' }, isError: true,
      });
    }
  }
  return output.sort((a, b) => a.sequence - b.sequence);
}

export function normalizeCompactedWindows(windows, sessionId = '') {
  const owner = text(sessionId).trim();
  return (Array.isArray(windows) ? windows : []).flatMap((window) => {
    if (!window || typeof window !== 'object') return [];
    const windowSessionId = text(window.sessionId).trim();
    if (owner && windowSessionId && windowSessionId !== owner) return [];
    return [{ ...window, ...(owner ? { sessionId: owner } : {}) }];
  });
}

function structuredCompactionSummary(events) {
  const summary = {
    task: '',
    constraints: [],
    decisions: [],
    completedActions: [],
    pendingActions: [],
    toolFacts: [],
    imageAssets: [],
    confirmationState: null,
    recoveryState: null,
  };
  for (const event of Array.isArray(events) ? events : []) {
    const content = text(event?.content || event?.summary || event?.message).trim();
    if (event?.type === 'user_text' && content && !summary.task) summary.task = content.slice(0, 1200);
    if (event?.type === 'assistant_text' && content) summary.completedActions.push(content.slice(0, 500));
    if (event?.type === 'tool_result' && content) summary.toolFacts.push(content.slice(0, 500));
    if (event?.type === 'confirmation') summary.confirmationState = content || 'pending';
    if (event?.type === 'recovery') summary.recoveryState = content || text(event.status) || 'pending';
    if (event?.assetId) summary.imageAssets.push({ assetId: text(event.assetId), ...(event.role ? { role: text(event.role) } : {}) });
  }
  summary.completedActions = Array.from(new Set(summary.completedActions)).slice(-12);
  summary.toolFacts = Array.from(new Set(summary.toolFacts)).slice(-16);
  summary.imageAssets = Array.from(new Map(summary.imageAssets.map((item) => [item.assetId, item])).values()).slice(-24);
  return summary;
}

export { structuredCompactionSummary };

/** Return a complete, provider-neutral summary shape for compact records. */
export function validateCompactionSummary(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const arrayKeys = ['constraints', 'decisions', 'completedActions', 'pendingActions', 'toolFacts', 'imageAssets'];
  const normalized = { ...value };
  for (const key of arrayKeys) {
    if (!Array.isArray(normalized[key])) return null;
    normalized[key] = normalized[key].slice(0, 64);
  }
  if ('task' in normalized && typeof normalized.task !== 'string') return null;
  return normalized;
}

export function requestMessagesToContextEvents(messages, { sessionId = '', referenceContext } = {}) {
  const events = [];
  let sequence = 0;
  for (const message of Array.isArray(messages) ? messages : []) {
    if (!message || !['user', 'assistant'].includes(message.role)) continue;
    if (typeof message.content === 'string' && message.content) events.push({ eventId: stableId(sessionId, sequence, `${message.role}_text`), sessionId, sequence: ++sequence, type: message.role === 'user' ? 'user_text' : 'assistant_text', source: 'request_message', content: message.content });
    const refs = Array.isArray(message.referenceContext?.references) ? message.referenceContext.references : (message.role === 'user' ? referenceContext?.references || [] : []);
    for (const reference of refs) events.push({ eventId: stableId(sessionId, sequence, 'image_input'), sessionId, sequence: ++sequence, type: 'image_input', source: reference?.source || 'request_message', assetId: text(reference?.assetId) || undefined, referenceId: text(reference?.id), ...(replayableImageSource(reference?.src) ? { src: replayableImageSource(reference.src) } : {}), ...(replayableImageSource(reference?.previewSrc) ? { previewSrc: replayableImageSource(reference.previewSrc) } : {}) });
  }
  return normalizeContextEvents(events, sessionId);
}

// Kept as an explicit request-boundary name for callers that still import the
// helper; it does not read or write historical event formats.
export const migrateMessagesToContextEvents = requestMessagesToContextEvents;

export function buildReplayableContext({ sessionId = '', events = [], auditEvents = [], modelEvents = [], messages = [], referenceContext, visualAssets = [], compactedWindows = [], compactionRecords = [], activeWindow, mergeMessages = false } = {}) {
  const suppliedModel = Array.isArray(modelEvents) && modelEvents.length ? modelEvents : [];
  const suppliedEvents = Array.isArray(events) && events.length ? events : [];
  const suppliedAudit = Array.isArray(auditEvents) && auditEvents.length ? auditEvents : [];
  const ownerSessionId = text(sessionId).trim() || text(activeWindow?.sessionId).trim()
    || text((suppliedModel[0] || suppliedEvents[0] || suppliedAudit[0])?.sessionId).trim();
  // modelEvents is the active window source of truth; events is the audit input alias.
  const activeSource = suppliedModel.length ? suppliedModel : (suppliedEvents.length ? suppliedEvents : suppliedAudit);
  const normalized = normalizeContextEvents(activeSource, ownerSessionId);
  const migrated = requestMessagesToContextEvents(messages, { sessionId: ownerSessionId, referenceContext });
  const canMergeMessages = normalized.length && mergeMessages && (!Array.isArray(compactedWindows) || compactedWindows.length === 0);
  const existingMessageCount = normalized.filter((event) => event.type === 'user_text' || event.type === 'assistant_text').length;
  const migratedMessageCount = migrated.filter((event) => event.type === 'user_text' || event.type === 'assistant_text').length;
  const appendEvents = canMergeMessages && migratedMessageCount > existingMessageCount
    ? (() => {
        let messageIndex = 0;
        const maxSequence = normalized.at(-1)?.sequence || 0;
        return migrated.filter((event) => {
          if (event.type === 'user_text' || event.type === 'assistant_text') messageIndex += 1;
          return messageIndex > existingMessageCount;
        }).map((event, index) => ({
          ...event,
          sequence: maxSequence + index + 1,
          eventId: `${ownerSessionId || 'session'}:event:${maxSequence + index + 1}:${event.type}`,
        }));
      })()
    : [];
  const lastMessage = Array.isArray(messages) ? messages.at(-1) : null;
  const lastMessageType = lastMessage?.role === 'user' ? 'user_text' : lastMessage?.role === 'assistant' ? 'assistant_text' : '';
  // Lifecycle/image events may follow the message they belong to. Compare
  // against the latest text event instead of assuming the final event is text.
  const lastMessageEvent = lastMessageType
    ? [...normalized].reverse().find((event) => event.type === lastMessageType)
    : null;
  const needsCurrentMessage = normalized.length && mergeMessages && lastMessageType
    && appendEvents.length === 0
    && !(lastMessageEvent?.content === lastMessage.content);
  const currentMessageEvents = needsCurrentMessage
    ? requestMessagesToContextEvents([lastMessage], { sessionId: ownerSessionId, referenceContext }).map((event, index) => {
        const sequence = (normalized.at(-1)?.sequence || 0) + appendEvents.length + index + 1;
        return { ...event, sequence, eventId: `${ownerSessionId || 'session'}:event:${sequence}:${event.type}` };
      })
    : [];
  const replayEvents = normalized.length
    ? normalizeContextEvents([...normalized, ...appendEvents, ...currentMessageEvents], ownerSessionId)
    : migrated;
  const normalizedActiveWindow = activeWindow && typeof activeWindow === 'object'
    ? { ...activeWindow, sessionId: ownerSessionId }
    : { sessionId: ownerSessionId, startSequence: 1, endSequence: replayEvents.at(-1)?.sequence || 0, compactCount: 0, summaryVersion: 0, estimatedTokens: 0, model: '', contextWindow: 0 };
  const normalizedAudit = normalizeContextEvents(suppliedAudit.length ? suppliedAudit : (suppliedEvents.length ? suppliedEvents : replayEvents), ownerSessionId);
  const normalizedModel = normalizeContextEvents(modelEvents.length ? modelEvents : replayEvents, ownerSessionId);
  return {
    sessionId: ownerSessionId,
    events: replayEvents,
    auditEvents: normalizedAudit,
    modelEvents: normalizedModel,
    visualAssets: Array.isArray(visualAssets) ? visualAssets : [],
    compactedWindows: normalizeCompactedWindows(compactedWindows, ownerSessionId),
    compactionRecords: Array.isArray(compactionRecords) ? compactionRecords : [],
    activeWindow: normalizedActiveWindow,
  };
}

export function compactContext(replay, {
  model = '',
  contextWindow = 32768,
  reserveTokens = 8192,
  outputReserve,
  fallbackReserve = 0,
  systemPrompt = '',
  tools = [],
  threshold = 0.75,
  keepRecent = 8,
  summary: suppliedSummary,
  structuredSummary: suppliedStructuredSummary,
} = {}) {
  const base = buildReplayableContext(replay || {});
  const events = aggregateAssistantTextEvents(normalizeToolCallPairs(base.events, { sessionId: base.sessionId }));
  const historyTokens = events.reduce((sum, event) => {
    let tokens = estimateContextTokens(event.content || event.summary || event.message || '');
    if (event.type === 'tool_call') tokens += estimateContextTokens(event.arguments || {});
    if (event.type === 'confirmation' || event.type === 'clarification') tokens += estimateContextTokens(event.request || {});
    return sum + tokens;
  }, 0);
  const systemTokens = estimateContextTokens(systemPrompt);
  const toolDefinitionTokens = estimateContextTokens(tools);
  const toolResultTokens = events
    .filter((event) => event.type === 'tool_result')
    .reduce((sum, event) => sum + estimateContextTokens(event.result || event.content || ''), 0);
  const visualTokens = events.reduce((sum, event) => sum + estimateVisualTokens(event), 0);
  const effectiveOutputReserve = Math.max(0, Number(outputReserve ?? reserveTokens) || 0);
  const effectiveFallbackReserve = Math.max(0, Number(fallbackReserve) || 0);
  const estimatedTokens = systemTokens + historyTokens + toolDefinitionTokens + toolResultTokens + visualTokens;
  const budget = Math.max(1024, Number(contextWindow) - effectiveOutputReserve - effectiveFallbackReserve);
  const budgetInfo = {
    systemTokens,
    historyTokens,
    toolDefinitionTokens,
    toolResultTokens,
    visualTokens,
    outputReserve: effectiveOutputReserve,
    fallbackReserve: effectiveFallbackReserve,
    effectiveInputBudget: budget,
    fullContextLimit: Number(contextWindow) || 32768,
  };
  if (estimatedTokens <= budget * threshold) {
    return {
      ...base,
      events,
      auditEvents: base.auditEvents,
      modelEvents: events,
      compactionRecords: base.compactionRecords || [],
      tokenBudget: budgetInfo,
      activeWindow: { ...base.activeWindow, endSequence: events.at(-1)?.sequence || 0, estimatedTokens, model, contextWindow },
    };
  }
  let kept = events.slice(-Math.max(1, keepRecent));
  // Keep tool calls and their results together. A provider rejects a replay
  // that contains a tool result without the assistant call that requested it.
  const keptIds = new Set(kept
    .filter((event) => event.type === 'tool_call' || event.type === 'tool_result')
    .map((event) => text(event.toolCallId || event.callId))
    .filter(Boolean));
  const pairedEvents = events.filter((event) => (
    (event.type === 'tool_call' || event.type === 'tool_result')
    && keptIds.has(text(event.toolCallId || event.callId))
  ));
  if (pairedEvents.length > 0) {
    const firstPairedSequence = Math.min(...pairedEvents.map((event) => event.sequence));
    const lastPairedSequence = Math.max(...pairedEvents.map((event) => event.sequence));
    kept = events.filter((event) => (
      event.sequence >= firstPairedSequence && event.sequence <= lastPairedSequence
    ) || kept.some((candidate) => candidate.eventId === event.eventId));
  }
  const summary = typeof suppliedSummary === 'string' && suppliedSummary.trim()
    ? suppliedSummary.trim().slice(0, 12000)
    : events.slice(0, -kept.length).map((event) => `${event.type}: ${text(event.content || event.summary).slice(0, 240)}`).join('\n').slice(0, 6000);
  const version = (base.activeWindow.summaryVersion || 0) + 1;
  const structuredSummary = validateCompactionSummary(suppliedStructuredSummary && typeof suppliedStructuredSummary === 'object'
    ? suppliedStructuredSummary
    : structuredCompactionSummary(events.slice(0, -kept.length))) || structuredCompactionSummary(events.slice(0, -kept.length));
  const compacted = {
    compactionId: `${text(replay?.sessionId) || 'session'}:compaction:${version}`,
    version,
    sessionId: text(replay?.sessionId),
    startSequence: events[0]?.sequence || 1,
    endSequence: kept[0]?.sequence ? kept[0].sequence - 1 : 0,
    summary,
    structuredSummary,
    assetIds: events.slice(0, -kept.length).map((event) => event.assetId).filter(Boolean),
    model,
    contextWindow,
    inputTokens: estimatedTokens,
    createdAt: Date.now(),
  };
  const compactedEvents = [
    // A compaction summary is a context boundary, not an assistant utterance.
    // Keep it as its own event so audit/replay layers never misattribute the
    // summary to the assistant's conversational voice.
    ...(summary ? [{ eventId: `${text(replay?.sessionId) || 'session'}:summary:${version}`, sessionId: text(replay?.sessionId), sequence: compacted.endSequence, type: 'compaction', source: 'compact_summary', content: summary }] : []),
    ...kept,
  ];
  const finalTokens = compactedEvents.reduce((sum, event) => sum + estimateContextTokens(event.content || '') + estimateVisualTokens(event), 0);
  const compactionRecords = [...(base.compactionRecords || []), compacted];
  return {
    ...base,
    events: compactedEvents,
    auditEvents: base.auditEvents,
    modelEvents: compactedEvents,
    compactedWindows: [...(base.compactedWindows || []), compacted],
    compactionRecords,
    tokenBudget: { ...budgetInfo, historyTokens: finalTokens, visualTokens: compactedEvents.reduce((sum, event) => sum + estimateVisualTokens(event), 0) },
    activeWindow: { ...base.activeWindow, startSequence: summary ? compacted.endSequence : (kept[0]?.sequence || 1), endSequence: events.at(-1)?.sequence || 0, compactCount: (base.activeWindow.compactCount || 0) + 1, summaryVersion: version, estimatedTokens: finalTokens, model, contextWindow },
  };
}

/**
 * Async compaction hook for callers that can provide a model-backed summarizer.
 * The synchronous compactContext remains the deterministic fallback and never
 * drops the original audit history when the summarizer fails.
 */
export async function compactContextAsync(replay, { summarize, ...options } = {}) {
  const base = buildReplayableContext(replay || {});
  const deterministic = compactContext(base, options);
  if (typeof summarize !== 'function' || deterministic.activeWindow?.compactCount === 0) return deterministic;
  const sourceEvents = aggregateAssistantTextEvents(normalizeToolCallPairs(base.events, { sessionId: base.sessionId }));
  try {
    const modelSummary = await summarize({ events: sourceEvents, sessionId: base.sessionId, model: options.model || '', contextWindow: options.contextWindow || 32768 });
    const validatedSummary = validateCompactionSummary(modelSummary);
    if (!validatedSummary) return { ...base, compactFailed: true, compactFailureReason: 'invalid_summary', activeWindow: base.activeWindow };
    const records = Array.isArray(deterministic.compactionRecords) ? deterministic.compactionRecords.slice() : [];
    const latestIndex = records.length - 1;
    if (latestIndex >= 0) records[latestIndex] = {
      ...records[latestIndex],
      structuredSummary: validatedSummary,
      summary: JSON.stringify(validatedSummary).slice(0, 12000),
    };
    const windows = Array.isArray(deterministic.compactedWindows) ? deterministic.compactedWindows.slice() : [];
    if (latestIndex >= 0 && windows.length > 0) windows[windows.length - 1] = records[latestIndex];
    return { ...deterministic, compactionRecords: records, compactedWindows: windows };
  } catch {
    return { ...base, compactFailed: true, compactFailureReason: 'summary_request_failed', activeWindow: base.activeWindow, modelEvents: base.modelEvents, auditEvents: base.auditEvents };
  }
}

export function replayContextEvents(replay, { currentReferenceImages = [] } = {}) {
  const result = [];
  const visualAssets = new Map((Array.isArray(replay?.visualAssets) ? replay.visualAssets : []).flatMap((asset) => {
    const id = text(asset?.id || asset?.assetId);
    return id ? [[id, asset]] : [];
  }));
  const sessionId = replay?.activeWindow?.sessionId || replay?.sessionId || '';
  const activeEvents = Array.isArray(replay?.modelEvents) && replay.modelEvents.length
    ? replay.modelEvents
    : replay?.events;
  const events = aggregateAssistantTextEvents(normalizeToolCallPairs(activeEvents, { sessionId }));
  for (const event of events) {
    if (event.type === 'compaction') {
      const summary = text(event.content || event.summary).trim();
      if (summary) result.push({
        role: 'system',
        content: `Previous context summary (compacted):\n${summary}`,
      });
    }
    else if (event.type === 'user_text' || event.type === 'assistant_text') result.push({ role: event.type === 'user_text' ? 'user' : 'assistant', content: event.content || '' });
    else if (event.type === 'tool_call') {
      const callId = text(event.toolCallId || event.callId || event.id);
      const name = text(event.toolName || event.name) || 'tool';
      const args = event.arguments && typeof event.arguments === 'object' ? event.arguments : {};
      result.push({ role: 'assistant', content: '', tool_calls: [{ id: callId, type: 'function', function: { name, arguments: JSON.stringify(args) } }] });
    } else if (event.type === 'tool_result') {
      const callId = text(event.toolCallId || event.callId);
      const name = text(event.toolName || event.name) || 'tool';
      const content = typeof event.result === 'string' ? event.result : JSON.stringify(event.result ?? null);
      result.push({ role: 'tool', tool_call_id: callId, name, content });
    }
    else if (event.type === 'image_input') {
      const asset = event.assetId ? visualAssets.get(event.assetId) : null;
      const source = replayableImageSource(event.src) || replayableImageSource(event.previewSrc) || replayableImageSource(asset?.durableSrc) || replayableImageSource(asset?.previewSrc);
      const last = result.at(-1);
      if (source && last?.role === 'user') last.content = [{ type: 'text', text: typeof last.content === 'string' ? last.content : '' }, { type: 'image_url', image_url: { url: source } }];
    }
    else if (event.type === 'image_output') {
      const asset = event.assetId ? visualAssets.get(event.assetId) : null;
      const source = replayableImageSource(event.src) || replayableImageSource(event.previewSrc) || replayableImageSource(asset?.durableSrc) || replayableImageSource(asset?.previewSrc);
      if (source) {
        const previous = result.at(-1);
        if (previous?.role === 'tool') {
          const content = typeof previous.content === 'string'
            ? [{ type: 'text', text: previous.content }]
            : [...(Array.isArray(previous.content) ? previous.content : [])];
          content.push({ type: 'image_url', image_url: { url: source } });
          previous.content = content;
        } else {
          result.push({ role: 'tool', tool_call_id: text(event.toolCallId) || `image-output:${event.eventId}`, name: 'image_output', content: [{ type: 'image_url', image_url: { url: source } }] });
        }
      }
    }
  }
  const explicit = (Array.isArray(currentReferenceImages) ? currentReferenceImages : []).map(replayableImageSource).filter(Boolean);
  if (explicit.length) {
    const last = result.at(-1);
    if (last?.role === 'user') {
      const content = typeof last.content === 'string' ? [{ type: 'text', text: last.content }] : [...(Array.isArray(last.content) ? last.content : [])];
      const existing = new Set(content.filter((part) => part?.type === 'image_url').map((part) => part.image_url?.url));
      for (const source of explicit) if (!existing.has(source)) content.push({ type: 'image_url', image_url: { url: source } });
      last.content = content;
    }
  }
  return result;
}

/**
 * Convert the active event window into provider-neutral response items.
 * Provider adapters can map these items to their native wire format.
 */
export function buildResponseItems(replay, { currentReferenceImages = [] } = {}) {
  const base = buildReplayableContext(replay || {});
  const sessionId = base.activeWindow?.sessionId || base.sessionId || '';
  const activeEvents = Array.isArray(base.modelEvents) && base.modelEvents.length ? base.modelEvents : base.events;
  const events = aggregateAssistantTextEvents(normalizeToolCallPairs(activeEvents, { sessionId }));
  const items = [];
  for (const event of events) {
    if (event.type === 'compaction') {
      const summary = text(event.content || event.summary).trim();
      if (summary) items.push({ type: 'text', role: 'system', text: `Previous context summary (compacted):\n${summary}` });
    }
    else if (event.type === 'user_text' || event.type === 'assistant_text') items.push({ type: 'text', role: event.type === 'user_text' ? 'user' : 'assistant', text: text(event.content) });
    else if (event.type === 'tool_call') items.push({ type: 'tool_call', callId: text(event.toolCallId || event.callId || event.id), name: text(event.toolName || event.name) || 'tool', arguments: event.arguments && typeof event.arguments === 'object' ? event.arguments : {} });
    else if (event.type === 'tool_result') items.push({ type: 'tool_result', callId: text(event.toolCallId || event.callId), name: text(event.toolName || event.name) || 'tool', result: event.result ?? null, isError: event.isError === true });
    else if (event.type === 'image_input' && text(event.assetId)) items.push({ type: 'local_image', role: 'user', assetId: text(event.assetId) });
    else if (event.type === 'image_output' && text(event.assetId)) items.push({ type: 'tool_result_image', callId: text(event.toolCallId) || `image-output:${event.eventId}`, assetId: text(event.assetId) });
    else if (event.type === 'confirmation' || event.type === 'clarification' || event.type === 'recovery') items.push({ type: event.type, data: { ...event } });
  }
  // Current request references are transient and may legitimately be data
  // URLs; only persisted event fields are subject to binary-source filtering.
  for (const source of (Array.isArray(currentReferenceImages) ? currentReferenceImages : []).map((value) => text(value).trim()).filter(Boolean)) {
    items.push({ type: 'local_image', role: 'user', source });
  }
  return items;
}

export const replayResponseItems = buildResponseItems;

// Compatibility helper for callers that already hold a normalized event array.
export function replayContext(eventsOrReplay) {
  return replayContextEvents(Array.isArray(eventsOrReplay)
    ? { events: eventsOrReplay, activeWindow: { sessionId: '' } }
    : eventsOrReplay);
}
