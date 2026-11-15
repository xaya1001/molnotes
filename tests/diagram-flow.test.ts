import assert from "node:assert/strict";
import { test } from "node:test";
import { readsWell } from "../src/ui/diagrams/check.ts";
import {
  defineFlow,
  analyzeFlow,
  layoutBranches,
  type FlowInput,
  type BranchLayout,
  type Point,
  flowText,
  chainOrder,
  foldFlow,
  foldable,
  layoutFlow,
  wrapFlow,
} from "../src/ui/diagrams/flow.ts";

const node = (id: string, extra = {}) => ({ id, text: `框 ${id}`, ...extra });

test("a flow reads chains, joins and side exits into one edge each", () => {
  const flow = defineFlow({
    nodes: ["a", "b", "c", "d", "goal", "out"].map((id) => node(id)),
    edges: [
      "a > b > c",
      { from: ["a", "d"], to: "goal" },
      { from: "c", to: "goal", text: "是", dashed: true },
      { from: "b", to: "out", side: true },
    ],
  });
  assert.deepEqual(
    flow.edges.map((e) => [e.from, e.to, e.text, e.dashed, e.side]),
    [
      ["a", "b", "", false, false],
      ["b", "c", "", false, false],
      ["a", "goal", "", false, false],
      ["d", "goal", "", false, false],
      ["c", "goal", "是", true, false],
      ["b", "out", "", false, true],
    ],
  );
  assert.equal(flow.direction, "auto");
  assert.deepEqual(flow.nodes[0], {
    id: "a",
    text: "框 a",
    kind: "box",
    tone: "plain",
    tag: "",
  });
  assert.ok(flowText(flow).includes("是"));
});

test("a malformed flow is rejected with what to change", () => {
  const nodes = [node("a"), node("b"), node("c")];
  for (const [value, pattern] of [
    [
      { nodes, edges: ["a > b > x"] },
      /flow edge 1 names node x, which does not exist; the nodes are a, b, c/,
    ],
    [
      { nodes: [node("a"), node("a")], edges: ["a > a"] },
      /flow node 2 id a is already used by node 1/,
    ],
    [
      { nodes, edges: ["a > b > c", "c > a"] },
      /flow edges run in a circle: a > b > c > a/,
    ],
    [{ nodes, edges: ["a > b"] }, /flow node c has no edge/],
    [
      { nodes: Array.from({ length: 21 }, (_, i) => node(`n${i}`)), edges: [] },
      /flow has 21 nodes; .* at most 20/,
    ],
    [
      { nodes, edges: ["a > > b", "b > c"] },
      /flow edge 1 "a > > b" must be node ids joined by " > "/,
    ],
    [{ nodes, edges: ["a b > c"] }, /must be node ids joined by " > "/],
    [
      { nodes, edges: ["a > b", "a > b", "b > c"] },
      /flow edge 2 repeats the edge a > b/,
    ],
    [
      { nodes, edges: ["a > b", { from: "b", to: "c", side: true }, "c > a"] },
      /flow node c hangs beside b by a side edge, so it takes no other edges/,
    ],
    [
      { nodes, edges: [{ from: ["a", "b"], to: "c", text: "x" }] },
      /flow edge 1 joins several nodes, so it takes no text or side/,
    ],
    [
      { nodes: [node("a", { kind: "diamond" }), node("b")], edges: ["a > b"] },
      /flow node 1 kind must be one of box, ask, end, note/,
    ],
    [{ steps: [{ text: "a" }] }, /flow unknown field steps/],
    [
      {
        nodes: ["a", "b", "c", "d", "e", "f"].map((id) => node(id)),
        edges: ["a > b > f", "a > c > e > f", "a > d > e"],
      },
      /flow node f is reached from two branches that do not start at one fork/,
    ],
    [
      {
        nodes: Array.from({ length: 16 }, (_, i) => node(`n${i}`)),
        edges: Array.from({ length: 5 }, (_, i) => [
          `n${i} > n${i + 1}`,
          `n${i} > n${i + 6}`,
          `n${i + 6} > n${i + 11}`,
        ]).flat(),
      },
      /flow branches nest 5 levels deep/,
    ],
    [
      {
        nodes,
        edges: [{ from: "a", to: "b", text: "条件".repeat(9) }, "a > c"],
      },
      /flow edge 1 text is longer than 16 characters/,
    ],
  ])
    assert.throws(() => defineFlow(value), pattern);
});

const space = { rank: 28, cross: 16, side: 22, pad: 6, thread: 12 };
const sized = (flow: import("../src/ui/diagrams/flow.ts").Flow, w = 100) =>
  flow.nodes.map((n, i: number) => ({
    w,
    h: 40 + (i % 3) * 12,
    tag: n.tag ? 16 : 0,
  }));
const overlaps = (
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number },
) =>
  a.x < b.x + b.w - 0.5 &&
  b.x < a.x + a.w - 0.5 &&
  a.y < b.y + b.h - 0.5 &&
  b.y < a.y + a.h - 0.5;

test("a laid-out flow moves forward along every edge and no two boxes overlap", () => {
  const flow = defineFlow({
    nodes: [
      node("s", { kind: "end" }),
      node("a", { tag: "甲" }),
      node("b"),
      node("c"),
      node("q", { kind: "ask" }),
      node("yes"),
      node("no", { tone: "muted" }),
      node("goal"),
      node("aside", { kind: "note" }),
    ],
    edges: [
      "s > a > q",
      "s > b",
      "s > c",
      { from: "q", to: "yes", text: "是" },
      { from: "q", to: "no", text: "否" },
      { from: ["yes", "b", "c"], to: "goal" },
      { from: "a", to: "aside", side: true },
    ],
  });
  const labels = flow.edges.map((e) => (e.text ? { w: 20, h: 14 } : null));
  for (const direction of ["right", "down"] as const) {
    const sizes = sized(flow);
    const layout = layoutFlow(flow, direction, sizes, labels, space);
    const boxes = layout.nodes.map((p, i) => ({ ...p, ...sizes[i] }));
    const along = (b: (typeof boxes)[number]) =>
      direction === "right" ? b.x : b.y;
    const end = (b: (typeof boxes)[number]) =>
      direction === "right" ? b.x + b.w : b.y + b.h;
    flow.edges.forEach((e, i) => {
      const from = boxes[flow.nodes.findIndex((n) => n.id === e.from)];
      const to = boxes[flow.nodes.findIndex((n) => n.id === e.to)];
      // Main edges run from one rank to a later one; a side node sits level with its source.
      const mid = (b: (typeof boxes)[number]) =>
        direction === "right" ? b.x + b.w / 2 : b.y + (b.tag + b.h) / 2;
      if (e.side) assert.ok(Math.abs(mid(from) - mid(to)) < 1, direction);
      else assert.ok(end(from) < along(to), `${direction} ${e.from} > ${e.to}`);
      const tip = layout.edges[i].points.at(-1);
      assert.ok(
        tip![0] >= to.x - 0.5 && tip![0] <= to.x + to.w + 0.5,
        `${direction} arrow into ${e.to}`,
      );
    });
    boxes.forEach((a, i) =>
      boxes
        .slice(i + 1)
        .forEach((b, j) =>
          assert.ok(!overlaps(a, b), `${direction} ${i} and ${i + 1 + j}`),
        ),
    );
    for (const b of boxes) {
      assert.ok(b.x >= 0 && b.x + b.w <= layout.width + 0.5);
      assert.ok(b.y >= 0 && b.y + b.h <= layout.height + 0.5);
    }
  }
});

test("a chain lines up and joining edges meet their target's centre", () => {
  const flow = defineFlow({
    nodes: ["a", "b", "c", "goal"].map((id) => node(id)),
    edges: [{ from: ["a", "b", "c"], to: "goal" }],
  });
  const sizes = flow.nodes.map(() => ({ w: 100, h: 40, tag: 0 }));
  const layout = layoutFlow(flow, "right", sizes, [null, null, null], space);
  const centre = (i: number) => layout.nodes[i].y + 20;
  assert.equal(centre(3), centre(1));
  assert.ok(centre(0) < centre(1) && centre(1) < centre(2));
  for (const edge of layout.edges)
    assert.deepEqual(edge.points.at(-1), [layout.nodes[3].x, centre(3)]);

  const chain = defineFlow({
    nodes: ["a", "b", "c"].map((id) => node(id)),
    edges: ["a > b > c"],
  });
  const down = layoutFlow(
    chain,
    "down",
    chain.nodes.map((_, i) => ({ w: 100, h: 30 + i * 10, tag: 0 })),
    [null, null],
    space,
  );
  assert.deepEqual(
    down.nodes.map((n) => n.x),
    [0, 0, 0],
  );
});

test("a folded flow puts side nodes and an aligned column under their rank's main node", () => {
  const flow = defineFlow({
    nodes: [
      node("start", { kind: "end" }),
      node("one"),
      node("oneSays", { kind: "note" }),
      node("two"),
      node("ex0"),
      node("ex1"),
      node("ex2"),
    ],
    edges: [
      "start > one > two",
      { from: "one", to: "oneSays", side: true },
      "ex0 > ex1 > ex2",
    ],
  });
  assert.ok(foldable(flow));
  const sizes = flow.nodes.map(() => ({ w: 0, h: 40, tag: 0 }));
  const layout = foldFlow(
    flow,
    300,
    sizes,
    flow.edges.map(() => null),
    space,
  );
  const at = Object.fromEntries(
    flow.nodes.map((n, i) => [n.id, layout.nodes[i]]),
  );
  // Reading down: each main node, then what sits beside it, indented.
  const order = Object.entries(at)
    .sort(([, a], [, b]) => a.y - b.y)
    .map(([id]) => id);
  assert.deepEqual(order, [
    "start",
    "ex0",
    "one",
    "oneSays",
    "ex1",
    "two",
    "ex2",
  ]);
  for (const id of ["start", "one", "two"]) assert.equal(at[id].x, 0);
  for (const id of ["oneSays", "ex0", "ex1", "ex2"]) {
    assert.ok(at[id].x > 0);
    assert.equal(at[id].x + at[id].w, 300);
  }
  // The aligned column's edges run outside every box.
  const rail = layout.edges.at(-1)!.points;
  assert.ok(rail.some(([x]) => x > 300) && layout.width > 300);
  // A flow with two main nodes in one rank has no single line to fold under.
  assert.ok(
    !foldable(
      defineFlow({
        nodes: ["a", "b", "c", "d"].map((id) => node(id)),
        edges: ["a > b > d", "a > c > d"],
      }),
    ),
  );
});

test("a box reads well with about five characters a line, six lines at most", () => {
  // Lines the author wrote that fit on one line are fine however short.
  assert.ok(
    readsWell([
      { lines: 1, length: 2 },
      { lines: 2, length: 10 },
    ]),
  );
  assert.ok(!readsWell([{ lines: 2, length: 7 }]));
  assert.ok(!readsWell([{ lines: 7, length: 50 }]));
});

test("a wrapped chain reads in rows left to right, a bent edge leading to each next row", () => {
  const flow = defineFlow({
    nodes: ["a", "b", "c", "d", "e", "f", "g"].map((id) => node(id)),
    edges: ["d > e > f > g", "a > b > c > d"],
  });
  assert.deepEqual(chainOrder(flow), [0, 1, 2, 3, 4, 5, 6]);
  const sizes = flow.nodes.map((_, i) => ({
    w: 0,
    h: 40 + (i % 2) * 10,
    tag: 0,
  }));
  const layout = wrapFlow(
    flow,
    4,
    100,
    sizes,
    flow.edges.map(() => null),
    space,
  );
  const rows = Object.groupBy(layout.nodes, (n) =>
    n.y < 60 ? "first" : "second",
  );
  assert.deepEqual([rows.first!.length, rows.second!.length], [4, 3]);
  // Each row runs left to right; the next row starts back at the left.
  for (const row of [rows.first, rows.second])
    row!.slice(1).forEach((n, i) => assert.ok(n.x >= row![i].x + 100));
  assert.equal(layout.nodes[4].x, layout.nodes[0].x);
  // d > e leaves d's right side and enters e's left side, outside every box.
  const bend = layout.edges[0].points;
  assert.ok(
    bend.length > 2 && bend.every(([x]) => x >= 0 && x <= layout.width),
  );
  assert.ok(bend.at(-1)![0] === layout.nodes[4].x);
  // Branching flows do not wrap.
  assert.equal(
    chainOrder(
      defineFlow({
        nodes: ["a", "b", "c"].map((id) => node(id)),
        edges: ["a > b", "a > c"],
      }),
    ),
    null,
  );
});

// The four reading shapes: a two-level tree, a join, a long spine and tagged exits.
const sampleFlow = (
  lengths: number[],
  edges: FlowInput["edges"],
  tags: number[] = [],
): FlowInput => ({
  nodes: lengths.map((length, i) => ({
    id: `n${i}`,
    text: "样本观察与记录".repeat(8).slice(0, length),
    kind:
      edges.filter((edge) => typeof edge !== "string" && edge.from === `n${i}`)
        .length > 1
        ? "ask"
        : "box",
    ...(tags.includes(i) ? { tag: `${i} 样本阶段` } : {}),
  })),
  edges,
});
const branchExamples = [
  sampleFlow(
    [11, 9, 8, 8, 8, 22, 22, 13, 21, 15, 18, 15, 12],
    [
      "n0 > n1",
      { from: "n1", to: "n2", text: "条件" },
      { from: "n1", to: "n3", text: "条件" },
      { from: "n1", to: "n4", text: "条件" },
      { from: "n2", to: "n5", text: "样本条件与范围" },
      { from: "n2", to: "n6", text: "记录来源完整" },
      { from: "n2", to: "n7", text: "记录来源完整" },
      { from: "n3", to: "n8", text: "样本条件与范围" },
      { from: "n3", to: "n9", text: "条件" },
      { from: "n3", to: "n10", text: "样本条件与范围" },
      { from: "n4", to: "n11", text: "条件" },
      { from: "n4", to: "n12", text: "样本条件与范围" },
    ],
  ),
  sampleFlow(
    [13, 15, 20, 31, 24, 16, 24, 14, 24, 13],
    [
      "n0 > n1",
      { from: "n1", to: "n2", text: "条件" },
      { from: "n1", to: "n3", text: "条件" },
      { from: "n3", to: "n4", text: "条件" },
      "n4 > n5",
      { from: "n3", to: "n6", text: "条件" },
      "n6 > n7",
      { from: ["n5", "n7"], to: "n8" },
      "n8 > n9",
    ],
  ),
  sampleFlow(
    [9, 16, 28, 13, 28, 22, 18, 11, 14, 12, 15, 23, 10, 25],
    [
      "n0 > n1",
      { from: "n1", to: "n2", text: "条件", side: true },
      { from: "n1", to: "n3", text: "条件" },
      { from: "n3", to: "n4", text: "条件", side: true },
      { from: "n3", to: "n5", text: "条件" },
      { from: "n5", to: "n6", text: "条件", side: true },
      { from: "n5", to: "n7", text: "条件" },
      { from: "n7", to: "n8", text: "条件", side: true },
      { from: "n7", to: "n9", text: "条件" },
      { from: "n9", to: "n10", text: "条件", side: true },
      { from: "n9", to: "n11", text: "条件" },
      { from: "n11", to: "n12", text: "条件", side: true },
      { from: "n11", to: "n13", text: "条件" },
    ],
  ),
  sampleFlow(
    [12, 10, 28, 26, 22, 9, 20, 15, 6, 12],
    [
      "n0 > n1 > n2 > n3 > n4 > n5",
      { from: "n1", to: "n6", side: true },
      { from: "n2", to: "n7", side: true },
      { from: "n3", to: "n8", side: true },
      { from: "n4", to: "n9", side: true },
    ],
    [1, 2, 3, 4],
  ),
];

function branchOverlaps(flow: ReturnType<typeof defineFlow>, R: BranchLayout) {
  const clear = 4;
  const grow = (r: Rect) => ({
    x: r.x - clear,
    y: r.y - clear,
    w: r.w + 2 * clear,
    h: r.h + 2 * clear,
  });
  const segments = R.edges.flatMap((line, e) =>
    line.points.slice(1).map((b, k) => ({ e, a: line.points[k], b })),
  );
  const rect = (a: Point, b: Point): Rect => ({
    x: Math.min(a[0], b[0]) - 0.5,
    y: Math.min(a[1], b[1]) - 0.5,
    w: Math.abs(a[0] - b[0]) + 1,
    h: Math.abs(a[1] - b[1]) + 1,
  });
  const heads = R.edges.flatMap((line, e) => {
    if (!line.arrow) return [];
    const p = line.points.at(-2)!,
      t = line.points.at(-1)!;
    const length = Math.hypot(t[0] - p[0], t[1] - p[1]) || 1;
    const dx = (t[0] - p[0]) / length,
      dy = (t[1] - p[1]) / length;
    const xs = [t[0], t[0] - 6 * dx - 3.5 * dy, t[0] - 6 * dx + 3.5 * dy];
    const ys = [t[1], t[1] - 6 * dy + 3.5 * dx, t[1] - 6 * dy - 3.5 * dx];
    return [
      {
        e,
        x: Math.min(...xs),
        y: Math.min(...ys),
        w: Math.max(...xs) - Math.min(...xs),
        h: Math.max(...ys) - Math.min(...ys),
      },
    ];
  });
  const labels = R.edges.flatMap((e, i) =>
    e.label ? [{ ...e.label, e: i }] : [],
  );
  const found: string[] = [];
  for (const [i, label] of labels.entries()) {
    for (const head of heads)
      if (overlaps(grow(label), head))
        found.push(`label ${label.e} / head ${head.e}`);
    for (const [n, box] of R.nodes.entries())
      if (
        overlaps(
          flow.edges[label.e].to === flow.nodes[n].id ? label : grow(label),
          box,
        )
      )
        found.push(`label ${label.e} / box ${n}`);
    for (const other of labels.slice(i + 1))
      if (overlaps(grow(label), other))
        found.push(`label ${label.e} / label ${other.e}`);
    for (const seg of segments)
      if (seg.e !== label.e && overlaps(grow(label), rect(seg.a, seg.b)))
        found.push(`label ${label.e} / line ${seg.e}`);
  }
  for (const [i, n] of R.nodes.entries()) {
    for (const other of R.nodes.slice(i + 1))
      if (overlaps(n, other)) found.push(`box ${i} / box ${other.i}`);
    const inner = {
      x: n.x + 2,
      y: n.y + n.tag + 2,
      w: n.w - 4,
      h: n.h - n.tag - 4,
    };
    for (const seg of segments)
      if (overlaps(inner, rect(seg.a, seg.b)))
        found.push(`line ${seg.e} / box ${i}`);
  }
  return found;
}
type Rect = { x: number; y: number; w: number; h: number };

test("branch layouts fit narrow through wide pages with clear text, boxes and arrowheads", () => {
  const modes = new Set<string>();
  for (const [example, input] of branchExamples.entries()) {
    const flow = defineFlow(input),
      A = analyzeFlow(flow);
    const textSize = (text: string, max: number, size: number) => {
      const width = [...text].reduce(
        (sum, c) => sum + (c.charCodeAt(0) > 127 ? size : size * 0.55),
        0,
      );
      return {
        w: Math.min(max, width),
        h: Math.ceil(width / max) * size * 1.4,
      };
    };
    for (const direction of ["auto", "right", "down"] as const) {
      flow.direction = direction;
      for (let width = 300; width <= 1100; width += 10) {
        const R = layoutBranches(
          flow,
          A,
          {
            node(i, w) {
              return {
                h:
                  Math.max(
                    36.4,
                    textSize(flow.nodes[i].text, w - 30, 14).h + 18,
                  ) + (flow.nodes[i].tag ? 24 : 0),
                tag: flow.nodes[i].tag ? 24 : 0,
              };
            },
            label(i, mode, max) {
              return textSize(
                flow.edges[i].text,
                max ?? (mode === "on" ? 84 : 60),
                12,
              );
            },
          },
          width,
        );
        modes.add(R.mode);
        assert.ok(
          R.width <= width,
          `${example} ${direction} ${width}: overflow`,
        );
        for (const node of R.nodes) {
          assert.ok(node.x >= 0 && node.x + node.w <= width + 0.5);
          assert.ok(node.y >= 0 && node.y + node.h <= R.height + 0.5);
        }
        assert.deepEqual(
          branchOverlaps(flow, R),
          [],
          `${example} ${direction} ${width} ${R.mode}`,
        );
      }
    }
  }
  assert.deepEqual([...modes].sort(), ["down", "outline", "right"]);
});
