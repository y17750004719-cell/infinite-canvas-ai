# Native Codex Migration

## Approved Boundary

Replace the Pi conversation loop with the pinned native Codex App Server, not a
TypeScript recreation of its scheduler. Keep business image contracts, validated
references, image providers, approvals, recovery, assets and idempotency. Preserve
user data and unrelated working-tree changes. No live model or image-provider
requests are authorized for automated validation.

The native loop may execute multiple independent tools. Tool dependencies remain
result-driven. Public action descriptions are model-written, persisted separately
from final answers, and never expose hidden reasoning or private prompt content.

## Ordered Gates

1. Build the exact source in `scripts/native-codex-lock.json` in an independent
   checkout. Validate actual native requests against a loopback Responses stub:
   tool isolation, dynamic calls, Skill injection, vision and result continuation.
2. Add the isolated process bridge, single-writer thread mapping, bounded queue,
   durable public event projection and business execution ledger.
3. Integrate image execution, approval, cancellation and recovery with simulated
   image providers. Return success only after assets have been saved.
4. Replace the route scheduler with an HTTP adapter and preserve frontend event
   names. Test replay, reconnect and process failures.
5. Remove Pi and old-format execution code only after the native gate passes.
   Old records must not execute; existing messages and assets remain intact.

Do not fall back to another model, source revision, protocol or old scheduler when
the native gate fails. Do not claim a mocked bridge proves native integration.

## Verification

Run focused native integration and business regression tests, then `npm test`,
`npm run lint`, `npm run typecheck`, `npm run build` and `git diff --check`.
Security tests must inspect actual model-visible tools and attempt forbidden calls.
Request fixtures must prove both model image input and provider image references,
as well as exact Skill content and image contract hashes.

After local verification, real model/provider smoke testing remains a manual user
acceptance step. Native runtime reuse is not a guarantee of model quality or
external provider availability.
