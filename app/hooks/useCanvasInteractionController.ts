'use client';

import { useCallback, useEffect, useRef } from 'react';
import type React from 'react';

import { shouldCancelCanvasPointerSessionOnLostCapture } from '../lib/canvas-interaction.mjs';

export type CanvasInteractionMode = 'pending-item-drag' | 'canvas-pan' | 'item-drag' | 'item-resize' | 'connection-drag' | 'marquee';
export type CanvasInteractionCancelReason =
  | 'escape'
  | 'pointer-cancel'
  | 'lost-pointer-capture'
  | 'window-blur'
  | 'viewport-handoff'
  | 'replaced'
  | 'unmount';

export interface CanvasInteractionPoint {
  x: number;
  y: number;
}

export interface CanvasRegisteredTarget {
  itemId: string | null;
  role: string;
  element: HTMLElement;
  setX: (value: number) => void;
  setY: (value: number) => void;
  setPosition: (x: number, y: number) => void;
  setScale: (value: number) => void;
  setScaleX: (value: number) => void;
  setScaleY: (value: number) => void;
  setViewportTransform: (x: number, y: number, scale: number) => void;
  initialWillChange: string;
}

interface PointerSession {
  mode: CanvasInteractionMode;
  pointerId: number;
  latestX: number;
  latestY: number;
  dirty: boolean;
  startedAt: number;
  firstFrameAt: number | null;
  firstInputAt: number | null;
  firstFrameScheduledAt: number | null;
  firstFrameWork: number;
  lastFrameAt: number | null;
  frameCount: number;
  slowFrameCount: number;
  longestFrame: number;
  longestWork: number;
  frameGaps: number[];
  frameWorks: number[];
  longTaskCount: number;
  longestLongTask: number;
  frameBudget: number;
  performanceEnabled: boolean;
  frameSampleCursor: number;
  onFrame: (x: number, y: number, deltaTime: number, hasInput: boolean) => void;
  onRelease?: (x: number, y: number) => void;
  onEnd: (x: number, y: number) => void;
  onCancel: (reason: CanvasInteractionCancelReason) => void;
}

interface StartPointerSessionOptions {
  mode: CanvasInteractionMode;
  pointerId: number;
  startPoint: CanvasInteractionPoint;
  onFrame: (x: number, y: number, deltaTime: number, hasInput: boolean) => void;
  onRelease?: (x: number, y: number) => void;
  onEnd: (x: number, y: number) => void;
  onCancel: (reason: CanvasInteractionCancelReason) => void;
}

const DEFAULT_FRAME_BUDGET_MS = 1000 / 60;
const PERFORMANCE_SAMPLE_LIMIT = 240;
const PERFORMANCE_STORAGE_KEY = 'zo:canvas-perf';

export const isCanvasPerformanceEnabled = () => {
  if (process.env.NODE_ENV === 'production' || typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(PERFORMANCE_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
};

export function useCanvasInteractionController(
  canvasRef: React.RefObject<HTMLDivElement | null>
) {
  const itemTargetsRef = useRef(new Map<string, Map<string, CanvasRegisteredTarget>>());
  const itemTargetCallbacksRef = useRef(
    new Map<string, (element: HTMLElement | null) => void>()
  );
  const connectionPathsRef = useRef(new Map<string, Map<string, SVGPathElement>>());
  const connectionPathCallbacksRef = useRef(
    new Map<string, (element: SVGPathElement | null) => void>()
  );
  const overlaysRef = useRef(new Map<string, HTMLElement>());
  const overlayCallbacksRef = useRef(
    new Map<string, (element: HTMLElement | null) => void>()
  );
  const selectionGroupTargetRef = useRef<CanvasRegisteredTarget | null>(null);
  const sceneTargetRef = useRef<CanvasRegisteredTarget | null>(null);
  const pointerSessionRef = useRef<PointerSession | null>(null);
  const pendingLayoutMeasureRef = useRef<{ mode: CanvasInteractionMode; releasedAt: number } | null>(null);
  const recentlyManagedPointerIdRef = useRef<number | null>(null);
  const hoveredItemIdRef = useRef<string | null>(null);
  const performanceObserverRef = useRef<PerformanceObserver | null>(null);

  const createRegisteredTarget = useCallback((
    element: HTMLElement,
    role: string,
    itemId: string | null = null
  ): CanvasRegisteredTarget => {
    let translateX = 0;
    let translateY = 0;
    let scaleX = 1;
    let scaleY = 1;
    const noop = (_value: number) => {};
    const isScene = role === 'scene';
    const writeTranslate = () => {
      element.style.translate = `${translateX}px ${translateY}px`;
    };
    const writeScale = () => {
      element.style.scale = `${scaleX} ${scaleY}`;
    };
    const setX = isScene ? noop : (value: number) => {
      translateX = value;
      writeTranslate();
    };
    const setY = isScene ? noop : (value: number) => {
      translateY = value;
      writeTranslate();
    };
    const setScaleX = isScene ? noop : (value: number) => {
      scaleX = value;
      writeScale();
    };
    const setScaleY = isScene ? noop : (value: number) => {
      scaleY = value;
      writeScale();
    };
    const setPosition = isScene
      ? (_x: number, _y: number) => {}
      : (x: number, y: number) => {
          translateX = x;
          translateY = y;
          writeTranslate();
        };
    const setTransform = isScene
      ? (value: string) => {
          element.style.transform = value;
        }
      : null;

    return {
      itemId,
      role,
      element,
      setX,
      setY,
      setPosition,
      setScale: noop,
      setScaleX,
      setScaleY,
      setViewportTransform: setTransform
        ? (x: number, y: number, scale: number) => {
            setTransform(`translate(${x}px, ${y}px) scale(${scale})`);
          }
        : (x: number, y: number, scale: number) => {
            setX(x);
            setY(y);
            setScaleX(scale);
            setScaleY(scale);
          },
      initialWillChange: element.style.willChange,
    };
  }, []);

  const registerScene = useCallback((element: HTMLDivElement | null) => {
    sceneTargetRef.current = element ? createRegisteredTarget(element, 'scene') : null;
  }, [createRegisteredTarget]);

  const getItemTargetRef = useCallback((itemId: string, role: string) => {
    const callbackKey = `${itemId}\u0000${role}`;
    const existing = itemTargetCallbacksRef.current.get(callbackKey);
    if (existing) return existing;

    const callback = (element: HTMLElement | null) => {
      const targets = itemTargetsRef.current.get(itemId) ?? new Map<string, CanvasRegisteredTarget>();
      if (element) {
        targets.set(role, createRegisteredTarget(element, role, itemId));
        itemTargetsRef.current.set(itemId, targets);
        return;
      }
      targets.delete(role);
      if (targets.size === 0) itemTargetsRef.current.delete(itemId);
    };
    itemTargetCallbacksRef.current.set(callbackKey, callback);
    return callback;
  }, [createRegisteredTarget]);

  const getSelectionGroupRef = useCallback((element: HTMLDivElement | null) => {
    selectionGroupTargetRef.current = element ? createRegisteredTarget(element, 'selection-group') : null;
  }, [createRegisteredTarget]);

  const getConnectionPathRef = useCallback((connectionId: string, role: string) => {
    const callbackKey = `${connectionId}\u0000${role}`;
    const existing = connectionPathCallbacksRef.current.get(callbackKey);
    if (existing) return existing;

    const callback = (element: SVGPathElement | null) => {
      const paths = connectionPathsRef.current.get(connectionId) ?? new Map<string, SVGPathElement>();
      if (element) {
        paths.set(role, element);
        connectionPathsRef.current.set(connectionId, paths);
        return;
      }
      paths.delete(role);
      if (paths.size === 0) connectionPathsRef.current.delete(connectionId);
    };
    connectionPathCallbacksRef.current.set(callbackKey, callback);
    return callback;
  }, []);

  const getViewportOverlayRef = useCallback((key: string) => {
    const existing = overlayCallbacksRef.current.get(key);
    if (existing) return existing;

    const callback = (element: HTMLElement | null) => {
      if (element) overlaysRef.current.set(key, element);
      else overlaysRef.current.delete(key);
    };
    overlayCallbacksRef.current.set(key, callback);
    return callback;
  }, []);

  const getItemTargets = useCallback((itemIds: readonly string[], includeSelectionGroup = false) => {
    const targets: CanvasRegisteredTarget[] = [];
    for (const itemId of itemIds) {
      const itemTargets = itemTargetsRef.current.get(itemId);
      if (!itemTargets) continue;
      for (const target of itemTargets.values()) targets.push(target);
    }
    if (includeSelectionGroup && selectionGroupTargetRef.current) {
      targets.push(selectionGroupTargetRef.current);
    }
    return targets;
  }, []);

  const getConnectionPaths = useCallback((
    connectionIds: readonly string[],
    roles?: readonly string[]
  ) => {
    const paths = new Map<string, SVGPathElement[]>();
    const roleSet = roles ? new Set(roles) : null;
    for (const connectionId of connectionIds) {
      const registered = connectionPathsRef.current.get(connectionId);
      if (!registered) continue;
      const resolved = roleSet
        ? Array.from(registered.entries())
            .filter(([role]) => roleSet.has(role))
            .map(([, element]) => element)
        : Array.from(registered.values());
      if (resolved.length > 0) paths.set(connectionId, resolved);
    }
    return paths;
  }, []);

  const getViewportOverlays = useCallback(() => Array.from(overlaysRef.current.values()), []);
  const getViewportOverlay = useCallback((key: string) => overlaysRef.current.get(key) ?? null, []);
  const getSceneTarget = useCallback(() => sceneTargetRef.current, []);

  const clearPortHoverStyles = useCallback((itemId: string) => {
    const targets = itemTargetsRef.current.get(itemId);
    if (!targets) return;
    const elements = [targets.get('input-port')?.element, targets.get('output-port')?.element]
      .filter((element): element is HTMLElement => Boolean(element));
    elements.forEach((element) => {
      element.style.opacity = '0';
      element.style.visibility = 'hidden';
      element.style.pointerEvents = 'none';
    });
  }, []);

  const setHoveredItem = useCallback((itemId: string | null) => {
    const previousItemId = hoveredItemIdRef.current;
    if (previousItemId === itemId) return;
    if (previousItemId) {
      clearPortHoverStyles(previousItemId);
    }
    hoveredItemIdRef.current = itemId;
    if (!itemId) return;
    const targets = itemTargetsRef.current.get(itemId);
    if (!targets) return;
    const inputPort = targets.get('input-port')?.element;
    const outputPort = targets.get('output-port')?.element;
    if (inputPort) {
      inputPort.style.visibility = 'visible';
      inputPort.style.opacity = '1';
    }
    if (outputPort) {
      outputPort.style.pointerEvents = 'auto';
      outputPort.style.visibility = 'visible';
      outputPort.style.opacity = '1';
    }
  }, [clearPortHoverStyles]);

  const removeNativeListeners = useCallback(() => {
    if (typeof window === 'undefined') return;
    window.removeEventListener('pointermove', handleNativePointerMove, true);
    window.removeEventListener('pointerup', handleNativePointerUp, true);
    window.removeEventListener('pointercancel', handleNativePointerCancel, true);
    window.removeEventListener('keydown', handleNativeKeyDown, true);
    window.removeEventListener('blur', handleNativeWindowBlur, true);
    canvasRef.current?.removeEventListener('lostpointercapture', handleLostPointerCapture, true);
  // The handlers are stable function declarations backed by refs.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canvasRef]);

  const reportPerformance = useCallback((session: PointerSession, endedAt: number) => {
    if (!session.performanceEnabled) return;
    const pressToFirstFrame = session.firstFrameAt === null
      ? null
      : session.firstFrameAt - session.startedAt;
    const releaseToLayoutMark = `canvas:${session.mode}:release:${Math.round(endedAt)}`;
    performance.mark(releaseToLayoutMark);
    console.info('[canvas-perf]', {
      mode: session.mode,
      pressToFirstFrame,
      interactionPreparationTime: session.firstFrameScheduledAt === null
        ? null
        : session.firstFrameScheduledAt - session.startedAt,
      animationScheduledToFirstFrame:
        session.firstFrameAt === null || session.firstFrameScheduledAt === null
          ? null
          : session.firstFrameAt - session.firstFrameScheduledAt,
      firstFrameWork: session.firstFrameWork,
      frameCount: session.frameCount,
      slowFrameCount: session.slowFrameCount,
      droppedFrameRatio: session.frameCount > 0 ? session.slowFrameCount / session.frameCount : 0,
      longestFrame: session.longestFrame,
      longestWork: session.longestWork,
      frameGapP95: session.frameGaps.length > 0
        ? [...session.frameGaps].sort((a, b) => a - b)[Math.floor(session.frameGaps.length * 0.95)]
        : 0,
      frameWorkP95: session.frameWorks.length > 0
        ? [...session.frameWorks].sort((a, b) => a - b)[Math.floor(session.frameWorks.length * 0.95)]
        : 0,
      longTaskCount: session.longTaskCount,
      longestLongTask: session.longestLongTask,
      displayRefreshRate: Math.round(1000 / session.frameBudget),
      frameBudget: session.frameBudget,
      firstInputToVisualFrame:
        session.firstInputAt === null || session.firstFrameAt === null
          ? null
          : session.firstFrameAt - session.firstInputAt,
      duration: endedAt - session.startedAt,
    });
  }, []);

  const stopPointerSession = useCallback((releaseCapture = true) => {
    const session = pointerSessionRef.current;
    if (!session) return null;
    pointerSessionRef.current = null;
    removeNativeListeners();
    performanceObserverRef.current?.disconnect();
    performanceObserverRef.current = null;
    recentlyManagedPointerIdRef.current = session.pointerId;
    queueMicrotask(() => {
      if (recentlyManagedPointerIdRef.current === session.pointerId) {
        recentlyManagedPointerIdRef.current = null;
      }
    });
    const canvas = canvasRef.current;
    if (releaseCapture && canvas?.hasPointerCapture(session.pointerId)) {
      try {
        canvas.releasePointerCapture(session.pointerId);
      } catch {}
    }
    const releasedAt = session.performanceEnabled ? performance.now() : 0;
    if (session.performanceEnabled) {
      pendingLayoutMeasureRef.current = { mode: session.mode, releasedAt };
    }
    reportPerformance(session, releasedAt);
    return session;
  }, [canvasRef, removeNativeListeners, reportPerformance]);

  function deliverPointerFrame(session: PointerSession, hasInput = true) {
    if (session.performanceEnabled && session.firstFrameScheduledAt === null) {
      session.firstFrameScheduledAt = performance.now();
    }
    session.dirty = false;
    if (!session.performanceEnabled) {
      session.onFrame(session.latestX, session.latestY, 0, hasInput);
      return;
    }
    const frameStartedAt = performance.now();
    if (session.firstFrameAt === null) session.firstFrameAt = frameStartedAt;
    if (session.lastFrameAt !== null) {
      const frameGap = frameStartedAt - session.lastFrameAt;
      session.longestFrame = Math.max(session.longestFrame, frameGap);
      if (frameGap > session.frameBudget * 1.5) session.slowFrameCount += 1;
      session.frameGaps[session.frameSampleCursor % PERFORMANCE_SAMPLE_LIMIT] = frameGap;
    }
    session.lastFrameAt = frameStartedAt;
    session.frameCount += 1;
    session.onFrame(session.latestX, session.latestY, 0, hasInput);
    const frameWork = performance.now() - frameStartedAt;
    session.frameWorks[session.frameSampleCursor % PERFORMANCE_SAMPLE_LIMIT] = frameWork;
    session.frameSampleCursor += 1;
    if (session.frameCount === 1) session.firstFrameWork = frameWork;
    session.longestWork = Math.max(session.longestWork, frameWork);
  }

  function handleNativePointerMove(event: PointerEvent) {
    const session = pointerSessionRef.current;
    if (!session || event.pointerId !== session.pointerId) return;
    event.stopPropagation();
    if (session.performanceEnabled && session.firstInputAt === null) {
      session.firstInputAt = performance.now();
    }
    const coalescedEvents = event.getCoalescedEvents?.();
    const latestEvent = coalescedEvents?.[coalescedEvents.length - 1] ?? event;
    session.latestX = latestEvent.clientX;
    session.latestY = latestEvent.clientY;
    session.dirty = true;
    deliverPointerFrame(session);
  }

  function handleNativePointerUp(event: PointerEvent) {
    const session = pointerSessionRef.current;
    if (!session || event.pointerId !== session.pointerId) return;
    event.stopPropagation();
    const coalescedEvents = event.getCoalescedEvents?.();
    const latestEvent = coalescedEvents?.[coalescedEvents.length - 1] ?? event;
    const hasUnprocessedInput =
      session.dirty ||
      latestEvent.clientX !== session.latestX ||
      latestEvent.clientY !== session.latestY;
    session.latestX = latestEvent.clientX;
    session.latestY = latestEvent.clientY;
    session.onRelease?.(session.latestX, session.latestY);
    if (hasUnprocessedInput) deliverPointerFrame(session);
    const stoppedSession = stopPointerSession();
    stoppedSession?.onEnd(stoppedSession.latestX, stoppedSession.latestY);
  }

  function cancelPointerSession(reason: CanvasInteractionCancelReason) {
    const stoppedSession = stopPointerSession();
    stoppedSession?.onCancel(reason);
  }

  function handleNativePointerCancel(event: PointerEvent) {
    const session = pointerSessionRef.current;
    if (!session || event.pointerId !== session.pointerId) return;
    cancelPointerSession('pointer-cancel');
  }

  function handleLostPointerCapture(event: Event) {
    const pointerEvent = event as PointerEvent;
    const session = pointerSessionRef.current;
    if (!session || !shouldCancelCanvasPointerSessionOnLostCapture({
      eventPointerId: pointerEvent.pointerId,
      sessionPointerId: session.pointerId,
      releasePending: false,
    })) return;
    cancelPointerSession('lost-pointer-capture');
  }

  function handleNativeKeyDown(event: KeyboardEvent) {
    if (event.key === 'Escape' && pointerSessionRef.current) {
      event.preventDefault();
      cancelPointerSession('escape');
    }
  }

  function handleNativeWindowBlur() {
    if (pointerSessionRef.current) cancelPointerSession('window-blur');
  }

  const startPointerSession = useCallback((options: StartPointerSessionOptions) => {
    if (pointerSessionRef.current) cancelPointerSession('replaced');
    const performanceEnabled = isCanvasPerformanceEnabled();
    const startedAt = performanceEnabled ? performance.now() : 0;
    if (performanceEnabled) performance.mark(`canvas:${options.mode}:press:${Math.round(startedAt)}`);
    pointerSessionRef.current = {
      ...options,
      latestX: options.startPoint.x,
      latestY: options.startPoint.y,
      dirty: false,
      startedAt,
      firstFrameAt: null,
      firstInputAt: null,
      firstFrameScheduledAt: null,
      firstFrameWork: 0,
      lastFrameAt: null,
      frameCount: 0,
      slowFrameCount: 0,
      longestFrame: 0,
      longestWork: 0,
      frameGaps: [],
      frameWorks: [],
      longTaskCount: 0,
      longestLongTask: 0,
      frameBudget: DEFAULT_FRAME_BUDGET_MS,
      performanceEnabled,
      frameSampleCursor: 0,
    };
    if (performanceEnabled && typeof PerformanceObserver !== 'undefined') {
      try {
        const observer = new PerformanceObserver((entries) => {
          const activeSession = pointerSessionRef.current;
          if (!activeSession || activeSession !== pointerSessionRef.current) return;
          entries.getEntries().forEach((entry) => {
            activeSession.longTaskCount += 1;
            activeSession.longestLongTask = Math.max(activeSession.longestLongTask, entry.duration);
          });
        });
        observer.observe({ entryTypes: ['longtask'] });
        performanceObserverRef.current = observer;
      } catch {}
    }

    window.addEventListener('pointermove', handleNativePointerMove, true);
    window.addEventListener('pointerup', handleNativePointerUp, true);
    window.addEventListener('pointercancel', handleNativePointerCancel, true);
    window.addEventListener('keydown', handleNativeKeyDown, true);
    window.addEventListener('blur', handleNativeWindowBlur, true);
    canvasRef.current?.addEventListener('lostpointercapture', handleLostPointerCapture, true);

    try {
      canvasRef.current?.setPointerCapture(options.pointerId);
    } catch {}
  // Native handlers are stable function declarations backed by refs.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canvasRef]);

  const isManagedPointer = useCallback((pointerId: number) => {
    return pointerSessionRef.current?.pointerId === pointerId || recentlyManagedPointerIdRef.current === pointerId;
  }, []);

  const hasActivePointerSession = useCallback(() => pointerSessionRef.current !== null, []);

  const setPointerSessionMode = useCallback((mode: CanvasInteractionMode) => {
    if (pointerSessionRef.current) pointerSessionRef.current.mode = mode;
  }, []);

  const cancelInteraction = useCallback((reason: CanvasInteractionCancelReason = 'replaced') => {
    cancelPointerSession(reason);
  // cancelPointerSession is a stable function declaration backed by refs.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const markLayoutCommitted = useCallback(() => {
    const pending = pendingLayoutMeasureRef.current;
    if (!pending) return;
    pendingLayoutMeasureRef.current = null;
    console.info('[canvas-perf-layout]', {
      mode: pending.mode,
      releaseToLayout: performance.now() - pending.releasedAt,
    });
  }, []);

  useEffect(() => () => {
    const stoppedSession = stopPointerSession(false);
    stoppedSession?.onCancel('unmount');
    itemTargetsRef.current.clear();
    connectionPathsRef.current.clear();
    overlaysRef.current.clear();
  }, [stopPointerSession]);

  return {
    registerScene,
    getItemTargetRef,
    getSelectionGroupRef,
    getConnectionPathRef,
    getViewportOverlayRef,
    getItemTargets,
    getConnectionPaths,
    getViewportOverlay,
    getViewportOverlays,
    getSceneTarget,
    setHoveredItem,
    startPointerSession,
    setPointerSessionMode,
    isManagedPointer,
    hasActivePointerSession,
    cancelInteraction,
    markLayoutCommitted,
  };
}
