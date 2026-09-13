const WORKFLOW_BY_SKILL = Object.freeze({
  'analyze-omx': 'analyze',
  'deep-interview-omx': 'deep_interview',
  'plan-omx': 'plan',
  'code-review-omx': 'code_review',
  'verify-omx': 'verify',
});

const explicitPatterns = [
  ['analyze', /\$(?:analyze-omx)\b|(?:使用|按).{0,12}OMX.{0,8}(?:分析|调查|根因)/i],
  ['deep_interview', /\$(?:deep-interview-omx)\b|(?:使用|按).{0,12}OMX.{0,8}(?:需求访谈|澄清需求)/i],
  ['plan', /\$(?:plan-omx)\b|(?:使用|按).{0,12}OMX.{0,8}(?:计划|规划)/i],
  ['code_review', /\$(?:code-review-omx)\b|(?:使用|按).{0,12}OMX.{0,12}(?:代码审查|审查|review)/i],
  ['verify', /\$(?:verify-omx)\b|(?:使用|按).{0,12}OMX.{0,8}(?:验证|测试)/i],
];

const disablePattern = /(?:不要|不使用|关闭|退出|取消|普通模式).{0,12}(?:OMX|workflow|工作流)/i;
const multiStagePattern = /(?:分析|调查|梳理|规划|计划|实现|修改|重构|迁移|审查|测试|验证|implement|refactor|migrate|review|test|verify)/gi;
const complexityPattern = /(?:多个文件|架构|兼容|回归|验收|完整功能|全链路|调用链|runtime|api|接口|重构|迁移|安全性|性能|测试覆盖|multiple files|architecture|backward compatible|regression)/i;

function workflowFromPrompt(prompt) {
  for (const [workflowId, pattern] of explicitPatterns) if (pattern.test(prompt)) return workflowId;
  return null;
}

export function resolveOmxIntent({ prompt = '', activeWorkflow = null, automaticEnabled = true } = {}) {
  const source = typeof prompt === 'string' ? prompt.trim() : '';
  if (!source) return { mode: 'ordinary', reason: 'empty_prompt' };
  if (disablePattern.test(source)) return { mode: 'ordinary', reason: 'user_disabled_omx' };
  const explicit = workflowFromPrompt(source);
  if (explicit) return { mode: 'explicit', workflowId: explicit, confidence: 'high', reason: 'explicit_omx_directive' };
  if (activeWorkflow && ['running', 'awaiting_input', 'awaiting_subagents', 'verifying'].includes(activeWorkflow.status)) {
    return { mode: 'automatic', workflowId: activeWorkflow.workflowId, confidence: 'high', reason: 'active_workflow_continuation' };
  }
  const stages = [...source.matchAll(multiStagePattern)].map((match) => match[0].toLowerCase());
  const uniqueStages = new Set(stages);
  const complex = complexityPattern.test(source);
  if (automaticEnabled && uniqueStages.size >= 3 && complex) {
    const workflowId = uniqueStages.has('审查') || uniqueStages.has('review') ? 'code_review'
      : uniqueStages.has('验证') || uniqueStages.has('verify') || uniqueStages.has('测试') || uniqueStages.has('test') ? 'verify'
        : uniqueStages.has('分析') || uniqueStages.has('调查') ? 'analyze' : 'plan';
    return { mode: 'automatic', workflowId, confidence: 'high', reason: 'multi_stage_complex_request' };
  }
  if (uniqueStages.size >= 2) {
    const workflowId = uniqueStages.has('审查') || uniqueStages.has('review') ? 'code_review' : 'plan';
    return { mode: 'suggest', workflowId, confidence: 'medium', reason: 'multi_stage_request_needs_confirmation' };
  }
  return { mode: 'ordinary', reason: 'ordinary_request' };
}

export { WORKFLOW_BY_SKILL };
