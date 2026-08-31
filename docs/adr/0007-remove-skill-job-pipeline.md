# ADR 0007: Remove the Legacy Skill Job Pipeline

## Status

Accepted

## Context

Brand and Logo Skills previously exposed `start_skill_job` and
`get_skill_job`. Those tools created an in-memory asynchronous job, called the
image provider outside the Main Agent turn, and required a separate frontend
polling path. This conflicts with the current single-agent ImageGen contract.

## Decision

- Remove the Skill Job tools, implementation, API routes, and frontend polling.
- Brand and Logo keep their content and confirmation workflows, but all image
  output goes through the Main Agent `generate_image` batch/series contract.
- Progress and partial success use the existing Agent asset events.
- Failed retries create a new Main Agent turn with new attempt and call IDs.
- Legacy Job records and events are removed by the client data migration when
  encountered; no runtime path executes, polls, or replays them.
- Skill context for this unified path follows ADR 0008; Job removal does not
  create a separate Skill prompt or provider path.

## Consequences

There is one image side-effect boundary: Main Agent → `generate_image` → local
contract checks → `/api/generate`. The old Job store, cancellation controller,
provider fan-out, and Job-specific UI are deleted. Existing multi-image
delivery remains available through the unified image result and event stream.
ADR 0008 defines how the Main Agent receives selected Skill content.
