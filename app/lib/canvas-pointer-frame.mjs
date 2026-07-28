export const createLatestFrameBatcher = ({ requestFrame, cancelFrame, flush }) => {
  let frameId = null;

  const run = () => {
    frameId = null;
    flush();
  };

  return {
    schedule() {
      if (frameId !== null) return;
      frameId = requestFrame(run);
    },
    flushNow() {
      if (frameId !== null) {
        cancelFrame(frameId);
        frameId = null;
      }
      flush();
    },
    cancel() {
      if (frameId === null) return;
      cancelFrame(frameId);
      frameId = null;
    },
  };
};
