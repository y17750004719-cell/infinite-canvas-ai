export type ChatMessageUpdater<Message> = (message: Message) => Message;

export function applyQueuedChatMessageUpdates<Message extends { id: string }>(
  messages: Message[],
  queuedUpdates: ReadonlyMap<string, readonly ChatMessageUpdater<Message>[]>,
): Message[];
