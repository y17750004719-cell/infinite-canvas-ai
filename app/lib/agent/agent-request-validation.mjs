import { createHash } from 'node:crypto';

export function hashPrompt(value) {
  return createHash('sha256').update(String(value || ''), 'utf8').digest('hex');
}

export function getLatestUserMessage(messages) {
  return [...(messages || [])].reverse().find((message) => message.role === 'user')?.content?.trim() || '';
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
