import { createNativeEventForwarder, materializeNativeImages } from './agent-turn-execution-service.mjs';

/** @param {Record<string, any>} input */
export async function prepareNativeTurnFlow({
  sources = [], sessionId, findAsset, materialize, read,
  prepareContext, compileContext, eventHandlers = {}, flush,
} = {}) {
  const images = await materializeNativeImages({ sources, sessionId, findAsset, materialize, read });
  const preparedContext = await prepareContext({
    request: { userText: String(eventHandlers.userText || '') },
    sessionAssets: eventHandlers.sessionAssets || [],
    skillSelection: eventHandlers.selectedSkill,
    compile: () => compileContext({ images }),
  });
  const onEvent = createNativeEventForwarder({
    onActivityText: eventHandlers.onActivityText,
    onToolStart: eventHandlers.onToolStart,
    onToolResult: eventHandlers.onToolResult,
    onCommentary: eventHandlers.onCommentary,
    onRawEvent: eventHandlers.onRawEvent,
    flush,
  });
  return { images, preparedContext, onEvent };
}
