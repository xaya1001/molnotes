// Pure data layer of the flow figure: nodes joined by arrows, declared as YAML
// inside a ```flow fence in notes or as a topic block's `flow` value.
// `defineFlow` rejects a malformed declaration when content is published and
// returns the model; `layoutFlow` places a model's measured boxes. Nothing
// here imports the UI.
import { fail, flag, isObject, list, only, text } from "./model.ts";

export type FlowKind = "box" | "ask" | "end" | "note";
export type FlowTone = "plain" | "accent" | "muted";
export type FlowDirection = "right" | "down";

export interface FlowInput {
  nodes: {
    id: string;
    text: string;
    kind?: FlowKind;
    tone?: Exclude<FlowTone, "plain">;
    tag?: string;
  }[];
  /** A chain "a > b > c", or one edge; `from` may list nodes that join. */
  edges: (
    | string
    | {
        from: string | string[];
        to: string;
        text?: string;
        dashed?: boolean;
        side?: boolean;
      }
  )[];
  direction?: FlowDirection;
  over?: string;
  note?: string;
}

export interface FlowNode {
  id: string;
  text: string;
  /** box: a step; ask: a question that branches; end: where the flow starts or stops; note: an aside. */
  kind: FlowKind;
  tone: FlowTone;
  /** A small label above the box. */
  tag: string;
}
export interface FlowEdge {
  from: string;
  to: string;
  text: string;
  dashed: boolean;
  /** An exit drawn beside its source; it takes no place in the main line. */
  side: boolean;
  /** The exit was inferred from one continuing branch and terminal leaves. */
  inferred?: boolean;
}
export interface Flow {
  nodes: FlowNode[];
  edges: FlowEdge[];
  /** Fixed direction, or "auto": right when the boxes fit across, else down. */
  direction: FlowDirection | "auto";
  /** A bracket over the whole flow. */
  over: string;
  /** One line under the flow. */
  note: string;
}

/** More boxes than this no longer read as one figure. */
export const mostNodes = 20;
const kinds: FlowKind[] = ["box", "ask", "end", "note"];
const tones: FlowTone[] = ["accent", "muted"];
const idPattern = /^[\p{L}\p{N}_-]+$/u;

function oneOf<T extends string>(
  value: unknown,
  options: T[],
  where: string,
): T | undefined {
  if (value === undefined) return undefined;
  if (!options.includes(value as T))
    fail(`${where} must be one of ${options.join(", ")}`);
  return value as T;
}

export function defineFlow(value: unknown): Flow {
  const input = only(
    value,
    ["nodes", "edges", "direction", "over", "note"],
    "flow",
  );
  const nodeItems = list(input.nodes, "flow nodes");
  if (nodeItems.length < 2)
    fail("flow needs nodes: at least two, joined by edges");
  if (nodeItems.length > mostNodes)
    fail(
      `flow has ${nodeItems.length} nodes; a reader follows at most ${mostNodes}, so split it into two figures`,
    );
  const firstUse = new Map<string, number>();
  const nodes = nodeItems.map((item, i): FlowNode => {
    const where = `flow node ${i + 1}`;
    const node = only(item, ["id", "text", "kind", "tone", "tag"], where);
    const id = text(node.id, `${where} id`);
    if (!idPattern.test(id))
      fail(
        `${where} id ${id} must be one word of letters, digits, - or _, like s1`,
      );
    if (firstUse.has(id))
      fail(
        `${where} id ${id} is already used by node ${firstUse.get(id)! + 1}; give each node its own id`,
      );
    firstUse.set(id, i);
    return {
      id,
      text: text(node.text, `${where} text`),
      kind: oneOf(node.kind, kinds, `${where} kind`) ?? "box",
      tone: oneOf(node.tone, tones, `${where} tone`) ?? "plain",
      tag: node.tag === undefined ? "" : text(node.tag, `${where} tag`),
    };
  });
  const known = nodes.map((n) => n.id).join(", ");
  const node = (id: unknown, where: string) => {
    if (typeof id !== "string" || !firstUse.has(id))
      fail(
        `${where} names node ${String(id)}, which does not exist; the nodes are ${known}`,
      );
    return id;
  };

  const edges: FlowEdge[] = [];
  const edgeLocations: string[] = [];
  const seen = new Set<string>();
  const add = (edge: FlowEdge, where: string) => {
    const key = `${edge.from} > ${edge.to}`;
    if (seen.has(key)) fail(`${where} repeats the edge ${key}`);
    seen.add(key);
    edges.push(edge);
    edgeLocations.push(where);
  };
  list(input.edges, "flow edges").forEach((item, i) => {
    const where = `flow edge ${i + 1}`;
    if (typeof item === "string") {
      const ids = item.split(">").map((part) => part.trim());
      if (ids.length < 2 || ids.some((id) => !id || /\s/.test(id)))
        fail(
          `${where} "${item}" must be node ids joined by " > ", like "a > b > c"`,
        );
      ids.slice(1).forEach((to, j) =>
        add(
          {
            from: node(ids[j], where),
            to: node(to, where),
            text: "",
            dashed: false,
            side: false,
          },
          where,
        ),
      );
      return;
    }
    if (!isObject(item))
      fail(`${where} must be a chain "a > b" or {from: a, to: b}`);
    const edge = only(item, ["from", "to", "text", "dashed", "side"], where);
    const froms = Array.isArray(edge.from) ? edge.from : [edge.from];
    if (!froms.length) fail(`${where} from must name at least one node`);
    const label =
      edge.text === undefined ? "" : text(edge.text, `${where} text`);
    const side = flag(edge.side, `${where} side`);
    if (froms.length > 1 && (label || side))
      fail(
        `${where} joins several nodes, so it takes no text or side; write one edge per node instead`,
      );
    for (const from of froms)
      add(
        {
          from: node(from, where),
          to: node(edge.to, where),
          text: label,
          dashed: flag(edge.dashed, `${where} dashed`),
          side,
        },
        where,
      );
  });

  for (const n of nodes)
    if (!edges.some((e) => e.from === n.id || e.to === n.id))
      fail(`flow node ${n.id} has no edge; connect it or remove it`);
  for (const e of edges.filter((e) => e.side))
    if (edges.some((o) => o !== e && (o.to === e.to || o.from === e.to)))
      fail(
        `flow node ${e.to} hangs beside ${e.from} by a side edge, so it takes no other edges; drop side to put it on the main line`,
      );
  const cycle = findCycle(nodes, edges);
  if (cycle)
    fail(
      `flow edges run in a circle: ${cycle.join(" > ")}; a flow runs one way, so drop or reverse one of these edges`,
    );

  inferFlowSides(nodes, edges);
  const flow: Flow = {
    nodes,
    edges,
    direction:
      oneOf(input.direction, ["right", "down"], "flow direction") ?? "auto",
    over: input.over === undefined ? "" : text(input.over, "flow over"),
    note: input.note === undefined ? "" : text(input.note, "flow note"),
  };
  const analysis = analyzeFlow(flow);
  if (analysis.deepest > 4)
    fail(
      `flow branches nest ${analysis.deepest} levels deep; a narrow page reads at most 4, so split the figure`,
    );
  edges.forEach((edge, i) => {
    if (
      edges.filter((e) => e.from === edge.from).length > 1 &&
      [...edge.text].length > 16
    )
      fail(
        `${edgeLocations[i]} text is longer than 16 characters; move the condition into the ask node`,
      );
  });
  return flow;
}

/** The ids around a cycle, first id repeated at the end, or null. */
function findCycle(nodes: FlowNode[], edges: FlowEdge[]): string[] | null {
  const state = new Map<string, "open" | "done">();
  const path: string[] = [];
  const visit = (id: string): string[] | null => {
    if (state.get(id) === "done") return null;
    if (state.get(id) === "open") return [...path.slice(path.indexOf(id)), id];
    state.set(id, "open");
    path.push(id);
    for (const e of edges.filter((e) => e.from === id)) {
      const found = visit(e.to);
      if (found) return found;
    }
    path.pop();
    state.set(id, "done");
    return null;
  };
  for (const n of nodes) {
    const found = visit(n.id);
    if (found) return found;
  }
  return null;
}

/** The words a reader can search for in a flow. */
export function flowText(flow: Flow): string[] {
  return [
    flow.over,
    ...flow.nodes.flatMap((n) => [n.tag, n.text]),
    ...flow.edges.map((e) => e.text),
    flow.note,
  ].filter(Boolean);
}

// Layout. Main nodes sit in ranks along the flow's direction (the main axis):
// each node one rank after its furthest predecessor. Within a rank they are
// ordered to cross few edges and placed on the cross axis near the nodes they
// connect to. A side node hangs after its source on the cross axis. An edge
// that skips ranks passes them as a thread between the nodes there.

export interface FlowSize {
  /** The node's width and height, its tag included. */
  w: number;
  h: number;
  /** The height of the tag above the box. */
  tag: number;
}
export interface FlowSpacing {
  /** Between ranks, before room for edge text. */
  rank: number;
  /** Between neighbours in a rank. */
  cross: number;
  /** Between a node and the side node beside it. */
  side: number;
  /** Around edge text. */
  pad: number;
  /** Room a thread takes where an edge passes a rank. */
  thread: number;
}
export type Point = [number, number];
export interface FlowLayout {
  width: number;
  height: number;
  /** Top-left and width of each node, by node index. */
  nodes: { x: number; y: number; w: number }[];
  /** By edge index: the path ending at the arrow tip, and its text's top-left. */
  edges: {
    points: Point[];
    label: { x: number; y: number } | null;
    arrow?: boolean;
  }[];
}

interface Vertex {
  rank: number;
  /** The node; a thread when undefined. */
  node?: number;
  /** Cross extent before and after the anchor, side nodes included. */
  before: number;
  after: number;
  pos: number;
}

/**
 * Edges by node index, split into main and side edges, the side nodes, and
 * each main node's rank: one after its furthest predecessor, and a node with
 * no predecessor just before its nearest successor.
 */
function structure(flow: Flow) {
  const index = new Map(flow.nodes.map((n, i) => [n.id, i]));
  const edges = flow.edges.map((e, i) => ({
    ...e,
    i,
    a: index.get(e.from)!,
    b: index.get(e.to)!,
  }));
  const mainEdges = edges.filter((e) => !e.side);
  const sideEdges = edges.filter((e) => e.side);
  const satellite = new Set(sideEdges.map((e) => e.b));
  const rank = flow.nodes.map(() => 0);
  const order = topological(flow.nodes.length, mainEdges);
  for (const n of order)
    for (const e of mainEdges)
      if (e.a === n) rank[e.b] = Math.max(rank[e.b], rank[n] + 1);
  for (const n of [...order].reverse()) {
    const next = mainEdges.filter((e) => e.a === n).map((e) => rank[e.b]);
    if (next.length && !mainEdges.some((e) => e.b === n))
      rank[n] = Math.min(...next) - 1;
  }
  return { mainEdges, sideEdges, satellite, rank };
}

/** Positions minimising squared distance to `want`, in order, `gap[i]` apart at least. */
function packInOrder(want: number[], gap: number[]): number[] {
  const offset = [0];
  for (let i = 1; i < want.length; i++) offset.push(offset[i - 1] + gap[i - 1]);
  // Pool adjacent violators on want - offset, which must not decrease.
  const blocks: { sum: number; count: number }[] = [];
  want.forEach((w, i) => {
    blocks.push({ sum: w - offset[i], count: 1 });
    while (
      blocks.length > 1 &&
      blocks.at(-2)!.sum / blocks.at(-2)!.count >
        blocks.at(-1)!.sum / blocks.at(-1)!.count
    ) {
      const last = blocks.pop()!;
      blocks.at(-1)!.sum += last.sum;
      blocks.at(-1)!.count += last.count;
    }
  });
  return blocks
    .flatMap((b) => Array.from({ length: b.count }, () => b.sum / b.count))
    .map((y, i) => y + offset[i]);
}

export function layoutFlow(
  flow: Flow,
  direction: FlowDirection,
  sizes: FlowSize[],
  labels: ({ w: number; h: number } | null)[],
  space: FlowSpacing,
): FlowLayout {
  const right = direction === "right";
  // Sizes on the main and cross axes, and where the box starts on each.
  const main = (i: number) => (right ? sizes[i].w : sizes[i].h);
  const boxMainStart = (i: number) => (right ? 0 : sizes[i].tag);
  const boxMainMid = (i: number) => (boxMainStart(i) + main(i)) / 2;
  const crossBefore = (i: number) =>
    right ? sizes[i].tag + (sizes[i].h - sizes[i].tag) / 2 : sizes[i].w / 2;
  const crossAfter = (i: number) =>
    right ? (sizes[i].h - sizes[i].tag) / 2 : sizes[i].w / 2;
  const labelMain = (e: number) => (right ? labels[e]!.w : labels[e]!.h);
  const labelCross = (e: number) => (right ? labels[e]!.h : labels[e]!.w);

  const { mainEdges, sideEdges, satellite, rank } = structure(flow);
  const sideGap = (e: number) =>
    labels[e]
      ? Math.max(
          space.side + (right ? 0 : 6),
          labelCross(e) + 2 * space.pad + (right ? 0 : 6),
        )
      : space.side + (right ? 0 : 6);
  const ranks =
    Math.max(0, ...flow.nodes.map((_, i) => (satellite.has(i) ? 0 : rank[i]))) +
    1;

  // Vertices: main nodes, then threads where an edge passes a rank.
  const vertices: Vertex[] = [];
  const vertexOf = new Map<number, number>();
  flow.nodes.forEach((_, i) => {
    if (satellite.has(i)) return;
    const after =
      crossAfter(i) +
      sideEdges
        .filter((e) => e.a === i)
        .reduce(
          (sum, e) => sum + sideGap(e.i) + crossBefore(e.b) + crossAfter(e.b),
          0,
        );
    vertexOf.set(i, vertices.length);
    vertices.push({
      rank: rank[i],
      node: i,
      before: crossBefore(i),
      after,
      pos: 0,
    });
  });
  const chains = mainEdges.map((e) => {
    const chain = [vertexOf.get(e.a)!];
    for (let r = rank[e.a] + 1; r < rank[e.b]; r++) {
      chain.push(vertices.length);
      vertices.push({
        rank: r,
        before: space.thread / 2,
        after: space.thread / 2,
        pos: 0,
      });
    }
    chain.push(vertexOf.get(e.b)!);
    return chain;
  });
  const links = chains.flatMap((chain) =>
    chain.slice(1).map((v, j) => [chain[j], v] as const),
  );
  const layers: number[][] = Array.from({ length: ranks }, () => []);
  vertices.forEach((v, i) => layers[v.rank].push(i));

  // Order within ranks: barycentre sweeps, keeping the order with fewest crossings.
  const place = (layer: number[]) =>
    layer.forEach((v, i) => (vertices[v].pos = i));
  layers.forEach(place);
  const crossings = () => {
    let count = 0;
    links.forEach(([a1, b1], i) =>
      links.slice(i + 1).forEach(([a2, b2]) => {
        if (vertices[a1].rank !== vertices[a2].rank) return;
        const d =
          (vertices[a1].pos - vertices[a2].pos) *
          (vertices[b1].pos - vertices[b2].pos);
        if (d < 0) count++;
      }),
    );
    return count;
  };
  const neighbours = (v: number, before: boolean) =>
    links
      .filter(([a, b]) => (before ? b === v : a === v))
      .map(([a, b]) => vertices[before ? a : b].pos);
  const mean = (values: number[], fallback: number) =>
    values.length
      ? values.reduce((s, x) => s + x, 0) / values.length
      : fallback;
  let best = layers.map((l) => [...l]);
  let fewest = crossings();
  for (let round = 0; round < 8 && fewest > 0; round++) {
    const down = round % 2 === 0;
    const sweep = down ? layers.slice(1) : layers.slice(0, -1).reverse();
    for (const layer of sweep) {
      const key = new Map(
        layer.map((v) => [v, mean(neighbours(v, down), vertices[v].pos)]),
      );
      layer.sort((a, b) => key.get(a)! - key.get(b)!);
      place(layer);
    }
    const count = crossings();
    if (count < fewest) {
      fewest = count;
      best = layers.map((l) => [...l]);
    }
  }
  best.forEach((layer, r) => {
    layers[r] = layer;
    place(layer);
  });

  // Cross positions: each node near the mean of its neighbours, in order.
  const gaps = (layer: number[]) =>
    layer
      .slice(1)
      .map(
        (v, i) => vertices[layer[i]].after + space.cross + vertices[v].before,
      );
  const at = new Array<number>(vertices.length).fill(0);
  for (const layer of layers) {
    const packed = packInOrder(
      layer.map(() => 0),
      gaps(layer),
    );
    layer.forEach((v, i) => (at[v] = packed[i]));
  }
  for (let round = 0; round < 8; round++) {
    const down = round % 2 === 0;
    for (const layer of down ? layers : [...layers].reverse()) {
      const want = layer.map((v) =>
        mean(
          links
            .filter(([a, b]) => (down ? b === v : a === v))
            .map(([a, b]) => at[down ? a : b]),
          at[v],
        ),
      );
      const packed = packInOrder(want, gaps(layer));
      layer.forEach((v, i) => (at[v] = packed[i]));
    }
  }

  // Main positions: every box in a rank centred on one line.
  const above = new Array<number>(ranks).fill(0);
  const below = new Array<number>(ranks).fill(0);
  flow.nodes.forEach((_, i) => {
    if (satellite.has(i)) return;
    const own = [i, ...sideEdges.filter((e) => e.a === i).map((e) => e.b)];
    for (const n of own) {
      above[rank[i]] = Math.max(above[rank[i]], boxMainMid(n));
      below[rank[i]] = Math.max(below[rank[i]], main(n) - boxMainMid(n));
    }
  });
  // Edge text sits in the gap it labels, on the source's side unless the
  // source fans out to several nodes, where the shared stretch is its own.
  const fansOut = (a: number) => mainEdges.filter((e) => e.a === a).length > 1;
  const labelGap = mainEdges.map((e) =>
    fansOut(e.a) ? rank[e.b] - 1 : rank[e.a],
  );
  const gapSize = Array.from({ length: Math.max(ranks - 1, 0) }, (_, r) =>
    Math.max(
      space.rank,
      ...mainEdges
        .filter((e) => labels[e.i] && labelGap[mainEdges.indexOf(e)] === r)
        .map((e) => labelMain(e.i) + 2 * space.pad + space.rank / 2),
    ),
  );
  const centre = [above[0]];
  for (let r = 1; r < ranks; r++)
    centre.push(centre[r - 1] + below[r - 1] + gapSize[r - 1] + above[r]);
  const gapStart = (r: number) => centre[r] + below[r];
  const gapEnd = (r: number) => centre[r + 1] - above[r + 1];
  // Where edges crossing a gap turn: past the text on its side, else midway.
  const turn = gapSize.map((size, r) => {
    const texts = mainEdges.filter(
      (e) => labels[e.i] && labelGap[mainEdges.indexOf(e)] === r,
    );
    if (texts.some((e) => fansOut(e.a))) return gapStart(r) + space.rank / 2;
    if (texts.length) return gapEnd(r) - space.rank / 2;
    return gapStart(r) + size / 2;
  });

  // Node positions in (main, cross), then side nodes after their sources.
  const spot: { main: number; cross: number }[] = flow.nodes.map(() => ({
    main: 0,
    cross: 0,
  }));
  const anchor = new Array<number>(flow.nodes.length).fill(0);
  flow.nodes.forEach((_, i) => {
    if (satellite.has(i)) return;
    const v = vertexOf.get(i)!;
    anchor[i] = at[v];
    spot[i] = {
      main: centre[rank[i]] - boxMainMid(i),
      cross: at[v] - crossBefore(i),
    };
  });
  const sideLines: { points: Point[]; label: Point | null }[] = [];
  const sideLine = new Map<number, number>();
  flow.nodes.forEach((_, i) => {
    if (satellite.has(i)) return;
    let edge = anchor[i] + crossAfter(i);
    const mid = spot[i].main + boxMainMid(i);
    for (const e of sideEdges.filter((e) => e.a === i)) {
      const gap = sideGap(e.i);
      spot[e.b] = { main: mid - boxMainMid(e.b), cross: edge + gap };
      anchor[e.b] = edge + gap + crossBefore(e.b);
      const tip = edge + gap + (right ? sizes[e.b].tag : 0);
      sideLine.set(e.i, sideLines.length);
      sideLines.push({
        points: [
          [mid, edge],
          [mid, tip],
        ],
        label: labels[e.i]
          ? [
              right ? mid + 6 : mid - 3 - labelMain(e.i),
              edge + (gap - (right ? 0 : 6) - labelCross(e.i)) / 2,
            ]
          : null,
      });
      edge = anchor[e.b] + crossAfter(e.b);
    }
  });

  // Main edges: out of the box end, across each gap, into the next box start.
  const mainLines = mainEdges.map((e, k) => {
    const chain = chains[k];
    const points: Point[] = [[spot[e.a].main + main(e.a), anchor[e.a]]];
    chain.slice(1).forEach((v, j) => {
      const r = rank[e.a] + j;
      const [, from] = points.at(-1)!;
      const to = at[v];
      if (Math.abs(from - to) > 0.5)
        points.push([turn[r], from], [turn[r], to]);
      if (vertices[v].node === undefined)
        points.push(
          [centre[r + 1] - above[r + 1], to],
          [centre[r + 1] + below[r + 1], to],
        );
      else points.push([spot[e.b].main + boxMainStart(e.b), to]);
    });
    let label: Point | null = null;
    if (labels[e.i]) {
      const r = labelGap[k];
      const own = fansOut(e.a);
      const line = own ? anchor[e.b] : anchor[e.a];
      // Clear of the turn, where other edges in the gap run across.
      const [lo, hi] = own ? [turn[r], gapEnd(r)] : [gapStart(r), turn[r]];
      label = [
        (lo + hi - labelMain(e.i)) / 2,
        right ? line - 3 - labelCross(e.i) : line + 6,
      ];
    }
    return { points, label };
  });

  // To x/y, shifted so everything starts at 0.
  const xy = ([m, c]: Point): Point => (right ? [m, c] : [c, m]);
  const nodes = spot.map((s) => xy([s.main, s.cross]));
  const edges = flow.edges.map((e, i) => {
    const line = e.side
      ? sideLines[sideLine.get(i)!]
      : mainLines[mainEdges.findIndex((m) => m.i === i)];
    return {
      points: line.points.map(xy),
      label: line.label ? xy(line.label) : null,
    };
  });
  const xs: number[] = [];
  const ys: number[] = [];
  nodes.forEach(([x, y], i) => {
    xs.push(x, x + sizes[i].w);
    ys.push(y, y + sizes[i].h);
  });
  edges.forEach((e, i) => {
    for (const [x, y] of e.points) (xs.push(x), ys.push(y));
    if (e.label)
      (xs.push(e.label[0], e.label[0] + labels[i]!.w),
        ys.push(e.label[1], e.label[1] + labels[i]!.h));
  });
  const [x0, y0] = [Math.min(...xs), Math.min(...ys)];
  return {
    width: Math.max(...xs) - x0,
    height: Math.max(...ys) - y0,
    nodes: nodes.map(([x, y], i) => ({ x: x - x0, y: y - y0, w: sizes[i].w })),
    edges: edges.map((e) => ({
      points: e.points.map(([x, y]): Point => [x - x0, y - y0]),
      label: e.label ? { x: e.label[0] - x0, y: e.label[1] - y0 } : null,
    })),
  };
}

// Wrapped: a chain too long for one row runs in rows left to right, as text
// does; an arrow bends from the end of each row to the start of the next.

/** The nodes of a flow that is one chain, in order; null for any other flow. */
export function chainOrder(flow: Flow): number[] | null {
  const { mainEdges, sideEdges } = structure(flow);
  if (sideEdges.length || mainEdges.length !== flow.nodes.length - 1)
    return null;
  const next = new Map(mainEdges.map((e) => [e.a, e.b]));
  const start = flow.nodes.findIndex(
    (_, i) => !mainEdges.some((e) => e.b === i),
  );
  const order = [start];
  while (next.has(order.at(-1)!)) order.push(next.get(order.at(-1)!)!);
  return order.length === flow.nodes.length ? order : null;
}

/** Room a wrapped chain needs across besides its boxes: gaps between columns and the bends' margins. */
export function wrapRoom(
  flow: Flow,
  columns: number,
  labels: ({ w: number; h: number } | null)[],
  space: FlowSpacing,
) {
  return (
    wrapGaps(flow, columns, labels, space).reduce((a, b) => a + b, 0) +
    (columns < flow.nodes.length ? space.rank : 0)
  );
}

/** The gap after each column but the last, wide enough for the text of every edge across it. */
function wrapGaps(
  flow: Flow,
  columns: number,
  labels: ({ w: number; h: number } | null)[],
  space: FlowSpacing,
) {
  const order = chainOrder(flow)!;
  const gaps = new Array<number>(columns - 1).fill(space.rank);
  order.slice(1).forEach((b, k) => {
    const column = k % columns;
    const i = flow.edges.findIndex(
      (e) => e.from === flow.nodes[order[k]].id && e.to === flow.nodes[b].id,
    );
    if (column < columns - 1 && labels[i])
      gaps[column] = Math.max(gaps[column], labels[i]!.w + 2 * space.pad);
  });
  return gaps;
}

export function wrapFlow(
  flow: Flow,
  columns: number,
  width: number,
  sizes: FlowSize[],
  labels: ({ w: number; h: number } | null)[],
  space: FlowSpacing,
): FlowLayout {
  const order = chainOrder(flow)!;
  const gaps = wrapGaps(flow, columns, labels, space);
  const wraps = columns < order.length;
  // The bends run down outside the rows, half a rank gap either side.
  const margin = wraps ? space.rank / 2 : 0;
  const left = (column: number) =>
    margin + column * width + gaps.slice(0, column).reduce((a, b) => a + b, 0);
  const rows: number[][] = [];
  order.forEach((n, k) =>
    k % columns ? rows.at(-1)!.push(n) : rows.push([n]),
  );
  const nodes = flow.nodes.map(() => ({ x: 0, y: 0, w: width }));
  const centre = new Array<number>(flow.nodes.length).fill(0);
  let y = 0;
  for (const row of rows) {
    // Boxes in a row share a centre line; tags stand above their boxes.
    const above = Math.max(
      ...row.map((n) => sizes[n].tag + (sizes[n].h - sizes[n].tag) / 2),
    );
    const below = Math.max(...row.map((n) => (sizes[n].h - sizes[n].tag) / 2));
    row.forEach((n, column) => {
      centre[n] = y + above;
      nodes[n] = {
        x: left(column),
        y: y + above - sizes[n].tag - (sizes[n].h - sizes[n].tag) / 2,
        w: width,
      };
    });
    y += above + below + space.rank;
  }
  const height = y - space.rank;
  const total = left(columns - 1) + width + margin;
  const edges = flow.edges.map((edge, i) => {
    const a = flow.nodes.findIndex((n) => n.id === edge.from);
    const b = flow.nodes.findIndex((n) => n.id === edge.to);
    const label = labels[i];
    const out: Point = [nodes[a].x + width, centre[a]];
    const into: Point = [nodes[b].x, centre[b]];
    const row = (n: number) => Math.floor(order.indexOf(n) / columns);
    if (row(a) === row(b))
      return {
        points: [out, into],
        label: label
          ? {
              x: (out[0] + into[0] - label.w) / 2,
              y: centre[a] - 3 - label.h,
            }
          : null,
      };
    // From the end of a row: out, down past the row, back to the start of the next.
    const turn =
      Math.max(
        ...rows
          .find((row) => row.includes(a))!
          .map((n) => nodes[n].y + sizes[n].h),
      ) +
      space.rank / 2;
    const points: Point[] = [
      out,
      [total - margin / 2, centre[a]],
      [total - margin / 2, turn],
      [margin / 2, turn],
      [margin / 2, centre[b]],
      into,
    ];
    return {
      points,
      label: label ? { x: (total - label.w) / 2, y: turn - 3 - label.h } : null,
    };
  });
  return { width: total, height, nodes, edges };
}

// Folded: one column for a narrow page. The main line runs down a rail at
// the left; side nodes and nodes off the main line (an aligned column of
// examples) sit under the main node of their rank, indented. Edges among
// the nodes off the main line run down a rail at the right.

/** The main line of a flow that folds: the first node's nodes, one per rank, linked rank to rank. */
function mainLine(flow: Flow) {
  const { mainEdges, satellite, rank } = structure(flow);
  const first = flow.nodes.findIndex((_, i) => !satellite.has(i));
  const line = new Set([first]);
  for (let grown = true; grown;) {
    grown = false;
    for (const e of mainEdges)
      if (line.has(e.a) !== line.has(e.b)) {
        line.add(e.a).add(e.b);
        grown = true;
      }
  }
  const ranks = [...line].map((n) => rank[n]);
  const fits =
    new Set(ranks).size === ranks.length &&
    mainEdges.every((e) => !line.has(e.a) || rank[e.b] - rank[e.a] === 1);
  return fits ? [...line].sort((a, b) => rank[a] - rank[b]) : null;
}

/** Whether a flow has nodes to fold under its main line, and a main line to fold them under. */
export function foldable(flow: Flow): boolean {
  const line = mainLine(flow);
  return !!line && line.length < flow.nodes.length;
}

/** Whether the folded flow needs the right-hand rail. */
export function foldRail(flow: Flow): boolean {
  const line = new Set(mainLine(flow) ?? []);
  const { mainEdges } = structure(flow);
  return mainEdges.some((e) => !line.has(e.a));
}

export function foldFlow(
  flow: Flow,
  width: number,
  sizes: FlowSize[],
  labels: ({ w: number; h: number } | null)[],
  space: FlowSpacing,
): FlowLayout {
  const line = mainLine(flow)!;
  const { sideEdges, satellite, rank } = structure(flow);
  const indent = space.side;
  const rail = space.cross;
  const onLine = new Set(line);
  // Each node off the line goes under the line's node of its rank, or the
  // nearest one before it.
  const host = (n: number) =>
    [...line].reverse().find((p) => rank[p] <= rank[n]) ?? line[0];
  const items: { node: number; depth: number }[] = [];
  const withSides = (node: number, depth: number) => {
    items.push({ node, depth });
    for (const e of sideEdges.filter((e) => e.a === node))
      items.push({ node: e.b, depth: depth + 1 });
  };
  for (const p of line) {
    withSides(p, 0);
    flow.nodes.forEach((_, n) => {
      if (!onLine.has(n) && !satellite.has(n) && host(n) === p) withSides(n, 1);
    });
  }
  // Room above a node for the text of the edge coming down into it.
  const textAbove = (n: number) => {
    const i = flow.edges.findIndex(
      (e, j) => e.to === flow.nodes[n].id && labels[j],
    );
    return i < 0 ? 0 : labels[i]!.h + space.pad;
  };
  const nodes = flow.nodes.map(() => ({ x: 0, y: 0, w: 0 }));
  let y = 0;
  items.forEach(({ node, depth }, k) => {
    if (k)
      y +=
        (depth ? 2 * space.pad : space.rank) +
        (depth && !satellite.has(node) ? 0 : textAbove(node));
    nodes[node] = { x: depth * indent, y, w: width - depth * indent };
    y += sizes[node].h;
  });
  const top = (n: number) => nodes[n].y + sizes[n].tag;
  const bottom = (n: number) => nodes[n].y + sizes[n].h;
  const mid = (n: number) => (top(n) + bottom(n)) / 2;
  const right = width + rail / 2;
  const edges = flow.edges.map((edge, i) => {
    const a = flow.nodes.findIndex((n) => n.id === edge.from);
    const b = flow.nodes.findIndex((n) => n.id === edge.to);
    const label = labels[i];
    if (edge.side) {
      const x = nodes[a].x + indent / 2;
      return {
        points: [
          [x, bottom(a)],
          [x, mid(b)],
          [nodes[b].x, mid(b)],
        ] as Point[],
        label: label
          ? { x: x + 6, y: nodes[b].y - label.h - space.pad / 2 }
          : null,
      };
    }
    if (onLine.has(a)) {
      const x = indent / 2;
      return {
        points: [
          [x, bottom(a)],
          [x, top(b)],
        ] as Point[],
        label: label
          ? { x: x + 6, y: nodes[b].y - label.h - space.pad / 2 }
          : null,
      };
    }
    return {
      points: [
        [width, mid(a)],
        [right, mid(a)],
        [right, mid(b)],
        [width, mid(b)],
      ] as Point[],
      label: label
        ? {
            x: width - label.w - 6,
            y: (mid(a) + mid(b) - label.h) / 2,
          }
        : null,
    };
  });
  return {
    width: foldRail(flow) ? width + rail : width,
    height: y,
    nodes,
    edges,
  };
}

function topological(count: number, edges: { a: number; b: number }[]) {
  const incoming = new Array<number>(count).fill(0);
  for (const e of edges) incoming[e.b]++;
  const ready = incoming.flatMap((n, i) => (n ? [] : [i]));
  const order: number[] = [];
  while (ready.length) {
    const n = ready.shift()!;
    order.push(n);
    for (const e of edges)
      if (e.a === n && --incoming[e.b] === 0) ready.push(e.b);
  }
  return order;
}

function inferFlowSides(nodes: FlowNode[], edges: FlowEdge[]) {
  for (const node of nodes) {
    const out = edges.filter((e) => e.from === node.id);
    if (out.length < 2 || out.some((e) => e.side)) continue;
    const leaves = out.filter(
      (e) =>
        !edges.some((other) => other.from === e.to) &&
        edges.filter((other) => other.to === e.to).length === 1,
    );
    if (out.length - leaves.length === 1)
      for (const edge of leaves) {
        edge.side = true;
        edge.inferred = true;
      }
  }
}

interface BranchEdge extends FlowEdge {
  a: number;
  b: number;
  i: number;
}
interface BranchEnd {
  n: number;
  edge: BranchEdge;
}
interface BranchSeq {
  items: BranchItem[];
  ends: BranchEnd[];
  roots?: { branches: BranchSeq[]; ends: BranchEnd[] };
}
interface BranchItem {
  n: number;
  exits: BranchEdge[];
  next: BranchEdge | null;
  fork: {
    branches: { edge: BranchEdge; direct: boolean; seq: BranchSeq }[];
    join: number | null;
  } | null;
  joinEnds: BranchEnd[] | null;
}
export interface FlowAnalysis {
  shape: "spine" | "tree" | "merge";
  seqs: BranchSeq[];
  mOut: (i: number) => BranchEdge[];
  all: (i: number) => BranchEdge[];
  deepest: number;
  hasJoin: boolean;
}
export function analyzeFlow(flow: Flow): FlowAnalysis {
  const nodes = flow.nodes;
  const index = new Map(nodes.map((n, i) => [n.id, i]));
  const edges: BranchEdge[] = flow.edges.map((e, i) => ({
    ...e,
    i,
    a: index.get(e.from)!,
    b: index.get(e.to)!,
  }));
  const N = nodes.length;
  const out = (i: number) => edges.filter((e) => e.a === i);
  const main = edges.filter((e) => !e.side);
  const mOut = (i: number) => main.filter((e) => e.a === i);
  const mIn = (i: number) => main.filter((e) => e.b === i);
  const sOut = (i: number) => edges.filter((e) => e.side && e.a === i);
  const sat = new Set(edges.filter((e) => e.side).map((e) => e.b));
  const ids = [...Array(N).keys()];
  const merges = ids.filter((i: number) => mIn(i).length >= 2);
  const forks = ids.filter((i: number) => mOut(i).length >= 2);
  const shape: FlowAnalysis["shape"] = merges.length
    ? "merge"
    : forks.length
      ? "tree"
      : "spine";
  // Topological order for picking the earliest join.
  const topo = topological(N, main);
  const order = new Map(topo.map((n, k) => [n, k]));
  const reach = (start: number, stop: number | null) => {
    const seen = new Set([start]);
    const queue = [start];
    while (queue.length) {
      const n = queue.shift()!;
      if (n === stop) continue;
      for (const e of mOut(n))
        if (!seen.has(e.b)) {
          seen.add(e.b);
          queue.push(e.b);
        }
    }
    return seen;
  };
  const findJoin = (starts: number[], stop: number | null) => {
    const count = new Map<number, number>();
    for (const start of starts)
      for (const n of reach(start, stop)) count.set(n, (count.get(n) || 0) + 1);
    const shared = [...count].filter(([, c]) => c >= 2).map(([n]) => n);
    if (!shared.length) return null;
    return shared.sort((x, y) => order.get(x)! - order.get(y)!)[0];
  };
  const visited = new Set<number>();
  let deepest = 0;
  function buildSeq(
    start: number,
    stop: number | null,
    depth: number,
  ): BranchSeq {
    const items: BranchItem[] = [];
    let ends: BranchEnd[] = [];
    let u = start;
    for (;;) {
      if (visited.has(u))
        fail(
          `flow node ${nodes[u].id} is reached from two branches that do not start at one fork; join branches only where they split, or split the figure`,
        );
      visited.add(u);
      deepest = Math.max(deepest, depth);
      for (const e of sOut(u)) {
        visited.add(e.b);
        deepest = Math.max(deepest, depth + 1);
      }
      const item: BranchItem = {
        n: u,
        exits: sOut(u),
        next: null,
        fork: null,
        joinEnds: null,
      };
      items.push(item);
      const o = mOut(u);
      if (!o.length) break;
      if (o.length === 1) {
        if (o[0].b === stop) {
          ends = [{ n: u, edge: o[0] }];
          break;
        }
        item.next = o[0];
        u = o[0].b;
        continue;
      }
      const join = findJoin(
        o.map((e) => e.b),
        stop,
      );
      const branches = o.map((e) => {
        if (e.b === join)
          return { edge: e, direct: true, seq: { items: [], ends: [] } };
        return { edge: e, direct: false, seq: buildSeq(e.b, join, depth + 1) };
      });
      item.fork = { branches, join };
      const joinEnds = branches.flatMap((b) =>
        b.direct ? [{ n: u, edge: b.edge }] : b.seq.ends,
      );
      if (join === null) break;
      if (join === stop) {
        ends = joinEnds;
        break;
      }
      item.joinEnds = joinEnds;
      u = join;
    }
    return { items, ends };
  }
  const roots = ids.filter((i: number) => !sat.has(i) && !mIn(i).length);
  const seqs: BranchSeq[] = [];
  const remaining = new Set(roots);
  for (const root of roots) {
    if (!remaining.has(root)) continue;
    // Roots in the same connected component share an invisible fork. Separate
    // components keep their aligned-column semantics.
    const component = new Set([root]);
    const queue = [root];
    while (queue.length) {
      const n = queue.shift()!;
      for (const e of main) {
        const other = e.a === n ? e.b : e.b === n ? e.a : null;
        if (other !== null && !component.has(other)) {
          component.add(other);
          queue.push(other);
        }
      }
    }
    const inputs = roots.filter((n) => component.has(n));
    inputs.forEach((n) => remaining.delete(n));
    if (inputs.length === 1) seqs.push(buildSeq(root, null, 0));
    else {
      const join = findJoin(inputs, null)!;
      const branches = inputs.map((n) => buildSeq(n, join, 0));
      const continuation = buildSeq(join, null, 0);
      continuation.roots = {
        branches,
        ends: branches.flatMap((seq) => seq.ends),
      };
      seqs.push(continuation);
    }
  }
  return {
    shape,
    seqs,
    mOut,
    all: (i: number) => out(i),
    deepest,
    hasJoin: merges.length > 0,
  };
}

export type FlowMode = "down" | "right" | "outline";
export interface FlowMeasure {
  node: (i: number, width: number) => { h: number; tag: number };
  label: (
    i: number,
    mode: "beside" | "on" | "strip",
    maxWidth?: number,
  ) => { w: number; h: number };
}
interface BranchNode extends FlowSize {
  i: number;
  x: number;
  y: number;
}
interface BranchLabel {
  e: number;
  x: number;
  y: number;
  w: number;
  h: number;
  on: boolean;
}
interface BranchLine {
  e: number;
  pts: Point[];
  arrow?: boolean;
}
interface BranchJoin {
  ends: BranchEnd[];
  x: number;
  barY: number;
  toY: number;
  to?: number;
}
interface BranchBlock {
  nodes: BranchNode[];
  lines: BranchLine[];
  labels: BranchLabel[];
  joins: BranchJoin[];
  departures: BranchLine[];
  l: number;
  r: number;
  y0: number;
  y1: number;
  mainBottom: number;
  entryTag: number;
  width: number;
  height: number;
}
export interface BranchLayout extends FlowLayout {
  mode: FlowMode;
  nodes: BranchNode[];
  edges: { points: Point[]; label: BranchLabel | null; arrow: boolean }[];
}

/** Lay out branches at measured reading sizes, preserving the chain renderer. */
export function layoutBranches(
  flow: Flow,
  A: FlowAnalysis,
  M: FlowMeasure,
  W: number,
  em = 14,
): BranchLayout {
  const EM = em;
  const S = {
    rank: 2 * em,
    cross: 1.4 * em,
    side: 1.6 * em,
    pad: 0.4 * em,
    arrow: 6,
    bus: em,
    leafGap: 0.6 * em,
    groupGap: 1.2 * em,
    step: 1.75 * em,
    rail: 1.25 * em,
    contGap: 1.6 * em,
    elbowGap: 0.55 * em,
    narrow: 34 * em,
  };
  const WIDE = {
    down: [15, 14, 13, 12, 11, 10],
    right: [
      [11, 13],
      [10, 12],
      [9, 12],
      [9, 11],
      [8.5, 10],
    ],
  };

  interface RightSubtree {
    placed: BranchNode[];
    lines: BranchLine[];
    labels: BranchLabel[];
    top: number;
    bottom: number;
    entry: number;
    mid: number;
    move: (dy: number) => void;
  }
  type Incoming =
    | { kind: "cont" | "elbow"; edge: BranchEdge; x: number; from: number }
    | { kind: "rail"; ends: BranchEnd[] };
  // Shared output helpers.
  const empty = (): BranchBlock => ({
    nodes: [],
    lines: [],
    labels: [],
    joins: [],
    departures: [],
    l: 0,
    r: 0,
    y0: 0,
    y1: 0,
    mainBottom: 0,
    entryTag: 0,
    width: 0,
    height: 0,
  });
  function shift(R: BranchBlock, dx: number, dy: number) {
    R.nodes.forEach((n) => {
      n.x += dx;
      n.y += dy;
    });
    [...R.lines, ...R.departures].forEach((l) =>
      l.pts.forEach((p) => {
        p[0] += dx;
        p[1] += dy;
      }),
    );
    R.labels.forEach((l) => {
      l.x += dx;
      l.y += dy;
    });
    R.joins.forEach((j) => {
      j.x += dx;
      j.barY += dy;
      j.toY += dy;
    });
  }
  function absorb(R: BranchBlock, B: BranchBlock) {
    R.nodes.push(...B.nodes);
    R.lines.push(...B.lines);
    R.labels.push(...B.labels);
    R.joins.push(...B.joins);
    R.departures.push(...B.departures);
  }
  const box = (n: BranchNode) => ({
    top: n.y + n.tag,
    bottom: n.y + n.h,
    mid: n.y + n.tag + (n.h - n.tag) / 2,
  });

  // Desktop, down: trunks run down; exits sit to the right; a fork lays its
  // branches side by side under a bus; a join collects them on a bar.
  function layoutDown(bw: number): BranchBlock {
    function nodeItem(it: BranchItem) {
      const s = M.node(it.n, bw);
      const R = empty();
      R.nodes.push({ i: it.n, x: -bw / 2, y: 0, w: bw, h: s.h, tag: s.tag });
      R.l = bw / 2;
      R.r = bw / 2;
      R.y0 = 0;
      R.y1 = s.h;
      R.mainBottom = s.h;
      const mid = s.tag + (s.h - s.tag) / 2;
      let below = 0;
      it.exits.forEach((e, k) => {
        const lab = e.text ? M.label(e.i, "beside") : null;
        const gap = Math.max(
          S.side + S.arrow,
          lab ? lab.w + 2 * S.pad + S.arrow : 0,
        );
        const es = M.node(e.b, bw);
        const x = bw / 2 + gap;
        const emid = es.tag + (es.h - es.tag) / 2;
        const y = k === 0 ? mid - emid : below + S.leafGap;
        R.nodes.push({ i: e.b, x, y, w: bw, h: es.h, tag: es.tag });
        const ty = y + emid;
        const turn = bw / 2 + S.pad * 2;
        R.lines.push({
          e: e.i,
          pts:
            k === 0
              ? [
                  [bw / 2, mid],
                  [x, mid],
                ]
              : [
                  [bw / 2, mid],
                  [turn, mid],
                  [turn, ty],
                  [x, ty],
                ],
        });
        if (lab)
          R.labels.push({
            e: e.i,
            x: k === 0 ? bw / 2 + (gap - S.arrow - lab.w) / 2 : turn + S.pad,
            y: ty - 3 - lab.h,
            w: lab.w,
            h: lab.h,
            on: false,
          });
        below = y + es.h;
        R.r = Math.max(R.r, x + bw);
        R.y0 = Math.min(R.y0, y);
        R.y1 = Math.max(R.y1, y + es.h);
      });
      return R;
    }
    function forkItem(it: BranchItem) {
      const R = nodeItem(it);
      const busY = R.mainBottom + S.rank / 2;
      const brs = it.fork!.branches.map((b) => {
        return {
          b,
          B: b.direct ? empty() : blockSeq(b.seq),
          lab: b.edge.text ? M.label(b.edge.i, "on") : null,
        };
      });
      const drop = Math.max(
        S.rank / 2 + S.arrow,
        ...brs.map((x) => (x.lab ? x.lab.h + 2 * S.pad + S.arrow + 4 : 0)),
      );
      const px = [0];
      for (let k = 1; k < brs.length; k++)
        px.push(px[k - 1] + brs[k - 1].B.r + S.cross + brs[k].B.l);
      const c = (px[0] + px.at(-1)!) / 2;
      brs.forEach((x, k) => {
        const X = px[k] - c;
        const top = busY + drop;
        shift(x.B, X, top);
        absorb(R, x.B);
        if (x.b.direct)
          R.departures.push({
            e: x.b.edge.i,
            pts: [
              [0, R.mainBottom],
              [0, busY],
              [X, busY],
              [X, top],
            ],
          });
        if (!x.b.direct)
          R.lines.push({
            e: x.b.edge.i,
            pts: [
              [0, R.mainBottom],
              [0, busY],
              [X, busY],
              [X, top + x.B.entryTag],
            ],
          });
        if (x.lab)
          R.labels.push({
            e: x.b.edge.i,
            x: X - x.lab.w / 2,
            y: busY + (drop - S.arrow - x.lab.h) / 2,
            w: x.lab.w,
            h: x.lab.h,
            on: true,
          });
        R.l = Math.max(R.l, x.B.l - X);
        R.r = Math.max(R.r, x.B.r + X);
        R.y1 = Math.max(R.y1, x.B.y1 + top);
      });
      return R;
    }
    function blockSeq(seq: BranchSeq) {
      const R = empty();
      let prev: {
        next: BranchEdge | null;
        joinEnds: BranchEnd[] | null;
        bottom: number;
      } | null = null;
      if (seq.roots) {
        const blocks = seq.roots.branches.map(blockSeq);
        const positions = [0];
        for (let k = 1; k < blocks.length; k++)
          positions.push(
            positions[k - 1] + blocks[k - 1].r + S.cross + blocks[k].l,
          );
        const centre = (positions[0] + positions.at(-1)!) / 2;
        blocks.forEach((B, k) => {
          const x = positions[k] - centre;
          shift(B, x, -B.y0);
          absorb(R, B);
          R.l = Math.max(R.l, B.l - x);
          R.r = Math.max(R.r, B.r + x);
          R.y1 = Math.max(R.y1, B.y1 - B.y0);
        });
        prev = { next: null, joinEnds: seq.roots.ends, bottom: R.y1 };
      }
      seq.items.forEach((it, k) => {
        const B = it.fork ? forkItem(it) : nodeItem(it);
        let dy = 0;
        if (prev) {
          if (prev.joinEnds) {
            const labelRoom = Math.max(
              0,
              ...prev.joinEnds.map((end) =>
                end.edge.text
                  ? M.label(end.edge.i, "beside").h + 2 * S.pad + 4
                  : 0,
              ),
            );
            const barY = R.y1 + Math.max(S.rank / 2, labelRoom);
            dy = Math.max(barY + S.rank / 2 + S.arrow, R.y1 + S.rank - B.y0);
            R.joins.push({
              ends: prev!.joinEnds,
              x: 0,
              barY,
              toY: dy + B.nodes[0].tag,
            });
          } else {
            const lab = prev!.next!.text
              ? M.label(prev!.next!.i, "beside")
              : null;
            const need = Math.max(
              S.rank,
              lab ? lab.h + 2 * S.pad + S.arrow + 4 : 0,
            );
            dy = Math.max(prev!.bottom + need, R.y1 + S.pad * 2 - B.y0);
            R.lines.push({
              e: prev!.next!.i,
              pts: [
                [0, prev!.bottom],
                [0, dy + B.nodes[0].tag],
              ],
            });
            if (lab)
              R.labels.push({
                e: prev!.next!.i,
                x: 6,
                y: prev!.bottom + S.pad,
                w: lab.w,
                h: lab.h,
                on: false,
              });
          }
        }
        const mainBottom = B.mainBottom + dy;
        shift(B, 0, dy);
        absorb(R, B);
        R.l = Math.max(R.l, B.l);
        R.r = Math.max(R.r, B.r);
        if (!k && !seq.roots) R.y0 = B.y0 + dy;
        R.y1 = Math.max(R.y1, B.y1 + dy);
        prev = { next: it.next, joinEnds: it.joinEnds, bottom: mainBottom };
      });
      R.mainBottom = R.y1;
      R.entryTag = R.nodes.length ? R.nodes[0].tag : 0;
      return R;
    }
    const R = empty();
    let x = 0;
    for (const seq of A.seqs) {
      const B = blockSeq(seq);
      shift(B, x + B.l, -B.y0);
      absorb(R, B);
      x += B.l + B.r + S.side * 2;
      R.y1 = Math.max(R.y1, B.y1 - B.y0);
    }
    R.width = x - S.side * 2;
    R.height = R.y1;
    resolveJoins(R, "down");
    return R;
  }
  function resolveJoins(R: BranchBlock, mode: FlowMode, railX = 0) {
    const at = new Map(R.nodes.map((n) => [n.i, n]));
    for (const j of R.joins)
      for (const [k, end] of j.ends.entries()) {
        const n = at.get(end.n)!;
        const b = box(n);
        if (mode === "down") {
          const departure = R.departures.find((d) => d.e === end.edge.i)?.pts;
          const cx = departure?.at(-1)![0] ?? n.x + n.w / 2;
          if (
            end.edge.text &&
            !R.labels.some((label) => label.e === end.edge.i)
          ) {
            const label = M.label(end.edge.i, "beside");
            R.labels.push({
              e: end.edge.i,
              x: cx + 6,
              y: b.bottom + S.pad,
              ...label,
              on: false,
            });
          }
          R.lines.push({
            e: end.edge.i,
            arrow: k === 0,
            pts: [
              ...(departure ?? ([[cx, b.bottom]] as Point[])),
              [cx, j.barY],
              [j.x, j.barY],
              [j.x, j.toY],
            ],
          });
        } else {
          const t = at.get(j.to!)!;
          const tb = box(t);
          R.lines.push({
            e: end.edge.i,
            arrow: k === 0,
            pts: [
              [n.x + n.w, b.mid],
              [railX, b.mid],
              [railX, tb.mid],
              [t.x + t.w, tb.mid],
            ],
          });
        }
      }
  }

  // Desktop, right: a tree's columns advance at forks; a node with one child
  // keeps it below, in the same column.
  function layoutRight(wi: number, wl: number): BranchBlock {
    const kids = (u: number) => [...A.all(u)];
    const col = new Map<number, number>();
    let cols = 0;
    const assign = (u: number, c: number) => {
      col.set(u, c);
      cols = Math.max(cols, c + 1);
      const k = kids(u);
      k.forEach((e) => assign(e.b, k.length > 1 ? c + 1 : c));
    };
    const root = A.seqs[0].items[0].n;
    assign(root, 0);
    const isLeaf = (u: number) => !kids(u).length;
    const colW = Array.from({ length: cols }, (_, c) =>
      [...col].some(([u, cc]) => cc === c && !isLeaf(u)) ? wi : wl,
    );
    const gaps = Array.from({ length: Math.max(cols - 1, 0) }, (_, c) => {
      let w = 0;
      for (const [u, cc] of col)
        if (cc === c && kids(u).length > 1)
          for (const e of kids(u))
            if (e.text) w = Math.max(w, M.label(e.i, "on").w);
      return Math.max(2.5 * EM, S.bus + w + 2 * S.pad + S.arrow + 4);
    });
    const colX = [0];
    for (let c = 1; c < cols; c++)
      colX.push(colX[c - 1] + colW[c - 1] + gaps[c - 1]);
    const R = empty();
    R.width = colX.at(-1)! + colW.at(-1)!;
    // Returns {top, bottom, mid} with nodes placed relative to y=0.
    function lay(u: number): RightSubtree {
      const c = col.get(u)!;
      const w = colW[c];
      const s = M.node(u, w);
      const k = kids(u);
      const me = { i: u, x: colX[c], y: 0, w, h: s.h, tag: s.tag };
      const placed = [me];
      const lines: BranchLine[] = [];
      const labels: BranchLabel[] = [];
      let top = 0;
      let bottom = s.h;
      const midOf = (n: BranchNode) => n.y + n.tag + (n.h - n.tag) / 2;
      if (k.length === 1) {
        const L = k[0].text ? M.label(k[0].i, "beside") : null;
        const sub = lay(k[0].b);
        const gap = Math.max(
          S.rank,
          k[0].text ? L!.h + 2 * S.pad + S.arrow + 4 : 0,
        );
        const dy = s.h + gap - sub.top;
        sub.move(dy);
        placed.push(...sub.placed);
        lines.push(...sub.lines);
        labels.push(...sub.labels);
        const cx = me.x + w / 2;
        lines.push({
          e: k[0].i,
          pts: [
            [cx, s.h],
            [cx, sub.entry],
          ],
        });
        if (k[0].text)
          labels.push({
            e: k[0].i,
            x: cx + 6,
            y: s.h + S.pad,
            w: L!.w,
            h: L!.h,
            on: false,
          });
        top = Math.min(top, sub.top);
        bottom = Math.max(bottom, sub.bottom);
      } else if (k.length > 1) {
        let cursor = 0;
        const subs: { e: BranchEdge; sub: RightSubtree }[] = [];
        k.forEach((e, j) => {
          const sub = lay(e.b);
          if (j) {
            const gap =
              isLeaf(e.b) && isLeaf(k[j - 1].b) ? S.leafGap : S.groupGap;
            sub.move(cursor + gap - sub.top);
          } else sub.move(-sub.top);
          cursor = sub.bottom;
          subs.push({ e, sub });
        });
        const first = subs[0].sub.mid;
        const last = subs.at(-1)!.sub.mid;
        const mid = (first + last) / 2;
        me.y = mid - s.tag - (s.h - s.tag) / 2;
        const busX = me.x + w + S.bus;
        subs.forEach(({ e, sub }) => {
          placed.push(...sub.placed);
          lines.push(...sub.lines);
          labels.push(...sub.labels);
          const ty = sub.mid;
          lines.push({
            e: e.i,
            pts: [
              [me.x + w, mid],
              [busX, mid],
              [busX, ty],
              [colX[col.get(e.b)!], ty],
            ],
          });
          if (e.text) {
            const L = M.label(e.i, "on");
            labels.push({
              e: e.i,
              x: busX + S.pad,
              y: ty - L!.h / 2,
              w: L!.w,
              h: L!.h,
              on: true,
            });
          }
        });
        top = Math.min(me.y, subs[0].sub.top);
        bottom = Math.max(me.y + s.h, cursor);
      }
      const res = {
        placed,
        lines,
        labels,
        top,
        bottom,
        entry: me.y + me.tag,
        mid: midOf(me),
        move(dy: number) {
          placed.forEach((n) => (n.y += dy));
          lines.forEach((l) => l.pts.forEach((p) => (p[1] += dy)));
          labels.forEach((l) => (l.y += dy));
          res.top += dy;
          res.bottom += dy;
          res.entry += dy;
          res.mid += dy;
        },
      };
      return res;
    }
    const T = lay(root);
    T.move(-T.top);
    R.nodes = T.placed;
    R.lines = T.lines;
    R.labels = T.labels;
    R.height = T.bottom;
    return R;
  }

  // Outline: one column. A trunk runs down a line at the left of its boxes;
  // branch children indent one step and take an elbow from their parent's
  // trunk; the text of an edge sits on its own line above the box it leads
  // to; joins come in on a rail at the right.
  function layoutOutline(W: number): BranchBlock {
    const aligned = A.shape === "spine" && A.seqs.length > 1;
    const rail = A.hasJoin || aligned ? S.rail : 0;
    const R = empty();
    let y = 0;
    const at = new Map<number, BranchNode>();
    const trunk = (d: number) => d * S.step + S.step / 2;
    function place(n: number, depth: number, inc: Incoming | null) {
      const w = W - rail - depth * S.step;
      const s = M.node(n, w);
      const x = depth * S.step;
      const lab =
        inc && inc.kind !== "rail" && inc.edge.text
          ? M.label(
              inc.edge.i,
              "strip",
              w - (inc.kind === "cont" ? S.step / 2 + 7.5 : 0),
            )
          : null;
      const joinLabels =
        inc?.kind === "rail"
          ? inc.ends.flatMap((end) =>
              end.edge.text
                ? [{ edge: end.edge, ...M.label(end.edge.i, "strip", w) }]
                : [],
            )
          : [];
      const strip = lab
        ? lab.h + 4
        : joinLabels.reduce((sum, label) => sum + label.h + 4, 0);
      let gap = 0;
      if (inc)
        gap =
          inc.kind === "elbow"
            ? S.elbowGap + strip
            : Math.max(S.contGap, strip + S.arrow + 8);
      if (!at.size) gap = 0;
      y += gap;
      const node = { i: n, x, y, w, h: s.h, tag: s.tag };
      R.nodes.push(node);
      at.set(n, node);
      const b = box(node);
      if (inc && inc.kind === "cont") {
        R.lines.push({
          e: inc.edge.i,
          pts: [
            [inc.x, inc.from],
            [inc.x, b.top],
          ],
        });
        if (lab)
          R.labels.push({
            e: inc.edge.i,
            x: inc.x + 7.5,
            y: node.y - lab.h - 3,
            w: lab.w,
            h: lab.h,
            on: false,
          });
      } else if (inc && inc.kind === "elbow") {
        R.lines.push({
          e: inc.edge.i,
          pts: [
            [inc.x, inc.from],
            [inc.x, b.mid],
            [x, b.mid],
          ],
        });
        if (lab)
          R.labels.push({
            e: inc.edge.i,
            x,
            y: node.y - lab.h - 3,
            w: lab.w,
            h: lab.h,
            on: false,
          });
      } else if (inc && inc.kind === "rail") {
        R.joins.push({ ends: inc.ends, to: n, x: 0, barY: 0, toY: 0 });
        let labelY = node.y - strip - 3;
        for (const label of joinLabels) {
          R.labels.push({
            e: label.edge.i,
            x,
            y: labelY,
            w: label.w,
            h: label.h,
            on: false,
          });
          labelY += label.h + 4;
        }
      }
      y = node.y + node.h;
      return node;
    }
    function walk(seq: BranchSeq, depth: number, inc: Incoming | null) {
      if (seq.roots) {
        for (const branch of seq.roots.branches) {
          if (R.nodes.length) y += S.contGap;
          walk(branch, depth, null);
        }
        inc = { kind: "rail", ends: seq.roots.ends };
      }
      seq.items.forEach((it) => {
        const node = place(it.n, depth, inc);
        const from = box(node).bottom;
        const x = trunk(depth);
        for (const e of it.exits)
          place(e.b, depth + 1, { kind: "elbow", edge: e, x, from });
        if (it.fork) {
          for (const br of it.fork!.branches)
            walk(br.seq, depth + 1, { kind: "elbow", edge: br.edge, x, from });
          inc = it.joinEnds ? { kind: "rail", ends: it.joinEnds } : null;
        } else if (it.next) inc = { kind: "cont", edge: it.next, x, from };
      });
    }
    if (aligned) {
      const line = mainLine(flow)!;
      const onLine = new Set(line);
      const { rank, satellite } = structure(flow);
      const host = (n: number) =>
        [...line].reverse().find((p) => rank[p] <= rank[n]) ?? line[0];
      let previous: BranchNode | null = null;
      for (const n of line) {
        const incoming = previous
          ? A.mOut(previous.i).find((e) => e.b === n)!
          : null;
        const node = place(
          n,
          0,
          previous && incoming
            ? {
                kind: "cont",
                edge: incoming,
                x: trunk(0),
                from: box(previous).bottom,
              }
            : null,
        );
        for (const e of A.all(n).filter((e) => e.side))
          place(e.b, 1, {
            kind: "elbow",
            edge: e,
            x: trunk(0),
            from: box(node).bottom,
          });
        for (const [i] of flow.nodes.entries()) {
          if (onLine.has(i) || satellite.has(i) || host(i) !== n) continue;
          const secondary = place(i, 1, null);
          for (const e of A.all(i).filter((e) => e.side))
            place(e.b, 2, {
              kind: "elbow",
              edge: e,
              x: trunk(1),
              from: box(secondary).bottom,
            });
        }
        previous = node;
      }
      flow.edges.forEach((edge, i) => {
        const a = flow.nodes.findIndex((n) => n.id === edge.from);
        const b = flow.nodes.findIndex((n) => n.id === edge.to);
        if (!edge.side && !onLine.has(a)) {
          const from = at.get(a)!,
            to = at.get(b)!;
          const x = W - rail / 2;
          R.lines.push({
            e: i,
            pts: [
              [from.x + from.w, box(from).mid],
              [x, box(from).mid],
              [x, box(to).mid],
              [to.x + to.w, box(to).mid],
            ],
          });
        }
      });
    } else A.seqs.forEach((seq) => walk(seq, 0, null));
    R.width = W;
    R.height = y;
    resolveJoins(R, "outline", W - rail / 2);
    return R;
  }

  // Choose: outline below the narrow width; else down if it fits at a
  // readable box width, else right for trees, else outline.
  function choose(): BranchBlock & { mode: FlowMode } {
    if (W < S.narrow) return { mode: "outline", ...layoutOutline(W) };
    const prefer = flow.direction;
    const tryDown = (): (BranchBlock & { mode: FlowMode }) | null => {
      for (const w of WIDE.down) {
        const R =
          A.shape === "spine"
            ? desktopSpine(w * EM, "down")
            : layoutDown(w * EM);
        if (R.width <= W) return { mode: "down", ...R };
      }
      return null;
    };
    const tryRight = (): (BranchBlock & { mode: FlowMode }) | null => {
      if (A.shape === "spine" && prefer === "right") {
        for (const w of [13, 12, 11, 10]) {
          const R = desktopSpine(w * EM, "right");
          if (R.width <= W) return { mode: "right", ...R };
        }
      }
      if (A.shape !== "tree" || A.seqs.length !== 1) return null;
      for (const [wi, wl] of WIDE.right) {
        const R = layoutRight(wi * EM, wl * EM);
        if (R.width <= W) return { mode: "right", ...R };
      }
      return null;
    };
    const order =
      prefer === "down"
        ? [tryDown]
        : prefer === "right"
          ? [tryRight, tryDown]
          : [tryDown, tryRight];
    for (const f of order) {
      const r = f();
      if (r) return r;
    }
    return { mode: "outline", ...layoutOutline(W) };
  }

  function desktopSpine(bw: number, direction: FlowDirection): BranchBlock {
    const sizes = flow.nodes.map((_, i) => ({ w: bw, ...M.node(i, bw) }));
    const labels = flow.edges.map((e, i) =>
      e.text ? M.label(i, "beside") : null,
    );
    const L = layoutFlow(flow, direction, sizes, labels, {
      ...S,
      cross: 1.2 * em,
      thread: 0.8 * em,
    });
    return {
      ...empty(),
      width: L.width,
      height: L.height,
      nodes: L.nodes.map((n, i) => ({ ...n, ...sizes[i], i })),
      lines: L.edges.map((e, i) => ({ e: i, pts: e.points })),
      labels: L.edges.flatMap((e, i) =>
        e.label ? [{ ...e.label, ...labels[i]!, e: i, on: false }] : [],
      ),
    };
  }

  const R = choose();
  return {
    mode: R.mode,
    width: R.width,
    height: R.height,
    nodes: flow.nodes.map((_, i) => R.nodes.find((n) => n.i === i)!),
    edges: flow.edges.map((_, i) => {
      const line = R.lines.find((l) => l.e === i)!;
      return {
        points: line.pts,
        label: R.labels.find((l) => l.e === i) ?? null,
        arrow: line.arrow !== false,
      };
    }),
  };
}

/** Nodes in outline reading order, with each incoming edge's text immediately before its box. */
export function flowReadingOrder(flow: Flow, analysis = analyzeFlow(flow)) {
  const order: number[] = [];
  if (analysis.shape === "spine" && analysis.seqs.length > 1) {
    const line = mainLine(flow)!;
    const onLine = new Set(line);
    const { rank, satellite, sideEdges } = structure(flow);
    const host = (n: number) =>
      [...line].reverse().find((p) => rank[p] <= rank[n]) ?? line[0];
    const add = (n: number) => {
      order.push(n);
      order.push(...sideEdges.filter((e) => e.a === n).map((e) => e.b));
    };
    for (const n of line) {
      add(n);
      for (const [i] of flow.nodes.entries())
        if (!onLine.has(i) && !satellite.has(i) && host(i) === n) add(i);
    }
  } else {
    const walk = (seq: BranchSeq) => {
      seq.roots?.branches.forEach(walk);
      for (const item of seq.items) {
        order.push(item.n, ...item.exits.map((e) => e.b));
        for (const branch of item.fork?.branches ?? []) walk(branch.seq);
      }
    };
    analysis.seqs.forEach(walk);
  }
  return order.map((n) => ({
    n,
    edges: flow.edges.flatMap((e, i) =>
      e.to === flow.nodes[n].id && e.text ? [i] : [],
    ),
  }));
}
