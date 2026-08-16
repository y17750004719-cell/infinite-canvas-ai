const TINY_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL6nAAAAABJRU5ErkJggg==';
const required = (name) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing ${name}`);
  return value;
};

async function main() {
  if (process.env.IMAGE_SMOKE_CONFIRM !== '1') {
    throw new Error('Set IMAGE_SMOKE_CONFIRM=1 before running a paid supplier image smoke test');
  }
  const providerId = required('IMAGE_SMOKE_PROVIDER_ID');
  const model = required('IMAGE_SMOKE_MODEL');
  const withReference = process.env.IMAGE_SMOKE_REFERENCE === '1';
  const baseUrl = (process.env.IMAGE_SMOKE_BASE_URL?.trim() || 'http://127.0.0.1:3001').replace(/\/$/, '');
  const startedAt = Date.now();
  const prompt = [
    'Create a single small editorial poster titled ZO TEST.',
    'One cobalt geometric mark on a warm off-white paper field with abundant negative space.',
    'Literal copy: ZO TEST. Keep typography sparse and readable.',
    'Matte scanned-paper texture, flat diffuse light; no mockup, no logo other than the literal copy, no extra text.',
  ].join('\n\n');
  try {
    const response = await fetch(`${baseUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-z-flow-image-planner': '1' },
      body: JSON.stringify({
        messages: [{ role: 'user', content: prompt }], intent: 'image', providerId, imageProviderId: providerId, model,
        reference_images: withReference ? [TINY_PNG] : [],
        size: process.env.IMAGE_SMOKE_SIZE?.trim() || '1024x1024',
        aspect_ratio: process.env.IMAGE_SMOKE_ASPECT_RATIO?.trim() || '1:1', n: 1, cancelWithRequest: true,
      }),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || payload?.status !== 'completed') throw new Error(payload?.error || `Image API failed (${response.status})`);
    const imageCount = Array.isArray(payload?.result?.data) ? payload.result.data.filter((image) => (
      typeof image?.url === 'string' && image.url.trim()
    )).length : 0;
    if (imageCount === 0) throw new Error('Supplier completed without a usable image URL');
    console.log(JSON.stringify({
      status: 'passed', providerId, model, withReference, baseUrl, durationMs: Date.now() - startedAt, imageCount,
    }, null, 2));
  } catch (error) {
    console.error(JSON.stringify({
      status: 'failed', providerId, model, withReference, durationMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error), failureClass: 'unknown', retryable: false, retryAttempt: null,
    }, null, 2));
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(JSON.stringify({
    status: 'blocked',
    error: error instanceof Error ? error.message : String(error),
  }, null, 2));
  process.exitCode = 1;
});
