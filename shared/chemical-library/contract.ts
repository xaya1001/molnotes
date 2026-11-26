import { validateMarkushFigure } from "./markush.ts";
import { validateConformationSpec } from "../chemical-templates/conformation.ts";
import { isObject } from "../json.ts";
import { graphReferenceScenes, graphScenes } from "./figure-layout.ts";
import type {
  Library,
  LibraryEntry,
  Scene,
  FigureReference,
  AtomRef,
  Focus,
} from "./types.ts";
function fail(where: string, message: string): never {
  throw new Error(`${where}: ${message}`);
}
function object(v: unknown, w: string): asserts v is Record<string, unknown> {
  if (!isObject(v)) fail(w, "expected object");
}
function text(v: unknown, w: string): asserts v is string {
  if (typeof v !== "string" || !v.trim()) fail(w, "expected text");
}
function list(v: unknown, w: string): asserts v is unknown[] {
  if (!Array.isArray(v)) fail(w, "expected array");
}
function number(v: unknown, w: string) {
  if (typeof v !== "number" || !Number.isFinite(v))
    fail(w, "expected finite number");
}
function point(v: unknown, w: string) {
  object(v, w);
  number(v.x, w);
  number(v.y, w);
}
function strings(v: unknown, w: string): asserts v is string[] {
  list(v, w);
  v.forEach((x) => text(x, w));
}
function ref(v: unknown, w: string) {
  object(v, w);
  text(v.molecule, w);
  text(v.atom, w);
}
function pair(v: unknown, w: string) {
  list(v, w);
  if (v.length !== 2) fail(w, "expected two atoms");
  v.forEach((x) => ref(x, w));
}
function focus(v: unknown, w: string) {
  if (v === undefined) return;
  object(v, w);
  const groups = [v.primary];
  if (v.supporting !== undefined) {
    list(v.supporting, w);
    if (v.supporting.length > 2) fail(w, "at most two supporting focus groups");
    groups.push(...v.supporting);
  }
  for (const g of groups) {
    if (g === undefined) continue;
    object(g, w);
    for (const k of Object.keys(g))
      if (!["atoms", "bonds", "arrows"].includes(k))
        fail(w, `unknown focus field ${k}`);
    if (g.atoms !== undefined) {
      list(g.atoms, w);
      g.atoms.forEach((x) => ref(x, w));
    }
    if (g.bonds !== undefined) {
      list(g.bonds, w);
      g.bonds.forEach((x) => pair(x, w));
    }
    if (g.arrows !== undefined) strings(g.arrows, w);
  }
}
function layout(v: unknown, w: string) {
  object(v, w);
  if (
    v.reagentAbbreviate !== undefined &&
    typeof v.reagentAbbreviate !== "boolean"
  )
    fail(w, "reagentAbbreviate must be a boolean");
  if (v.inputSmiles !== undefined) text(v.inputSmiles, w);
  if (v.molblock !== undefined) text(v.molblock, w);
  if (v.explicitHydrogens !== undefined) {
    object(v.explicitHydrogens, w);
    text(v.inputSmiles, w);
    for (const [id, parent] of Object.entries(v.explicitHydrogens)) {
      if (!/^a[1-9]\d*$/.test(id))
        fail(w, "explicit hydrogen requires a stable atom ID");
      text(parent, w);
    }
  }
  object(v.coords, w);
  if (
    v.ionPairs !== undefined &&
    v.ionPairs !== "near" &&
    v.ionPairs !== "keep"
  )
    fail(w, "ionPairs must be near or keep");
  const coordinates = v.coords;
  for (const p of Object.values(coordinates)) point(p, w);
  if (v.scaffold !== undefined) {
    const s = v.scaffold;
    object(s, w);
    text(s.id, w);
    if (s.drawing !== "flat" && s.drawing !== "perspective")
      fail(w, "unknown scaffold drawing");
    const bond = (b: unknown) => {
      strings(b, w);
      if (b.length !== 2) fail(w, "scaffold bond requires two atoms");
      for (const id of b)
        if (!Object.hasOwn(coordinates, id)) fail(w, "unknown scaffold atom");
    };
    list(s.bonds, w);
    s.bonds.forEach(bond);
    if (s.drawing === "perspective") {
      object(s.depths, w);
      Object.values(s.depths).forEach((n) => number(n, w));
      for (const b of s.bonds) {
        strings(b, w);
        for (const id of b)
          if (!Object.hasOwn(s.depths, id)) fail(w, "scaffold depth required");
      }
      list(s.depthWidth, w);
      if (s.depthWidth.length !== 2)
        fail(w, "scaffold depth width requires two values");
      s.depthWidth.forEach((n) => {
        number(n, w);
        if (Number(n) <= 0) fail(w, "positive scaffold width required");
      });
    }
    if (s.overpasses !== undefined) {
      list(s.overpasses, w);
      for (const pair of s.overpasses) {
        list(pair, w);
        if (pair.length !== 2) fail(w, "overpass requires two bonds");
        pair.forEach(bond);
      }
    }
  }
  if (v.ringHydrogens !== undefined && typeof v.ringHydrogens !== "boolean")
    fail(w, "ringHydrogens must be boolean");
  if (v.atomNumbers !== undefined) {
    object(v.atomNumbers, w);
    for (const value of Object.values(v.atomNumbers)) {
      number(value, w);
      if (!Number.isInteger(value) || Number(value) <= 0)
        fail(w, "positive atom number required");
    }
  }
  if (v.repeatUnits !== undefined) {
    list(v.repeatUnits, w);
    for (const unit of v.repeatUnits) {
      object(unit, w);
      list(unit.atoms, w);
      if (!unit.atoms.length) fail(w, "repeat unit requires atoms");
      unit.atoms.forEach((atom) => text(atom, w));
      text(unit.label, w);
      if (unit.compact !== undefined && typeof unit.compact !== "boolean")
        fail(w, "compact repeat must be boolean");
    }
  }
  for (const k of ["pins", "labels"]) {
    if (v[k] !== undefined) {
      object(v[k], w);
      Object.values(v[k]).forEach((p) => point(p, w));
    }
  }
}
function anchor(v: unknown, w: string) {
  object(v, w);
  if (v.kind === "atom" || v.kind === "charge" || v.kind === "radical")
    ref(v.at, w);
  else if (v.kind === "bond" || v.kind === "pi" || v.kind === "formingBond") {
    pair(v.atoms, w);
    if (v.fraction !== undefined) {
      number(v.fraction, w);
      if (Number(v.fraction) < 0 || Number(v.fraction) > 1)
        fail(w, "fraction out of range");
    }
  } else if (v.kind === "lonePair") text(v.label, w);
  else fail(w, "unknown anchor");
}
function scene(v: unknown, w: string): asserts v is Scene {
  object(v, w);
  number(v.width, w);
  number(v.height, w);
  if (Number(v.width) <= 0 || Number(v.height) <= 0)
    fail(w, "positive canvas required");
  list(v.molecules, w);
  const ids = new Set();
  for (const m of v.molecules) {
    object(m, w);
    text(m.id, w);
    if (ids.has(m.id)) fail(w, "duplicate placement");
    ids.add(m.id);
    text(m.compound, w);
    if (
      m.bracket !== undefined &&
      typeof m.bracket !== "boolean" &&
      m.bracket !== "ts"
    )
      fail(w, "invalid bracket");
    if (m.caption !== undefined) {
      object(m.caption, w);
      if (typeof m.caption.number !== "string")
        fail(w, "placement caption needs a number");
      for (const key of ["name", "yield", "note"])
        if (m.caption[key] !== undefined) text(m.caption[key], w);
    }
    point(m.at, w);
    if (m.rotate !== undefined) number(m.rotate, w);
    if (m.mirror !== undefined && typeof m.mirror !== "boolean")
      fail(w, "mirror must be boolean");
  }
  focus(v.focus, w);
  if (v.changes !== undefined) focus({ primary: v.changes }, w);
  if (v.enclose !== undefined) {
    list(v.enclose, w);
    for (const e of v.enclose) {
      object(e, w);
      text(e.id, w);
      if (e.atoms !== undefined) {
        list(e.atoms, w);
        e.atoms.forEach((a) => ref(a, w));
      }
      if (e.bonds !== undefined) {
        list(e.bonds, w);
        e.bonds.forEach((b) => pair(b, w));
      }
      if (!e.atoms?.length && !e.bonds?.length)
        fail(w, "enclosure requires atoms or bonds");
      if (
        e.shape !== undefined &&
        !["auto", "circle", "rect", "outline"].includes(String(e.shape))
      )
        fail(w, "unknown enclosure shape");
    }
  }
  if (v.labels !== undefined) {
    list(v.labels, w);
    for (const l of v.labels) {
      object(l, w);
      text(l.id, w);
      ref(l.at, w);
      point(l.offset, w);
      if (
        !["lonePair", "radical", "charge", "partialCharge", "text"].includes(
          String(l.kind),
        )
      )
        fail(w, "invalid label kind");
      if (l.kind !== "lonePair" && l.kind !== "radical") text(l.text, w);
    }
  }
  if (v.arrows !== undefined) {
    list(v.arrows, w);
    for (const a of v.arrows) {
      object(a, w);
      text(a.id, w);
      anchor(a.from, w);
      anchor(a.to, w);
      if (a.electrons !== 1 && a.electrons !== 2)
        fail(w, "electrons must be 1 or 2");
    }
  }
  if (v.partialBonds !== undefined) {
    list(v.partialBonds, w);
    for (const b of v.partialBonds) {
      object(b, w);
      pair(b.atoms, w);
      number(b.order, w);
    }
  }
  if (v.captionBoxes !== undefined) {
    list(v.captionBoxes, w);
    for (const box of v.captionBoxes) {
      object(box, w);
      point(box.at, w);
      number(box.width, w);
      number(box.height, w);
      if (Number(box.width) <= 0 || Number(box.height) <= 0)
        fail(w, "positive caption box required");
      if (box.border !== undefined && typeof box.border !== "boolean")
        fail(w, "caption border must be boolean");
    }
  }
}
export function validateFigureReference(
  v: unknown,
  w = "figure",
): asserts v is FigureReference {
  object(v, w);
  text(v.ref, w);
  for (const k of Object.keys(v))
    if (
      ![
        "type",
        "id",
        "ref",
        "variant",
        "frame",
        "numbers",
        "focus",
        "caption",
        "alt",
        "presentation",
      ].includes(k)
    )
      fail(w, `unknown reference field ${k}`);
  for (const k of ["variant", "frame", "caption", "alt"])
    if (v[k] !== undefined) text(v[k], w);
  if (
    v.presentation !== undefined &&
    !["figure", "note"].includes(String(v.presentation))
  )
    fail(w, "unknown image presentation");
  if (v.numbers !== undefined) {
    object(v.numbers, w);
    Object.values(v.numbers).forEach((x) => text(x, w));
  }
  focus(v.focus, w);
}
/** Image slots accept saved image identity while retaining their own controls and layout. */
export function validateImageReference(
  value: unknown,
  where = "image",
): asserts value is FigureReference {
  validateFigureReference(value, where);
  if (!value.ref.startsWith("img_")) fail(where, "expected image reference");
}

function reactionArrow(value: unknown, w: string) {
  object(value, w);
  point(value.from, w);
  point(value.to, w);
  if (
    value.kind !== undefined &&
    !["forward", "equilibrium", "resonance", "retro", "none"].includes(
      String(value.kind),
    )
  )
    fail(w, "invalid arrow kind");
  number(value.textWidth, w);
  if (Number(value.textWidth) <= 0) fail(w, "positive text width required");
  if (value.points !== undefined) {
    list(value.points, w);
    value.points.forEach((p) => point(p, w));
  }
}

function figureGraph(value: unknown, where: string) {
  object(value, where);
  object(value.states, where);
  object(value.arrows, where);
  if (!Object.keys(value.states).length) fail(where, "requires states");
  const groups = value.groups ?? {};
  object(groups, where);
  const hasItem = (id: string) =>
    Object.hasOwn(value.states as object, id) || Object.hasOwn(groups, id);
  for (const [id, state] of Object.entries(value.states)) {
    const location = `${where}.states.${id}`;
    object(state, location);
    if (state.scene !== undefined) scene(state.scene, location);
    if (state.title !== undefined) text(state.title, location);
    if (state.text !== undefined) text(state.text, location);
  }
  for (const [id, group] of Object.entries(groups)) {
    const location = `${where}.groups.${id}`;
    object(group, location);
    strings(group.items, location);
    if (group.items.some((item) => !hasItem(item)))
      fail(location, "unknown item");
    if (group.scene !== undefined) scene(group.scene, location);
  }
  for (const [id, arrow] of Object.entries(value.arrows)) {
    const location = `${where}.arrows.${id}`;
    object(arrow, location);
    if (
      !["forward", "equilibrium", "resonance", "retro", "none"].includes(
        String(arrow.kind),
      )
    )
      fail(location, "invalid arrow kind");
    if (!["reaction", "elementary", "display"].includes(String(arrow.role)))
      fail(location, "invalid arrow role");
    for (const endpoints of [arrow.from, arrow.to]) {
      list(endpoints, location);
      if (!endpoints.length) fail(location, "requires arrow endpoints");
      for (const endpoint of endpoints) {
        object(endpoint, location);
        text(endpoint.state, location);
        if (!hasItem(endpoint.state)) fail(location, "unknown endpoint");
      }
    }
    if (arrow.drawing !== undefined) {
      object(arrow.drawing, location);
      scene(arrow.drawing.scene, location);
      reactionArrow(arrow.drawing.arrow, location);
    }
    if (arrow.via !== undefined) figureGraph(arrow.via, location + ".via");
  }
  if (value.layout !== undefined) {
    object(value.layout, where);
    if (value.layout.panel !== undefined) scene(value.layout.panel, where);
  }
}
export function validateLibraryEntry(
  v: unknown,
  w = "library",
): asserts v is LibraryEntry {
  object(v, w);
  text(v.id, w);
  text(v.title, w);
  if (v.footnote !== undefined) text(v.footnote, w);
  if (!/^(cmp|rxn|rte|mec|img|prc|cnf|mku)_[a-z0-9_-]+$/.test(v.id))
    fail(w, "invalid stable ID");
  list(v.sources, w);
  if (!v.sources.length) fail(w, "source required");
  for (const s of v.sources) {
    object(s, w);
    text(s.source, w);
    text(s.locator, w);
    if (s.source === "unknown") text(s.note, w);
  }
  const prefixes = {
    compound: "cmp",
    image: "img",
    markush: "mku",
    conformation: "cnf",
  };
  if (
    v.kind === "figure"
      ? !/^(rxn|rte|mec)_/.test(v.id)
      : !Object.hasOwn(prefixes, String(v.kind)) ||
        !v.id.startsWith(prefixes[v.kind as keyof typeof prefixes] + "_")
  )
    fail(w, "ID kind mismatch");
  if (v.style !== undefined) {
    object(v.style, w);
    for (const [key, value] of Object.entries(v.style)) {
      if (key !== "bond" && key !== "width")
        fail(w, "unknown figure style field");
      number(value, w);
      if (Number(value) <= 0) fail(w, "positive figure style required");
    }
  }
  if (v.kind === "compound") {
    text(v.smiles, w);
    if (v.attachment !== undefined) text(v.attachment, w);
    strings(v.atomIds, w);
    if (new Set(v.atomIds as string[]).size !== (v.atomIds as string[]).length)
      fail(w, "duplicate atom IDs");
    text(v.graph, w);
    layout(v.layout, w);
    if (v.variants !== undefined) {
      object(v.variants, w);
      Object.values(v.variants).forEach((l) => layout(l, w));
    }
    if (v.template !== undefined) {
      list(v.template, w);
      for (const t of v.template) {
        object(t, w);
        text(t.atom, w);
        text(t.label, w);
        text(t.description, w);
        strings(t.allowed, w);
      }
    }
  } else if (v.kind === "figure") {
    figureGraph(v.graph, w + ".graph");
    object(v.views, w);
    for (const [id, view] of Object.entries(v.views)) {
      object(view, `${w}.views.${id}`);
      strings(view.items, `${w}.views.${id}`);
    }
  } else if (v.kind === "markush") {
    validateMarkushFigure(v, w);
  } else if (v.kind === "conformation") {
    validateConformationSpec(v, w, [
      "kind",
      "id",
      "title",
      "sources",
      "sourceFile",
      "sourceKey",
      "owner",
      "footnote",
    ]);
  } else {
    for (const field of ["author", "prompt"])
      if (v[field] !== undefined) text(v[field], w);
    if (v.derivedFrom !== undefined) strings(v.derivedFrom, w);
    text(v.asset, w);
    if (!/^[a-f0-9]{64}\.(png|jpe?g|webp|svg|gif)$/.test(v.asset as string))
      fail(w, "image asset must be content-addressed");
    for (const k of ["mime", "purpose", "rights", "alt"]) text(v[k], w);
    number(v.width, w);
    number(v.height, w);
    if (Number(v.width) <= 0 || Number(v.height) <= 0)
      fail(w, "positive dimensions required");
    if (v.crop !== undefined) {
      object(v.crop, w);
      for (const k of ["x", "y", "width", "height"]) number(v.crop[k], w);
      if (
        Number(v.crop.x) < 0 ||
        Number(v.crop.y) < 0 ||
        Number(v.crop.width) <= 0 ||
        Number(v.crop.height) <= 0 ||
        Number(v.crop.x) + Number(v.crop.width) > Number(v.width) ||
        Number(v.crop.y) + Number(v.crop.height) > Number(v.height)
      )
        fail(w, "crop outside image");
    }
  }
}
export function libraryDependencies(entry: LibraryEntry): string[] {
  if (entry.kind === "image") return entry.derivedFrom ?? [];
  if (entry.kind === "figure")
    return [
      ...new Set(
        graphScenes(entry.graph).flatMap((scene) =>
          scene.molecules.map(({ compound }) => compound),
        ),
      ),
    ];
  if (entry.kind === "compound")
    return entry.template?.flatMap((t) => t.allowed) ?? [];
  return [];
}
function validateFocusReferences(
  focus: Focus | undefined,
  atom: (ref: AtomRef) => void,
  arrows: Set<string>,
  where: string,
) {
  for (const group of [focus?.primary, ...(focus?.supporting ?? [])]) {
    group?.atoms?.forEach(atom);
    group?.bonds?.forEach((pair) => pair.forEach(atom));
    for (const id of group?.arrows ?? [])
      if (!arrows.has(id)) fail(where, `unknown focus arrow ${id}`);
  }
}
function validateSceneReferences(
  scene: Scene,
  library: Library,
  where: string,
  override?: Focus,
) {
  const atom = (ref: AtomRef) => {
    const placement = scene.molecules.find((m) => m.id === ref.molecule);
    const compound = placement && library[placement.compound];
    if (
      compound?.kind !== "compound" ||
      !(
        compound.atomIds.includes(ref.atom) ||
        (placement?.variant &&
          Object.hasOwn(
            compound.variants?.[placement.variant]?.explicitHydrogens ?? {},
            ref.atom,
          ))
      )
    )
      fail(where, `unknown atom ${ref.molecule}:${ref.atom}`);
  };
  const unique = (ids: string[], kind: string) => {
    if (new Set(ids).size !== ids.length) fail(where, `duplicate ${kind}`);
  };
  unique(
    (scene.labels ?? []).map((l) => l.id),
    "label",
  );
  unique(
    (scene.arrows ?? []).map((a) => a.id),
    "arrow",
  );
  for (const label of scene.labels ?? []) atom(label.at);
  for (const arrow of scene.arrows ?? [])
    for (const anchor of [arrow.from, arrow.to]) {
      if (
        anchor.kind === "atom" ||
        anchor.kind === "charge" ||
        anchor.kind === "radical"
      )
        atom(anchor.at);
      else if (anchor.kind === "lonePair") {
        if (
          !scene.labels?.some(
            (l) => l.id === anchor.label && l.kind === "lonePair",
          )
        )
          fail(where, `unknown lone pair ${anchor.label}`);
      } else anchor.atoms.forEach(atom);
    }
  for (const bond of scene.partialBonds ?? []) bond.atoms.forEach(atom);
  unique(
    (scene.enclose ?? []).map((e) => e.id),
    "enclosure",
  );
  for (const e of scene.enclose ?? []) {
    e.atoms?.forEach(atom);
    e.bonds?.forEach((b) => b.forEach(atom));
  }
  scene.changes?.atoms?.forEach(atom);
  scene.changes?.bonds?.forEach((b) => b.forEach(atom));
  validateFocusReferences(
    override ?? scene.focus,
    atom,
    new Set(scene.arrows?.map((a) => a.id)),
    where,
  );
}
export function figureViewKeys(entry: LibraryEntry) {
  return entry.kind === "figure" ? Object.keys(entry.views) : [];
}
export function validateFigureInstance(
  library: Library,
  reference: FigureReference,
) {
  const entry = library[reference.ref];
  if (!entry) fail(reference.ref, "unknown figure");
  if (
    reference.presentation !== undefined &&
    (entry.kind !== "image" || entry.crop)
  )
    fail(entry.id, "presentation requires an uncropped image");
  if (reference.alt !== undefined && entry.kind !== "image")
    fail(entry.id, "alt requires an image");
  if (
    reference.variant &&
    (entry.kind !== "compound" || !entry.variants?.[reference.variant])
  )
    fail(entry.id, "unknown layout variant");
  if (
    reference.frame &&
    (entry.kind !== "figure" || !entry.views[reference.frame])
  )
    fail(entry.id, "unknown graph view");
  const scenes: {
    scene: Pick<Scene, "molecules" | "arrows">;
    prefix: string;
  }[] =
    entry.kind === "figure"
      ? graphReferenceScenes(entry, reference.frame)
      : entry.kind === "compound"
        ? [
            {
              scene: {
                molecules: [
                  { id: "compound", compound: entry.id, at: { x: 0, y: 0 } },
                ],
              },
              prefix: "",
            },
          ]
        : [];
  const molecules = scenes.flatMap(({ scene, prefix }) =>
    scene.molecules.map((m) => ({ ...m, id: prefix + m.id })),
  );
  const arrows = new Set(
    scenes.flatMap(({ scene, prefix }) =>
      (scene.arrows ?? []).map((a) => prefix + a.id),
    ),
  );
  validateFocusReferences(
    reference.focus,
    (ref) => {
      const placement = molecules.find((m) => m.id === ref.molecule),
        compound = placement && library[placement.compound];
      if (
        compound?.kind !== "compound" ||
        !(
          compound.atomIds.includes(ref.atom) ||
          (placement?.variant &&
            Object.hasOwn(
              compound.variants?.[placement.variant]?.explicitHydrogens ?? {},
              ref.atom,
            ))
        )
      )
        fail(entry.id, `unknown atom ${ref.molecule}:${ref.atom}`);
    },
    arrows,
    entry.id,
  );
  for (const id of Object.keys(reference.numbers ?? {}))
    if (!molecules.some((m) => m.id === id))
      fail(entry.id, `unknown numbered placement ${id}`);
}
export function validateLibrary(library: Library) {
  for (const entry of Object.values(library)) {
    validateLibraryEntry(entry, entry.id);
    for (const id of libraryDependencies(entry)) {
      const other = library[id];
      if (!other) fail(entry.id, `missing reference ${id}`);
      const kind = entry.kind === "image" ? "image" : "compound";
      if (
        other.kind !== kind &&
        !(entry.kind === "figure" && other.kind === "conformation")
      )
        fail(entry.id, `expected ${kind}: ${id}`);
    }
    const scenes = entry.kind === "figure" ? graphScenes(entry.graph) : [];
    for (const s of scenes) {
      const ids = new Set(s.molecules.map((m) => m.id));
      for (const m of s.molecules) {
        const c = library[m.compound];
        if (!c || (c.kind !== "compound" && c.kind !== "conformation"))
          fail(entry.id, `unknown compound ${m.compound}`);
        if (m.variant && (c.kind !== "compound" || !c.variants?.[m.variant]))
          fail(entry.id, `unknown variant ${m.variant}`);
      }
      if (ids.size !== s.molecules.length)
        fail(entry.id, "duplicate placement");
      validateSceneReferences(s, library, entry.id);
    }
  }
  const visiting = new Set<string>(),
    done = new Set<string>();
  function visit(id: string) {
    if (visiting.has(id)) fail(id, "cyclic library references");
    if (done.has(id)) return;
    visiting.add(id);
    libraryDependencies(library[id]).forEach(visit);
    visiting.delete(id);
    done.add(id);
  }
  Object.keys(library).forEach(visit);
}
