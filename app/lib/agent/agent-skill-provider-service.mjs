import { createHash } from 'node:crypto';
import { IMAGEGEN_HOST_SKILL_ID, listSkillManifests, loadSkillContent } from './skill-registry.mjs';
import { readProviderRegistry } from '../provider-config.mjs';
import { resolveProviderModelSelection, resolveProviderSelection } from '../provider-model-selection.mjs';
import { buildProviderImageOptionProfiles } from '../image-provider-option-profiles.mjs';
import { fingerprintProviderModel } from './confirmation-continuation.mjs';

const hashText = (value) => createHash('sha256').update(String(value || '')).digest('hex');

/**
 * Unified request-scoped boundary for application Skills and chat/image
 * provider selection. It performs no Native work and owns no persistence.
 */
export function createAgentSkillProviderService(dependencies = {}) {
  const listSkills = dependencies.listSkillManifests || listSkillManifests;
  const loadSkill = dependencies.loadSkillContent || loadSkillContent;
  const readProviders = dependencies.readProviderRegistry || readProviderRegistry;
  const selectProviderModel = dependencies.resolveProviderModelSelection || resolveProviderModelSelection;
  const resolveSelection = dependencies.resolveProviderSelection || resolveProviderSelection;
  const onDiagnostic = dependencies.onDiagnostic;
  const buildImageProfiles = dependencies.buildProviderImageOptionProfiles || buildProviderImageOptionProfiles;
  return {
    listSkillManifests: (options = {}) => listSkills(options),
    async loadSkillContent(skillId, options = {}) {
      const content = await loadSkill(skillId, options);
      if (!String(content || '').trim()) throw new Error('skill_empty');
      return String(content);
    },
    async loadSkillSnapshot(skillId, options = {}) {
      const content = await this.loadSkillContent(skillId, options);
      return { content, contentHash: hashText(content) };
    },
    async assertLockedSkill(skill, expectedHash = null) {
      if (!skill) return { content: '', contentHash: '' };
      if (skill.executionMode !== 'image_pipeline' || !skill.allowedTools?.includes('generate_image')) {
        throw new Error('The locked Skill is not allowed to generate images');
      }
      const loaded = await this.loadSkillSnapshot(skill.id);
      if (expectedHash && expectedHash !== loaded.contentHash) {
        throw new Error('The locked Skill content changed after this task was created');
      }
      return loaded;
    },
    async prepareProviderSelection({ body = {}, purpose = 'chat', onDiagnostic: requestDiagnostic } = {}) {
      const providers = (await readProviders()).providers;
      const requestedModel = purpose === 'image'
        ? body.imageOptions?.model
        : body.chatOptions?.model || process.env.AGENT_CHAT_MODEL || undefined;
      const requestedProviderId = purpose === 'image'
        ? body.imageOptions?.providerId
        : body.chatOptions?.providerId || process.env.AGENT_CHAT_PROVIDER_ID;
      const explicit = purpose === 'chat'
        ? Boolean(body.chatOptions?.providerId || body.chatOptions?.model)
        : Boolean(body.imageOptions?.providerId || body.imageOptions?.model);
      const selection = selectProviderModel({
        providers,
        purpose,
        requestedProviderId,
        requestedModel,
        allowFallback: !explicit,
        excludeUnavailable: true,
      });
      const resolvedSelection = resolveSelection({
        providers,
        purpose,
        requestedProviderId,
        requestedModel,
        allowFallback: !explicit,
        excludeUnavailable: true,
        onDiagnostic: requestDiagnostic || onDiagnostic,
      });
      const provider = providers.find((candidate) => candidate.id === selection.providerId) || null;
      return {
        providers,
        provider,
        selection,
        resolvedSelection,
        providerImageOptionProfiles: buildImageProfiles(providers),
        fingerprint: resolvedSelection.providerFingerprint || (provider && selection.model
          ? fingerprintProviderModel(provider, selection.model, purpose)
          : ''),
      };
    },
    fingerprintProviderModel,
  };
}

export const agentSkillProviderService = createAgentSkillProviderService();
export { IMAGEGEN_HOST_SKILL_ID };
