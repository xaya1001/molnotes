import type { CompoundRef, SynthesisNetwork, ResearchRoute } from "./patent.ts";
export const compoundKey = (c: CompoundRef) =>
  JSON.stringify([c.collection, c.id]);
export function routeSteps(network: SynthesisNetwork, route: ResearchRoute) {
  const selected = network.steps.filter((s) => route.steps.includes(s.id));
  const result: typeof selected = [];
  function visit(s: (typeof selected)[number]) {
    if (result.includes(s)) return;
    for (const r of s.reactants) {
      const producer = selected.find((p) =>
        p.products.some((c) => compoundKey(c) === compoundKey(r)),
      );
      if (producer) visit(producer);
    }
    result.push(s);
  }
  selected.forEach(visit);
  return result;
}
export function routeStats(network: SynthesisNetwork, route: ResearchRoute) {
  const steps = routeSteps(network, route),
    depths = new Map<string, number>();
  for (const step of steps) {
    const depth =
      1 +
      Math.max(
        0,
        ...step.reactants.map((r) => depths.get(compoundKey(r)) ?? 0),
      );
    for (const p of step.products) depths.set(compoundKey(p), depth);
  }
  return { total: steps.length, longest: Math.max(0, ...depths.values()) };
}
export function sharedIntermediates(network: SynthesisNetwork) {
  const reactants = network.steps.flatMap((s) => s.reactants);
  return reactants.filter(
    (c, i) =>
      reactants.findIndex((r) => compoundKey(r) === compoundKey(c)) === i &&
      network.steps.filter((s) =>
        s.reactants.some((r) => compoundKey(r) === compoundKey(c)),
      ).length > 1,
  );
}
