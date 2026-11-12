import type { FigureObservation } from "../../../shared/chemical-library/geometry.ts";
import { boxEdgeDelta, traceDelta } from "./geometry-observation.ts";
import { parsedPath } from "./path-geometry.ts";

const stable = (value: unknown): string =>
  JSON.stringify(value, (_key, item) =>
    item && typeof item === "object" && !Array.isArray(item)
      ? Object.fromEntries(
          Object.entries(item).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
        )
      : item,
  );

export function compareFigureGeometry(
  before: FigureObservation,
  after: FigureObservation,
) {
  const prior = new Map(
    before.elements.map((element) => [element.key, element]),
  );
  const current = new Map(
    after.elements.map((element) => [element.key, element]),
  );
  const added = [...current.keys()].filter((key) => !prior.has(key));
  const removed = [...prior.keys()].filter((key) => !current.has(key));
  const changed = [];
  for (const [key, b] of current) {
    const a = prior.get(key);
    if (!a) continue;
    const bounds = boxEdgeDelta(a.bounds, b.bounds);
    const path =
      a.path !== undefined && b.path !== undefined
        ? parsedPath(a.path).abs().unshort().toString() !==
          parsedPath(b.path).abs().unshort().toString()
        : a.path !== b.path;
    const trace = a.points && b.points ? traceDelta(a.points, b.points) : 0;
    const paint =
      stable({ ...a.paint, dashArray: a.paint.dashArray ?? "none" }) !==
      stable({ ...b.paint, dashArray: b.paint.dashArray ?? "none" });
    const metadata = stable(a.ids) !== stable(b.ids);
    if (bounds || path || trace === null || trace || paint || metadata)
      changed.push({ key, bounds, trace, path, paint, metadata });
  }
  changed.sort(
    (a, b) =>
      Math.max(b.bounds, b.trace ?? 0) - Math.max(a.bounds, a.trace ?? 0) ||
      a.key.localeCompare(b.key),
  );
  const atomIds = [
    ...new Set([...Object.keys(before.atoms), ...Object.keys(after.atoms)]),
  ];
  const atoms = atomIds
    .flatMap((id) => {
      const a = before.atoms[id],
        b = after.atoms[id];
      const delta = a && b ? Math.hypot(a.x - b.x, a.y - b.y) : null;
      return delta === 0 ? [] : [{ id, delta }];
    })
    .sort((a, b) => (b.delta ?? Infinity) - (a.delta ?? Infinity));
  const diagnosticKey = (value: FigureObservation["diagnostics"][number]) =>
    stable({
      code: value.code,
      severity: value.severity,
      object: value.object,
      elements: value.elements,
    });
  const previousDiagnostics = new Map(
    before.diagnostics.map((d) => [diagnosticKey(d), d]),
  );
  const nextDiagnostics = new Map(
    after.diagnostics.map((d) => [diagnosticKey(d), d]),
  );
  const diagnostics = {
    added: [...nextDiagnostics]
      .filter(([key]) => !previousDiagnostics.has(key))
      .map(([, d]) => d),
    removed: [...previousDiagnostics]
      .filter(([key]) => !nextDiagnostics.has(key))
      .map(([, d]) => d),
    measures: [...nextDiagnostics].flatMap(([key, d]) => {
      const previous = previousDiagnostics.get(key);
      if (
        !previous ||
        (previous.actual === d.actual && previous.required === d.required)
      )
        return [];
      return [
        {
          code: d.code,
          elements: d.elements,
          before: { actual: previous.actual, required: previous.required },
          after: { actual: d.actual, required: d.required },
        },
      ];
    }),
  };
  const canvas = {
    width: after.width - before.width,
    height: after.height - before.height,
    minimumScale: after.minimumScale - before.minimumScale,
  };
  return {
    equal:
      !added.length &&
      !removed.length &&
      !changed.length &&
      !atoms.length &&
      !diagnostics.added.length &&
      !diagnostics.removed.length &&
      !diagnostics.measures.length &&
      !Object.values(canvas).some(Boolean),
    maximumBoundsDelta: Math.max(0, ...changed.map((d) => d.bounds)),
    maximumTraceDelta: Math.max(0, ...changed.map((d) => d.trace ?? 0)),
    canvas,
    added,
    removed,
    changed,
    atoms,
    diagnostics,
  };
}
