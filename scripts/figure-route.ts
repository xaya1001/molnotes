import {
  wrapFigureText,
  figureLabelLines,
} from "../src/ui/library/text-runs.ts";
import { readFile } from "node:fs/promises";
import type {
  Library,
  Point,
  Reaction,
  Route,
} from "../shared/chemical-library/types.ts";
import type { FigureInput, StepInput } from "./figure-input.ts";
import { prepareFigure } from "../src/ui/library/prepare.ts";
import { loadFigureFonts } from "./figure-fonts.ts";
import { moleculeToolkit } from "../shared/molecule-toolkit.ts";
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
const array = <T>(value: T | T[]) => (Array.isArray(value) ? value : [value]);
const keyOf = (value: string | number | { id: string | number }) =>
  String(typeof value === "object" ? value.id : value);
interface Measured {
  measure: RouteMolecule;
  offset: Point;
  referenceOffset: Point;
}

/** Use the same measured spacing for each complete standalone reaction. */
export async function compileReactionLayout(
  library: Library,
  reaction: Reaction,
  stepId: string,
  input: FigureInput,
  raw: StepInput,
  style?: FigureStyle,
) {
  const route: Route = {
    kind: "route",
    id: reaction.id,
    title: reaction.title,
    sources: reaction.sources,
    steps: [{ id: stepId, reaction: reaction.id, at: { x: 0, y: 0 } }],
    edges: [],
    width: 1,
    height: 1,
  };
  await compileRouteLayout(
    library,
    route,
    input,
    new Map([[stepId, raw]]),
    style,
  );
  const step = route.steps[0],
    at = step.at;
  for (const placement of reaction.scene.molecules) {
    const p = step.placements![placement.id];
    placement.at = { x: p.x + at.x, y: p.y + at.y };
  }
  const absolute = (p: Point): Point => ({ x: p.x + at.x, y: p.y + at.y });
  reaction.arrow = {
    ...step.arrow!,
    from: absolute(step.arrow!.from),
    to: absolute(step.arrow!.to),
    ...(step.arrow!.via ? { via: step.arrow!.via.map(absolute) } : {}),
  };
  const inline = reaction.reactants.filter(
    (p) => !p.position || p.position === "inline",
  ).length;
  reaction.plusAt = route.plusAt?.slice(0, Math.max(0, inline - 1));
  reaction.scene.captions = (route.plusAt ?? [])
    .slice(Math.max(0, inline - 1))
    .map((at) => ({ at, text: "+" }));
  reaction.scene.width = route.width;
  reaction.scene.height = route.height;
}

/** The compiler owns position decisions; the renderer only consumes these saved overrides. */
export async function compileRouteLayout(
  library: Library,
  route: Route,
  input: FigureInput,
  rawSteps: Map<string, StepInput>,
  style?: FigureStyle,
) {
  style ??= await loadFigureStyle();
  const fonts = await loadFigureFonts(),
    toolkit = await moleculeToolkit(),
    ctx = createFigureScene(style, fonts),
    bond = ctx.token("--chemical-bond"),
    width = ctx.token("--chemical-route-width"),
    gap = ctx.token("--chemical-route-gap");
  const text = (lines: string[]) => {
    const font =
      lines.length === 1 && lines[0] === "+"
        ? "var(--chemical-plus-font)"
        : "var(--chemical-caption-font)";
    const wrapped = wrapFigureText(lines, width * 0.45, (text) =>
      ctx.textWidth(text, font),
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
  for (const step of route.steps) {
    const reaction = library[step.reaction];
    if (reaction.kind !== "reaction")
      throw new Error(`Missing reaction ${step.reaction}`);
    const raw = rawSteps.get(step.id)!,
      byId = new Map<string, Measured>();
    const geometry = await prepareFigure(
      library,
      { ref: reaction.id },
      { toolkit, fonts, style },
    );
    walkGeometry(geometry.root, (node, matrix) => {
      if (node.kind !== "group" || !node.attributes["data-compound"]) return;
      const id = node.attributes["data-molecule"],
        placement = reaction.scene.molecules.find((m) => m.id === id)!;
      const box = transformBox(node.bounds, matrix)!;
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
      const numberBox = number
        ? transformBox(transformedNodeBox(number), matrix)
        : null;
      const participant = [...reaction.reactants, ...reaction.products].find(
        (p) => p.id === id,
      )!;
      const label = figureLabelLines(participant.number, participant.name);
      const measure: RouteMolecule = {
        width: box.width,
        top: baseline - box.y,
        bottom: box.y + box.height - baseline,
        label,
        text: label,
        structure: true,
      };
      if (numberBox)
        measure.reference = {
          width: numberBox.width,
          top: numberBox.height / 2,
          bottom: numberBox.height / 2,
        };
      byId.set(id, {
        measure,
        offset: {
          x: box.x - placement.at.x * bond,
          y: baseline - placement.at.y * bond,
        },
        referenceOffset: {
          x: (numberBox?.x ?? box.x) - placement.at.x * bond,
          y:
            (numberBox ? numberBox.y + numberBox.height / 2 : baseline) -
            placement.at.y * bond,
        },
      });
    });
    const from = array(raw.from).map((value) => ({
      id: keyOf(value),
      ...(typeof value === "object" && value.show ? { show: value.show } : {}),
    }));
    for (const item of from) {
      const p = reaction.reactants.find((p) => p.sourceKey === item.id),
        m = p ? byId.get(p.id) : undefined;
      if (m) molecules[item.id] ??= m.measure;
      else {
        const spec = input.compounds![item.id],
          label =
            typeof spec === "string"
              ? [item.id]
              : [String(spec.label ?? item.id), String(spec.name ?? "")].filter(
                  Boolean,
                ),
          lines =
            typeof spec === "string"
              ? label
              : [String(spec.text ?? label.join(" · "))];
        molecules[item.id] ??= {
          width: 0,
          top: 0,
          bottom: 0,
          label,
          text: lines,
          structure: !!p,
        };
      }
      const spec = input.compounds![item.id];
      if (typeof spec === "object" && spec.text !== undefined)
        molecules[item.id].text = String(spec.text).split("\n");
    }
    const to = array(raw.to).map((value) => {
      const id = keyOf(value),
        m = byId.get(reaction.products.find((p) => p.sourceKey === id)!.id)!;
      molecules[id] ??= m.measure;
      return { id, measure: m.measure };
    });
    measured.set(step.id, byId);
    layoutSteps.push({
      id: step.id,
      from,
      to,
      above: String(
        reaction.reagentPosition === "below-arrow" ? "" : (raw.above ?? ""),
      )
        .split("\n")
        .filter(Boolean),
      below:
        reaction.reagentPosition === "below-arrow"
          ? [...reaction.reagents, ...reaction.conditions]
          : reaction.conditions,
      others: raw.others,
      turn: raw.turn,
      side: raw.side,
      reverse: raw.reverse,
    });
  }
  const layout = layoutRoute(layoutSteps, molecules, {
    width,
    bond,
    gap,
    serpentine: input.wrap === "serpentine",
    text,
  });
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
      const reaction = library[
        route.steps.find((s) => s.id === item.step)!.reaction
      ] as Reaction;
      const pid =
        reaction.products.find((p) => p.sourceKey === item.key)?.id ??
        reaction.reactants.find((p) => p.sourceKey === item.key)!.id;
      const offset = measured.get(item.step)!.get(pid)!.offset;
      native.set(item.key!, {
        x: item.at.x + margin - offset.x,
        y: item.at.y + margin - offset.y,
      });
    }
  const participantId = (reaction: Reaction, key: string) =>
    reaction.products.find((p) => p.sourceKey === key)?.id ??
    reaction.reactants.find((p) => p.sourceKey === key)!.id;
  for (const step of route.steps) {
    const reaction = library[step.reaction] as Reaction,
      at = origin.get(step.id)!;
    step.at = { x: at.x / bond, y: at.y / bond };
    step.display = {};
    step.placements = {};
    step.boxes = [];
    for (const m of reaction.scene.molecules) {
      const key = [...reaction.reactants, ...reaction.products].find(
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
    for (const item of layout.items.filter((i) => i.step === step.id)) {
      if (item.kind === "molecule" || item.kind === "reference") {
        const pid = participantId(reaction, item.key!),
          offset = measured.get(step.id)!.get(pid)!,
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
          ...(rawSteps.get(step.id)!.side
            ? { side: rawSteps.get(step.id)!.side }
            : {}),
          from: points[0],
          to: points.at(-1)!,
          textWidth: Math.max(1, item.width / bond - 1.2),
          ...(points.length > 2 ? { via: points.slice(1, -1) } : {}),
        };
        for (const box of item.boxes ?? []) {
          const pid = reaction.reactants.find(
            (p) => p.sourceKey === box.key,
          )!.id;
          step.boxes.push(pid);
          const offset = measured
            .get(step.id)!
            .get(
              reaction.reactants.find((p) => p.sourceKey === box.key)!.id,
            )!.offset;
          step.display[pid] = "structure";
          step.placements[pid] = {
            x: (box.at.x + margin - offset.x - at.x) / bond,
            y: (box.at.y + margin - offset.y - at.y) / bond,
          };
        }
      }
    }
  }
  route.plusAt = layout.items
    .filter((i) => i.kind === "plus")
    .map((i) => ({
      x: (i.at.x + i.width / 2 + margin) / bond,
      y: (i.at.y + margin) / bond,
    }));
  route.connections = layout.connections.map((points, i) => ({
    id: `branch-${i + 1}`,
    points: points.map((p) => ({
      x: (p.x + margin) / bond,
      y: (p.y + margin) / bond,
    })),
  }));
  route.width = (layout.width + margin * 2) / bond;
  route.height = (layout.height + margin * 2) / bond;
}
