function routerText(value) {
  const source = Array.isArray(value)
    ? value.filter((part) => part?.type === 'text').map((part) => part.text || '').join(' ')
    : String(value || '');
  return source.replace(/data:image\/[\w.+-]+;base64,[A-Za-z0-9+/=]+/gi, '[image omitted]').trim();
}

export function buildSkillRouterMessages({
  userMessage,
  messages = [],
  candidates,
  activeSkillId = null,
  hasReferenceImages = false,
  referenceMetadata = [],
  hasPendingConfirmation = false,
}) {
  const system = [
    'You are the routing component for the Z Flow main agent.',
    'Return exactly one JSON object without Markdown, code fences, commentary, or extra keys.',
    'Schema: {"version":1,"route":"chat|vision_analysis|planner","skillId":null,"confidence":"high|medium|low","reason":""}.',
    'This is routing only. Do not answer the user, create an image prompt, call a tool, or rewrite the request.',
    'The route planner is required for image generation, image editing, batch output, exports, and Skill execution.',
    'Use vision_analysis only for a request that asks to inspect or discuss supplied images without changing or exporting them.',
    'Use chat for ordinary discussion, explanation, brainstorming, clarification, and non-visual analysis.',
    'When a request might cause a side effect or the requested operation is materially ambiguous, choose planner so the Planner can clarify it.',
    'For chat and vision_analysis, skillId must be null.',
    'For planner, choose one exact enabled Skill id only when its manifest clearly matches. Otherwise use null. Low confidence must use null.',
    'The supplied manualSkillId is an explicit user choice. For planner preserve it exactly; never replace it.',
    'Images are intentionally not included in this request. Use only the declared reference roles and user text for routing; the Planner receives original images later.',
  ].join('\n');
  return [
    { role: 'system', content: system },
    {
      role: 'user',
      content: JSON.stringify({
        userMessage: routerText(userMessage),
        messages: (Array.isArray(messages) ? messages : [])
          .filter((message) => message?.role === 'user' || message?.role === 'assistant')
          .slice(-8)
          .map((message) => ({ role: message.role, content: routerText(message.content).slice(0, 2000) })),
        manualSkillId: activeSkillId || null,
        hasReferenceImages: Boolean(hasReferenceImages),
        referenceMetadata: (Array.isArray(referenceMetadata) ? referenceMetadata : []).map((reference) => ({
          id: reference?.id,
          label: reference?.label,
          role: reference?.role,
          source: reference?.source,
        })),
        hasPendingConfirmation: Boolean(hasPendingConfirmation),
        candidates: (Array.isArray(candidates) ? candidates : []).map(({ id, name, description, triggerHints }) => ({
          id,
          name,
          description,
          triggerHints,
        })),
      }),
    },
  ];
}

export function parseAgentRoutingDecision(raw, allowedSkillIds = []) {
  if (typeof raw !== 'string' || !raw.trim() || raw.includes('```')) return null;
  try {
    const value = JSON.parse(raw);
    if (!value || value.version !== 1 || !['chat', 'vision_analysis', 'planner'].includes(value.route)) return null;
    if (!['high', 'medium', 'low'].includes(value.confidence)) return null;
    if (value.skillId !== null && typeof value.skillId !== 'string') return null;
    if (typeof value.reason !== 'string') return null;
    const allowedKeys = new Set(['version', 'route', 'skillId', 'confidence', 'reason']);
    if (Object.keys(value).some((key) => !allowedKeys.has(key))) return null;
    if (!Object.hasOwn(value, 'skillId')) return null;
    const skillId = typeof value.skillId === 'string' ? value.skillId.trim() : null;
    if (value.skillId !== null && !skillId) return null;
    if (value.route !== 'planner' && skillId !== null) return null;
    if (value.confidence === 'low' && skillId !== null) return null;
    if (skillId && !new Set(allowedSkillIds).has(skillId)) return null;
    return {
      version: 1,
      route: value.route,
      intent: value.route === 'planner' ? 'image' : 'chat',
      skillId,
      confidence: value.confidence,
      reason: value.reason.trim().slice(0, 240),
    };
  } catch {
    return null;
  }
}

export async function routeAgentRequest({
  userMessage,
  messages = [],
  manifests,
  manualSkillId,
  hasReferenceImages = false,
  referenceMetadata = [],
  hasPendingConfirmation = false,
  routerModel,
  providerId,
  signal,
  chatFn,
}) {
  const availableManifests = (Array.isArray(manifests) ? manifests : []).filter((manifest) => manifest?.enabled !== false);
  const manual = manualSkillId
    ? availableManifests.find((manifest) => manifest.id === manualSkillId)
    : null;
  if (manualSkillId && !manual) throw new Error(`Unknown skill: ${manualSkillId}`);
  const candidates = availableManifests.map((manifest) => ({
    id: manifest.id,
    name: manifest.name,
    description: manifest.description,
    triggerHints: [...(manifest.triggerHints || [])],
  }));
  const fallback = {
    version: 1,
    route: 'chat',
    intent: 'chat',
    skillId: null,
    confidence: 'low',
    needsClarification: false,
    reason: 'router_unavailable',
    source: 'router_failed',
  };
  if (typeof chatFn !== 'function' || !routerModel) return fallback;

  try {
    const response = await chatFn({
      providerId,
      model: routerModel,
      messages: buildSkillRouterMessages({
        userMessage,
        messages,
        candidates,
        activeSkillId: manualSkillId,
        hasReferenceImages,
        referenceMetadata,
        hasPendingConfirmation,
      }),
      signal,
    });
    const parsed = parseAgentRoutingDecision(
      response?.choices?.[0]?.message?.content || '',
      candidates.map((candidate) => candidate.id),
    );
    if (!parsed) return fallback;
    if (manual) {
      return {
        ...parsed,
        skillId: parsed.route === 'planner' ? manual.id : null,
        needsClarification: false,
        source: 'manual_locked',
      };
    }
    return { ...parsed, needsClarification: false, source: 'model' };
  } catch {
    return fallback;
  }
}
