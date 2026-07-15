export interface GeneratedAssetInput {
  src: string;
  naturalWidth?: number;
  naturalHeight?: number;
  model?: string;
}

export interface PreloadedGeneratedAsset {
  asset: GeneratedAssetInput;
  naturalWidth: number;
  naturalHeight: number;
}

export interface GeneratedAssetPreloadOptions {
  timeoutMs?: number;
  loadImage?: (src: string) => Promise<{ naturalWidth?: number; naturalHeight?: number }>;
}

export function preloadGeneratedAsset(
  asset: GeneratedAssetInput,
  options?: GeneratedAssetPreloadOptions,
): Promise<PreloadedGeneratedAsset>;

export function preloadGeneratedAssets(
  assets: GeneratedAssetInput[],
  options?: GeneratedAssetPreloadOptions,
): Promise<{
  fulfilled: PreloadedGeneratedAsset[];
  failed: Array<{ asset: GeneratedAssetInput; error: unknown }>;
}>;
