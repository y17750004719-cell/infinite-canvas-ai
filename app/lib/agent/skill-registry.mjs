import path from 'node:path';
import { readFile, realpath } from 'node:fs/promises';
import { AGENT_IMAGE_ASPECT_RATIO_IDS } from './image-options.mjs';

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

function isManifest(value) {
  return value &&
    typeof value.id === 'string' &&
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value.id) &&
    typeof value.name === 'string' &&
    typeof value.description === 'string' &&
    Array.isArray(value.triggerHints) &&
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
  const manifests = (await readRegistry(options)).filter((item) => item.enabled);
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

export function resolveLockedSkillReadId(requestedSkillId, lockedSkillId = null) {
  const locked = typeof lockedSkillId === 'string' ? lockedSkillId.trim() : '';
  if (locked) return locked;
  return typeof requestedSkillId === 'string' ? requestedSkillId.trim() : '';
}

export function selectSkillForPrompt(prompt, manifests) {
  const text = typeof prompt === 'string' ? prompt.toLowerCase() : '';
  let best = null;
  let bestScore = 0;
  for (const manifest of Array.isArray(manifests) ? manifests : []) {
    if (!manifest?.enabled) continue;
    const score = manifest.triggerHints.reduce(
      (total, hint) => total + (text.includes(String(hint).toLowerCase()) ? String(hint).length : 0),
      0,
    );
    if (score > bestScore) {
      best = manifest;
      bestScore = score;
    }
  }
  return best;
}

export function findDirectSkillMatches(prompt, manifests) {
  const source = normalizeMatchText(prompt);
  if (!source) return [];
  return (Array.isArray(manifests) ? manifests : [])
    .filter((manifest) => manifest?.enabled !== false)
    .map((manifest) => {
      const matchedHints = (Array.isArray(manifest.directTriggerHints) ? manifest.directTriggerHints : [])
        .map((hint) => String(hint).trim())
        .filter((hint) => hint && source.includes(normalizeMatchText(hint)));
      return {
        manifest,
        matchedHints,
        score: matchedHints.reduce((total, hint) => total + hint.length, 0),
      };
    })
    .filter((entry) => entry.matchedHints.length > 0)
    .sort((left, right) => right.score - left.score || left.manifest.id.localeCompare(right.manifest.id));
}

export function hasDirectSkillExecutionIntent(prompt) {
  const value = typeof prompt === 'string' ? prompt.trim() : '';
  if (!value) return false;
  if (/(是什么|为什么|怎么做|如何做|介绍|聊聊|讨论|解释)/i.test(value)
    && !/(帮我|请|给我|为我|把|将|开始|继续)/i.test(value)) return false;
  if (/(生成|制作|做成|做个|做一个|做一|创建|绘制|画一|表现|出图|编辑|修改|改成|改为|改造|优化|实现|执行|开始(?:执行|制作|生成|设计)?|继续(?:执行|制作|生成|设计|处理)?|输出|编写|整理|梳理|generate|create|design|make|edit|modify|continue|implement|execute|produce)/i.test(value)) {
    return true;
  }
  return /(?:分析|查阅|解析|检查).{0,20}(?:api|接口).{0,20}(?:文档)?/i.test(value);
}

export function shouldInjectActiveSkill(prompt, manifest) {
  if (!manifest) return false;
  const value = typeof prompt === 'string' ? prompt.trim().toLowerCase() : '';
  if (!value) return false;
  if (hasDirectSkillExecutionIntent(value)) return true;
  if (/(?:按|照|根据).{0,24}(?:做|生成|制作|设计|处理|改)/i.test(value)) return true;
  const mentionsSelectedSkill = [manifest.id, manifest.name, ...(manifest.directTriggerHints || [])]
    .some((token) => token && value.includes(normalizeMatchText(token)));
  const referencesCurrentSkill = /(?:这个|当前|已选|选中的).{0,4}(?:skill|技能)|(?:skill|技能).{0,8}(?:规则|正文|提示词|工作流|流程|边界|约束|风格|怎么|如何)/i.test(value);
  return (mentionsSelectedSkill || referencesCurrentSkill)
    && /(skill|技能|规则|正文|提示词|工作流|流程|边界|约束|风格|怎么|如何|讨论|解释|分析)/i.test(value);
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
      const explicitId = new RegExp(`(?:^|\\s)\\$${escapeRegExp(alias)}(?=$|\\s|[，,。.!！?？])`, 'i');
      const exactAlias = new RegExp(`(?:^|\\s)${escapeRegExp(alias)}(?=$|\\s|[，,。.!！?？])`, 'i');
      const namedSelection = new RegExp(`${explicitAction.source}(?:\\$)?${escapeRegExp(alias)}(?=$|\\s|[，,。.!！?？])`, 'i');
      if (explicitId.test(source) || exactAlias.test(source) || namedSelection.test(source)) {
        return { type: 'select', manifest };
      }
    }
  }
  return null;
}
