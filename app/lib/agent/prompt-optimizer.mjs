const REQUIRED_STRING_FIELDS = ['subject', 'composition', 'lighting', 'finalPrompt'];
const REQUIRED_ARRAY_FIELDS = ['style', 'materials', 'colorPalette', 'constraints'];

export function parseOptimizedImagePrompt(raw) {
  if (typeof raw !== 'string' || !raw.trim() || raw.includes('```')) return null;
  try {
    const value = JSON.parse(raw);
    if (!value || value.version !== 1 || value.intent !== 'image_generation') return null;
    if (!REQUIRED_STRING_FIELDS.every((key) => typeof value[key] === 'string' && value[key].trim())) return null;
    if (!REQUIRED_ARRAY_FIELDS.every((key) => Array.isArray(value[key]) && value[key].every((item) => typeof item === 'string'))) return null;
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
      finalPrompt: value.finalPrompt.trim(),
    };
  } catch {
    return null;
  }
}

export function buildPromptOptimizerMessages(userPrompt, skillLabel) {
  const system = [
    'You are a visual prompt optimizer for professional image-generation models.',
    'Return exactly one JSON object. Do not use Markdown, code fences, commentary, or extra keys.',
    'Schema: {"version":1,"intent":"image_generation","subject":"","style":[],"composition":"","lighting":"","materials":[],"colorPalette":[],"constraints":[],"finalPrompt":""}.',
    'Write finalPrompt in precise English, but preserve brand names, literal copy, product names, and explicit user constraints verbatim.',
    'Improve composition, materials, lighting, and art direction without changing model, size, aspect ratio, quality, or image count.',
  ].join('\n');
  const skillContext = skillLabel ? `Active design skill: ${skillLabel}\n` : '';
  return [
    { role: 'system', content: system },
    { role: 'user', content: `${skillContext}User request:\n${String(userPrompt || '').trim()}` },
  ];
}

const IMAGE_HINTS = ['生成', '生图', '画一个', '设计一个', '海报', '包装', 'logo', '插画', '封面', '渲染', '视觉稿', '图片'];
const ANALYSIS_HINTS = ['分析', '解释', '点评', '总结', '看看', '识别', '构图怎么样', '风格是什么'];
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
  if (analysisHit && !imageHit) return 'chat';
  if (imageHit) return 'image';
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
