const MIN_CANVAS_SCALE = 0.1;
const MAX_CANVAS_SCALE = 10;
const MAX_WHEEL_DELTA_PX = 120;
const WHEEL_SCALE_SENSITIVITY = 0.0015;
const DEFAULT_VIEWPORT_SMOOTHING_MS = 90;
const VIEWPORT_SETTLE_EPSILON = 0.0005;
const DEFAULT_PAN_SMOOTHING_MS = 24;
const MAX_PAN_FRAME_DELTA_MS = 32;
const PAN_SETTLE_EPSILON_PX = 0.5;
const DEFAULT_PAN_MAX_VISUAL_LAG_PX = 6;

const clamp = (value, minimum, maximum) => Math.min(Math.max(value, minimum), maximum);

export const clampCanvasScale = (scale) => clamp(scale, MIN_CANVAS_SCALE, MAX_CANVAS_SCALE);

export const clampCanvasAnchor = (anchor, metrics) => ({
  x: clamp(anchor.x, 0, Math.max(0, metrics.width)),
  y: clamp(anchor.y, 0, Math.max(0, metrics.height)),
});

export const normalizeCanvasWheelDelta = (deltaY, deltaMode, pageHeight) => {
  const pixelDelta = deltaMode === 1
    ? deltaY * 16
    : deltaMode === 2
      ? deltaY * Math.max(1, pageHeight)
      : deltaY;
  return clamp(pixelDelta, -MAX_WHEEL_DELTA_PX, MAX_WHEEL_DELTA_PX);
};

export const getCanvasViewportAtAnchor = (currentViewport, nextScale, anchor) => {
  const scale = clampCanvasScale(nextScale);
  if (scale === currentViewport.scale) return currentViewport;
  if (!anchor) return { ...currentViewport, scale };

  const worldX = (anchor.x - currentViewport.x) / currentViewport.scale;
  const worldY = (anchor.y - currentViewport.y) / currentViewport.scale;

  return {
    scale,
    x: anchor.x - worldX * scale,
    y: anchor.y - worldY * scale,
  };
};

export const applyCanvasWheelDelta = (currentViewport, accumulatedDeltaY, anchor) => {
  const ratio = Math.exp(-accumulatedDeltaY * WHEEL_SCALE_SENSITIVITY);
  return getCanvasViewportAtAnchor(
    currentViewport,
    currentViewport.scale * ratio,
    anchor
  );
};

const lerp = (from, to, amount) => from + (to - from) * amount;

export const dampCanvasViewport = (
  currentViewport,
  targetViewport,
  deltaMs,
  anchor,
  smoothingMs = DEFAULT_VIEWPORT_SMOOTHING_MS
) => {
  const safeDeltaMs = Math.max(0, Number.isFinite(deltaMs) ? deltaMs : 0);
  const safeSmoothingMs = Math.max(1, Number.isFinite(smoothingMs) ? smoothingMs : DEFAULT_VIEWPORT_SMOOTHING_MS);
  const alpha = 1 - Math.exp(-safeDeltaMs / safeSmoothingMs);
  const scale = lerp(currentViewport.scale, targetViewport.scale, alpha);

  if (anchor && targetViewport.scale > 0) {
    const currentWorldX = (anchor.x - currentViewport.x) / currentViewport.scale;
    const currentWorldY = (anchor.y - currentViewport.y) / currentViewport.scale;
    const targetWorldX = (anchor.x - targetViewport.x) / targetViewport.scale;
    const targetWorldY = (anchor.y - targetViewport.y) / targetViewport.scale;
    const worldX = lerp(currentWorldX, targetWorldX, alpha);
    const worldY = lerp(currentWorldY, targetWorldY, alpha);
    return {
      scale,
      x: anchor.x - worldX * scale,
      y: anchor.y - worldY * scale,
    };
  }

  return {
    x: lerp(currentViewport.x, targetViewport.x, alpha),
    y: lerp(currentViewport.y, targetViewport.y, alpha),
    scale,
  };
};

export const isCanvasViewportSettled = (currentViewport, targetViewport, epsilon = VIEWPORT_SETTLE_EPSILON) => (
  Math.abs(currentViewport.x - targetViewport.x) <= epsilon &&
  Math.abs(currentViewport.y - targetViewport.y) <= epsilon &&
  Math.abs(currentViewport.scale - targetViewport.scale) <= epsilon
);

export const getCanvasPanTargetViewport = (
  startViewport,
  startPointer,
  currentPointer,
  outputViewport = { ...startViewport }
) => {
  outputViewport.x = startViewport.x + currentPointer.x - startPointer.x;
  outputViewport.y = startViewport.y + currentPointer.y - startPointer.y;
  outputViewport.scale = startViewport.scale;
  return outputViewport;
};

export const dampCanvasPanViewport = (
  currentViewport,
  targetViewport,
  deltaMs,
  smoothingMs = DEFAULT_PAN_SMOOTHING_MS,
  outputViewport = { ...currentViewport },
  maxVisualLagPx = DEFAULT_PAN_MAX_VISUAL_LAG_PX
) => {
  const safeDeltaMs = Math.min(
    Math.max(Number.isFinite(deltaMs) ? deltaMs : 0, 0),
    MAX_PAN_FRAME_DELTA_MS
  );
  const safeSmoothingMs = Math.max(
    1,
    Number.isFinite(smoothingMs) ? smoothingMs : DEFAULT_PAN_SMOOTHING_MS
  );
  const currentX = currentViewport.x;
  const currentY = currentViewport.y;
  const currentScale = currentViewport.scale;
  const deltaX = targetViewport.x - currentX;
  const deltaY = targetViewport.y - currentY;
  const error = Math.hypot(deltaX, deltaY);
  const safeMaxVisualLagPx = Math.max(
    0,
    Number.isFinite(maxVisualLagPx) ? maxVisualLagPx : DEFAULT_PAN_MAX_VISUAL_LAG_PX
  );
  const baseAlpha = 1 - Math.exp(-safeDeltaMs / safeSmoothingMs);
  const lagCapAlpha = error > safeMaxVisualLagPx && error > 0
    ? 1 - safeMaxVisualLagPx / error
    : 0;
  const alpha = Math.max(baseAlpha, lagCapAlpha);
  outputViewport.x = lerp(currentX, targetViewport.x, alpha);
  outputViewport.y = lerp(currentY, targetViewport.y, alpha);
  outputViewport.scale = currentScale;
  return outputViewport;
};

export const isCanvasPanSettled = (
  currentViewport,
  targetViewport,
  epsilon = PAN_SETTLE_EPSILON_PX
) => (
  Math.abs(currentViewport.x - targetViewport.x) <= epsilon &&
  Math.abs(currentViewport.y - targetViewport.y) <= epsilon
);

export const getCanvasSceneTransform = (renderedViewport, visualViewport) => {
  const scale = visualViewport.scale / renderedViewport.scale;
  return {
    scale,
    x: visualViewport.x - renderedViewport.x * scale,
    y: visualViewport.y - renderedViewport.y * scale,
  };
};
