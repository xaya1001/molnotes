import { depictSeries } from "../figure-depiction.ts";
import { createHash } from "node:crypto";
import { isObject } from "../../shared/json.ts";
import { resolveData } from "../../shared/topic-blocks.ts";
import { moleculeToolkit } from "../../shared/molecule-toolkit.ts";
import {
  graphSignature,
  openMolecule,
  prepareCompound,
} from "../../shared/chemical-library/chemistry.ts";
import {
  validateFigureReference,
  validateFigureInstance,
} from "../../shared/chemical-library/contract.ts";
import type {
  Library,
  FigureReference,
  Compound,
} from "../../shared/chemical-library/types.ts";

/** Resolve table drawings without changing the record values used by queries and CSV. */
export async function compileTableStructures(
  value: unknown,
  library: Library,
  where: string,
) {
  if (!isObject(value)) return;
  const data = isObject(value.data) ? value.data : {};
  const unit = where.replace(/\/content\.json$/, "");
  async function reference(
    input: unknown,
    path: string,
    owner: string,
  ): Promise<FigureReference & { type: "figure-ref" }> {
    if (!isObject(input)) throw new Error(`${path}: expected structure`);
    if ("smiles" in input) {
      if (
        Object.keys(input).some((k) => k !== "smiles") ||
        typeof input.smiles !== "string" ||
        !input.smiles.trim()
      )
        throw new Error(`${path}: expected only a nonempty smiles`);
      const rd = await moleculeToolkit();
      const mol = openMolecule(rd, input.smiles);
      try {
        const graph = graphSignature(rd, mol);
        let compound = Object.values(library).find(
          (e) => e.kind === "compound" && e.graph === graph,
        );
        if (!compound) {
          const id =
            "cmp_" +
            createHash("sha256").update(graph).digest("hex").slice(0, 12);
          compound = prepareCompound(rd, {
            id,
            title: "Compound",
            smiles: input.smiles,
            sources: [
              {
                source: "unknown",
                locator: "Topic table or record",
                note: "Structure supplied by topic content; source details remain with the page.",
              },
            ],
          });
          compound.owner = owner;
          library[id] = compound;
        }
        return { type: "figure-ref", ref: compound.id };
      } finally {
        mol.delete();
      }
    }
    validateFigureReference(input, path);
    if (!input.ref.startsWith("cmp_"))
      throw new Error(`${path}: expected compound reference`);
    validateFigureInstance(library, input);
    return { ...input, type: "figure-ref" };
  }
  const groups: { cases: string; collection: string }[] = [];
  async function visit(input: unknown, path: string): Promise<void> {
    if (Array.isArray(input)) {
      for (const [i, item] of input.entries())
        await visit(item, `${path}[${i}]`);
    } else if (isObject(input)) {
      if (input.type === "sar-cases")
        groups.push({
          cases: String(input.cases),
          collection: String(input.collection),
        });
      if (input.type === "table") {
        const rows = resolveData<unknown>(input.rows, data, `${path}.rows`);
        if (Array.isArray(rows))
          for (const [i, row] of rows.entries())
            if (Array.isArray(row))
              for (const [j, cell] of row.entries())
                if (
                  isObject(cell) &&
                  ("ref" in cell || "smiles" in cell || "figure" in cell)
                )
                  row[j] = {
                    figure: await reference(
                      "figure" in cell ? cell.figure : cell,
                      `${path}.rows[${i}][${j}]`,
                      unit,
                    ),
                  };
        return;
      }
      for (const [key, item] of Object.entries(input))
        await visit(item, `${path}.${key}`);
    }
  }
  await visit(value, where);
  if (isObject(data.collections))
    for (const [key, collection] of Object.entries(data.collections)) {
      if (
        !isObject(collection) ||
        !Array.isArray(collection.fields) ||
        !Array.isArray(collection.records)
      )
        continue;
      const figures: Record<string, Record<string, FigureReference>> = {};
      for (const record of collection.records) {
        if (!isObject(record)) continue;
        for (const field of collection.fields) {
          if (
            !isObject(field) ||
            field.kind !== "smiles" ||
            typeof field.key !== "string" ||
            !record[field.key]
          )
            continue;
          const drawing = await reference(
            { smiles: record[field.key] },
            `${where}.data.collections.${key}/${record.id}.${field.key}`,
            `${unit}/collections/${key}`,
          );
          (figures[String(record.id)] ??= {})[field.key] = drawing;
        }
      }
      collection.structureFigures = figures;
    }

  for (const group of groups) {
    const cases = isObject(data.sarCases)
        ? data.sarCases[group.cases]
        : undefined,
      collection = isObject(data.collections)
        ? data.collections[group.collection]
        : undefined;
    if (
      !Array.isArray(cases) ||
      !isObject(collection) ||
      !isObject(collection.structureFigures)
    )
      continue;
    for (const item of cases) {
      if (!isObject(item) || !Array.isArray(item.ids)) continue;
      const figures: Record<
        string,
        Record<string, FigureReference & { type: "figure-ref" }>
      > = {};
      if (!Array.isArray(collection.fields)) continue;
      for (const field of collection.fields) {
        if (
          !isObject(field) ||
          field.kind !== "smiles" ||
          typeof field.key !== "string"
        )
          continue;
        const members: {
          id: string;
          drawing: FigureReference;
          compound: Compound;
        }[] = [];
        for (const id of item.ids) {
          const drawings = collection.structureFigures[String(id)];
          if (!isObject(drawings)) continue;
          const drawing = drawings[field.key];
          validateFigureReference(drawing, where);
          const compound = library[drawing.ref];
          if (compound.kind !== "compound")
            throw new Error(`${where}: expected compound`);
          members.push({ id: String(id), drawing, compound });
        }
        const variant =
          "series_" +
          createHash("sha256")
            .update(
              `${unit}/${group.collection}/${group.cases}/${item.id}/${field.key}`,
            )
            .digest("hex")
            .slice(0, 12);
        if (
          depictSeries(
            await moleculeToolkit(),
            members.map((m) => ({
              compound: m.compound,
              variant: m.drawing.variant,
            })),
            variant,
          )
        )
          for (const member of members)
            (figures[member.id] ??= {})[field.key] = {
              type: "figure-ref",
              ref: member.compound.id,
              variant,
            };
      }
      if (Object.keys(figures).length) item.structureFigures = figures;
    }
  }
}
