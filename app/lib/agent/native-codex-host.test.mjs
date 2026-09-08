import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, writeFile, readFile, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { nativeConfig, nativeProviderFingerprint, assertNativeModelAdmission, prepareNativeTurnInput, NATIVE_SOURCE_COMMIT } from './native-codex-host.mjs';

const provider = { id: 'fixture', model: 'vision-model', baseUrl: 'http://127.0.0.1:1/v1', protocol: 'openai' };
async function directory(t) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'native-host-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}
test('native config uses Responses and disables non-business tools without embedding credentials', () => {
  const config = nativeConfig({ ...provider, apiKey: 'secret-not-in-config' });
  assert.match(config, /wire_api = "responses"/);
  assert.match(config, /\[orchestrator.skills\]\nenabled = false/);
  assert.match(config, /\[skills.bundled\]\nenabled = false/);
  assert.match(config, /image_generation = false/);
  assert.doesNotMatch(config, /secret-not-in-config/);
  assert.throws(() => nativeConfig({ ...provider, baseUrl: 'http://user:password@localhost/' }), /native_provider_url_invalid/);
});
test('OpenAI-shaped settings alone never prove Responses compatibility', async (t) => {
  await assert.rejects(assertNativeModelAdmission(provider, await directory(t)), /native_model_not_validated/);
  await assert.rejects(assertNativeModelAdmission({ ...provider, protocol: 'gemini' }, await directory(t)), /native_protocol_unsupported/);
});
test('admission binds checked capabilities to model, URL and pinned native source', async (t) => {
  const root = await directory(t);
  const record = { fingerprint: nativeProviderFingerprint(provider), sourceCommit: NATIVE_SOURCE_COMMIT, wireApi: 'responses',
    checks: { streaming: true, toolContinuation: true, vision: true, cancellation: true, errors: true } };
  await writeFile(join(root, 'model-compatibility.json'), JSON.stringify({ models: [record] }));
  await assertNativeModelAdmission(provider, root);
  await assert.rejects(assertNativeModelAdmission({ ...provider, model: 'another-model' }, root), /native_model_not_validated/);
  record.checks.vision = false;
  await writeFile(join(root, 'model-compatibility.json'), JSON.stringify({ models: [record] }));
  await assert.rejects(assertNativeModelAdmission(provider, root), /native_model_not_validated/);
});
test('locked Skills become immutable canonical snapshots, not arbitrary model paths', async (t) => {
  const root = await directory(t);
  const content = 'Preserve reference geometry.';
  const host = { privateHome: root, cwd: root, client: { request: async () => ({}) } };
  const args = { userText: 'Generate from my image', skills: [{ id: '../../outside', content,
    hash: createHash('sha256').update(content).digest('hex') }] };
  const input = await prepareNativeTurnInput(host, args);
  const skill = input.find((item) => item.type === 'skill');
  assert.ok(skill.path.startsWith(`${root}/skills/application-`));
  assert.equal(await realpath(skill.path), skill.path);
  assert.ok((await readFile(skill.path, 'utf8')).includes(content));
  assert.deepEqual(await prepareNativeTurnInput(host, args), input);
});
test('Skill hash mismatch and native truncation fail before tool execution', async (t) => {
  const root = await directory(t);
  const host = { privateHome: root, cwd: root, client: { request: async () => ({}) } };
  await assert.rejects(prepareNativeTurnInput(host, { userText: 'x', skills: [{ id: 's', content: 'rules', hash: 'wrong' }] }), /native_skill_hash_mismatch/);
  await assert.rejects(prepareNativeTurnInput(host, { userText: 'x', skills: [{ id: 's', content: 'x'.repeat(8000) }] }), /native_skill_context_limit/);
});
test('remote image URLs cannot be passed as native image input', async () => {
  await assert.rejects(prepareNativeTurnInput({}, { userText: 'x', images: ['https://example.com/image.png'] }), /native_image_input_invalid/);
});
test('a data URL with corrupt image bytes fails instead of silently losing the reference', async () => {
  await assert.rejects(prepareNativeTurnInput({}, { userText: 'x', images: ['data:image/png;base64,YWJj'] }), /native_image_payload_invalid/);
});
test('empty user context fails explicitly', async () => {
  await assert.rejects(prepareNativeTurnInput({}, { userText: '' }), /native_user_message_required/);
});
