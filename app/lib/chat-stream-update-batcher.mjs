export function applyQueuedChatMessageUpdates(messages, queuedUpdates) {
  let changed = false;
  const nextMessages = messages.map((message) => {
    const updaters = queuedUpdates.get(message.id);
    const nextMessage = updaters
      ? updaters.reduce((current, update) => update(current), message)
      : message;
    if (nextMessage !== message) changed = true;
    return nextMessage;
  });
  return changed ? nextMessages : messages;
}
