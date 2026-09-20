import {
  extractAgentImageCount,
  extractAgentImageFileCounts,
  parseAgentImageCountNumber,
} from './image-options.mjs';

const DELIVERY_NUMBER_SOURCE = String.raw`(?:\d{1,3}|[零〇一二两三四五六七八九十百]+|one|two|three|four|five|six|seven|eight|nine|ten|twelve)`;
const COMPOSITE_LAYOUT_PATTERN = /(宫格|分屏|多格|联画|contact\s*sheet|(?:multi[-\s]?panel|split[-\s]?screen)|(?:photo\s*)?grid|放在(?:同)?一张图(?:片)?里|一张图(?:片)?(?:中|内)(?:展示|包含|放))/i;
const ONE_CANVAS_PATTERN = /(?:全部|都|统一)?\s*(?:放|排|组合|展示|合并).{0,12}(?:同)?一张图(?:片)?(?:里|中|内)|(?:同)?一张图(?:片)?(?:里|中|内).{0,12}(?:展示|包含|放|组合)|all.{0,16}(?:in|on)\s+(?:one|a\s+single)\s+(?:image|canvas)/i;
const SERIES_BATCH_PATTERN = /(系列|整套|一套|每张(?:都)?(?:不同|更换|换)|分别|依次|各(?:生成|出|做)?一张|共\s*[零〇一二两三四五六七八九十百\d]+\s*期|每期|第[零〇一二两三四五六七八九十百\d]+期|不同(?:的)?(?:主题|主体|动物|人物|产品|场景|风格|构图|版本|款式|方向|版式|布局)|[零〇一二两三四五六七八九十百\d]+\s*个(?:版本|方案|方向)|series|issues?|volumes?|editions?|respectively|each\s+(?:image|cover|poster).{0,16}different|different\s+(?:themes?|subjects?|animals?|scenes?|styles?|compositions?|layouts?|versions?|covers?|posters?|directions?))/i;
const VARIANTS_BATCH_PATTERN = /(同一(?:个)?提示词|相同(?:的)?提示词|同款|随机(?:生成|出|做)|多(?:生成|出|做)几张(?:看看)?|供我挑选|让我挑选|给我挑|same\s+prompt|same\s+brief|random\s+variants?|variations?\s+to\s+choose)/i;
const NUMBERED_SERIES_ITEM_PATTERN = /(?:^|\n)\s*(?:\d+[.)、]|第[零〇一二两三四五六七八九十百\d]+期)/g;

function resolvePanelCount(text) {
  const fixed = text.match(/(四|九|六|三|二|两)宫格/i)?.[1];
  if (fixed) return parseAgentImageCountNumber(fixed);
  const explicit = text.match(new RegExp(`(${DELIVERY_NUMBER_SOURCE})\\s*(?:宫格|格(?:布局|画面|图片)|[-\\s]?panels?\\b)`, 'i'))?.[1];
  if (explicit) return parseAgentImageCountNumber(explicit);
  const directionCount = text.match(new RegExp(`(${DELIVERY_NUMBER_SOURCE})\\s*个?(?:方案|(?:设计)?方向|画面|版本).{0,18}(?:同)?一张图`, 'i'))?.[1];
  return parseAgentImageCountNumber(directionCount);
}

function resolveVariationAxes(text) {
  return [
    ['subject', /不同(?:的)?(?:主题|主体|动物|人物|产品)|分别.{0,16}(?:狗|猫|兔|虎)|(?:动物|主体|人物|产品).{0,8}(?:可以是|例如|比如)|different\s+(?:themes?|subjects?|animals?|people|products?)|(?:animals?|subjects?|people|products?).{0,12}(?:such as|including)/i],
    ['scene', /不同(?:的)?(?:场景|地点|背景)|different\s+(?:scenes?|locations?|backgrounds?)/i],
    ['style', /不同(?:的)?(?:风格|造型|配色)|different\s+(?:styles?|looks?|color)/i],
    ['composition', /不同(?:的)?(?:构图|版式|布局)|different\s+(?:compositions?|layouts?)/i],
    ['version', /版本|方案|方向|versions?|options?|directions?/i],
  ].filter(([, pattern]) => pattern.test(text)).map(([axis]) => axis);
}

function resolveEachItemListCount(text) {
  const list = text.match(/([^\s，,。；;\n]+(?:[、，,][^\s，,。；;\n]+){1,})\s*各(?:生成|出|做)?一张/)?.[1];
  return list ? list.split(/[、，,]/).filter(Boolean).length : null;
}

function appendUnique(values, additions) {
  return [...new Set([...(Array.isArray(values) ? values : []), ...additions])];
}

export function resolveImageDeliveryPlan(text, fallbackOutputCount = 1) {
  const normalized = typeof text === 'string' ? text.normalize('NFKC').replace(/[\u200B-\u200D\uFEFF]/g, '').trim() : '';
  const countResolution = extractAgentImageCount(normalized);
  const fileCounts = extractAgentImageFileCounts(normalized);
  const uniqueFileCounts = [...new Set(fileCounts.map((item) => item.count))];
  const composite = COMPOSITE_LAYOUT_PATTERN.test(normalized);
  const oneCanvas = ONE_CANVAS_PATTERN.test(normalized);
  const conflictingCanvasScope = composite && oneCanvas && uniqueFileCounts.includes(1) && uniqueFileCounts.some((count) => count > 1);
  const resolvedCount = countResolution.status === 'resolved' || countResolution.status === 'overflow'
    ? countResolution.count
    : null;
  const eachItemListCount = resolveEachItemListCount(normalized);
  const outputCount = composite && oneCanvas && !conflictingCanvasScope
    ? 1
    : eachItemListCount
      ? eachItemListCount
      : uniqueFileCounts.length === 1
        ? uniqueFileCounts[0]
        : resolvedCount || (Number.isFinite(fallbackOutputCount) && fallbackOutputCount > 0 ? Math.floor(fallbackOutputCount) : 1);
  const numberedItems = normalized.match(NUMBERED_SERIES_ITEM_PATTERN) || [];
  const series = outputCount > 1 && (SERIES_BATCH_PATTERN.test(normalized) || numberedItems.length > 1);
  const variants = VARIANTS_BATCH_PATTERN.test(normalized);
  const mode = composite ? 'composite' : series ? 'series' : 'variants';
  const evidence = [
    composite ? 'composite_layout' : '',
    series ? 'per_item_variation' : '',
    variants ? 'same_prompt_variants' : '',
    eachItemListCount ? 'ordered_item_list' : '',
    countResolution.matchedText || '',
  ].filter(Boolean);
  return {
    mode,
    outputCount,
    promptCount: mode === 'series' ? outputCount : 1,
    panelCount: composite ? resolvePanelCount(normalized) || undefined : undefined,
    variationAxes: eachItemListCount ? appendUnique(resolveVariationAxes(normalized), ['subject']) : resolveVariationAxes(normalized),
    evidence,
    confidence: composite || series || variants ? 'high' : evidence.length ? 'medium' : 'low',
    requiresClarification: conflictingCanvasScope,
  };
}

export function resolveAgentConversationIntent(messages, hasReferenceImages = false) {
  const latest = (Array.isArray(messages) ? messages : []).findLast((message) => message?.role === 'user')?.content || '';
  const text = String(latest).toLowerCase();
  if (/^(\/chat|分析|解释|点评|识别|总结)/i.test(text)) return { intent: 'chat', brief: latest, inherited: false, needsDirectionConfirmation: false };
  const image = /(生成|制作|设计|出图|生图|海报|封面|图片|图像|插画|logo|宫格|拼贴|image|poster|cover)/i.test(text);
  return { intent: image ? 'image' : 'chat', brief: latest, inherited: false, needsDirectionConfirmation: false };
}
