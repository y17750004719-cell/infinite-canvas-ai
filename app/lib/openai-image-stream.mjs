const text = (value) => typeof value === 'string' ? value.trim() : '';

export async function readOpenAiImageStream(response) {
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('text/event-stream')) {
    return { transport: 'json', completedPayload: await response.json(), partialPayload: null };
  }
  if (!response.body) throw new Error('OpenAI image stream body is empty');

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let completedPayload = null;
  let partialPayload = null;

  const consumeLine = (line) => {
    if (!line.startsWith('data:')) return;
    const data = text(line.slice(5));
    if (!data || data === '[DONE]') return;
    try {
      const payload = JSON.parse(data);
      if (payload?.type === 'image_generation.completed') completedPayload = payload;
      if (payload?.type === 'image_generation.partial_image') partialPayload = payload;
    } catch {
      // Ignore malformed keepalive or provider-specific stream events.
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || '';
    lines.forEach(consumeLine);
  }
  buffer += decoder.decode();
  if (buffer) consumeLine(buffer);
  return { transport: 'sse', completedPayload, partialPayload };
}
