const SUPPORTED_PROVIDER_PROTOCOLS = new Set(['openai', 'gemini']);

function normalizeText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

export function effectiveProviderProtocol(provider, model) {
  const modelId = normalizeText(model);
  const modelProtocol = provider?.modelProtocols?.[modelId];
  if (SUPPORTED_PROVIDER_PROTOCOLS.has(modelProtocol)) {
    return modelProtocol;
  }
  return SUPPORTED_PROVIDER_PROTOCOLS.has(provider?.protocol) ? provider.protocol : 'openai';
}
