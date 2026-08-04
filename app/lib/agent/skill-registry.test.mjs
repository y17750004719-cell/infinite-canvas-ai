import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';

import {
  findDirectSkillMatches,
  getSkillManifest,
  hasDirectSkillExecutionIntent,
  listSkillManifests,
  loadSkillContent,
  resolveExplicitSkillDirective,
  selectSkillForPrompt,
  shouldInjectActiveSkill,
} from './skill-registry.mjs';

const projectRoot = path.resolve(import.meta.dirname, '../../..');

test('skill registry exposes only enabled skills backed by real directories', async () => {
  const skills = await listSkillManifests({ projectRoot });
  assert.deepEqual(skills.map((skill) => skill.id), ['api-helper', 'brand', 'gc-minimal-zine-poster-v0-1', 'logo', 'magazine-poster', 'modular-watercolor-collage-v0-1']);
  assert.equal(skills.every((skill) => skill.enabled), true);
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
  assert.match(magazine, /JSON\.parse/);
  const zine = await loadSkillContent('gc-minimal-zine-poster-v0-1', { projectRoot });
  assert.match(zine, /vertical 2:3 paper canvas/);
  const watercolor = await loadSkillContent('modular-watercolor-collage-v0-1', { projectRoot });
  assert.match(watercolor, /7-10 unequal irregular rectangular pigment fields/);
  assert.match(watercolor, /one continuous warm ivory/);
  assert.match(watercolor, /pigment stopping marks/);
  assert.match(watercolor, /no more than about 20%/);
  assert.match(watercolor, /### Reference mode/);
  assert.match(watercolor, /Inspect the image pixels/);
  assert.match(watercolor, /primary composition reference/);
  assert.match(watercolor, /3-4 offset main fields/);
  assert.match(watercolor, /Default to no typography/);
  assert.match(watercolor, /host keeps supplied reference items attached/);
  assert.match(watercolor, /38%-52% of the canvas width and 68%-78% of its height/);
  assert.match(watercolor, /14% clear paper remains on both sides/);
  assert.match(watercolor, /Never invent, retrieve, attach, or request a reference image/);
  assert.match(watercolor, /Write exactly four compact prose paragraphs/);
  assert.match(watercolor, /generation\.prompt/);
  assert.match(watercolor, /generation\.items/);
  assert.doesNotMatch(watercolor, /Generate the image/);
  assert.doesNotMatch(watercolor, /Quality Gate/);
  assert.doesNotMatch(watercolor, /at least two-thirds of the fragments square or near-square/);
  assert.doesNotMatch(watercolor, /absolute-image-path-or-rendered-image/);
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

test('modular watercolor collage skill compiles prompts for the host image pipeline', async () => {
  const manifest = await getSkillManifest('modular-watercolor-collage-v0-1', { projectRoot });
  assert.equal(manifest.executionMode, 'image_pipeline');
  assert.equal(manifest.promptStyle, 'text');
  assert.deepEqual(manifest.allowedTools, ['generate_image', 'get_canvas_context']);
  assert.match(manifest.generationContract, /9:16/);
  assert.match(manifest.generationContract, /7-10 fields/);
  assert.match(manifest.generationContract, /one continuous edge-to-edge handmade-paper surface/);
  assert.match(manifest.generationContract, /no three fields side by side/);
  assert.match(manifest.generationContract, /jagged open outer silhouette/);
  assert.match(manifest.generationContract, /actual pixels/);
  assert.match(manifest.generationContract, /38%-52% of the canvas width and 68%-78% of its height/);
  assert.match(manifest.generationContract, /14% clear paper on both sides/);
  assert.match(manifest.generationContract, /10% above and below/);
  assert.match(manifest.planningGuidance, /never invent, retrieve, attach, or request one/);
  assert.match(manifest.generationContract, /3-4 main fields/);
  assert.match(manifest.generationContract, /3-5 supporting fields/);
  assert.match(manifest.generationContract, /full horizontal field of view without cropping or stretching/);
  assert.match(manifest.generationContract, /generation\.prompt/);
  assert.match(manifest.generationContract, /generation\.items/);
  assert.match(manifest.generationContract, /Do not invoke image tools/);
  assert.match(manifest.planningGuidance, /gc-minimal-zine-poster-v0-1/);
});

test('minimal zine skill uses the direct image pipeline with plain-text prompts', async () => {
  const manifest = await getSkillManifest('gc-minimal-zine-poster-v0-1', { projectRoot });
  assert.equal(manifest.executionMode, 'image_pipeline');
  assert.equal(manifest.promptStyle, 'text');
  assert.deepEqual(manifest.allowedTools, ['generate_image', 'get_canvas_context']);
  assert.match(manifest.generationContract, /2:3/);
  assert.match(manifest.planningGuidance, /magazine-poster/);
});

test('magazine skill opts into the direct image pipeline and JSON text prompts', async () => {
  const manifest = await getSkillManifest('magazine-poster', { projectRoot });
  assert.equal(manifest.executionMode, 'image_pipeline');
  assert.equal(manifest.promptStyle, 'json-text');
  assert.match(manifest.generationContract, /supplier-ready prompt/i);
  assert.deepEqual(manifest.allowedTools, ['generate_image', 'get_canvas_context']);
  assert.match(manifest.description, /拼贴艺术编辑海报/);
  assert.match(manifest.planningGuidance, /typography-led cultural/i);
});
