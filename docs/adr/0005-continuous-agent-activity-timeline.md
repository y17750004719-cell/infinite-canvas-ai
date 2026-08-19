# ADR 0005: Continuous Agent Activity Timeline

## Status

Accepted

## Context

Complex Agent tasks need a readable account of what is happening without exposing
private reasoning. A failed task may be resumed, so a new attempt must not erase
the history that explains why the retry happened.

## Decision

- Public work notes describe user-visible intent and verified progress, never
  reasoning, system prompts, raw tool arguments, or internal diagnostics.
- A task has one sequential activity timeline. Starting a new step completes
  the previous active step; retries append a new attempt to that same timeline.
- The displayed processing duration sums Agent attempt intervals and excludes
  user waiting time between attempts.

## Consequences

- Users can follow commentary, tool breadcrumbs, retries, and final output in
  their actual order.
- Final image prompts remain available as expandable details on the attempt
  that prepared them.
