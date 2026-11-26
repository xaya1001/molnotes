import { stringify } from "yaml";
import { isObject } from "../../shared/json.ts";
import type { RequestDisplay } from "../../shared/content-preview.ts";
import { validateFigureInput } from "../figure-input.ts";

const words = (value: unknown) =>
  value === undefined || value === null
    ? ""
    : typeof value === "object"
      ? stringify(value).trimEnd()
      : String(value);

export function figureMeta(value: unknown) {
  if (!isObject(value)) return "";
  if (value.kind === "markush") return "通式";
  if (value.kind !== "scheme" || !isObject(value.states)) return "";
  return `化学图 · ${Object.keys(value.states).length} 个状态`;
}
export function figureDisplay(
  value: unknown,
): Pick<RequestDisplay, "meta" | "states"> {
  const { input } = validateFigureInput(value);
  if (input.kind === "markush") return { meta: figureMeta(input) };
  return {
    meta: figureMeta(input),
    states: Object.entries(input.states).map(([id, state]) => ({
      id,
      title: words(state.title) || id,
      smiles: Object.values(state.compounds ?? {})
        .map((compound) =>
          typeof compound === "string"
            ? compound
            : (compound.smiles ?? compound.ref ?? compound.use),
        )
        .filter(Boolean)
        .join(" · "),
      note:
        words(state.text) ||
        (state.arrows?.length
          ? `${state.arrows.length} 个电子箭头`
          : state.partialBonds?.length
            ? `${state.partialBonds.length} 处部分键`
            : undefined),
    })),
  };
}

/** Display authored YAML data without imposing a plotting format on the request. */
export function chartDisplay(
  data: unknown,
  axes: unknown,
  point: unknown,
): NonNullable<RequestDisplay["chart"]> {
  const rows =
    isObject(data) && Array.isArray(data.rows)
      ? data.rows
      : Array.isArray(data)
        ? data
        : [data];
  const headers = isObject(data) ? data.columns : undefined;
  const columns = Array.isArray(headers)
    ? headers.map(words)
    : rows.length && isObject(rows[0])
      ? Object.keys(rows[0])
      : [];
  const cells = rows.map((row) =>
    Array.isArray(row)
      ? row
      : isObject(row)
        ? columns.map((column) => row[column])
        : [row],
  );
  const axisNames: Record<string, string> = { x: "横轴", y: "纵轴" };
  const axisRows = isObject(axes)
    ? Object.entries(axes).map(([key, value]) => ({
        label: axisNames[key] ?? key,
        text: isObject(value)
          ? Object.entries(value)
              .map(([field, item]) =>
                field === "scale" && item === "log"
                  ? "对数刻度"
                  : field === "scale" && item === "linear"
                    ? "线性刻度"
                    : Array.isArray(item)
                      ? item.map(words).join(field === "range" ? " – " : "、")
                      : words(item),
              )
              .filter(Boolean)
              .join(" · ")
          : words(value),
      }))
    : [{ label: "", text: words(axes) }];
  return {
    columns,
    rows: cells.map((row) =>
      row.map((cell) => (typeof cell === "number" ? cell : words(cell))),
    ),
    axes: axisRows,
    point: words(point),
  };
}
