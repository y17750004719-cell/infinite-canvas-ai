import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';

import { getSkillManifest, listSkillManifests, loadSkillContent, selectSkillForPrompt } from './skill-registry.mjs';

const projectRoot = path.resolve(import.meta.dirname, '../../..');

test('skill registry exposes only enabled skills backed by real directories', async () => {
  const skills = await listSkillManifests({ projectRoot });
  assert.deepEqual(skills.map((skill) => skill.id), ['api-helper', 'brand', 'logo']);
  assert.equal(skills.every((skill) => skill.enabled), true);
});

test('skill registry rejects unknown and traversal ids', async () => {
  await assert.rejects(() => getSkillManifest('../brand', { projectRoot }), /Unknown skill/);
  await assert.rejects(() => loadSkillContent('missing', { projectRoot }), /Unknown skill/);
});

test('skill registry loads a registered SKILL.md inside the skills root', async () => {
  const content = await loadSkillContent('logo', { projectRoot });
  assert.match(content, /logo/i);
});

test('skill registry selects the most relevant enabled skill from trigger hints', async () => {
  const skills = await listSkillManifests({ projectRoot });
  assert.equal(selectSkillForPrompt('帮我做一套品牌 VI 和品牌物料', skills)?.id, 'brand');
  assert.equal(selectSkillForPrompt('生成一个咖啡店 Logo', skills)?.id, 'logo');
  assert.equal(selectSkillForPrompt('聊聊今天的灵感', skills), null);
});
