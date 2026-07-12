export interface AgentLoopResult {
  content: string;
  reasoningContent: string;
  turns: number;
  toolCalls: number;
  stopReason: 'completed' | 'confirmation_required';
  confirmation?: Record<string, unknown>;
}

export function runAgentLoop(input: {
  messages: unknown[];
  tools: unknown[];
  modelFn: (request: { messages: unknown[]; tools: unknown[] }) => Promise<unknown>;
  executeTool: (name: string, args: Record<string, unknown>, context: { toolCallId: string }) => Promise<unknown>;
  isReadOnlyTool?: (name: string) => boolean;
  maxTurns?: number;
  maxToolCalls?: number;
  onToolStart?: (event: { id: string; name: string; args: Record<string, unknown> }) => void | Promise<void>;
  onToolResult?: (event: { id: string; name: string; result: unknown }) => void | Promise<void>;
}): Promise<AgentLoopResult>;
