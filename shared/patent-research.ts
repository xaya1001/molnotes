import type { Unchecked } from "./unchecked.ts";
const object = (v: unknown) =>
  v !== null && typeof v === "object" && !Array.isArray(v);
const require = (valid: unknown, at: string) => {
  if (!valid) throw new Error(at);
};
const text = (v: unknown, at: string) =>
  require(typeof v === "string" && v.trim(), at);
const array = (v: Unchecked, at: string): Unchecked[] => {
  require(Array.isArray(v), at);
  return v;
};
const unique = (items: unknown[], at: string) =>
  require(new Set(items).size === items.length, at);
/**
 * Publication boundary for research observations, assignments and connected
 * routes; `data` is parsed content JSON.
 */
export function validateResearchData(
  input: unknown,
  ref: (value: unknown, source?: string, at?: string) => void,
  where: string,
): void {
  const data: Unchecked = input;
  let at = where;
  const check = (valid: unknown, reason = "invalid research data") =>
    require(valid, `${at}: ${reason}`);
  const evidence = (refs: Unchecked, source?: string) => {
    check(array(refs, at).length > 0);
    for (const r of refs) {
      if (source === undefined)
        check(
          typeof r?.source === "string",
          "global evidence requires explicit source",
        );
      ref(r, source, at);
    }
  };
  const claimIds = Object.values<Unchecked>(data.claims ?? {}).flatMap((s) =>
    s.claims.map((c: Unchecked) => c.id),
  );
  for (const [collectionId, c] of Object.entries<Unchecked>(
    data.collections ?? {},
  )) {
    for (const [id, assay] of Object.entries<Unchecked>(c.assays ?? {})) {
      at = `${where}.collections.${collectionId}.assays.${id}`;
      text(id, at);
      for (const key of ["title", "target", "endpoint", "conditions"])
        text(assay[key], at);
      if (assay.unit === null) text(assay.unitReason, at);
      else text(assay.unit, at);
      evidence(assay.evidence);
    }
    for (const f of c.fields)
      for (const r of c.records) {
        at = `${where}.collections.${collectionId}.records.${r.id}.${f.key}`;
        const v = r[f.key];
        if (f.kind === "measurement") {
          // An absent measurement must be represented explicitly, with its assay.
          check(object(v) && Object.hasOwn(c.assays ?? {}, v.assay));
          check(
            ["reported", "unreported", "not-tested", "unresolved"].includes(
              v.status,
            ),
          );
          if (v.status === "reported") {
            check(["=", "<", "<=", ">", ">=", "range"].includes(v.qualifier));
            check(Number.isFinite(v.value));
            if (v.qualifier === "range")
              check(Number.isFinite(v.upper) && v.upper >= v.value);
            else check(v.upper === undefined);
            evidence([v.ref], r.source);
          } else {
            check(
              v.value === undefined &&
                v.upper === undefined &&
                v.qualifier === undefined,
            );
            text(v.reason, at);
            if (v.ref) ref(v.ref, r.source, at);
          }
        }
        if (f.kind === "assignments")
          for (const a of array(v, at)) {
            for (const key of ["group", "limit"]) text(a[key], at);
            check(["author", "agent", "chemical-pattern"].includes(a.basis));
            evidence(a.evidence, r.source);
            check(array(a.claims, at).every((id) => claimIds.includes(id)));
            if (a.basis === "chemical-pattern") text(a.pattern, at);
          }
      }
  }
  const compound = (v: Unchecked) => {
    check(object(v));
    check(
      data.collections?.[v.collection]?.records.some(
        (r: Unchecked) => r.id === v.id,
      ),
    );
  };
  const nodeKey = (v: Unchecked) => JSON.stringify([v.collection, v.id]);
  for (const cases of Object.values<Unchecked>(data.sarCases ?? {}))
    for (const c of cases)
      if (c.analysis) {
        check(
          ["observation", "design-around-hypothesis", "unresolved"].includes(
            c.analysis.kind,
          ),
        );
        text(c.analysis.rationale, at);
        evidence(c.analysis.evidence);
      }
  for (const [networkId, network] of Object.entries<Unchecked>(
    data.synthesis ?? {},
  )) {
    const networkAt = `${where}.synthesis.${networkId}`;
    at = networkAt;
    text(network.title, at);
    const procedures = network.procedures ?? {};
    for (const [procedureId, p] of Object.entries<Unchecked>(procedures)) {
      at = `${networkAt}.procedures.${procedureId}`;
      check(p.yield === undefined, "procedure cannot supply a yield");
      if (p.sourceRecord) compound(p.sourceRecord);
      text(p.reagents, at);
      text(p.conditions, at);
      evidence(p.evidence);
    }
    const procedureEdges = new Map();
    for (const r of network.references ?? []) {
      at = `${networkAt}.references.${r.record?.collection}/${r.record?.id}`;
      compound(r.record);
      check(Object.hasOwn(procedures, r.procedure));
      const target = procedures[r.procedure].sourceRecord;
      check(target);
      text(r.note, at);
      evidence(r.evidence);
      for (const k of ["reagents", "conditions"])
        if (r[k] !== undefined) text(r[k], `${at}.${k}`);
      if (r.reagents !== undefined || r.conditions !== undefined)
        evidence(r.overrideEvidence);
      check(r.yield?.status === "unreported" && r.yield.value === undefined);
      text(r.yield.reason, at);
      const k = nodeKey(r.record);
      check(!procedureEdges.has(k));
      procedureEdges.set(k, nodeKey(target));
    }
    for (const start of procedureEdges.keys()) {
      const seen = new Set();
      let current = start;
      while (procedureEdges.has(current)) {
        check(!seen.has(current));
        seen.add(current);
        current = procedureEdges.get(current);
      }
    }
    at = networkAt;
    const steps = array(network.steps, at);
    unique(
      steps.map((s) => s.id),
      at,
    );
    for (const s of steps) {
      at = `${networkAt}.steps.${s.id}`;
      for (const k of ["id", "title", "strategy"]) text(s[k], at);
      for (const side of ["reactants", "products"]) {
        check(array(s[side], at).length > 0);
        s[side].forEach(compound);
        unique(s[side].map(nodeKey), at);
      }
      evidence(s.evidence);
      for (const k of ["reagents", "conditions"])
        if (s[k] !== undefined) text(s[k], `${at}.${k}`);
      if (s.procedure !== undefined) {
        check(Object.hasOwn(procedures, s.procedure), "unknown procedure");
        // Explicit attribution for example-derived conditions and every override.
        text(s.procedureNote, at);
        if (s.reagents !== undefined || s.conditions !== undefined)
          evidence(s.overrideEvidence);
      } else {
        text(s.reagents, at);
        text(s.conditions, at);
      }
      const product = (v: Unchecked) => {
        compound(v);
        check(s.products.some((p: Unchecked) => nodeKey(p) === nodeKey(v)));
      };
      if (s.isolatedMass) {
        check(
          Number.isFinite(s.isolatedMass.value) && s.isolatedMass.value > 0,
        );
        check(["mg", "g", "kg"].includes(s.isolatedMass.unit));
        check(["crude", "purified"].includes(s.isolatedMass.state));
        product(s.isolatedMass.product);
        evidence([s.isolatedMass.ref]);
      }
      if (s.limit !== undefined) text(s.limit, at);
      if (s.owner) compound(s.owner);
      check(object(s.yield));
      if (s.yield.status === "reported") {
        check(
          s.yield.unit === "%" &&
            Number.isFinite(s.yield.value) &&
            s.yield.value >= 0 &&
            s.yield.value <= 100,
        );
        product(s.yield.product);
        text(s.yield.basis, at);
        evidence([s.yield.ref]);
      } else {
        check(
          s.yield.status === "unreported" &&
            s.yield.value === undefined &&
            s.yield.unit === undefined,
        );
        text(s.yield.reason, at);
      }
    }
    at = networkAt;
    array(network.routes, at);
    check(
      steps.every((s) =>
        network.routes.some((r: Unchecked) =>
          array(r.steps, at).includes(s.id),
        ),
      ),
      "step is not included in any declared route",
    );
    // A network may contain alternative producers. Each declared route selects an unambiguous DAG.
    unique(
      array(network.routes, at).map((r) => r.id),
      at,
    );
    for (const route of network.routes) {
      at = `${networkAt}.routes.${route.id}`;
      text(route.id, at);
      text(route.title, at);
      text(route.scaffold, at);
      evidence(route.evidence);
      check(["complete", "fragment"].includes(route.extent));
      text(route.limit, at);
      array(route.startingMaterials, at).forEach(compound);
      unique(route.startingMaterials.map(nodeKey), at);
      check(array(route.steps, at).length > 0);
      unique(route.steps, at);
      check(
        route.steps.every((id: Unchecked) => steps.some((s) => s.id === id)),
      );
      compound(route.target);
      const selected = route.steps.map((id: Unchecked) =>
        steps.find((s) => s.id === id),
      );
      const producers = new Map();
      for (const s of selected)
        for (const p of s.products) {
          check(!producers.has(nodeKey(p)));
          producers.set(nodeKey(p), s);
        }
      const inputs = new Set();
      for (const s of selected)
        for (const r of s.reactants)
          if (!producers.has(nodeKey(r))) inputs.add(nodeKey(r));
      check(
        inputs.size === route.startingMaterials.length &&
          route.startingMaterials.every((c: Unchecked) =>
            inputs.has(nodeKey(c)),
          ),
      );
      if (route.reportedYield) {
        const y = route.reportedYield;
        check(
          y.unit === "%" &&
            Number.isFinite(y.value) &&
            y.value >= 0 &&
            y.value <= 100,
        );
        text(y.basis, at);
        evidence([y.ref]);
        compound(y.product);
        check(array(y.scopeStepIds, at).length > 1);
        unique(y.scopeStepIds, at);
        check(
          y.scopeStepIds.every((id: Unchecked) => route.steps.includes(id)),
        );
        const sequence = y.scopeStepIds.map((id: Unchecked) =>
          selected.find((s: Unchecked) => s.id === id),
        );
        check(
          sequence
            .at(-1)
            .products.some((p: Unchecked) => nodeKey(p) === nodeKey(y.product)),
        );
        for (let i = 1; i < sequence.length; i++)
          check(
            sequence[i].reactants.some((r: Unchecked) =>
              sequence[i - 1].products.some(
                (p: Unchecked) => nodeKey(r) === nodeKey(p),
              ),
            ),
          );
      }
      const target = producers.get(nodeKey(route.target));
      check(target);
      const visiting = new Set(),
        visited = new Set();
      const visit = (s: Unchecked) => {
        check(!visiting.has(s.id), `cycle at step ${s.id}`);
        if (visited.has(s.id)) return;
        visiting.add(s.id);
        for (const r of s.reactants) {
          const parent = producers.get(nodeKey(r));
          if (parent) visit(parent);
        }
        visiting.delete(s.id);
        visited.add(s.id);
      };
      visit(target);
      check(
        visited.size === selected.length,
        "route has steps unrelated to its target",
      ); // Reject unrelated steps and cyclic branches.
    }
  }
}
