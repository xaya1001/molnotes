import type { Figure } from "./types.ts";

function longestPath(
  id: string,
  arrows: string[],
  dependencies: { from: string; to: string }[],
) {
  const active = new Set<string>();
  const lengths = new Map<string, number>();
  function length(arrow: string): number {
    if (active.has(arrow)) throw new Error(`${id}: route cycle`);
    const known = lengths.get(arrow);
    if (known !== undefined) return known;
    active.add(arrow);
    const n =
      1 +
      Math.max(
        0,
        ...dependencies
          .filter(({ to }) => to === arrow)
          .map(({ from }) => length(from)),
      );
    active.delete(arrow);
    lengths.set(arrow, n);
    return n;
  }
  return { longestLinearSteps: Math.max(0, ...arrows.map(length)) };
}

export function figureRouteMetrics(figure: Figure) {
  const arrows = Object.entries(figure.graph.arrows).filter(
    ([, arrow]) => arrow.role === "reaction",
  );
  const productKey = (state: string, placement?: string) =>
    `${state}/${placement ?? ""}`;
  const producers = new Map(
    arrows.flatMap(([id, arrow]) =>
      arrow.to.map(
        ({ state, placement }) => [productKey(state, placement), id] as const,
      ),
    ),
  );
  const dependencies = arrows.flatMap(([to, arrow]) =>
    arrow.from.flatMap(({ state, placement }) => {
      const from = producers.get(productKey(state, placement));
      return from === undefined ? [] : [{ from, to }];
    }),
  );
  return longestPath(
    figure.id,
    arrows.map(([id]) => id),
    dependencies,
  );
}
