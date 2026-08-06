export function generateCanvasImageLods(options: {
  sourcePath: string;
  relativeAssetPath: string;
  runtimeDir?: string;
  widths?: readonly number[];
}): Promise<string[]>;

export function writeImageFileWithCanvasLods(options: {
  filePath: string;
  relativeAssetPath: string;
  buffer: Buffer | Uint8Array;
  runtimeDir?: string;
}): Promise<void>;

export function ensureCanvasImageLodFile(options: {
  relativeLodPath: string;
  runtimeDir?: string;
}): Promise<{
  filePath: string;
  fallbackFilePath: string | null;
} | null>;
