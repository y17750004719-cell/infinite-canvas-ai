import { normalizeImageModelCapabilityId } from './image-model-capabilities.mjs';
import { resolveImageCardModel } from './workspace-session-view.mjs';

const DEFAULT_IMAGE_MODEL = 'gemini-2.5-flash-image';
const ALLOWED_ASPECT_RATIOS = new Set([
  '1:1',
  '1:4',
  '1:8',
  '2:3',
  '3:2',
  '3:4',
  '4:1',
  '4:3',
  '4:5',
  '5:4',
  '8:1',
  '9:16',
  '16:9',
  '21:9',
]);

const IMAGE_HINTS = ['画', '生图', '生成图片', '海报', 'logo', '封面', '插画', '渲染', '视觉稿'];
const CHAT_HINTS = ['解释', '分析', '总结', '翻译', '改写', '代码', '报错', '优化'];

function gcd(a, b) {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y !== 0) {
    const t = y;
    y = x % y;
    x = t;
  }
  return x || 1;
}

export function normalizeAspectRatio(input) {
  const raw = typeof input === 'string' ? input.trim() : '';
  if (!raw) return '';
  return ALLOWED_ASPECT_RATIOS.has(raw) ? raw : '';
}

export function aspectRatioFromSize(size) {
  const raw = typeof size === 'string' ? size.trim() : '';
  if (!raw) return '1:1';
  const match = raw.match(/^(\d+)x(\d+)$/i);
  if (!match) return '1:1';
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return '1:1';
  }
  const divisor = gcd(width, height);
  const ratio = `${width / divisor}:${height / divisor}`;
  return ALLOWED_ASPECT_RATIOS.has(ratio) ? ratio : '1:1';
}

export function resolveGenerateImageModel(requestedModel, fallbackModel = DEFAULT_IMAGE_MODEL) {
  const normalizedModel = typeof requestedModel === 'string' ? requestedModel.trim() : '';
  if (normalizeImageModelCapabilityId(normalizedModel) === 'gpt-image-2') {
    return normalizedModel;
  }
  return resolveImageCardModel(requestedModel, fallbackModel);
}

export function resolveGenerateImageModelFromAllowedModels(
  requestedModel,
  allowedProviderModelIds,
  fallbackModel = DEFAULT_IMAGE_MODEL
) {
  const normalizedModel = typeof requestedModel === 'string' ? requestedModel.trim() : '';
  if (normalizedModel && allowedProviderModelIds instanceof Set && allowedProviderModelIds.has(normalizedModel)) {
    return normalizedModel;
  }
  return resolveGenerateImageModel(requestedModel, fallbackModel);
}

export function resolveIntent(intent, text, hasReferenceImages) {
  const raw = typeof text === 'string' ? text.trim() : '';
  const mode = intent === 'image' || intent === 'chat' || intent === 'auto' ? intent : 'auto';

  if (raw.startsWith('/img')) {
    return { intent: 'image', ambiguous: false, prompt: raw.replace(/^\/img\s*/i, '').trim() || raw };
  }
  if (raw.startsWith('/chat')) {
    return { intent: 'chat', ambiguous: false, prompt: raw.replace(/^\/chat\s*/i, '').trim() || raw };
  }

  if (mode === 'image') {
    return { intent: 'image', ambiguous: false, prompt: raw };
  }

  if (mode === 'chat') {
    return { intent: 'chat', ambiguous: false, prompt: raw };
  }

  if (hasReferenceImages) {
    return { intent: 'image', ambiguous: false, prompt: raw };
  }

  const normalized = raw.toLowerCase();
  const imageHit = IMAGE_HINTS.some((keyword) => normalized.includes(keyword.toLowerCase()));
  const chatHit = CHAT_HINTS.some((keyword) => normalized.includes(keyword.toLowerCase()));

  if (imageHit && !chatHit) {
    return { intent: 'image', ambiguous: false, prompt: raw };
  }

  if (chatHit && !imageHit) {
    return { intent: 'chat', ambiguous: false, prompt: raw };
  }

  return { intent: 'chat', ambiguous: true, prompt: raw };
}

export function buildGenerateRouteErrorMeta(error, ImageGenerationErrorClass) {
  const isImageGenerationError =
    typeof ImageGenerationErrorClass === 'function' && error instanceof ImageGenerationErrorClass;

  return {
    isImageGenerationError,
    statusCode: isImageGenerationError && error.statusCode ? error.statusCode : 500,
    failureClass: isImageGenerationError && error.failureClass ? error.failureClass : 'unknown',
    isRetryable: isImageGenerationError ? Boolean(error.isRetryable) : false,
    retryAttempt: isImageGenerationError && typeof error.retryAttempt === 'number' ? error.retryAttempt : null,
  };
}
