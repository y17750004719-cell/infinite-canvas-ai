export interface CanvasInteractionPoint {
  x: number;
  y: number;
}

export interface CanvasInteractionViewport extends CanvasInteractionPoint {
  scale: number;
}

export interface CanvasMarqueeRect extends CanvasInteractionPoint {
  width: number;
  height: number;
}

export interface CanvasBounds {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export interface CanvasRectBounds {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface CanvasFixedOverlayAnchors {
  centerX: number;
  topToolbarY: number;
  bottomPanelY: number;
}

export type CanvasPointerGesture = 'marquee' | 'pan' | 'item' | 'none';
export type CanvasPointerGestureTarget = 'canvas' | 'item' | 'control';

export function getCanvasDragActivationDistance(pointerType: string): number;
export function resolveCanvasPointerGesture(options: {
  tool: string;
  button: number;
  ctrlKey?: boolean;
  isSpacePressed?: boolean;
  target?: CanvasPointerGestureTarget;
}): CanvasPointerGesture;
export function hasCanvasDragIntent(
  start: CanvasInteractionPoint,
  current: CanvasInteractionPoint,
  pointerType: string
): boolean;
export function projectCanvasPointToViewport(
  point: CanvasInteractionPoint,
  viewport: CanvasInteractionViewport
): CanvasInteractionPoint;
export function resolveCanvasFixedOverlayAnchors(options: {
  bounds: CanvasRectBounds;
  viewport: CanvasInteractionViewport;
  canvasOrigin: CanvasInteractionPoint;
  gap: number;
}): CanvasFixedOverlayAnchors;
export function normalizeCanvasMarqueeRect(
  start: CanvasInteractionPoint,
  current: CanvasInteractionPoint
): CanvasMarqueeRect;
export function projectScreenRectToCanvas(
  rect: CanvasMarqueeRect,
  viewport: CanvasInteractionViewport
): CanvasBounds;
export function isRectIntersecting(first: CanvasBounds, second: CanvasBounds): boolean;
export function getRotatedRectAabb(
  rect: CanvasRectBounds,
  rotationDegrees: number,
  origin?: CanvasInteractionPoint
): CanvasBounds;
export function areCanvasPointsFullyContained(
  rect: CanvasMarqueeRect,
  points: CanvasInteractionPoint[]
): boolean;
export function resolveCanvasMarqueeSelection(
  currentIds: string[],
  hitIds: string[],
  additive: boolean
): string[];
export function getCanvasDragDelta(
  start: CanvasInteractionPoint,
  current: CanvasInteractionPoint,
  scale: number
): CanvasInteractionPoint;
export function matchesCanvasItemDragTransaction(
  transaction: { token: number; sessionId: string | null } | null,
  token: number | null,
  sessionId: string | null
): boolean;
export function resolveCanvasItemDragReleasePositions(options: {
  itemIds: string[];
  startPositions: Record<string, CanvasInteractionPoint>;
  delta: CanvasInteractionPoint;
}): Map<string, CanvasInteractionPoint>;
export function ownsCanvasItemVisualHandoff(options: {
  token: number;
  itemIds: string[];
  visualTokens: ReadonlyMap<string, number>;
}): boolean;
export function shouldCancelCanvasPointerSessionOnLostCapture(options: {
  eventPointerId: number;
  sessionPointerId: number;
  releasePending: boolean;
}): boolean;
export function applyCanvasItemDragPositions<T extends { id: string; x: number; y: number }>(options: {
  items: T[];
  itemIds: string[];
  positions: ReadonlyMap<string, CanvasInteractionPoint>;
}): { items: T[]; orderBefore: string[]; orderAfter: string[] };
