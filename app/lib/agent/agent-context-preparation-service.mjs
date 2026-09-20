/** Request-scoped context boundary. It composes injected adapters and never
 * starts a Native turn or performs an external mutation. */
export async function prepareAgentTurnContext({
  request = {},
  threadState = null,
  sessionAssets = [],
  generatedHistory = [],
  providerSelection = null,
  skillSelection = null,
  compile,
  materializeImages,
  buildInstructions,
} = {}) {
  const base = typeof compile === 'function'
    ? await compile({ request, threadState, sessionAssets, generatedHistory, providerSelection, skillSelection })
    : {};
  const images = Array.isArray(base.images)
    ? base.images
    : typeof materializeImages === 'function'
      ? await materializeImages({ request, sessionAssets })
      : [];
  const developerInstructions = base.developerInstructions
    ?? (typeof buildInstructions === 'function' ? await buildInstructions({ request, skillSelection }) : '');
  return {
    ...base,
    userText: String(base.userText ?? request.userText ?? request.latestUserMessage ?? ''),
    history: Array.isArray(base.history) ? base.history : [],
    images,
    skills: Array.isArray(base.skills) ? base.skills : [],
    developerInstructions: String(developerInstructions || ''),
    references: Array.isArray(base.references) ? base.references : [],
    contextEntityIds: Array.isArray(base.contextEntityIds) ? [...new Set(base.contextEntityIds.map(String))] : [],
    promptTrace: base.promptTrace || null,
    providerFingerprint: base.providerFingerprint || providerSelection?.fingerprint || null,
    images,
    developerInstructions: String(developerInstructions || ''),
  };
}
