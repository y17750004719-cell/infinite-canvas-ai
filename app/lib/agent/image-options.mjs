import {
  getProviderModelQualityOptions,
  normalizeProviderModelAspectRatioForSize,
} from '../image-provider-option-profiles.mjs';
import {
  buildAsyncImageTaskRequests,
  resolveImageCardSize,
} from '../workspace-session-view.mjs';

export const AGENT_DEFAULT_IMAGE_OPTIONS = Object.freeze({
  size: '2048x2048',
  aspectRatio: '3:4',
  quality: 'auto',
  count: 1,
});

export const AGENT_MAX_IMAGE_BATCH_COUNT = 9;

const CHINESE_DIGITS = Object.freeze({
  '零': 0,
  '〇': 0,
  '一': 1,
  '二': 2,
  '两': 2,
  '三': 3,
  '四': 4,
  '五': 5,
  '六': 6,
  '七': 7,
  '八': 8,
  '九': 9,
});

const ENGLISH_NUMBER_VALUES = Object.freeze({
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
});

const NUMBER_TOKEN_SOURCE = String.raw`(?:\d{1,4}|[零〇一二两三四五六七八九十百]+|(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred)(?:[\s-]+(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred))*)`;
const CHINESE_OUTPUT_UNIT_SOURCE = String.raw`(?:张|幅|期|版|款|个\s*(?:版本|方案|封面|海报|图片|图像|设计)|份\s*(?:设计|方案))`;
const ENGLISH_OUTPUT_UNIT_SOURCE = String.raw`(?:images?|pictures?|covers?|posters?|issues?|versions?|variations?|options?|designs?|copies)`;

function parseChineseNumber(token) {
  if (!token || !/^[零〇一二两三四五六七八九十百]+$/.test(token)) return null;
  if (!/[十百]/.test(token)) {
    const digits = [...token].map((char) => CHINESE_DIGITS[char]);
    return digits.some((digit) => digit === undefined) ? null : Number(digits.join(''));
  }
  let total = 0;
  let current = 0;
  for (const char of token) {
    if (char === '百') {
      total += (current || 1) * 100;
      current = 0;
    } else if (char === '十') {
      total += (current || 1) * 10;
      current = 0;
    } else {
      current = CHINESE_DIGITS[char];
    }
  }
  return total + current;
}

function parseEnglishNumber(token) {
  const words = String(token || '').toLowerCase().split(/[\s-]+/).filter(Boolean);
  if (words.length === 0 || words.some((word) => !(word in ENGLISH_NUMBER_VALUES) && word !== 'hundred')) return null;
  let total = 0;
  let current = 0;
  for (const word of words) {
    if (word === 'hundred') current = (current || 1) * 100;
    else current += ENGLISH_NUMBER_VALUES[word];
  }
  total += current;
  return total;
}

export function parseAgentImageCountNumber(value) {
  const token = typeof value === 'string' ? value.trim() : '';
  if (!token) return null;
  if (/^\d{1,4}$/.test(token)) return Number(token);
  return parseChineseNumber(token) ?? parseEnglishNumber(token);
}

function collectCountMatches(text, pattern, countIndexes = [1]) {
  return [...text.matchAll(pattern)]
    .map((match) => {
      const values = countIndexes.map((index) => parseAgentImageCountNumber(match[index]));
      if (values.some((value) => !Number.isFinite(value) || value <= 0)) return null;
      return {
        count: values.reduce((product, value) => product * value, 1),
        matchedText: match[0].trim(),
      };
    })
    .filter(Boolean);
}

/**
 * Resolve an image deliverable count from natural language without confusing
 * scene subjects, aspect ratios, resolutions, years, or model names for outputs.
 */
export function extractAgentImageCount(input) {
  const text = typeof input === 'string'
    ? input.normalize('NFKC').trim()
    : '';
  if (!text) return { status: 'none', source: 'default', candidates: [] };

  const compoundMatches = [
    ...collectCountMatches(
      text,
      new RegExp(`(${NUMBER_TOKEN_SOURCE})\\s*(?:套|期)\\s*[,，;；]?\\s*每(?:套|期)\\s*(${NUMBER_TOKEN_SOURCE})\\s*${CHINESE_OUTPUT_UNIT_SOURCE}`, 'giu'),
      [1, 2],
    ),
    ...collectCountMatches(
      text,
      new RegExp(`(${NUMBER_TOKEN_SOURCE})\\s+(?:sets?|issues?)\\s*[,;]?\\s*(${NUMBER_TOKEN_SOURCE})\\s+${ENGLISH_OUTPUT_UNIT_SOURCE}\\s+(?:each|per\\s+(?:set|issue))`, 'giu'),
      [1, 2],
    ),
  ];
  if (compoundMatches.length > 0) {
    const counts = [...new Set(compoundMatches.map((match) => match.count))];
    if (counts.length > 1) {
      return {
        status: 'ambiguous',
        source: 'prompt',
        candidates: counts,
        matchedText: compoundMatches.map((match) => match.matchedText).join('、'),
        reason: '检测到多个不同的复合交付数量。',
      };
    }
    const count = counts[0];
    return {
      status: count > AGENT_MAX_IMAGE_BATCH_COUNT ? 'overflow' : 'resolved',
      count,
      source: 'prompt',
      candidates: [count],
      matchedText: compoundMatches[0].matchedText,
    };
  }

  const directMatches = [
    ...collectCountMatches(
      text,
      new RegExp(`(${NUMBER_TOKEN_SOURCE})\\s*${CHINESE_OUTPUT_UNIT_SOURCE}`, 'giu'),
    ),
    ...collectCountMatches(
      text,
      new RegExp(`(${NUMBER_TOKEN_SOURCE})\\s+${ENGLISH_OUTPUT_UNIT_SOURCE}\\b`, 'giu'),
    ),
    ...collectCountMatches(
      text,
      new RegExp(`(?:图片|图像|封面|海报|版本|方案|期数|数量|image\\s+count|covers?|images?)\\s*[:：]\\s*(${NUMBER_TOKEN_SOURCE})`, 'giu'),
    ),
  ];
  const uniqueCounts = [...new Set(directMatches.map((match) => match.count))];
  if (uniqueCounts.length > 1) {
    return {
      status: 'ambiguous',
      source: 'prompt',
      candidates: uniqueCounts,
      matchedText: directMatches.map((match) => match.matchedText).join('、'),
      reason: '检测到多个不同的交付数量，无法确定以哪个为准。',
    };
  }
  if (uniqueCounts.length === 1) {
    const count = uniqueCounts[0];
    return {
      status: count > AGENT_MAX_IMAGE_BATCH_COUNT ? 'overflow' : 'resolved',
      count,
      source: 'prompt',
      candidates: [count],
      matchedText: directMatches[0].matchedText,
    };
  }

  const looseMatch = text.match(new RegExp(`(?:生成|制作|设计|做|出)\\s*(${NUMBER_TOKEN_SOURCE})\\s*个(?:\\s|$|[\u3002，,;；])`, 'iu'));
  const looseCount = parseAgentImageCountNumber(looseMatch?.[1]);
  if (Number.isFinite(looseCount) && looseCount > 0) {
    return {
      status: 'ambiguous',
      source: 'prompt',
      candidates: [looseCount],
      matchedText: looseMatch[0].trim(),
      reason: '数量未明确修饰图片、封面、版本或其他交付物。',
    };
  }

  return { status: 'none', source: 'default', candidates: [] };
}

function positiveImageCount(value) {
  const count = Number(value);
  return Number.isFinite(count) && count > 0 ? Math.floor(count) : null;
}

/** @param {{
 * prompt?: string,
 * interfaceCount?: number,
 * clarifiedCount?: number,
 * clarifiedSource?: 'clarification'|'prompt'|'interface'|'default'|'batch',
 * batchPlan?: { totalCount: number, completedCount: number, remainingCount: number, batchSize: number },
 * proceedWithCurrent?: boolean,
 * }} input */
export function resolveAgentImageCountDecision({
  prompt,
  interfaceCount,
  clarifiedCount,
  clarifiedSource,
  batchPlan,
  proceedWithCurrent = false,
} = {}) {
  if (batchPlan?.remainingCount > 0) {
    return {
      status: 'resolved',
      count: Math.min(batchPlan.batchSize || AGENT_MAX_IMAGE_BATCH_COUNT, batchPlan.remainingCount),
      totalCount: batchPlan.totalCount,
      source: 'batch',
      batchPlan,
      candidates: [batchPlan.totalCount],
    };
  }
  const resolvedClarifiedCount = positiveImageCount(clarifiedCount);
  if (resolvedClarifiedCount) {
    return {
      status: resolvedClarifiedCount > AGENT_MAX_IMAGE_BATCH_COUNT ? 'overflow' : 'resolved',
      count: resolvedClarifiedCount,
      totalCount: resolvedClarifiedCount,
      source: clarifiedSource || 'clarification',
      candidates: [resolvedClarifiedCount],
    };
  }

  const selectedCount = positiveImageCount(interfaceCount);
  const hasExplicitInterfaceCount = Boolean(selectedCount && selectedCount !== AGENT_DEFAULT_IMAGE_OPTIONS.count);
  if (proceedWithCurrent) {
    const count = hasExplicitInterfaceCount ? selectedCount : AGENT_DEFAULT_IMAGE_OPTIONS.count;
    return {
      status: 'resolved',
      count,
      totalCount: count,
      source: hasExplicitInterfaceCount ? 'interface' : 'default',
      candidates: [count],
    };
  }

  const promptCount = extractAgentImageCount(prompt);
  if (
    (promptCount.status === 'resolved' || promptCount.status === 'overflow')
    && promptCount.count
    && hasExplicitInterfaceCount
    && selectedCount !== promptCount.count
  ) {
    return {
      status: 'ambiguous',
      source: 'prompt',
      candidates: [promptCount.count, selectedCount],
      matchedText: promptCount.matchedText,
      reason: '文字中的交付数量与界面选择的数量不一致。',
    };
  }
  if (promptCount.status !== 'none') {
    return { ...promptCount, totalCount: promptCount.count, source: 'prompt' };
  }
  const count = hasExplicitInterfaceCount ? selectedCount : AGENT_DEFAULT_IMAGE_OPTIONS.count;
  return {
    status: 'resolved',
    count,
    totalCount: count,
    source: hasExplicitInterfaceCount ? 'interface' : 'default',
    candidates: [count],
  };
}

const EXPLICIT_ASPECT_RATIO_IDS = new Set([
  '1:1',
  '9:16',
  '16:9',
  '2:3',
  '3:2',
  '4:3',
  '3:4',
  '4:5',
  '5:4',
  '21:9',
  '9:21',
  '1:4',
  '4:1',
  '1:8',
  '8:1',
]);

export function extractExplicitImageAspectRatio(input) {
  const text = typeof input === 'string' ? input : '';
  const matches = [...text.matchAll(/(\d{1,2})\s*(?::|：|比)\s*(\d{1,2})/g)];
  for (let index = matches.length - 1; index >= 0; index -= 1) {
    const width = Number(matches[index][1]);
    const height = Number(matches[index][2]);
    const normalized = `${width}:${height}`;
    if (EXPLICIT_ASPECT_RATIO_IDS.has(normalized)) return normalized;
  }
  return null;
}

export function normalizeAgentImageCount(requestedCount) {
  const numericCount = Number(requestedCount);
  return Number.isFinite(numericCount) && numericCount > 0
    ? Math.min(AGENT_MAX_IMAGE_BATCH_COUNT, Math.max(1, Math.floor(numericCount)))
    : AGENT_DEFAULT_IMAGE_OPTIONS.count;
}

export function resolveAgentImageOptions({
  prompt,
  selectedAspectRatio,
  requestedSize,
  requestedQuality,
  requestedCount,
  providerId,
  modelId,
  providerImageOptionProfiles = {},
} = {}) {
  const promptAspectRatio = extractExplicitImageAspectRatio(prompt);
  const normalizedSelectedAspectRatio = typeof selectedAspectRatio === 'string' && selectedAspectRatio.trim() && selectedAspectRatio !== 'auto'
    ? selectedAspectRatio.trim()
    : '';
  const requestedAspectRatio = promptAspectRatio
    || normalizedSelectedAspectRatio
    || AGENT_DEFAULT_IMAGE_OPTIONS.aspectRatio;
  const ratioSource = promptAspectRatio
    ? 'prompt'
    : normalizedSelectedAspectRatio
      ? 'selected'
      : 'default';
  const normalizedRequestedSize = typeof requestedSize === 'string' && requestedSize.trim()
    ? requestedSize.trim()
    : AGENT_DEFAULT_IMAGE_OPTIONS.size;
  const size = resolveImageCardSize(
    modelId,
    normalizedRequestedSize,
    AGENT_DEFAULT_IMAGE_OPTIONS.size,
    providerId,
    providerImageOptionProfiles
  );
  const aspectRatio = normalizeProviderModelAspectRatioForSize(
    providerId,
    modelId,
    size,
    requestedAspectRatio,
    providerImageOptionProfiles,
    AGENT_DEFAULT_IMAGE_OPTIONS.aspectRatio
  );
  const qualityOptions = getProviderModelQualityOptions(
    providerId,
    modelId,
    providerImageOptionProfiles
  );
  const normalizedRequestedQuality = typeof requestedQuality === 'string' && requestedQuality.trim()
    ? requestedQuality.trim()
    : AGENT_DEFAULT_IMAGE_OPTIONS.quality;
  const quality = qualityOptions.find((option) => option.id === normalizedRequestedQuality)?.id
    || qualityOptions[0]?.id
    || AGENT_DEFAULT_IMAGE_OPTIONS.quality;
  const count = normalizeAgentImageCount(requestedCount);

  return {
    size,
    aspectRatio,
    quality,
    count,
    requestedSize: normalizedRequestedSize,
    sizeFallback: size !== normalizedRequestedSize,
    requestedAspectRatio,
    ratioSource,
    ratioFallback: aspectRatio !== requestedAspectRatio,
    requestedQuality: normalizedRequestedQuality,
    qualityFallback: quality !== normalizedRequestedQuality,
  };
}

export function resolveAgentImageBatchContinuation({
  currentItems = [],
  remainingItems = [],
  failedItemIds = [],
  batchSize = AGENT_MAX_IMAGE_BATCH_COUNT,
} = {}) {
  const failedIds = new Set(Array.isArray(failedItemIds) ? failedItemIds : []);
  const failedItems = (Array.isArray(currentItems) ? currentItems : [])
    .filter((item) => item?.id && failedIds.has(item.id));
  const pendingItems = [
    ...failedItems,
    ...(Array.isArray(remainingItems) ? remainingItems : []),
  ];
  const safeBatchSize = Number.isFinite(batchSize) && batchSize > 0
    ? Math.floor(batchSize)
    : AGENT_MAX_IMAGE_BATCH_COUNT;
  return {
    pendingCount: pendingItems.length,
    nextItems: pendingItems.slice(0, safeBatchSize),
    remainingItems: pendingItems.slice(safeBatchSize),
  };
}

/** @param {Record<string, any>} input */
export function buildAgentImageGenerationRequests(input = {}) {
  const {
    prompt,
    generationPrompt,
    generationPrompts,
    referenceImages = [],
    providerId,
    modelId,
    allowedModelIds,
    providerImageOptionProfiles = {},
    selectedAspectRatio,
    requestedSize,
    requestedQuality,
    requestedCount,
  } = input;
  const normalizedGenerationPrompts = (Array.isArray(generationPrompts) ? generationPrompts : [])
    .filter((value) => typeof value === 'string' && value.trim())
    .map((value) => value.trim());
  const options = resolveAgentImageOptions({
    prompt,
    selectedAspectRatio,
    requestedSize,
    requestedQuality,
    requestedCount: normalizedGenerationPrompts.length || requestedCount,
    providerId,
    modelId,
    providerImageOptionProfiles,
  });
  const linkedImagePreviews = (Array.isArray(referenceImages) ? referenceImages : [])
    .filter((src) => typeof src === 'string' && src.trim())
    .map((src, index) => ({
      id: `agent-reference-${index + 1}`,
      src,
      label: `image${index + 1}`,
    }));
  const fallbackPrompt = typeof generationPrompt === 'string' && generationPrompt.trim()
    ? generationPrompt.trim()
    : typeof prompt === 'string'
      ? prompt.trim()
      : '';
  const requestPrompts = normalizedGenerationPrompts.length
    ? normalizedGenerationPrompts
    : [fallbackPrompt];
  const requests = requestPrompts.flatMap((inputPrompt) => buildAsyncImageTaskRequests({
    input: inputPrompt,
    linkedImagePreviews,
    modelId,
    allowedModelIds,
    fallbackModel: modelId,
    imageProviderId: providerId,
    providerImageOptionProfiles,
    size: options.size,
    quality: options.quality,
    count: normalizedGenerationPrompts.length ? 1 : options.count,
    aspectRatio: options.aspectRatio,
  }));

  const requestSizes = [...new Set(
    requests
      .map((request) => typeof request?.size === 'string' ? request.size.trim() : '')
      .filter(Boolean)
  )];

  return {
    options: {
      ...options,
      requestSize: requestSizes.length === 1 ? requestSizes[0] : undefined,
      requestSizes,
    },
    requests,
  };
}
