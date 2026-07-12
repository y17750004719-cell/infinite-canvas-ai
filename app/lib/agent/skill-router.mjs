import { resolveAgentIntent } from './prompt-optimizer.mjs';

const MAX_CANDIDATES = 5;
const MIN_SKILL_CONFIDENCE = 0.55;

function normalizeText(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

export function filterSkillCandidates(userMessage, manifests, limit = MAX_CANDIDATES) {
  const text = normalizeText(userMessage);
  if (!text) return [];
  return (Array.isArray(manifests) ? manifests : [])
    .filter((manifest) => manifest?.enabled !== false)
    .map((manifest) => {
      const hints = Array.isArray(manifest.triggerHints) ? manifest.triggerHints : [];
      const hintScore = hints.reduce((score, hint) => {
        const normalizedHint = normalizeText(hint);
        return score + (normalizedHint && text.includes(normalizedHint) ? Math.max(2, normalizedHint.length) : 0);
      }, 0);
      const name = normalizeText(manifest.name);
      const description = normalizeText(manifest.description);
      const metadataScore = (name && text.includes(name) ? 4 : 0) +
        text.split(/\s+/).reduce((score, token) => score + (token.length > 1 && description.includes(token) ? 1 : 0), 0);
      return { manifest, score: hintScore + metadataScore };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.manifest.id.localeCompare(b.manifest.id))
    .slice(0, Math.max(1, Math.min(MAX_CANDIDATES, Number(limit) || MAX_CANDIDATES)))
    .map(({ manifest }) => ({
      id: manifest.id,
      name: manifest.name,
      description: manifest.description,
      triggerHints: [...(manifest.triggerHints || [])],
    }));
}

export function buildSkillRouterMessages({ userMessage, candidates, hasReferenceImages = false }) {
  const system = [
    'You are the routing component for the ZO Design main agent.',
    'Return exactly one JSON object without Markdown, code fences, commentary, or extra keys.',
    'Schema: {"version":1,"intent":"chat|image|skill_action","skillId":null,"confidence":0,"needsClarification":false,"clarificationQuestion":""}.',
    'Choose skillId only from the supplied candidates. Use null when no candidate is appropriate.',
    'Use image for a single image-generation request, skill_action for batch or workflow execution, and chat for conversation or analysis.',
    'Set needsClarification only when different choices would materially change the result.',
  ].join('\n');
  return [
    { role: 'system', content: system },
    {
      role: 'user',
      content: JSON.stringify({
        userMessage: String(userMessage || '').trim(),
        hasReferenceImages: Boolean(hasReferenceImages),
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

export function parseAgentRoutingDecision(raw, allowedSkillIds) {
  if (typeof raw !== 'string' || !raw.trim() || raw.includes('```')) return null;
  try {
    const value = JSON.parse(raw);
    if (!value || value.version !== 1 || !['chat', 'image', 'skill_action'].includes(value.intent)) return null;
    if (typeof value.confidence !== 'number' || value.confidence < 0 || value.confidence > 1) return null;
    if (typeof value.needsClarification !== 'boolean') return null;
    const allowed = new Set(Array.isArray(allowedSkillIds) ? allowedSkillIds : []);
    if (value.skillId !== null && (typeof value.skillId !== 'string' || !allowed.has(value.skillId))) return null;
    const clarificationQuestion = typeof value.clarificationQuestion === 'string'
      ? value.clarificationQuestion.trim()
      : '';
    if (value.needsClarification && !clarificationQuestion) return null;
    const skillId = value.confidence >= MIN_SKILL_CONFIDENCE ? value.skillId : null;
    return {
      version: 1,
      intent: value.intent === 'skill_action' && !skillId ? 'chat' : value.intent,
      skillId,
      confidence: value.confidence,
      needsClarification: value.needsClarification,
      ...(clarificationQuestion ? { clarificationQuestion } : {}),
    };
  } catch {
    return null;
  }
}

export async function routeAgentRequest({
  userMessage,
  manifests,
  manualSkillId,
  hasReferenceImages = false,
  routerModel,
  providerId,
  signal,
  chatFn,
}) {
  const availableManifests = (Array.isArray(manifests) ? manifests : []).filter((manifest) => manifest?.enabled !== false);
  const fallbackIntent = resolveAgentIntent(userMessage, hasReferenceImages);
  if (manualSkillId) {
    const manual = availableManifests.find((manifest) => manifest.id === manualSkillId);
    if (!manual) throw new Error(`Unknown skill: ${manualSkillId}`);
    return {
      version: 1,
      intent: 'chat',
      skillId: manual.id,
      confidence: 1,
      needsClarification: false,
      source: 'manual',
    };
  }

  const candidates = filterSkillCandidates(userMessage, availableManifests);
  const fallback = {
    version: 1,
    intent: fallbackIntent === 'skill_action' ? 'chat' : fallbackIntent,
    skillId: null,
    confidence: 0,
    needsClarification: false,
    source: candidates.length > 0 ? 'auto' : 'none',
  };
  if (candidates.length === 0 || typeof chatFn !== 'function' || !routerModel) return fallback;

  try {
    const response = await chatFn({
      providerId,
      model: routerModel,
      messages: buildSkillRouterMessages({ userMessage, candidates, hasReferenceImages }),
      signal,
    });
    const parsed = parseAgentRoutingDecision(
      response?.choices?.[0]?.message?.content || '',
      candidates.map((candidate) => candidate.id),
    );
    return parsed ? { ...parsed, source: 'auto' } : fallback;
  } catch {
    return fallback;
  }
}
