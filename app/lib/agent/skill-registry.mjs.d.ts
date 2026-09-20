export interface SkillManifest {
  id: string;
  name: string;
  description: string;
  triggerHints: string[];
  internal?: boolean;
  directTriggerHints?: string[];
  allowedTools: string[];
  entryPrompt?: string;
  executionMode?: 'agent_loop' | 'image_pipeline';
  promptStyle?: 'text' | 'json-text';
  aspectRatio?: string;
  planningGuidance?: string;
  generationContract?: string;
  enabled: boolean;
}

export const IMAGEGEN_HOST_SKILL_ID: 'imagegen';
export function listSkillManifests(options?: { projectRoot?: string; includeInternal?: boolean }): Promise<SkillManifest[]>;
export function getSkillManifest(skillId: string, options?: { projectRoot?: string; includeInternal?: boolean }): Promise<SkillManifest>;
export function loadSkillContent(skillId: string, options?: { projectRoot?: string; includeInternal?: boolean }): Promise<string>;
export function resolveExplicitSkillDirective(prompt: string, manifests: SkillManifest[]):
  | { type: 'clear' }
  | { type: 'select'; manifest: SkillManifest }
  | null;
