const safeNumber = (value, fallback = 0) => (
  Number.isFinite(value) ? Number(value) : fallback
);

export const CANVAS_IMAGE_RESOURCE_WIDTHS = [96, 256, 640, 1080, 1600];
const LOCAL_ASSET_ROUTE_PREFIX = '/api/local-assets/';
const CANVAS_IMAGE_LOD_DIRECTORY = '.canvas-lod';

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

/**
 * @param {{ width?: number, scale?: number }} options
 */
export function getCanvasImageDisplayResource(options = {}) {
  const width = Math.max(1, safeNumber(options.width, 1));
  const scale = Math.max(0.0001, safeNumber(options.scale, 1));
  const displayWidth = Math.max(1, Math.round(width * scale));
  const resourceWidth = CANVAS_IMAGE_RESOURCE_WIDTHS.find((candidate) => candidate >= displayWidth)
    ?? CANVAS_IMAGE_RESOURCE_WIDTHS.at(-1);

  return { displayWidth, resourceWidth };
}

export function getCanvasImageLodRelativePath(src, resourceWidth) {
  if (typeof src !== 'string' || !CANVAS_IMAGE_RESOURCE_WIDTHS.includes(resourceWidth)) {
    return null;
  }

  const pathname = src.split(/[?#]/, 1)[0];
  if (!pathname.startsWith(`${LOCAL_ASSET_ROUTE_PREFIX}uploads/`)) {
    return null;
  }

  const originalRelativePath = pathname.slice(LOCAL_ASSET_ROUTE_PREFIX.length);
  const originalUploadPath = originalRelativePath.slice('uploads/'.length);
  if (!originalUploadPath || originalUploadPath.startsWith(`${CANVAS_IMAGE_LOD_DIRECTORY}/`)) {
    return null;
  }

  return `uploads/${CANVAS_IMAGE_LOD_DIRECTORY}/${originalUploadPath}/w${resourceWidth}.webp`;
}

export function getCanvasImageLodUrl(src, resourceWidth) {
  const relativePath = getCanvasImageLodRelativePath(src, resourceWidth);
  return relativePath ? `${LOCAL_ASSET_ROUTE_PREFIX}${relativePath}` : src;
}

export function parseCanvasImageLodRelativePath(relativePath) {
  if (typeof relativePath !== 'string') return null;

  const match = relativePath.match(/^uploads\/\.canvas-lod\/(.+)\/w(\d+)\.webp$/);
  if (!match) return null;

  const resourceWidth = Number(match[2]);
  if (!CANVAS_IMAGE_RESOURCE_WIDTHS.includes(resourceWidth)) return null;

  return {
    originalRelativePath: `uploads/${match[1]}`,
    resourceWidth,
  };
}
