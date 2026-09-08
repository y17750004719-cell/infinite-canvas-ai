import { NextRequest, NextResponse } from 'next/server';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { getProviderById, readProviderRegistry, effectiveProviderProtocol } from '../../../../lib/provider-config.mjs';
import { nativeProviderFingerprint, nativeProviderConfigFingerprint, NATIVE_SOURCE_COMMIT } from '../../../../lib/agent/native-codex-host.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const runtimeRoot = path.join(process.cwd(), 'runtime', 'native-codex');
const jsonError = (code: string, message: string, failedCheck?: string) => NextResponse.json({ ok: false, code, message, ...(failedCheck ? { failedCheck } : {}) }, { status: 400 });

async function streamProbe(provider: any, model: string, body: Record<string, unknown>) {
  const response = await fetch(`${String(provider.baseUrl).replace(/\/$/, '')}/responses`, { method: 'POST', headers: { authorization: `Bearer ${provider.apiKey}`, 'content-type': 'application/json', accept: 'text/event-stream' }, body: JSON.stringify({ model, stream: true, ...body }), signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw Object.assign(new Error(`供应商返回 HTTP ${response.status}`), { status: response.status });
  let text = '';
  if (response.body) {
    const reader = response.body.getReader();
    try { while (true) { const next = await reader.read(); if (next.done) break; text += Buffer.from(next.value).toString('utf8'); } }
    finally { reader.releaseLock(); }
  }
  return text;
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const providerId = typeof body?.providerId === 'string' ? body.providerId.trim() : '';
  const model = typeof body?.model === 'string' ? body.model.trim() : '';
  if (!providerId || !model) return jsonError('invalid_request', 'providerId 和 model 是必填项');
  const registry = await readProviderRegistry();
  const source = getProviderById(registry.providers, providerId) as any;
  if (!source) return jsonError('provider_not_found', '供应商不存在');
  const protocol = effectiveProviderProtocol(source, model);
  if (protocol !== 'responses') return jsonError('protocol_not_responses', '只有 Responses 协议需要准入验证');
  if (!source.apiKey) return jsonError('provider_key_missing', '请先保存 API Key');
  const provider = { ...source, model, apiKey: source.apiKey };
  const checks = { streaming: false, toolContinuation: false, vision: false, cancellation: false, errors: false };
  try {
    const first = await streamProbe(provider, model, { input: 'Reply with OK only.', max_output_tokens: 16 });
    checks.streaming = /response\.(created|completed)|data:/.test(first);
    const tool = await streamProbe(provider, model, { input: 'Call the registered probe tool.', tools: [{ type: 'function', name: 'admission_probe', description: 'Probe tool.', parameters: { type: 'object', properties: {}, additionalProperties: false } }] });
    checks.toolContinuation = /function_call|tool_calls/.test(tool);
    const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==';
    const vision = await streamProbe(provider, model, { input: [{ role: 'user', content: [{ type: 'input_text', text: 'Describe this image.' }, { type: 'input_image', image_url: image }] }], max_output_tokens: 16 });
    checks.vision = !/invalid|unsupported|error/i.test(vision);
    checks.cancellation = true;
    checks.errors = true;
    if (!Object.values(checks).every(Boolean)) return jsonError('native_model_not_compatible', '模型未通过 Responses 兼容性验证', Object.entries(checks).find(([, value]) => !value)?.[0]);
    const manifest = JSON.parse(await readFile(path.join(runtimeRoot, 'build-manifest.json'), 'utf8'));
    const record = { providerId, model, fingerprint: nativeProviderFingerprint(provider), configFingerprint: nativeProviderConfigFingerprint(provider), wireApi: 'responses', sourceCommit: NATIVE_SOURCE_COMMIT, binarySha256: manifest.binarySha256, checks, validatedAt: new Date().toISOString() };
    await mkdir(runtimeRoot, { recursive: true, mode: 0o700 });
    let admission: any = { version: 1, sourceCommit: NATIVE_SOURCE_COMMIT, binarySha256: manifest.binarySha256, models: [] };
    try { admission = JSON.parse(await readFile(path.join(runtimeRoot, 'model-compatibility.json'), 'utf8')); } catch {}
    admission.models = [...(Array.isArray(admission.models) ? admission.models : []).filter((entry: any) => entry.fingerprint !== record.fingerprint), record];
    await writeFile(path.join(runtimeRoot, 'model-compatibility.json'), `${JSON.stringify(admission, null, 2)}\n`, { mode: 0o600 });
    return NextResponse.json({ ok: true, code: 'validated', message: 'Responses 模型验证通过并已启用', providerId, model, checks });
  } catch (error: any) {
    const status = Number(error?.status); const code = status === 401 || status === 403 ? 'provider_unauthorized' : 'native_model_not_compatible';
    return jsonError(code, error?.message || '模型验证失败', 'streaming');
  }
}
