import type { FigureInput, FrameInput } from "./figure-input.ts";
import type { FigureStyle } from "../src/ui/library/scene-geometry.ts";
import type {
  Library,
  Mechanism,
  Participant,
  Reaction,
  Route,
  Scene,
  AtomRef,
} from "../shared/chemical-library/types.ts";
import { compilePanelScene, type PanelCell } from "./figure-panels.ts";
import { compileRouteLayout } from "./figure-route.ts";
import { prepareFigure } from "../src/ui/library/prepare.ts";
import { loadFigureFonts } from "./figure-fonts.ts";
import { moleculeToolkit } from "../shared/molecule-toolkit.ts";
import {
  compoundView,
  placedCoordinates,
} from "../shared/chemical-library/chemistry.ts";
import { placeBondContacts } from "./figure-fragments.ts";

const words = (value: string | number | undefined) =>
  value === undefined ? "" : String(value);
const keys = (
  value:
    | NonNullable<FrameInput["steps"]>[number]["from"]
    | NonNullable<FrameInput["steps"]>[number]["to"],
) =>
  (Array.isArray(value) ? value : [value]).map((v) =>
    String(typeof v === "object" ? v.id : v),
  );

/** Frame grids and transformations use the same measured layouts as figure panels and routes. */
export async function compileMechanismFrameLayout(
  library: Library,
  entry: Mechanism,
  frame: Pick<FrameInput, "id" | "steps">,
  cells: PanelCell[],
  input: FigureInput,
  style: FigureStyle,
  contacts: [AtomRef, AtomRef][],
  partialBonds: [AtomRef, AtomRef][],
  placementCaptions: boolean,
): Promise<Scene> {
  if (!frame.steps?.length) {
    const bonds = partialBonds.filter(([a, b]) => a.molecule !== b.molecule);
    if (cells.length === 2 && bonds.length) {
      const toolkit = await moleculeToolkit();
      const drawings = cells.map(({ scene }) => {
        const placement = scene.molecules[0];
        const entry = library[placement.compound];
        if (entry.kind !== "compound")
          throw new Error("Partial bonds require chemical atoms");
        const layout = placement.variant
          ? entry.variants![placement.variant]
          : entry.layout;
        const compound = compoundView(toolkit, entry, layout);
        const points = placedCoordinates(
          toolkit,
          compound,
          layout,
          placement.rotate,
          placement.mirror,
        );
        return {
          placement,
          points,
          point: ({ atom }: AtomRef) => points[compound.atomIds.indexOf(atom)],
        };
      });
      const [fixed, moving] = drawings.sort(
        (a, b) => b.points.length - a.points.length,
      );
      const anchor = fixed.placement,
        shifted = moving.placement;
      const positioned = placeBondContacts(
        fixed.points,
        moving.points,
        bonds.map(([a, b]) =>
          a.molecule === anchor.id
            ? [fixed.point(a), moving.point(b)]
            : [fixed.point(b), moving.point(a)],
        ),
      );
      if (Math.abs(positioned.rotate) > 1e-9)
        shifted.rotate = (shifted.rotate ?? 0) + positioned.rotate;
      return compilePanelScene(
        library,
        entry,
        { ...input, kind: "gallery" },
        cells,
        style,
        placementCaptions,
        { [anchor.id]: { x: 0, y: 0 }, [shifted.id]: positioned.at },
      );
    }
    const forward = await compilePanelScene(
      library,
      entry,
      { ...input, kind: "gallery" },
      cells,
      style,
      placementCaptions,
    );
    if (cells.length !== 2 || !contacts.length) return forward;
    const reverse = await compilePanelScene(
      library,
      entry,
      { ...input, kind: "gallery" },
      [...cells].reverse(),
      style,
      placementCaptions,
    );
    const options = {
      style,
      fonts: await loadFigureFonts(),
      toolkit: await moleculeToolkit(),
      canvas: "scene" as const,
    };
    const distance = async (scene: Scene) => {
      const probe: Mechanism = {
        ...entry,
        frames: [{ id: "measure", title: "Measure", scene }],
      };
      const geometry = await prepareFigure(
        { ...library, [entry.id]: probe },
        { ref: entry.id },
        options,
      );
      const at = (ref: AtomRef) =>
        geometry.atomPoints[`${ref.molecule}:${ref.atom}`];
      return contacts.reduce(
        (sum, [a, b]) => sum + Math.hypot(at(a).x - at(b).x, at(a).y - at(b).y),
        0,
      );
    };
    // Keep the reaction sites close by putting their exposed ends toward one another.
    return (await distance(reverse)) < (await distance(forward)) - 0.1
      ? reverse
      : forward;
  }

  const byKey = new Map(cells.map((cell) => [cell.key, cell])),
    working = { ...library },
    raw = new Map<string, NonNullable<FrameInput["steps"]>[number]>();
  const route: Route = {
    kind: "route",
    id: entry.id,
    title: entry.title,
    sources: entry.sources,
    steps: [],
    edges: [],
    width: 1,
    height: 1,
  };
  const participant = (key: string): Participant => {
    const cell = byKey.get(key);
    if (!cell)
      throw new Error(`frames.${frame.id}.steps: unknown compound ${key}`);
    const molecule = cell.scene.molecules[0];
    if (!molecule)
      throw new Error(`frames.${frame.id}.steps: ${key} requires a structure`);
    return {
      id: key,
      sourceKey: key,
      compound: molecule.compound,
      number: words(cell.spec.label ?? key),
      name: [words(cell.spec.name), words(cell.spec.note)]
        .filter(Boolean)
        .join("\n"),
      ...(cell.spec.yield ? { yield: cell.spec.yield } : {}),
    };
  };
  for (const [i, step] of frame.steps.entries()) {
    const sid = String(step.id ?? i + 1),
      rid = `rxn_${entry.id.slice(4)}_${frame.id}_${sid}`;
    if (raw.has(sid))
      throw new Error(`frames.${frame.id}.steps: duplicate step ${sid}`);
    raw.set(sid, step);
    const reactants = keys(step.from).map(participant),
      products = keys(step.to).map(participant);
    const scene: Scene = {
      width: 1,
      height: 1,
      molecules: [...reactants, ...products].flatMap(
        (p) => byKey.get(p.id)!.scene.molecules,
      ),
    };
    const reaction: Reaction = {
      kind: "reaction",
      id: rid,
      title: entry.title,
      sources: entry.sources,
      reactants,
      products,
      reagents: words(step.above).split("\n").filter(Boolean),
      conditions: words(step.below).split("\n").filter(Boolean),
      scene,
      arrow: {
        from: { x: 0, y: 0 },
        to: { x: 1, y: 0 },
        textWidth: 5,
        kind: step.arrow ?? "forward",
      },
    };
    working[rid] = reaction;
    route.steps.push({ id: sid, reaction: rid, at: { x: 0, y: 0 } });
  }
  await compileRouteLayout(
    working,
    route,
    {
      ...input,
      kind: "route",
      compounds: Object.fromEntries(cells.map(({ key, spec }) => [key, spec])),
      steps: frame.steps,
    },
    raw,
    style,
  );
  const scene: Scene = {
    width: route.width,
    height: route.height,
    molecules: [],
    captions: (route.plusAt ?? []).map((at) => ({ at, text: "+" })),
    reactionArrows: [],
  };
  for (const step of route.steps) {
    for (const [key, at] of Object.entries(step.placements!)) {
      if (
        step.display?.[key] === "hidden" ||
        scene.molecules.some((m) => m.id === key)
      )
        continue;
      const cell = byKey.get(key)!;
      const labeled = await compilePanelScene(
        library,
        entry,
        { ...input, kind: "gallery" },
        [cell],
        style,
        placementCaptions,
      );
      const origin = labeled.molecules[0].at,
        dx = at.x + step.at.x - origin.x,
        dy = at.y + step.at.y - origin.y;
      scene.molecules.push(
        ...labeled.molecules.map((m) => ({
          ...m,
          at: { x: m.at.x + dx, y: m.at.y + dy },
        })),
      );
      scene.captions!.push(
        ...(labeled.captions ?? []).map((c) => ({
          ...c,
          at: { x: c.at.x + dx, y: c.at.y + dy },
        })),
      );
      (scene.arrows ??= []).push(...(labeled.arrows ?? []));
      (scene.labels ??= []).push(...(labeled.labels ?? []));
      (scene.enclose ??= []).push(...(labeled.enclose ?? []));
      (scene.partialBonds ??= []).push(...(labeled.partialBonds ?? []));
      if (labeled.focus) {
        const focus = (scene.focus ??= {});
        if (labeled.focus.primary) {
          const primary = (focus.primary ??= {});
          primary.arrows = [
            ...(primary.arrows ?? []),
            ...(labeled.focus.primary.arrows ?? []),
          ];
          primary.atoms = [
            ...(primary.atoms ?? []),
            ...(labeled.focus.primary.atoms ?? []),
          ];
          primary.bonds = [
            ...(primary.bonds ?? []),
            ...(labeled.focus.primary.bonds ?? []),
          ];
        }
        focus.supporting = [
          ...(focus.supporting ?? []),
          ...(labeled.focus.supporting ?? []),
        ];
      }
    }
    const arrow = step.arrow!;
    const absolute = (p: { x: number; y: number }) => ({
      x: p.x + step.at.x,
      y: p.y + step.at.y,
    });
    scene.reactionArrows!.push({
      id: step.id,
      from: absolute(arrow.from),
      to: absolute(arrow.to),
      kind: arrow.kind,
      above: words(raw.get(step.id)!.above).split("\n").filter(Boolean),
      below: words(raw.get(step.id)!.below).split("\n").filter(Boolean),
    });
  }
  if (scene.molecules.length !== cells.length)
    throw new Error(
      `frames.${frame.id}.steps: every compound must participate`,
    );
  return scene;
}
