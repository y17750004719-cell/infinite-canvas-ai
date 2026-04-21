export interface ImageSizeOption {
  id: string;
  label: string;
  imageSize: string;
}

export interface ImageModelCapability {
  supportsAspectRatio: boolean;
  supportedSizes: string[];
  requestModelBySize?: Record<string, string>;
  sizeOptions?: ImageSizeOption[];
}

export const IMAGE_SIZE_OPTIONS: ImageSizeOption[];
export const IMAGE_MODEL_CAPABILITIES: Record<string, ImageModelCapability>;

export function getImageModelCapability(modelId?: string): ImageModelCapability;
export function getSupportedImageSizeOptions(modelId?: string): ImageSizeOption[];
export function resolveSupportedImageSize(modelId?: string, requestedSize?: string, fallbackSize?: string): string;
export function supportsImageModelRequestedSize(modelId?: string, requestedSize?: string): boolean;
export function supportsImageModelImageSizeConfig(modelId?: string): boolean;
export function resolveImageRequestModel(modelId?: string, requestedSize?: string): string;
export function getImageSizeLabel(modelId?: string, sizeId?: string): string;
export function getGeminiImageSizeEnum(sizeId?: string): '1K' | '2K' | '4K';
