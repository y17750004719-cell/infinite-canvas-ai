export type AgentIntent = 'chat' | 'image' | 'skill_action';

export type AgentClientAction = {
  type: 'add_generated_assets';
  runId: string;
  assets: Array<{ src: string; naturalWidth?: number; naturalHeight?: number }>;
};

export type AgentEvent =
  | { type: 'agent_start'; runId: string }
  | { type: 'intent_resolved'; intent: AgentIntent }
  | { type: 'skill_selected'; skillId: string; label: string }
  | { type: 'prompt_optimization_start' }
  | { type: 'prompt_optimization_done'; summary: string; optimized: boolean }
  | { type: 'tool_start'; toolCallId: string; toolName: string }
  | { type: 'tool_update'; toolCallId: string; message: string }
  | { type: 'tool_result'; toolCallId: string; result: unknown }
  | { type: 'assistant_delta'; delta: string; channel?: 'content' | 'reasoning'; model?: string }
  | { type: 'client_action'; action: AgentClientAction }
  | { type: 'confirmation_required'; request: { confirmationId: string; toolName: string; message: string } }
  | { type: 'agent_done'; stopReason: string }
  | { type: 'agent_error'; stage: string; message: string };
