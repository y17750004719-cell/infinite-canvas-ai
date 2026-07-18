import {
  allowsRepeatedSeriesSubjects,
  buildPromptOptimizerMessages,
  parseOptimizedImagePrompt,
} from './prompt-optimizer.mjs';

const FALLBACK_SUMMARY = '已保留你的原始设计要求';

export async function optimizeImagePrompt({
  userPrompt,
  skillLabel,
  skillContent,
  promptStyle = 'text',
  providerId,
  optimizerModel,
  signal,
  chatFn,
  outputCount = 1,
  batchMode = 'variants',
  plannerItems = [],
  imageTask = null,
  visualContext = null,
}) {
  const originalPrompt = typeof userPrompt === 'string' ? userPrompt.trim() : '';
  if (!originalPrompt || typeof chatFn !== 'function' || !optimizerModel) {
    return { prompt: originalPrompt, optimized: false, summary: FALLBACK_SUMMARY };
  }
  const attempts = (batchMode === 'series' && outputCount > 1) || promptStyle === 'json-text' ? 2 : 1;
  const hasPlannerItems = Array.isArray(plannerItems) && plannerItems.length === outputCount && outputCount > 1;
  const allowRepeatedSubjects = hasPlannerItems || allowsRepeatedSeriesSubjects(originalPrompt);
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await chatFn({
        providerId,
        model: optimizerModel,
        messages: buildPromptOptimizerMessages(originalPrompt, skillLabel, {
          outputCount,
          batchMode,
          skillContent,
          promptStyle,
          plannerItems: hasPlannerItems ? plannerItems : [],
          imageTask,
          visualContext,
          repair: attempt > 0,
        }),
        signal,
      });
      const parsed = parseOptimizedImagePrompt(response?.choices?.[0]?.message?.content || '', {
        outputCount,
        batchMode,
        allowRepeatedSubjects,
        promptStyle,
        userPrompt: originalPrompt,
      });
      if (!parsed) continue;
      const summaryParts = [parsed.style[0], parsed.composition, parsed.lighting].filter(Boolean);
      const items = parsed.items && hasPlannerItems
        ? parsed.items.map((item, index) => ({
            ...item,
            label: plannerItems[index].label,
            subject: plannerItems[index].subject,
            prompt: promptStyle === 'json-text'
              ? item.prompt
              : `${item.prompt}\n\nAuthoritative Planner item: ${plannerItems[index].subject}; variation: ${plannerItems[index].variation}`,
          }))
        : parsed.items;
      return {
        prompt: parsed.finalPrompt,
        optimized: true,
        summary: summaryParts.slice(0, 3).join(' · ') || '已完成视觉提示词优化',
        structured: parsed,
        ...(items ? { items } : {}),
      };
    } catch {
      // Retry series planning once; ordinary prompt optimization keeps its existing fallback.
    }
  }
  if (batchMode === 'series' && outputCount > 1) {
    throw new Error(`未能形成完整的 ${outputCount} 期系列生成计划，请重试。`);
  }
  if (promptStyle === 'json-text') {
    throw new Error('未能形成有效的 JSON 生图提示词，请重试。');
  }
  return { prompt: originalPrompt, optimized: false, summary: FALLBACK_SUMMARY };
}
