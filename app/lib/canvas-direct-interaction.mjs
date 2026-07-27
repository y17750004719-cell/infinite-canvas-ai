const clamp = (value, minimum, maximum) => Math.min(Math.max(value, minimum), maximum);

export const applyDirectPan = (startViewport, startPointer, currentPointer) => ({
  x: startViewport.x + currentPointer.x - startPointer.x,
  y: startViewport.y + currentPointer.y - startPointer.y,
  scale: startViewport.scale,
});

export const applyDirectZoom = (
  viewport,
  deltaY,
  anchor,
  { minScale = 0.1, maxScale = 10, zoomInFactor = 1.08, zoomOutFactor = 0.92 } = {}
) => {
  if (!Number.isFinite(deltaY) || deltaY === 0 || !anchor) return viewport;
  const factor = deltaY > 0 ? zoomOutFactor : zoomInFactor;
  const nextScale = clamp(viewport.scale * factor, minScale, maxScale);
  if (nextScale === viewport.scale) return viewport;
  const worldX = (anchor.x - viewport.x) / viewport.scale;
  const worldY = (anchor.y - viewport.y) / viewport.scale;
  return {
    x: anchor.x - worldX * nextScale,
    y: anchor.y - worldY * nextScale,
    scale: nextScale,
  };
};

export const applyDirectItemDrag = ({ items, itemIds, startPositions, delta }) => {
  const movedIds = new Set(itemIds);
  let changed = false;
  const nextItems = items.map((item) => {
    if (!movedIds.has(item.id)) return item;
    const start = startPositions[item.id];
    if (!start) return item;
    const x = start.x + delta.x;
    const y = start.y + delta.y;
    if (item.x === x && item.y === y) return item;
    changed = true;
    return { ...item, x, y };
  });
  return changed ? nextItems : items;
};

export const applyDirectItemResize = ({
  item,
  startWidth,
  startHeight,
  deltaX,
  deltaY,
  minWidth = 40,
  minHeight = 40,
  preserveAspectRatio = false,
}) => {
  if (!preserveAspectRatio) {
    return {
      width: Math.max(minWidth, startWidth + deltaX),
      height: Math.max(minHeight, startHeight + deltaY),
    };
  }
  const aspect = startWidth / Math.max(1, startHeight);
  const scaleX = (startWidth + deltaX) / Math.max(1, startWidth);
  const scaleY = (startHeight + deltaY) / Math.max(1, startHeight);
  const scale = Math.abs(scaleX - 1) >= Math.abs(scaleY - 1) ? scaleX : scaleY;
  const width = Math.max(minWidth, startWidth * (Number.isFinite(scale) ? scale : 1));
  return {
    width,
    height: Math.max(minHeight, width / Math.max(0.0001, aspect)),
  };
};

const intersects = (a, b) => (
  a.left < b.right &&
  a.right > b.left &&
  a.top < b.bottom &&
  a.bottom > b.top
);

export const resolveDirectMarqueeSelection = ({ rect, boundsById, baseIds = [], additive = false }) => {
  const next = additive ? new Set(baseIds) : new Set();
  for (const [id, bounds] of boundsById) {
    if (intersects(rect, bounds)) next.add(id);
  }
  return Array.from(next);
};
