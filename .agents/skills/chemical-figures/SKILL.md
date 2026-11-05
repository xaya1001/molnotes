---
name: chemical-figures
description: Author or revise chemical structures, reactions, routes, mechanisms and process diagrams in this project, using saved library identity and a render-review loop. Use when creating chemical figures or changing their layout, labels, electron flow or page references.
---

# Chemical figures

Use this as the authoring entrypoint. Read the current [content contract](../../../docs/content.md) for entry fields; chemical facts and sources belong to content, rendering behavior to shared code.

## Render and review

1. Check the source, graph, stereochemistry and electron direction. Reuse saved compound IDs and atom IDs.
2. Write a library YAML scene. Start with relative placement and semantic endpoints; save molecular coordinates in compound layouts, not page blocks.
3. Run the website renderer, following the workspace heavy-command policy:
   ```sh
   npm run figure:render -- --library <content-root> --entry <id> --out <output>
   npm run figure:render -- --scene figure.yaml --out <output>
   ```
   The default renders desktop and phone widths. Inspect the PNG and JSON diagnostics; a clean diagnostic report does not establish chemical correctness.
4. Adjust orientation, `gap`, a small `offset`, saved coordinates or arrow `bend`; render and inspect again. Check normal-size labels, visible gaps, arrow origins and heads, and mobile scrolling.
5. Make the requested comparison HTML, publish it with `artifact publish --task <task> --name <name> <directory>`, run `artifact shot <published-index>`, and inspect that screenshot before returning `artifact url <published-index>`. Artifact review and product/content publication follow the task's separate permissions.

```yaml
title: Carbonyl addition
molecules:
  substrate: { smiles: "CC(=O)C" }
  donor: { smiles: "[OH-]", leftOf: substrate }
arrows:
  - donor:charge(a1) -> between(donor:a1,substrate:a2)
  - substrate:pi(a2,a3) -> substrate:atom(a3)
```

For process diagrams, save a `kind: process` entry in `library/processes/prc_<id>.yaml`, using the [ProcessData contract](../../../shared/process.ts) (`title`, `label`, `nodes`, optional `total`, and `scenarios`) plus `id` and `sources`. Pages use `figure-ref` with its `prc_` ID. The existing process player renders it, including scenario selection, trace and budget. Check it with `figure:render --library <content-root> --entry <id>` or `content:preview`; process output includes PNGs and diagnostics, while SVG export applies to static figures. Timeline and generic flow fields are in the [data-figure recipe](../../../toolbox/recipes/figures.md).

## Endpoint vocabulary

- Sources: `lp(a1)` is a lone pair, `charge(a1)` a displayed negative charge, `bond(a1,a2)` sigma electrons, `pi(a1,a2)` a multiple-bond line, and `radical(a1)` a single electron.
- Destinations: `atom(a1)`, `bond(a1,a2)`, or `between(donor:a1,acceptor:a2)` for a new bond; the second atom is the acceptor. Radical endpoints use a half head; `electrons: 1` explicitly selects one for bond electrons.
- Write `molecule:selector -> molecule:selector`. Prefer persistent atom IDs in finished entries. Keep bond tails at their semantic midpoints. Use `bend: left/right` only when placement and the default arc need a different side.

## Identity, references and style

- Save one entry per stable `cmp_`, `rxn_`, `rte_`, `mec_`, `img_` or `prc_` ID. Reactions reference compounds; routes reference reactions; mechanism frames reference compounds. Preserve graph identity when saving layout variants.
- A page uses `figure-ref` with `ref`, optional `variant`/`frame`, local `numbers`, focus and caption. Keep structures, reagents, yields, coordinates and source evidence in the library entry. Notes use a `figure-ref` fenced block; topics use `{ "type": "figure-ref", "ref": "rxn_example" }`.
- Image references keep local `alt` and caption. Use `presentation: figure` for the ordinary framed image, or `presentation: note` for a centered note illustration. Existing SVG library presentation is the default. Scene, picture-question and original-page image slots accept `{ref: img_<id>}` while retaining their own controls.
- Use gray/black plus the shared red accent. At most one primary focus and two supporting focuses; one coordinated electron event may include several related arrows. Keep background structures readable and use the shared design tokens for color, weight, bond length and glyph sizes.

## Common fixes

- Display deuterium as `D` through native isotope-label drawing. Retain `[2H]` in the chemical graph; replacing it with ordinary hydrogen changes identity.
- A large intermolecular arc usually needs reacting ends to face one another. Adjust orientation and separation so the molecules remain visibly distinct and the electron arrow has a clear medium arc; excessive tightening turns it into a small hook.
- For crowded adjacent-bond transfers, turn the explicit H/D bond toward free space and bring the base near that atom. Keep the tail at the original bond midpoint. Routing measures the visible shaft, prefers a fuller short arc where space permits, and prioritizes collision avoidance in constrained rings. Inspect neighboring arrows as well as the edited one.
