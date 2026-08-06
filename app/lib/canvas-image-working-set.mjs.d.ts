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

export function getCanvasImageDisplayResource(options?: {
  width?: number;
  scale?: number;
}): {
  displayWidth: number;
  resourceWidth: number;
};

export const CANVAS_IMAGE_RESOURCE_WIDTHS: readonly number[];

export function getCanvasImageLodRelativePath(src: string, resourceWidth: number): string | null;
export function getCanvasImageLodUrl(src: string, resourceWidth: number): string;
export function parseCanvasImageLodRelativePath(relativePath: string): {
  originalRelativePath: string;
  resourceWidth: number;
} | null;
