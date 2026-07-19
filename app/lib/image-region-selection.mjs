const text = (value) => typeof value === 'string' ? value.trim() : '';

export const clampNormalized = (value) => Math.min(1, Math.max(0, Number(value) || 0));
const roundNormalized = (value) => Math.round(clampNormalized(value) * 1_000_000) / 1_000_000;

export function normalizeRegionPoint(value) {
  if (!value || typeof value !== 'object') return null;
  const x = Number(value.x);
  const y = Number(value.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x: clampNormalized(x), y: clampNormalized(y) };
}

export function normalizeRegionBox(value) {
  if (!value || typeof value !== 'object') return undefined;
  const x = Number(value.x);
  const y = Number(value.y);
  const width = Number(value.width);
  const height = Number(value.height);
  if (![x, y, width, height].every(Number.isFinite)) return undefined;
  const left = roundNormalized(Math.min(x, x + width));
  const top = roundNormalized(Math.min(y, y + height));
  const right = roundNormalized(Math.max(x, x + width));
  const bottom = roundNormalized(Math.max(y, y + height));
  if (right - left < 0.002 || bottom - top < 0.002) return undefined;
  return { x: left, y: top, width: roundNormalized(right - left), height: roundNormalized(bottom - top) };
}

export function buildRegionBox(start, end) {
  const normalizedStart = normalizeRegionPoint(start);
  const normalizedEnd = normalizeRegionPoint(end);
  if (!normalizedStart || !normalizedEnd) return undefined;
  return normalizeRegionBox({
    x: normalizedStart.x,
    y: normalizedStart.y,
    width: normalizedEnd.x - normalizedStart.x,
    height: normalizedEnd.y - normalizedStart.y,
  });
}

export function buildRegionEvidenceCrop({ point, box, naturalWidth, naturalHeight, padding = 0.2 }) {
  const normalizedPoint = normalizeRegionPoint(point);
  if (!normalizedPoint) return null;
  const sourceWidth = Math.max(1, Number(naturalWidth) || 1);
  const sourceHeight = Math.max(1, Number(naturalHeight) || 1);
  const target = normalizeRegionBox(box);
  if (target) {
    const padX = target.width * Math.max(0, Number(padding) || 0);
    const padY = target.height * Math.max(0, Number(padding) || 0);
    const left = Math.max(0, target.x - padX);
    const top = Math.max(0, target.y - padY);
    const right = Math.min(1, target.x + target.width + padX);
    const bottom = Math.min(1, target.y + target.height + padY);
    return normalizeRegionBox({ x: left, y: top, width: right - left, height: bottom - top });
  }

  // Keep a point crop square in source pixels so portrait and landscape images get comparable context.
  const side = Math.min(sourceWidth, sourceHeight) * 0.36;
  const width = side / sourceWidth;
  const height = side / sourceHeight;
  return normalizeRegionBox({
    x: Math.min(1 - width, Math.max(0, normalizedPoint.x - width / 2)),
    y: Math.min(1 - height, Math.max(0, normalizedPoint.y - height / 2)),
    width,
    height,
  });
}

function fitMetrics(content, naturalWidth, naturalHeight, fit) {
  const width = Math.max(1, Number(content?.width) || 1);
  const height = Math.max(1, Number(content?.height) || 1);
  const sourceWidth = Math.max(1, Number(naturalWidth) || width);
  const sourceHeight = Math.max(1, Number(naturalHeight) || height);
  const scale = fit === 'cover'
    ? Math.max(width / sourceWidth, height / sourceHeight)
    : Math.min(width / sourceWidth, height / sourceHeight);
  const renderedWidth = sourceWidth * scale;
  const renderedHeight = sourceHeight * scale;
  return {
    width,
    height,
    sourceWidth,
    sourceHeight,
    scale,
    offsetX: (width - renderedWidth) / 2,
    offsetY: (height - renderedHeight) / 2,
  };
}

export function canvasPointToImageNormalized({
  canvasPoint,
  item,
  content,
  naturalWidth,
  naturalHeight,
  fit = 'contain',
}) {
  if (!canvasPoint || !item || !content) return null;
  const width = Math.max(1, Number(item.width) || 1);
  const height = Math.max(1, Number(item.height) || 1);
  const centerX = Number(item.x) + width / 2;
  const centerY = Number(item.y) + height / 2;
  const radians = -(Number(item.rotation) || 0) * Math.PI / 180;
  const dx = Number(canvasPoint.x) - centerX;
  const dy = Number(canvasPoint.y) - centerY;
  const unrotatedX = centerX + dx * Math.cos(radians) - dy * Math.sin(radians);
  const unrotatedY = centerY + dx * Math.sin(radians) + dy * Math.cos(radians);
  const localX = unrotatedX - Number(item.x) - Number(content.x || 0);
  const localY = unrotatedY - Number(item.y) - Number(content.y || 0);
  const metrics = fitMetrics(content, naturalWidth, naturalHeight, fit);
  const sourceX = (localX - metrics.offsetX) / metrics.scale;
  const sourceY = (localY - metrics.offsetY) / metrics.scale;
  if (sourceX < 0 || sourceY < 0 || sourceX > metrics.sourceWidth || sourceY > metrics.sourceHeight) {
    return null;
  }
  return {
    x: clampNormalized(sourceX / metrics.sourceWidth),
    y: clampNormalized(sourceY / metrics.sourceHeight),
  };
}

export function imageNormalizedToItemLocal({
  point,
  content,
  naturalWidth,
  naturalHeight,
  fit = 'contain',
}) {
  const normalized = normalizeRegionPoint(point);
  if (!normalized || !content) return null;
  const metrics = fitMetrics(content, naturalWidth, naturalHeight, fit);
  return {
    x: Number(content.x || 0) + metrics.offsetX + normalized.x * metrics.sourceWidth * metrics.scale,
    y: Number(content.y || 0) + metrics.offsetY + normalized.y * metrics.sourceHeight * metrics.scale,
  };
}

export function normalizeLocateCandidates(value) {
  const source = Array.isArray(value?.candidates) ? value.candidates : Array.isArray(value) ? value : [];
  const seenLabels = new Set();
  return source.slice(0, 12).flatMap((candidate, index) => {
    if (!candidate || typeof candidate !== 'object') return [];
    const label = text(candidate.label).slice(0, 80);
    if (!label) return [];
    const dedupeKey = label.toLowerCase();
    if (seenLabels.has(dedupeKey)) return [];
    seenLabels.add(dedupeKey);
    const aliases = Array.isArray(candidate.aliases)
      ? Array.from(new Set(candidate.aliases.map(text).filter(Boolean))).slice(0, 6)
      : [];
    const confidence = ['high', 'medium', 'low'].includes(candidate.confidence)
      ? candidate.confidence
      : 'low';
    const description = text(candidate.description).slice(0, 240);
    return [{
      id: text(candidate.id) || `candidate-${index + 1}`,
      label,
      aliases,
      confidence,
      ...(description ? { description } : {}),
      ...(normalizeRegionBox(candidate.box) ? { box: normalizeRegionBox(candidate.box) } : {}),
    }];
  }).slice(0, 5);
}

export function parseLocateModelResponse(response) {
  const message = response?.choices?.[0]?.message || {};
  const toolCall = Array.isArray(message.tool_calls)
    ? message.tool_calls.find((call) => call?.function?.name === 'report_image_region_candidates')
    : null;
  const raw = toolCall?.function?.arguments || message.content || '';
  let parsed = raw;
  if (typeof raw === 'string') {
    const stripped = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    parsed = JSON.parse(stripped);
  }
  const candidates = normalizeLocateCandidates(parsed);
  if (candidates.length === 0) throw new Error('视觉模型没有返回有效的对象候选');
  const requestedSelectedId = text(parsed?.selectedCandidateId);
  const selectedCandidateId = candidates.some((candidate) => candidate.id === requestedSelectedId)
    ? requestedSelectedId
    : candidates[0].id;
  return {
    candidates,
    selectedCandidateId,
    lowConfidence: parsed?.lowConfidence === true || candidates[0].confidence === 'low',
  };
}

export function selectedRegionLabel(region) {
  const candidate = Array.isArray(region?.candidates)
    ? region.candidates.find((entry) => entry.id === region.selectedCandidateId) || region.candidates[0]
    : null;
  return text(region?.customLabel) || text(candidate?.label) || '未识别对象';
}

export function buildAgentRegionSelectionSnapshot({ references = [], regions = [] } = {}) {
  const regionById = new Map(
    (Array.isArray(regions) ? regions : [])
      .filter((region) => region && typeof region === 'object' && text(region.id))
      .map((region) => [text(region.id), region]),
  );
  const seenRegionIds = new Set();
  const regionSelections = [];
  const missingRegionIds = [];

  for (const reference of Array.isArray(references) ? references : []) {
    if (!reference || typeof reference !== 'object' || reference.role !== 'region_target') continue;
    const regionId = text(reference.regionId).slice(0, 160);
    const missingId = regionId || text(reference.id).slice(0, 160) || 'unknown-region';
    if (!regionId) {
      missingRegionIds.push(missingId);
      continue;
    }
    if (seenRegionIds.has(regionId)) continue;
    seenRegionIds.add(regionId);

    const liveRegion = regionById.get(regionId);
    const point = normalizeRegionPoint(liveRegion?.point) || normalizeRegionPoint(reference.targetPoint);
    const imageItemId = text(liveRegion?.imageItemId || reference.canvasItemId).slice(0, 160);
    const liveLabel = liveRegion ? selectedRegionLabel(liveRegion) : '';
    const label = (liveLabel && liveLabel !== '未识别对象' ? liveLabel : text(reference.label)).slice(0, 120);
    if (!point || !imageItemId || !label) {
      missingRegionIds.push(missingId);
      continue;
    }

    const box = normalizeRegionBox(liveRegion?.box) || normalizeRegionBox(reference.targetBox);
    const candidateId = text(liveRegion?.selectedCandidateId || reference.candidateId).slice(0, 160);
    const selectedCandidate = Array.isArray(liveRegion?.candidates)
      ? liveRegion.candidates.find((candidate) => candidate?.id === liveRegion.selectedCandidateId)
        || liveRegion.candidates[0]
      : null;
    const confidence = ['high', 'medium', 'low'].includes(selectedCandidate?.confidence)
      ? selectedCandidate.confidence
      : undefined;
    regionSelections.push({
      regionId,
      imageItemId,
      point,
      ...(box ? { box } : {}),
      label,
      ...(candidateId ? { candidateId } : {}),
      ...(confidence ? { confidence } : {}),
    });
  }

  return { regionSelections, missingRegionIds };
}
