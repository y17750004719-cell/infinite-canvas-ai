import {
  extractAgentImageCount,
  extractAgentImageFileCounts,
  parseAgentImageCountNumber,
} from './image-options.mjs';

const REQUIRED_STRING_FIELDS = ['subject', 'composition', 'lighting', 'finalPrompt'];
const REQUIRED_ARRAY_FIELDS = ['style', 'materials', 'colorPalette', 'constraints'];
const JSON_TEXT_PROMPT_OBJECT_FIELDS = [
  'issue',
  'editorial_direction',
  'subject',
  'styling',
  'composition',
  'environment',
  'typography',
  'lighting',
  'color_system',
  'rendering',
  'series_consistency',
  'constraints',
];
const EXPLICIT_BREED_SERIES_PATTERN = /(?:不同(?:的)?(?:犬种|狗品种|猫品种|动物品种)|不同品种的(?:狗|猫|动物)|different\s+(?:dog|cat|animal)\s+breeds?|breed\s+series)/i;
const ANIMAL_FAMILIES = [
  ['rabbit', /(rabbit|bunny|hare|兔子|兔)/i],
  ['dog', /(dog|canine|greyhound|doberman|poodle|corgi|husky|shiba|terrier|retriever|bulldog|beagle|dachshund|狗|犬|杜宾|灵缇|贵宾|柯基|哈士奇|柴犬|梗犬|寻回犬|斗牛犬|比格|腊肠犬)/i],
  ['tiger', /(tiger|老虎|虎)/i],
  ['cat', /(cat|sphynx|siamese|persian|maine coon|猫|斯芬克斯|暹罗|波斯|缅因)/i],
  ['fox', /(fox|狐狸)/i],
  ['panda', /(panda|熊猫)/i],
  ['bear', /(?:^|\W)(?:bear|熊)(?:\W|$)/i],
  ['lion', /(lion|狮子|狮)/i],
  ['owl', /(owl|猫头鹰)/i],
  ['wolf', /(wolf|狼)/i],
  ['deer', /(deer|stag|鹿)/i],
  ['horse', /(horse|马)/i],
  ['elephant', /(elephant|大象|象)/i],
  ['monkey', /(monkey|ape|猴子|猿)/i],
];

function resolveAnimalFamily(value) {
  const text = typeof value === 'string' ? value : '';
  return ANIMAL_FAMILIES.find(([, pattern]) => pattern.test(text))?.[0] || null;
}

function shouldUseSpeciesLevelIdentity(userPrompt) {
  if (EXPLICIT_BREED_SERIES_PATTERN.test(userPrompt)) return false;
  const families = new Set(ANIMAL_FAMILIES
    .filter(([, pattern]) => pattern.test(userPrompt))
    .map(([family]) => family));
  return families.size >= 2;
}

function parseJsonTextPrompt(value) {
  if (typeof value !== 'string' || !value.trim()) return false;
  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    if (typeof parsed.deliverable !== 'string' || !parsed.deliverable.trim()) return null;
    if (!JSON_TEXT_PROMPT_OBJECT_FIELDS.every((key) => (
      parsed[key] && typeof parsed[key] === 'object' && !Array.isArray(parsed[key])
    ))) return null;
    if (typeof parsed.subject.subject_key !== 'string' || !parsed.subject.subject_key.trim()) return null;
    return parsed;
  } catch {
    return null;
  }
}

function isJsonTextPrompt(value) {
  return Boolean(parseJsonTextPrompt(value));
}

function normalizeSeriesItems(value, outputCount, allowRepeatedSubjects = false, promptStyle = 'text', userPrompt = '') {
  if (!Array.isArray(value) || value.length !== outputCount) return null;
  const speciesLevelIdentity = promptStyle === 'json-text' && shouldUseSpeciesLevelIdentity(userPrompt);
  const items = value.map((item, index) => {
    const label = typeof item?.label === 'string' ? item.label.trim() : '';
    const subjectKey = typeof item?.subjectKey === 'string' ? item.subjectKey.trim() : '';
    const subject = typeof item?.subject === 'string' ? item.subject.trim() : '';
    const prompt = typeof item?.prompt === 'string' ? item.prompt.trim() : '';
    if (item?.index !== index + 1 || !label || !subjectKey || !subject || !prompt) return null;
    let parsedPrompt = null;
    if (promptStyle === 'json-text') {
      parsedPrompt = parseJsonTextPrompt(prompt);
      if (!parsedPrompt || parsedPrompt.subject.subject_key.trim().toLowerCase() !== subjectKey.toLowerCase()) return null;
    }
    const subjectIdentity = speciesLevelIdentity
      ? resolveAnimalFamily(`${subjectKey} ${subject} ${parsedPrompt?.subject?.type || ''} ${parsedPrompt?.subject?.description || ''}`)
        || subjectKey.toLowerCase().replace(/\s+/g, ' ')
      : subjectKey.toLowerCase().replace(/\s+/g, ' ');
    return { index: index + 1, label, subjectKey, subject, prompt, subjectIdentity };
  });
  if (items.some((item) => !item)) return null;
  const uniquePrompts = new Set(items.map((item) => item.prompt.toLowerCase().replace(/\s+/g, ' ')));
  if (uniquePrompts.size !== outputCount) return null;
  const uniqueSubjects = new Set(items.map((item) => item.subjectIdentity));
  return allowRepeatedSubjects || uniqueSubjects.size === outputCount
    ? items.map(({ subjectIdentity, ...item }) => item)
    : null;
}

export function parseOptimizedImagePrompt(raw, {
  outputCount = 1,
  batchMode = 'variants',
  allowRepeatedSubjects = false,
  promptStyle = 'text',
  userPrompt = '',
} = {}) {
  if (typeof raw !== 'string' || !raw.trim() || raw.includes('```')) return null;
  try {
    const value = JSON.parse(raw);
    if (!value || value.version !== 1 || value.intent !== 'image_generation') return null;
    if (!REQUIRED_STRING_FIELDS.every((key) => typeof value[key] === 'string' && value[key].trim())) return null;
    if (!REQUIRED_ARRAY_FIELDS.every((key) => Array.isArray(value[key]) && value[key].every((item) => typeof item === 'string'))) return null;
    const items = batchMode === 'series'
      ? normalizeSeriesItems(value.items, outputCount, allowRepeatedSubjects, promptStyle, userPrompt)
      : undefined;
    if (batchMode === 'series' && !items) return null;
    const finalPrompt = promptStyle === 'json-text'
      ? isJsonTextPrompt(value.finalPrompt)
        ? value.finalPrompt.trim()
        : items?.[0]?.prompt || null
      : value.finalPrompt.trim();
    if (!finalPrompt) return null;
    return {
      version: 1,
      intent: 'image_generation',
      subject: value.subject.trim(),
      style: value.style,
      composition: value.composition.trim(),
      lighting: value.lighting.trim(),
      materials: value.materials,
      colorPalette: value.colorPalette,
      constraints: value.constraints,
      finalPrompt,
      ...(items ? { items } : {}),
    };
  } catch {
    return null;
  }
}

export function buildPromptOptimizerMessages(userPrompt, skillLabel, {
  outputCount = 1,
  batchMode = 'variants',
  repair = false,
  skillContent = '',
  promptStyle = 'text',
  plannerItems = [],
} = {}) {
  const isSeries = batchMode === 'series' && outputCount > 1;
  const isComposite = batchMode === 'composite';
  const allowRepeatedSubjects = allowsRepeatedSeriesSubjects(userPrompt);
  const system = [
    'You are a visual prompt optimizer for professional image-generation models.',
    'Return exactly one JSON object. Do not use Markdown, code fences, commentary, or extra keys.',
    `Schema: {"version":1,"intent":"image_generation","subject":"","style":[],"composition":"","lighting":"","materials":[],"colorPalette":[],"constraints":[],"finalPrompt":""${isSeries ? ',"items":[{"index":1,"label":"","subjectKey":"","subject":"","prompt":""}]' : ''}}.`,
    promptStyle === 'json-text'
      ? 'finalPrompt and every item.prompt remain string fields in this outer response, but each string must contain one complete valid JSON object following the active skill template. Escape the nested JSON correctly. Do not flatten it into prose.'
      : 'Write finalPrompt in precise English, but preserve brand names, literal copy, product names, and explicit user constraints verbatim.',
    'Improve composition, materials, lighting, and art direction without changing model, size, aspect ratio, or quality. Outer image count is handled by orchestration and must not appear as an instruction inside a single-image prompt.',
    isComposite
      ? 'The user explicitly wants one composite image. Describe one intentional grid or multi-panel canvas and map the requested content across its panels.'
      : 'Every finalPrompt and item.prompt describes exactly one standalone image on one canvas. Never request a collage, contact sheet, split screen, multi-panel layout, or grid of alternatives.',
    ...(isSeries ? [
      'First derive an internal delivery contract: deliverable type, exact count, shared invariants, variation dimensions, candidate pool, and literal constraints. Do not add extra JSON keys for this contract.',
      `This is one cohesive series with exactly ${outputCount} deliverables. Return exactly ${outputCount} items with sequential indexes 1 through ${outputCount}.`,
      'Each item.prompt must be a complete standalone image prompt with shared series art direction and a distinct issue subject or content direction.',
      'item.subjectKey is the short canonical identity used to detect repetition, such as “rabbit”, “dog”, “rose perfume”, or “summer campaign”. Put breed, styling, location, pose, and narrative detail in item.subject or item.prompt, never in subjectKey.',
      'When an animal candidate pool is named at species level, use species-level subjectKey values. Doberman and greyhound are both “dog”, while Sphynx and Siamese are both “cat”; breed changes do not create another species unless the user explicitly requests a breed series.',
      'Treat words such as “例如”, “比如”, “等等”, “等”, “such as”, “including”, and “and so on” as examples or an expandable candidate pool, not as a command to repeat the first candidate.',
      'When the user fully describes one reference asset and then asks for a similar series, preserve its design system and creative premise while varying the content dimensions; do not duplicate every literal scene detail unless the user says every item must contain it.',
      'Map explicitly assigned, numbered, or ordered subjects to items in their original order. For an example-based candidate pool, use it diversely but treat its order as non-binding unless the user says otherwise. Never select only the first named subject and repeat it.',
      'If the user provides fewer subjects than requested, automatically add suitable non-repeating subjects. If none are provided, choose distinct suitable subjects yourself.',
      allowRepeatedSubjects
        ? 'The user explicitly requires the same subject across the series. Preserve it and make every item distinct through composition, setting, styling, narrative, or content direction.'
        : 'Every item.subjectKey must name a distinct subject or content direction. Repeating one subject for every item is invalid even when styling or locations differ.',
      'All item prompts must be meaningfully different while preserving shared brand, typography, layout, style, and literal-copy constraints.',
      'Example: a Vogue-style animal cover is described, followed by “a similar series, 5 issues; animals can be dogs, rabbits, cats, tigers, etc.” The contract is five coordinated editorial covers. Use dog, rabbit, cat, tiger, then add another species such as fox or panda. Using two dog breeds for two issues does not satisfy the fifth species.',
      'Example: “the same robot across 3 campaign posters” keeps one robot but varies the scene and campaign message in three independent prompts.',
      ...(Array.isArray(plannerItems) && plannerItems.length > 0
        ? [`Authoritative Planner item contract — preserve these ${plannerItems.length} items in order and do not replace their subjects or variation directions:\n${JSON.stringify(plannerItems)}`]
        : []),
    ] : []),
    ...(typeof skillContent === 'string' && skillContent.trim()
      ? [`Active skill instructions — follow the domain workflow and prompt format exactly:\n\n${skillContent.trim()}`]
      : []),
    ...(repair ? ['The previous response failed schema or uniqueness validation. Correct it completely in this response.'] : []),
  ].join('\n');
  const skillContext = skillLabel ? `Active design skill: ${skillLabel}\n` : '';
  return [
    { role: 'system', content: system },
    { role: 'user', content: `${skillContext}User request:\n${String(userPrompt || '').trim()}` },
  ];
}

const DELIVERY_NUMBER_SOURCE = String.raw`(?:\d{1,3}|[零〇一二两三四五六七八九十百]+|one|two|three|four|five|six|seven|eight|nine|ten|twelve)`;
const COMPOSITE_LAYOUT_PATTERN = /(宫格|分屏|多格|联画|contact\s*sheet|(?:multi[-\s]?panel|split[-\s]?screen)|(?:photo\s*)?grid|放在(?:同)?一张图(?:片)?里|一张图(?:片)?(?:中|内)(?:展示|包含|放))/i;
const ONE_CANVAS_PATTERN = /(?:全部|都|统一)?\s*(?:放|排|组合|展示|合并).{0,12}(?:同)?一张图(?:片)?(?:里|中|内)|(?:同)?一张图(?:片)?(?:里|中|内).{0,12}(?:展示|包含|放|组合)|all.{0,16}(?:in|on)\s+(?:one|a\s+single)\s+(?:image|canvas)/i;
const SERIES_BATCH_PATTERN = /(系列|整套|一套|每张(?:都)?(?:不同|更换|换)|分别|依次|各(?:生成|出|做)?一张|共\s*[零〇一二两三四五六七八九十百\d]+\s*期|每期|第[零〇一二两三四五六七八九十百\d]+期|不同(?:的)?(?:主题|主体|动物|人物|产品|场景|风格|构图|版本|款式|方向|版式|布局)|[零〇一二两三四五六七八九十百\d]+\s*个(?:版本|方案|方向)|series|issues?|volumes?|editions?|respectively|each\s+(?:image|cover|poster).{0,16}different|different\s+(?:themes?|subjects?|animals?|scenes?|styles?|compositions?|layouts?|versions?|covers?|posters?|directions?))/i;
const VARIANTS_BATCH_PATTERN = /(同一(?:个)?提示词|相同(?:的)?提示词|同款|随机(?:生成|出|做)|多(?:生成|出|做)几张(?:看看)?|供我挑选|让我挑选|给我挑|same\s+prompt|same\s+brief|random\s+variants?|variations?\s+to\s+choose)/i;
const NUMBERED_SERIES_ITEM_PATTERN = /(?:^|\n)\s*(?:\d+[.)、]|第[零〇一二两三四五六七八九十百\d]+期)/g;
const SAME_SUBJECT_SERIES_PATTERN = /(?:同一|相同|同款|固定|保持同一)(?:只|个|位|款)?(?:主体|角色|人物|动物|产品|物体|对象|形象|猫|狗|兔子|机器人)|same\s+(?:subject|character|person|animal|product|object|figure|cat|dog|rabbit|robot)|keep\s+the\s+same\s+(?:subject|character|person|animal|product|object|figure)/i;

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

export function allowsRepeatedSeriesSubjects(text) {
  return SAME_SUBJECT_SERIES_PATTERN.test(typeof text === 'string' ? text : '');
}

export function resolveImageBatchMode(text, outputCount = 1) {
  return resolveImageDeliveryPlan(text, outputCount).mode;
}

function appendUnique(values, additions) {
  return [...new Set([...(Array.isArray(values) ? values : []), ...additions])];
}

function stripOuterDeliveryCounts(prompt, mode) {
  const matches = mode === 'composite'
    ? extractAgentImageFileCounts(prompt)
    : String(extractAgentImageCount(prompt).matchedText || '')
        .split('、')
        .filter(Boolean)
        .map((matchedText) => ({ matchedText }));
  return matches.reduce((result, { matchedText }) => (
    result.split(matchedText).join(/[A-Za-z]/.test(matchedText) ? 'one image' : '一张图片')
  ), prompt);
}

export function applyImagePromptDeliveryContract(prompt, deliveryPlan = {}) {
  const source = typeof prompt === 'string' ? prompt.trim() : '';
  if (!source) return source;
  const mode = deliveryPlan.mode || 'variants';
  const panelCount = Number(deliveryPlan.panelCount) > 0 ? Math.floor(deliveryPlan.panelCount) : null;
  try {
    const parsed = JSON.parse(source);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object');
    parsed.constraints = parsed.constraints && typeof parsed.constraints === 'object' && !Array.isArray(parsed.constraints)
      ? parsed.constraints
      : {};
    parsed.composition = parsed.composition && typeof parsed.composition === 'object' && !Array.isArray(parsed.composition)
      ? parsed.composition
      : {};
    if (mode === 'composite') {
      const gridLabel = panelCount ? `${panelCount}-panel grid` : 'intentional multi-panel composition';
      parsed.constraints.must_preserve = appendUnique(parsed.constraints.must_preserve, [`Render exactly one image file as one ${gridLabel}.`]);
      parsed.composition.layout = [parsed.composition.layout, gridLabel].filter(Boolean).join('; ');
    } else {
      parsed.constraints.must_preserve = appendUnique(parsed.constraints.must_preserve, ['Render exactly one standalone image on one canvas; series metadata is context only.']);
      parsed.constraints.avoid = appendUnique(parsed.constraints.avoid, ['collage', 'contact sheet', 'split screen', 'multi-panel layout', 'grid of alternatives']);
    }
    return JSON.stringify(parsed);
  } catch {
    const base = stripOuterDeliveryCounts(source, mode);
    return mode === 'composite'
      ? `${base}\n\nOutput contract: render exactly one image file as one ${panelCount ? `${panelCount}-panel grid` : 'intentional multi-panel composition'}.`
      : `${base}\n\nOutput contract: render exactly one standalone image on one canvas. No collage, contact sheet, split screen, multi-panel layout, or grid of alternatives.`;
  }
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
