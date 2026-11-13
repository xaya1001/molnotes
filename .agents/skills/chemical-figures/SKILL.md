---
name: chemical-figures
description: Author or revise chemical structures, reactions, routes, mechanisms and process diagrams in this project, using saved library identity and a render-review loop. Use when creating chemical figures or changing their layout, labels, electron flow or page references.
---

# Chemical figures

Use this as the authoring entrypoint. Read the current [content contract](../../../docs/content.md) for entry fields; chemical facts and sources belong to content, rendering behavior to shared code.

## Render and review

1. Check the source, graph, stereochemistry and electron direction. Reuse saved compound IDs and atom IDs.
2. Write figure YAML and run `npm run figure:compile -- --source figure.yaml --library <content-root>`. Edit and recompile the saved `library/sources/<id>.yaml` to retain the figure ID. Read the [compilation contract](../../../docs/content.md#figure-yaml-compilation) for route and mechanism fields.
3. Run the website renderer, following the workspace heavy-command policy:
   ```sh
   npm run figure:render -- --library <content-root> --entry <id> --out <output>
   ```
   The default renders width 1366; add `--width 390` for a phone proof. Inspect the PNG and JSON diagnostics; a clean diagnostic report does not establish chemical correctness.
   `content:preview` collects topic `figure-ref` blocks and every mechanism frame, including tabs, and reports the website renderer's diagnostics. Resolve every diagnostic before accepting the preview; the command fails when a library figure has diagnostics or cannot render.
4. Adjust `rot`, `flip` or common-core `align` in source and recompile; routes compute their arrow geometry. For a saved scene, adjust coordinates and semantic endpoint placement, then render and inspect again. Check normal-size labels, visible gaps, arrow origins and heads, and mobile scrolling.
5. Make the requested comparison HTML, publish it with `artifact publish --task <task> --name <name> <directory>`, run `artifact shot <published-index>`, and inspect that screenshot before returning `artifact url <published-index>`. Artifact review and product/content publication follow the task's separate permissions.

```yaml
title: Sequential transformations
compounds:
  1: CCO
  2: CC=O
  3: CC(=O)O
steps:
  - { id: oxidation, from: 1, to: 2, above: "[O]" }
  - { id: second, from: 2, to: 3, above: "[O]", explain: Further oxidation. }
```

For process diagrams, save a `kind: process` entry in `library/processes/prc_<id>.yaml`, using the [ProcessData contract](../../../shared/process.ts) (`title`, `label`, `nodes`, optional `total`, and `scenarios`) plus `id` and `sources`. Pages use `figure-ref` with its `prc_` ID. The existing process player renders it, including scenario selection, trace and budget. Check it with `figure:render --library <content-root> --entry <id>` or `content:preview`; process output includes PNGs and diagnostics, while SVG export applies to static figures. Timeline and generic flow fields are in the [data-figure recipe](../../../toolbox/recipes/figures.md).

## Route authoring

Dependencies come from shared compound keys. Write multiple `from`/`to` keys for convergence or multiple products; each product has one producer. Each step creates an owned reaction with a complete standalone view. Connected intermediates appear once; wrapped rows start at their arrow. Two branches of a fork align before joining. If the product will not fit at the right, a short branch can reverse into a downward join. More complex joins use the compound number.

Orientation propagates outward from the largest uncrowded compound, or the figure's `anchor` key. Shared cores inherit coordinates; `align: false` keeps a free depiction, and `align: <key>` chooses another completed reference. `flip` and then `rot` apply after alignment; positive `rot` turns counterclockwise. `wrap: serpentine` reverses the next row after a downward turn. A step can request `turn: down|elbow|wrap`, `side: left|right` for vertical condition text, and `reverse: false` to retain direction. Website tokens own width and spacing; YAML rejects style fields such as `width` and `bond`.

For other reactants, `others: box|text|plus|none` sets the default; `{id,show}` overrides one. `box` draws a bordered structure above the arrow. `text` uses the compound's `text` or its label/name. `none` omits drawing while retaining the structural participant. Compound `bracket: true` adds brackets; `bracket: ts` adds the transition-state sign. Figure `footnote` sits below the whole diagram. Conditions, labels and footnotes support chemical italic prefixes (`n-`, `t-`, `cis-`), `*italic*`/`**bold**`, Unicode subscripts and `^{superscript}`.

Common protecting groups and terminal functional groups fold by default, using attachment-facing label spelling. A compound's `abbreviate: false` keeps it expanded; figure-level `abbreviate: [Ph, Trt, Bz]` enables optional groups. A group stays expanded when its hidden interior contains an electron-arrow endpoint; its root can remain a label and receive an arrow. Other groups keep their abbreviations. Write conditions as ordinary chemical text (`H2O`, `Pd(PPh3)4`); digits become subscripts, and a backslash keeps the next character literal. Reagents retain source order. Numbers and names use `number: name`, with a bold number; yields use parentheses.

CXSMILES repeat units such as `CCCOCC |Sg:n:2:n:ht|` retain their crossing-bond brackets and multiplier in a figure-owned layout. Set a compound's `coordgen: true` to use CoordGen for its own depiction, including a macrocyclic anchor; expanded and folded structures share the same bond length. A compound's `scale` enlarges structure coordinates while retaining the atom font size.

Set `numbers: true` to draw the explicit map numbers from that compound's input SMILES. Only mapped atoms receive a number; native atom notes place the small labels around the visible structure.

A reactant item can specify numeric `equivalents`. A product item can specify `fraction` in [0,1], separately from source-reported `ratio` and `yield` text. A step's `tags` retain its free-text classification. `reagentPosition: below-arrow` places reagents below the arrow with the conditions. Step `title` and `sources` override the figure defaults when each transformation has its own provenance.

Compilation prints a change review before the final figure ID. Inspect the reported positions and every uncomparable centre against the source. Automatic marks belong to each reaction's products; `changes: off` disables the figure or step. Use step `changes: {add: [mapNumbers], remove: [mapNumbers]}` for reviewed corrections; removal also clears incident red bonds. Retained versus inverted stereochemistry follows corresponding ligand positions, including one uniquely determined substitution.

Use structure/frame `enclose: [{atoms: [mapNumbers], shape: auto}]` for a teaching selection; `bonds: [[a,b]]` selects bonds. Optional `id` names the selection. Shapes are `auto`, `circle`, `rect` or `outline`; step `enclose: {compoundKey: [...]}` overrides a structure default and `[]` clears it. Page `focus` atoms and bonds use the same rules; electron-arrow emphasis stays independent. Auto tries a circle, rounded rectangle and outward rounded convex outline in that order. Selected atom points and complete label boxes, including subscripts, must remain fully inside; unselected visible atoms and complete label boxes must remain outside. Both sides require at least one enclosure gap (6.4 px) from the boundary ink. Disconnected selections are handled per connected component. When all shapes conflict, that component uses solid focus coloring for selected atoms and bonds, preserving primary or supporting colors and line widths, without an enclosure. Inspect boundaries against labels, unrelated bonds, arrows and other circles; explicit shapes retain their shape and report the same containment and clearance conflicts. Bonds entering the selected group are allowed. Selected atoms inside an abbreviation keep that group expanded.

## Endpoint vocabulary

- Sources: `lp(a1)` is a lone pair, `charge(a1)` a displayed negative charge, `bond(a1,a2)` sigma electrons, `pi(a1,a2)` a multiple-bond line, and `radical(a1)` a single electron.
- Destinations: `atom(a1)`, `bond(a1,a2)`, or `between(donor:a1,acceptor:a2)` for a new bond; the second atom is the acceptor. Radical endpoints use a half head; `electrons: 1` explicitly selects one for bond electrons.
- Input arrows use SMILES maps, for example `{from: "pi(2,3)", to: "atom(3)"}`; compiled entries use permanent atom IDs. Keep bond tails at their semantic midpoints. `side: left|right` selects the arc side. Cross-participant arrows belong to saved scenes; the input grammar places arrows within one compound or frame.

## Identity, references and style

- Save one entry per stable `cmp_`, `rxn_`, `rte_`, `mec_`, `img_` or `prc_` ID. Reactions reference compounds; routes reference reactions; mechanism frames reference compounds. Preserve graph identity when saving layout variants.
- 芳香环推电子先存 Kekulé 变体：在 `variants.<name>` 保存完整 `coords` 和含持久原子映射、明确单/双键的 `molblock`，原子顺序与 `atomIds` 一致。场景的分子用 `variant` 选它；π 锚点只接受该变体中的多键。变体经芳香化后的图、立体化学与同位素必须保持原化合物身份。
- A page uses `figure-ref` with `ref`, optional `variant`/`frame`, local `numbers`, focus and caption. Keep structures, reagents, yields, coordinates and source evidence in the library entry. Notes use a `figure-ref` fenced block; topics use `{ "type": "figure-ref", "ref": "rxn_example" }`.
- Existing structure controls accept `{ref: cmp_<id>, variant?: <name>}` in place of `smiles`, including comparisons, properties, prediction molecules and matrix rows. Keep local labels, highlight/answer indices and question IDs. For migrated indexed controls, first save an `inputSmiles` variant with the original input and abbreviations through the [content contract](../../../docs/content.md); graph deduplication can change parser indices, so use that variant to retain existing records and drawing.
- Image references keep local `alt` and caption. Use `presentation: figure` for the ordinary framed image, or `presentation: note` for a centered note illustration. Existing SVG library presentation is the default. Scene, picture-question and original-page image slots accept `{ref: img_<id>}` while retaining their own controls.
- Use normal ink plus the shared red accent. At most one primary focus and two supporting focuses; one coordinated electron event may include several related arrows. Keep unchanged structures in normal ink and use the shared design tokens for color, weight, bond length and glyph sizes.

## Common fixes

- Display deuterium as `D` through native isotope-label drawing. Retain `[2H]` in the chemical graph; replacing it with ordinary hydrogen changes identity.
- Ring stereocentres with one H and no exocyclic heavy substituent use native explicit H wedges, including fused and bridged junctions; prefer H or exocyclic substituents for stereochemical wedges. Colliding added H can rotate within its heavy-ligand sector without changing bond length or wedge sense. Counterions in charge-balanced salts default near the opposite charge centre at 1.5 bond lengths; charged mixtures retain saved separation. Preserve a deliberate salt separation with `layout.ionPairs: keep` or a pinned counterion, then inspect the rendered charges and labels.
- A large intermolecular arc usually needs reacting ends to face one another. Adjust orientation and separation so the molecules remain visibly distinct and the electron arrow has a clear medium arc; excessive tightening turns it into a small hook.
- For crowded adjacent-bond transfers, turn the explicit H/D bond toward free space and bring the base near that atom. Keep the tail at the original bond midpoint. Routing measures the visible shaft, prefers a fuller short arc where space permits, and prioritizes collision avoidance in constrained rings. Inspect neighboring arrows as well as the edited one.
