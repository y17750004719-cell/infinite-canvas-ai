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
