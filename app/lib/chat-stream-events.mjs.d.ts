export type NormalizedChatStreamEvent =
  | { type: 'delta'; channel: 'content' | 'reasoning'; content: string }
  | { type: 'tool_call_start'; toolCallId: string; index: number; name?: string }
  | { type: 'tool_call_delta'; toolCallId: string; index: number; argumentsDelta: string }
  | { type: 'tool_call_end'; toolCallId: string; index: number; name: string; arguments: string };

export function createChatStreamEventDecoder(): {
  decode(payload: unknown): NormalizedChatStreamEvent[];
  flush(): NormalizedChatStreamEvent[];
};
