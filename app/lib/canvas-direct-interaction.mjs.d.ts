export interface DirectPoint { x: number; y: number }
export interface DirectViewport extends DirectPoint { scale: number }
export interface DirectBounds { left: number; right: number; top: number; bottom: number }

export function applyDirectPan(
  startViewport: DirectViewport,
  startPointer: DirectPoint,
  currentPointer: DirectPoint
): DirectViewport;

export function applyDirectZoom(
  viewport: DirectViewport,
  deltaY: number,
  anchor: DirectPoint,
  options?: { minScale?: number; maxScale?: number; zoomInFactor?: number; zoomOutFactor?: number }
): DirectViewport;

export function applyDirectItemDrag<T extends { id: string; x: number; y: number }>(options: {
  items: T[];
  itemIds: string[];
  startPositions: Record<string, DirectPoint>;
  delta: DirectPoint;
}): T[];

export function applyDirectItemResize(options: {
  item?: unknown;
  startWidth: number;
  startHeight: number;
  deltaX: number;
  deltaY: number;
  minWidth?: number;
  minHeight?: number;
  preserveAspectRatio?: boolean;
}): { width: number; height: number };

export function resolveDirectMarqueeSelection(options: {
  rect: DirectBounds;
  boundsById: Map<string, DirectBounds>;
  baseIds?: string[];
  additive?: boolean;
}): string[];
