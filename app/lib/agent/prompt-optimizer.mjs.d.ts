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
export function resolveImageDeliveryPlan(text: string, fallbackOutputCount?: number): ImageDeliveryPlan;
export function resolveImageBatchMode(text: string, outputCount?: number): ImageDeliveryMode;
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
