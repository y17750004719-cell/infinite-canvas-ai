import path from 'node:path';
import { readFile, realpath } from 'node:fs/promises';

function resolveProjectRoot(options = {}) {
  return options.projectRoot || process.cwd();
}

function registryPath(projectRoot) {
  return path.join(projectRoot, 'skills', 'registry.json');
}

function isManifest(value) {
  return value &&
    typeof value.id === 'string' &&
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value.id) &&
    typeof value.name === 'string' &&
    typeof value.description === 'string' &&
    Array.isArray(value.triggerHints) &&
    Array.isArray(value.allowedTools) &&
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
