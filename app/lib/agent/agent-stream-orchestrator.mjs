import { projectNativeEvent } from './native-event-projector.mjs';
import { createEventSink } from './event-sink.mjs';

export function createAgentStreamOrchestrator({ journal, streamController, encoder = new TextEncoder(), context, onError } = {}) {
  const sink = createEventSink({ journal, streamController, encoder, onError });
  return {
    async publish(event) {
      const events = projectNativeEvent(event, context) || [];
      if (events.length) await sink.persistCanonicalEvents({ threadId: context?.threadId, events });
      return events;
    },
    flush: () => sink.flush(),
    persistCanonicalEvents: (input) => sink.persistCanonicalEvents(input),
  };
}
