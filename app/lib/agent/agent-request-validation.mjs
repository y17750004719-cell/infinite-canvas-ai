import { normalizeAgentConversationMemory } from '../chat-message-persistence.mjs';
import { extractAgentImageCount, parseAgentImageCountNumber } from './image-options.mjs';
import { createHash } from 'node:crypto';

const INTERNAL_IMAGE_PLACEHOLDER_PATTERN = /\[(?:Generated image[^\]]*omitted from chat history|聊天记录中省略了代理生成的图像)\]/gi;
const UNBACKED_EXECUTION_CLAIM_PATTERN = /(?:(?:图片|图像|封面|海报|视觉稿|任务|素材)[^。！!\n]{0,18}(?:已(?:经)?|正在)[^。！!\n]{0,12}(?:启动|开始|提交|生成|制作|出图)|(?:已(?:经)?|现已|正在)[^。！!\n]{0,8}为(?:您|你)[^。！!\n]{0,12}(?:启动|开始|提交|生成|制作|出图)|已(?:经)?(?:启动|开始|提交)(?:生成|制作|出图))/i;

export function summarizePromptQuality(prompt) {
  const value = typeof prompt === 'string' ? prompt : '';
  const lines = value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const normalizedLines = lines.map((line) => line.toLowerCase().replace(/\s+/g, ' '));
  return {
    characterCount: value.length,
    paragraphCount: value.split(/\n\s*\n/).filter((paragraph) => paragraph.trim()).length,
    duplicateLineCount: normalizedLines.length - new Set(normalizedLines).size,
  };
}

export function hashPrompt(value) {
  return createHash('sha256').update(String(value || ''), 'utf8').digest('hex');
}

export function hasOnlyImageOperationAmbiguity(validationErrors) {
  const entries = Array.isArray(validationErrors) ? validationErrors : [];
  return entries.length > 0 && entries.every((entry) => {
    if (!entry || typeof entry !== 'object') return false;
    return entry.code === 'operation_mismatch'
      && ['imageTask.targetReferenceId', 'imageTask.sourceReferenceId'].includes(String(entry.path || ''));
  });
}

export function getLatestUserMessage(messages) {
  return [...(messages || [])].reverse().find((message) => message.role === 'user')?.content?.trim() || '';
}

export function sanitizeAgentResponseContent(content, hasMutationEvidence) {
  const cleaned = String(content || '')
    .replace(INTERNAL_IMAGE_PLACEHOLDER_PATTERN, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (hasMutationEvidence
    || !UNBACKED_EXECUTION_CLAIM_PATTERN.test(cleaned)
    || /(?:尚未|还未|没有|并未|未实际)(?:[^。！!\n]{0,8})(?:启动|开始|生成)/i.test(cleaned)) return cleaned;
  const proposal = cleaned.replace(UNBACKED_EXECUTION_CLAIM_PATTERN, '建议按以下方向生成');
  return `生成尚未实际启动。${proposal ? `\n\n${proposal}` : ''}\n\n请确认是否按当前方向开始生成，或补充你希望调整的主体与场景。`;
}

export function mergeTopicMemory(previous, patch, messages) {
  const current = normalizeAgentConversationMemory(previous) || {
    version: 1,
    recentRawConversation: [],
    rollingSummary: '',
    facts: [],
    preferences: [],
    activeTask: null,
    recentReferencedAssetIds: [],
    updatedAt: Date.now(),
  };
  const candidate = patch && typeof patch === 'object' ? patch : {};
  const newestUnique = (currentValues, nextValues, limit) => Array.from(new Set([
    ...currentValues,
    ...nextValues.filter((value) => typeof value === 'string').map((value) => value.trim()).filter(Boolean),
  ])).slice(-limit);
  const merged = {
    ...current,
    ...(typeof candidate.rollingSummary === 'string' ? { rollingSummary: candidate.rollingSummary } : {}),
    ...(Array.isArray(candidate.facts) ? { facts: newestUnique(current.facts, candidate.facts, 24) } : {}),
    ...(Array.isArray(candidate.preferences) ? { preferences: newestUnique(current.preferences, candidate.preferences, 16) } : {}),
    ...(Object.hasOwn(candidate, 'activeTask') ? { activeTask: candidate.activeTask } : {}),
    ...(Array.isArray(candidate.recentReferencedAssetIds)
      ? { recentReferencedAssetIds: newestUnique(current.recentReferencedAssetIds, candidate.recentReferencedAssetIds, 20) } : {}),
    recentRawConversation: (Array.isArray(messages) ? messages : []).slice(-20),
    updatedAt: Date.now(),
  };
  return normalizeAgentConversationMemory(merged) || current;
}

export function generatedAssetsFromResult(payload) {
  const result = payload?.result || {};
  if (Array.isArray(result.outputs) && result.outputs.length > 0) {
    return result.outputs.filter((item) => typeof item?.localUrl === 'string' || typeof item?.url === 'string').map((item) => ({
      src: item.localUrl || item.url,
      ...(typeof item.assetId === 'string' ? { assetId: item.assetId } : {}),
      ...(typeof item.previewSrc === 'string' ? { previewSrc: item.previewSrc } : {}),
      naturalWidth: item.naturalWidth,
      naturalHeight: item.naturalHeight,
    }));
  }
  const src = result.localUrl || result.data?.[0]?.url;
  return typeof src === 'string' ? [{ src, ...(typeof result.outputs?.[0]?.assetId === 'string' ? { assetId: result.outputs[0].assetId } : {}) }] : [];
}

export function positiveInteger(value) {
  const count = Number(value);
  return Number.isFinite(count) && count > 0 ? Math.floor(count) : null;
}

export function enrichGeneratedAssetEvents(events, payload) {
  const outputs = Array.isArray(payload?.result?.outputs) ? payload.result.outputs : [];
  return events.map((event) => {
    if (event?.type !== 'client_action' || event.action?.type !== 'add_generated_assets') return event;
    return {
      ...event,
      action: {
        ...event.action,
        ...(typeof payload?.taskId === 'string' ? { taskId: payload.taskId } : {}),
        ...(positiveInteger(payload?.contractVersion) ? { contractVersion: positiveInteger(payload.contractVersion) } : {}),
        ...(typeof payload?.batchId === 'string' ? { batchId: payload.batchId } : {}),
        ...(typeof payload?.sourceTaskId === 'string' ? { sourceTaskId: payload.sourceTaskId } : {}),
        ...(typeof payload?.sourceVersionId === 'string' ? { sourceVersionId: payload.sourceVersionId } : {}),
        assets: event.action.assets.map((asset, index) => ({
          ...asset,
          ...(typeof outputs[index]?.assetId === 'string' ? { assetId: outputs[index].assetId } : {}),
          ...(typeof outputs[index]?.slotId === 'string' ? { slotId: outputs[index].slotId } : {}),
          ...(typeof outputs[index]?.versionId === 'string' ? { versionId: outputs[index].versionId } : {}),
          ...(typeof outputs[index]?.parentVersionId === 'string' ? { parentVersionId: outputs[index].parentVersionId } : {}),
          ...(typeof outputs[index]?.previewSrc === 'string' ? { previewSrc: outputs[index].previewSrc } : {}),
        })),
      },
    };
  });
}

export function parseClarifiedImageCount(value) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) return null;
  const parsed = extractAgentImageCount(text);
  if ((parsed.status === 'resolved' || parsed.status === 'overflow') && parsed.count) return parsed.count;
  const standalone = text.match(/^\s*(\d{1,4}|[零〇一二两三四五六七八九十百]+|[a-z-]+)\s*(?:张|幅|期|版|款|个|images?|covers?|versions?)?\s*$/i);
  return standalone ? parseAgentImageCountNumber(standalone[1]) : null;
}

export function buildWorkingContext(userMessage, contextResolution) {
  const resolution = contextResolution?.status === 'resolved' ? contextResolution : null;
  return {
    version: 1,
    originalRequest: userMessage,
    resolvedEntityIds: resolution?.entityIds || [],
    resolvedLabels: resolution?.candidates.map((candidate) => candidate.label).filter(Boolean) || [],
    plainText: userMessage,
    mustPreserve: resolution?.candidates.flatMap((candidate) => candidate.mustPreserve || []) || [],
    referenceImageUrls: resolution?.candidates.flatMap((candidate) => candidate.referenceImageUrls || []) || [],
    canvasItemIds: resolution?.candidates.flatMap((candidate) => candidate.canvasItemIds || []) || [],
  };
}
