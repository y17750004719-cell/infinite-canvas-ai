export interface SkillManifest {
  id: string;
  name: string;
  description: string;
  triggerHints: string[];
  allowedTools: string[];
  entryPrompt?: string;
  executionMode?: 'agent_loop' | 'image_pipeline';
  promptStyle?: 'text' | 'json-text';
  planningGuidance?: string;
  enabled: boolean;
}

export function listSkillManifests(options?: { projectRoot?: string }): Promise<SkillManifest[]>;
export function getSkillManifest(skillId: string, options?: { projectRoot?: string }): Promise<SkillManifest>;
export function loadSkillContent(skillId: string, options?: { projectRoot?: string }): Promise<string>;
export function selectSkillForPrompt(prompt: string, manifests: SkillManifest[]): SkillManifest | null;
