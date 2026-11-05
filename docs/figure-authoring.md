# Author a chemical figure

Write a short YAML scene, then render it with the same RDKit renderer used by the website. Start with graph identity and semantic endpoints; inspect the PNG before adding layout adjustments. Keep sources and example-specific chemistry in the content repository.

```yaml
title: Nucleophilic addition
molecules:
  substrate: { smiles: "CC(=O)C" }
  donor: { smiles: "[OH-]", leftOf: substrate, gap: 2 }
  product: { smiles: "CC(O)([O-])C", rightOf: substrate }
arrows:
  - "donor:charge(a1) -> between(donor:a1,substrate:a2)"
  - "substrate:pi(a2,a3) -> substrate:atom(a3)"
reactions:
  - { from: substrate, to: product }
```

```sh
npm run figure:render -- --scene figure.yaml --out output --width 1366
```

Omit `--width` to render both 1366 and 390 pixel contexts. The command writes SVG, PNG, a context screenshot and JSON diagnostics, then reports input line count, layout adjustments and elapsed time. Follow the workspace policy for running render commands. A diagnostic error makes the command exit unsuccessfully.

## Molecules and placement

Each molecule needs either `smiles` or `ref`. References reuse a saved compound, including its projection, abbreviations and declared stereochemical bonds:

```yaml
molecules:
  first: { ref: cmp_example }
  second: { smiles: "CCO", rightOf: first, gap: 3, number: "2", yield: 85 }
```

Supply `--library <content-root>` when using references. `rightOf`, `leftOf`, `above` and `below` place visible molecule bounds relative to another molecule. `gap` is in standard bond lengths. Ordinary molecules use 3.5 horizontally and 1 vertically. Interacting partners use 1.2 horizontally or 0.3 vertically; multiple partners around one structure reserve 0.85 vertically. Reactive sites face their partners and align across the gap; saved projections keep their authored orientation. Molecules without a relation follow the previous molecule. `number` goes below the structure; `yield` follows immediately below the number. `plus: true` adds a plus sign between a molecule and its `rightOf` neighbor. `methyl: true` labels terminal methyl groups as Me.

For generic sites, use dummy atoms with labels in SMILES atom order:

```yaml
molecules:
  generic: { smiles: "*C(=O)*", labels: [R, X] }
  nucleophile: { smiles: "[*-]", labels: [Nu], below: generic }
```

New structures receive RDKit coordinates and standard carbonyl orientation. `orient: keep` retains the generated orientation. `molfile: shape.mol` alongside `smiles` supplies a saved conformer; the path is relative to the YAML file. For a source-dependent projection, prepare and review a reusable compound once, then use its reference in scenes. This work is separate from scene line counts.

Explicit wedge ownership uses stable atom IDs, assigned in input atom order:

```yaml
molecules:
  alcohol:
    smiles: "C[C@H](O)C(=O)O"
    wedges: [{ from: a2, to: a3, style: hashed }]
```

`solid` and `hashed` select drawing styles; `from` owns the narrow end. Declare styles only after checking the projection against the molecular stereochemistry. Charges are drawn from formal graph charges; `chargeAngles` only moves their circled signs, in degrees clockwise from right, for example `{smiles: '[Cl-]', chargeAngles: {a1: -45}}`. It does not add a charge.

## Electron arrows

Use stable atom IDs (`a1`, `a2`, …) for final inputs. IDs belong to the supplied SMILES/ref, and do not change when the scene moves or rotates a molecule. Each endpoint is `molecule:selector`; `between` accepts two qualified atom IDs so it can connect different molecules.

| Role                  | Selector                      | Meaning and geometry                                                                                                                                                                                                                                        |
| --------------------- | ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Source                | `lp(a3)`                      | Lone pair: two dots just outside the owning atom's glyph, facing the destination. The tail clears the dots by 0.1 bond length.                                                                                                                              |
| Source                | `charge(a3)`                  | Negative charge: tail starts outside the displayed circled sign; neutral donors use `lp`.                                                                                                                                                                   |
| Source                | `bond(a2,a3)`                 | Sigma electrons: tail at the bond midpoint, tangent outward from the bond.                                                                                                                                                                                  |
| Source                | `pi(a2,a3)`                   | Pi electrons: tail at the midpoint of an actual drawn multiple-bond line, tangent outward from it. For transfer into an existing bond, select the line facing that destination and use a compact arc. For an atom destination, atom order selects the side. |
| Source or destination | `radical(a3)`                 | One dot adjacent to the atom glyph. This endpoint selects a single-electron fishhook.                                                                                                                                                                       |
| Destination           | `atom(a3)`                    | Electrons become a lone pair/negative charge on the atom. The tip stops 0.18 bond length before an unlabeled skeletal atom, or 0.1 bond length outside a visible label; the incoming curve aims at the atom coordinate.                                     |
| Destination           | `bond(a2,a3)`                 | An existing bond gains bond order; head aims at its midpoint and stops 0.12 bond length before the line.                                                                                                                                                    |
| Destination           | `between(first:a2,second:a4)` | A new bond forms with the second atom as acceptor. The tip approaches that atom using the same 0.18/0.1 bond-length clearance as `atom`; donor separation does not move the tip away from the acceptor.                                                     |

```yaml
arrows:
  - "donor:lp(a1) -> between(donor:a1,acceptor:a4)"
  - "acceptor:pi(a4,a5) -> acceptor:atom(a5)"
  - "intermediate:charge(a5) -> intermediate:bond(a4,a5)"
  - { from: "fragment:radical(a1)", to: "between(fragment:a1,partner:a2)" }
```

A radical at either end uses a half arrowhead. Other arrows default to a full head for two electrons; `electrons: 1` explicitly selects a fishhook for a single electron leaving a bond. Full heads are filled, symmetric concave kites aligned with the chord from the visible shaft cutoff to the tip. Fishhooks use one filled wing with the open side facing outside the curve. The shaft stops at the rear notch. Each endpoint control stays on its departure/arrival ray at least 0.6 bond length from that endpoint (1.5 times the head length). Routing keeps the cutoff tangent within 5 degrees of the head axis, and the initial 0.15 bond-length shaft segment within 5 degrees of the departure direction. Diagnostics reject larger angles. Heads are 0.4 bond length long and 0.34 bond length wide, with a shallow 0.1 bond-length rear notch; reaction arrows share this shape. Head dimensions and line widths follow the shared bond length. The renderer gives each endpoint class its geometry above, then chooses a smooth arc around glyphs, bonds and earlier arrows. It preserves the semantic endpoint while selecting the arc side and reach; it never shifts a bond midpoint to make a curve fit.

For `between`, the incoming direction is chosen 35–60 degrees from the new-bond axis to avoid neighboring bonds. The receiver coordinate remains the target: the tip is set back along that incoming direction, so the incoming curve approaches the receiver. Unlabeled skeletal atoms use a radial clearance of 0.18 bond length; labeled atoms use the glyph boundary plus 0.1 bond length. If the two labels leave no usable space, rendering rejects the figure. Charge tails clear the circled sign. Bond destinations keep their midpoint as the target, with a 0.12 bond-length tip clearance. Short arrows use at least 0.45 bond length of arc height and 1.2 bond lengths of arc length. For nearby endpoints, the renderer can vary departure and arrival angles up to 45 degrees around the bond normal or raise the arc to fit the full-size head. The filled head participates in routing and diagnostics against labels, bonds and other arrows. Both Bezier controls stay on the same side of the clipped endpoint chord to avoid an S bend or cusp.

SMARTS remains a convenient way to locate atoms while drafting: `atom(C=O)` selects the first atom of that match; `bond(C-O)` and `pi(C=O)` select its first two atoms. `atom(Nu)` and `bond(C-X)` select named template sites. A match ordinal such as `atom(Cl)#2` is easy to get wrong after changing the input graph; replace it with a stable atom ID before final review. Bare `charge` selects the first charged atom and is likewise a drafting convenience. Explicit hydrogens in SMILES remain addressable. Abbreviations expand when an endpoint addresses an atom hidden inside them.

If the default arc side obscures the explanation, one optional adjustment is:

```yaml
arrows:
  - { from: "first:pi(a2,a3)", to: "first:atom(a3)", bend: right }
```

`bend` selects a side relative to the directed endpoint chord. For comparisons, set `comparison: true` on the scene and `tone: comparison` on the relevant arrows or reactions. Ordinary electron arrows use the shared red accent; comparison paths use the shared blue-green accent.

## Reaction arrows, branches and captions

Reaction direction follows molecule placement, including right-to-left arrows. Text accepts Unicode subscripts; each array item occupies one line.

```yaml
reactions:
  - { from: first, to: second, above: ["1. reagent"], below: ["2. workup"] }
  - {
      from: second,
      to: third,
      kind: equilibrium,
      above: [fast],
      below: [reversible],
    }
  - { from: third, to: fourth, aboveMolecule: reagent, below: [catalyst] }
  - { from: fourth, to: fifth, byproduct: salt, lane: bottom }
captions:
  first: Starting material
  fifth: Product
focus:
  - "fifth:bond(a2,a3)"
```

Declare `reagent` and `salt` in `molecules`. The reaction places an `aboveMolecule` or `belowMolecule` next to its arrow. `byproduct` adds a curved branch to a molecule above the main arrow. `lane: bottom` moves the reaction arrow below the adjacent structures. Captions follow molecule bounds. `focus` can select atoms or bonds without changing the molecular graph.

## Inspect and adjust

First confirm graph, charge, stereo, selected atoms and electron direction from the source. Then inspect the rendered PNG at normal bond scale. Diagnostics locate overlapping labels, intersecting arrows and clipped ink; they do not validate chemical interpretation.

Prefer a clearer relative placement or larger `gap` before using a local `offset: [x, y]`, `rotate: 30` or arrow `bend`. Aim for zero adjustments and usually no more than one to three fields. If many examples need the same fix, improve the shared default instead of embedding coordinates or control points in each scene. The printed adjustment count includes offset, rotate and bend; report explicit charge angles, wedge declarations and reused conformer work separately when comparing authoring effort.

## Saved library scenes

A library reaction or mechanism may be authored as YAML. Put the scene fields above inside a reaction's `scene` or each mechanism frame's `scene`; retain the entry's stable `id`, `title`, `sources`, participants, explanation and frame IDs. The content build compiles these declarations directly, so no generated JSON copy is needed. Render the saved entry with `--library <content-root> --entry <id>`.

Use `ref` for shared compounds. Scene orientation changes become named layout variants in the compiled library and preserve the saved graph, atom IDs and default layout. New `smiles` receive entry/frame-scoped IDs and inherit the entry's sources. For reuse in other entries, prepare a saved compound first. Routes retain their step graph and refer to these reactions by ID.

```yaml
kind: reaction
id: rxn_example
title: Alcohol oxidation
sources: [{ source: handbook, locator: Example 1 }]
reactants: [{ id: input, compound: cmp_alcohol }]
products: [{ id: output, compound: cmp_carbonyl }]
explanation: The primary alcohol gives the aldehyde.
scene:
  molecules:
    input: { ref: cmp_alcohol }
    output: { ref: cmp_carbonyl, rightOf: input }
  reactions:
    - { from: input, to: output, above: [Oxidant] }
```

The first declared reaction arrow supplies the reaction's main arrow and, when omitted, its reagents (`above`) and conditions (`below`). Additional arrows remain in the scene. Mechanisms retain all declared arrows inside each frame.
