const PROPOSAL_START = '<<agent_proposal>>';
const PROPOSAL_END = '<</agent_proposal>>';
const ACTIONABLE_PROPOSAL_PATTERN = /(方案|方向|请选择|请确认|建议按|可以选择|生成|制作|出图|封面|海报|视觉)/i;
const LITERAL_NUMBER_PATTERN = /(?:数字|号码|编号|number)\s*[一二三四五六七八九十\d]+/i;
const RATIO_PATTERN = /\b\d+\s*[:：比]\s*\d+\b/;
const REFERENCE_LANGUAGE_PATTERN = /(?:(?:按照|按|选择|选|使用|用|继续|基于|参考|修改).{0,12}(?:第[一二三四五六七八九十\d]+(?:个|项|版|张)?|vol\.?\s*\d+|方案\s*[一二三四五六七八九十\d]*|选项\s*[一二三四五六七八九十\d]*|版本\s*[一二三四五六七八九十\d]*|这个|那个|上一个|刚才|之前|上一张|选中的|左边|右边)|(?:生成|制作|出图).{0,8}(?:这个|那个|上一个|刚才|之前|上一张|选中的|左边|右边)|(?:这个|那个|上一个|刚才那个|之前那个|上一张图|选中的|左边那个|右边那个))/i;

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function numberFromToken(value) {
  const normalized = text(value).toLowerCase();
  if (/^\d+$/.test(normalized)) return Number(normalized);
  const values = { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
  if (values[normalized]) return values[normalized];
  if (/^十[一二三四五六七八九]$/.test(normalized)) return 10 + values[normalized[1]];
  if (/^[二三四五六七八九]十$/.test(normalized)) return values[normalized[0]] * 10;
  if (/^[二三四五六七八九]十[一二三四五六七八九]$/.test(normalized)) {
    return values[normalized[0]] * 10 + values[normalized[2]];
  }
  return 0;
}

function normalizeAliases(value) {
  return Array.from(new Set((Array.isArray(value) ? value : [])
    .map(text)
    .filter(Boolean)));
}

function normalizeProposalOption(value, index, proposalId) {
  if (!value || typeof value !== 'object') return null;
  const id = text(value.id) || `option-${index + 1}`;
  const label = text(value.label);
  const brief = text(value.brief);
  if (!label || !brief) return null;
  const displayIndex = Number.isFinite(Number(value.index)) && Number(value.index) > 0
    ? Math.floor(Number(value.index))
    : index + 1;
  return {
    id,
    entityId: text(value.entityId) || `${proposalId}:${id}`,
    index: displayIndex,
    label,
    aliases: normalizeAliases(value.aliases),
    summary: text(value.summary),
    brief,
    mustPreserve: normalizeAliases(value.mustPreserve),
    referenceImageUrls: normalizeAliases(value.referenceImageUrls),
    canvasItemIds: normalizeAliases(value.canvasItemIds),
  };
}

/**
 * @param {string} content
 * @returns {{cleanContent: string, proposal: import('./context-reference.types').AgentProposal | null}}
 */
export function parseAgentProposalBlock(content) {
  const source = String(content || '');
  const start = source.indexOf(PROPOSAL_START);
  const end = source.indexOf(PROPOSAL_END, start + PROPOSAL_START.length);
  if (start < 0 || end <= start) return { cleanContent: source, proposal: null };
  const raw = source.slice(start + PROPOSAL_START.length, end).trim();
  try {
    const value = JSON.parse(raw);
    if (!value || value.version !== 1) return { cleanContent: source, proposal: null };
    const id = text(value.id);
    const title = text(value.title);
    const intent = ['image', 'skill_action', 'chat'].includes(value.intent) ? value.intent : 'image';
    if (!id || !title || !Array.isArray(value.options) || value.options.length < 2 || value.options.length > 8) {
      return { cleanContent: source, proposal: null };
    }
    const options = value.options.map((option, index) => normalizeProposalOption(option, index, id));
    if (options.some((option) => !option)) return { cleanContent: source, proposal: null };
    const cleanContent = `${source.slice(0, start)}${source.slice(end + PROPOSAL_END.length)}`.trim();
    return {
      cleanContent,
      proposal: {
        version: 1,
        id,
        title,
        intent,
        requiresSelection: value.requiresSelection === true,
        options,
      },
    };
  } catch {
    return { cleanContent: source, proposal: null };
  }
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

function isTableSeparator(cells) {
  return cells.length > 0 && cells.every((cell) => /^:?-{2,}:?$/.test(cell.replace(/\s/g, '')));
}

function legacyOptionsFromTable(lines) {
  const options = [];
  for (const line of lines) {
    if (!line.includes('|')) continue;
    const cells = line.split('|').map(text).filter(Boolean);
    if (cells.length < 2 || isTableSeparator(cells)) continue;
    const first = cells[0];
    const match = first.match(/(?:vol\.?\s*|第|方案|选项)?([一二三四五六七八九十\d]+)(?:个|项|版|张)?/i);
    if (!match) continue;
    const index = numberFromToken(match[1]);
    if (!index) continue;
    const label = cells[1] || first;
    options.push({
      id: `legacy-${index}`,
      index,
      label,
      aliases: [first, `方案${index}`, `选项${index}`, `Vol.${index}`],
      summary: cells.slice(2).join('；'),
      brief: cells.join('；'),
      mustPreserve: [label],
      sourceQuote: line.trim(),
    });
  }
  return options;
}

function legacyOptionsFromList(lines) {
  const options = [];
  for (const line of lines) {
    const match = line.match(/^\s*(?:[-*]\s*)?(?:方案|选项|vol\.?)?\s*([一二三四五六七八九十\d]+)[.、:：)）\-]\s*(.+)$/i);
    if (!match) continue;
    const index = numberFromToken(match[1]);
    const body = text(match[2]);
    if (!index || !body) continue;
    const label = text(body.split(/[：:—–-]/)[0]) || `方案 ${index}`;
    options.push({
      id: `legacy-${index}`,
      index,
      label,
      aliases: [`方案${index}`, `选项${index}`, `Vol.${index}`],
      summary: body,
      brief: body,
      mustPreserve: [label],
      sourceQuote: line.trim(),
    });
  }
  return options;
}

export function extractLegacyProposal(message) {
  const content = text(message?.content);
  if (!content || !ACTIONABLE_PROPOSAL_PATTERN.test(content)) return null;
  const lines = content.split('\n').map((line) => line.trim()).filter(Boolean);
  const rawOptions = legacyOptionsFromTable(lines);
  const options = (rawOptions.length >= 2 ? rawOptions : legacyOptionsFromList(lines)).slice(0, 8);
  if (options.length < 2) return null;
  const id = `legacy-${text(message?.id) || 'message'}`;
  return {
    version: 1,
    id,
    title: '历史方案',
    intent: 'image',
    requiresSelection: /(?:请选择|请确认|是否|按.*生成|选择.*方向)/i.test(content),
    options: options.map((option) => ({
      ...option,
      entityId: `${id}:${option.id}`,
    })),
  };
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
    const proposal = message.agentProposal || extractLegacyProposal(message);
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
        referenceImageUrls: [message.imageUrl],
        sourceMessageId: message.id,
        createdAt,
      });
    }
    for (let referenceIndex = 0; referenceIndex < (message.referenceImages || []).length; referenceIndex += 1) {
      const assetUrl = message.referenceImages[referenceIndex];
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
    entities.push({
      id: `history-image:${image.id || index + 1}`,
      kind: 'generated_image',
      intent: 'image',
      label: `image ${index + 1}`,
      index: index + 1,
      aliases: [`image ${index + 1}`, `image${index + 1}`, `第${index + 1}张图`],
      summary: '当前话题生成历史中的图片',
      brief: `使用生成历史中的 image ${index + 1} 作为视觉参考。`,
      mustPreserve: [],
      assetUrl: image.src,
      referenceImageUrls: [image.src],
      sourceMessageId: image.messageId,
      createdAt: Number(image.createdAt) || index + 1,
    });
  }
  return dedupeEntities(entities);
}

function latestGroup(entities) {
  const proposalEntitiesList = entities.filter((entity) => entity.kind === 'proposal_option');
  if (proposalEntitiesList.length === 0) return [];
  const latest = proposalEntitiesList.reduce((current, entity) => (
    Number(entity.createdAt) >= Number(current.createdAt) ? entity : current
  ));
  return proposalEntitiesList.filter((entity) => entity.groupId === latest.groupId);
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
  if (selected.length > 1) return resolution('ambiguous', true, selected, 'high');
  if (LITERAL_NUMBER_PATTERN.test(message)) return resolution('none', false);

  const withoutRatios = message.replace(RATIO_PATTERN, ' ');
  const normalizedMessage = withoutRatios.toLowerCase();
  const referenceCore = normalizedMessage
    .replace(/(?:生成|制作|执行|出图|图片|图像|封面|海报|请|帮我|给我|用|使用|按|按照|选择|选)/gi, ' ')
    .replace(/[\s，,。.!！?？:：;；、()（）-]+/g, ' ')
    .trim();
  const exact = available.filter((entity) => [entity.label, ...(entity.aliases || [])]
    .map((value) => text(value).toLowerCase())
    .filter((value) => value.length >= 2)
    .some((value) => normalizedMessage.includes(value) || (referenceCore.length >= 2 && value.includes(referenceCore))));
  if (exact.length === 1) return resolution('resolved', true, exact, 'high');
  if (exact.length > 1) return resolution('ambiguous', true, exact.slice(0, 4), 'medium');

  const imageNumberMatch = withoutRatios.match(/(?:image\s*|第)([一二三四五六七八九十\d]+)(?:张图)?/i);
  if (imageNumberMatch && /image|张图|图片|图像/i.test(withoutRatios)) {
    const index = numberFromToken(imageNumberMatch[1]);
    const images = available.filter((entity) => ['generated_image', 'reference_image'].includes(entity.kind) && entity.index === index);
    if (images.length === 1) return resolution('resolved', true, images, 'high');
    if (images.length > 1) return resolution('ambiguous', true, images.slice(0, 4), 'medium');
    return resolution('missing', true);
  }

  const ordinalMatch = withoutRatios.match(/(?:vol\.?\s*|第|方案|选项|版本|按照|按|选择|选|用)\s*(?:方案|选项|版本)?\s*([一二三四五六七八九十\d]+)(?:个|项|版|张)?/i);
  if (ordinalMatch) {
    const index = numberFromToken(ordinalMatch[1]);
    const matches = available.filter((entity) => entity.kind === 'proposal_option' && entity.index === index);
    if (matches.length === 1) return resolution('resolved', true, matches, 'high');
    if (matches.length > 1) return resolution('ambiguous', true, matches.slice(0, 4), 'medium');
    return resolution('missing', true);
  }

  if (/上一张图|刚才那张|之前那张/i.test(withoutRatios)) {
    const images = available.filter((entity) => ['generated_image', 'reference_image'].includes(entity.kind));
    if (images.length === 0) return resolution('missing', true);
    const latest = images.reduce((current, entity) => Number(entity.createdAt) >= Number(current.createdAt) ? entity : current);
    return resolution('resolved', true, [latest], 'high');
  }
  if (/选中的|这张|这个对象|左边那个|右边那个/i.test(withoutRatios)) {
    const canvas = available.filter((entity) => entity.kind === 'canvas_item' && entity.selected);
    if (canvas.length === 1) return resolution('resolved', true, canvas, 'high');
    if (canvas.length > 1 && /左边/i.test(withoutRatios)) {
      return resolution('resolved', true, [canvas.reduce((current, entity) => entity.x < current.x ? entity : current)], 'high');
    }
    if (canvas.length > 1 && /右边/i.test(withoutRatios)) {
      return resolution('resolved', true, [canvas.reduce((current, entity) => entity.x > current.x ? entity : current)], 'high');
    }
    return canvas.length > 1 ? resolution('ambiguous', true, canvas.slice(0, 4), 'medium') : resolution('missing', true);
  }
  if (/上一个|刚才那个|之前那个|这个方案|那个方案|按这个来|就按这个/i.test(withoutRatios)) {
    const previouslyResolved = available.filter((entity) => Number(entity.lastResolvedAt) > 0);
    if (previouslyResolved.length > 0) {
      const latestResolvedAt = Math.max(...previouslyResolved.map((entity) => Number(entity.lastResolvedAt)));
      const latestResolved = previouslyResolved.filter((entity) => Number(entity.lastResolvedAt) === latestResolvedAt);
      if (latestResolved.length === 1) return resolution('resolved', true, latestResolved, 'high');
      if (latestResolved.length > 1) return resolution('ambiguous', true, latestResolved.slice(0, 4), 'medium');
    }
    const group = latestGroup(available);
    if (group.length === 1) return resolution('resolved', true, group, 'high');
    if (group.length > 1) return resolution('ambiguous', true, group.slice(0, 4), 'medium');
    return resolution('missing', true);
  }
  return REFERENCE_LANGUAGE_PATTERN.test(withoutRatios)
    ? resolution('missing', true)
    : resolution('none', false);
}

/**
 * @param {{userMessage?: string, contextResolution?: import('./context-reference.types').AgentContextResolution}} input
 * @returns {import('./context-reference.types').ExecutionBrief}
 */
export function compileExecutionBrief({ userMessage, contextResolution } = {}) {
  const message = text(userMessage);
  const candidates = contextResolution?.status === 'resolved' ? contextResolution.candidates || [] : [];
  if (candidates.length === 0) {
    return {
      version: 1,
      originalRequest: message,
      resolvedEntityIds: [],
      plainText: message,
      mustPreserve: [],
      referenceImageUrls: [],
      canvasItemIds: [],
    };
  }
  const authoritative = candidates.map((candidate) => candidate.brief).filter(Boolean).join('\n');
  const labels = candidates.map((candidate) => candidate.label).filter(Boolean);
  const mustPreserve = normalizeAliases(candidates.flatMap((candidate) => candidate.mustPreserve || labels));
  return {
    version: 1,
    originalRequest: message,
    resolvedEntityIds: candidates.map((candidate) => candidate.id),
    resolvedLabels: labels,
    plainText: `${authoritative}\n\n用户当前要求：${message}`.trim(),
    mustPreserve,
    referenceImageUrls: normalizeAliases(candidates.flatMap((candidate) => candidate.referenceImageUrls || (candidate.assetUrl ? [candidate.assetUrl] : []))),
    canvasItemIds: normalizeAliases(candidates.flatMap((candidate) => candidate.canvasItemIds || [])),
  };
}

/**
 * @param {string} prompt
 * @param {import('./context-reference.types').ExecutionBrief} [executionBrief]
 */
export function ensureOptimizedPromptCoverage(prompt, executionBrief) {
  const optimized = text(prompt);
  const anchors = normalizeAliases(executionBrief?.mustPreserve);
  if (!optimized || anchors.length === 0) return optimized;
  const normalized = optimized.toLowerCase();
  const missing = anchors.filter((anchor) => !normalized.includes(anchor.toLowerCase()));
  if (missing.length === 0) return optimized;
  return `${optimized}\n\nAuthoritative requirements — preserve exactly:\n${executionBrief.plainText}`.trim();
}

export function isReferentialShorthand(value) {
  const message = text(value);
  if (!message || LITERAL_NUMBER_PATTERN.test(message)) return false;
  const withoutRatios = message.replace(RATIO_PATTERN, ' ');
  return REFERENCE_LANGUAGE_PATTERN.test(withoutRatios)
    || /(?:按照|按|选择|选|用)\s*(?:方案|选项|版本)?\s*[一二三四五六七八九十\d]+(?:个|项|版)?/i.test(withoutRatios)
    || /^(?:第?[一二三四五六七八九十\d]+(?:个|项|版)?|vol\.?\s*\d+|这个|那个|上一个|刚才那个|之前那个)$/i.test(withoutRatios.trim());
}

export const AGENT_PROPOSAL_MARKERS = { start: PROPOSAL_START, end: PROPOSAL_END };
