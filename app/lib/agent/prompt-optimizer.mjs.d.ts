export interface OptimizedImagePrompt {
  version: 1;
  intent: 'image_generation';
  subject: string;
  style: string[];
  composition: string;
  lighting: string;
  materials: string[];
  colorPalette: string[];
  constraints: string[];
  finalPrompt: string;
  items?: Array<{ index: number; label: string; subject: string; prompt: string }>;
}
export function parseOptimizedImagePrompt(raw: string, options?: { outputCount?: number; batchMode?: 'series' | 'variants' }): OptimizedImagePrompt | null;
export function buildPromptOptimizerMessages(userPrompt: string, skillLabel?: string, options?: { outputCount?: number; batchMode?: 'series' | 'variants'; repair?: boolean }): Array<{ role: 'system' | 'user'; content: string }>;
export function resolveImageBatchMode(text: string, outputCount?: number): 'series' | 'variants';
export function resolveAgentIntent(text: string, hasReferenceImages?: boolean): 'chat' | 'image' | 'skill_action';
export function resolveAgentConversationIntent(
  messages: Array<{ role: 'user' | 'assistant'; content: string }>,
  hasReferenceImages?: boolean,
): {
  intent: 'chat' | 'image' | 'skill_action';
  brief: string;
  inherited: boolean;
  needsDirectionConfirmation: boolean;
};
