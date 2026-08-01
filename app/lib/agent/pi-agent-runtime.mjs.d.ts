export function convertPiMessagesToChatMessages(messages: unknown[]): unknown[];
export function convertChatMessagesToPiMessages(messages: unknown[], model: unknown): unknown[];

export function runZFlowAgentBrain(input: {
  messages: unknown[];
  systemPrompt?: string;
  providerId: string;
  model: string;
  modelMetadata?: Record<string, unknown>;
  tools?: Array<{
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
    readOnly?: boolean;
    requiresConfirmation?: boolean;
    confirmationMessage?: string;
  }>;
  maxTurns?: number;
  maxToolCalls?: number;
  requireMutationTool?: boolean;
  signal?: AbortSignal;
  chatStream: (request: Record<string, unknown>) => AsyncIterable<unknown>;
  executeTool: (name: string, args: Record<string, unknown>, context: Record<string, unknown>) => Promise<unknown>;
  onEvent?: (event: unknown) => void | Promise<void>;
  onToolStart?: (event: unknown) => void | Promise<void>;
  onToolUpdate?: (event: unknown) => void | Promise<void>;
  onToolResult?: (event: unknown) => void | Promise<void>;
  continuation?: {
    transcript: unknown[];
    pendingCall: {
      id: string;
      name: string;
      args: Record<string, unknown>;
      batch?: Array<{ id: string; name: string; args: Record<string, unknown> }>;
    };
    toolResult: unknown;
    budgets?: {
      turnsUsed?: number;
      toolCallsUsed?: number;
      mutationToolCallsUsed?: number;
    };
  };
}): Promise<{
  content: string;
  reasoningContent: string;
  messages: unknown[];
  transcript: unknown[];
  turns: number;
  toolCalls: number;
  mutationToolCalls: number;
  stopReason: 'completed' | 'execution_required' | 'confirmation_required' | 'budget_exceeded' | 'aborted' | 'error';
  errorMessage?: string;
  confirmation?: Record<string, unknown>;
  rawResults: Map<string, unknown>;
}>;
