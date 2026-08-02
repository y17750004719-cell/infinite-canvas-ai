---
name: modular-watercolor-collage-v0-1
description: Create modular watercolor-field artworks on one continuous handmade-paper surface, using irregular rectangular pigment zones, narrow paper-colored seams, restrained natural pigments, and one readable subject with fragmentary supporting clues. When references are supplied, preserve their actual subjects, viewpoint, spatial relationships, composition paths, color ratios, and mood while translating photographic surfaces into this watercolor-field language. Use for modular watercolor collage, watercolor grid collage, reference-guided watercolor collage, watercolor field collage, irregular watercolor blocks, East Asian paper-field art, or any plant, person, architecture, animal, object, landscape, or abstract theme requested in this style.
---

# Modular Watercolor Collage v0.1

Turn the user's theme into:

1. a final four-paragraph image-generation prompt, and
2. a generated raster image using that prompt.

Use Standard Mode for every generation. Default to a 9:16 portrait canvas unless the user explicitly requests another ratio.

## Core Visual Identity

Create one flat watercolor artwork painted directly on one continuous sheet of warm handmade paper:

- arrange 7-10 irregular rectangular pigment fields as a broken vertical tower with a jagged, stepped outer silhouette
- use 1-2 tall main fields, several short rectangles or horizontal strips, and a few small square or near-square accents
- occupy roughly 38%-52% of the canvas width and 68%-78% of its height; allow a few subject details to reach at most about 60% of the canvas width
- preserve a continuous quiet-paper safety zone around the entire modular silhouette: keep at least about 14% of the canvas width clear on both left and right, and about 10% of the canvas height clear at both top and bottom
- separate most fields with narrow seams of untouched base paper; allow a few fields to touch, share a short edge, or interlock slightly in the same flat plane
- never place three fields side by side; vary every field width and every paper seam instead of repeating columns or equal gaps
- allow at most two short aligned edge pairs in the whole composition, then break them through alternating left-right offsets, two pronounced side protrusions, and one isolated small accent
- render field boundaries as watercolor stopping marks: backruns, pigment deposits, feathering, dry-brush gaps, and incomplete masking edges
- distribute one readable main subject and supporting fragments across the structure without turning each field into a separate illustration
- use translucent washes, mineral granulation, matte gouache, faded ink, handmade-paper fibers, and restrained natural pigments
- keep the result flat, scanned, quiet, archival, and non-commercial

All fields belong to the same sheet. They are painted zones, never separate pieces of paper.

Do not copy reference-image text, watermarks, platform labels, AI badges, signatures, or account IDs.

## Reference Image Mode

Activate this mode whenever one or more reference images are supplied. Keep the normal free-composition rules when no reference image exists.

Mode boundary is strict:

- never invent, retrieve, attach, or request a reference image when the user did not supply one
- without a reference image, keep every Core Visual Identity rule, including random broken fields, one-paper construction, pigment stopping edges, subject-fragment logic, and the full outer paper safety zone
- Reference Image Mode adds fidelity and continuous-mapping requirements; it never removes the shared field-count, randomness, paper, material, whitespace, typography, or negative constraints

### Source of Truth and Priority

- inspect the actual image pixels; never infer the scene from filenames, labels, declared roles, or user wording alone
- treat one supplied image as the primary composition reference
- with multiple images, use the first image as the primary composition reference unless the user explicitly chooses another; use the rest only for palette, material, or local-detail support
- pass the actual primary reference image to the image generator; never replace it with a text-only summary
- treat the image as a `reference` for content and composition, not as a literal `edit_target`
- resolve conflicts in this order: explicit user instructions, reference subject and spatial identity, this skill's modular watercolor language, optional decoration

Keep the reference analysis internal. Do not add a separate reference-analysis report to the output.

### Fidelity Tiers

Classify visible content before compiling the prompt:

- **hard anchors:** identity-defining subject, viewpoint, composition path, direction, scale, and key positions; preserve these
- **supporting elements:** important environment, secondary objects, material boundaries, and color accents; simplify only when needed for clarity
- **dispensable detail:** repeated, tiny, or thumbnail-illegible texture; omit when it would make the watercolor fields dense

Do not introduce a new major object, location, narrative event, or visual symbol absent from the user request and primary reference.

### Reference Composition Mapping

- keep the requested ratio, defaulting to 9:16 even when the primary reference uses another ratio
- when a shorter reference must fit 9:16, preserve its full horizontal field of view without cropping or stretching; place its composition within roughly 62%-74% of the canvas height and use added top and bottom space for quiet paper, pale pigment fields, or plausible distant continuation
- keep every main field, supporting field, and crossing detail inside the outer paper safety zone; no pigment field may touch or nearly touch a canvas edge
- use 3-4 offset adjacent main fields to carry roughly 70% of the reference information as one continuous spatial map
- use 3-5 supporting fields only for close detail, material texture, palette echoes, or secondary elements from the reference
- keep 7-9 total fields, unequal widths and gaps, alternating left-right offsets, no three fields side by side, and a jagged open outer silhouette
- preserve the relative position, direction, and scale relationships of the hard anchors across the main fields; do not randomly redistribute them
- let a composition path such as a road, river, branch rhythm, or horizon cross at most 3 seams
- let a directional element such as a tree branch or architectural edge cross at most 2 seams
- keep compact anchors such as rocks, faces, animals, doors, or product bodies mostly intact within one main field
- use supporting fields as visual echoes; do not extend the main scene through them

### Reference Style Translation

- preserve the reference's palette proportions, value hierarchy, lighting direction, temperature relationships, and mood
- translate photographic detail into transparent washes, mineral granulation, pigment stopping edges, dry brush, faded ink, and matte gouache
- reduce digital photographic sharpness without changing the reference into a fixed green-yellow or other preset palette
- default to textless when the reference contains no intentional typography; add text or seals only when the user explicitly requests them

## Prompt Compiler

Write the final prompt as four compact paragraphs in this order.

### 1. Canvas and Attention Geometry

Specify:

- the user's requested ratio, or exact 9:16 portrait when no ratio is supplied
- one full-frame warm ivory, rice-paper, or lightly aged handmade-paper surface
- the base paper continues beyond all four canvas edges; its outer sheet edge is never visible
- no border, frame, mounting, or presentation mockup
- a narrow modular tower occupying roughly 38%-52% of the width and 68%-78% of the height
- occasional subject details may extend to about 60% of the width, while at least about 14% clear paper remains on both sides and about 10% remains above and below
- a balanced vertical silhouette built from unequal rectangles rather than a centered strip or full-page scene
- a stepped, open outer contour that never closes into one large rectangle
- in Reference Image Mode, state how the full reference field of view is preserved inside the requested canvas without cropping or stretching

### 2. Modular Fields and Theme Translation

Translate the user's theme into one main image plus fragmentary clues:

- use 7-10 visibly distinct watercolor fields of unequal scale
- include 1-2 tall main fields, a few horizontal strips or short rectangles, small accents, and optional texture-only or distant-view fields
- place one clearly readable main subject in 1-2 adjacent fields, usually around the middle or lower half
- use the remaining fields for close details, distant traces, silhouettes, material studies, color echoes, environmental clues, or narrative remnants
- for abstract themes, choose one readable poetic symbol before distributing supporting marks and color fields
- keep most fields apart with narrow base-paper seams; let only a few touch or interlock without depth
- never place three fields on the same horizontal band; do not repeat field widths or seam sizes
- allow at most two short aligned edge pairs, then interrupt them with alternating left-right offsets, two strong side protrusions, and one isolated small accent
- keep the combined outer silhouette jagged and open rather than rectangular
- let no more than about 20% of the main subject cross only 1-2 seams; crossing details remain painted on the common substrate
- keep pale fields visibly washed or stained to their pigment boundary; internal negative space is allowed, but a complete white postcard-shaped panel is not

In Reference Image Mode, replace the free-composition distribution above with the reference mapping rules: 3-4 main fields preserve one continuous spatial map and 3-5 supporting fields repeat only reference-derived details.

Adapt the subject without defaulting to plants:

- people: pose, profile, hands, clothing folds, or domestic traces
- architecture: facade, roofline, doorway, window, courtyard, or distant silhouette
- animals: one main figure, texture detail, tracks, or habitat clues
- objects: one primary object, structural details, material texture, and signs of use
- landscapes and plants: one main passage plus restrained close and distant fragments
- abstract ideas: one symbolic form plus color, texture, and environmental traces

### 3. Material, Color, and Typography

Describe tangible pigment behavior on the common sheet:

- watercolor backruns, wet-on-wet blooms, granulation, pigment settling, dry-brush breaks, matte gouache, faded ink, paper fibers, and imperfect masking registration
- pigment stopping edges rather than torn-paper fibers or cut-paper contours
- 2-4 coordinated, low-to-medium-saturation natural pigment hues derived from the theme
- mineral green, celadon, indigo, smoke gray, ochre, earth yellow, terracotta, muted violet, or other theme-appropriate pigments
- no mandatory green palette

Typography is restrained:

- preserve literal user-supplied copy exactly
- otherwise allow at most one very short vertical Chinese phrase with a quiet bookish or calligraphic character
- optionally add one tiny vermilion seal or a restrained handwritten mark
- keep text secondary and sparse; avoid long copy, multiple text zones, fake brands, copied signatures, and watermark-like marks
- in Reference Image Mode, use no text or seal unless the reference or user explicitly supplies it

### 4. Surface, Mood, and Hard Avoids

Finish with:

- flat orthographic scan, diffuse light, matte absorbent paper, and no dimensional lighting
- quiet, handmade, contemplative, archival, poetic atmosphere suited to the theme
- no independent watercolor cards, postcards, white rectangular card bases, stacked paper, torn-paper collage, curled corners, paper thickness, cast shadows, or front-to-back paper layers
- no scrapbook, moodboard, photo wall, card waterfall, neat nine-square grid, three fields side by side, repeated columns, equal gaps, enclosing rectangular silhouette, complete rows or columns, brick layout, centered card strip, or random floating cards
- no separate complete illustration in every field, giant subject covering all fields, seamless full-page watercolor scene, full-bleed composition, or loss of outer paper margins
- no visible outer sheet edge, deckled page silhouette, paper-on-table presentation, sheet shadow, photorealism, clean vector art, 3D rendering, glossy commercial poster, product ad, neon color, digital gradient, hard light, cinematic lighting, frame, mockup, watermark, AI badge, platform mark, account ID, or copied signature

## Variation Engine

Choose one option from each useful axis before writing the prompt.

### Layout

- broken vertical tower
- broken field mosaic
- side-projecting blocks
- interrupted horizontal strips
- upper-and-lower main fields

### Main Subject

- person
- architecture
- animal
- object
- natural landscape or plant
- abstract poetic symbol

### Supporting Fragments

- close detail
- distant trace
- silhouette
- texture study
- color field
- narrative remnant

### Palette

- theme-derived natural pigments
- mineral blue and smoke gray
- celadon, moss, and earth yellow
- ochre and terracotta
- muted violet and indigo

### Typography

- textless
- one very short vertical Chinese phrase
- short phrase plus tiny vermilion seal

### Texture

- wet watercolor blooms
- mineral granulation
- dry-brush stopping edges
- faded scanned-print traces
- visible handmade-paper fibers

## Workflow

1. Parse the theme, mood, exact copy, requested ratio, image count, and whether actual reference images are present; never create or solicit a reference image when none was supplied.
2. When references exist, inspect their pixels, select the primary composition reference, classify fidelity tiers, and keep every supplied image available to the generation pipeline.
3. Select one recipe across layout, main subject, supporting fragments, palette, typography, and texture.
4. Compile the final prompt using the four-paragraph structure and the applicable free-composition or reference-mapping rules.
5. Generate the image with the actual primary reference attached, at the requested ratio or the 9:16 default.
6. Inspect the result at thumbnail scale. Regenerate once unless the user requested a single supplier call; in that case report failures without retrying.
7. Return the generated image, final prompt, and selected recipe without a separate reference-analysis report.

## Output

Return the generated image, the exact final prompt, the selected ratio and recipe, and one short note about the theme interpretation. Do not put placeholder image paths or sample URLs in the prompt or response template.

## Quality Gate

Before finalizing, confirm:

- Is the requested ratio used, with 9:16 as the default?
- Does the result read as one continuous sheet rather than separate cards?
- Are there 7-10 unequal rectangular pigment fields?
- Are 1-2 tall main fields mixed with strips, short rectangles, and small accents?
- Does the modular structure occupy about 38%-52% of the width and 68%-78% of the height, with at least about 14% clear paper on both sides and about 10% above and below?
- Does the base paper fill the canvas edge to edge without a visible sheet outline or shadow?
- Do most fields have narrow base-paper seams, with only limited flat touching or interlocking?
- Are there never three fields side by side, repeated widths, or equal seam spacing?
- Are there at most two short aligned edge pairs, two side protrusions, one isolated accent, and a jagged open outer silhouette?
- Are boundaries made from watercolor backruns, deposits, feathering, and dry-brush gaps rather than paper edges?
- Is there one readable main subject plus fragmentary clues rather than a complete scene in every field?
- Does no more than about 20% of the subject cross only 1-2 seams?
- Are pale modules visibly stained rather than complete white cards?
- Are paper thickness, curled edges, cast shadows, and layered-paper depth absent?
- Are colors restrained, natural, and theme-derived rather than automatically green?
- Is typography limited to one short phrase and an optional tiny seal?
- Are watermarks, AI labels, platform marks, account IDs, and copied signatures absent?
- Was the image actually generated and visually inspected?

When references are supplied, also confirm:

- Was the actual primary reference image inspected and passed to the image generator?
- Are viewpoint, composition path, hard-anchor positions, directions, scale relationships, palette proportions, light, and mood recognizable from the primary reference?
- Does the 9:16 conversion preserve the full horizontal field of view without cropping or stretching?
- Do 3-4 main fields carry one continuous reference-derived spatial map and roughly 70% of the reference information?
- Do 3-5 supporting fields contain only reference-derived detail, material, or palette echoes?
- Are hard anchors preserved, supporting elements reasonably simplified, and only dispensable detail omitted?
- Do composition paths cross at most 3 seams, directional elements at most 2, and compact anchors remain mostly intact?
- Are major invented objects, redistributed anchors, photo-filter results, and fixed preset palettes absent?
- Is the result textless unless typography was explicitly supplied or requested?
