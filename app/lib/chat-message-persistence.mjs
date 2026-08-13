import { normalizeAgentRecoveryRecord } from './agent/recovery.mjs';

const isRecord = (value) => typeof value === 'object' && value !== null;
const text = (value) => typeof value === 'string' ? value : '';

/** @returns {import('./db').AgentConversationMemory | undefined} */
export function normalizeAgentConversationMemory(value) {
  if (!isRecord(value)) return undefined;
  const boundedText = (entry, limit) => text(entry).trim().slice(0, limit);
  const list = (entries, maxItems, maxLength) => Array.isArray(entries)
    ? entries.map((entry) => boundedText(entry, maxLength)).filter(Boolean).slice(0, maxItems)
    : [];
  const recentRawConversation = Array.isArray(value.recentRawConversation)
    ? value.recentRawConversation.slice(-20).flatMap((message) => (
      isRecord(message) && (message.role === 'user' || message.role === 'assistant') && boundedText(message.content, 2000)
        ? [{ role: message.role, content: boundedText(message.content, 2000) }]
        : []
    ))
    : [];
  const activeTask = isRecord(value.activeTask)
    && ['idle', 'planning', 'awaiting_confirmation', 'executing', 'completed', 'failed'].includes(value.activeTask.status)
    && boundedText(value.activeTask.summary, 1000)
    ? {
      status: value.activeTask.status,
      summary: boundedText(value.activeTask.summary, 1000),
      ...(boundedText(value.activeTask.taskId, 200) ? { taskId: boundedText(value.activeTask.taskId, 200) } : {}),
    }
    : null;
  return {
    version: 1,
    recentRawConversation,
    rollingSummary: boundedText(value.rollingSummary, 6000),
    facts: list(value.facts, 24, 500),
    preferences: list(value.preferences, 16, 500),
    activeTask,
    recentReferencedAssetIds: list(value.recentReferencedAssetIds, 20, 200),
    updatedAt: Number.isFinite(Number(value.updatedAt)) ? Number(value.updatedAt) : Date.now(),
  };
}

function createLegacyReference(messageId, src, index, overrides = {}) {
  return {
    id: text(overrides.id) || `${messageId}:reference:${index + 1}`,
    src,
    ...(text(overrides.plannerPreviewSrc) ? { plannerPreviewSrc: overrides.plannerPreviewSrc } : {}),
    label: text(overrides.label) || `image${index + 1}`,
    source: ['upload', 'history', 'canvas'].includes(overrides.source) ? overrides.source : 'upload',
    role: ['reference', 'edit_target', 'annotation_bundle', 'region_target'].includes(overrides.role) ? overrides.role : 'reference',
    ...(text(overrides.canvasItemId) ? { canvasItemId: overrides.canvasItemId } : {}),
    ...(Number.isFinite(overrides.annotationCount) ? { annotationCount: overrides.annotationCount } : {}),
    ...(text(overrides.regionId) ? { regionId: overrides.regionId } : {}),
    ...(text(overrides.candidateId) ? { candidateId: overrides.candidateId } : {}),
    ...(overrides.role === 'region_target' ? { confirmationStatus: 'confirmed' } : {}),
    ...(Array.isArray(overrides.aliases) ? { aliases: overrides.aliases } : {}),
    ...(text(overrides.description) ? { description: overrides.description } : {}),
    ...(['high', 'medium', 'low'].includes(overrides.confidence) ? { confidence: overrides.confidence } : {}),
    ...(overrides.targetPoint && typeof overrides.targetPoint === 'object' ? { targetPoint: overrides.targetPoint } : {}),
    ...(overrides.targetBox && typeof overrides.targetBox === 'object' ? { targetBox: overrides.targetBox } : {}),
  };
}

export function normalizeChatMessageReferences(message) {
  if (!isRecord(message)) return message;
  const agentRecovery = normalizeAgentRecoveryRecord(message.agentRecovery);
  const messageId = text(message.id) || 'message';
  const existingContext = isRecord(message.referenceContext) ? message.referenceContext : null;
  const references = [];
  const referenceById = new Map();
  const referenceIdByKey = new Map();
  const referenceIdBySrc = new Map();

  const referenceKey = (candidate) => {
    if (candidate?.role !== 'region_target') return `src:${candidate?.src || ''}`;
    const regionIdentity = text(candidate.regionId) || text(candidate.id) || [
      candidate?.src,
      JSON.stringify(candidate?.targetPoint || null),
      JSON.stringify(candidate?.targetBox || null),
    ].join(':');
    return `region:${regionIdentity}`;
  };

  const addReference = (candidate) => {
    if (!isRecord(candidate) || !text(candidate.src)) return null;
    const dedupeKey = referenceKey(candidate);
    const existingId = referenceIdByKey.get(dedupeKey);
    if (existingId) return existingId;
    const normalized = createLegacyReference(messageId, candidate.src, references.length, candidate);
    let id = normalized.id;
    while (referenceById.has(id)) id = `${normalized.id}:${references.length + 1}`;
    normalized.id = id;
    references.push(normalized);
    referenceById.set(id, normalized);
    referenceIdByKey.set(dedupeKey, id);
    if (!referenceIdBySrc.has(normalized.src)) referenceIdBySrc.set(normalized.src, id);
    return id;
  };

  for (const reference of Array.isArray(existingContext?.references) ? existingContext.references : []) {
    addReference(reference);
  }
  for (const src of Array.isArray(message.referenceImages) ? message.referenceImages : []) {
    if (text(src)) addReference({ src });
  }
  for (const segment of Array.isArray(message.inlineContent) ? message.inlineContent : []) {
    if (isRecord(segment) && segment.type === 'reference' && text(segment.src)) addReference(segment);
  }

  const composerSegments = [];
  const appendSegment = (segment) => {
    if (!isRecord(segment)) return;
    if (segment.type === 'text' && text(segment.text)) {
      const previous = composerSegments[composerSegments.length - 1];
      if (previous?.type === 'text') previous.text += segment.text;
      else composerSegments.push({ type: 'text', text: segment.text });
      return;
    }
    if (segment.type !== 'reference') return;
    const requestedId = text(segment.referenceId) || text(segment.id);
    const referenceId = referenceById.has(requestedId)
      ? requestedId
      : text(segment.src)
        ? referenceIdByKey.get(referenceKey(segment)) || referenceIdBySrc.get(segment.src) || addReference(segment)
        : null;
    if (referenceId) composerSegments.push({ type: 'reference', referenceId });
  };

  const sourceSegments = Array.isArray(existingContext?.composerSegments) && existingContext.composerSegments.length > 0
    ? existingContext.composerSegments
    : Array.isArray(message.inlineContent) && message.inlineContent.length > 0
      ? message.inlineContent
      : [];
  sourceSegments.forEach(appendSegment);
  if (composerSegments.length === 0 && references.length > 0) {
    references.forEach((reference) => composerSegments.push({ type: 'reference', referenceId: reference.id }));
    if (text(message.content)) composerSegments.push({ type: 'text', text: message.content });
  }

  const {
    referenceImages: _legacyReferenceImages,
    inlineContent: _legacyInlineContent,
    referenceContext: _legacyReferenceContext,
    agentRecovery: _legacyAgentRecovery,
    ...rest
  } = message;
  if (references.length === 0) return {
    ...rest,
    ...(agentRecovery ? { agentRecovery } : {}),
  };

  return {
    ...rest,
    ...(agentRecovery ? { agentRecovery } : {}),
    referenceContext: {
      references,
      composerSegments,
      ...(Array.isArray(existingContext?.evidenceImages) && existingContext.evidenceImages.length > 0
        ? { evidenceImages: existingContext.evidenceImages }
        : {}),
    },
  };
}

export function normalizeSessionChatMessages(session) {
  const topics = Array.isArray(session?.topics) ? session.topics : [];
  const activeTopicIndex = topics.findIndex((topic) => topic?.id === session?.activeTopicId);
  const activeSource = activeTopicIndex >= 0 && Array.isArray(topics[activeTopicIndex]?.messages)
    ? topics[activeTopicIndex].messages
    : Array.isArray(session?.messages)
      ? session.messages
      : [];
  const activeMessages = activeSource.map(normalizeChatMessageReferences);
  const normalizedTopics = topics.map((topic, index) => {
    const agentMemory = normalizeAgentConversationMemory(topic?.agentMemory);
    return {
      ...topic,
      ...(agentMemory ? { agentMemory } : {}),
      messages: index === activeTopicIndex
        ? activeMessages
        : (Array.isArray(topic?.messages) ? topic.messages.map(normalizeChatMessageReferences) : []),
    };
  });

  return { messages: activeMessages, topics: normalizedTopics };
}
