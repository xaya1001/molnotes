---
name: chemical-figures
description: Author or revise chemical structures, reactions, routes, mechanisms and process diagrams in this project, using saved library identity and a render-review loop. Use when creating chemical figures or changing their layout, labels, electron flow or page references.
---

# Chemical figures

Use this as the authoring entrypoint. Read the current [content contract](../../../docs/content.md) for entry fields; chemical facts and sources belong to content, rendering behavior to shared code.

## Render and review

1. Check the source, graph, stereochemistry and electron direction. Reuse saved compound IDs and atom IDs.
2. For a direct drawing, write YAML and run `npm run figure:draw -- figure.yaml --out <directory|file.svg>` directly. It compiles in memory without a library or permanent identity. Each frame produces an SVG; diagnostics go to stderr and do not block drawing. Parse, chemistry and renderer failures exit nonzero. To save a reusable figure, run `heavy npm run figure:compile -- --source figure.yaml --library <content-root>`. Edit and recompile the saved `library/sources/<id>.yaml` to retain the figure ID. Read the [compilation contract](../../../docs/content.md#figure-yaml-compilation) for route and mechanism fields.
3. Run the website renderer with `heavy`:
   ```sh
   heavy npm run figure:render -- --library <content-root> --entry <id> --out <output>
   ```
   The default renders width 1366; add `--width 390` for a phone proof. Inspect the PNG and JSON diagnostics; a clean diagnostic report does not establish chemical correctness.
   `content:preview` collects topic `figure-ref` blocks and every mechanism frame, including tabs, and reports the website renderer's diagnostics. Use `npm run figure:lint -- [<figure.yaml>... | --library <content-root>]` to list diagnostics with files or entries, frames and totals. Run lint for a single YAML directly; use `heavy` for the library, including when no arguments are given. Lint exits nonzero for issues and remains an independent inspection tool. Content publication retains diagnostics and prints their total; drawing failures stop publication.
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

## Recompile saved figures

Run `heavy npm run figure:recompile -- --library <content-root>` after compiler or drawing changes to regenerate every entry with a saved `sourceFile`. With no `--library`, it uses `MOLNOTES_CONTENT_DIR`. To limit the run, append one or more source YAML paths, for example `heavy npm run figure:recompile -- --library <content-root> <content-root>/library/sources/<id>.yaml`.

The command uses the same compiler and save rules as `figure:compile`, retaining figure, compound, atom and participant IDs and page references. Shared source files are compiled once; figures without a source cannot be recompiled directly. It prints each changed entry and totals for added, modified and deleted entries; obsolete owned reactions are removed. A failed source prints its reason, leaves that compiled figure as saved and allows the remaining sources to run; any failed source makes the final exit status nonzero. Review the changed figures with `figure:render` and compare their visible geometry before accepting the content revision. Recompilation writes the library; publication follows the content workflow.

## 重画一个已有化合物

Start with the saved compound ID and an authoritative reference image.
Locate its entry and the compiled figures that use it:

```sh
content_root=<content-root>
compound_id=cmp_<id>
rg -l --fixed-strings "$compound_id" "$content_root/library" -g '*.json' -g '*.yaml' -g '*.yml'
```

Read the compound's `smiles`, `atomIds`, `layout` and `variants`, then the matching figures' `sourceFile`, `owner` and molecule placements (including their `variant`).
For an owned reaction, use its owner's saved source.
Search the compound and affected figure IDs in `notes/` and `sites/` to find page references and their local variants, frames, numbers and focus.
Keep this list for the final render; one compound can appear in several figures.

Write a temporary single-structure YAML using the saved SMILES and the same structure fields accepted by a gallery cell:

```yaml
smiles: CCO
rot: 0
abbreviate: false
```

For a registered skeletal layout, retain the compound's SMILES and add `drawing: flat` or `drawing: perspective`; matching selects the skeleton automatically.
The `template` field selects a graph-free conformation, for example `{template: chair, subs: {1a: CH3}}`.
Run `npm run figure:draw -- <single.yaml> --out <candidate.svg>` and compare the SVG beside the reference image at the same scale.
Check the graph, stereochemistry, substituent direction, bond geometry and labels against the source.

Write the accepted drawing settings into the existing saved figure source's compound specification.
For a standalone compound without `sourceFile`, update its existing `layout` or the referenced `variants` layout, retaining its ID, graph, atom IDs and evidence.
For a skeletal layout, assign `scaffoldLayout(toolkit, compound, "flat")` to the selected saved layout, passing the existing compound to retain its atom mapping.
SVG paths are output, not saved chemical coordinates.
Recompile only the saved sources of affected figures, preserving their IDs:

```sh
heavy npm run figure:recompile -- --library "$content_root" <affected-source.yaml> [<another-source.yaml>...]
heavy npm run figure:render -- --library "$content_root" --entry "$compound_id" --out <proof-directory>
heavy npm run figure:render -- --library "$content_root" --entry <affected-figure-id> --out <proof-directory>
npm run figure:lint -- <single.yaml> <affected-source.yaml> [<another-source.yaml>...]
```

Inspect the changed-entry list from recompilation and render each affected figure with `--entry`.
For page-specific variants, numbers or focus, save those references as a JSON array and render with `--references <references.json>`.
The default proof is 1366px wide; add `--width 390` for a phone proof.
Inspect the resulting PNGs and diagnostics, and publish the requested side-by-side comparison through Artifact.
Whole-library rendering requires explicit `--all`; `--prepare` and `--inventory` are separate operations.

## Skeletal and conformation templates

For a registered skeleton, add `drawing: perspective` or `drawing: flat` to a SMILES structure or mechanism frame. The compiler matches the largest registered substructure and constrains its core to the saved view; an explicit drawing request with no match fails. Omit `drawing` for the ordinary layout. Perspective uses saved depth for bond weight and gaps at crossings; the chemical graph and stereochemistry stay with the SMILES. Inspect every wedge, substituent and crossing in both views.

Conformations have text slots and no chemical identity. Compile a standalone `kind: conformation` source with `template`, `subs`, and optional `atoms`, `bonds`, `flip`, `mirror`, `rot`, `scale`, `sub_len`, `slots`, `clash` or `bracket`. For example, `{kind: conformation, title: Chair, template: chair, subs: {1a: CH3, 1e: H}}`. Slots use `a`/`e` for axial/equatorial and `u`/`d` for faces; a ring flip exchanges axial and equatorial positions while retaining each substituent's face. Newman and sawhorse use three-item `front`/`back` arrays and `dihedral`; Fischer uses `top`, `bottom` and `rows: [[left,right], ...]`. Save the resulting `cnf_` entry in `library/conformations/` and reference it with `figure-ref`.

A route or gallery structure, or a mechanism frame, can use the same `template` fields in place of `smiles`. For example, `compounds: {a: {template: chair, subs: {1a: CH3}}, b: {template: chair, flip: true, subs: {1a: CH3}}}` with `steps: [{from: a, to: b, arrow: equilibrium}]` draws a ring flip as an ordinary route step. Embedded templates participate in numbering, labels, brackets, reaction arrows and panel spacing. Template `flip` changes conformation, `mirror` reflects it, and `rot` turns it counterclockwise. Slot text can use `{t: CH3, color: "#c62828"}` for authored red emphasis; `clash: [[1a, 3a]]` draws a repulsion arc. Templates retain their drawing semantics and do not supply atom maps for electron arrows or automatic chemical change comparison.

Set figure-level `ring_h: false` to retain ring-bond wedges in SMILES structures; structure or frame `ring_h` overrides the figure setting. The default is `true`: ring stereocentres use explicit H wedges where the native drawing requires them. The option also applies to registered skeletal views and leaves the chemical identity unchanged.

Template data lives in `shared/chemical-templates/`: one JSON file per skeleton or ring conformation. Skeleton files retain SMILES/SMARTS, atom order, conformer provenance and both views. Conformation files retain normal/flipped coordinates, bonds, default labels and named slot directions. Newman, Fischer and sawhorse are generated in code. After adding or revising a data file, run `npm run figure:templates -- --out <temporary-directory>` to regenerate the complete overview and examples with substituents. Review the overview, render the affected entries with `figure:render`, and compare with the source geometry before accepting a new template.

## Route authoring

Dependencies come from shared compound keys. Write multiple `from`/`to` keys for convergence or multiple products; each product has one producer. Each step creates an owned reaction with a complete standalone view. Connected intermediates appear once; wrapped rows start at their arrow. Two branches of a fork align before joining. If the product will not fit at the right, a short branch can reverse into a downward join. More complex joins use the compound number.

Orientation propagates outward from the largest uncrowded compound, or the figure's `anchor` key. Shared cores inherit coordinates; `align: false` keeps a free depiction, and `align: <key>` chooses another completed reference. `flip` and then `rot` apply after alignment; positive `rot` turns counterclockwise. `wrap: serpentine` reverses the next row after a downward turn. A step can request `turn: down|elbow|wrap`, `side: left|right` for vertical condition text, and `reverse: false` to retain direction. Optional positive `bond` and `width` override pixel density and the wrapping limit; defaults remain 32 and 1882. Saved entries retain both under `style`. The canvas fits visible ink with a margin of 0.8 bond lengths. Structure and frame `scale` enlarge coordinates while keeping atom labels at the same size.

For other reactants, `others: box|text|plus|none` sets the default; `{id,show}` overrides one. `box` draws a bordered structure above the arrow. `text` uses the compound's `text` or its label/name. `none` omits drawing while retaining the structural participant. Compound `bracket: true` adds brackets; `bracket: ts` adds the transition-state sign. Figure `footnote` sits below the whole diagram. Conditions, labels and footnotes support chemical italic prefixes (`n-`, `t-`, `cis-`), `*italic*`/`**bold**`, Unicode subscripts and `^{superscript}`.

Common protecting groups and terminal functional groups fold by default, using attachment-facing label spelling. A compound's `abbreviate: false` keeps it expanded; figure-level `abbreviate: [Ph, Trt, Bz]` enables optional groups. A group stays expanded when its hidden interior contains an electron-arrow endpoint; its root can remain a label and receive an arrow. Other groups keep their abbreviations. Write conditions as ordinary chemical text (`H2O`, `Pd(PPh3)4`); digits become subscripts, and a backslash keeps the next character literal. Reagents retain source order. Numbers and names use `number: name`, with a bold number; yields use parentheses.

CXSMILES repeat units such as `CCCOCC |Sg:n:2:n:ht|` retain their crossing-bond brackets and multiplier in a figure-owned layout. Set a compound's `coordgen: true` to use CoordGen for its own depiction, including a macrocyclic anchor; expanded and folded structures share the same bond length. A compound's `scale` enlarges structure coordinates while retaining the atom font size.

Set `numbers: true` to draw the explicit map numbers from that compound's input SMILES. Only mapped atoms receive a number; native atom notes place the small labels around the visible structure.

A reactant item can specify numeric `equivalents`. A product item can specify `fraction` in [0,1], separately from source-reported `ratio` and `yield` text. A step's `tags` retain its free-text classification. `reagentPosition: below-arrow` places reagents below the arrow with the conditions. Step `title` and `sources` override the figure defaults when each transformation has its own provenance.

Compilation prints a change review before the final figure ID. Inspect the reported positions and every uncomparable centre against the source. Automatic marks belong to each reaction's products; `changes: off` disables the figure or step. Use step `changes: {add: [mapNumbers], remove: [mapNumbers]}` for reviewed corrections; removal also clears incident red bonds. Retained versus inverted stereochemistry follows corresponding ligand positions, including one uniquely determined substitution.

Use structure/frame `enclose: [{atoms: [mapNumbers], shape: auto}]` for a teaching selection; `bonds: [[a,b]]` selects bonds. Optional `id` names the selection. Shapes are `auto`, `circle`, `rect` or `outline`; step `enclose: {compoundKey: [...]}` overrides a structure default and `[]` clears it. Page `focus` atoms and bonds use the same rules; electron-arrow emphasis stays independent. Auto tries a circle, rounded rectangle and outward rounded convex outline in that order. Selected atom points and complete label boxes, including subscripts, must remain fully inside; unselected visible atoms and complete label boxes must remain outside. Both sides require at least one enclosure gap (6.4 px) from the boundary ink. Disconnected selections attempt enclosures per connected component. If any component has no qualifying shape, the entire selection uses solid focus coloring for selected atoms and bonds, preserving primary or supporting colors and line widths, without enclosures. Inspect boundaries against labels, unrelated bonds, arrows and other circles; explicit shapes retain their shape and report the same containment and clearance conflicts. Bonds entering the selected group are allowed. Selected atoms inside an abbreviation keep that group expanded.

## Grouped galleries and catalytic cycles

Use `kind: gallery` with `compounds` and optional `cols` (default 4) for a grid. Use `kind: scope` for grouped product panels: `groups: [{title?,subtitle?,items: [keys]}]` selects and orders keys from `compounds`. Structure cells accept the usual orientation, abbreviation, bracket, arrow and enclosure fields; `label`/`name`, `yield` and `note` appear beneath each structure. Preserve the existing `substrate-scope` block when the page teaches a generic scheme with R-value rows; its actual-product substitution check remains required, using the mapped attachment atoms shared with Markush cores.

Use `kind: cycle` with clockwise `nodes` starting at the top. Nodes accept rich text, `{text: ...}` or `{smiles: ..., label: ...}`. Optional `steps` has one entry per node, including the return to the first: `{in?,out?,label?}` saves entering reagents, leaving products and the elementary-step label. `radius` defaults to 150 prototype reference pixels at a 17px reference bond and scales with the site bond length; `branch` defaults to 0.3 of that radius. Increase the radius if a species leaves no connecting arc.

These kinds compile to a `mec_` entry with one static `overview` scene; pages reference its ID normally. Recompile the saved YAML to retain identity, then render with the website renderer. Inspect group order, yields, clockwise step order, branch direction and phone scrolling. Draw and publish the current scene, and inspect its reported diagnostics.

## Endpoint vocabulary

- Sources: `lp(a1)` is a lone pair, `charge(a1)` a displayed negative charge, `bond(a1,a2)` sigma electrons, `pi(a1,a2)` a multiple-bond line, and `radical(a1)` a single electron.
- Destinations: `atom(a1)`, `bond(a1,a2)`, or `between(donor:a1,acceptor:a2)` for a new bond; the second atom is the acceptor. Radical endpoints use a half head; `electrons: 1` explicitly selects one for bond electrons.
- Input arrows use SMILES maps, for example `{from: "pi(2,3)", to: "atom(3)"}`; compiled entries use permanent atom IDs. Keep bond tails at their semantic midpoints. `side: left|right` selects the arc side. Cross-participant arrows belong to saved scenes; the input grammar places arrows within one compound or frame.

## Identity, references and style

- Save one entry per stable `cmp_`, `rxn_`, `rte_`, `mec_`, `img_`, `prc_` or `mku_` ID. Reactions reference compounds; routes reference reactions; mechanism frames reference compounds. Preserve graph identity when saving layout variants.
- 芳香环推电子先存 Kekulé 变体：在 `variants.<name>` 保存完整 `coords` 和含持久原子映射、明确单/双键的 `molblock`，原子顺序与 `atomIds` 一致。场景的分子用 `variant` 选它；π 锚点只接受该变体中的多键。变体经芳香化后的图、立体化学与同位素必须保持原化合物身份。
- A page uses `figure-ref` with `ref`, optional `variant`/`frame`, local `numbers`, focus and caption. Keep structures, reagents, yields, coordinates and source evidence in the library entry. Notes use a `figure-ref` fenced block; topics use `{ "type": "figure-ref", "ref": "rxn_example" }`.
- Existing structure controls accept `{ref: cmp_<id>, variant?: <name>}` in place of `smiles`, including comparisons, properties, prediction molecules and matrix rows. Keep local labels, highlight/answer indices and question IDs. For migrated indexed controls, first save an `inputSmiles` variant with the original input and abbreviations through the [content contract](../../../docs/content.md); graph deduplication can change parser indices, so use that variant to retain existing records and drawing.
- Image references keep local `alt` and caption. Use `presentation: figure` for the ordinary framed image, or `presentation: note` for a centered note illustration. Existing SVG library presentation is the default. Scene, picture-question and original-page image slots accept `{ref: img_<id>}` while retaining their own controls.
- Use normal ink plus the shared red accent. At most one primary focus and two supporting focuses; one coordinated electron event may include several related arrows. Keep unchanged structures in normal ink and use the shared design tokens for color, weight, bond length and glyph sizes.

Website chemical style is owned by `src/ui/styles/tokens.css`. At a 32px bond, atom text uses 21px (an integer for RDKit), condition text 20.71px, compound labels 22.59px and plus signs 26.35px. Bond, enclosure and solid-focus strokes use 1.98px; electron-arrow shafts use 2.28px and reaction-arrow shafts and brackets use 2.48px. RDKit drawing and label-placement measurement read the same double-bond offset (0.17) and atom-label padding (0.08) tokens. Publication uses the pinned Python RDKit through `MOLNOTES_PYTHON`, with Liberation Sans TTF for native atom labels; other figure text uses the pinned website fonts. Python owns native graph operations, canonical orientation, explicit atom-map alignment and abbreviation condensation. The scene geometry and text layout retain their existing owners.

## Common fixes

- Display deuterium as `D` through native isotope-label drawing. Retain `[2H]` in the chemical graph; replacing it with ordinary hydrogen changes identity.
- Ring stereocentres with one H and no exocyclic heavy substituent use native explicit H wedges, including fused and bridged junctions; prefer H or exocyclic substituents for stereochemical wedges. Colliding added H can rotate within its heavy-ligand sector without changing bond length or wedge sense. Counterions in charge-balanced salts default near the opposite charge centre at 1.5 bond lengths; charged mixtures retain saved separation. Preserve a deliberate salt separation with `layout.ionPairs: keep` or a pinned counterion, then inspect the rendered charges and labels.
- A large intermolecular arc usually needs reacting ends to face one another. Adjust orientation and separation so the molecules remain visibly distinct and the electron arrow has a clear medium arc; excessive tightening turns it into a small hook.
- Repeated layout defects belong to the compiler or renderer. Fix shared placement and routing, then recompile and compare the affected frames; avoid per-frame coordinate, scale or rotation changes to conceal an algorithm defect. Arrow candidates measure the visible shaft and full head, keep lone-pair dots clear, and can vary departure and arrival tangents independently around obstacles. A forming-bond midpoint stays fixed; it does not use the curl for donation into an existing bond.
- For crowded adjacent-bond transfers, turn the explicit H/D bond toward free space and bring the base near that atom. Keep the tail at the original bond midpoint. Routing measures the visible shaft, prefers a fuller short arc where space permits, and prioritizes collision avoidance in constrained rings. Inspect neighboring arrows as well as the edited one.

## Markush authoring

Use `kind: markush` with the existing `core`/`groups` fields and compile through `figure:compile`; pages reference the resulting `mku_` ID. See the [formula and coverage contract](../../../docs/content.md#markush-formulas-and-coverage-maps). `view: formula` draws the core, optional `name` and merged R-definition rows; fragment alternatives are structures. Variable ring groups use zero-based `positions`, optional `count`, and different hanging bonds on a shared ring. Core CXSMILES repeat units and `repeat` alternatives retain their brackets and range.

Use `view: map` with authored alternative `examples` counts or IDs and group `outside` labels. For `view: overlay`, provide ordered `patents` and per-alternative `by` counts; missing source keys and zero counts have different meanings. Keep source evidence for these values and for any `gaps` combinations. Conclusions describe chemical structures. Matching and example statistics remain owned by the existing Markush query and coverage table. Render the saved entry at desktop and phone widths using the ordinary figure renderer.

Markush `scale` enlarges core coordinates while preserving label sizes; the defaults are 1.3 for formulas and 1.7 for maps and overlays.
