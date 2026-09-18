import { createHash } from 'node:crypto';

/** @param {{referenceContext?: any, referenceImages?: any[], imageTask?: any}} options @returns {any} */
export function resolveAgentImageCardReferences(options = {}) {
  const { referenceContext, referenceImages = [], imageTask } = options;
  const contextualPreviews = (referenceContext?.references || [])
    .filter((reference) => reference.id && reference.src)
    .map((reference) => ({ id: reference.id, src: reference.src, label: reference.label }));
  const contextualSources = new Set(contextualPreviews.map((reference) => reference.src));
  const extraPreviews = referenceImages
    .filter((src) => typeof src === 'string' && src.trim() && !contextualSources.has(src))
    .map((src, index) => ({
      id: `runtime-reference-${index + 1}`,
      src,
      label: `image${contextualPreviews.length + index + 1}`,
    }));
  const linkedImagePreviews = [...contextualPreviews, ...extraPreviews];
  const referenceIds = imageTask
    ? [
        ...(imageTask.targetReferenceId ? [imageTask.targetReferenceId] : []),
        ...(imageTask.supportingReferenceIds || []),
        ...extraPreviews.map((reference) => reference.id),
      ]
    : undefined;
  const previewById = new Map(linkedImagePreviews.map((reference) => [reference.id, reference]));
  const orderedLinkedImagePreviews = referenceIds
    ? referenceIds.flatMap((referenceId) => {
        const preview = previewById.get(referenceId);
        return preview ? [preview] : [];
      })
    : linkedImagePreviews;
  return {
    linkedImagePreviews,
    referenceIds,
    orderedReferenceImages: orderedLinkedImagePreviews.map((reference) => reference.src),
  };
}

function normalizeRuntimePoint(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const point = value;
  const x = Number(point.x);
  const y = Number(point.y);
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : undefined;
}

function normalizeRuntimeBox(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const box = value;
  const x = Number(box.x);
  const y = Number(box.y);
  const width = Number(box.width);
  const height = Number(box.height);
  return [x, y, width, height].every(Number.isFinite) ? { x, y, width, height } : undefined;
}

/** @param {unknown} value @returns {any} */
export function normalizeAgentRuntimeReferenceContext(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const input = value;
  const references = (Array.isArray(input.references) ? input.references : []).flatMap((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return [];
    const reference = entry;
    const id = typeof reference.id === 'string' ? reference.id.trim() : '';
    const src = typeof reference.src === 'string' ? reference.src.trim() : '';
    const previewSrc = typeof reference.previewSrc === 'string' ? reference.previewSrc.trim() : '';
    const label = typeof reference.label === 'string' ? reference.label.trim() : '';
    const source = reference.source === 'upload' || reference.source === 'history' || reference.source === 'canvas'
      ? reference.source
      : null;
    const role = reference.role === 'edit_target' || reference.role === 'annotation_bundle' || reference.role === 'region_target'
      ? reference.role
      : reference.role === 'reference' ? 'reference' : null;
    if (!id || !src || !label || !source || !role) return [];
    if (role === 'region_target' && reference.confirmationStatus !== 'confirmed') return [];
    const targetPoint = normalizeRuntimePoint(reference.targetPoint);
    const targetBox = normalizeRuntimeBox(reference.targetBox);
    return [{
      id,
      src,
      ...(typeof reference.assetId === 'string' && reference.assetId.trim() ? { assetId: reference.assetId.trim() } : {}),
      ...(typeof reference.originalSrc === 'string' && reference.originalSrc.trim() ? { originalSrc: reference.originalSrc.trim() } : {}),
      ...(previewSrc ? { previewSrc } : {}),
      label,
      source,
      role,
      ...(typeof reference.canvasItemId === 'string' && reference.canvasItemId.trim() ? { canvasItemId: reference.canvasItemId.trim() } : {}),
      ...(Number.isFinite(reference.annotationCount) && Number(reference.annotationCount) > 0 ? { annotationCount: Math.floor(Number(reference.annotationCount)) } : {}),
      ...(typeof reference.regionId === 'string' && reference.regionId.trim() ? { regionId: reference.regionId.trim() } : {}),
      ...(typeof reference.candidateId === 'string' && reference.candidateId.trim() ? { candidateId: reference.candidateId.trim() } : {}),
      ...(reference.confirmationStatus === 'confirmed' ? { confirmationStatus: 'confirmed' } : { confirmationStatus: 'pending' }),
      ...(Array.isArray(reference.aliases) ? { aliases: reference.aliases.filter((item) => typeof item === 'string' && Boolean(item.trim())).map((item) => item.trim()).slice(0, 6) } : {}),
      ...(typeof reference.description === 'string' && reference.description.trim() ? { description: reference.description.trim().slice(0, 240) } : {}),
      ...(reference.confidence === 'high' || reference.confidence === 'medium' || reference.confidence === 'low' ? { confidence: reference.confidence } : {}),
      ...(source === 'history' && typeof reference.sourceTaskId === 'string' && reference.sourceTaskId.trim() ? { sourceTaskId: reference.sourceTaskId.trim() } : {}),
      ...(source === 'history' && typeof reference.sourceVersionId === 'string' && reference.sourceVersionId.trim() ? { sourceVersionId: reference.sourceVersionId.trim() } : {}),
      ...(targetPoint ? { targetPoint } : {}),
      ...(targetBox ? { targetBox } : {}),
    }];
  }).slice(0, 14);
  const knownIds = new Set(references.map((reference) => reference.id));
  const composerSegments = (Array.isArray(input.composerSegments) ? input.composerSegments : []).flatMap((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return [];
    const segment = entry;
    if (segment.type === 'text' && typeof segment.text === 'string') return [{ type: 'text', text: segment.text }];
    if (segment.type === 'reference' && typeof segment.referenceId === 'string' && knownIds.has(segment.referenceId)) return [{ type: 'reference', referenceId: segment.referenceId }];
    return [];
  }).slice(0, 64);
  const evidenceImages = (Array.isArray(input.evidenceImages) ? input.evidenceImages : []).flatMap((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return [];
    const evidence = entry;
    const id = typeof evidence.id === 'string' ? evidence.id.trim() : '';
    const referenceId = typeof evidence.referenceId === 'string' ? evidence.referenceId.trim() : '';
    const src = typeof evidence.src === 'string' ? evidence.src.trim() : '';
    const parent = references.find((reference) => reference.id === referenceId);
    if (!id || !parent || !src || (evidence.kind !== 'annotation_composite' && evidence.kind !== 'region_crop')) return [];
    if (evidence.kind === 'region_crop' && parent.role !== 'region_target') return [];
    return [{ id, referenceId, src, kind: evidence.kind }];
  }).slice(0, 14);
  return references.length > 0 || composerSegments.length > 0 || evidenceImages.length > 0
    ? { references, composerSegments, ...(evidenceImages.length > 0 ? { evidenceImages } : {}) }
    : undefined;
}

function runtimeReferenceId(src) {
  return `runtime-reference:${createHash('sha256').update(src).digest('hex').slice(0, 16)}`;
}

/** @param {{referenceContext?: any, referenceImages?: any[], canvasContext?: any}} options @returns {any} */
export function buildCanonicalAgentReferenceContext(options = {}) {
  const { referenceContext, referenceImages = [], canvasContext } = options;
  const references = [...(referenceContext?.references || [])];
  const composerSegments = [...(referenceContext?.composerSegments || [])];
  const evidenceImages = [...(referenceContext?.evidenceImages || [])];
  const knownSources = new Set(references.map((reference) => reference.src));
  const knownEvidenceSources = new Set(evidenceImages.map((evidence) => evidence.src));
  const annotationContext = canvasContext?.annotationContext && typeof canvasContext.annotationContext === 'object' ? canvasContext.annotationContext : undefined;
  const compositePreviewUrl = typeof annotationContext?.compositePreviewUrl === 'string' ? annotationContext.compositePreviewUrl.trim() : '';
  const targetImage = annotationContext?.targetImage && typeof annotationContext.targetImage === 'object' ? annotationContext.targetImage : undefined;
  const targetCanvasItemId = typeof targetImage?.id === 'string' ? targetImage.id.trim() : '';
  const annotationParent = references.find((reference) => reference.role === 'annotation_bundle' || Boolean(targetCanvasItemId && reference.canvasItemId === targetCanvasItemId));
  if (compositePreviewUrl && annotationParent && !knownEvidenceSources.has(compositePreviewUrl)) {
    evidenceImages.push({ id: `${annotationParent.id}:annotation-composite`, referenceId: annotationParent.id, src: compositePreviewUrl, kind: 'annotation_composite' });
    knownEvidenceSources.add(compositePreviewUrl);
  }
  for (const [index, rawSrc] of (referenceImages || []).entries()) {
    const src = typeof rawSrc === 'string' ? rawSrc.trim() : '';
    if (!src || knownSources.has(src) || knownEvidenceSources.has(src)) continue;
    const id = runtimeReferenceId(src);
    references.push({ id, src, label: `image${references.length + index + 1}`, source: 'upload', role: 'reference' });
    knownSources.add(src);
  }
  return normalizeAgentRuntimeReferenceContext({ references, composerSegments, evidenceImages });
}
