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
  items?: Array<{ index: number; label: string; subjectKey: string; subject: string; prompt: string }>;
}
export type ImageDeliveryMode = 'variants' | 'series' | 'composite';
export interface ImageDeliveryPlan {
  mode: ImageDeliveryMode;
  outputCount: number;
  promptCount: number;
  panelCount?: number;
  variationAxes: string[];
  evidence: string[];
  confidence: 'high' | 'medium' | 'low';
  requiresClarification: boolean;
}
export function parseOptimizedImagePrompt(raw: string, options?: { outputCount?: number; batchMode?: ImageDeliveryMode; allowRepeatedSubjects?: boolean; promptStyle?: 'text' | 'json-text'; userPrompt?: string }): OptimizedImagePrompt | null;
export function buildPromptOptimizerMessages(userPrompt: string, skillLabel?: string, options?: { outputCount?: number; batchMode?: ImageDeliveryMode; repair?: boolean; skillContent?: string; promptStyle?: 'text' | 'json-text'; plannerItems?: Array<{ index: number; label: string; subject: string; variation: string }>; imageTask?: { operation: 'generate' | 'edit'; targetReferenceId?: string | null; supportingReferenceIds?: string[]; instruction: string; mustChange: string[]; mustPreserve: string[] } | null; visualContext?: import('./execution-planner.types').AgentVisualContext | null }): Array<{ role: 'system' | 'user'; content: string }>;
export function allowsRepeatedSeriesSubjects(text: string): boolean;
export function resolveImageDeliveryPlan(text: string, fallbackOutputCount?: number): ImageDeliveryPlan;
export function resolveImageBatchMode(text: string, outputCount?: number): ImageDeliveryMode;
export function applyImagePromptDeliveryContract(prompt: string, deliveryPlan?: Partial<ImageDeliveryPlan>): string;
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
