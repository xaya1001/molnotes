// Pure data layer of DataScatterExplorer: a table whose cells are numbers as a
// source printed them. A cell keeps its text (`raw`), its bound (`op`, so a
// ">10" is never read as the exact number 10) and, where another source prints
// a different value, that alternate beside it. A missing cell has no key at
// all; nothing here turns "not measured" into zero. This module is the only
// place that turns the strings into numbers.

export type DataOp = "=" | ">" | "<";

/** One number as a source printed it; `value` is in the column's source unit. */
export interface DataValue {
  raw: string;
  op: DataOp;
  value: number;
  /** The standard deviation as printed. */
  sd?: string;
}

/** What another source prints for the same cell, with where it says so. */
export interface DataAlternate {
  value: DataValue;
  /** The value and unit as the other source wrote them. */
  printed: string;
  where: string;
  note?: string;
}

export type DataCell = DataValue & { alternate?: DataAlternate };

export interface DataColumn {
  key: string;
  label: string;
  /** Unit of the headers, cells and axis. */
  unit?: string;
  /** Unit of the source table; `shift` decimal places move it to `unit`. */
  sourceUnit?: string;
  shift: number;
  scale: "log" | "linear";
  /** Fixed range of a linear axis; without it the range follows the data. */
  domain?: readonly [number, number];
}

export interface DataGroup {
  id: string;
  label: string;
  where?: string;
}

/** How the two readings of a cell with an alternate are named on the page. */
export interface DataAlternates {
  /** Short source name in front of the alternate value in the table, e.g. "主文". */
  source: string;
  /** Radio labels for the reading the plot uses. */
  listed: string;
  alternate: string;
  legend: string;
  /** Reading the plot starts with. */
  plot: "listed" | "alternate";
}

export interface DataRow {
  id: string;
  /** Text of the first column. */
  label: string;
  /** Full name in the detail panel and the plot; `label` when not given. */
  name: string;
  smiles?: string;
  group?: string;
  notes: readonly string[];
  values: Readonly<Record<string, DataCell>>;
}

export interface DataTable {
  columns: readonly DataColumn[];
  groups?: { label: string; items: readonly DataGroup[] };
  alternates?: DataAlternates;
  rows: readonly DataRow[];
}

export interface DataTableInput {
  columns: readonly {
    key: string;
    label: string;
    unit?: string;
    sourceUnit?: string;
    shift?: number;
    scale: "log" | "linear";
    domain?: readonly [number, number];
  }[];
  groups?: { label: string; items: readonly DataGroup[] };
  alternates?: Omit<DataAlternates, "plot"> & { plot?: DataAlternates["plot"] };
  rows: readonly {
    id: string;
    label: string;
    name?: string;
    smiles?: string;
    group?: string;
    notes?: readonly string[];
    values: Readonly<
      Record<
        string,
        | {
            raw: string;
            sd?: string;
            /** `unit` is the column's `unit` or `sourceUnit`; the column's `unit` when left out. */
            alternate?: {
              raw: string;
              unit?: string;
              where: string;
              note?: string;
            };
          }
        | undefined
      >
    >;
  }[];
}

const plain = /^-?\d+(?:\.\d+)?$/;
const unsigned = /^\d+(?:\.\d+)?$/;

/** Reads "0.00751", ">10" or "<0.5"; anything else is an error, not a guess. */
export function parseDataValue(raw: string, sd?: string): DataValue {
  const op: DataOp = raw.startsWith(">")
    ? ">"
    : raw.startsWith("<")
      ? "<"
      : "=";
  const body = op === "=" ? raw : raw.slice(1);
  if (!plain.test(body)) throw new Error(`Unreadable table value: ${raw}`);
  const value: DataValue = { raw, op, value: Number(body) };
  if (sd !== undefined) {
    if (!unsigned.test(sd)) throw new Error(`Unreadable table sd: ${sd}`);
    value.sd = sd;
  }
  return value;
}

/** Moves the decimal point of a plain decimal string, without floating-point artefacts. */
export function shiftDecimal(text: string, places: number): string {
  if (!plain.test(text)) throw new Error(`Unreadable table value: ${text}`);
  const negative = text.startsWith("-");
  const [whole, fraction = ""] = (negative ? text.slice(1) : text).split(".");
  const all = whole + fraction;
  const point = whole.length + places;
  const padded =
    point > all.length ? all + "0".repeat(point - all.length) : all;
  const left = point < 0 ? "0".repeat(-point) + padded : padded;
  const at = Math.max(point, 0);
  const integer = left.slice(0, at).replace(/^0+(?=\d)/, "") || "0";
  const rest = left.slice(at).replace(/0+$/, "");
  const shifted = rest ? `${integer}.${rest}` : integer;
  return negative && shifted !== "0" ? `-${shifted}` : shifted;
}

function bareText(raw: string) {
  return raw.startsWith(">") || raw.startsWith("<") ? raw.slice(1) : raw;
}

/** The cell as shown in the column's unit, with its bound mark; `missing` when there is no cell. */
export function formatValue(
  cell: DataValue | undefined,
  column: DataColumn,
  missing = "—",
) {
  if (!cell) return missing;
  const bare = bareText(cell.raw);
  const shown = column.shift ? shiftDecimal(bare, column.shift) : bare;
  const [whole, fraction] = shown.split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${cell.op === "=" ? "" : cell.op}${fraction ? `${grouped}.${fraction}` : grouped}`;
}

/** The cell as the source printed it, with unit, sd and a note when it is only a bound. */
export function sourceText(cell: DataValue, column: DataColumn) {
  const unit = column.sourceUnit ? ` ${column.sourceUnit}` : "";
  const sd = cell.sd !== undefined ? ` ± ${cell.sd}` : "";
  const bound =
    cell.op === ">" ? "（下限）" : cell.op === "<" ? "（上限）" : "";
  return `${cell.raw}${unit}${sd}${bound}`;
}

/** The cell as a plotting number in the column's unit; `op` is the bound, "=" for an exact value. */
export function plotValue(cell: DataValue | undefined, column: DataColumn) {
  if (!cell) return undefined;
  return { value: cell.value * 10 ** column.shift, op: cell.op };
}

export function columnOf(table: DataTable, key: string): DataColumn {
  const found = table.columns.find((column) => column.key === key);
  if (!found) throw new Error(`Unknown column: ${key}`);
  return found;
}

export function defineDataTable(input: DataTableInput): DataTable {
  const columns: DataColumn[] = input.columns.map((column) => {
    const shift = column.shift ?? 0;
    if (!Number.isInteger(shift) || shift < 0)
      throw new Error(`Column ${column.key}: shift must be a whole number`);
    if (column.scale === "log" && column.domain)
      throw new Error(`Column ${column.key}: a log axis follows the data`);
    if (column.domain && column.domain[0] >= column.domain[1])
      throw new Error(`Column ${column.key}: empty axis range`);
    if (shift && (!column.unit || !column.sourceUnit))
      throw new Error(`Column ${column.key}: shift needs unit and sourceUnit`);
    return { ...column, shift };
  });
  if (new Set(columns.map((c) => c.key)).size !== columns.length)
    throw new Error("Duplicate column key");

  const groups = input.groups;
  const groupIds = new Set(groups?.items.map((item) => item.id));
  if (groups && groupIds.size !== groups.items.length)
    throw new Error("Duplicate group id");

  const alternates: DataAlternates | undefined = input.alternates && {
    ...input.alternates,
    plot: input.alternates.plot ?? "listed",
  };

  const seen = new Set<string>();
  const rows: DataRow[] = input.rows.map((row) => {
    if (seen.has(row.id)) throw new Error(`Duplicate row id: ${row.id}`);
    seen.add(row.id);
    if (row.group !== undefined && !groupIds.has(row.group))
      throw new Error(`Row ${row.id}: unknown group ${row.group}`);
    if (groups && row.group === undefined)
      throw new Error(`Row ${row.id}: no group`);
    const values: Record<string, DataCell> = {};
    for (const [key, entry] of Object.entries(row.values)) {
      if (!entry) continue;
      const column = columns.find((c) => c.key === key);
      if (!column) throw new Error(`Row ${row.id}: unknown column ${key}`);
      const cell: DataCell = parseDataValue(entry.raw, entry.sd);
      if (entry.alternate) {
        if (!alternates)
          throw new Error(`Row ${row.id}: an alternate needs "alternates"`);
        cell.alternate = alternate(row.id, column, entry.alternate);
      }
      values[key] = cell;
    }
    return {
      id: row.id,
      label: row.label,
      name: row.name ?? row.label,
      smiles: row.smiles,
      group: row.group,
      notes: row.notes ?? [],
      values,
    };
  });
  return { columns, groups, alternates, rows };
}

function alternate(
  rowId: string,
  column: DataColumn,
  input: { raw: string; unit?: string; where: string; note?: string },
): DataAlternate {
  const unit = input.unit ?? column.unit;
  const bound = input.raw.startsWith(">") || input.raw.startsWith("<");
  const mark = bound ? input.raw[0] : "";
  let raw = input.raw;
  if (column.shift && unit === column.unit)
    raw = mark + shiftDecimal(bareText(input.raw), -column.shift);
  else if (column.shift && unit !== column.sourceUnit)
    throw new Error(`Row ${rowId}: ${column.key} alternate unit ${unit}`);
  if (!input.where) throw new Error(`Row ${rowId}: alternate without source`);
  return {
    value: parseDataValue(raw),
    printed: unit ? `${input.raw} ${unit}` : input.raw,
    where: input.where,
    note: input.note,
  };
}

/** The rows with every cell that has an alternate replaced by it; the input is untouched. */
export function withAlternateValues(rows: readonly DataRow[]): DataRow[] {
  return rows.map((row) => {
    if (!Object.values(row.values).some((cell) => cell.alternate)) return row;
    const values: Record<string, DataCell> = {};
    for (const [key, cell] of Object.entries(row.values))
      values[key] = cell.alternate ? { ...cell.alternate.value } : cell;
    return { ...row, values };
  });
}

const boundOrder: Record<DataOp, number> = { "<": -1, "=": 0, ">": 1 };
const naturalOrder = new Intl.Collator("en", { numeric: true });

/** Rows ordered by the first column (`"label"`) or one column; missing values last, a bound next to the same exact value. */
export function sortRows(
  rows: readonly DataRow[],
  key: string,
  direction: "asc" | "desc",
): DataRow[] {
  const sign = direction === "asc" ? 1 : -1;
  const byLabel = (a: DataRow, b: DataRow) =>
    naturalOrder.compare(a.label, b.label);
  if (key === "label") return [...rows].sort((a, b) => sign * byLabel(a, b));
  return [...rows].sort((a, b) => {
    const left = a.values[key];
    const right = b.values[key];
    if (!left || !right) return Number(!left) - Number(!right) || byLabel(a, b);
    if (left.value !== right.value) return sign * (left.value - right.value);
    if (left.op !== right.op)
      return sign * (boundOrder[left.op] - boundOrder[right.op]);
    return byLabel(a, b);
  });
}

export type Reading = "listed" | "alternate";

export interface ScatterPoint {
  id: string;
  /** Positions in the columns' units. */
  x: number;
  y: number;
  xOp: DataOp;
  yOp: DataOp;
  /** The reading the point uses has an alternate in one of the two columns. */
  flagged: boolean;
  /** Where the other reading would put the point; absent when it lands in the same place. */
  other?: { x: number; y: number };
  xText: string;
  yText: string;
}

function cellFor(cell: DataCell | undefined, use: Reading) {
  return use === "alternate" && cell?.alternate ? cell.alternate.value : cell;
}
function otherFor(cell: DataCell | undefined, use: Reading) {
  if (!cell?.alternate) return undefined;
  return use === "alternate"
    ? { ...cell, alternate: undefined }
    : cell.alternate.value;
}
function drawable(value: ReturnType<typeof plotValue>, column: DataColumn) {
  return value && (column.scale === "linear" || value.value > 0)
    ? value
    : undefined;
}

/** One point per row that has a drawable value in both columns; a missing cell never becomes a point. */
export function scatterPoints(
  rows: readonly DataRow[],
  x: DataColumn,
  y: DataColumn,
  use: Reading,
): ScatterPoint[] {
  const points: ScatterPoint[] = [];
  for (const row of rows) {
    const cx = row.values[x.key];
    const cy = row.values[y.key];
    const px = drawable(plotValue(cellFor(cx, use), x), x);
    const py = drawable(plotValue(cellFor(cy, use), y), y);
    if (!px || !py) continue;
    const ox = drawable(plotValue(otherFor(cx, use) ?? cellFor(cx, use), x), x);
    const oy = drawable(plotValue(otherFor(cy, use) ?? cellFor(cy, use), y), y);
    const flagged = Boolean(cx?.alternate || cy?.alternate);
    const other =
      ox && oy && (ox.value !== px.value || oy.value !== py.value)
        ? { x: ox.value, y: oy.value }
        : undefined;
    points.push({
      id: row.id,
      x: px.value,
      y: py.value,
      xOp: px.op,
      yOp: py.op,
      flagged,
      other,
      xText: formatValue(cellFor(cx, use), x),
      yText: formatValue(cellFor(cy, use), y),
    });
  }
  return points;
}

export interface AxisDomain {
  min: number;
  max: number;
  log: boolean;
}

/** Log axes span whole decades around the data; linear axes use the column's range or round the data's. */
export function axisDomain(
  rows: readonly DataRow[],
  column: DataColumn,
  use: Reading,
): AxisDomain {
  if (column.scale === "linear" && column.domain)
    return { min: column.domain[0], max: column.domain[1], log: false };
  const values: number[] = [];
  for (const row of rows) {
    const cell = row.values[column.key];
    for (const item of [cellFor(cell, use), otherFor(cell, use)]) {
      const drawn = drawable(plotValue(item, column), column);
      if (drawn) values.push(drawn.value);
    }
  }
  if (column.scale === "log") {
    if (!values.length) return { min: 0, max: 1, log: true };
    const low = Math.floor(Math.log10(Math.min(...values)));
    const high = Math.ceil(Math.log10(Math.max(...values)));
    return { min: low, max: Math.max(high, low + 1), log: true };
  }
  if (!values.length) return { min: 0, max: 1, log: false };
  const low = Math.min(...values);
  const high = Math.max(...values);
  const step = niceStep(high > low ? high - low : 1);
  const min = Math.floor(low / step) * step;
  const max = Math.max(Math.ceil(high / step) * step, min + step);
  return { min, max, log: false };
}

/** The smallest 1, 2 or 5 times a power of ten that splits the range into at most six steps. */
function niceStep(range: number) {
  for (let power = Math.floor(Math.log10(range)) - 1; ; power++)
    for (const factor of [1, 2, 5]) {
      const step = factor * 10 ** power;
      if (range / step <= 6) return step;
    }
}

/** Decades of a log axis (the exponent is the domain); about five steps of a linear one. */
export function axisTicks(domain: AxisDomain) {
  if (domain.log)
    return Array.from({ length: domain.max - domain.min + 1 }, (_, i) => {
      const v = 10 ** (domain.min + i);
      return { v, label: v.toLocaleString("en-US") };
    });
  const step = niceStep(domain.max - domain.min);
  const count = Math.round((domain.max - domain.min) / step);
  return Array.from({ length: count + 1 }, (_, i) => {
    const v = Number((domain.min + i * step).toPrecision(12));
    return { v, label: v.toLocaleString("en-US") };
  });
}

/** Position of a value along an axis, 0 to 1. */
export function axisPosition(value: number, domain: AxisDomain) {
  const t = domain.log
    ? (Math.log10(value) - domain.min) / (domain.max - domain.min)
    : (value - domain.min) / (domain.max - domain.min);
  return t;
}
