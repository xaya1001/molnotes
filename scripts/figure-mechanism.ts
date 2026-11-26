import type { FigureStyle } from "../src/ui/library/scene-geometry.ts";
import type {
  Library,
  Figure,
  FigureGraph,
  GraphArrow,
  GraphParticipant,
  Participant,
  Scene,
  AtomRef,
} from "../shared/chemical-library/types.ts";
import { compilePanelScene, type PanelCell } from "./figure-panels.ts";
import { compileGraphLayout } from "./figure-route.ts";
import { prepareFigure } from "../src/ui/library/prepare.ts";
import { loadFigureFonts } from "./figure-fonts.ts";
import { moleculeToolkit } from "../shared/molecule-toolkit.ts";
import {
  compoundView,
  graphOf,
  openMolecule,
  placedCoordinates,
} from "../shared/chemical-library/chemistry.ts";
import { placeBondContacts } from "./figure-fragments.ts";

const words = (value: string | number | undefined) =>
  value === undefined ? "" : String(value);

/** Frame grids and transformations use the same measured layouts as figure panels and routes. */
export async function compileStateLayout(
  library: Library,
  entry: Figure,
  cells: PanelCell[],
  style: FigureStyle,
  contacts: [AtomRef, AtomRef][],
  partialBonds: [AtomRef, AtomRef][],
  placementCaptions: boolean,
): Promise<Scene> {
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
      const molecule = openMolecule(toolkit, compound.smiles);
      try {
        return {
          placement,
          points,
          bonds: graphOf(molecule).bonds,
          point: ({ atom }: AtomRef) => points[compound.atomIds.indexOf(atom)],
        };
      } finally {
        molecule.delete();
      }
    });
    const [fixed, moving] = drawings.sort(
      (a, b) => b.points.length - a.points.length,
    );
    const anchor = fixed.placement,
      shifted = moving.placement;
    const positioned = placeBondContacts(
      fixed,
      moving,
      bonds.map(([a, b]) =>
        a.molecule === anchor.id
          ? [fixed.point(a), moving.point(b)]
          : [fixed.point(b), moving.point(a)],
      ),
    );
    if (!positioned) throw new Error("No clear placement for partial bonds");
    if (Math.abs(positioned.rotate) > 1e-9)
      shifted.rotate = (shifted.rotate ?? 0) + positioned.rotate;
    return compilePanelScene(
      library,
      entry,
      {},
      cells,
      style,
      placementCaptions,
      { [anchor.id]: { x: 0, y: 0 }, [shifted.id]: positioned.at },
    );
  }
  const forward = await compilePanelScene(
    library,
    entry,
    {},
    cells,
    style,
    placementCaptions,
  );
  if (cells.length !== 2 || !contacts.length) return forward;
  const reverse = await compilePanelScene(
    library,
    entry,
    {},
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
    const geometry = await prepareFigure(
      { ...library, [entry.id]: entry },
      { ref: entry.id },
      { ...options, scene },
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

export async function compileGroupLayout(
  library: Library,
  entry: Figure,
  cells: PanelCell[],
  states: FigureGraph["states"],
  arrows: FigureGraph["arrows"],
  style: FigureStyle,
) {
  const byState = new Map(cells.map((cell) => [cell.key, cell]));
  const participant = (endpoint: GraphParticipant): GraphParticipant => {
    const cell = byState.get(endpoint.state);
    const molecule = cell?.scene.molecules[0];
    if (!cell || !molecule)
      throw new Error(`${endpoint.state}: expected group structure`);
    const appearance: Participant = {
      id: molecule.id,
      sourceKey: endpoint.state + "/" + molecule.id,
      compound: molecule.compound,
      number: words(cell.spec.label ?? molecule.id),
      name: [words(cell.spec.name), words(cell.spec.note)]
        .filter(Boolean)
        .join("\n"),
      ...(cell.spec.yield ? { yield: cell.spec.yield } : {}),
    };
    return { ...endpoint, placement: molecule.id, appearance };
  };
  const graph: FigureGraph = {
    states,
    arrows: Object.fromEntries(
      Object.entries(arrows).map(([id, edge]) => {
        const from = edge.from.map(participant);
        const to = edge.to.map(participant);
        const scene: Scene = {
          width: 1,
          height: 1,
          molecules: [...from, ...to].flatMap(
            ({ state }) => byState.get(state)!.scene.molecules,
          ),
        };
        const drawing: NonNullable<GraphArrow["drawing"]> = {
          scene,
          reagents: edge.above ?? [],
          conditions: edge.below ?? [],
          arrow: {
            from: { x: 0, y: 0 },
            to: { x: 1, y: 0 },
            textWidth: 5,
            kind: edge.kind,
          },
        };
        return [id, { ...edge, from, to, drawing }];
      }),
    ),
  };
  const geometry = await compileGraphLayout(
    library,
    { ...entry, graph },
    style,
  );
  const { route, placements } = geometry;
  const byKey = new Map(
    cells.map((cell) => [cell.scene.molecules[0].id, cell]),
  );
  const scene: Scene = {
    width: route.width,
    height: route.height,
    molecules: [],
    captions: (route.plusAt ?? []).map((at) => ({ at, text: "+" })),
    reactionArrows: [],
  };
  for (const [id, step] of Object.entries(placements)) {
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
        {},
        [cell],
        style,
        false,
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
      id,
      from: absolute(arrow.from),
      to: absolute(arrow.to),
      kind: arrow.kind,
      above: arrows[id].above,
      below: arrows[id].below,
    });
  }
  if (scene.molecules.length !== cells.length)
    throw new Error("Every group placement must participate in its arrows");
  return scene;
}
