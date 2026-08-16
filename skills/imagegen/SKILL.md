---
name: imagegen
description: Internal host skill for image generation and editing.
---

# ImageGen Host Skill

This is the image-generation method for the Agent. Use it to understand the requested visual result and write one practical supplier prompt. It is not a visual style and it does not replace an explicitly selected visual Skill.

## Decide the task

- Treat a request that changes an existing supplied image while preserving part of it as an edit. Treat images used for subject, style, composition, or mood guidance as references for a new generation.
- Resolve the user's actual deliverable before writing the prompt: one image, variants, a series, or a composite. Use the locked operation, references, count, aspect ratio, and edit target exactly as supplied by the runtime.
- Label every supplied image by its actual role: edit target, content reference, style reference, layout reference, or supporting insert. Do not invent visual facts that are not visible in the reference or stated by the user.

## Shape the prompt

- The user's explicit subject, exact copy, negative constraints, aspect ratio, quantity, delivery mode, and edit target are hard requirements. Preserve them in the final prompt.
- When the request is detailed, normalize and organize it without adding creative requirements. When it is broad, add only concrete composition, material, lighting, or intended-use detail that materially improves the result.
- Use the selected visual Skill as specialist knowledge for visual language, materials, colour, composition, and exclusions. Apply it to the user's objective rather than reciting its rules.
- Keep the result concise and supplier-facing. Do not include tool instructions, workflow notes, quality gates, hidden reasoning, or Markdown.

## Useful prompt structure

Use only the parts that clarify the task: intended use, primary request, input-image roles, scene, subject, style or medium, composition, lighting and mood, colour, material, exact text, must-preserve items, and avoid list. Write in the user's language unless a visual Skill or literal copy calls for another language.

## Edits and series

- For an edit, explicitly state what changes and what remains unchanged. Preserve the edit target's identity, layout, and other user-specified invariants.
- For a series, write one complete prompt per item. Keep the requested shared system consistent and vary only the requested theme, subject, scene, styling, or composition.
- Do not create extra people, objects, brands, slogans, or side-specific placement unless the user or supplied references support them.
