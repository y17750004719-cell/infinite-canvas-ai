# ADR 0008: Codex-style Skill Injection

## Status

Accepted

## Context

The single-agent ImageGen path must give the Main Agent the actual selected
Skill rules without elevating those rules into the system prompt or passing
them to the image provider. Automatic visual-Skill matching also made a
request's effective rules unpredictable.

## Decision

- A picture Turn creates a Skill snapshot before the first Main Agent model
  request.
- The message order is: system safety and contract guardrails, compact Skill
  catalog, `imagegen` as an independent user `<skill>` fragment, an explicitly
  locked visual Skill as a second `<skill>` fragment when present, structured
  task facts, then the current user message and references.
- Full Skill fragments are execution rules for that Turn. They are not system
  messages and do not replace the user request. Locked visual hard constraints
  prevail over conflicting visual requests; the Main Agent asks for
  clarification instead of silently dropping a constraint.
- Visual Skill selection is explicit only: UI `activeSkillId`, `$skill`, a
  recognized Skill path, or exact manifest ID/name. `imagegen` is always loaded
  for image Turns; no visual Skill is guessed when none is selected.
- Each full fragment has an 8KB UTF-8-safe budget. Truncation preserves the
  prefix and records an explicit warning, byte counts, hash, role, and order.
- The Main Agent may read validated context in the same transcript and then
  call `generate_image`. Its `args.prompt` is the only provider Prompt. The
  provider receives neither Skill content nor hidden task context.
- Confirmation reuses saved tool arguments. Explicit retry and recovery start
  a new Turn, reload and verify the locked Skill, and use new attempt/call IDs;
  completed image calls are never replayed.

## Consequences

There is no automatic visual-Skill router, Planner, Prompt Optimizer, recovery
gate, or second prompt model in the production image path. Local execution
continues to enforce schema, contract, permission, confirmation, reference,
and idempotency rules, but it does not rewrite prompts. Prompt provenance is
observable by recording Skill snapshot telemetry and matching hashes from
`generate_image.args.prompt` through the provider request.

Legacy Planner, prompt-compilation, and Skill Job fields are recognized only by
the one-time data migration and then removed. They cannot become executable
inputs.
