import { isObject } from "../../shared/json.ts";
import {
  validateFigureReference,
  validateFigureInstance,
} from "../../shared/chemical-library/contract.ts";
import { withCoordinates } from "../../shared/molecule-layout.ts";
import type {
  Library,
  FigureReference,
} from "../../shared/chemical-library/types.ts";

/** Compile authored structure references to the existing molecule-control contract. */
export function resolveCompoundSlots(
  value: unknown,
  library: Library,
  where: string,
) {
  const references: FigureReference[] = [];
  function visit(value: unknown, path: string): unknown {
    if (Array.isArray(value))
      return value.map((v, i) => visit(v, `${path}[${i}]`));
    if (!isObject(value) || value.type === "figure-ref") return value;
    if (typeof value.ref === "string" && value.ref.startsWith("cmp_")) {
      const { ref, variant, ...local } = value;
      const reference = { ref, ...(variant !== undefined ? { variant } : {}) };
      validateFigureReference(reference, path);
      validateFigureInstance(library, reference);
      const c = library[reference.ref];
      if (c?.kind !== "compound")
        throw new Error(`${path}: unknown compound ${reference.ref}`);
      if ("smiles" in local || "abbreviations" in local)
        throw new Error(
          `${path}: compound references cannot override smiles or abbreviations`,
        );
      const layout = reference.variant
        ? c.variants![reference.variant]
        : c.layout;
      references.push(reference);
      return {
        name: c.title,
        ...Object.fromEntries(
          Object.entries(local).map(([k, v]) => [k, visit(v, `${path}.${k}`)]),
        ),
        smiles:
          layout.inputSmiles ??
          withCoordinates(
            c.smiles.replace(/:\d+(?=\])/g, ""),
            c.atomIds.map((id) => {
              const p = layout.pins?.[id] ?? layout.coords[id];
              return [p.x * 1.5, -p.y * 1.5];
            }),
          ),
        ...(layout.abbreviations
          ? { abbreviations: layout.abbreviations }
          : {}),
      };
    }
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [
        k,
        k === "figure" ? v : visit(v, `${path}.${k}`),
      ]),
    );
  }
  return { value: visit(value, where), references };
}
