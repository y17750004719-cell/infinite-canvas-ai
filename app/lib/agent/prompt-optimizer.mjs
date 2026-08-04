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

export function resolveImageBatchMode(text, outputCount = 1) {
  return resolveImageDeliveryPlan(text, outputCount).mode;
}

function appendUnique(values, additions) {
  return [...new Set([...(Array.isArray(values) ? values : []), ...additions])];
}

const IMAGE_HINTS = ['生成', '生图', '画一个', '设计一个', '各一张', '四宫格', '九宫格', '拼贴', '分屏', '海报', '包装', 'logo', '插画', '封面', '渲染', '视觉稿', '图片'];
const ANALYSIS_HINTS = ['分析', '解释', '点评', '总结', '看看', '识别', '构图怎么样', '风格是什么'];
const IMAGE_EXECUTION_ACTION_PATTERN = /(设计|制作|生成|出图|画|做|create|design|generate|make|produce)/i;
const IMAGE_DELIVERABLE_PATTERN = /(图片|图像|封面|海报|杂志|期刊|画册|插画|视觉|宫格|拼贴|分屏|image|cover|poster|magazine|editorial|issue|series|illustration|visual|grid|collage)/i;
const EXECUTION_CONTINUATION_PATTERN = /^(?:好(?:的)?|可以|同意|确认|没问题|继续(?:生成|制作|执行|出图)?|按(?:这个|此|上述)(?:方案)?来|就按(?:这个|此|上述)(?:方案)?|开始吧|执行吧|生成吧|制作吧|出图吧|就这样|确认(?:生成|执行)?)(?:[\s，,。.!！?？]*(?:(?:请)?(?:给我|帮我)?(?:继续)?(?:生成|制作|执行|出图)(?:这张|该张|图片|图像|封面|海报|任务)?))?[\s，,。.!！?？]*$/i;
const EXECUTION_OFFER_PATTERN = /(?:(?:是否|要不要|可以|准备|接下来|下一步|确认后|请确认).{0,24}(?:继续|开始|生成|制作|执行|出图)|(?:继续|开始).{0,12}(?:生成|制作|执行|出图)|(?:生成|制作|执行|出图).{0,12}(?:吗|呢|[?？]))/i;
const TRANSIENT_FAILURE_MESSAGE_PATTERN = /^(?:(?:生成|任务|运行|请求|连接|网络)[^。！!\n]{0,20}(?:失败|超时|中断)|暂时无法|fetch failed)/i;
const NEXT_ASSET_PATTERN = /(?:下一张|下一版|另一张|第[二三四五六七八九十\d]+张|其余|剩余|继续(?:生成|制作|设计|出图))/i;
const GENERIC_ASSET_WORDS_PATTERN = /(?:请|帮我|为我|继续|开始|生成|制作|设计|出图|下一张|下一版|另一张|第[二三四五六七八九十\d]+张|其余|剩余|一张|一个|封面|海报|图片|图像|视觉稿|版本|方案)/gi;
const GENERATED_IMAGE_HISTORY_PLACEHOLDER_PATTERN = /\[(?:Generated image[^\]]*omitted from chat history|聊天记录中省略了代理生成的图像)\]/gi;

function needsDirectionConfirmation(message, intent, inherited) {
  if (inherited || (intent !== 'image' && intent !== 'skill_action')) return false;
  if (!NEXT_ASSET_PATTERN.test(message)) return false;
  const specificDirection = String(message || '')
    .replace(GENERIC_ASSET_WORDS_PATTERN, '')
    .replace(/[\s，,。.!！?？:：;；、-]+/g, '');
  return specificDirection.length < 2;
}

export function resolveAgentIntent(text, hasReferenceImages = false) {
  const normalized = typeof text === 'string' ? text.trim().toLowerCase() : '';
  if (normalized.startsWith('/chat')) return 'chat';
  if (normalized.startsWith('/img')) return 'image';
  if (/(批量|全部|整套).{0,8}(生成|制作|输出)|开始.{0,8}(品牌物料|vi素材)/i.test(normalized)) return 'skill_action';
  if (/(流程开始信息收集|先询问我|收集.*信息|开始访谈|需求梳理)/i.test(normalized)) return 'chat';
  const imageHit = IMAGE_HINTS.some((hint) => normalized.includes(hint.toLowerCase()));
  const analysisHit = ANALYSIS_HINTS.some((hint) => normalized.includes(hint.toLowerCase()));
  const imageExecutionHit = IMAGE_EXECUTION_ACTION_PATTERN.test(normalized)
    && IMAGE_DELIVERABLE_PATTERN.test(normalized);
  if (analysisHit && !imageExecutionHit) return 'chat';
  if (imageHit || imageExecutionHit) return 'image';
  return hasReferenceImages ? 'chat' : 'chat';
}

export function resolveAgentConversationIntent(messages, hasReferenceImages = false) {
  const conversation = (Array.isArray(messages) ? messages : [])
    .filter((message) => message?.role === 'user' || message?.role === 'assistant')
    .map((message) => ({
      role: message.role,
      content: typeof message.content === 'string'
        ? message.content.replace(GENERATED_IMAGE_HISTORY_PLACEHOLDER_PATTERN, '').trim()
        : '',
    }))
    .filter((message) => message.content);
  const latestUserIndex = conversation.findLastIndex((message) => message.role === 'user');
  const latestUserMessage = latestUserIndex >= 0 ? conversation[latestUserIndex].content : '';
  const directIntent = resolveAgentIntent(latestUserMessage, hasReferenceImages);
  const direct = {
    intent: directIntent,
    brief: latestUserMessage,
    inherited: false,
    needsDirectionConfirmation: needsDirectionConfirmation(latestUserMessage, directIntent, false),
  };
  if (
    latestUserMessage.toLowerCase().startsWith('/chat')
    || !EXECUTION_CONTINUATION_PATTERN.test(latestUserMessage)
  ) {
    return direct;
  }

  const previousAssistantIndex = conversation
    .slice(0, latestUserIndex)
    .findLastIndex((message) => (
      message.role === 'assistant'
      && !TRANSIENT_FAILURE_MESSAGE_PATTERN.test(message.content)
    ));
  if (previousAssistantIndex < 0) return direct;
  const previousAssistantMessage = conversation[previousAssistantIndex].content;
  if (!EXECUTION_OFFER_PATTERN.test(previousAssistantMessage)) return direct;

  for (let index = previousAssistantIndex - 1; index >= 0; index -= 1) {
    const message = conversation[index];
    if (message.role !== 'user') continue;
    const inheritedIntent = resolveAgentIntent(message.content, hasReferenceImages);
    if (inheritedIntent === 'chat') continue;
    return {
      intent: inheritedIntent,
      brief: `${message.content}\n\n用户确认：${latestUserMessage}`,
      inherited: true,
      needsDirectionConfirmation: false,
    };
  }

  return direct;
}
