/**
 * Owns request response finalization ordering.
 *
 * The lifecycle deliberately accepts callbacks so it cannot reach into the
 * journal, stream controller or active-run registry itself.  Callers provide
 * the already-composed stream sink and run settlement operations.
 */
export function createAgentResponseLifecycle({ flush, settle, close, onError } = {}) {
  let finalized = false;

  return {
    async finalize() {
      if (finalized) return { finalized: false };
      finalized = true;
      let flushError = null;
      try {
        await flush?.();
      } catch (error) {
        flushError = error;
        onError?.(error, 'flush');
      } finally {
        try {
          settle?.();
        } finally {
          try {
            close?.();
          } catch (error) {
            onError?.(error, 'close');
          }
        }
      }
      return { finalized: true, ...(flushError ? { flushError } : {}) };
    },
  };
}

