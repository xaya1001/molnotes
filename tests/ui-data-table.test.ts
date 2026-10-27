import test from "node:test";
import assert from "node:assert/strict";
import {
  axisDomain,
  axisTicks,
  defineDataTable,
  formatValue,
  parseDataValue,
  plotValue,
  scatterPoints,
  shiftDecimal,
  sortRows,
  withAlternateValues,
  type DataColumn,
  type DataRow,
  type DataTableInput,
  type Reading,
} from "../src/ui/data/values.ts";

// Neutral data: two assays on four samples. Potency is printed in µM and shown
// in nM; recovery is a percentage.
const input: DataTableInput = {
  columns: [
    {
      key: "potency",
      label: "效价",
      unit: "nM",
      sourceUnit: "µM",
      shift: 3,
      scale: "log",
    },
    {
      key: "binding",
      label: "结合",
      unit: "nM",
      sourceUnit: "µM",
      shift: 3,
      scale: "log",
    },
    {
      key: "recovery",
      label: "回收",
      unit: "%",
      sourceUnit: "%",
      scale: "linear",
      domain: [0, 100],
    },
  ],
  groups: {
    label: "批次",
    items: [
      { id: "a", label: "批次 A", where: "表 1" },
      { id: "b", label: "批次 B" },
    ],
  },
  alternates: {
    source: "正文",
    listed: "附表值",
    alternate: "正文值",
    legend: "两处写法不一致的格子，散点取",
  },
  rows: [
    {
      id: "13",
      label: "13",
      group: "a",
      values: {
        potency: { raw: "0.0021", sd: "0.0004" },
        binding: { raw: "0.05513" },
        recovery: { raw: "6" },
      },
    },
    {
      id: "4",
      label: "4",
      name: "样品 4",
      group: "a",
      values: {
        potency: { raw: ">10" },
        binding: {
          raw: "96.18",
          alternate: {
            raw: "9618",
            unit: "nM",
            where: "表 5",
            note: "附表比正文大 10 倍",
          },
        },
        recovery: { raw: "7" },
      },
    },
    {
      id: "21",
      label: "21",
      group: "b",
      values: { potency: { raw: "0.0008" }, binding: { raw: "<0.001" } },
    },
    {
      id: "7",
      label: "7",
      group: "b",
      notes: ["批次 B 的备注"],
      values: {
        potency: { raw: "0" },
        binding: { raw: "0.2" },
        recovery: { raw: "88" },
      },
    },
  ],
};
const table = defineDataTable(input);
const row = (id: string) => table.rows.find((r) => r.id === id)!;
const column = (key: string) => table.columns.find((c) => c.key === key)!;

test("a bound keeps its mark and is never read as an exact number", () => {
  assert.deepEqual(parseDataValue(">10"), { raw: ">10", op: ">", value: 10 });
  assert.deepEqual(parseDataValue("<0.5"), {
    raw: "<0.5",
    op: "<",
    value: 0.5,
  });
  assert.deepEqual(parseDataValue("10", "0"), {
    raw: "10",
    op: "=",
    value: 10,
    sd: "0",
  });
  for (const bad of ["≥10", "1e3", "10 nM", "", ">", "1,5", "--2"])
    assert.throws(() => parseDataValue(bad), bad);
  assert.throws(() => parseDataValue("1", "-1"));
  assert.equal(row("4").values.potency.op, ">");
  assert.equal(row("21").values.binding.op, "<");
  assert.equal(row("13").values.potency.op, "=");
  assert.equal(
    formatValue(row("4").values.potency, column("potency")),
    ">10,000",
  );
  assert.equal(formatValue(row("21").values.binding, column("binding")), "<1");
});

test("units move the decimal point of the printed text instead of multiplying", () => {
  assert.equal(shiftDecimal("0.00751", 3), "7.51");
  assert.equal(shiftDecimal("0.0001", 3), "0.1");
  assert.equal(shiftDecimal("10", 3), "10000");
  assert.equal(shiftDecimal("96.18", 3), "96180");
  assert.equal(shiftDecimal("-0.5", 3), "-500");
  assert.equal(shiftDecimal("9618", -3), "9.618");
  assert.equal(shiftDecimal("0", 3), "0");
  assert.equal(
    formatValue(row("13").values.binding, column("binding")),
    "55.13",
  );
  assert.equal(
    formatValue(row("4").values.binding, column("binding")),
    "96,180",
  );
  assert.equal(formatValue(row("13").values.recovery, column("recovery")), "6");
  const plotted = plotValue(row("13").values.potency, column("potency"));
  assert.equal(plotted!.value.toFixed(6), "2.100000");
  assert.equal(plotted!.op, "=");
});

test("a missing cell has no key, shows the missing mark and is never plotted as zero", () => {
  assert.equal("recovery" in row("21").values, false);
  assert.equal(formatValue(row("21").values.recovery, column("recovery")), "—");
  assert.equal(formatValue(undefined, column("recovery"), "未测"), "未测");
  const points = scatterPoints(
    table.rows,
    column("potency"),
    column("recovery"),
    "listed",
  );
  // 21 has no recovery; 7 has potency 0, which a log axis cannot draw
  assert.deepEqual(points.map((p) => p.id).sort(), ["13", "4"]);
  const noZero = scatterPoints(
    table.rows,
    column("recovery"),
    column("binding"),
    "listed",
  );
  assert.ok(noZero.every((p) => p.x > 0 && p.y > 0));
});

test("bounds stay in the plot as bounds, drawn at the bound", () => {
  const [point] = scatterPoints(
    table.rows.filter((r) => r.id === "4"),
    column("potency"),
    column("recovery"),
    "listed",
  );
  assert.equal(point.xOp, ">");
  assert.equal(point.yOp, "=");
  assert.equal(point.x, 10000);
  assert.equal(point.xText, ">10,000");
  const [upper] = scatterPoints(
    table.rows.filter((r) => r.id === "21"),
    column("potency"),
    column("binding"),
    "listed",
  );
  assert.equal(upper.yOp, "<");
  assert.equal(upper.y, 1);
});

test("an alternate sits beside the listed value, in the source unit, and the plot says which it uses", () => {
  const cell = row("4").values.binding;
  assert.equal(cell.raw, "96.18");
  assert.equal(cell.alternate!.value.raw, "9.618");
  assert.equal(cell.alternate!.printed, "9618 nM");
  assert.equal(cell.alternate!.where, "表 5");
  assert.equal(cell.alternate!.note, "附表比正文大 10 倍");
  const at = (use: Reading) =>
    scatterPoints(table.rows, column("binding"), column("recovery"), use).find(
      (p) => p.id === "4",
    )!;
  assert.equal(at("listed").x, 96180);
  assert.equal(at("listed").other!.x, 9618);
  assert.equal(at("listed").flagged, true);
  assert.equal(at("alternate").x, 9618);
  assert.equal(at("alternate").other!.x, 96180);
  assert.equal(at("alternate").xText, "9,618");
  // a row without an alternate is not flagged and has no second position
  const plain = scatterPoints(
    table.rows,
    column("binding"),
    column("recovery"),
    "listed",
  ).find((p) => p.id === "13");
  assert.equal(plain!.flagged, false);
  assert.equal(plain!.other, undefined);
  // swapping readings builds new rows and leaves the table alone
  const swapped = withAlternateValues(table.rows);
  assert.equal(swapped.find((r) => r.id === "4")!.values.binding.raw, "9.618");
  assert.equal(row("4").values.binding.raw, "96.18");
  assert.equal(
    swapped.find((r) => r.id === "13"),
    row("13"),
  );
});

test("an alternate in a unit the column does not have, or without a source, is refused", () => {
  // Alternates of any shape, including ones the table must refuse.
  const withAlt = (alternate: {
    raw: string;
    unit?: string;
    where: string;
  }) => ({
    ...input,
    rows: [
      {
        id: "1",
        label: "1",
        group: "a",
        values: { binding: { raw: "1", alternate } },
      },
    ],
  });
  assert.doesNotThrow(() =>
    defineDataTable(withAlt({ raw: "1000", unit: "nM", where: "表" })),
  );
  assert.doesNotThrow(() =>
    defineDataTable(withAlt({ raw: "1", unit: "µM", where: "表" })),
  );
  assert.throws(() =>
    defineDataTable(withAlt({ raw: "1", unit: "mM", where: "表" })),
  );
  assert.throws(() =>
    defineDataTable(withAlt({ raw: "1", unit: "nM", where: "" })),
  );
  assert.throws(() =>
    defineDataTable({
      ...withAlt({ raw: "1", unit: "nM", where: "表" }),
      alternates: undefined,
    }),
  );
});

test("sorting puts missing values last in both directions and a bound next to the same exact value", () => {
  const ids = (key: string, direction: "asc" | "desc") =>
    sortRows(table.rows, key, direction).map((r) => r.id);
  assert.deepEqual(ids("recovery", "asc"), ["13", "4", "7", "21"]);
  assert.deepEqual(ids("recovery", "desc"), ["7", "4", "13", "21"]);
  // first column: numbers in numeric order, not "13" before "4"
  assert.deepEqual(ids("label", "asc"), ["4", "7", "13", "21"]);
  assert.deepEqual(ids("label", "desc"), ["21", "13", "7", "4"]);
  const same = (raw: string, id: string): DataRow => ({
    id,
    label: id,
    name: id,
    notes: [],
    values: { potency: parseDataValue(raw) },
  });
  const rows = [same(">1", "a"), same("1", "b"), same("<1", "c")];
  assert.deepEqual(
    sortRows(rows, "potency", "asc").map((r) => r.id),
    ["c", "b", "a"],
  );
  assert.deepEqual(
    sortRows(rows, "potency", "desc").map((r) => r.id),
    ["a", "b", "c"],
  );
});

test("axes: log spans whole decades, a linear range is kept or rounded from the data", () => {
  const log = axisDomain(table.rows, column("potency"), "listed");
  // 0 cannot be drawn; the values run from 0.8 to 10,000 nM
  assert.deepEqual(log, { min: -1, max: 4, log: true });
  assert.deepEqual(
    axisTicks(log).map((t) => t.label),
    ["0.1", "1", "10", "100", "1,000", "10,000"],
  );
  assert.deepEqual(
    axisTicks(axisDomain(table.rows, column("recovery"), "listed")).map(
      (t) => t.v,
    ),
    [0, 20, 40, 60, 80, 100],
  );
  const signed: DataColumn = {
    key: "shift",
    label: "位移",
    shift: 0,
    scale: "linear",
  };
  const rows: DataRow[] = [
    {
      id: "1",
      label: "1",
      name: "1",
      notes: [],
      values: { shift: parseDataValue("-3.5") },
    },
    {
      id: "2",
      label: "2",
      name: "2",
      notes: [],
      values: { shift: parseDataValue("4") },
    },
  ];
  const domain = axisDomain(rows, signed, "listed");
  assert.ok(domain.min <= -3.5 && domain.max >= 4);
  assert.ok(axisTicks(domain).length <= 8);
  // no data at all still gives a usable axis
  assert.deepEqual(axisDomain([], column("potency"), "listed"), {
    min: 0,
    max: 1,
    log: true,
  });
});

test("a table that contradicts itself is refused when it is defined", () => {
  const rows = input.rows;
  const bad = (change: object) => () =>
    defineDataTable({ ...input, ...change });
  assert.throws(bad({ rows: [...rows, rows[0]] }), /Duplicate row/);
  assert.throws(
    bad({ columns: [...input.columns, input.columns[0]] }),
    /Duplicate column/,
  );
  assert.throws(
    bad({
      rows: [
        { id: "x", label: "x", group: "a", values: { nope: { raw: "1" } } },
      ],
    }),
    /unknown column/,
  );
  assert.throws(
    bad({ rows: [{ id: "x", label: "x", group: "zzz", values: {} }] }),
    /unknown group/,
  );
  assert.throws(
    bad({ rows: [{ id: "x", label: "x", values: {} }] }),
    /no group/,
  );
  assert.throws(
    bad({ columns: [{ key: "k", label: "k", shift: 3, scale: "log" }] }),
    /unit/,
  );
  assert.throws(
    bad({ columns: [{ key: "k", label: "k", scale: "log", domain: [1, 2] }] }),
    /follows the data/,
  );
  assert.throws(
    bad({
      rows: [
        {
          id: "x",
          label: "x",
          group: "a",
          values: { potency: { raw: "n/a" } },
        },
      ],
    }),
    /Unreadable/,
  );
});
