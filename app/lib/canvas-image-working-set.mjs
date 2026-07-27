const safeNumber = (value, fallback = 0) => (
  Number.isFinite(value) ? Number(value) : fallback
);

const intersects = (item, bounds) => {
  const left = safeNumber(item?.x);
  const top = safeNumber(item?.y);
  const right = left + Math.max(0, safeNumber(item?.width));
  const bottom = top + Math.max(0, safeNumber(item?.height));
  return right >= bounds.left && left <= bounds.right && bottom >= bounds.top && top <= bounds.bottom;
};

/**
 * @param {{
 *   items?: Array<{ id: string, type: string, x: number, y: number, width: number, height: number }>,
 *   viewport?: { x?: number, y?: number, scale?: number },
 *   canvasSize?: { width?: number, height?: number },
 *   overscanScreens?: number,
 * }} options
 */
export function getCanvasImageWorkingSetIds(options = {}) {
  const {
    items,
    viewport,
    canvasSize,
    overscanScreens = 1,
  } = options;
  const normalizedItems = Array.isArray(items) ? items : [];
  const imageItems = normalizedItems.filter(
    (item) => item?.type === 'image' && typeof item?.id === 'string' && item.id.length > 0
  );
  const width = Math.max(0, safeNumber(canvasSize?.width));
  const height = Math.max(0, safeNumber(canvasSize?.height));
  const scale = Math.max(0.0001, safeNumber(viewport?.scale, 1));

  if (width === 0 || height === 0) {
    return imageItems.map((item) => item.id);
  }

  const overscan = Math.max(0, safeNumber(overscanScreens, 1));
  const viewportX = safeNumber(viewport?.x);
  const viewportY = safeNumber(viewport?.y);
  const horizontalPadding = width * overscan;
  const verticalPadding = height * overscan;
  const bounds = {
    left: (-viewportX - horizontalPadding) / scale,
    top: (-viewportY - verticalPadding) / scale,
    right: (width - viewportX + horizontalPadding) / scale,
    bottom: (height - viewportY + verticalPadding) / scale,
  };

  return imageItems.filter((item) => intersects(item, bounds)).map((item) => item.id);
}
