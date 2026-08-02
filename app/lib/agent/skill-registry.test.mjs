import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';

import { getSkillManifest, listSkillManifests, loadSkillContent, selectSkillForPrompt } from './skill-registry.mjs';

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
  assert.match(watercolor, /7-10 irregular rectangular pigment fields/);
  assert.match(watercolor, /one continuous sheet/);
  assert.match(watercolor, /watercolor stopping marks/);
  assert.match(watercolor, /no more than about 20%/);
  assert.match(watercolor, /## Reference Image Mode/);
  assert.match(watercolor, /inspect the actual image pixels/);
  assert.match(watercolor, /hard anchors/);
  assert.match(watercolor, /primary composition reference/);
  assert.match(watercolor, /3-4 offset adjacent main fields/);
  assert.match(watercolor, /default to textless/);
  assert.match(watercolor, /pass the actual primary reference image to the image generator/);
  assert.match(watercolor, /38%-52% of the canvas width and 68%-78% of its height/);
  assert.match(watercolor, /14% of the canvas width clear on both left and right/);
  assert.match(watercolor, /never invent, retrieve, attach, or request a reference image/);
  assert.match(watercolor, /never removes the shared field-count, randomness, paper, material, whitespace, typography, or negative constraints/);
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

test('modular watercolor collage skill uses the image pipeline with plain-text prompts', async () => {
  const manifest = await getSkillManifest('modular-watercolor-collage-v0-1', { projectRoot });
  assert.equal(manifest.executionMode, 'image_pipeline');
  assert.equal(manifest.promptStyle, 'text');
  assert.deepEqual(manifest.allowedTools, ['generate_image', 'get_canvas_context']);
  assert.match(manifest.generationContract, /9:16/);
  assert.match(manifest.generationContract, /7-10 unequal rectangular pigment fields/);
  assert.match(manifest.generationContract, /one continuous paper surface/);
  assert.match(manifest.generationContract, /no three fields side by side/);
  assert.match(manifest.generationContract, /two pronounced side protrusions/);
  assert.match(manifest.generationContract, /jagged open outer silhouette/);
  assert.match(manifest.generationContract, /fills the canvas edge to edge/);
  assert.match(manifest.generationContract, /visible outer sheet edge or sheet shadow/);
  assert.match(manifest.generationContract, /independent cards/);
  assert.match(manifest.generationContract, /actual primary reference image attached/);
  assert.match(manifest.generationContract, /38%-52% of the canvas width and 68%-78% of its height/);
  assert.match(manifest.generationContract, /14% clear paper on both sides/);
  assert.match(manifest.generationContract, /10% above and below/);
  assert.match(manifest.generationContract, /Never create, attach, or request a reference image when none was supplied/);
  assert.match(manifest.planningGuidance, /Without references, retain every shared constraint/);
  assert.match(manifest.generationContract, /3-4 offset main fields/);
  assert.match(manifest.generationContract, /3-5 supporting fields/);
  assert.match(manifest.generationContract, /full horizontal field of view without cropping or stretching/);
  assert.match(manifest.generationContract, /no text unless supplied or requested/);
  assert.match(manifest.planningGuidance, /pigment stopping edges/);
  assert.match(manifest.planningGuidance, /at most two short aligned edge pairs/);
  assert.match(manifest.planningGuidance, /Reject independent cards/);
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
