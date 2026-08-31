# Skill Rules

## Manifest Contract

- Every image Skill has a stable Skill ID and a `SKILL.md` entry point.
- `image_pipeline` Skills must provide `planningGuidance`, `generationContract`, and `promptStyle` that the Main Agent can apply directly when producing the final provider Prompt. They are no longer a contract for an independent Planner.
- `agent_loop` Skills must provide an explicit entry flow, allowed tools, and confirmation boundary instead of an image prompt compiler contract.
- Skill manifests must declare the execution mode and required capabilities explicitly.
- Skill configuration belongs in the Skill manifest or its existing config file; do not add hidden runtime constants in route handlers.

## Prompt Boundaries

- Image Skills are selected only by explicit UI selection, `$skill`, a Skill path, or an exact manifest ID/name. Trigger hints may support discovery but must not automatically select a visual Skill for an image Turn.
- When an Image Skill is locked for a Turn, runtime injects its complete `SKILL.md` as an independent user `<skill>` fragment after `imagegen`, subject to the documented 8KB UTF-8 budget and truncation telemetry. The fragment is Main Agent context, never provider context.
- Do not include API keys, account credentials, machine-specific paths, or private provider configuration in a Skill.
- Do not expose internal reasoning, raw tool arguments, or complete hidden prompts as public progress text.
- Keep provider protocol details out of Skill contracts; provider selection and request translation belong to the provider layer.

## Asset and Reference Rules

- Skills may consume only validated reference images and stable context IDs supplied by the Agent contract.
- Skills must not infer an asset from conversational position or unverified shorthand.
- Generated assets must use the existing local delivery and persistence path.
- Multi-asset Skills must use the Main Agent `generate_image` batch/series contract and unified asset events.

## Configuration

- Provider, model, image size, aspect ratio, and output count must pass through the existing provider selection and capability resolution helpers.
- Do not create a Skill-specific provider protocol or bypass the unified image execution contract.
- Keep `skills/registry.json` and per-Skill configuration consistent with the actual `SKILL.md` files.
- Internal host Skills are execution dependencies and must not participate in ordinary Skill selection. `imagegen` is loaded for every image Turn; an absent explicit visual selection does not imply a fallback visual Skill.

## Verification

- Run Skill registry and Skill structure tests after changing a manifest or `SKILL.md` contract.
- Run the relevant image generation and asset-event tests after changing execution behavior.
- Validate that no credential-looking values or machine-specific paths were added.
- Keep Skill changes reviewable; do not combine unrelated prompt rewrites with execution changes.
