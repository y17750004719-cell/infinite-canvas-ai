import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const pageSource = fs.readFileSync(fileURLToPath(new URL('./page.tsx', import.meta.url)), 'utf8');
const controllerSource = fs.readFileSync(
  fileURLToPath(new URL('./hooks/useCanvasInteractionController.ts', import.meta.url)),
  'utf8'
);
const directSource = fs.readFileSync(
  fileURLToPath(new URL('./lib/canvas-direct-interaction.mjs', import.meta.url)),
  'utf8'
);

const sourceBetween = (source, start, end) => source.slice(
  source.indexOf(start),
  source.indexOf(end, source.indexOf(start))
);

test('managed pointer input is delivered directly without a continuous ticker', () => {
  const moveSource = sourceBetween(
    controllerSource,
    'function handleNativePointerMove',
    'function handleNativePointerUp'
  );
  assert.equal(moveSource.includes('deliverPointerFrame(session);'), true);
  assert.equal(controllerSource.includes('continuousFrame'), false);
  assert.equal(controllerSource.includes('gsap.ticker.add(flushPointerFrame)'), false);
  assert.equal(controllerSource.includes('requestAnimationFrame(flushPointerFrame)'), false);
  assert.equal(controllerSource.includes('requestAnimationFrame(sample)'), false);
  assert.equal(controllerSource.includes("from 'gsap'"), false);
  assert.equal(controllerSource.includes("from '@gsap/react'"), false);
  assert.equal(controllerSource.includes('useGSAP('), false);
});

test('pan follows the pointer directly and does not damp or settle', () => {
  const panSource = sourceBetween(
    pageSource,
    'const beginCanvasPan = useCallback',
    'const beginCanvasMarquee ='
  );
  assert.equal(panSource.includes('applyDirectPan('), true);
  assert.equal(panSource.includes('previewCanvasPanMotion(activeMotion);'), true);
  assert.equal(pageSource.includes('dampCanvasPanViewport('), false);
  assert.equal(pageSource.includes('panSettleTweenRef'), false);
  assert.equal(pageSource.includes('gsap.ticker.add(flushCanvasPanFrame)'), false);
});

test('cancelled pan restores its starting viewport instead of committing partial motion', () => {
  const cancelPanSource = sourceBetween(
    pageSource,
    'const cancelActiveCanvasPan = useCallback',
    'const completeActiveCanvasPan = useCallback'
  );
  assert.equal(cancelPanSource.includes('const startViewport = motion?.startViewport'), true);
  assert.equal(cancelPanSource.includes('previewCanvasViewport(startViewport);'), true);
  assert.equal(cancelPanSource.includes("reason !== 'escape'"), false);
  assert.equal(cancelPanSource.includes('stageCanvasPanViewportCommit({ ...visualViewportRef.current }'), false);
});

test('wheel zoom applies the Infinite-Canvas step immediately', () => {
  const wheelSource = sourceBetween(
    pageSource,
    'const handleNativeCanvasWheel = useCallback',
    'const handleConnectionPointerDown = useCallback'
  );
  assert.equal(wheelSource.includes('applyDirectZoom('), true);
  assert.equal(wheelSource.includes('previewCanvasViewport(nextViewport);'), true);
  assert.equal(wheelSource.includes('if (hasActivePointerSession()) return;'), true);
  assert.equal(wheelSource.includes('stageCanvasCommit({ viewport: nextViewport'), true);
  assert.equal(wheelSource.includes('gsap.to('), false);
  assert.equal(pageSource.includes('gsap.ticker.add(flushCanvasWheelFrame)'), false);
  assert.equal(pageSource.includes('dampCanvasViewport('), false);
  assert.equal(directSource.includes('zoomInFactor = 1.08'), true);
  assert.equal(directSource.includes('zoomOutFactor = 0.92'), true);
});

test('item dragging mutates registered DOM shells and only affected connection paths', () => {
  const dragSource = sourceBetween(
    pageSource,
    'const prepareCanvasItemDragPreview = useCallback',
    'const stageCanvasPanViewportCommit = useCallback'
  );
  const pendingDragSource = sourceBetween(
    pageSource,
    'const beginPendingItemDrag = React.useCallback',
    'const beginDraggingSelectedItems = React.useCallback'
  );
  const dragMoveSource = sourceBetween(
    pageSource,
    'const previewCanvasItemDrag = useCallback',
    'const commitCanvasItemDragPreviewToBase = useCallback'
  );
  const completeSource = sourceBetween(
    pageSource,
    'const completeActiveItemDrag = useCallback',
    'const stageCanvasPanViewportCommit = useCallback'
  );
  assert.equal(dragSource.includes('target.target.setPosition(deltaX, deltaY);'), true);
  assert.equal(dragSource.includes('connection.paths.forEach((element) => element.setAttribute(\'d\', path))'), true);
  assert.equal(pendingDragSource.includes('const overlayVisibility = hideCanvasSelectionOverlayGroups();'), true);
  assert.equal(pendingDragSource.includes('syncSelectedCanvasOverlayPositions('), false);
  assert.equal(dragMoveSource.includes('itemByIdRef.current.set('), false);
  assert.equal(pageSource.includes('interface DirectItemDragSession'), true);
  assert.equal(pageSource.includes('type CanvasConnectionRuntimeIndex'), true);
  assert.equal(completeSource.includes('commitCanvasItemDragPreviewToBase(finalPositions);'), true);
  assert.equal(completeSource.includes('setItemsState('), false);
  assert.equal(pageSource.includes('canvasItemVisualHandoffsRef'), false);
  assert.equal(pageSource.includes('pendingCanvasItemDragPreviewsRef'), false);
  assert.equal(pageSource.includes('restoreCanvasItemDragVisualOwnership'), false);
});

test('item resize writes width and height directly with no resize ticker', () => {
  const resizeSource = sourceBetween(
    pageSource,
    'const handleCornerResizePointerDown = useCallback',
    'useEffect(() => {\n    if (isHydratingSessionRef.current)'
  );
  const resizeMoveSource = sourceBetween(
    resizeSource,
    'onFrame: (pointerX, pointerY) => {',
    'onEnd: () => {'
  );
  const resizeCancelSource = sourceBetween(
    resizeSource,
    'onCancel: () => {',
    '      });\n    },'
  );
  assert.equal(controllerSource.includes("| 'item-resize'"), true);
  assert.equal(resizeSource.includes("mode: 'item-resize'"), true);
  assert.equal(resizeSource.includes('applyDirectItemResize({'), true);
  assert.equal(resizeMoveSource.includes("target.element.style.width = `${nextSize.width}px`"), true);
  assert.equal(resizeMoveSource.includes("target.element.style.height = `${nextSize.height}px`"), true);
  assert.equal(resizeMoveSource.includes('scheduleAffectedConnectionFrame();'), true);
  assert.equal(resizeMoveSource.includes('refreshDirectItemConnectionPaths('), false);
  assert.equal(resizeMoveSource.includes('syncSelectedCanvasOverlayPositions('), false);
  assert.equal(resizeMoveSource.includes('itemByIdRef.current.set('), false);
  assert.equal(resizeSource.includes('const overlayVisibility = hideCanvasSelectionOverlayGroups();'), true);
  assert.equal(resizeSource.includes('applyCanvasSelection('), false);
  assert.equal(resizeSource.includes('requestAnimationFrame(() => {'), true);
  assert.equal(resizeSource.includes('syncSelectedCanvasOverlayPositions(visualViewportRef.current, [liveItem.id]);'), true);
  assert.equal(resizeSource.includes('restoreCanvasOverlayVisibility(preview.overlayVisibility);'), true);
  assert.equal(resizeCancelSource.includes("target.element.style.width = `${preview.startWidth}px`"), true);
  assert.equal(resizeCancelSource.includes('restoreCanvasSelectionGestureRef.current();'), true);
  assert.equal(resizeCancelSource.includes('commitCornerResizePreview();'), false);
  assert.equal(pageSource.includes('flushCornerResizeFrame'), false);
  assert.equal(pageSource.includes('scheduleCornerResizeFrame'), false);
  assert.equal(pageSource.includes('cornerResizeFrameRef'), false);
});

test('marquee stays imperative while moving and resolves DOM bounds once on release', () => {
  const marqueeSource = sourceBetween(
    pageSource,
    'const beginCanvasMarquee =',
    'const handleCanvasPointerDown ='
  );
  assert.equal(marqueeSource.includes("mode: 'marquee'"), true);
  assert.equal(marqueeSource.includes("marqueePathRef.current?.setAttribute('d'"), true);
  assert.equal(marqueeSource.includes('getBoundingClientRect()'), true);
  assert.equal(marqueeSource.includes('resolveDirectMarqueeSelection({'), true);
  assert.equal(marqueeSource.includes('commitCanvasSelectionUI({'), true);
  assert.equal(marqueeSource.includes('setItemsState('), false);
});

test('unselected item drag previews selection without mounting React overlays on pointerdown', () => {
  const selectionSource = sourceBetween(
    pageSource,
    'const restoreCanvasSelectionGesture = useCallback',
    'const handleItemClick = useCallback'
  );
  const pointerDownSource = sourceBetween(
    pageSource,
    'const handleItemPointerDown = useCallback',
    'const handleCornerResizePointerDown = useCallback'
  );
  const selectionPointerDownSource = sourceBetween(
    pointerDownSource,
    'const activeSelectedIds = selectedIdsRef.current;',
    'e.preventDefault();'
  );

  assert.equal(pageSource.includes('interface PendingCanvasSelectionGesture'), true);
  assert.equal(selectionSource.includes('const previewCanvasSelectionDom = useCallback'), true);
  assert.equal(selectionSource.includes('selectedIdsRef.current = gesture.itemIds;'), true);
  assert.equal(selectionSource.includes('syncCanvasSelectionDom(gesture.itemIds);'), true);
  assert.equal(selectionSource.includes('querySelector<HTMLElement>'), false);
  assert.equal(selectionPointerDownSource.includes('previewCanvasSelectionDom([itemId]);'), true);
  assert.equal(selectionPointerDownSource.includes('applyCanvasSelection('), false);
  assert.equal(selectionPointerDownSource.includes('setSelected'), false);
  assert.equal(selectionPointerDownSource.includes('moveCanvasItemsToFront('), false);
  assert.equal(selectionPointerDownSource.includes('getBoundingClientRect('), false);
  assert.equal(selectionPointerDownSource.includes('flushPendingCanvasCommit('), false);
  assert.equal(selectionPointerDownSource.includes('setItemsState('), false);
});

test('pending item selection finalizes after release and restores on cancellation', () => {
  const pendingDragSource = sourceBetween(
    pageSource,
    'const beginPendingItemDrag = React.useCallback',
    'const beginDraggingSelectedItems = React.useCallback'
  );
  const completeSource = sourceBetween(
    pageSource,
    'const completeActiveItemDrag = useCallback',
    'const stageCanvasPanViewportCommit = useCallback'
  );
  const cancelSource = sourceBetween(
    pageSource,
    'const cancelActiveItemDrag = useCallback',
    'const suppressCanvasItemClickAfterDrag = useCallback'
  );

  assert.equal(pendingDragSource.includes("reason: 'click'"), true);
  assert.equal(pendingDragSource.includes('pendingSelection.activated = true;'), true);
  assert.equal(pendingDragSource.includes('pendingSelection.firstDragVisualAt = performance.now();'), true);
  assert.ok(
    completeSource.indexOf('isDraggingRef.current = false;') <
      completeSource.indexOf('finalizeCanvasSelectionGestureRef.current(finalizedSelection);')
  );
  assert.equal(cancelSource.includes('restoreCanvasSelectionGestureRef.current();'), true);
  assert.equal(pageSource.includes('selectionReactCommitDuringInteractionCount:'), true);
  assert.equal(pageSource.includes('releaseToToolbarFirstFrame:'), true);
});

test('item pointerdown does not synchronously build drag or connection plans', () => {
  const pendingDragSource = sourceBetween(
    pageSource,
    'const beginPendingItemDrag = React.useCallback',
    'const beginDraggingSelectedItems = React.useCallback'
  );
  const hoverSource = sourceBetween(
    pageSource,
    'const handleItemMouseEnter = useCallback',
    'const handleItemMouseLeave = useCallback'
  );
  const connectionPreparationSource = sourceBetween(
    pageSource,
    'const scheduleCanvasItemDragConnectionPreparation = useCallback',
    'const scheduleAffectedConnectionFrame = useCallback'
  );

  assert.equal(pendingDragSource.includes('prewarmCanvasItemDragPlan('), false);
  assert.equal(pendingDragSource.includes('prewarmItemTargets('), false);
  assert.equal(hoverSource.includes('prewarmCanvasItemDragPlan('), false);
  assert.equal(connectionPreparationSource.match(/requestAnimationFrame\(/g)?.length, 1);
  assert.equal(connectionPreparationSource.includes('buildCanvasItemDragPlan(itemIds)'), true);
  assert.equal(pendingDragSource.includes('previewCanvasItemDrag(delta.x, delta.y);'), true);
  assert.ok(
    pendingDragSource.indexOf('previewCanvasItemDrag(delta.x, delta.y);') <
      pendingDragSource.indexOf('scheduleCanvasItemDragConnectionPreparation(itemIds, activeItemDragTokenRef.current!);')
  );
});

test('canvas node rendering reuses cached item elements for unchanged item references', () => {
  const nodeContentSource = sourceBetween(
    pageSource,
    'const CanvasNodesContent = memo',
    'type CanvasNodesContentProps ='
  );

  assert.equal(nodeContentSource.includes('const itemRenderCacheRef = useRef(new Map'), true);
  assert.equal(nodeContentSource.includes('if (cached?.item === item) return cached.element;'), true);
  assert.equal(nodeContentSource.includes('itemRenderCacheRef.current.set(item.id, { item, element });'), true);
});

test('selected overlay groups follow live geometry through transform-only writes', () => {
  const overlaySource = sourceBetween(
    pageSource,
    'const getCanvasItemOverlayGroup = useCallback',
    'const buildConnectionPath = useCallback'
  );

  assert.equal(pageSource.includes('interface CanvasItemOverlayGroup'), true);
  assert.equal(overlaySource.includes("getCanvasItemOverlayGroup('selected-image-toolbar')"), true);
  assert.equal(overlaySource.includes("getCanvasItemOverlayGroup('selected-image-panel')"), true);
  assert.equal(overlaySource.includes("getCanvasItemOverlayGroup('selected-text-panel')"), true);
  assert.equal(overlaySource.includes('root.style.transform = `translate3d('), true);
  assert.equal(overlaySource.includes('getBoundingClientRect()'), false);
  assert.equal(overlaySource.includes('setSelectedId('), false);
  assert.equal(overlaySource.includes('setItemsState('), false);
});

test('overlay performance metrics cover first visual frame, position error, and React commits', () => {
  assert.equal(pageSource.includes("console.info('[canvas-overlay-perf]'"), true);
  assert.equal(pageSource.includes('pointerDownToFirstVisualFrame:'), true);
  assert.equal(pageSource.includes('itemToOverlayPositionErrorPx: 0,'), true);
  assert.equal(pageSource.includes('overlaySyncWriteCount:'), true);
  assert.equal(pageSource.includes('overlayReactCommitDuringInteractionCount:'), true);
});

test('canvas geometry snapshots use one 500ms debounce and preserve pending data across input', () => {
  const commitSource = sourceBetween(
    pageSource,
    'const isCanvasCommitBlocked = useCallback',
    'const markCanvasInteractionVisualFrame = useCallback'
  );
  assert.equal(pageSource.includes('CANVAS_SNAPSHOT_COMMIT_IDLE_MS = 500'), true);
  assert.equal(commitSource.includes('deadlineAt: stagedAt + CANVAS_SNAPSHOT_COMMIT_IDLE_MS'), true);
  assert.equal(commitSource.includes("window.requestIdleCallback(runIdleCommit, {"), true);
  assert.equal(commitSource.includes('timeout: 300,'), true);
  assert.equal(commitSource.includes('React.startTransition(commitReactSnapshot)'), true);
  assert.equal(commitSource.includes('hasPendingBrowserInput()'), true);
  const interruptSource = sourceBetween(
    commitSource,
    'const interruptCanvasCommitForInteraction = useCallback',
    'const stageCanvasCommit = useCallback'
  );
  assert.equal(interruptSource.includes('cancelPendingCanvasCommitSchedule()'), true);
  assert.equal(interruptSource.includes('pendingCanvasCommitRef.current = null;'), false);
  assert.equal(commitSource.includes('pendingCanvasCommitRef.current = null;'), true);
  assert.equal(commitSource.includes('const accumulator = pendingCanvasCommitRef.current ?? {'), true);
  assert.equal(pageSource.includes('createCanvasCommitCoordinator'), false);
});

test('affected connection updates are merged into one animation frame', () => {
  const connectionFrameSource = sourceBetween(
    pageSource,
    'const cancelCanvasItemDragConnectionFrame = useCallback',
    'const prepareCanvasItemDragPreview = useCallback'
  );
  assert.equal(connectionFrameSource.includes('const scheduleAffectedConnectionFrame = useCallback'), true);
  assert.equal(connectionFrameSource.includes('requestAnimationFrame(() => {'), true);
  assert.equal(connectionFrameSource.includes('flushCanvasItemDragConnectionFrame();'), true);
});

test('one canvas world owns viewport transforms and screen overlays stay outside it', () => {
  const connectionsSource = sourceBetween(
    pageSource,
    'const CanvasConnectionsLayer = memo',
    'const CanvasConnectionPreviewLayer = memo'
  );
  const portsSource = sourceBetween(
    pageSource,
    'const CanvasPortsLayer = memo',
    'const CanvasNodesContent = memo'
  );
  const nodesSource = sourceBetween(
    pageSource,
    'const CanvasNodesLayer = memo',
    'const CanvasAnnotationsContent = memo'
  );
  const viewportPreviewSource = sourceBetween(
    pageSource,
    'const previewCanvasViewport = useCallback',
    'const previewCanvasPanMotion = useCallback'
  );
  const worldIndex = pageSource.indexOf('data-canvas-world="true"');
  const screenOverlayIndex = pageSource.indexOf('data-canvas-screen-overlay="true"');
  const marqueeIndex = pageSource.indexOf('ref={marqueeElementRef}');

  assert.notEqual(worldIndex, -1);
  assert.ok(worldIndex < screenOverlayIndex);
  assert.ok(screenOverlayIndex < marqueeIndex);
  assert.equal(viewportPreviewSource.includes('sceneTarget.setViewportTransform('), true);
  assert.equal(connectionsSource.includes('viewport:'), false);
  assert.equal(portsSource.includes('viewport:'), false);
  assert.equal(nodesSource.includes('viewport:'), false);
  assert.equal(pageSource.includes('getCanvasSceneTransform'), false);
});

test('canvas interaction does not retain scene or item prewarm timers', () => {
  assert.equal(pageSource.includes('prewarmCanvasScene'), false);
  assert.equal(pageSource.includes('scheduleClearItemPrewarm'), false);
  assert.equal(controllerSource.includes('prewarmClearTimersRef'), false);
  assert.equal(controllerSource.includes('layerPrewarmed'), false);
  assert.equal(controllerSource.includes('scenePrewarmLeadMs'), false);
});

test('canvas overlays and the canvas subtree are excluded from global GSAP motion', () => {
  const motionSource = fs.readFileSync(
    fileURLToPath(new URL('./components/GsapMotionController.tsx', import.meta.url)),
    'utf8'
  );
  assert.equal(motionSource.includes("'[data-canvas=\"true\"],[data-canvas-overlay-root=\"true\"]'"), true);
  assert.equal(pageSource.includes('data-canvas-overlay-root="true"'), true);
});

test('session boundaries flush the latest live canvas snapshot', () => {
  const boundarySource = sourceBetween(
    pageSource,
    'useEffect(() => {\n    const flushCanvasSessionBoundary',
    'const beginPendingItemDrag = React.useCallback'
  );
  assert.equal(boundarySource.includes("flushPendingCanvasCommit(reason);"), true);
  assert.equal(boundarySource.includes("window.addEventListener('blur'"), true);
  assert.equal(boundarySource.includes("window.addEventListener('pagehide'"), true);
  assert.equal(boundarySource.includes("document.addEventListener('visibilitychange'"), true);
});
