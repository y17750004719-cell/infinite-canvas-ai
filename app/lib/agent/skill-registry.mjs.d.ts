export interface SkillManifest {
  id: string;
  name: string;
  description: string;
  triggerHints: string[];
  directTriggerHints?: string[];
  allowedTools: string[];
  entryPrompt?: string;
  executionMode?: 'agent_loop' | 'image_pipeline';
  promptStyle?: 'text' | 'json-text';
  planningGuidance?: string;
  generationContract?: string;
  enabled: boolean;
}

export function listSkillManifests(options?: { projectRoot?: string }): Promise<SkillManifest[]>;
export function getSkillManifest(skillId: string, options?: { projectRoot?: string }): Promise<SkillManifest>;
export function loadSkillContent(skillId: string, options?: { projectRoot?: string }): Promise<string>;
export function selectSkillForPrompt(prompt: string, manifests: SkillManifest[]): SkillManifest | null;
export function findDirectSkillMatches(prompt: string, manifests: SkillManifest[]): Array<{
  manifest: SkillManifest;
  matchedHints: string[];
  score: number;
}>;
export function hasDirectSkillExecutionIntent(prompt: string): boolean;
export function shouldInjectActiveSkill(prompt: string, manifest: SkillManifest | null): boolean;
export function resolveExplicitSkillDirective(prompt: string, manifests: SkillManifest[]):
  | { type: 'clear' }
  | { type: 'select'; manifest: SkillManifest }
  | null;
