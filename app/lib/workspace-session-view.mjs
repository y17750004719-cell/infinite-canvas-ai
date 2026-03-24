const DEFAULT_VIEWPORT = { x: 0, y: 0, scale: 1 };

/**
 * @param {{
 *   session: any,
 *   now?: number,
 *   normalizeSession?: (value: any) => any,
 *   normalizeItems?: (items: any[]) => any[],
 *   inferTopicSkill?: (topic: any) => any,
 * }} options
 */
export function resolveSessionPresentationState({
  session,
  now = Date.now(),
  normalizeSession = (value) => value,
  normalizeItems = (items) => items,
  inferTopicSkill = () => null,
}) {
  let topics = session.topics || [];
  let activeTopicId = session.activeTopicId || '';

  if (topics.length === 0 && Array.isArray(session.messages) && session.messages.length > 0) {
    const initialTopic = {
      id: `topic-initial-${now}`,
      title: session.messages[0].content?.substring(0, 20) || '初始对话',
      messages: session.messages,
      activeSkill: null,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
    };
    topics = [initialTopic];
    activeTopicId = initialTopic.id;
  } else if (topics.length === 0) {
    const emptyTopic = {
      id: `topic-empty-${now}`,
      title: '新对话',
      messages: [],
      activeSkill: null,
      createdAt: now,
      updatedAt: now,
    };
    topics = [emptyTopic];
    activeTopicId = emptyTopic.id;
  }

  const normalizedSession = normalizeSession(session);
  const activeTopic = topics.find((topic) => topic.id === activeTopicId) || topics[0] || null;
  const chatMessages = activeTopic ? activeTopic.messages || [] : [];

  return {
    normalizedSession,
    topics,
    activeTopic,
    items: normalizeItems(normalizedSession.items || []),
    connections: normalizedSession.connections || [],
    chatMessages,
    activeSkill: inferTopicSkill(activeTopic),
    viewport: normalizedSession.viewport || { ...DEFAULT_VIEWPORT },
    imageCount: chatMessages.filter((message) => message.imageName).length,
    shouldResetWelcome: !activeTopic || chatMessages.length === 0,
    currentSessionId: normalizedSession.id,
  };
}
