# Canvas and generation performance benchmark

Run the development server, open a workspace in Chrome, and enable instrumentation:

```js
localStorage.setItem('zo:canvas-perf', '1');
location.reload();
```

Use one workspace containing 200 canvas items, 100 connections, and 100 chat messages. Exercise:

1. Type continuously in the chat composer, including Chinese IME and a 10,000-character paste.
2. Start an Agent/image run producing approximately 100 stream events per second.
3. While generation is active, pan, wheel-zoom, drag one item, resize one item, and cancel one drag.
4. Include successful, failed, timed-out, and cancelled generated asset preloads.

Capture console entries for `[chat-input-perf]`, `[chat-stream-perf]`, `[generated-asset-preload-perf]`, `[workspace-commit-perf]`, `[canvas-perf]`, and `[canvas-sequence-perf]`.

Targets: input p95 <= 4ms and p99 <= 8ms; stream event-to-commit p95 <= 120ms; workspace commits <= 15/s during a stream; canvas frame-gap p95 <= 24ms; no long task above 50ms; overlay error <= 1 CSS px.
