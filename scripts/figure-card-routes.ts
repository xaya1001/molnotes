import type {
  FigureReference,
  Library,
  Participant,
  Reaction,
  Route,
} from "../shared/chemical-library/types.ts";
import type { FigureInput, Show, StepInput } from "./figure-input.ts";
import { compileRouteLayout } from "./figure-route.ts";
import type { FigureStyle } from "../src/ui/library/scene-geometry.ts";

export async function prepareCardRoutes(
  library: Library,
  reference: FigureReference,
  style: FigureStyle,
) {
  const entry = library[reference.ref];
  if (entry.kind !== "route" && entry.kind !== "reaction") return;
  const route: Route =
    entry.kind === "route"
      ? entry
      : {
          ...entry,
          kind: "route",
          steps: [{ id: entry.id, reaction: entry.id, at: { x: 0, y: 0 } }],
          edges: [],
          width: entry.scene.width,
          height: entry.scene.height,
        };
  const input: FigureInput = { compounds: {} };
  const reactions: Library = {};
  const steps = new Map<string, StepInput>();
  const positions: Record<NonNullable<Participant["position"]>, Show> = {
    inline: "plus",
    "above-arrow": "box",
    "below-arrow": "box",
    text: "text",
    none: "none",
  };
  for (const step of route.steps) {
    const reaction = library[step.reaction];
    if (reaction.kind !== "reaction")
      throw new Error(`Missing reaction ${step.reaction}`);
    const reactants = reaction.reactants.map((participant) => {
      const edge = route.edges.find(
        (edge) => edge.to === step.id && edge.reactant === participant.id,
      );
      const other = edge && route.steps.find(({ id }) => id === edge.from);
      const source = other && (library[other.reaction] as Reaction);
      const product =
        source && source.products.find(({ id }) => id === edge?.product);
      return {
        ...participant,
        sourceKey:
          product?.sourceKey ??
          participant.sourceKey ??
          (edge
            ? `${edge.from}/${edge.product}`
            : `${step.id}/${participant.id}`),
      };
    });
    const products = reaction.products.map((participant) => ({
      ...participant,
      sourceKey: participant.sourceKey ?? `${step.id}/${participant.id}`,
    }));
    reactions[reaction.id] = { ...reaction, reactants, products };
    for (const p of [...reactants, ...products])
      input.compounds![p.sourceKey] = {
        label: p.number ?? p.name ?? p.id,
        name: p.name,
      };
    steps.set(step.id, {
      from: reactants
        .filter((p) => p.position !== "text" && p.position !== "none")
        .map((p) => ({
          id: p.sourceKey,
          show: step.boxes?.includes(p.id)
            ? "box"
            : p.position && positions[p.position],
        })),
      to: products.map((p) => p.sourceKey),
      above: (step.reagents ?? reaction.reagents).join("\n"),
      side: step.arrow?.side ?? reaction.arrow.side,
    });
  }
  const numbers =
    entry.kind === "reaction"
      ? Object.fromEntries(
          Object.entries(reference.numbers ?? {}).map(([key, number]) => [
            `${entry.id}/${key}`,
            number,
          ]),
        )
      : reference.numbers;
  return compileRouteLayout(
    { ...library, ...reactions },
    route,
    input,
    steps,
    style,
    { ...reference, numbers },
  );
}
