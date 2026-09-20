const MIN_CANVAS_SCALE = 0.1;
const MAX_CANVAS_SCALE = 10;
const MAX_WHEEL_DELTA_PX = 120;

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
