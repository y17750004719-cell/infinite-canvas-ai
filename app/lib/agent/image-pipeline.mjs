import { buildPromptOptimizerMessages, parseOptimizedImagePrompt } from './prompt-optimizer.mjs';

const FALLBACK_SUMMARY = '已保留你的原始设计要求';

export async function optimizeImagePrompt({
  userPrompt,
  skillLabel,
  providerId,
  optimizerModel,
  signal,
  chatFn,
}) {
  const originalPrompt = typeof userPrompt === 'string' ? userPrompt.trim() : '';
  if (!originalPrompt || typeof chatFn !== 'function' || !optimizerModel) {
    return { prompt: originalPrompt, optimized: false, summary: FALLBACK_SUMMARY };
  }
  try {
    const response = await chatFn({
      providerId,
      model: optimizerModel,
      messages: buildPromptOptimizerMessages(originalPrompt, skillLabel),
      signal,
    });
    const parsed = parseOptimizedImagePrompt(response?.choices?.[0]?.message?.content || '');
    if (!parsed) {
      return { prompt: originalPrompt, optimized: false, summary: FALLBACK_SUMMARY };
    }
    const summaryParts = [parsed.style[0], parsed.composition, parsed.lighting].filter(Boolean);
    return {
      prompt: parsed.finalPrompt,
      optimized: true,
      summary: summaryParts.slice(0, 3).join(' · ') || '已完成视觉提示词优化',
      structured: parsed,
    };
  } catch {
    return { prompt: originalPrompt, optimized: false, summary: FALLBACK_SUMMARY };
  }
}
