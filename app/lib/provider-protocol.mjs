const SUPPORTED_PROVIDER_PROTOCOLS = new Set(['openai', 'responses', 'gemini']);

function normalizeText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

/** @returns {'openai'|'responses'|'gemini'} */
export function effectiveProviderProtocol(provider, model) {
  return resolveConfiguredProviderProtocol(provider, model) || 'openai';
}

/** @returns {'openai'|'responses'|'gemini'|null} */
export function resolveConfiguredProviderProtocol(provider, model) {
  const modelId = normalizeText(model);
  const modelProtocol = normalizeText(provider?.modelProtocols?.[modelId]).toLowerCase();
  const providerProtocol = normalizeText(provider?.protocol).toLowerCase();
  if (modelProtocol) return SUPPORTED_PROVIDER_PROTOCOLS.has(modelProtocol) ? modelProtocol : null;
  return SUPPORTED_PROVIDER_PROTOCOLS.has(providerProtocol) ? providerProtocol : null;
}
