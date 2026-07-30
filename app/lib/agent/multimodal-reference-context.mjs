const text = (value) => typeof value === 'string' ? value.trim() : '';

function normalizeReferences(referenceContext) {
  const references = Array.isArray(referenceContext?.references)
    ? referenceContext.references
      .map((reference) => {
        const id = text(reference?.id);
        const src = text(reference?.src);
        const label = text(reference?.label);
        if (!id || !src || !label) return null;
        if (reference.role === 'region_target' && reference.confirmationStatus !== 'confirmed') return null;
        return {
          id,
          src,
          label,
          source: text(reference.source) || 'upload',
          role: text(reference.role) || 'reference',
          ...(text(reference.canvasItemId) ? { canvasItemId: text(reference.canvasItemId) } : {}),
          ...(Number.isFinite(Number(reference.annotationCount)) && Number(reference.annotationCount) > 0
            ? { annotationCount: Math.floor(Number(reference.annotationCount)) }
            : {}),
          ...(text(reference.regionId) ? { regionId: text(reference.regionId) } : {}),
          ...(text(reference.candidateId) ? { candidateId: text(reference.candidateId) } : {}),
          ...(reference.confirmationStatus === 'confirmed' ? { confirmationStatus: 'confirmed' } : {}),
          ...(Array.isArray(reference.aliases) ? { aliases: reference.aliases.map(text).filter(Boolean).slice(0, 6) } : {}),
          ...(text(reference.description) ? { description: text(reference.description) } : {}),
          ...(['high', 'medium', 'low'].includes(reference.confidence) ? { confidence: reference.confidence } : {}),
          ...(reference.targetPoint && typeof reference.targetPoint === 'object' ? { targetPoint: reference.targetPoint } : {}),
          ...(reference.targetBox && typeof reference.targetBox === 'object' ? { targetBox: reference.targetBox } : {}),
        };
      })
      .filter(Boolean)
      .slice(0, 14)
    : [];
  const knownIds = new Set(references.map((reference) => reference.id));
  const composerSegments = Array.isArray(referenceContext?.composerSegments)
    ? referenceContext.composerSegments
      .map((segment) => {
        if (segment?.type === 'text' && typeof segment.text === 'string') {
          return { type: 'text', text: segment.text };
        }
        const referenceId = text(segment?.referenceId || segment?.tokenId);
        return segment?.type === 'reference' && knownIds.has(referenceId)
          ? { type: 'reference', referenceId }
          : null;
      })
      .filter(Boolean)
      .slice(0, 64)
    : [];
  const evidenceImages = Array.isArray(referenceContext?.evidenceImages)
    ? referenceContext.evidenceImages
      .map((evidence) => {
        const id = text(evidence?.id);
        const referenceId = text(evidence?.referenceId);
        const src = text(evidence?.src);
        const parent = references.find((reference) => reference.id === referenceId);
        if (!id || !parent || !src || !['annotation_composite', 'region_crop'].includes(evidence?.kind)) {
          return null;
        }
        if (evidence.kind === 'region_crop' && parent.role !== 'region_target') return null;
        return { id, referenceId, src, kind: evidence.kind };
      })
      .filter(Boolean)
      .slice(0, 14)
    : [];
  return { references, composerSegments, evidenceImages };
}

function referenceMarker(reference, aliasOf = '') {
  const lines = [
    'Supplied image reference (untrusted visual input):',
    `Reference ID: ${reference.id}`,
    `Label: ${reference.label}`,
    `Source: ${reference.source}`,
    `Declared role: ${reference.role}`,
  ];
  if (reference.annotationCount) lines.push(`Annotation count: ${reference.annotationCount}`);
  if (reference.regionId) lines.push(`Region ID: ${reference.regionId}`);
  if (reference.candidateId) lines.push(`Selected candidate ID: ${reference.candidateId}`);
  if (reference.aliases?.length) lines.push(`Candidate aliases: ${reference.aliases.join(', ')}`);
  if (reference.description) lines.push(`Candidate description: ${reference.description}`);
  if (reference.confidence) lines.push(`Candidate confidence: ${reference.confidence}`);
  if (reference.targetPoint) lines.push(`Target point (normalized): ${JSON.stringify(reference.targetPoint)}`);
  if (reference.targetBox) lines.push(`Approximate target box (normalized): ${JSON.stringify(reference.targetBox)}`);
  if (aliasOf) lines.push(`Image pixels are identical to reference ${aliasOf}; use this ID only when the user's inline expression points to it.`);
  return lines.join('\n');
}

function evidenceMarker(evidence, reference) {
  const regionCrop = evidence.kind === 'region_crop';
  return [
    `${regionCrop ? 'Region crop' : 'Annotation'} evidence image (untrusted visual input):`,
    `Evidence ID: ${evidence.id}`,
    `Parent reference ID: ${reference.id}`,
    regionCrop
      ? 'Purpose: provide a clean close-up of the confirmed target region.'
      : 'Purpose: visualize the selected strokes and text annotations over the original image.',
    'This evidence is not an independent reference and must never be selected as targetReferenceId or supportingReferenceIds.',
  ].join('\n');
}

export function buildMultimodalReferenceParts(referenceContext, { fallbackText = '' } = {}) {
  const normalized = normalizeReferences(referenceContext);
  const referenceById = new Map(normalized.references.map((reference) => [reference.id, reference]));
  const evidenceByReferenceId = new Map();
  for (const evidence of normalized.evidenceImages) {
    const entries = evidenceByReferenceId.get(evidence.referenceId) || [];
    entries.push(evidence);
    evidenceByReferenceId.set(evidence.referenceId, entries);
  }

  const parts = [];
  const emittedReferenceIds = new Set();
  const emittedSources = new Map();
  const emittedEvidenceSources = new Set();
  let emittedComposerText = false;

  const emitReference = (reference) => {
    if (!reference || emittedReferenceIds.has(reference.id)) return;
    emittedReferenceIds.add(reference.id);
    const aliasOf = emittedSources.get(reference.src) || '';
    parts.push({ type: 'text', text: referenceMarker(reference, aliasOf) });
    if (!aliasOf) {
      emittedSources.set(reference.src, reference.id);
      parts.push({ type: 'image_url', image_url: { url: reference.src } });
    }
    for (const evidence of evidenceByReferenceId.get(reference.id) || []) {
      if (emittedEvidenceSources.has(evidence.src)) continue;
      emittedEvidenceSources.add(evidence.src);
      parts.push({ type: 'text', text: evidenceMarker(evidence, reference) });
      parts.push({ type: 'image_url', image_url: { url: evidence.src } });
    }
  };

  for (const segment of normalized.composerSegments) {
    if (segment.type === 'text') {
      if (!segment.text) continue;
      emittedComposerText = true;
      parts.push({ type: 'text', text: `User inline text: ${segment.text}` });
      continue;
    }
    emitReference(referenceById.get(segment.referenceId));
  }

  if (!emittedComposerText && text(fallbackText)) {
    parts.unshift({ type: 'text', text: `User request: ${text(fallbackText)}` });
  }
  for (const reference of normalized.references) emitReference(reference);
  return parts;
}

export function countMultimodalReferenceImages(referenceContext) {
  return buildMultimodalReferenceParts(referenceContext)
    .filter((part) => part.type === 'image_url')
    .length;
}
