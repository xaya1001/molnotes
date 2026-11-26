import {
  appearances,
  drawnArrows,
} from "../shared/chemical-library/figure-layout.ts";
import {
  wrapFigureText,
  figureLabelLines,
} from "../src/ui/library/text-runs.ts";
import { readFile } from "node:fs/promises";
import type {
  Figure,
  GraphArrow,
  GraphParticipant,
  Library,
  FigureReference,
  Point,
} from "../shared/chemical-library/types.ts";
import {
  chemicalCardLayout,
  cardConditionFont,
  chemicalCardWidths,
  cardInset,
  phoneCardWidth,
} from "../src/ui/library/card-layout.ts";
import { prepareFigure, prepareVia } from "../src/ui/library/prepare.ts";
import { arrowViaPanels } from "../src/ui/library/figure-via.ts";
import { loadFigureFonts } from "./figure-fonts.ts";
import { moleculeToolkit } from "../shared/molecule-toolkit.ts";
import { finishFigureEntry } from "./figure-output.ts";
import type { FigureBox } from "../shared/chemical-library/geometry.ts";
import {
  createFigureScene,
  parseFigureStyle,
  type FigureStyle,
} from "../src/ui/library/scene-geometry.ts";
import { walkGeometry } from "../src/ui/library/geometry-walk.ts";
import { transformedNodeBox } from "../src/ui/library/geometry-tree.ts";
import { transformBox, unionBoxes } from "../src/ui/library/geometry-math.ts";
import {
  layoutRoute,
  type RouteMolecule,
  type RouteLayoutStep,
} from "../src/ui/library/route-layout.ts";

export const loadFigureStyle = () =>
  readFile(
    new URL("../src/ui/styles/tokens.css", import.meta.url),
    "utf8",
  ).then(parseFigureStyle);
interface Measured {
  measure: RouteMolecule;
  offset: Point;
  referenceOffset: Point;
}
const participantKey = (participant: GraphParticipant) =>
  participant.appearance?.sourceKey ??
  (participant.placement
    ? participant.state + "/" + participant.placement
    : participant.state);

const positions = {
  inline: "plus",
  "above-arrow": "box",
  "below-arrow": "box",
  text: "text",
  none: "none",
} as const;

export async function compileArrowLayout(
  library: Library,
  figure: Figure,
  id: string,
  style?: FigureStyle,
) {
  const placements = await compileGraphLayout(library, figure, style, {
    arrow: id,
  });
  const route = placements.route;
  const step = placements.placements[id];
  const edge = figure.graph.arrows[id];
  const drawing = edge.drawing!;
  const translate = (point: Point) => ({
    x: point.x + step.at.x,
    y: point.y + step.at.y,
  });
  for (const molecule of drawing.scene.molecules) {
    const point = step.placements![molecule.id];
    molecule.at = translate(point);
  }
  const path = step.arrow!;
  drawing.arrow = {
    ...path,
    from: translate(path.from),
    to: translate(path.to),
    points: path.points?.map(translate),
  };
  const inline = appearances(edge.from).filter(
    ({ position }) => !position || position === "inline",
  ).length;
  const plus = route.plusAt ?? [];
  drawing.plusAt = plus.slice(0, Math.max(0, inline - 1));
  drawing.scene.captions = plus
    .slice(Math.max(0, inline - 1))
    .map((at) => ({ at, text: "+" }));
  drawing.scene.width = route.width;
  drawing.scene.height = route.height;
}
type GraphPositions = ReturnType<typeof placeGraphArrows>;
type CardGraph = {
  graph: Figure["graph"];
  width: number;
  scale: number;
  rows: number;
};

export function compileGraphLayout(
  entries: Library,
  figure: Figure,
  style?: FigureStyle,
  scope?: { arrow?: string },
): Promise<GraphPositions>;
export function compileGraphLayout(
  entries: Library,
  figure: Figure,
  style: FigureStyle,
  scope: { card: FigureReference },
): Promise<CardGraph[]>;
export async function compileGraphLayout(
  entries: Library,
  figure: Figure,
  style?: FigureStyle,
  scope: { arrow?: string; card?: FigureReference } = {},
) {
  const { arrow: only, card } = scope;
  const graph = figure.graph;
  const library = { ...entries, [figure.id]: figure };
  const edges = drawnArrows(graph).filter(([id]) => !only || id === only);
  const standalone = edges.length === 1 && !graph.layout?.route;
  style ??= await loadFigureStyle();
  const fonts = await loadFigureFonts(),
    toolkit = await moleculeToolkit(),
    ctx = createFigureScene(style, fonts),
    bond = ctx.token("--chemical-bond"),
    width = ctx.token("--chemical-route-width"),
    gap = ctx.token("--chemical-route-gap");
  const text = (lines: string[], scale?: number, available?: number) => {
    const font =
      lines.length === 1 && lines[0] === "+"
        ? "var(--chemical-plus-font)"
        : scale
          ? cardConditionFont(scale)
          : "var(--chemical-caption-font)";
    const wrapped = wrapFigureText(
      lines,
      scale ? Math.min(152 / scale, available ?? Infinity) : width * 0.45,
      (text) => ctx.textWidth(text, font),
      { breakHan: available !== undefined },
    );
    const nodes = wrapped.map((line) => ctx.label({ x: 0, y: 0 }, line, font));
    return {
      lines: wrapped,
      width: Math.max(0, ...nodes.map((n) => n.advance)),
      height: nodes.reduce(
        (sum, n) => sum + (n.bounds?.height ?? 0) + bond * 0.15,
        0,
      ),
    };
  };
  const measured = new Map<string, Map<string, Measured>>(),
    molecules: Record<string, RouteMolecule> = {},
    layoutSteps: RouteLayoutStep[] = [];
  for (const [id, edge] of edges) {
    const reaction = edge.drawing;
    const reactants = appearances(edge.from);
    const products = appearances(edge.to);
    const byId = new Map<string, Measured>();
    // Measure saved precision; reserve a number row for later page references.
    for (const p of [...reactants, ...products])
      finishFigureEntry(library[p.compound]);
    const numbers =
      card?.numbers &&
      Object.fromEntries(
        Object.entries(card.numbers)
          .filter(([key]) => key.startsWith(id + "/"))
          .map(([key, number]) => [key.slice(id.length + 1), number]),
      );
    const reserved = await prepareFigure(
      library,
      {
        ref: figure.id,
        numbers: Object.fromEntries(
          [...reactants, ...products].map((p) => [
            p.id,
            numbers?.[p.id] ?? "888",
          ]),
        ),
      },
      { toolkit, fonts, style, canvas: "scene", arrow: id },
    );
    const reservations = new Map<
      string,
      { box: FigureBox; number: FigureBox }
    >();
    walkGeometry(reserved.root, (node, matrix) => {
      if (node.kind !== "group" || !node.attributes["data-compound"]) return;
      const id = node.attributes["data-molecule"],
        number = node.children.find(
          (n) => n.attributes["data-number"] === `${id}:number`,
        )!;
      reservations.set(id, {
        box: transformBox(node.bounds, matrix)!,
        number: transformBox(transformedNodeBox(number), matrix)!,
      });
    });
    const geometry = await prepareFigure(
      library,
      { ref: figure.id, numbers },
      {
        toolkit,
        fonts,
        style,
        canvas: "scene",
        arrow: id,
      },
    );
    walkGeometry(geometry.root, (node, matrix) => {
      if (node.kind !== "group" || !node.attributes["data-compound"]) return;
      const id = node.attributes["data-molecule"],
        placement = reaction.scene.molecules.find((m) => m.id === id)!;
      const reservation = reservations.get(id)!,
        box = unionBoxes([transformBox(node.bounds, matrix), reservation.box])!;
      const number = node.children.find(
        (n) => n.attributes["data-number"] === `${id}:number`,
      );
      const body = unionBoxes(
        node.children
          .filter(
            (n) =>
              n !== number &&
              n.attributes["data-quantity"] !== `${id}:quantity`,
          )
          .map((n) => transformedNodeBox(n)),
      );
      const ink = transformBox(body, matrix)!,
        baseline = ink.y + ink.height / 2;
      const numberBox = unionBoxes([
        number ? transformBox(transformedNodeBox(number), matrix) : null,
        reservation.number,
      ])!;
      const participant = [...reactants, ...products].find((p) => p.id === id)!;
      const label = figureLabelLines(participant.number, participant.name);
      const measure: RouteMolecule = {
        width: box.width,
        top: baseline - box.y,
        bottom: box.y + box.height - baseline,
        label,
        text: label,
        structure: true,
        reference: {
          width: numberBox.width,
          top: numberBox.height / 2,
          bottom: numberBox.height / 2,
        },
      };
      byId.set(id, {
        measure,
        offset: {
          x: box.x - placement.at.x * bond,
          y: baseline - placement.at.y * bond,
        },
        referenceOffset: {
          x: numberBox.x - placement.at.x * bond,
          y: numberBox.y + numberBox.height / 2 - placement.at.y * bond,
        },
      });
    });
    const from = edge.from.flatMap((endpoint) => {
      const p = endpoint.appearance;
      if (card && (p?.position === "text" || p?.position === "none" || !p))
        return [];
      const position = p?.position;
      const show =
        card && p
          ? edge.placement?.boxes?.includes(p.id)
            ? "box"
            : position && positions[position]
          : endpoint.show;
      const key = participantKey(endpoint);
      const m = p && byId.get(p.id);
      const state = graph.states[endpoint.state];
      if (m) molecules[key] ??= m.measure;
      else {
        const label = [p?.number, p?.name].filter((v): v is string =>
          Boolean(v),
        );
        molecules[key] ??= {
          width: 0,
          top: 0,
          bottom: 0,
          label,
          text: state.text ? state.text.split("\n") : [label.join(" · ")],
          structure: Boolean(p),
        };
      }
      if (state.text !== undefined)
        molecules[key].text = state.text.split("\n");
      return [{ id: key, show }];
    });
    const to = edge.to.map((endpoint) => {
      const id = participantKey(endpoint);
      const measure = byId.get(endpoint.appearance!.id)!.measure;
      molecules[id] ??= measure;
      return { id, measure };
    });
    measured.set(id, byId);
    let mechanism: RouteLayoutStep["mechanism"];
    const { start, middle } = arrowViaPanels(edge, reaction.scene);
    if (edge.via) {
      const prefix = card && !standalone ? id + "/" : "";
      const reference = {
        ref: figure.id,
        numbers: prefix ? card?.numbers : numbers,
        focus: card?.focus,
      };
      const options = { toolkit, fonts, style };
      const heading = edge.title !== figure.title ? edge.title : undefined;
      const horizontal = await prepareVia(
        library,
        edge,
        reference,
        options,
        "right",
        prefix,
        heading,
      );
      const vertical = await prepareVia(
        library,
        edge,
        reference,
        options,
        "down",
        prefix,
        heading,
      );
      const tail = Object.values(edge.via.arrows).find((edge) =>
        edge.from.some(({ state }) => state === middle.at(-1)?.id),
      );
      mechanism = {
        horizontal: {
          width: horizontal?.width ?? 0,
          height: horizontal?.height ?? 0,
        },
        vertical: {
          width: vertical?.width ?? 0,
          height: vertical?.height ?? 0,
        },
        tail: [...(tail?.above ?? []), ...(tail?.below ?? [])],
      };
    }
    const above = card
      ? edge.via
        ? reaction.reagents
        : (edge.placement?.reagents ?? reaction.reagents)
      : (edge.above ?? []);
    const turn = card ? undefined : edge.settings?.turn;
    layoutSteps.push({
      mechanism,
      id,
      from,
      to,
      above: [
        ...(reaction.reagentPosition === "below-arrow" ? [] : above),
        ...(start?.outgoing?.[1].above ?? []),
      ],
      below: [
        ...(reaction.reagentPosition === "below-arrow"
          ? reaction.reagents
          : []),
        ...reaction.conditions,
        ...(start?.outgoing?.[1].below ?? []),
      ],
      others: card ? undefined : edge.settings?.others,
      turn: edge.via && turn === "wrap" ? "down" : turn,
      side: card
        ? (edge.placement?.arrow?.side ?? reaction.arrow.side)
        : edge.settings?.side,
      reverse: card ? undefined : edge.settings?.reverse,
    });
  }
  if (card)
    return chemicalCardWidths.map((width) => {
      const { scale, layout } = chemicalCardLayout(
        layoutSteps,
        molecules,
        width,
        bond,
        text,
        width === phoneCardWidth && layoutSteps.some((step) => step.mechanism)
          ? width - cardInset(true)
          : undefined,
      );
      const variant = structuredClone(graph);
      const geometry = placeGraphArrows(edges, layout, measured, bond, scale);
      variant.layout = { ...variant.layout, route: geometry.route };
      for (const [id, placement] of Object.entries(geometry.placements))
        variant.arrows[id].placement = placement;
      return { graph: variant, width, scale, rows: layout.rows };
    });
  const layout = layoutRoute(layoutSteps, molecules, {
    width,
    bond,
    gap,
    serpentine: graph.layout?.wrap === "serpentine",
    text,
  });
  const geometry = placeGraphArrows(edges, layout, measured, bond);
  if (!only) {
    graph.layout = { ...graph.layout, route: geometry.route };
    for (const [id, placement] of Object.entries(geometry.placements))
      graph.arrows[id].placement = placement;
  }
  return geometry;
}

function placeGraphArrows(
  edges: ReturnType<typeof drawnArrows>,
  layout: ReturnType<typeof layoutRoute>,
  measured: Map<string, Map<string, Measured>>,
  bond: number,
  scale?: number,
) {
  const margin = bond * 1.5,
    origin = new Map<string, Point>();
  for (const item of layout.items)
    if (item.kind === "arrow")
      origin.set(item.step, {
        x: item.points![0].x + margin,
        y: item.points![0].y + margin,
      });
  const native = new Map<string, Point>();
  for (const item of layout.items)
    if (item.kind === "molecule") {
      const edge = edges.find(([id]) => id === item.step)![1];
      const pid = participantId(edge, item.key!);
      const offset = measured.get(item.step)!.get(pid)!.offset;
      native.set(item.key!, {
        x: item.at.x + margin - offset.x,
        y: item.at.y + margin - offset.y,
      });
    }
  function participantId(edge: GraphArrow, key: string) {
    return [...appearances(edge.to), ...appearances(edge.from)].find(
      (part) => part.sourceKey === key,
    )!.id;
  }
  const placements: Record<string, NonNullable<GraphArrow["placement"]>> = {};
  for (const [id, edge] of edges) {
    const reaction = edge.drawing;
    const reactants = appearances(edge.from);
    const products = appearances(edge.to);
    const at = origin.get(id)!;
    const step = {
      at: { x: at.x / bond, y: at.y / bond },
      display: {} as NonNullable<GraphArrow["placement"]>["display"] & {},
      placements: {} as Record<string, Point>,
      boxes: [] as string[],
      reagents: undefined as string[] | undefined,
      conditions: undefined as string[] | undefined,
      arrow: undefined as NonNullable<GraphArrow["placement"]>["arrow"],
    };
    placements[id] = step;
    for (const m of reaction.scene.molecules) {
      const key = [...reactants, ...products].find(
          (p) => p.id === m.id,
        )!.sourceKey!,
        point = native.get(key);
      step.display[m.id] = "hidden";
      if (point)
        step.placements[m.id] = {
          x: (point.x - at.x) / bond,
          y: (point.y - at.y) / bond,
        };
    }
    for (const item of layout.items.filter((i) => i.step === id)) {
      if (item.kind === "molecule" || item.kind === "reference") {
        const pid = participantId(edge, item.key!),
          offset = measured.get(id)!.get(pid)!,
          o =
            item.kind === "reference" ? offset.referenceOffset : offset.offset;
        step.display[pid] =
          item.kind === "reference" ? "reference" : "structure";
        step.placements[pid] = {
          x: (item.at.x + margin - o.x - at.x) / bond,
          y: (item.at.y + margin - o.y - at.y) / bond,
        };
      } else if (item.kind === "arrow") {
        step.reagents = item.above ?? [];
        step.conditions = item.below ?? [];
        const points = item.points!.map((p) => ({
          x: (p.x + margin - at.x) / bond,
          y: (p.y + margin - at.y) / bond,
        }));
        step.arrow = {
          ...reaction.arrow,
          side: item.side ?? edge.settings?.side ?? reaction.arrow.side,
          from: points[0],
          to: points.at(-1)!,
          textWidth: scale
            ? 152 / scale / bond
            : Math.max(1, item.width / bond - 1.2),
          points: points.length > 2 ? points.slice(1, -1) : undefined,
        };
        for (const box of item.boxes ?? []) {
          const pid = reactants.find((p) => p.sourceKey === box.key)!.id;
          step.boxes.push(pid);
          const offset = measured
            .get(id)!
            .get(reactants.find((p) => p.sourceKey === box.key)!.id)!.offset;
          step.display[pid] = "structure";
          step.placements[pid] = {
            x: (box.at.x + margin - offset.x - at.x) / bond,
            y: (box.at.y + margin - offset.y - at.y) / bond,
          };
        }
      }
    }
  }
  const plusAt = layout.items
    .filter((i) => i.kind === "plus")
    .map((i) => ({
      x: (i.at.x + i.width / 2 + margin) / bond,
      y: (i.at.y + margin) / bond,
    }));
  const connections = layout.connections.map((points, i) => ({
    id: `branch-${i + 1}`,
    points: points.map((p) => ({
      x: (p.x + margin) / bond,
      y: (p.y + margin) / bond,
    })),
  }));
  return {
    placements,
    route: {
      plusAt,
      connections,
      width: (layout.width + margin * 2) / bond,
      height: (layout.height + margin * 2) / bond,
    },
  };
}
