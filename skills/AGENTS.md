# Skill Rules

## Manifest Contract

- Every image Skill has a stable Skill ID and a `SKILL.md` entry point.
- `image_pipeline` Skills must provide `planningGuidance`, `generationContract`, and `promptStyle` sufficient for the Planner to compile the final provider prompt.
- `agent_loop` Skills must provide an explicit entry flow, allowed tools, and confirmation boundary instead of an image prompt compiler contract.
- Skill manifests must declare the execution mode and required capabilities explicitly.
- Skill configuration belongs in the Skill manifest or its existing config file; do not add hidden runtime constants in route handlers.

## Prompt Boundaries

- Do not require runtime code to copy the complete `SKILL.md` into model context.
- Do not include API keys, account credentials, machine-specific paths, or private provider configuration in a Skill.
- Do not expose internal reasoning, raw tool arguments, or complete hidden prompts as public progress text.
- Keep provider protocol details out of Skill contracts; provider selection and request translation belong to the provider layer.

## Asset and Reference Rules

- Skills may consume only validated reference images and stable context IDs supplied by the Agent contract.
- Skills must not infer an asset from conversational position or unverified shorthand.
- Generated assets must use the existing local delivery and persistence path.
- Skill jobs must preserve per-item status, cancellation, partial success, and local-delivery errors.

## Configuration

- Provider, model, image size, aspect ratio, and output count must pass through the existing provider selection and capability resolution helpers.
- Do not create a Skill-specific provider protocol or bypass the unified image execution contract.
- Keep `skills/registry.json` and per-Skill configuration consistent with the actual `SKILL.md` files.
- Internal host Skills are execution dependencies and must not participate in ordinary automatic Skill selection.

## Verification

- Run Skill registry and Skill structure tests after changing a manifest or `SKILL.md` contract.
- Run the relevant image generation or Skill job tests after changing execution behavior.
- Validate that no credential-looking values or machine-specific paths were added.
- Keep Skill changes reviewable; do not combine unrelated prompt rewrites with execution changes.
