# JS/TS Cleanup: Verified Dead Code

## Goal And Boundaries

Remove verified unused code left behind by the Native/image runtime extraction.
Preserve image generation, Skill validation, safe retries, saved-asset replay,
chat/canvas delivery, final responses, and old session decoding.
Do not touch Codex Main, Native binaries/protocol/configuration, runtime assets,
logs, credentials, dependencies, or unrelated working-tree changes.

## Evidence Before Editing

- Baseline: `npm test` passes 1187 tests.
- TypeScript unused diagnostics: request runtime 107, page 36, image route 3,
  provider client 3, and two unused React imports. A diagnostic is a candidate,
  not permission to remove an expression with side effects.
- `agent-loop.mjs` and `chat-completions-adapter.mjs` are live; retain them.
- The old one-retry recovery chain has only test callers; current execution uses
  `executeMainAgentTurnWithSafeRetry` and `resolveNativeRetryDecision`.
- `pi-agent-core-contract.test.mjs` tests a package absent from the manifest and
  lockfile; it is not a current application contract.
- CodeGraph was consulted; stale symbol mappings were checked against current
  source, TypeScript diagnostics, import edges, and repository-wide references.

## Ordered Cleanup Passes

1. Lock behavior before deletion. Keep the existing image-delivery regressions;
   add a source-aware unused-code guard for the cleaned TS runtime/page and
   current JS services. The guard must ignore declaration-only type parameters.
   Retain or move cancellation, unknown-result, and no-provider-retry assertions
   onto the active retry implementation before removing obsolete tests.
2. Remove unused runtime imports, local types, constants, closures, and copied
   scope bindings. Preserve initialization calls with effects. Remove comments
   whose only purpose was satisfying stale source-regex tests; update those
   tests to inspect the real implementation boundary.
3. Remove the isolated one-retry implementation and unused temporary wrappers
   only after checking static and dynamic references. Delete tests exclusively
   testing retired code, but preserve all current behavior assertions. Remove
   the obsolete Pi dependency contract test, without changing dependencies.
   Concrete targets: the old recovery router/factory and five helpers it alone
   uses; unused Native gateway lifecycle stubs; the main-flow execute shortcut
   and alias; the unused native-turn execution wrapper and immutable context
   factory. Preserve current `runTurn`, `prepareNativeTurnFlow`, and all live
   context/confirmation/asset normalizers. Remove the duplicate Native tool
   array only after a real composed-turn regression proves the active tools.
4. Remove unused page helpers, icons, state, and handlers confirmed by compiler
   and source references. Preserve setter-only state and active hook behavior.
   Remove unused image-route/provider-client bindings without changing requests.
5. Run focused tests, the new static guard, full tests, lint, typecheck, build,
   and `git diff --check`. Review changes separately from implementation.

## Acceptance

- No unused-local/parameter diagnostics remain in the cleaned TS files.
- Active JS implementation files in the cleaned Agent boundary have no unused
  bindings; intentionally unused positional API parameters are exempted.
- No new dependencies, no new execution framework, and no data migration.
- Image delivery regressions pass, including post-image Native failure,
  refresh recovery, duplicate deliveries, partial success, and cancellation.
- Test count changes are explained by removed obsolete tests and added guards.
- Final report distinguishes completed deletions from retained live or uncertain
  modules; it must not claim every old-looking file is dead code.

## Status

- [x] Read-only inventory and baseline tests.
- [x] Independent plan review (OKAY); composed-turn regression 4/4 before edits.
- [x] Static guards enabled (`noUnusedLocals`, `noUnusedParameters`, Agent JS lint).
- [x] Runtime unused-code pass; unused diagnostics reduced to zero.
- [x] Retired retry/test pass; current retry/gateway regressions 31/31.
- [x] Frontend and image-boundary unused-code pass.
- [x] Full verification and independent diff review (OKAY; no blocking findings).

## Completed Deletions

| Area | Removed | Preserved |
| --- | --- | --- |
| Recovery | Old one-retry router/factory and five orphan helpers | Current bounded request/stream retry and unknown-outcome protection |
| Native gateway | Uncalled lifecycle stubs and metadata wrapper | Single-turn delegation and `runTurn` alias |
| Main Agent | Duplicate unused tool array, execute bypass/alias, unused native-turn wrapper | Composed tool filtering, Skill selection and commentary policy |
| Context | Uncalled immutable `agent-runtime-context.mjs` factory | Live context preparation, budget ledger and historical decoding |
| Tests | Pi-only dependency test and obsolete recovery-router tests | Safety assertions moved onto the active retry path; four new composed-turn regressions |
| Workspace | Unused icons, types, old reference drag handlers, unused geometry/UI helpers and dead bindings | Active panel dragging, state initialization, chat/canvas delivery and recovery |
| Image boundary | Unused constants, debug helper, derived message text and provider-target bindings | Provider initialization and request/response contracts |

The runtime entry shrank from 844 to 476 lines, and the page from 21,899 to
21,692 lines in this cleanup. These numbers exclude the earlier service
extraction and image-delivery fixes already present in the working tree.
This is not a claim
that the remaining page is small or that every historical-looking module is
unused. Splitting a live UI component would be a separate refactor.

`approval-state.mjs`, `context-replay.mjs`, `multimodal-reference-context.mjs`
and `original-asset.mjs` remain: test-only usage alone was not sufficient proof
to remove their compatibility contracts. Runtime assets, session journals,
uploads, logs, dependencies and Native implementation were not cleanup targets.

## Verification Results

| Check | Result |
| --- | --- |
| Composed Native tools and delivery/retry regressions | 27/27 passed |
| Runtime route/image/delivery checks | 26/26 passed |
| `npm test` | 1,187 passed; zero failed, skipped or cancelled |
| `npm run lint` | Passed |
| `npm run typecheck` | Passed; zero unused-local/parameter diagnostics |
| `npm run build` | Passed; production pages generated |
| `git diff --check` | Passed |

The test total remains 1,187: four tests specific to retired code were removed
and four composed-turn tests were added. Existing safety assertions now execute
the active retry service. Structural tests read real admission, Native input,
provider selection, confirmation and result services rather than unused types
or placeholder comments.

Build still reports 23 broad filesystem-pattern warnings involving `runtime/`;
the preceding image-delivery build reported the same 23 warnings. Lint also
prints a Babel size notice for the page (over 500KB). Neither is a failed check.
They remain separate build-scope/UI-size concerns; deleting runtime files is
not an appropriate fix. This cleanup reran local regressions and compilation,
without submitting another paid image-generation request.

Implementation and review used separate agents. The final independent reviewer
returned OKAY with no blocking findings and reran 40 composed-turn, retry,
gateway and saved-image delivery tests successfully. The review confirmed that
removed symbols have no remaining production callers, initialization calls
remain, and safety coverage moved to the active implementation.

Review limitation: there was no standalone 844-line pre-cleanup runtime
snapshot. The reviewer used the earlier read-only audit, original compiler
diagnostics, current call paths and regression tests; the full dirty-worktree
diff also contains earlier fixes and was not treated as this cleanup alone.
