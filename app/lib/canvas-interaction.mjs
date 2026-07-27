export const getCanvasDragActivationDistance = (pointerType) =>
  pointerType === 'touch' ? 6 : 0;

export const hasCanvasDragIntent = (start, current, pointerType) => {
  const threshold = getCanvasDragActivationDistance(pointerType);
  const deltaX = current.x - start.x;
  const deltaY = current.y - start.y;
  if (threshold === 0) return deltaX !== 0 || deltaY !== 0;
  return deltaX * deltaX + deltaY * deltaY >= threshold * threshold;
};

export const getCanvasDragDelta = (start, current, scale) => ({
  x: (current.x - start.x) / scale,
  y: (current.y - start.y) / scale,
});

export const resolveCanvasPointerGesture = ({
  tool,
  button,
  ctrlKey = false,
  isSpacePressed = false,
  target = 'canvas',
}) => {
  if (target === 'control') return 'none';
  if (tool === 'select' && button === 0 && ctrlKey) return 'marquee';
  if (button === 1 || (button === 0 && isSpacePressed)) return 'pan';
  if (tool !== 'select' || button !== 0) return 'none';
  if (target === 'canvas') return 'pan';
  if (target === 'item') return 'item';
  return 'none';
};

export const projectCanvasPointToViewport = (point, viewport) => ({
  x: point.x * viewport.scale + viewport.x,
  y: point.y * viewport.scale + viewport.y,
});

export const resolveCanvasFixedOverlayAnchors = ({
  bounds,
  viewport,
  canvasOrigin,
  gap,
}) => {
  const centerX = bounds.left + bounds.width / 2;
  const topPoint = projectCanvasPointToViewport(
    { x: centerX, y: bounds.top },
    viewport
  );
  const bottomPoint = projectCanvasPointToViewport(
    { x: centerX, y: bounds.top + bounds.height },
    viewport
  );

  return {
    centerX: canvasOrigin.x + topPoint.x,
    topToolbarY: canvasOrigin.y + topPoint.y - gap,
    bottomPanelY: canvasOrigin.y + bottomPoint.y + gap,
  };
};

export const normalizeCanvasMarqueeRect = (start, current) => ({
  x: Math.min(start.x, current.x),
  y: Math.min(start.y, current.y),
  width: Math.abs(current.x - start.x),
  height: Math.abs(current.y - start.y),
});

export const getCanvasMarqueePath = (rect) => {
  const left = rect.x;
  const top = rect.y;
  const right = rect.x + rect.width;
  const bottom = rect.y + rect.height;
  return `M ${left} ${top} H ${right} V ${bottom} H ${left} Z`;
};

export const projectScreenRectToCanvas = (rect, viewport) => ({
  left: (rect.x - viewport.x) / viewport.scale,
  right: (rect.x + rect.width - viewport.x) / viewport.scale,
  top: (rect.y - viewport.y) / viewport.scale,
  bottom: (rect.y + rect.height - viewport.y) / viewport.scale,
});

export const isRectIntersecting = (first, second) => (
  first.left <= second.right &&
  first.right >= second.left &&
  first.top <= second.bottom &&
  first.bottom >= second.top
);

export const getRotatedRectAabb = (rect, rotationDegrees, origin) => {
  const center = origin ?? {
    x: rect.left + rect.width / 2,
    y: rect.top + rect.height / 2,
  };
  const radians = (Number(rotationDegrees) || 0) * Math.PI / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  const right = rect.left + rect.width;
  const bottom = rect.top + rect.height;
  const corners = [
    [rect.left, rect.top],
    [right, rect.top],
    [right, bottom],
    [rect.left, bottom],
  ];
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;

  for (const [x, y] of corners) {
    const offsetX = x - center.x;
    const offsetY = y - center.y;
    const rotatedX = center.x + offsetX * cosine - offsetY * sine;
    const rotatedY = center.y + offsetX * sine + offsetY * cosine;
    minX = Math.min(minX, rotatedX);
    maxX = Math.max(maxX, rotatedX);
    minY = Math.min(minY, rotatedY);
    maxY = Math.max(maxY, rotatedY);
  }

  return { left: minX, right: maxX, top: minY, bottom: maxY };
};

export const areCanvasPointsFullyContained = (rect, points) => {
  const right = rect.x + rect.width;
  const bottom = rect.y + rect.height;
  return points.length > 0 && points.every((point) => (
    point.x >= rect.x &&
    point.x <= right &&
    point.y >= rect.y &&
    point.y <= bottom
  ));
};

export const resolveCanvasMarqueeSelection = (currentIds, hitIds, additive) => {
  if (!additive) return [...hitIds];
  return hitIds.reduce(
    (ids, id) => ids.includes(id)
      ? ids.filter((entry) => entry !== id)
      : [...ids, id],
    [...currentIds]
  );
};

export const matchesCanvasItemDragTransaction = (transaction, token, sessionId) => Boolean(
  transaction &&
  token !== null &&
  transaction.token === token &&
  transaction.sessionId === sessionId
);

export const resolveCanvasItemDragReleasePositions = ({
  itemIds,
  startPositions,
  delta,
}) => {
  const positions = new Map();
  for (const itemId of itemIds) {
    const startPosition = startPositions[itemId];
    if (!startPosition) continue;
    positions.set(itemId, {
      x: startPosition.x + delta.x,
      y: startPosition.y + delta.y,
    });
  }
  return positions;
};

export const ownsCanvasItemVisualHandoff = ({ token, itemIds, visualTokens }) => (
  itemIds.every((itemId) => visualTokens.get(itemId) === token)
);

export const shouldCancelCanvasPointerSessionOnLostCapture = ({
  eventPointerId,
  sessionPointerId,
  releasePending,
}) => eventPointerId === sessionPointerId && !releasePending;

export const applyCanvasItemDragPositions = ({ items, itemIds, positions }) => {
  const draggedItemIds = new Set(itemIds);
  const updatedItems = [];
  const remainingItems = [];
  const frontItems = [];
  const orderBefore = [];
  const remainingOrder = [];
  const frontOrder = [];
  let encounteredFrontItem = false;
  let alreadyFront = true;

  for (const item of items) {
    orderBefore.push(item.id);
    const finalPosition = positions.get(item.id);
    const nextItem = finalPosition
      ? { ...item, x: finalPosition.x, y: finalPosition.y }
      : item;
    updatedItems.push(nextItem);
    if (draggedItemIds.has(item.id)) {
      encounteredFrontItem = true;
      frontItems.push(nextItem);
      frontOrder.push(item.id);
    } else {
      if (encounteredFrontItem) alreadyFront = false;
      remainingItems.push(nextItem);
      remainingOrder.push(item.id);
    }
  }

  return {
    items: alreadyFront ? updatedItems : [...remainingItems, ...frontItems],
    orderBefore,
    orderAfter: alreadyFront ? [...orderBefore] : [...remainingOrder, ...frontOrder],
  };
};
