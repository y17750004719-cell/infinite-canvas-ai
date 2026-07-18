export interface CanvasPoint {
  x: number;
  y: number;
  pressure?: number;
}

export type CanvasItemType = 'image' | 'frame' | 'shape' | 'text' | 'stroke';

export interface CanvasItem {
  id: string;
  type: CanvasItemType;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  src?: string;
  naturalWidth?: number;
  naturalHeight?: number;
  imageVariant?: 'card';
  imageOutputs?: Array<{ src: string; naturalWidth: number; naturalHeight: number }>;
  activeImageOutputIndex?: number;
  fill?: string;
  text?: string;
  textVariant?: 'legacy' | 'card' | 'annotation';
  textMode?: 'ai' | 'manual';
  textColor?: string;
  fontSize?: number;
  points?: CanvasPoint[];
  strokeColor?: string;
  strokeWidth?: number;
  lastGenerationDurationMs?: number;
  lastGenerationCompletedAt?: number;
  visible: boolean;
  locked: boolean;
}

export const isCanvasAnnotationItem = (item: CanvasItem | null | undefined): boolean =>
  item?.type === 'stroke' || (item?.type === 'text' && item.textVariant === 'annotation');

export const isCanvasAnnotationTextItem = (item: CanvasItem | null | undefined): boolean =>
  item?.type === 'text' && item.textVariant === 'annotation';
