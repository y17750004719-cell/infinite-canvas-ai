# Canvas and generation performance benchmark

Run the development server, open a workspace in Chrome, and enable instrumentation:

```js
localStorage.setItem('zo:canvas-perf', '1');
location.reload();
```

For an isolated run, append `?canvasPerf=1` to the workspace URL instead of changing local storage.

Use one workspace containing 200 canvas items, 100 connections, 100 chat messages, and all currently enabled Skills. In Chrome DevTools, record a Performance trace with screenshots and Web Vitals at normal CPU speed. Exercise each case three times after one warm-up run. Optionally repeat with 4x CPU slowdown as an additional stress observation, not as the acceptance run:

1. Type continuously in an empty chat composer, including Chinese IME and a 10,000-character paste. Repeat with reference and Skill tokens present.
2. Open the Skill picker, type a query that narrows the enabled entries, then hold ArrowDown. Repeat the same query by mouse without keyboard navigation, close it, and open provider settings.
3. Start an Agent/image run producing approximately 100 stream events per second.
4. While generation is active, pan, send a 1-second wheel burst, drag one item, resize one item, and cancel one drag.
5. Include successful, failed, timed-out, and cancelled generated asset preloads.

Capture console entries for `[chat-input-perf]`, `[skill-menu-perf]`, `[provider-settings-perf]`, `[chat-stream-perf]`, `[generated-asset-preload-perf]`, `[workspace-commit-perf]`, `[canvas-commit-perf]`, `[canvas-perf]`, `[canvas-sequence-perf]`, `[canvas-wheel-perf]`, `[canvas-longtask-perf]`, and `[SESSION][PERSIST]`. Save the Performance trace and exported console log for each measured run.

Report median and worst run for: input handler p95/p99 and input-to-first-paint, Skill open/query/select-to-first-paint, Skill picker layout count, provider settings open-to-visual-frame, wheel event count, first-preview time and wheel frame-gap p95/max, wheel React commit count, session persistence writes, stream event-to-commit p95, workspace commits/s, canvas frame-gap p95, long tasks, and overlay error.

Targets: input handler p95 <= 4ms and p99 <= 8ms; Skill query produces no per-item lowercase work and mouse selection causes no `scrollIntoView`; one wheel burst produces multiple previews, no React commit during the burst, exactly one trailing commit schedule, and at most one coalesced session write; stream event-to-commit p95 <= 120ms; workspace commits <= 15/s during a stream; canvas frame-gap p95 <= 24ms; no long task above 50ms; overlay error <= 1 CSS px.
