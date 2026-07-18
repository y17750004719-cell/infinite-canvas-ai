import type { OptimizedImagePrompt } from './prompt-optimizer.mjs';
export function optimizeImagePrompt(input: {
  userPrompt: string;
  skillLabel?: string;
  skillContent?: string;
  promptStyle?: 'text' | 'json-text';
  providerId?: string;
  optimizerModel?: string;
  signal?: AbortSignal;
  chatFn: (request: Record<string, unknown>) => Promise<unknown>;
  outputCount?: number;
  batchMode?: 'series' | 'variants' | 'composite';
  plannerItems?: Array<{ index: number; label: string; subject: string; variation: string }>;
}): Promise<{
  prompt: string;
  optimized: boolean;
  summary: string;
  structured?: OptimizedImagePrompt;
  items?: OptimizedImagePrompt['items'];
}>;
