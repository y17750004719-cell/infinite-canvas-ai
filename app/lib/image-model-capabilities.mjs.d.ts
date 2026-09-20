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
export function resolveImageRequestModel(modelId?: string, requestedSize?: string): string;
export function getGeminiImageSizeEnum(sizeId?: string): '1K' | '2K' | '4K';
export function resolveOpenAiImageSizeForAspectRatio(requestedSize?: string, aspectRatio?: string): string;
export function resolveImageSizeForAspectRatio(modelId?: string, requestedSize?: string, aspectRatio?: string): string;
