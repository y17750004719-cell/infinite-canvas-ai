const text = (value) => typeof value === 'string' ? value.trim() : '';

export class VisualReferenceResolutionError extends Error {
  constructor(reason, message, options = {}) {
    super(message);
    this.name = 'VisualReferenceResolutionError';
    this.code = 'invalid_reference';
    this.reason = reason;
    this.referenceId = text(options.referenceId) || undefined;
    this.retryable = options.retryable === true;
    this.candidates = Array.isArray(options.candidates) ? options.candidates : undefined;
  }
}

function historyReferenceId(entry) {
  return `history-image:${entry.id}`;
}

function referenceSource(source) {
  if (source === 'canvas') return 'canvas';
  if (source === 'generated') return 'history';
  return source === 'history' ? 'history' : 'upload';
}

function candidateKey(candidate) {
  return `${text(candidate.assetId)}:${text(candidate.src)}`;
}

function appendCandidate(candidates, seen, candidate) {
  const src = text(candidate?.src);
  if (!src) return;
  const normalized = { ...candidate, src };
  const key = candidateKey(normalized);
  if (seen.has(key)) return;
  seen.add(key);
  candidates.push(normalized);
}

export function selectRecentSessionImage({
  generatedImageHistory = [],
  sessionVisualAssets = [],
  contextEvents = [],
  imageTimeline = [],
  sessionId = '',
}) {
  const normalizedSessionId = text(sessionId);
  const timeline = [];
  const assetById = new Map((Array.isArray(sessionVisualAssets) ? sessionVisualAssets : [])
    .filter((asset) => text(asset?.sessionId) === normalizedSessionId && text(asset?.id))
    .map((asset) => [text(asset.id), asset]));
  const append = (entry, defaults = {}) => {
    if (!entry || typeof entry !== 'object') return;
    const entrySessionId = text(entry.sessionId);
    if (!normalizedSessionId || entrySessionId !== normalizedSessionId) return;
    const assetId = text(entry.assetId || (defaults.stableAsset ? entry.id : ''));
    const linkedAsset = assetById.get(assetId);
    const src = text(entry.src || entry.durableSrc || entry.assetUrl || entry.originalSrc
      || linkedAsset?.durableSrc || linkedAsset?.originalSrc);
    if (!assetId && !src) return;
    const sourceValue = ['upload', 'canvas', 'generated', 'history'].includes(linkedAsset?.source)
      ? linkedAsset.source
      : ['upload', 'canvas', 'generated', 'history'].includes(entry.source)
        ? entry.source
        : defaults.source;
    timeline.push({
      ...defaults,
      ...entry,
      ...(linkedAsset || {}),
      ...entry,
      ...(sourceValue ? { source: sourceValue } : {}),
      assetId: assetId || undefined,
      src: src || undefined,
      createdAt: Number(entry.createdAt || entry.timestampMs || entry.sequence || 0),
    });
  };

  // Events are the authoritative ordering for non-generated inputs/outputs.
  for (const event of Array.isArray(contextEvents) ? contextEvents : []) {
    if (event?.type !== 'image_input' && event?.type !== 'image_output') continue;
    append(event, { source: event.type === 'image_output' ? 'generated' : 'upload', stableAsset: Boolean(event.assetId) });
  }
  for (const event of Array.isArray(imageTimeline) ? imageTimeline : []) append(event);
  for (const asset of Array.isArray(sessionVisualAssets) ? sessionVisualAssets : []) {
    append(asset, { source: asset.source || 'upload', stableAsset: true });
  }
  for (const entry of Array.isArray(generatedImageHistory) ? generatedImageHistory : []) {
    append(entry, { source: 'generated' });
  }

  const seen = new Set();
  const history = timeline
    .filter((entry) => {
      const key = `${text(entry.assetId)}:${text(entry.src)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((left, right) => right.createdAt - left.createdAt);

  const latest = history[0];
  if (!latest) {
    throw new VisualReferenceResolutionError(
      'recent_image_not_found',
      '当前画布没有可复用的最近图片',
    );
  }

  const batchId = text(latest.batchId);
  const latestBatch = batchId
    ? history.filter((entry) => text(entry.batchId) === batchId && (!latest.taskId || entry.taskId === latest.taskId))
    : [latest];
  if (latestBatch.length > 1) {
    throw new VisualReferenceResolutionError(
      'recent_image_ambiguous',
      '最近一次生成包含多张图片，请选择要编辑的图片',
      {
        candidates: latestBatch.map((entry) => ({
          id: text(entry.assetId) || historyReferenceId(entry),
          label: text(entry.label) || `image ${latestBatch.indexOf(entry) + 1}`,
          src: entry.previewSrc || entry.src || entry.durableSrc,
          assetId: text(entry.assetId) || undefined,
          kind: entry.source === 'canvas' ? 'canvas_image' : entry.source === 'upload' ? 'uploaded_image' : 'generated_image',
        })),
      },
    );
  }

  return {
    id: text(latest.assetId) || historyReferenceId(latest),
    label: text(latest.label) || '最近生成的图片',
    src: latest.src || latest.durableSrc,
    previewSrc: latest.previewSrc || latest.src || latest.durableSrc,
    assetId: text(latest.assetId) || undefined,
    source: referenceSource(latest.source),
    role: 'edit_target',
    sourceTaskId: text(latest.taskId) || undefined,
    sourceVersionId: text(latest.versionId) || undefined,
  };
}

export async function resolveExecutableVisualReferences({
  referenceIds = [],
  runtimeReferenceById = new Map(),
  referenceContext,
  contextEntityById = new Map(),
  sessionVisualAssets = [],
  generatedImageHistory = [],
  sessionId = '',
  materialize,
}) {
  const requestedIds = Array.from(new Set(referenceIds.map(text).filter(Boolean)));
  const contextReferences = new Map(
    (Array.isArray(referenceContext?.references) ? referenceContext.references : [])
      .filter((reference) => text(reference?.id))
      .map((reference) => [text(reference.id), reference]),
  );
  const assets = (Array.isArray(sessionVisualAssets) ? sessionVisualAssets : [])
    .filter((asset) => text(asset?.sessionId) === text(sessionId));
  const assetById = new Map(assets.map((asset) => [text(asset.id), asset]));
  const assetBySourceReferenceId = new Map(
    assets.filter((asset) => text(asset.sourceReferenceId)).map((asset) => [text(asset.sourceReferenceId), asset]),
  );
  const historyByReferenceId = new Map(
    (Array.isArray(generatedImageHistory) ? generatedImageHistory : [])
      .filter((entry) => text(entry?.sessionId) === text(sessionId))
      .filter((entry) => text(entry?.id))
      .map((entry) => [historyReferenceId(entry), entry]),
  );

  const resolved = [];
  const registeredAssets = [];
  for (const id of requestedIds) {
    const candidates = [];
    const seen = new Set();
    const runtimeReference = runtimeReferenceById.get(id);
    const contextualReference = contextReferences.get(id);
    const entity = contextEntityById.get(id);
    const sessionAsset = assetById.get(text(runtimeReference?.assetId))
      || assetById.get(text(contextualReference?.assetId))
      || assetById.get(id)
      || assetBySourceReferenceId.get(id);
    const historyEntry = historyByReferenceId.get(id);

    appendCandidate(candidates, seen, runtimeReference && {
      ...runtimeReference,
      originalSrc: runtimeReference.originalSrc || runtimeReference.src,
    });
    appendCandidate(candidates, seen, contextualReference && {
      ...contextualReference,
      originalSrc: contextualReference.originalSrc || contextualReference.src,
    });
    appendCandidate(candidates, seen, entity && {
      id,
      src: entity.assetUrl || entity.referenceImageUrls?.[0],
      label: entity.label || id,
      source: entity.kind === 'canvas_item' ? 'canvas' : 'history',
      role: 'reference',
      originalSrc: entity.assetUrl || entity.referenceImageUrls?.[0],
    });
    appendCandidate(candidates, seen, sessionAsset && {
      id,
      src: sessionAsset.originalSrc || sessionAsset.durableSrc,
      previewSrc: sessionAsset.previewSrc,
      originalSrc: sessionAsset.originalSrc,
      assetId: sessionAsset.id,
      label: runtimeReference?.label || contextualReference?.label || entity?.label || id,
      source: referenceSource(sessionAsset.source),
      role: runtimeReference?.role || contextualReference?.role || 'reference',
    });
    appendCandidate(candidates, seen, historyEntry && {
      id,
      src: historyEntry.src,
      previewSrc: historyEntry.previewSrc,
      originalSrc: historyEntry.src,
      assetId: historyEntry.assetId,
      label: entity?.label || '历史生成图片',
      source: 'history',
      role: 'reference',
      sourceTaskId: historyEntry.taskId,
      sourceVersionId: historyEntry.versionId,
    });

    if (candidates.length === 0) {
      throw new VisualReferenceResolutionError(
        'unknown_reference',
        `未知图片引用：${id}`,
        { referenceId: id },
      );
    }

    let lastError;
    let resolvedReference;
    for (const candidate of candidates) {
      try {
        const asset = typeof materialize === 'function'
          ? await materialize({
              sessionId,
              source: candidate.src,
              originalSrc: candidate.originalSrc || candidate.src,
              sourceKind: candidate.source === 'history' ? 'generated' : candidate.source,
              sourceReferenceId: id,
              existingAsset: candidate.assetId ? assetById.get(candidate.assetId) : undefined,
              taskId: candidate.sourceTaskId,
              versionId: candidate.sourceVersionId,
            })
          : null;
        if (asset) registeredAssets.push(asset);
        resolvedReference = {
          ...candidate,
          id,
          src: asset?.durableSrc || candidate.src,
          ...(asset?.id || candidate.assetId ? { assetId: asset?.id || candidate.assetId } : {}),
          ...(candidate.originalSrc ? { originalSrc: candidate.originalSrc } : {}),
          label: text(candidate.label) || id,
          source: referenceSource(candidate.source),
          role: candidate.role || 'reference',
        };
        break;
      } catch (error) {
        lastError = error;
      }
    }

    if (!resolvedReference) {
      const failureReason = lastError?.code === 'SESSION_ASSET_SNAPSHOT_FAILED'
        ? 'asset_snapshot_failed'
        : lastError?.code === 'image_decode_failed'
          ? 'image_decode_failed'
          : lastError?.code === 'image_dimension_invalid'
            ? 'image_dimension_invalid'
            : 'asset_unavailable';
      throw new VisualReferenceResolutionError(
        failureReason,
        '图片引用已失效，请重新选择后重试',
        { referenceId: id, retryable: lastError?.isRetryable === true },
      );
    }
    resolved.push(resolvedReference);
  }

  return { references: resolved, registeredAssets };
}
