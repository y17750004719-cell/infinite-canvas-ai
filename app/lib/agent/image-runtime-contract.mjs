export function assertImageExecutionContract(value = {}, _options = {}) {
  if (!value || typeof value !== 'object') throw new Error('Image execution arguments are invalid');
  const prompt = typeof value.prompt === 'string' ? value.prompt.trim() : '';
  if (!prompt) throw new Error('Main Agent generate_image call is missing the final prompt');
  return { ...value, prompt };
}
