const LITERAL_NUMBER_PATTERN = /(?:数字|号码|编号|number)\s*[一二三四五六七八九十\d]+/i;
const RATIO_PATTERN = /\b\d+\s*[:：比]\s*\d+\b/;
const REFERENCE_LANGUAGE_PATTERN = /(?:(?:按照|按|选择|选|使用|用|继续|基于|参考|修改).{0,12}(?:第[一二三四五六七八九十\d]+(?:个|项|版|张)?|vol\.?\s*\d+|方案\s*[一二三四五六七八九十\d]*|选项\s*[一二三四五六七八九十\d]*|版本\s*[一二三四五六七八九十\d]*|这个|那个|上一个|刚才|之前|上一张|选中的|左边|右边)|(?:生成|制作|出图).{0,8}(?:这个|那个|上一个|刚才|之前|上一张|选中的|左边|右边)|(?:这个|那个|上一个|刚才那个|之前那个|上一张图|选中的|左边那个|右边那个))/i;

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeAliases(value) {
  return Array.from(new Set((Array.isArray(value) ? value : [])
    .map(text)
    .filter(Boolean)));
}



function proposalEntities(proposal, sourceMessageId, createdAt) {
  if (!proposal || !Array.isArray(proposal.options)) return [];
  return proposal.options.map((option) => ({
    id: option.entityId || `${proposal.id}:${option.id}`,
    groupId: proposal.id,
    kind: 'proposal_option',
    intent: proposal.intent || 'image',
    label: option.label,
    index: option.index,
    aliases: normalizeAliases([
      ...normalizeAliases(option.aliases),
      `方案${option.index}`,
      `选项${option.index}`,
      `第${option.index}个`,
      `Vol.${option.index}`,
    ]),
    summary: option.summary || '',
    brief: option.brief,
    mustPreserve: normalizeAliases([option.label, ...normalizeAliases(option.mustPreserve)]),
    assetUrl: option.referenceImageUrls?.[0],
    referenceImageUrls: normalizeAliases(option.referenceImageUrls),
    canvasItemIds: normalizeAliases(option.canvasItemIds),
    sourceMessageId,
    createdAt,
  }));
}

function dedupeEntities(entities) {
  const seen = new Set();
  const seenAssets = new Set();
  return entities.filter((entity) => {
    if (!entity?.id || seen.has(entity.id)) return false;
    const assetKey = entity.assetUrl && ['generated_image', 'reference_image'].includes(entity.kind)
      ? `${entity.kind}:${entity.assetUrl}`
      : '';
    if (assetKey && seenAssets.has(assetKey)) return false;
    seen.add(entity.id);
    if (assetKey) seenAssets.add(assetKey);
    return true;
  });
}

export function buildAgentContextEntities({
  messages = [],
  canvasItems = [],
  selectedItemIds = [],
  generatedImages = [],
} = {}) {
  const entities = [];
  const resolvedSelections = [];
  let imageSequence = 0;
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index] || {};
    const createdAt = Number(message.createdAt) || index + 1;
    const proposal = message.agentProposal;
    entities.push(...proposalEntities(proposal, message.id, createdAt));
    if (message.agentClarification?.request?.options?.length) {
      const request = message.agentClarification.request;
      const proposalLike = {
        id: `clarification-${request.id}`,
        intent: message.agentClarification.state?.intent || 'image',
        options: request.options.map((option, optionIndex) => ({
          ...option,
          entityId: `clarification-${request.id}:${option.id}`,
          index: optionIndex + 1,
          brief: option.answer,
          summary: option.description,
        })),
      };
      entities.push(...proposalEntities(proposalLike, message.id, createdAt));
    }
    if (message.imageUrl) {
      imageSequence += 1;
      const displayIndex = Number(String(message.imageName || '').match(/\d+/)?.[0]) || imageSequence;
      entities.push({
        id: `message-image:${message.id}`,
        kind: 'generated_image',
        intent: 'image',
        label: text(message.imageName) || `image ${displayIndex}`,
        index: displayIndex,
        aliases: [`image ${displayIndex}`, `image${displayIndex}`, `第${displayIndex}张图`],
        summary: '当前话题生成的图片',
        brief: `使用已生成图片 ${text(message.imageName) || `image ${displayIndex}`} 作为视觉参考。`,
        mustPreserve: [],
        assetUrl: message.imageUrl,
        assetId: message.assetId,
        originalSrc: message.imageUrl,
        referenceImageUrls: [message.imageUrl],
        sourceMessageId: message.id,
        createdAt,
      });
    }
    const stableReferenceSources = new Set();
    for (const [referenceIndex, reference] of (message.referenceContext?.references || []).entries()) {
      const assetUrl = text(reference?.src);
      if (!assetUrl) continue;
      stableReferenceSources.add(assetUrl);
      entities.push({
        id: text(reference.id) || `reference-image:${message.id}:${referenceIndex + 1}`,
        kind: 'reference_image',
        intent: 'image',
        label: text(reference.label) || `image${referenceIndex + 1}`,
        index: referenceIndex + 1,
        aliases: normalizeAliases(reference.aliases || [`image ${referenceIndex + 1}`, `参考图${referenceIndex + 1}`]),
        summary: text(reference.description) || '用户提供的历史参考图片',
        brief: `使用用户提供的参考图 ${text(reference.label) || `image${referenceIndex + 1}`}。`,
        mustPreserve: [],
        assetUrl,
        assetId: reference.assetId,
        originalSrc: reference.originalSrc || assetUrl,
        referenceImageUrls: [assetUrl],
        sourceMessageId: message.id,
        createdAt,
      });
    }
    for (let referenceIndex = 0; referenceIndex < (message.referenceImages || []).length; referenceIndex += 1) {
      const assetUrl = message.referenceImages[referenceIndex];
      if (stableReferenceSources.has(assetUrl)) continue;
      entities.push({
        id: `reference-image:${message.id}:${referenceIndex + 1}`,
        kind: 'reference_image',
        intent: 'image',
        label: `image${referenceIndex + 1}`,
        index: referenceIndex + 1,
        aliases: [`image ${referenceIndex + 1}`, `参考图${referenceIndex + 1}`],
        summary: '用户上传的参考图片',
        brief: `使用用户上传的参考图 image${referenceIndex + 1}。`,
        mustPreserve: [],
        assetUrl,
        originalSrc: assetUrl,
        referenceImageUrls: [assetUrl],
        sourceMessageId: message.id,
        createdAt,
      });
    }
    if (message.taskKey) {
      entities.push({
        id: `task:${message.taskKey}`,
        kind: 'task',
        intent: 'skill_action',
        label: text(message.imageName) || text(message.content) || message.taskKey,
        aliases: ['上一个任务', '刚才的任务'],
        summary: text(message.content),
        brief: text(message.content),
        mustPreserve: [],
        sourceMessageId: message.id,
        createdAt,
      });
    }
    if (message.resolvedContext?.entityIds?.length) {
      for (const entityId of message.resolvedContext.entityIds) {
        resolvedSelections.push({ entityId, resolvedAt: createdAt });
      }
    }
  }

  for (const selection of resolvedSelections) {
    const entity = entities.find((candidate) => candidate.id === selection.entityId);
    if (!entity) continue;
    entity.lastResolvedAt = selection.resolvedAt;
    entity.aliases = normalizeAliases([...(entity.aliases || []), '上一个', '刚才那个', '之前那个']);
  }

  const selected = new Set(selectedItemIds || []);
  for (let index = 0; index < canvasItems.length; index += 1) {
    const item = canvasItems[index] || {};
    if (!selected.has(item.id)) continue;
    const label = item.text ? text(item.text).slice(0, 80) : `选中的${item.type === 'image' ? '图片' : '画布对象'}`;
    entities.push({
      id: `canvas:${item.id}`,
      kind: 'canvas_item',
      intent: item.type === 'image' ? 'image' : 'skill_action',
      label,
      aliases: ['选中的', '这个对象', '这张', '左边那个', '右边那个'],
      summary: item.type === 'image' ? '当前选中的画布图片' : '当前选中的画布对象',
      brief: item.type === 'image' ? '使用当前选中的画布图片作为视觉参考。' : `使用当前选中的画布对象：${label}`,
      mustPreserve: item.text ? [label] : [],
      assetUrl: item.src,
      referenceImageUrls: item.src ? [item.src] : [],
      canvasItemIds: [item.id],
      selected: true,
      x: Number(item.x) || 0,
      y: Number(item.y) || 0,
      createdAt: messages.length + index + 1,
    });
  }

  for (let index = 0; index < generatedImages.length; index += 1) {
    const image = generatedImages[index] || {};
    if (!image.src) continue;
    const promptSummary = text(image.promptTrace?.finalPrompt || image.promptTrace?.sourcePrompt).slice(0, 240);
    entities.push({
      id: `history-image:${image.id || index + 1}`,
      kind: 'generated_image',
      intent: 'image',
      label: `image ${index + 1}`,
      index: index + 1,
      aliases: [`image ${index + 1}`, `image${index + 1}`, `第${index + 1}张图`],
      summary: promptSummary ? `当前话题生成历史中的图片：${promptSummary}` : '当前话题生成历史中的图片',
      brief: promptSummary
        ? `使用生成历史中的 image ${index + 1} 作为视觉参考。原始生成摘要：${promptSummary}`
        : `使用生成历史中的 image ${index + 1} 作为视觉参考。`,
      mustPreserve: [],
      assetUrl: image.src,
      assetId: image.assetId,
      originalSrc: image.originalSrc || image.src,
      referenceImageUrls: [image.src],
      sourceMessageId: image.messageId,
      createdAt: Number(image.createdAt) || index + 1,
    });
  }
  return dedupeEntities(entities);
}

function resolution(status, detected, candidates = [], confidence = 'none') {
  return {
    status,
    detected,
    confidence,
    candidates,
    entityIds: status === 'resolved' ? candidates.map((candidate) => candidate.id) : [],
  };
}

/**
 * @param {{
 *   userMessage?: string,
 *   entities?: import('./context-reference.types').AgentContextEntity[],
 *   selectedEntityIds?: string[],
 * }} input
 * @returns {import('./context-reference.types').AgentContextResolution}
 */
export function resolveContextReference({ userMessage, entities = [], selectedEntityIds = [] } = {}) {
  const message = text(userMessage);
  const available = Array.isArray(entities) ? entities.filter((entity) => entity?.id) : [];
  if (!message) return resolution('none', false);
  const selected = available.filter((entity) => selectedEntityIds.includes(entity.id));
  if (selected.length === 1) return resolution('resolved', true, selected, 'high');
  if (selected.length > 1) return resolution('resolved', true, selected, 'high');
  // Semantic matching belongs to Main Agent. Local code only validates a model
  // or user supplied stable ID and must never silently choose a historical asset.
  return isReferentialShorthand(message)
    ? resolution('missing', true)
    : resolution('none', false);
}

export function isReferentialShorthand(value) {
  const message = text(value);
  if (!message || LITERAL_NUMBER_PATTERN.test(message)) return false;
  const withoutRatios = message.replace(RATIO_PATTERN, ' ');
  return REFERENCE_LANGUAGE_PATTERN.test(withoutRatios)
    || /(?:按照|按|选择|选|用)\s*(?:方案|选项|版本)?\s*[一二三四五六七八九十\d]+(?:个|项|版)?/i.test(withoutRatios)
    || /^(?:第?[一二三四五六七八九十\d]+(?:个|项|版)?|vol\.?\s*\d+|这个|那个|上一个|刚才那个|之前那个)$/i.test(withoutRatios.trim());
}
