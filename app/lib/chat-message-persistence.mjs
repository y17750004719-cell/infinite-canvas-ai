const isRecord = (value) => typeof value === 'object' && value !== null;
const text = (value) => typeof value === 'string' ? value : '';

function createLegacyReference(messageId, src, index, overrides = {}) {
  return {
    id: text(overrides.id) || `${messageId}:reference:${index + 1}`,
    src,
    label: text(overrides.label) || `image${index + 1}`,
    source: ['upload', 'history', 'canvas'].includes(overrides.source) ? overrides.source : 'upload',
    role: ['reference', 'edit_target', 'annotation_bundle'].includes(overrides.role) ? overrides.role : 'reference',
    ...(text(overrides.canvasItemId) ? { canvasItemId: overrides.canvasItemId } : {}),
    ...(Number.isFinite(overrides.annotationCount) ? { annotationCount: overrides.annotationCount } : {}),
  };
}

export function normalizeChatMessageReferences(message) {
  if (!isRecord(message)) return message;
  const messageId = text(message.id) || 'message';
  const existingContext = isRecord(message.referenceContext) ? message.referenceContext : null;
  const references = [];
  const referenceById = new Map();
  const referenceIdBySrc = new Map();

  const addReference = (candidate) => {
    if (!isRecord(candidate) || !text(candidate.src)) return null;
    const existingId = referenceIdBySrc.get(candidate.src);
    if (existingId) return existingId;
    const normalized = createLegacyReference(messageId, candidate.src, references.length, candidate);
    let id = normalized.id;
    while (referenceById.has(id)) id = `${normalized.id}:${references.length + 1}`;
    normalized.id = id;
    references.push(normalized);
    referenceById.set(id, normalized);
    referenceIdBySrc.set(normalized.src, id);
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
        ? referenceIdBySrc.get(segment.src) || addReference(segment)
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
    ...rest
  } = message;
  if (references.length === 0) return rest;

  return {
    ...rest,
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
  const normalizedTopics = topics.map((topic, index) => ({
    ...topic,
    messages: index === activeTopicIndex
      ? activeMessages
      : (Array.isArray(topic?.messages) ? topic.messages.map(normalizeChatMessageReferences) : []),
  }));

  return { messages: activeMessages, topics: normalizedTopics };
}
