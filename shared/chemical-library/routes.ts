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
  const path = route.yieldPath;
  if (new Set(path).size !== path.length)
    throw new Error(`${route.id}: repeated yield path step`);
  for (let i = 1; i < path.length; i++)
    if (!route.edges.some((e) => e.from === path[i - 1] && e.to === path[i]))
      throw new Error(`${route.id}: disconnected yield path`);
  const groups = route.combinedYields ?? [];
  const covered = new Set<string>();
  for (const g of groups) {
    if (!g.steps.length) throw new Error(`${route.id}: empty yield group`);
    const start = path.indexOf(g.steps[0]);
    if (
      start < 0 ||
      g.steps.some((id, i) => path[start + i] !== id || covered.has(id))
    )
      throw new Error(`${route.id}: invalid combined yield path`);
    g.steps.forEach((id) => covered.add(id));
  }
  let total: number | null = path.length ? 1 : null;
  const factors: { steps: string[]; value: number | null }[] = [];
  for (let i = 0; i < path.length; i++) {
    const id = path[i];
    const group = groups.find((g) => g.steps[0] === id);
    if (covered.has(id) && !group) continue;
    const products = reaction(id).products;
    const edge = route.edges.find((e) => e.from === id && e.to === path[i + 1]);
    const product = edge
      ? products.find((p) => p.id === edge.product)
      : products.length === 1
        ? products[0]
        : undefined;
    const value = group?.value ?? product?.yield ?? null;
    factors.push({ steps: group?.steps ?? [id], value });
    total = total === null || value === null ? null : total * value;
  }
  return { longestLinearSteps: longest, totalYield: total, path, factors };
}
