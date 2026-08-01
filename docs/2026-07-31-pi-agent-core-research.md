# Pi Agent Core Research

Research date: 2026-07-31

## Summary

`@earendil-works/pi-agent-core` is an embeddable TypeScript agent runtime. It is not an LLM and it is not the full Pi coding-agent product. It supplies the stateful model/tool loop, event stream, extensible message model, tool validation/execution hooks, context transformation, steering/follow-up queues, and optional harness/session utilities. Model-provider access is supplied by `@earendil-works/pi-ai` or by a compatible `streamFn`.

## Core architecture

- The high-level `Agent` class owns mutable agent state, prompt/continue control, abort handling, queues, and awaited subscribers.
- The low-level `agentLoop` / `agentLoopContinue` APIs expose the event stream directly when an application wants to own state integration.
- Before every model call, `transformContext` can prune or inject agent-level messages, then `convertToLlm` filters or converts them to provider-compatible messages.
- Tool arguments are schema-validated before execution. `beforeToolCall` can block a call and `afterToolCall` can rewrite the result or terminate the automatic follow-up turn.
- Tool calls can run in parallel or sequentially. Tool progress and completion are represented through lifecycle events and tool-result messages.
- Steering messages are injected after the current turn's tools finish; follow-up messages are consumed when the agent would otherwise stop.

## State and UI integration

- `AgentState` includes the system prompt, model, reasoning level, tools, transcript, current streaming message, pending tool call IDs, and latest error.
- `AgentMessage` supports application-defined message types through TypeScript declaration merging. `convertToLlm` decides which custom messages reach the model.
- The event protocol covers agent, turn, message, streaming delta, and tool execution lifecycles. This is suitable for translating into an application's SSE/NDJSON progress protocol.

## Package boundaries

- `pi-agent-core`: reusable agent runtime and harness utilities.
- `pi-ai`: normalized provider/model APIs and streaming message/tool-call protocol.
- `pi-coding-agent`: complete coding CLI with filesystem and shell-oriented tools. It is a separate product layer, not the recommended dependency for a design application.

## Z Flow implications

- The runtime could eventually replace the custom loop in `app/lib/agent/agent-loop.mjs`, but it is not a drop-in replacement because Z Flow currently has its own provider response shape, confirmation suspension records, NDJSON events, authoritative planner, and image execution contracts.
- The existing unified planner, skill registry, tool allowlists, confirmation flow, and image pipeline should remain product-owned.
- A safe experiment would wrap one bounded skill with `pi-agent-core`, translate its events to the existing protocol, and compare it with the current loop. Importing the complete coding agent would add unrelated filesystem/shell behavior and a second product architecture.

## Primary sources

- Pi repository: https://github.com/earendil-works/pi
- Agent Core README: https://github.com/earendil-works/pi/blob/main/packages/agent/README.md
- Agent implementation: https://github.com/earendil-works/pi/blob/main/packages/agent/src/agent.ts
- Agent loop implementation: https://github.com/earendil-works/pi/blob/main/packages/agent/src/agent-loop.ts
- Public runtime types: https://github.com/earendil-works/pi/blob/main/packages/agent/src/types.ts
- Package manifest: https://github.com/earendil-works/pi/blob/main/packages/agent/package.json
