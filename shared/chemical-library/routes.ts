import type { Library, Route, Reaction } from "./types.ts";
export function routeMetrics(route: Route, library: Library) {
  const steps = new Map(route.steps.map((s) => [s.id, s]));
  const reaction = (id: string): Reaction => {
    const entry = library[steps.get(id)?.reaction ?? ""];
    if (!entry || entry.kind !== "reaction")
      throw new Error(`${route.id}: missing reaction ${id}`);
    return entry;
  };
  const inputs = new Set<string>();
  for (const e of route.edges) {
    const input = `${e.to}/${e.reactant}`;
    if (inputs.has(input))
      throw new Error(`${route.id}: multiple sources for one reactant`);
    inputs.add(input);
    const a = reaction(e.from).products.find((p) => p.id === e.product),
      b = reaction(e.to).reactants.find((p) => p.id === e.reactant);
    if (!a || !b || a.compound !== b.compound)
      throw new Error(
        `${route.id}: edge participants disagree: ${e.from} -> ${e.to}`,
      );
  }
  const active = new Set<string>(),
    lengths = new Map<string, number>();
  function length(id: string): number {
    if (active.has(id)) throw new Error(`${route.id}: route cycle`);
    if (lengths.has(id)) return lengths.get(id)!;
    active.add(id);
    const n =
      1 +
      Math.max(
        0,
        ...route.edges.filter((e) => e.to === id).map((e) => length(e.from)),
      );
    active.delete(id);
    lengths.set(id, n);
    return n;
  }
  const longest = Math.max(0, ...route.steps.map((s) => length(s.id)));
  return { longestLinearSteps: longest };
}
