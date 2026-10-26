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
  const seen = new Set<string>();
  const add = (edge: FlowEdge, where: string) => {
    const key = `${edge.from} > ${edge.to}`;
    if (seen.has(key)) fail(`${where} repeats the edge ${key}`);
    seen.add(key);
    edges.push(edge);
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

  return {
    nodes,
    edges,
    direction:
      oneOf(input.direction, ["right", "down"], "flow direction") ?? "auto",
    over: input.over === undefined ? "" : text(input.over, "flow over"),
    note: input.note === undefined ? "" : text(input.note, "flow note"),
  };
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
  edges: { points: Point[]; label: { x: number; y: number } | null }[];
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
      ? Math.max(space.side, labelCross(e) + 2 * space.pad)
      : space.side;
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
              edge + (gap - labelCross(e.i)) / 2,
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
