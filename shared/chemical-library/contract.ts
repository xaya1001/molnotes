import { validateMarkushFigure } from "./markush.ts";
import { validateConformationSpec } from "../chemical-templates/conformation.ts";
import { isObject } from "../json.ts";
import { validateProcess } from "../process.ts";
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
  if (v.inputSmiles !== undefined) text(v.inputSmiles, w);
  if (v.molblock !== undefined) text(v.molblock, w);
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
  if (value.via !== undefined) {
    list(value.via, w);
    value.via.forEach((p) => point(p, w));
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
    reaction: "rxn",
    route: "rte",
    mechanism: "mec",
    image: "img",
    process: "prc",
    markush: "mku",
    conformation: "cnf",
  };
  if (
    !Object.hasOwn(prefixes, String(v.kind)) ||
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
  } else if (v.kind === "reaction") {
    const ids = new Set();
    for (const k of ["reactants", "products"]) {
      list(v[k], w);
      if (!v[k].length) fail(w, `empty ${k}`);
      for (const p of v[k]) {
        object(p, w);
        text(p.id, w);
        text(p.compound, w);
        if (p.sourceKey !== undefined) text(p.sourceKey, w);
        if (
          p.position !== undefined &&
          !["inline", "above-arrow", "below-arrow", "text", "none"].includes(
            String(p.position),
          )
        )
          fail(w, "invalid participant position");
        if (ids.has(p.id)) fail(w, "duplicate participant");
        ids.add(p.id);
        for (const k of ["yield", "ratio", "number", "name"])
          if (p[k] !== undefined && typeof p[k] !== "string")
            fail(w, `${k} must be text`);
        for (const n of ["equivalents", "fraction"]) {
          if (p[n] === undefined) continue;
          number(p[n], w);
          if (Number(p[n]) < 0 || (n !== "equivalents" && Number(p[n]) > 1))
            fail(w, `${n} out of range`);
        }
      }
    }
    if (v.plusAt !== undefined) {
      list(v.plusAt, w);
      if (
        v.plusAt.length !==
        Math.max(
          0,
          (v.reactants as { position?: string }[]).filter(
            (p) => !p.position || p.position === "inline",
          ).length - 1,
        )
      )
        fail(w, "one separator per additional reactant required");
      v.plusAt.forEach((p) => point(p, w));
    }
    strings(v.reagents, w);
    if (
      v.reagentPosition !== undefined &&
      !["above-arrow", "below-arrow"].includes(String(v.reagentPosition))
    )
      fail(w, "invalid reagent position");
    strings(v.conditions, w);
    if (v.tags !== undefined) strings(v.tags, w);
    text(v.explanation, w);
    scene(v.scene, w);
    reactionArrow(v.arrow, w);
  } else if (v.kind === "route") {
    list(v.steps, w);
    const ids = new Set();
    for (const s of v.steps) {
      object(s, w);
      text(s.id, w);
      text(s.reaction, w);
      point(s.at, w);
      if (s.display !== undefined) {
        object(s.display, w);
        for (const value of Object.values(s.display))
          if (!["structure", "reference", "hidden"].includes(String(value)))
            fail(w, "invalid participant display");
      }
      if (s.placements !== undefined) {
        object(s.placements, w);
        Object.values(s.placements).forEach((p) => point(p, w));
      }
      for (const key of ["reagents", "conditions", "boxes"])
        if (s[key] !== undefined) strings(s[key], w);
      if (s.arrow !== undefined) reactionArrow(s.arrow, w);
      if (ids.has(s.id)) fail(w, "duplicate route step");
      ids.add(s.id);
    }
    list(v.edges, w);
    for (const e of v.edges) {
      object(e, w);
      for (const k of ["from", "to", "product", "reactant"]) text(e[k], w);
      if (!ids.has(e.from) || !ids.has(e.to)) fail(w, "unknown route step");
    }
    if (v.plusAt !== undefined) {
      list(v.plusAt, w);
      v.plusAt.forEach((p) => point(p, w));
    }
    if (v.connections !== undefined) {
      list(v.connections, w);
      for (const c of v.connections) {
        object(c, w);
        text(c.id, w);
        list(c.points, w);
        if (c.points.length < 2) fail(w, "connection needs two points");
        c.points.forEach((p) => point(p, w));
      }
    }
    number(v.width, w);
    number(v.height, w);
    if (Number(v.width) <= 0 || Number(v.height) <= 0)
      fail(w, "positive canvas required");
  } else if (v.kind === "mechanism") {
    if (
      !["reaction", "resonance", "comparison", "examples"].includes(
        String(v.category),
      )
    )
      fail(w, "unknown semantic category");
    list(v.frames, w);
    if (!v.frames.length) fail(w, "frames required");
    for (const f of v.frames) {
      object(f, w);
      text(f.id, w);
      text(f.title, w);
      text(f.explanation, w);
      scene(f.scene, w);
    }
    if (v.maps !== undefined) {
      list(v.maps, w);
      for (const m of v.maps) {
        object(m, w);
        ref(m.from, w);
        ref(m.to, w);
        text(m.fromFrame, w);
        text(m.toFrame, w);
      }
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
      "overview",
      "footnote",
    ]);
  } else if (v.kind === "process") {
    validateProcess(v, w);
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
  if (entry.kind === "compound")
    return entry.template?.flatMap((t) => t.allowed) ?? [];
  if (entry.kind === "reaction")
    return [
      ...new Set(
        [...entry.reactants, ...entry.products, ...entry.scene.molecules].map(
          (p) => p.compound,
        ),
      ),
    ];
  if (entry.kind === "route") return entry.steps.map((s) => s.reaction);
  if (entry.kind === "mechanism")
    return entry.frames.flatMap((f) =>
      f.scene.molecules.map((m) => m.compound),
    );
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
    if (compound?.kind !== "compound" || !compound.atomIds.includes(ref.atom))
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
    (entry.kind !== "mechanism" ||
      !entry.frames.some((f) => f.id === reference.frame))
  )
    fail(entry.id, "unknown frame");
  let scenes: { scene: Pick<Scene, "molecules" | "arrows">; prefix: string }[] =
    [];
  if (entry.kind === "compound")
    scenes = [
      {
        scene: {
          molecules: [
            { id: "compound", compound: entry.id, at: { x: 0, y: 0 } },
          ],
        },
        prefix: "",
      },
    ];
  if (entry.kind === "reaction") scenes = [{ scene: entry.scene, prefix: "" }];
  if (entry.kind === "mechanism")
    scenes = [
      {
        scene: (
          entry.frames.find((f) => f.id === reference.frame) ?? entry.frames[0]
        ).scene,
        prefix: "",
      },
    ];
  if (entry.kind === "route")
    scenes = entry.steps.map((s) => {
      const reaction = library[s.reaction];
      if (reaction?.kind !== "reaction")
        fail(entry.id, "missing route reaction");
      return { scene: reaction.scene, prefix: s.id + "/" };
    });
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
      if (compound?.kind !== "compound" || !compound.atomIds.includes(ref.atom))
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
      const kind =
        entry.kind === "route"
          ? "reaction"
          : entry.kind === "image"
            ? "image"
            : "compound";
      if (
        other.kind !== kind &&
        !(
          (entry.kind === "reaction" || entry.kind === "mechanism") &&
          other.kind === "conformation"
        )
      )
        fail(entry.id, `expected ${kind}: ${id}`);
    }
    if (entry.kind === "route")
      for (const step of entry.steps) {
        const reaction = library[step.reaction];
        if (reaction.kind !== "reaction")
          fail(entry.id, "route requires reaction");
        const placements = new Set(reaction.scene.molecules.map((m) => m.id));
        for (const id of new Set([
          ...Object.keys(step.display ?? {}),
          ...Object.keys(step.placements ?? {}),
          ...(step.boxes ?? []),
        ]))
          if (!placements.has(id))
            fail(entry.id, `unknown route placement ${step.id}/${id}`);
      }
    const scenes =
      entry.kind === "reaction"
        ? [entry.scene]
        : entry.kind === "mechanism"
          ? entry.frames.map((f) => f.scene)
          : [];
    for (const s of scenes) {
      const ids = new Set(s.molecules.map((m) => m.id));
      for (const m of s.molecules) {
        const c = library[m.compound];
        if (!c || (c.kind !== "compound" && c.kind !== "conformation"))
          fail(entry.id, `unknown compound ${m.compound}`);
        if (m.variant && (c.kind !== "compound" || !c.variants?.[m.variant]))
          fail(entry.id, `unknown variant ${m.variant}`);
      }
      if (entry.kind === "reaction")
        for (const p of [...entry.reactants, ...entry.products]) {
          if (p.position === "text" || p.position === "none") continue;
          const m = s.molecules.find((m) => m.id === p.id);
          if (!m || m.compound !== p.compound)
            fail(entry.id, `participant not placed: ${p.id}`);
        }
      if (ids.size !== s.molecules.length)
        fail(entry.id, "duplicate placement");
      validateSceneReferences(s, library, entry.id);
    }
    if (entry.kind === "mechanism") {
      if (new Set(entry.frames.map((f) => f.id)).size !== entry.frames.length)
        fail(entry.id, "duplicate frame");
      for (const map of entry.maps ?? [])
        for (const [frameId, ref] of [
          [map.fromFrame, map.from],
          [map.toFrame, map.to],
        ] as const) {
          const frame = entry.frames.find((f) => f.id === frameId);
          if (!frame) fail(entry.id, `unknown mapped frame ${frameId}`);
          validateSceneReferences(frame.scene, library, entry.id, {
            primary: { atoms: [ref] },
          });
        }
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
