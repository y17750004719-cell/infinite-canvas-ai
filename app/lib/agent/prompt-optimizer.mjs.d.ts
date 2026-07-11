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
}
export function parseOptimizedImagePrompt(raw: string): OptimizedImagePrompt | null;
export function buildPromptOptimizerMessages(userPrompt: string, skillLabel?: string): Array<{ role: 'system' | 'user'; content: string }>;
export function resolveAgentIntent(text: string, hasReferenceImages?: boolean): 'chat' | 'image' | 'skill_action';
