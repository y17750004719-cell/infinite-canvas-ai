# Chat Workbench Implementation Status

## Verified Increment

- Session identity is the Thread identity; schema v5 initializes archive, approval, todo and command state.
- Journal serializes writes per Thread, atomically replaces snapshots, recovers events ahead of a snapshot before append, and truncates incomplete UTF-8 JSONL tails by byte offset.
- Turns retain current and historical run IDs. Waiting decisions survive a turn completion notification.
- Thread-scoped command items do not create or overwrite active Turns.
- Forward replay pagination starts after the supplied cursor; fork copies public items from completed Turns without tool calls.
- Status, history cursor arguments, fork, archive, resume and clear are wired to the existing composer. `/clear` creates a durable transcript boundary without violating append-only journal sequencing; old transcript remains auditable but is excluded from new chat hydration and model submissions.
- Steer requests include Thread/Turn/operation/run identities; waiting rejects unrelated input and failed submissions retain drafts/references. Accepted steer/follow-up inputs are bounded, journal-backed, and consumed once by the active run.
- Todo read and todo update use the server journal. Todo update is exposed as a confirmation-gated production tool and renders as a timeline progress item.
- Live NDJSON now contains only server-persisted canonical lifecycle events. The client adapts those events once at the parser boundary and deduplicates by sequence.
- History search walks all journal pages, searches structured event content, and deduplicates results by sequence.
- Journal events are recursively bounded and sanitized before JSONL persistence; secrets, provider payloads, hidden reasoning, executable arguments and data URLs are omitted.
- Session changes fetch server Thread state. Empty local transcripts can restore public journal items.

## Not Complete

The complete migration plan has not been delivered. Remaining work:

1. Replace the process-local confirmation continuation payload with a journal-backed, atomically claimable checkpoint. The pending approval identity is durable, but the original continuation envelope still lives in memory.
2. Detach execution from HTTP request cancellation and implement true live attach plus replay reduction into an already populated chat timeline.
3. Connect explicit `/resume` to interrupted-run continuation. Restart detection marks unknown runs interrupted and never replays side effects automatically; a user-directed retry path is still required.
4. Connect provider-generated structured compaction to `/compact`. The current command creates a bounded deterministic public summary and durable transcript boundary.
5. Complete Skill command/action adaptation and gallery access to forked Threads. Read-only Skill actions work through the registry; mutation actions need the same durable approval checkpoint.
6. Avoid whole-file journal reads on every delta and fully journal metadata mutations. Current snapshots remain authoritative for archive metadata.
7. Remove old internal producer event branches and compatibility code after detached continuation and replay are in place.

## Legacy Data Cleanup

The separate cleanup pass removed Topic asset endpoints/aliases, v3/v4 session
migration, Topic transcript restoration and recovery identity synthesis. Schema
v5 is a hard reset boundary; IndexedDB v3 rewrites older sessions when the updated
application opens the database. Current canvas/model settings and image execution
safety remain. See CHAT-PROTOCOL-CLEANUP.md for exact cleanup scope and recoverable
fixture movement. This does not complete the runtime gaps listed above.

## Verification

Executed successfully for this increment:

- Requested Agent specialist test command.
- npm test -- --test-reporter=dot
- npm run lint
- npm run typecheck
- npm run build
- git diff --check
- Real HTTP command smoke: status/history/archive/resume/compact return successful structured command results; commands leave Turn count at zero.

No provider-backed image generation or browser interaction E2E was run. Existing generated assets and unrelated workspace changes were preserved.
