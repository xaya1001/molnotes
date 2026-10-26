import { measurementWithin } from "./patent-measurements.ts";
import type { Measurement, Assignment } from "./patent.ts";
import {
  gradeText,
  type RecordCollection,
  type CollectionRecord,
} from "./patent.ts";
export type FilterQuery = Record<string, unknown>;
export function queryText(q: FilterQuery, key: string) {
  return typeof q[key] === "string" ? q[key] : "";
}
export function filterRecords(
  collection: RecordCollection,
  q: FilterQuery,
  matches?: Set<string>,
) {
  const needle = queryText(q, "q").trim().toLowerCase();
  const ids = queryText(q, "ids");
  const numeric = /^\d+(?:\s*[,，–-]\s*\d+)*$/.test(needle);
  const selected = numeric
    ? needle.split(/[,，]/).flatMap((part) => {
        const [a, b] = part.split(/[–-]/).map(Number);
        return collection.records
          .filter(
            (r) => typeof r.id === "number" && r.id >= a && r.id <= (b ?? a),
          )
          .map((r) => String(r.id));
      })
    : null;
  const result = collection.records.filter((r) => {
    if (ids && !ids.split(",").includes(String(r.id))) return false;
    if (
      needle &&
      (selected
        ? !selected.includes(String(r.id))
        : ![
            r.id,
            ...collection.fields
              .filter((f) => ["text", "tags"].includes(f.kind))
              .map((f) => r[f.key]),
          ]
            .join(" ")
            .toLowerCase()
            .includes(needle))
    )
      return false;
    if (q.source && r.source !== q.source) return false;
    if (matches && !matches.has(String(r.id))) return false;
    for (const f of collection.fields.filter((f) => f.filter)) {
      const wanted = queryText(q, f.key),
        value = r[f.key];
      if (f.kind === "measurement") {
        const m = value as Measurement;
        const assay = queryText(q, `${f.key}.assay`),
          status = queryText(q, `${f.key}.status`);
        const min = queryText(q, `${f.key}.min`),
          max = queryText(q, `${f.key}.max`);
        if (assay && m.assay !== assay) return false;
        if (
          status &&
          (status === "exact"
            ? m.status !== "reported" || m.qualifier !== "="
            : m.status !== status)
        )
          return false;
        if (
          (min || max) &&
          (!assay ||
            !collection.assays![assay]?.unit ||
            !measurementWithin(m, min, max))
        )
          return false;
      } else if (f.kind === "assignments") {
        if (wanted && !(value as Assignment[]).some((a) => a.group === wanted))
          return false;
      } else if (f.kind === "number") {
        for (const bound of ["min", "max"]) {
          const input = queryText(q, `${f.key}.${bound}`);
          if (
            input &&
            (typeof value !== "number" ||
              (bound === "min" ? value < Number(input) : value > Number(input)))
          )
            return false;
        }
      } else if (wanted) {
        if (f.kind === "grade") {
          const missing = value === undefined || value === "" || value === "--";
          if (
            wanted === "reported"
              ? missing
              : wanted === "missing"
                ? !missing
                : wanted === "unlisted"
                  ? value !== undefined
                  : wanted === "blank"
                    ? value !== ""
                    : wanted === "dash"
                      ? value !== "--"
                      : value !== wanted
          )
            return false;
        } else if (
          f.kind === "tags"
            ? !Array.isArray(value) || !value.includes(wanted)
            : !String(value ?? "")
                .toLowerCase()
                .includes(wanted.toLowerCase())
        )
          return false;
      }
    }
    return true;
  });
  const field = collection.fields.find((f) => f.key === q.sort && f.sort);
  const direction = q.order === "desc" ? -1 : 1;
  return result.sort((a, b) => {
    const x = field ? a[field.key] : a.id,
      y = field ? b[field.key] : b.id;
    if (field?.kind === "measurement") {
      const assay = queryText(q, `${field.key}.assay`);
      const exact = (v: unknown) => {
        const m = v as Measurement;
        return assay &&
          collection.assays![assay]?.unit &&
          m.assay === assay &&
          m.status === "reported" &&
          m.qualifier === "="
          ? m.value
          : undefined;
      };
      const nx = exact(x),
        ny = exact(y);
      return nx !== undefined && ny !== undefined
        ? (nx - ny) * direction
        : Number(nx === undefined) - Number(ny === undefined) ||
            String(a.id).localeCompare(String(b.id), undefined, {
              numeric: true,
            });
    }
    if (field?.kind === "grade") {
      const bins = collection.scales[field.scale!].bins;
      const rank = (v: unknown) => bins.findIndex((bin) => bin.value === v);
      const rx = rank(x),
        ry = rank(y);
      if (rx < 0 || ry < 0)
        return (
          Number(rx < 0) - Number(ry < 0) ||
          String(a.id).localeCompare(String(b.id), undefined, { numeric: true })
        );
      return (rx - ry) * direction;
    }
    if (x === undefined || y === undefined)
      return Number(x === undefined) - Number(y === undefined);
    return (
      (typeof x === "number" && typeof y === "number"
        ? x - y
        : String(x).localeCompare(String(y), undefined, { numeric: true })) *
      direction
    );
  });
}
export function recordsCsv(
  collection: RecordCollection,
  rows: CollectionRecord[],
) {
  const fields = collection.fields.filter((f) => f.kind !== "body");
  const cell = (v: unknown) =>
    '"' + String(v ?? "").replaceAll('"', '""') + '"';
  return [
    ["id", "source", ...fields.map((f) => f.key)],
    ...rows.map((r) => [
      r.id,
      r.source,
      ...fields.map((f) =>
        f.kind === "measurement"
          ? JSON.stringify({
              ...(r[f.key] as Measurement),
              assayDefinition:
                collection.assays![(r[f.key] as Measurement).assay],
            })
          : f.kind === "grade" && r[f.key] === undefined
            ? "未列"
            : typeof r[f.key] === "object"
              ? JSON.stringify(r[f.key])
              : r[f.key],
      ),
    ]),
  ]
    .map((row) => row.map(cell).join(","))
    .join("\r\n");
}
export { gradeText };
