import { buildPromptOptimizerMessages, parseOptimizedImagePrompt } from './prompt-optimizer.mjs';

const FALLBACK_SUMMARY = '已保留你的原始设计要求';

export async function optimizeImagePrompt({
  userPrompt,
  skillLabel,
  providerId,
  optimizerModel,
  signal,
  chatFn,
  outputCount = 1,
  batchMode = 'variants',
}) {
  const originalPrompt = typeof userPrompt === 'string' ? userPrompt.trim() : '';
  if (!originalPrompt || typeof chatFn !== 'function' || !optimizerModel) {
    return { prompt: originalPrompt, optimized: false, summary: FALLBACK_SUMMARY };
  }
  const attempts = batchMode === 'series' && outputCount > 1 ? 2 : 1;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await chatFn({
        providerId,
        model: optimizerModel,
        messages: buildPromptOptimizerMessages(originalPrompt, skillLabel, {
          outputCount,
          batchMode,
          repair: attempt > 0,
        }),
        signal,
      });
      const parsed = parseOptimizedImagePrompt(response?.choices?.[0]?.message?.content || '', {
        outputCount,
        batchMode,
      });
      if (!parsed) continue;
      const summaryParts = [parsed.style[0], parsed.composition, parsed.lighting].filter(Boolean);
      return {
        prompt: parsed.finalPrompt,
        optimized: true,
        summary: summaryParts.slice(0, 3).join(' · ') || '已完成视觉提示词优化',
        structured: parsed,
        ...(parsed.items ? { items: parsed.items } : {}),
      };
    } catch {
      // Retry series planning once; ordinary prompt optimization keeps its existing fallback.
    }
  }
  if (batchMode === 'series' && outputCount > 1) {
    throw new Error(`未能形成完整的 ${outputCount} 期系列生成计划，请重试。`);
  }
  return { prompt: originalPrompt, optimized: false, summary: FALLBACK_SUMMARY };
}
