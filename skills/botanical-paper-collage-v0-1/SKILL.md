---
name: botanical-paper-collage-v0-1
description: Create 9:16 vertical watercolor paper-collage posters built from visibly separate, misaligned square and near-square paper patches. Use when the user requests a botanical paper collage, jumbled square-paper stack, East Asian watercolor collage, torn-paper garden poster, ink-and-wash plant artwork, vertical natural-pigment collage, or a new image inspired by layered handmade-paper botanical art.
---

# Botanical Paper Collage v0.1

Turn the user's content into:

1. a final image-generation prompt, and
2. a generated 9:16 raster image made from that prompt.

Use Standard Mode for every generation.

## Core Visual Identity

Build a quiet vertical paper artwork rather than a conventional poster:

- warm ivory, rice-paper, or lightly aged handmade-paper background
- one tall, deliberately unstable tower of misaligned paper patches with generous pale margins
- 6-9 visibly separate fragments; most are square or near-square, with at most two narrow strips
- alternating left-right offsets, uneven gaps, partial overlaps, and protruding corners instead of a clean column
- several medium botanical, natural, or theme-derived panels rather than one seamless dominant painting
- translucent watercolor, gouache wash, pigment blooms, dry-brush marks, paper fibers, torn edges, and soft scanned imperfections
- optional short vertical Chinese inscription, tiny vermilion seal, or loose handwritten mark
- theme-driven natural pigments with controlled, low-to-medium saturation
- flat scanned-paper appearance with no mockup depth or commercial polish

Do not copy watermarks, platform labels, AI badges, signatures, account IDs, or other source-image artifacts.

## Prompt Compiler

Write the final image prompt as four compact paragraphs in this order.

### 1. Canvas and Attention Geometry

Specify:

- exact 9:16 portrait canvas
- full-frame warm ivory or aged handmade paper
- no border and no framed mockup
- jumbled collage tower occupying roughly 45%-70% of the canvas width and 70%-88% of its height
- large calm margins, especially around the upper and side edges
- vertical placement that remains balanced overall while individual patches look crooked, improvised, and asymmetrical
- individual fragments are mostly square even though the overall canvas remains 9:16

### 2. Fragment and Subject System

Convert the user's theme into one main visual idea and distribute it across 6-9 paper fragments:

- make at least two-thirds of the fragments square or near-square, with width-to-height ratios roughly between 0.8 and 1.2
- use only one or two horizontal or vertical strips to interrupt the square rhythm
- alternate fragment centers left and right by roughly 8%-25% of each fragment's width
- overlap some neighboring fragments by roughly 5%-15%, leave uneven paper-colored gaps between others, and keep several corners visibly protruding
- avoid aligning more than two fragment edges on the same invisible line; the stack must not read as a clean grid, masonry wall, or centered column
- distribute the visual weight across several medium panels; no single panel should swallow the whole collage
- use different fragments for close details, distant impressions, botanical silhouettes, texture studies, or abstract color fields
- let leaves, branches, flowers, grasses, stones, landscape traces, or a theme-relevant object cross one or two fragment boundaries without merging the fragments into one seamless image
- represent complex ideas through one poetic motif rather than a full illustrated scene

When a reference image is supplied, extract its composition, palette, texture, and material logic. Do not reproduce source text, logos, watermarks, or identifiable marks unless the user explicitly requests literal preservation and has the right to use them.

### 3. Material, Color, and Typography

Describe tangible paper and pigment behavior:

- translucent watercolor layers, granulation, wet-on-wet blooms, dry-brush edges, gouache opacity, faded ink, paper fibers, small abrasions, and imperfect scanned registration
- choose 2-4 coordinated natural-pigment hues based on the theme
- allow sage, moss, olive, celadon, mineral blue, ochre, terracotta, smoke gray, muted violet, or other restrained pigment colors
- avoid forcing the green-yellow reference palette when another theme calls for different natural colors
- keep accents integrated into watercolor fields rather than using a single synthetic neon mark

Text is optional:

- preserve user-supplied literal copy exactly
- otherwise invent at most one very short poetic Chinese or English phrase when typography benefits the composition
- set Chinese text vertically in a small calligraphic, engraved, or bookish style
- use a tiny vermilion seal or loose handwritten mark only when it improves balance
- avoid long text, fake logos, brand signatures, and unreadable pseudo-copy

### 4. Surface, Mood, and Avoids

Finish with:

- flat orthographic scan, diffuse light, matte absorbent paper, and no hard shadow
- quiet, botanical, contemplative, archival, handmade, scholarly, garden-memory atmosphere
- no full-bleed scene, single seamless watercolor painting, neat centered strip, orderly masonry layout, photorealistic stock image, clean vector art, modern UI, glossy print mockup, commercial headline, product ad, 3D rendering, cinematic lighting, neon, dense scrapbook, perfect grid, watermark, AI-generated badge, platform mark, or account ID

## Variation Engine

Choose one option from each axis before writing the prompt.

### Layout

- **crooked-square-tower:** near-square patches alternate left and right in a visibly unstable vertical pile
- **offset-block-cascade:** square blocks descend with irregular gaps, partial overlaps, and protruding corners
- **broken-column:** a loose column is repeatedly interrupted by side squares and one narrow strip
- **cross-offset-stack:** two or three patches project far enough sideways to create an asymmetric cross-like silhouette
- **split-stem-stack:** a plant or object crosses two misaligned square patches while their paper boundaries remain obvious

### Subject Treatment

- botanical silhouette
- loose watercolor observation
- cropped natural specimen
- distant garden or landscape trace
- object translated into a paper-and-pigment study
- abstract texture field carrying the theme

### Palette

- spring mineral greens
- summer blue-green and yellow
- autumn ochre and terracotta
- winter smoke gray and mineral blue
- theme-derived natural pigment set

### Typography

- textless
- one short vertical Chinese phrase
- tiny archival caption
- small vermilion seal only
- short phrase plus restrained handwritten mark

### Texture

- rice-paper fibers
- wet watercolor blooms
- dry-brush botanical marks
- mottled gouache fields
- faded woodblock or scanned-print traces

## Workflow

1. Parse the theme, mood, exact copy, reference-image role, and requested image count.
2. Select one recipe across layout, subject, palette, typography, and texture.
3. Compile the final prompt using the four-paragraph structure.
4. Generate the image with a 9:16 aspect ratio.
5. Inspect the result at thumbnail scale. Regenerate once if the image lacks a clearly jumbled stack of mostly square patches, if the edges align into a clean column or grid, or if it becomes one seamless watercolor painting.
6. Return the generated image, the final prompt, and the selected recipe.

## Output Format

````markdown
**生成图**

![Botanical Paper Collage](absolute-image-path-or-rendered-image)

**最终 Prompt**

```text
[final prompt used for image generation]
```

**说明**

- Ratio: 9:16
- Recipe: [layout / subject / palette / typography / texture]
- [one short note about the content interpretation]
````

## Quality Gate

Before finalizing, confirm:

- Is the canvas exactly 9:16 and vertically composed?
- Are there 6-9 visibly separate paper fragments?
- Are at least two-thirds of them square or near-square while the overall canvas remains 9:16?
- Do the patches alternate left and right with uneven gaps, partial overlaps, and protruding corners?
- Does the stack avoid a clean centered column, aligned grid, or seamless single painting?
- Is one botanical, natural, or theme-derived motif clearly dominant?
- Do watercolor behavior, paper fibers, and imperfect edges remain visible?
- Does the palette use restrained natural pigments appropriate to the theme?
- Is typography short, optional, and free of pseudo-copy?
- Are all source watermarks, AI badges, platform labels, account IDs, and copied signatures absent?
- Does the result remain flat, handmade, quiet, and non-commercial?
- Was the image actually generated?
