import type { OptimizedImagePrompt } from './prompt-optimizer.mjs';
export function optimizeImagePrompt(input: {
  userPrompt: string;
  skillLabel?: string;
  providerId?: string;
  optimizerModel?: string;
  signal?: AbortSignal;
  chatFn: (request: Record<string, unknown>) => Promise<unknown>;
}): Promise<{
  prompt: string;
  optimized: boolean;
  summary: string;
  structured?: OptimizedImagePrompt;
}>;
