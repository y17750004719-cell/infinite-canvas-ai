const MAX_OPTIONS = 4;
const MIN_OPTIONS = 2;

const OPTIONAL_ART_DIMENSIONS = new Set([
  'aspect_ratio',
  'camera',
  'color',
  'composition',
  'count',
  'decoration',
  'lighting',
  'material',
  'materials',
  'model',
  'provider',
  'quality',
  'size',
  'style',
]);

const ALLOWED_CRITICAL_DIMENSIONS = new Set([
  'creative_direction',
  'deliverable',
  'direction_conflict',
  'literal_copy',
  'reference_priority',
  'subject',
  'usage',
]);

const CREATIVE_DELEGATION_PATTERN = /(你决定|自由发挥|按你的理解|交给你|你来定|自行决定|surprise me|use your judgment)/i;
const IMPROVEMENT_ONLY_PATTERN = /(提高|提升|改善|优化).{0,8}(质量|效果|表现)|更好的?效果|more detail|better quality|improve quality/i;
const DELIVERABLE_PATTERN = /(海报|包装|包装盒|插画|封面|效果图|产品图|广告图|主视觉|视觉稿|logo|标志|图标|banner|poster|packaging|illustration|cover|render|image)/i;
const DESIGN_EXECUTION_ACTION_PATTERN = /(做个|做一个|设计|制作|生成|出图|弄个|create|design|generate)/i;
const DESIGN_EXECUTION_CONTEXT_PATTERN = /(高级|视觉|创意|海报|包装|插画|封面|效果图|产品图|广告图|主视觉|logo|标志|图像|图片|东西|方案|visual|poster|packaging|illustration|image)/i;
const NON_EXECUTION_PATTERN = /(分析|解释|点评|总结|为什么|开发计划|实施计划|代码|文档|analysis|explain|review|code|plan)/i;
const DIRECTION_CONFLICT_PATTERN = /(也要|同时|既.+又|但.+(?:也|又)|一方面.+另一方面|同时包含|兼具.+(?:和|与))/i;
const LITERAL_COPY_REQUEST_PATTERN = /(文案|文字|写上|写着|标题|品牌名|产品名|slogan|标语|准确呈现|保持原样|literal copy|exact text)/i;

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeOption(value) {
  if (!value || typeof value !== 'object') return null;
  const id = normalizeString(value.id);
  const label = normalizeString(value.label);
  const answer = normalizeString(value.answer);
  const description = normalizeString(value.description);
  if (!id || !label || !answer) return null;
  return {
    id,
    label,
    answer,
    ...(description ? { description } : {}),
  };
}

export function isPotentialDesignExecutionRequest(value) {
  const message = normalizeString(value);
  if (!message || NON_EXECUTION_PATTERN.test(message)) return false;
  return DESIGN_EXECUTION_ACTION_PATTERN.test(message) && DESIGN_EXECUTION_CONTEXT_PATTERN.test(message);
}

function hasSpecificSubject(message) {
  if (isReferentialShorthand(message)) return false;
  const stripped = message
    .replace(DESIGN_EXECUTION_ACTION_PATTERN, ' ')
    .replace(DELIVERABLE_PATTERN, ' ')
    .replace(/(帮我|请|一张|一个|一幅|一套|的|更|比较|高级|好看|一点|东西|画面|产品|作品|方向|风格|现代|简约|竖版|横版|\d+\s*[:：比]\s*\d+)/gi, ' ')
    .replace(/[\s，,。.!！?？:：;；、-]+/g, '');
  return stripped.length > 0;
}

export function parseBriefClarifierResult(raw) {
  if (typeof raw !== 'string' || !raw.trim() || raw.includes('```')) return null;
  try {
    const value = JSON.parse(raw);
    const workingBrief = normalizeString(value?.workingBrief);
    if (!value || value.version !== 1 || !workingBrief || !['ready', 'ask'].includes(value.status)) return null;
    if (value.status === 'ready') {
      return { version: 1, status: 'ready', workingBrief };
    }

    const dimension = normalizeString(value.ambiguity?.dimension);
    const reason = normalizeString(value.ambiguity?.reason);
    const question = normalizeString(value.question);
    if (value.ambiguity?.critical !== true || !dimension || !reason || !question) return null;
    if (!Array.isArray(value.options) || value.options.length < MIN_OPTIONS || value.options.length > MAX_OPTIONS) return null;
    const options = value.options.map(normalizeOption);
    if (options.some((option) => !option)) return null;
    if (new Set(options.map((option) => option.id)).size !== options.length) return null;
    return {
      version: 1,
      status: 'ask',
      workingBrief,
      ambiguity: { dimension, critical: true, reason },
      question,
      options,
    };
  } catch {
    return null;
  }
}

/**
 * @param {{
 *   result?: any,
 *   userMessage?: string,
 *   askedDimensions?: string[],
 *   referenceImageCount?: number,
 *   requireCreativeDirectionConfirmation?: boolean,
 * }} input
 */
export function shouldAskClarification({
  result,
  userMessage,
  askedDimensions = [],
  referenceImageCount = 0,
  requireCreativeDirectionConfirmation = false,
} = {}) {
  if (!result || result.status !== 'ask' || result.ambiguity?.critical !== true) return false;
  const dimension = normalizeString(result.ambiguity.dimension);
  const reason = normalizeString(result.ambiguity.reason);
  const message = normalizeString(userMessage);
  if (!dimension || !reason || !ALLOWED_CRITICAL_DIMENSIONS.has(dimension)) return false;
  if ((Array.isArray(askedDimensions) ? askedDimensions : []).includes(dimension)) return false;
  if (dimension === 'creative_direction') return requireCreativeDirectionConfirmation === true;
  if (OPTIONAL_ART_DIMENSIONS.has(dimension) || IMPROVEMENT_ONLY_PATTERN.test(reason)) return false;
  if (CREATIVE_DELEGATION_PATTERN.test(message) && dimension === 'direction_conflict') return false;
  if (dimension === 'reference_priority' && Number(referenceImageCount) <= 1) return false;
  if (dimension === 'deliverable' && DELIVERABLE_PATTERN.test(message)) return false;
  if (dimension === 'subject' && hasSpecificSubject(message)) return false;
  if (dimension === 'direction_conflict' && !DIRECTION_CONFLICT_PATTERN.test(message)) return false;
  if (dimension === 'literal_copy' && !LITERAL_COPY_REQUEST_PATTERN.test(message)) return false;
  return true;
}

export function buildBriefClarifierMessages({
  userMessage,
  intent,
  skillContent,
  referenceImageCount = 0,
  state,
  requireCreativeDirectionConfirmation = false,
} = {}) {
  const system = [
    '你是 ZO Design 的 Brief Clarifier，负责在执行设计任务前判断需求是否存在真正阻碍执行的关键歧义。',
    '默认执行，澄清是例外。清晰需求默认直接执行，不得为了显得专业、完善提示词或增加互动而提问。',
    '不得为了补充颜色、材质、灯光、镜头、构图、装饰、供应商、模型、比例、尺寸、质量或数量而提问。',
    '用户说“你决定”“自由发挥”“按你的理解”等内容时，视为授权你补全创作细节。',
    '参考图片能够回答的信息不得再次询问，已经回答过的维度不得重复询问。',
    '只有缺少主体或交付物、核心方向互相冲突、必须准确呈现的文案不明确、多张参考图优先级不明、用途会根本改变版式，或 Skill 明确禁止继续时，才可以提问。',
    '当 requireCreativeDirectionConfirmation=true 时，必须先询问新资产方向，ambiguity.dimension 使用 creative_direction。',
    '每轮最多提出一个问题，并提供 2 到 4 个建议选项。不要生成“自定义”选项，客户端会固定添加。',
    '始终返回一个 JSON 对象，不要输出 Markdown、代码围栏或解释。',
    'Schema: {"version":1,"status":"ready|ask","workingBrief":"","ambiguity":{"dimension":"creative_direction|deliverable|subject|direction_conflict|literal_copy|reference_priority|usage","critical":true,"reason":""},"question":"","options":[{"id":"","label":"","answer":"","description":""}]}。',
    'status=ready 时只返回 version、status、workingBrief。status=ask 时其余字段全部必填。',
  ].join('\n');
  return [
    { role: 'system', content: system },
    {
      role: 'user',
      content: JSON.stringify({
        intent: normalizeString(intent) || 'image',
        currentUserMessage: normalizeString(userMessage),
        referenceImageCount: Math.max(0, Number(referenceImageCount) || 0),
        selectedSkillInstructions: normalizeString(skillContent) || undefined,
        clarificationState: state || undefined,
        requireCreativeDirectionConfirmation: requireCreativeDirectionConfirmation === true,
      }),
    },
  ];
}

/**
 * @param {{
 *   userMessage?: string,
 *   intent?: string,
 *   skillContent?: string,
 *   referenceImageCount?: number,
 *   state?: any,
 *   requireCreativeDirectionConfirmation?: boolean,
 *   providerId?: string,
 *   model?: string,
 *   signal?: AbortSignal,
 *   chatFn?: Function,
 * }} input
 */
export async function resolveBriefClarification({
  userMessage,
  intent,
  skillContent,
  referenceImageCount,
  state,
  requireCreativeDirectionConfirmation = false,
  providerId,
  model,
  signal,
  chatFn,
} = {}) {
  const fallbackBrief = normalizeString(state?.workingBrief) || normalizeString(state?.originalRequest) || normalizeString(userMessage);
  if (requireCreativeDirectionConfirmation) {
    return {
      result: {
        version: 1,
        status: 'ask',
        workingBrief: fallbackBrief,
        ambiguity: {
          dimension: 'creative_direction',
          critical: true,
          reason: '新封面的主体或场景尚未由用户确认。',
        },
        question: '这张新封面的主体或场景还没有确认，你希望怎么继续？',
        options: [
          {
            id: 'continue_series',
            label: '延续系列风格',
            answer: '延续上一张封面的视觉体系，由 Agent 补全一个协调但不重复的新主体与场景。',
            description: '保持系列一致性，由 Agent 完成具体创意。',
          },
          {
            id: 'new_direction',
            label: '创建不同方向',
            answer: '创建一个与上一张明显不同的新主体或场景，但保持整套封面的品牌与版式一致。',
            description: '产生更明显的内容变化，也可在下方补充具体要求。',
          },
        ],
      },
      failed: false,
      fallbackBrief,
    };
  }
  if (typeof chatFn !== 'function' || !normalizeString(model)) {
    return { result: null, failed: true, fallbackBrief, error: 'Brief Clarifier is unavailable' };
  }
  try {
    const response = await chatFn({
      providerId,
      model,
      messages: buildBriefClarifierMessages({
        userMessage,
        intent,
        skillContent,
        referenceImageCount,
        state,
        requireCreativeDirectionConfirmation,
      }),
      signal,
    });
    const result = parseBriefClarifierResult(response?.choices?.[0]?.message?.content || '');
    if (!result) {
      return { result: null, failed: true, fallbackBrief, error: 'Brief Clarifier returned invalid data' };
    }
    return { result, failed: false, fallbackBrief };
  } catch (error) {
    return {
      result: null,
      failed: true,
      fallbackBrief,
      error: error instanceof Error ? error.message : 'Brief Clarifier failed',
    };
  }
}

export function applyClarificationResponse({ state, request, response } = {}) {
  if (!state || !request || !response) return null;
  if (normalizeString(response.requestId) !== normalizeString(request.id)) return null;
  if (normalizeString(request.taskId) !== normalizeString(state.taskId)) return null;
  if (response.retry === true) {
    return { state: { ...state }, answer: '', proceedWithCurrent: false, retry: true };
  }
  if (response.proceedWithCurrent === true) {
    return { state: { ...state }, answer: '', proceedWithCurrent: true, retry: false };
  }

  const selectedOptionId = normalizeString(response.selectedOptionId);
  const customText = normalizeString(response.customText);
  const selectedOption = (Array.isArray(request.options) ? request.options : [])
    .find((option) => normalizeString(option?.id) === selectedOptionId);
  if (!selectedOption && !customText) return null;
  const answer = [normalizeString(selectedOption?.answer), customText].filter(Boolean).join('；');
  if (!answer) return null;
  const dimension = normalizeString(request.dimension);
  const askedDimensions = Array.from(new Set([
    ...(Array.isArray(state.askedDimensions) ? state.askedDimensions : []),
    dimension,
  ].filter(Boolean)));
  const answers = [
    ...(Array.isArray(state.answers) ? state.answers : []),
    { dimension, question: normalizeString(request.question), answer },
  ];
  const baseBrief = normalizeString(state.workingBrief) || normalizeString(state.originalRequest);
  return {
    answer,
    proceedWithCurrent: false,
    retry: false,
    state: {
      ...state,
      workingBrief: [baseBrief, `用户补充：${answer}`].filter(Boolean).join('\n'),
      askedDimensions,
      answers,
    },
  };
}
import { isReferentialShorthand } from './context-reference.mjs';
