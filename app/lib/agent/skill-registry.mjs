import path from 'node:path';
import { readFile, realpath } from 'node:fs/promises';
import { AGENT_IMAGE_ASPECT_RATIO_IDS } from './image-options.mjs';

export const IMAGEGEN_HOST_SKILL_ID = 'imagegen';

function resolveProjectRoot(options = {}) {
  return options.projectRoot || process.cwd();
}

function registryPath(projectRoot) {
  return path.join(projectRoot, 'skills', 'registry.json');
}

const normalizeMatchText = (value) => typeof value === 'string'
  ? value.trim().toLowerCase().replace(/\s+/g, ' ')
  : '';
const escapeRegExp = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const EXPLICIT_SKILL_BOUNDARY_START = String.raw`(?:^|[\s"'“”‘’([{（【<《，,。.!！?？:：;；])`;
const EXPLICIT_SKILL_BOUNDARY_END = String.raw`(?=$|[\s"'“”‘’\)\]}）】>》，,。.!！?？:：;；])`;

function isManifest(value) {
  return value &&
    typeof value.id === 'string' &&
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value.id) &&
    typeof value.name === 'string' &&
    typeof value.description === 'string' &&
    Array.isArray(value.triggerHints) &&
    (value.internal === undefined || typeof value.internal === 'boolean') &&
    (value.directTriggerHints === undefined || Array.isArray(value.directTriggerHints)) &&
    Array.isArray(value.allowedTools) &&
    (value.executionMode === undefined || ['agent_loop', 'image_pipeline'].includes(value.executionMode)) &&
    (value.promptStyle === undefined || ['text', 'json-text'].includes(value.promptStyle)) &&
    (value.aspectRatio === undefined || AGENT_IMAGE_ASPECT_RATIO_IDS.includes(value.aspectRatio)) &&
    (value.planningGuidance === undefined || typeof value.planningGuidance === 'string') &&
    (value.generationContract === undefined || typeof value.generationContract === 'string') &&
    (value.executionMode !== 'image_pipeline' || (typeof value.generationContract === 'string' && value.generationContract.trim().length > 0)) &&
    typeof value.enabled === 'boolean';
}

async function readRegistry(options = {}) {
  const projectRoot = resolveProjectRoot(options);
  const parsed = JSON.parse(await readFile(registryPath(projectRoot), 'utf8'));
  if (!Array.isArray(parsed) || !parsed.every(isManifest)) {
    throw new Error('Invalid skills registry');
  }
  return parsed;
}

export async function listSkillManifests(options = {}) {
  const projectRoot = resolveProjectRoot(options);
  const skillsRoot = await realpath(path.join(projectRoot, 'skills'));
  const manifests = (await readRegistry(options)).filter((item) => (
    item.enabled && (options.includeInternal === true || item.internal !== true)
  ));
  const result = [];
  for (const manifest of manifests) {
    const skillFile = path.join(skillsRoot, manifest.id, 'SKILL.md');
    try {
      const resolvedSkillFile = await realpath(skillFile);
      const relative = path.relative(skillsRoot, resolvedSkillFile);
      if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) continue;
      result.push({ ...manifest });
    } catch {
      // A registry entry is not public until its implementation exists.
    }
  }
  return result.sort((a, b) => a.id.localeCompare(b.id));
}

export async function getSkillManifest(skillId, options = {}) {
  const normalizedId = typeof skillId === 'string' ? skillId.trim() : '';
  const manifests = await listSkillManifests(options);
  const manifest = manifests.find((item) => item.id === normalizedId);
  if (!manifest) {
    throw new Error(`Unknown skill: ${normalizedId || '<empty>'}`);
  }
  return manifest;
}

export async function loadSkillContent(skillId, options = {}) {
  const projectRoot = resolveProjectRoot(options);
  const manifest = await getSkillManifest(skillId, options);
  const skillsRoot = await realpath(path.join(projectRoot, 'skills'));
  const skillFile = await realpath(path.join(skillsRoot, manifest.id, 'SKILL.md'));
  const relative = path.relative(skillsRoot, skillFile);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Skill path escapes skills root: ${manifest.id}`);
  }
  return readFile(skillFile, 'utf8');
}

export function resolveExplicitSkillDirective(prompt, manifests) {
  const source = normalizeMatchText(prompt);
  if (!source) return null;
  if (/(?:不使用|不要使用|取消|关闭|清除).{0,8}(?:skill|技能)|(?:普通模式|无\s*skill|no\s+skill)/i.test(source)) {
    return { type: 'clear' };
  }
  const explicitAction = /(?:使用|加载|调用|切换到|切换为|改用|use|load|switch\s+to)\s*/i;
  for (const manifest of Array.isArray(manifests) ? manifests : []) {
    if (manifest?.enabled === false) continue;
    const aliases = [manifest.id, manifest.name].map((value) => normalizeMatchText(value)).filter(Boolean);
    for (const alias of aliases) {
      const explicitId = new RegExp(`${EXPLICIT_SKILL_BOUNDARY_START}\\$${escapeRegExp(alias)}${EXPLICIT_SKILL_BOUNDARY_END}`, 'i');
      const exactAlias = new RegExp(`${EXPLICIT_SKILL_BOUNDARY_START}${escapeRegExp(alias)}${EXPLICIT_SKILL_BOUNDARY_END}`, 'i');
      const namedSelection = new RegExp(`${explicitAction.source}(?:\\$)?${escapeRegExp(alias)}${EXPLICIT_SKILL_BOUNDARY_END}`, 'i');
      if (explicitId.test(source) || exactAlias.test(source) || namedSelection.test(source)) {
        return { type: 'select', manifest };
      }
    }
    const normalizedPathSource = source.replaceAll('\\', '/');
    const skillUri = new RegExp(`${EXPLICIT_SKILL_BOUNDARY_START}skill://${escapeRegExp(manifest.id)}(?:/)?${EXPLICIT_SKILL_BOUNDARY_END}`, 'i');
    const skillFilePath = new RegExp(`(?:^|[\\s"'“”‘’([{（【<《])(?:[^\\s"'“”‘’<>]*?/)?skills/${escapeRegExp(manifest.id)}/skill\\.md(?=$|[\\s"'“”‘’\\)\\]}）】>》，,！?？:：;；])`, 'i');
    if (skillUri.test(normalizedPathSource) || skillFilePath.test(normalizedPathSource)) {
      return { type: 'select', manifest };
    }
  }
  return null;
}
