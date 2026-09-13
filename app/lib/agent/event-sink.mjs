/**
 * Persist canonical events and mirror them to the live NDJSON stream. Journal
 * persistence is intentionally awaited before enqueueing so replay and live
 * traffic share exactly the same event ordering.
 */
/** @param {any} input */
export function createEventSink({ journal, streamController, encoder = new TextEncoder(), onError } = {}) {
  let tail = Promise.resolve();
  const persisted = new Set();
  if (!journal || typeof journal.appendThreadEvent !== 'function') throw new TypeError('event sink requires journal.appendThreadEvent');
  return {
    persistCanonicalEvents({ threadId, events = [] } = {}) {
      for (const event of events) {
        tail = tail.then(async () => {
          const identity = event.eventId || (event.sequence !== undefined ? `${threadId}:${event.sequence}` : null);
          if (identity && persisted.has(identity)) return;
          const saved = await journal.appendThreadEvent(threadId, event);
          if (identity) persisted.add(identity);
          try {
            streamController?.enqueue(encoder.encode(`${JSON.stringify(saved)}\n`));
          } catch (error) {
            onError?.(error);
          }
        }).catch((error) => {
          onError?.(error);
        });
      }
      return tail;
    },
    flush() { return tail; },
  };
}

export async function persistCanonicalEvents(input) {
  return createEventSink(input).persistCanonicalEvents(input);
}
