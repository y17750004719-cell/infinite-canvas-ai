# ADR 0004: Interleaved Agent Conversation

## Status

Accepted

## Context

Agent progress currently appears as a collapsible activity record. This separates
the Agent's explanation, tool work, user decisions, and final response even
though they occur in one conversation turn. The Agent runtime already emits
ordered `progress_update` events, and Pi Agent Core already supports steering
and follow-up messages.

## Decision

- Render new Agent runs as an ordered, open timeline in the existing assistant
  message rather than an activity-record container.
- Keep `AgentRunProgress.steps` as the stored field and add `timelineVersion: 2`;
  old stored records retain the legacy renderer.
- Reuse `progress_update` and extend the existing progress tracker with shared
  stamps for commentary and interaction events. Do not add a second execution
  event protocol.
- Treat execution rows as the only public representation of tools, Skill jobs,
  and client delivery. Their details use already-sanitized public results.
- For image tasks, render model-authored public work notes as commentary. These
  are normal assistant content, never hidden reasoning; final supplier Prompts
  may be expanded after preparation, while system prompts, Skill source, and
  raw tool arguments remain private.
- Keep the current run in a process-local registry so composer input can steer
  at a Pi safe boundary or queue as a follow-up. Deterministic image generation
  is never cancelled by steering.
- Do not add code-editing capabilities, a new persistence service, or a queue.

## Consequences

- New runs show commentary, execution, decisions, and final output in the order
  users experienced them.
- A server restart ends the in-memory steering channel; the client falls back to
  a normal subsequent request.
- DeepSeek Harness is an interaction reference only. No Harness runtime or UI
  package is imported. Pi is used through the installed `pi-agent-core` API.
