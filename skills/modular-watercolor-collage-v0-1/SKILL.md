---
name: modular-watercolor-collage-v0-1
description: Compile a supplier-ready four-paragraph image prompt for modular watercolor-field artwork painted on one continuous handmade-paper surface. Use for modular watercolor collage, watercolor grid or field collage, irregular watercolor blocks, East Asian paper-field art, and reference-guided translations of people, plants, architecture, animals, objects, landscapes, or abstract themes. With supplied references, preserve their actual visible subjects, viewpoint, spatial relationships, composition paths, color ratios, light, and mood.
---

# Modular Watercolor Collage Prompt Compiler

Compile the user's request into one final image-generation prompt. Do not invoke image tools, generate an image, inspect generated output, retry, or report a recipe or quality gate.

Follow the user's language. Preserve user-supplied literal copy exactly. Default to a 9:16 portrait canvas unless the user requests another ratio.

## Modes

### No-reference mode

Use the user's theme directly. Never invent, retrieve, attach, or request a reference image.

Create one readable main subject plus fragmentary supporting clues. For an abstract theme, choose one clear poetic symbol. Do not default to plants when another subject is requested.

### Reference mode

Activate only when the user supplies one or more actual images.

- Inspect the image pixels, not filenames, labels, declared roles, or prose summaries.
- Use the first image as the primary composition reference unless the user selects another. Other images may support palette, material, or local detail.
- Preserve visible identity-defining subjects, viewpoint, direction, scale, key positions, spatial relationships, composition paths, palette proportions, value hierarchy, light, temperature, and mood.
- Simplify repeated or thumbnail-illegible detail, but do not invent a major object, location, event, or symbol.
- Preserve the full horizontal field of view when fitting a shorter reference into a taller canvas; do not crop or stretch it.
- Map about 70% of the reference information continuously across 3-4 offset main fields. Use 3-5 supporting fields only for reference-derived details, textures, or palette echoes.
- Keep paths such as roads, rivers, branches, or horizons continuous across at most 3 seams; directional edges cross at most 2 seams; compact anchors such as faces, animals, doors, rocks, or product bodies remain mostly intact in one main field.
- Default to no typography unless the user or reference intentionally supplies it.

The prompt describes fidelity. The host keeps supplied reference items attached to the generation request; this compiler does not attach or generate anything.

## Visual identity

- One flat artwork painted directly on one continuous warm ivory, rice-paper, or lightly aged handmade-paper surface that fills the canvas edge to edge; the outer sheet edge is never visible.
- 7-10 unequal irregular rectangular pigment fields in no-reference mode, or 7-9 in reference mode, forming a broken vertical tower or open field mosaic with a jagged stepped silhouette.
- 1-2 tall main fields, several short rectangles or horizontal strips, and a few square or near-square accents. Never place three fields side by side.
- The modular silhouette occupies about 38%-52% of the canvas width and 68%-78% of its height. Subject details may reach about 60% width, while at least about 14% clear paper remains on both sides and about 10% above and below.
- Most fields are separated by narrow unequal seams of untouched base paper; a few may touch or interlock in the same flat plane. Do not repeat widths, gaps, columns, or complete rows.
- Allow at most two short aligned edge pairs, interrupted by alternating offsets, two pronounced side protrusions, and one isolated small accent. The outer contour stays open rather than closing into a rectangle.
- Field boundaries are pigment stopping marks: backruns, deposits, feathering, dry-brush gaps, and imperfect masking edges, never cut or torn paper edges.
- Keep one readable subject distributed through 1-2 adjacent main fields; no more than about 20% crosses only 1-2 seams. Supporting fields contain fragments, not separate complete illustrations.
- Use translucent washes, wet blooms, mineral granulation, pigment settling, dry brush, matte gouache, faded ink, visible paper fibers, and restrained natural pigments. Choose 2-4 low-to-medium-saturation hues from the theme or reference; no mandatory green palette.
- Keep the result flat, scanned, quiet, handmade, contemplative, archival, poetic, and non-commercial.

## Four-paragraph prompt contract

Write exactly four compact prose paragraphs with no headings, bullets, labels, preface, or afterword.

1. **Canvas and attention geometry:** State the ratio, continuous edge-to-edge handmade-paper substrate, invisible sheet edge, outer clear-paper margins, modular footprint, and open stepped silhouette. In reference mode, state that the full reference field of view is preserved without cropping or stretching.
2. **Fields and subject mapping:** Specify the field count and varied shapes, seams and offsets, main subject, supporting fragments, crossing limits, and either free theme translation or reference-derived continuous mapping.
3. **Material, color, and typography:** Specify watercolor behavior, pigment-edge construction, 2-4 restrained theme- or reference-derived hues, paper fibers, and sparse typography. Preserve literal copy exactly; otherwise use no text or at most one very short vertical Chinese phrase and an optional tiny vermilion seal. In reference mode, use text only when supplied or requested.
4. **Surface, mood, and negatives:** End with the flat orthographic scan, diffuse light, matte paper, desired mood, and the hard avoids below.

## Hard negatives

Include these constraints naturally in paragraph four:

- no independent cards, postcards, white card bases, stacked paper, torn-paper collage, curled corners, paper thickness, cast shadows, layered depth, scrapbook, moodboard, photo wall, card waterfall, or random floating cards
- no neat grid, nine-square grid, brick layout, three fields side by side, repeated columns, equal gaps, complete rows or columns, enclosing rectangle, centered card strip, full-page scene, full bleed, or lost outer margins
- no separate complete illustration in every field, giant subject spanning all fields, invented reference content, redistributed anchors, or photographic filter effect
- no visible outer sheet edge, deckled page silhouette, paper-on-table presentation, sheet shadow, border, frame, mounting, or mockup
- no photorealism, clean vector art, 3D rendering, glossy commercial poster, product ad, neon color, digital gradient, hard or cinematic lighting
- no copied reference signature, incidental watermark, AI badge, platform mark, account ID, or fake brand

## Output routing

- **Standalone:** Return only the final four-paragraph prompt.
- **Host Planner:** Put the compiled prompt in `generation.prompt`; for series delivery, put one complete four-paragraph prompt per item in `generation.items`. Do not add recipe, ratio, interpretation, inspection, retry, or quality-gate commentary.
