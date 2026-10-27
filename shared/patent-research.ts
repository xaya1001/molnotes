import { isFiniteNumber, isList, isObject, type JsonObject } from "./json.ts";
function require(valid: unknown, at: string): asserts valid {
  if (!valid) throw new Error(at);
}
function text(v: unknown, at: string): asserts v is string {
  require(typeof v === "string" && v.trim(), at);
}
const array = (v: unknown, at: string): unknown[] => {
  require(isList(v), at);
  return v;
};
const unique = (items: unknown[], at: string) =>
  require(new Set(items).size === items.length, at);
/** A field of a value not yet checked to be an object, read as JavaScript reads it. */
const field = (v: unknown, name: string): unknown =>
  isObject(v) ? v[name] : undefined;
const statuses: readonly unknown[] = [
  "reported",
  "unreported",
  "not-tested",
  "unresolved",
];
const qualifiers: readonly unknown[] = ["=", "<", "<=", ">", ">=", "range"];
const bases: readonly unknown[] = ["author", "agent", "chemical-pattern"];
const analysisKinds: readonly unknown[] = [
  "observation",
  "design-around-hypothesis",
  "unresolved",
];
const massUnits: readonly unknown[] = ["mg", "g", "kg"];
const massStates: readonly unknown[] = ["crude", "purified"];
const extents: readonly unknown[] = ["complete", "fragment"];

/** A record collection after the patent contract has checked its fields and records. */
export interface CheckedCollection {
  assays: unknown;
  fields: JsonObject[];
  records: JsonObject[];
}

/** What the patent contract has checked before the research data: collections, claim ids and the keyed maps. */
export interface CheckedPatentData {
  collections: ReadonlyMap<string, CheckedCollection>;
  claimIds: readonly unknown[];
  sarCases: JsonObject;
  synthesis: JsonObject;
}

interface CheckedStep {
  id: string;
  reactants: unknown[];
  products: unknown[];
}

/**
 * Publication boundary for research observations, assignments and connected
 * routes; the data is parsed content JSON.
 */
export function validateResearchData(
  data: CheckedPatentData,
  ref: (value: unknown, source?: unknown, at?: string) => void,
  where: string,
): void {
  const { collections, claimIds } = data;
  let at = where;
  function check(
    valid: unknown,
    reason = "invalid research data",
  ): asserts valid {
    require(valid, `${at}: ${reason}`);
  }
  const evidence = (refs: unknown, source?: unknown) => {
    const items = array(refs, at);
    check(items.length > 0);
    for (const r of items) {
      if (source === undefined)
        check(
          typeof field(r, "source") === "string",
          "global evidence requires explicit source",
        );
      ref(r, source, at);
    }
  };
  for (const [collectionId, c] of collections) {
    const assays: JsonObject = Object(c.assays ?? {});
    for (const [id, assay] of Object.entries(assays)) {
      at = `${where}.collections.${collectionId}.assays.${id}`;
      text(id, at);
      require(isObject(assay), at);
      for (const key of ["title", "target", "endpoint", "conditions"])
        text(assay[key], at);
      if (assay.unit === null) text(assay.unitReason, at);
      else text(assay.unit, at);
      evidence(assay.evidence);
    }
    for (const f of c.fields)
      for (const r of c.records) {
        at = `${where}.collections.${collectionId}.records.${r.id}.${f.key}`;
        const v = r[String(f.key)];
        if (f.kind === "measurement") {
          // An absent measurement must be represented explicitly, with its assay.
          check(isObject(v) && Object.hasOwn(assays, String(v.assay)));
          check(statuses.includes(v.status));
          if (v.status === "reported") {
            check(qualifiers.includes(v.qualifier));
            check(isFiniteNumber(v.value));
            if (v.qualifier === "range")
              check(isFiniteNumber(v.upper) && v.upper >= v.value);
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
            require(isObject(a), at);
            for (const key of ["group", "limit"]) text(a[key], at);
            check(bases.includes(a.basis));
            evidence(a.evidence, r.source);
            check(array(a.claims, at).every((id) => claimIds.includes(id)));
            if (a.basis === "chemical-pattern") text(a.pattern, at);
          }
      }
  }
  const compound = (v: unknown) => {
    check(isObject(v));
    check(
      collections.get(String(v.collection))?.records.some((r) => r.id === v.id),
    );
  };
  const nodeKey = (v: unknown) =>
    JSON.stringify([field(v, "collection"), field(v, "id")]);
  for (const cases of Object.values(data.sarCases))
    for (const c of array(cases, at)) {
      check(isObject(c));
      const { analysis } = c;
      if (analysis) {
        check(isObject(analysis) && analysisKinds.includes(analysis.kind));
        text(analysis.rationale, at);
        evidence(analysis.evidence);
      }
    }
  for (const [networkId, network] of Object.entries(data.synthesis)) {
    const networkAt = `${where}.synthesis.${networkId}`;
    at = networkAt;
    require(isObject(network), at);
    text(network.title, at);
    const procedures: JsonObject = Object(network.procedures ?? {});
    for (const [procedureId, p] of Object.entries(procedures)) {
      at = `${networkAt}.procedures.${procedureId}`;
      require(isObject(p), at);
      check(p.yield === undefined, "procedure cannot supply a yield");
      if (p.sourceRecord) compound(p.sourceRecord);
      text(p.reagents, at);
      text(p.conditions, at);
      evidence(p.evidence);
    }
    const procedureEdges = new Map<string, string>();
    for (const r of array(network.references ?? [], at)) {
      const record = field(r, "record");
      at = `${networkAt}.references.${field(record, "collection")}/${field(record, "id")}`;
      check(isObject(r));
      compound(r.record);
      check(Object.hasOwn(procedures, String(r.procedure)));
      const target = field(procedures[String(r.procedure)], "sourceRecord");
      check(target);
      text(r.note, at);
      evidence(r.evidence);
      for (const k of ["reagents", "conditions"])
        if (r[k] !== undefined) text(r[k], `${at}.${k}`);
      if (r.reagents !== undefined || r.conditions !== undefined)
        evidence(r.overrideEvidence);
      const y = r.yield;
      check(isObject(y) && y.status === "unreported" && y.value === undefined);
      text(y.reason, at);
      const k = nodeKey(r.record);
      check(!procedureEdges.has(k));
      procedureEdges.set(k, nodeKey(target));
    }
    for (const start of procedureEdges.keys()) {
      const seen = new Set<string>();
      let current = start;
      let next = procedureEdges.get(current);
      while (next !== undefined) {
        check(!seen.has(current));
        seen.add(current);
        current = next;
        next = procedureEdges.get(current);
      }
    }
    at = networkAt;
    const steps = array(network.steps, at);
    unique(
      steps.map((s) => field(s, "id")),
      at,
    );
    const checkedSteps: CheckedStep[] = [];
    for (const s of steps) {
      at = `${networkAt}.steps.${field(s, "id")}`;
      require(isObject(s), at);
      text(s.id, at);
      for (const k of ["title", "strategy"]) text(s[k], at);
      const side = (name: string) => {
        const items = array(s[name], at);
        check(items.length > 0);
        items.forEach(compound);
        unique(items.map(nodeKey), at);
        return items;
      };
      const step = {
        id: s.id,
        reactants: side("reactants"),
        products: side("products"),
      };
      evidence(s.evidence);
      for (const k of ["reagents", "conditions"])
        if (s[k] !== undefined) text(s[k], `${at}.${k}`);
      if (s.procedure !== undefined) {
        check(
          Object.hasOwn(procedures, String(s.procedure)),
          "unknown procedure",
        );
        // Explicit attribution for example-derived conditions and every override.
        text(s.procedureNote, at);
        if (s.reagents !== undefined || s.conditions !== undefined)
          evidence(s.overrideEvidence);
      } else {
        text(s.reagents, at);
        text(s.conditions, at);
      }
      const product = (v: unknown) => {
        compound(v);
        check(step.products.some((p) => nodeKey(p) === nodeKey(v)));
      };
      const mass = s.isolatedMass;
      if (mass) {
        check(isObject(mass) && isFiniteNumber(mass.value) && mass.value > 0);
        check(massUnits.includes(mass.unit));
        check(massStates.includes(mass.state));
        product(mass.product);
        evidence([mass.ref]);
      }
      if (s.limit !== undefined) text(s.limit, at);
      if (s.owner) compound(s.owner);
      const y = s.yield;
      check(isObject(y));
      if (y.status === "reported") {
        check(
          y.unit === "%" &&
            isFiniteNumber(y.value) &&
            y.value >= 0 &&
            y.value <= 100,
        );
        product(y.product);
        text(y.basis, at);
        evidence([y.ref]);
      } else {
        check(
          y.status === "unreported" &&
            y.value === undefined &&
            y.unit === undefined,
        );
        text(y.reason, at);
      }
      checkedSteps.push(step);
    }
    const stepById = new Map(checkedSteps.map((s) => [s.id, s]));
    at = networkAt;
    const routes = array(network.routes, at);
    check(
      checkedSteps.every((s) =>
        routes.some((r) => array(field(r, "steps"), at).includes(s.id)),
      ),
      "step is not included in any declared route",
    );
    // A network may contain alternative producers. Each declared route selects an unambiguous DAG.
    unique(
      routes.map((r) => field(r, "id")),
      at,
    );
    for (const route of routes) {
      at = `${networkAt}.routes.${field(route, "id")}`;
      require(isObject(route), at);
      text(route.id, at);
      text(route.title, at);
      text(route.scaffold, at);
      evidence(route.evidence);
      check(extents.includes(route.extent));
      text(route.limit, at);
      const starting = array(route.startingMaterials, at);
      starting.forEach(compound);
      unique(starting.map(nodeKey), at);
      const routeSteps = array(route.steps, at);
      check(routeSteps.length > 0);
      unique(routeSteps, at);
      check(routeSteps.every((id) => checkedSteps.some((s) => s.id === id)));
      compound(route.target);
      const selected = routeSteps.flatMap(
        (id) => stepById.get(String(id)) ?? [],
      );
      const producers = new Map<string, CheckedStep>();
      for (const s of selected)
        for (const p of s.products) {
          check(!producers.has(nodeKey(p)));
          producers.set(nodeKey(p), s);
        }
      const inputs = new Set<string>();
      for (const s of selected)
        for (const r of s.reactants)
          if (!producers.has(nodeKey(r))) inputs.add(nodeKey(r));
      check(
        inputs.size === starting.length &&
          starting.every((c) => inputs.has(nodeKey(c))),
      );
      const y = route.reportedYield;
      if (y) {
        check(
          isObject(y) &&
            y.unit === "%" &&
            isFiniteNumber(y.value) &&
            y.value >= 0 &&
            y.value <= 100,
        );
        text(y.basis, at);
        evidence([y.ref]);
        compound(y.product);
        const scope = array(y.scopeStepIds, at);
        check(scope.length > 1);
        unique(scope, at);
        check(scope.every((id) => routeSteps.includes(id)));
        const sequence = scope.flatMap((id) => stepById.get(String(id)) ?? []);
        check(
          sequence[sequence.length - 1].products.some(
            (p) => nodeKey(p) === nodeKey(y.product),
          ),
        );
        for (let i = 1; i < sequence.length; i++)
          check(
            sequence[i].reactants.some((r) =>
              sequence[i - 1].products.some((p) => nodeKey(r) === nodeKey(p)),
            ),
          );
      }
      const target = producers.get(nodeKey(route.target));
      check(target);
      const visiting = new Set<string>(),
        visited = new Set<string>();
      const visit = (s: CheckedStep) => {
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
