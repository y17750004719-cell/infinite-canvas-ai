# Protocol Cleanup

## Scope and Decision

The user authorizes dropping old protocol data and compatibility. Keep the
current image execution, context safety and canvas functionality. Do not claim
that removing compatibility completes the remaining workbench implementation.

## Ordered Passes

1. Lock current image materialization, recovery and session behavior with tests.
2. Move the real Session asset implementation out of Topic modules. Delete Topic
   exports, declaration aliases and obsolete HTTP route; port safety tests.
3. Replace v3/v4 migration and nested legacy cleanup with a schema-v5 reset
   boundary. Drop old messages, context, recovery, approvals and asset references.
   Preserve canvas/settings fields needed by current features.
4. Remove Topic request aliases and legacy recovery identity synthesis from
   production Agent input. Require session identity and reject stale recovery.
5. Remove the old presentation fallback that resurrects Topic messages.
6. Inventory local obsolete fixture directories before moving exact verified
   targets to a recoverable quarantine. Do not delete current generated images,
   provider settings, unrelated data or current v5 journals.
7. Run targeted tests, full tests, lint, typecheck, build and independent review.

## Findings

- Topic alias adapters: obsolete compatibility; remove after moving core code.
- v3/v4 migration: obsolete data preservation; replace with explicit reset.
- Legacy recovery identity synthesis: masks obsolete input; reject instead.
- Live lifecycle producer and confirmation Map: still production dependencies;
  replacement is needed before deletion, not a blind cleanup target.
- Invalid image/reference fail-closed checks: current safety boundaries; retain.

## Verification and Risks

Tests must show v5 chat survives, old chat does not return on hydration, wrong
Session references remain rejected, and current image safety tests still pass.
Data movement must report exact counts and a recoverable destination.
No UI redesign and no new dependencies.

## Completed Cleanup

- Session asset modules now own the image implementation directly. Removed the
  Topic asset HTTP route, modules and declaration aliases; retained image safety
  and Session-isolation coverage.
- Removed v3/v4 migration and recovery synthesis. Non-v5 sessions reset chat,
  context, Turn, approval, todo and image-reference data while retaining canvas
  and model settings. IndexedDB v3 applies the reset during database upgrade;
  old context revisions cannot block the reset write.
- Agent requests require sessionId. Topic request fields and presentation/chat
  readers no longer restore old Topic conversations.
- Image history version deduplication uses sessionId, not topicId. Foreign
  Session assets/history are filtered rather than reassigned.
- Moved 132 old Topic fixture directories (113 PNGs) and 39 Session fixture
  directories (30 PNGs) to /Volumes/ZO/zo-design-legacy-fixtures-kJz04R.
  Contents were verified as known 1x1 test images before movement; recoverable.
  Session asset tests now use OS temporary directories with automatic cleanup.

## Remaining Runtime Dependencies

The live event producer, confirmationStore, active-run queue registry and current
message image-reference adapter still have production callers. They have not been
blindly deleted. Their replacements and end-to-end recovery remain unfinished;
see CHAT-WORKBENCH-IMPLEMENTATION.md. Browser IndexedDB cleanup runs on the next
database open by the updated application, not as a filesystem deletion.
