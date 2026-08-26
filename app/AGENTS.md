# Application Rules

## Scope

- These rules apply to the Next.js application under `app/`.
- The repository root `AGENTS.md` remains the source of truth for OMX runtime and collaboration behavior.
- These rules govern project code boundaries, data handling, and verification only.

## Instruction Precedence

- Root `AGENTS.md` supplies global rules.
- Nested `AGENTS.md` files refine only their subtree.
- More-specific rules may tighten, but never weaken, security, compatibility, or verification requirements.
- `AGENTS.override.md` is local-only and cannot replace core safety rules.

## Architecture

- Keep `app/api/*` focused on HTTP input/output, request validation, authorization boundaries, error mapping, and streaming responses.
- Put reusable business logic in `app/lib/*` and reuse existing modules before adding new abstractions.
- Reuse the provider registry, model selection, provider protocol, and capability modules instead of adding provider branches in route handlers.
- Keep image execution deterministic after the validated Agent execution contract is accepted.
- Put new Agent logic in focused modules instead of growing `app/api/agent/route.ts` except for orchestration glue.
- Treat `runtime/` as local runtime output; do not commit generated images, uploads, local credentials, or provider registries.

## Security Boundaries

- Never return API keys, login credentials, raw sensitive logs, or complete internal prompts to the client.
- Validate local asset paths through the existing local-asset helpers before reading or serving files.
- Validate uploaded and generated image payloads against the existing size, type, and path allowlists.
- Keep provider-specific failures and credentials inside the provider client boundary.

## Change Rules

- When changing an API route, inspect and update the corresponding `*-structure.test.mjs` coverage.
- When changing provider behavior, cover success, timeout, upstream HTTP failure, and invalid-payload cases.
- When changing local asset delivery, cover path validation, missing assets, size limits, and content-type handling.
- Do not add a dependency when an existing helper, standard-library API, or installed dependency is sufficient.
- Do not change the Agent protocol to solve a provider-specific transport problem.
- Agent lifecycle requests and responses use stable `taskId`, `operationId`, `runId`, and server-assigned `sequence`; keep lightweight notifications separate from lifecycle events.
- Confirmation, clarification, and steer submissions must carry the operation identity needed for stale-input validation.
- New wire fields are additive; removals or renames require legacy normalization and updates to all request, event, reducer, and persistence tests.

## Model-Visible Context

- Bound history, memory, Skill manifests, and visual summaries before injecting them into a model request.
- New context fragments must define a maximum size and a truncation rule that preserves stable IDs, conclusions, and constraints first.
- Do not inject complete history, complete Skill source, credentials, or unbounded provider payloads.

## Breaking-Change Checklist

- Before changing Agent behavior, inspect `/api/agent`, `/api/agent/steer`, NDJSON events, recovery records, `AgentRunProgress`, IndexedDB session data, and confirmation/clarification payloads.
- Keep wire fields camelCase and preserve old persisted data through normalizers.

## Verification

Run the smallest relevant checks first, then the full application checks when the change crosses module boundaries:

```bash
npm test
npm run lint
npm run typecheck
npm run build
```

Agent protocol changes should first run:

```bash
node --test app/lib/agent/event-contract.test.mjs app/lib/agent/agent-loop.test.mjs app/lib/agent/run-progress.test.mjs
node --test app/lib/agent/agent-route-structure.test.mjs app/lib/agent/page-agent-structure.test.mjs
```

- Read the command output before claiming completion.
- If a check cannot run, report the exact missing prerequisite and the next-best validation.
