import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';

import {
  IMAGEGEN_HOST_SKILL_ID,
  findDirectSkillMatches,
  getSkillManifest,
  hasDirectSkillExecutionIntent,
  listSkillManifests,
  loadSkillContent,
  resolveLockedSkillReadId,
  resolveExplicitSkillDirective,
  selectSkillForPrompt,
  shouldInjectActiveSkill,
} from './skill-registry.mjs';

const projectRoot = path.resolve(import.meta.dirname, '../../..');

test('skill registry exposes only enabled skills backed by real directories', async () => {
  const skills = await listSkillManifests({ projectRoot });
  assert.deepEqual(skills.map((skill) => skill.id), ['api-helper', 'brand', 'gc-minimal-zine-poster-v0-1', 'logo', 'magazine-poster', 'modular-watercolor-collage-v0-1']);
  assert.equal(skills.every((skill) => skill.enabled), true);
  assert.equal(skills.some((skill) => skill.id === IMAGEGEN_HOST_SKILL_ID), false);
});

test('the internal ImageGen host is available only to the image runtime', async () => {
  await assert.rejects(() => getSkillManifest(IMAGEGEN_HOST_SKILL_ID, { projectRoot }), /Unknown skill/);
  await assert.rejects(() => loadSkillContent(IMAGEGEN_HOST_SKILL_ID, { projectRoot }), /Unknown skill/);

  const manifests = await listSkillManifests({ projectRoot, includeInternal: true });
  const host = manifests.find((skill) => skill.id === IMAGEGEN_HOST_SKILL_ID);
  assert.equal(host?.internal, true);
  assert.deepEqual(host?.allowedTools, ['generate_image']);

  const content = await loadSkillContent(IMAGEGEN_HOST_SKILL_ID, { projectRoot, includeInternal: true });
  assert.match(content, /request is detailed, normalize/i);
  assert.match(content, /what changes and what remains unchanged/i);
  assert.doesNotMatch(content, /image_gen|OPENAI_API_KEY|output path/i);
});

test('skill registry rejects unknown and traversal ids', async () => {
  await assert.rejects(() => getSkillManifest('../brand', { projectRoot }), /Unknown skill/);
  await assert.rejects(() => loadSkillContent('missing', { projectRoot }), /Unknown skill/);
  await assert.rejects(() => loadSkillContent('botanical-paper-collage-v0-1', { projectRoot }), /Unknown skill/);
});

test('skill registry loads a registered SKILL.md inside the skills root', async () => {
  const content = await loadSkillContent('logo', { projectRoot });
  assert.match(content, /logo/i);
  const magazine = await loadSkillContent('magazine-poster', { projectRoot });
  assert.match(magazine, /visual professional knowledge/i);
  assert.match(magazine, /publication concept/i);
  assert.doesNotMatch(magazine, /JSON\.parse|Output Format|### Quality Gate|generate_image/i);
  const zine = await loadSkillContent('gc-minimal-zine-poster-v0-1', { projectRoot });
  assert.match(zine, /70%-90% quiet paper/);
  assert.match(zine, /one clear high-chroma ink anchor/);
  assert.doesNotMatch(zine, /Write the final Standard Mode prompt|four compact paragraphs|### Quality Gate/i);
  const watercolor = await loadSkillContent('modular-watercolor-collage-v0-1', { projectRoot });
  assert.match(watercolor, /7-10 fields/);
  assert.match(watercolor, /continuous warm ivory/);
  assert.match(watercolor, /pigment stopping marks/);
  assert.match(watercolor, /actual reference subjects/i);
  assert.match(watercolor, /one readable subject/i);
  assert.doesNotMatch(watercolor, /Write exactly|generation\.prompt|generation\.items|### Quality Gate|generate_image/i);
});

test('locked Skill reads ignore a conflicting model-selected ID', () => {
  assert.equal(
    resolveLockedSkillReadId('magazine-poster', 'gc-minimal-zine-poster-v0-1'),
    'gc-minimal-zine-poster-v0-1',
  );
  assert.equal(resolveLockedSkillReadId(' magazine-poster ', null), 'magazine-poster');
});

test('skill registry selects the most relevant enabled skill from trigger hints', async () => {
  const skills = await listSkillManifests({ projectRoot });
  assert.equal(selectSkillForPrompt('帮我做一套品牌 VI 和品牌物料', skills)?.id, 'brand');
  assert.equal(selectSkillForPrompt('生成一个咖啡店 Logo', skills)?.id, 'logo');
  assert.equal(selectSkillForPrompt('设计一套高级杂志封面', skills)?.id, 'magazine-poster');
  assert.equal(selectSkillForPrompt('做一张留白充足的旧纸 ZINE 海报', skills)?.id, 'gc-minimal-zine-poster-v0-1');
  assert.equal(selectSkillForPrompt('用模块化水彩宫格表现一座旧城', skills)?.id, 'modular-watercolor-collage-v0-1');
  assert.equal(selectSkillForPrompt('把人物肖像做成不规则水彩色块拼贴', skills)?.id, 'modular-watercolor-collage-v0-1');
  assert.equal(selectSkillForPrompt('做一张东方水彩纸本拼贴植物海报', skills)?.id, 'modular-watercolor-collage-v0-1');
  assert.equal(selectSkillForPrompt('把这张参考图做成参考图模块水彩', skills)?.id, 'modular-watercolor-collage-v0-1');
  assert.equal(selectSkillForPrompt('Create a reference-guided watercolor collage from this garden photo', skills)?.id, 'modular-watercolor-collage-v0-1');
  assert.equal(selectSkillForPrompt('帮我修改这张参考图', skills), null);
  assert.equal(selectSkillForPrompt('聊聊今天的灵感', skills), null);
});

test('skill registry exposes curated direct triggers separately from general routing hints', async () => {
  const skills = await listSkillManifests({ projectRoot });
  const watercolor = skills.find((skill) => skill.id === 'modular-watercolor-collage-v0-1');
  assert.ok(watercolor?.directTriggerHints?.includes('模块化水彩'));
  assert.deepEqual(
    findDirectSkillMatches('请设计一张模块化水彩海报', skills).map((entry) => entry.manifest.id),
    ['modular-watercolor-collage-v0-1'],
  );
  assert.deepEqual(
    findDirectSkillMatches('请设计一张模块化水彩杂志封面', skills).map((entry) => entry.manifest.id),
    ['modular-watercolor-collage-v0-1', 'magazine-poster'],
  );
  assert.deepEqual(findDirectSkillMatches('按这张参考图的风格做', skills), []);
  assert.equal(hasDirectSkillExecutionIntent('做一张模块化水彩海报'), true);
  assert.equal(hasDirectSkillExecutionIntent('帮我分析这份 API 文档'), true);
  assert.equal(hasDirectSkillExecutionIntent('讨论一下模块化水彩的特点'), false);
  assert.equal(hasDirectSkillExecutionIntent('按这张参考图的风格做'), false);
  assert.equal(shouldInjectActiveSkill('继续制作下一张', watercolor), true);
  assert.equal(shouldInjectActiveSkill('按这张参考图的风格做', watercolor), true);
  assert.equal(shouldInjectActiveSkill('这个 Skill 的边界规则是什么？', watercolor), true);
  assert.equal(shouldInjectActiveSkill('你好，今天天气怎么样？', watercolor), false);
});

test('image pipeline manifests retain their compiler contracts', async () => {
  const skills = await listSkillManifests({ projectRoot });
  const zine = skills.find((skill) => skill.id === 'gc-minimal-zine-poster-v0-1');
  assert.equal(zine?.promptStyle, 'text');
  assert.match(zine?.planningGuidance || '', /sparse Japanese or Korean indie zine posters/);
  assert.match(zine?.generationContract || '', /four compact plain-text paragraphs/);
  assert.equal(Object.hasOwn(zine || {}, 'promptAssertions'), false);
});

test('explicit textual skill directives select, switch, or clear without a model call', async () => {
  const skills = await listSkillManifests({ projectRoot });
  const byId = resolveExplicitSkillDirective(
    '请使用 modular-watercolor-collage-v0-1 生成一张图',
    skills,
  );
  assert.equal(byId?.type, 'select');
  assert.equal(byId?.manifest.id, 'modular-watercolor-collage-v0-1');
  const byName = resolveExplicitSkillDirective('切换到 Modular Watercolor Collage', skills);
  assert.equal(byName?.type, 'select');
  assert.equal(byName?.manifest.id, 'modular-watercolor-collage-v0-1');
  const exactName = resolveExplicitSkillDirective('Modular Watercolor Collage 做一张旧城海报', skills);
  assert.equal(exactName?.type, 'select');
  assert.equal(exactName?.manifest.id, 'modular-watercolor-collage-v0-1');
  assert.deepEqual(resolveExplicitSkillDirective('这次不使用 Skill，普通模式处理', skills), { type: 'clear' });
  assert.equal(resolveExplicitSkillDirective('讨论一下模块化水彩的特点', skills), null);
});

test('modular watercolor collage retains its image compiler contract', async () => {
  const manifest = await getSkillManifest('modular-watercolor-collage-v0-1', { projectRoot });
  assert.equal(manifest.executionMode, 'image_pipeline');
  assert.equal(manifest.aspectRatio, '9:16');
  assert.deepEqual(manifest.allowedTools, ['generate_image', 'get_canvas_context']);
  assert.equal(manifest.promptStyle, 'text');
  assert.match(manifest.generationContract, /7-10 fields/);
  assert.match(manifest.planningGuidance, /without visualSummary, do not invent reference-specific facts/);
});

test('minimal zine skill retains its image compiler contract', async () => {
  const manifest = await getSkillManifest('gc-minimal-zine-poster-v0-1', { projectRoot });
  assert.equal(manifest.executionMode, 'image_pipeline');
  assert.equal(manifest.aspectRatio, '2:3');
  assert.deepEqual(manifest.allowedTools, ['generate_image', 'get_canvas_context']);
  assert.equal(manifest.promptStyle, 'text');
  assert.match(manifest.generationContract, /four compact plain-text paragraphs/);
  assert.match(manifest.generationContract, /70%-90%/);
});

test('magazine skill retains its JSON compiler contract', async () => {
  const manifest = await getSkillManifest('magazine-poster', { projectRoot });
  assert.equal(manifest.executionMode, 'image_pipeline');
  assert.deepEqual(manifest.allowedTools, ['generate_image', 'get_canvas_context']);
  assert.match(manifest.description, /编辑海报/);
  assert.equal(manifest.promptStyle, 'json-text');
  assert.match(manifest.generationContract, /valid JSON object/i);
  assert.match(manifest.generationContract, /editorial_direction/);
});
