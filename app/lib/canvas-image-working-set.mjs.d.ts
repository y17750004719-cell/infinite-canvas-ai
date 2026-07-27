export interface CanvasImageWorkingSetItem {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CanvasImageWorkingSetOptions {
  items?: CanvasImageWorkingSetItem[];
  viewport?: { x?: number; y?: number; scale?: number };
  canvasSize?: { width?: number; height?: number };
  overscanScreens?: number;
}

export function getCanvasImageWorkingSetIds(options?: CanvasImageWorkingSetOptions): string[];
