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

const figureNames: Record<string, string> = {
  route: "路线",
  mechanism: "机理",
  gallery: "结构",
  scope: "底物范围",
  cycle: "催化循环",
  markush: "通式",
};
export function figureMeta(value: unknown) {
  if (!isObject(value)) return "";
  const kind = typeof value.kind === "string" ? value.kind : "route";
  return figureNames[kind]
    ? `${figureNames[kind]}${Array.isArray(value.frames) ? ` · ${value.frames.length} 帧` : ""}`
    : "";
}
export function figureDisplay(
  value: unknown,
): Pick<RequestDisplay, "meta" | "frames"> {
  const { input } = validateFigureInput(value);
  const frames = input.frames?.map((frame, i) => ({
    title: words(frame.title) || `帧 ${i + 1}`,
    smiles:
      frame.smiles ??
      Object.values(frame.compounds ?? {})
        .flatMap((compound) =>
          typeof compound === "string"
            ? [compound]
            : compound.smiles
              ? [compound.smiles]
              : [],
        )
        .join(" · "),
    ...(frame.arrows?.length
      ? { note: `${frame.arrows.length} 个电子箭头` }
      : frame.partialBonds?.length
        ? { note: `${frame.partialBonds.length} 处部分键` }
        : {}),
  }));
  return {
    meta: figureMeta(input),
    ...(frames ? { frames } : {}),
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
