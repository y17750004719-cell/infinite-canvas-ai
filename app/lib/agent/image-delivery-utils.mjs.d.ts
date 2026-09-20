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
