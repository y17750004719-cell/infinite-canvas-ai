export interface LatestFrameBatcher {
  schedule: () => void;
  flushNow: () => void;
  cancel: () => void;
}

export function createLatestFrameBatcher(options: {
  requestFrame: (callback: FrameRequestCallback) => number;
  cancelFrame: (frameId: number) => void;
  flush: () => void;
}): LatestFrameBatcher;
