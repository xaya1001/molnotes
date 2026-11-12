import type { Point } from "../../../shared/chemical-library/types.ts";

export interface RouteBlock {
  width: number;
  height: number;
  lines: string[];
}
export interface RouteMolecule {
  width: number;
  top: number;
  bottom: number;
  label: string[];
  text: string[];
  structure: boolean;
  reference?: { width: number; top: number; bottom: number };
}
export interface RouteLayoutStep {
  id: string;
  from: { id: string; show?: "plus" | "box" | "text" | "none" }[];
  to: { id: string; measure?: RouteMolecule }[];
  above: string[];
  below: string[];
  others?: "plus" | "box" | "text" | "none";
  turn?: "down" | "elbow" | "wrap";
  side?: "left" | "right";
  reverse?: boolean;
}
export interface RouteLayoutItem {
  kind: "molecule" | "reference" | "plus" | "arrow";
  key?: string;
  step: string;
  at: Point;
  width: number;
  top: number;
  bottom: number;
  points?: Point[];
  above?: string[];
  below?: string[];
  boxes?: { key: string; at: Point }[];
}
type Kind =
  "molecule" | "reference" | "plus" | "horizontal" | "vertical" | "elbow";
class Row {
  items: Item[] = [];
  fans = 0;
}
class Line {
  first?: Item;
  joins?: [Item, Line, Line];
  joined = false;
  row: Row;
  direction: number;
  low: number;
  high: number;
  parent?: Line;
  constructor(row: Row, direction = 1, low = 0, high = 0, parent?: Line) {
    this.row = row;
    this.direction = direction;
    this.low = low;
    this.high = high;
    this.parent = parent;
  }
}
class Item {
  y = 0;
  dy = 0;
  textCenter = 0;
  length = 0;
  direction = 1;
  tail = true;
  fan?: Line[];
  snapshot: [number, number] = [0, 0];
  source?: Item;
  sources?: Item[];
  after?: Item;
  target?: Item;
  fanned = false;
  above?: RouteBlock;
  below?: RouteBlock;
  boxes: { key: string; measure: RouteMolecule }[] = [];
  step: RouteLayoutStep;
  line!: Line;
  row!: Row;
  kind: Kind;
  key: string | undefined;
  x: number;
  measure: RouteMolecule;
  constructor(
    kind: Kind,
    key: string | undefined,
    x: number,
    measure: RouteMolecule,
    step: RouteLayoutStep,
  ) {
    this.kind = kind;
    this.key = key;
    this.x = x;
    this.measure = measure;
    this.step = step;
  }
  get width() {
    return this.measure.width;
  }
  get center() {
    return this.x + this.width / 2;
  }
}

/** R2 layout: all dimensions are measured build geometry, in the same units. */
export function layoutRoute(
  steps: RouteLayoutStep[],
  molecules: Record<string, RouteMolecule>,
  options: {
    width: number;
    bond: number;
    gap: number;
    serpentine?: boolean;
    text(lines: string[]): RouteBlock;
  },
): {
  items: RouteLayoutItem[];
  connections: Point[][];
  width: number;
  height: number;
} {
  const { width, bond, gap } = options,
    padding = bond * 0.3;
  const items: Item[] = [],
    rows: Row[] = [],
    joins: Line[] = [],
    placed = new Map<string, Item>(),
    incoming = new Map<string, Item>();
  const plus = options.text(["+"]),
    blank: RouteMolecule = {
      width: 0,
      top: 0,
      bottom: 0,
      label: [],
      text: [],
      structure: false,
    };
  const newRow = (after?: Row) => {
    const row = new Row();
    rows.splice(after ? rows.indexOf(after) + 1 : rows.length, 0, row);
    return row;
  };
  const add = (item: Item, line: Line) => {
    item.line = line;
    item.row = line.row;
    line.row.items.push(item);
    items.push(item);
    return item;
  };
  const place = (
    key: string,
    line: Line,
    x: number,
    step: RouteLayoutStep,
    reference = false,
    measure = molecules[key],
  ) => {
    if (reference) {
      const text = options.text(measure.label);
      measure = {
        ...measure,
        ...(measure.reference ?? {
          width: text.width,
          top: text.height / 2,
          bottom: text.height / 2,
        }),
      };
    }
    const item = add(
      new Item(reference ? "reference" : "molecule", key, x, measure, step),
      line,
    );
    placed.set(key, item);
    return item;
  };
  const addPlus = (line: Line, x: number, step: RouteLayoutStep) =>
    add(
      new Item(
        "plus",
        undefined,
        x,
        {
          ...blank,
          width: plus.width,
          top: plus.height / 2,
          bottom: plus.height / 2,
        },
        step,
      ),
      line,
    );
  const horizontalRange = (p: Item): [number, number] =>
    p.kind === "horizontal" || p.kind === "elbow"
      ? [
          Math.min(p.x, p.x + p.direction * p.length),
          Math.max(p.x, p.x + p.direction * p.length),
        ]
      : [p.x, p.x + p.width];
  const boxSize = (boxes: Item["boxes"]) => ({
    width:
      boxes.reduce((sum, b) => sum + b.measure.width + bond * 1.1, 0) +
      Math.max(0, boxes.length - 1) * gap,
    height: Math.max(
      0,
      ...boxes.map((b) => b.measure.top + b.measure.bottom + bond * 1.1),
    ),
  });
  const rectangles = (p: Item): [number, number, number, number][] => {
    if (p.kind === "molecule" || p.kind === "reference" || p.kind === "plus")
      return [[p.x, p.x + p.width, -p.measure.top, p.measure.bottom]];
    if (p.kind === "horizontal" || p.kind === "elbow") {
      const [left, right] = horizontalRange(p),
        box = boxSize(p.boxes),
        rects: [number, number, number, number][] = [
          [left, right, -bond * 0.12, bond * 0.12],
        ];
      const topHeight =
          (p.above ? p.above.height + padding : 0) +
          (box.height ? box.height + padding : 0),
        topWidth = Math.max(p.above?.width ?? 0, box.width);
      if (topHeight)
        rects.push([
          p.textCenter - topWidth / 2,
          p.textCenter + topWidth / 2,
          -topHeight - padding,
          0,
        ]);
      if (p.below)
        rects.push([
          p.textCenter - p.below.width / 2,
          p.textCenter + p.below.width / 2,
          0,
          p.below.height + padding * 1.4,
        ]);
      return rects;
    }
    return [];
  };
  const extent = (ps: Item[]): [number, number] => {
    const rects = ps.flatMap((p) =>
      rectangles(p).map((r) => [r[2] + p.dy, r[3] + p.dy]),
    );
    return [
      Math.min(...rects.map((r) => r[0])),
      Math.max(...rects.map((r) => r[1])),
    ];
  };
  const span = (ps: Item[]): [number, number] => {
    const xs = ps.map(horizontalRange);
    return [Math.min(...xs.map((x) => x[0])), Math.max(...xs.map((x) => x[1]))];
  };
  const descends = (line: Line | undefined, ancestor: Line): boolean =>
    !!line && (line === ancestor || descends(line.parent, ancestor));
  const track = (line: Line) =>
    line.row.items.filter((p) => descends(p.line, line));
  const endsRows = (cur: Item, other: Item, direction: number) => {
    if (
      cur.row === other.row ||
      !cur.tail ||
      !other.tail ||
      cur.row.fans ||
      other.row.fans ||
      other.line.direction !== direction
    )
      return false;
    const a = span(cur.row.items),
      b = span(other.row.items);
    return direction > 0
      ? a[1] <= cur.x + cur.width + 1 && b[1] <= other.x + other.width + 1
      : a[0] >= cur.x - 1 && b[0] >= other.x - 1;
  };
  const canStack = (cur: Item, other: Item, direction: number) => {
    if (!endsRows(cur, other, direction)) return false;
    const a = span(cur.row.items),
      b = span(other.row.items),
      dx = cur.center - other.center;
    return Math.max(a[1], b[1] + dx) - Math.min(a[0], b[0] + dx) <= width;
  };
  const canMirror = (cur: Item, other: Item, direction: number) => {
    if (direction < 0 || !endsRows(cur, other, direction)) return false;
    if (
      other.row.items.some(
        (p) =>
          !["molecule", "reference", "plus", "horizontal"].includes(p.kind) ||
          p.line !== other.line ||
          (p.kind === "horizontal" && !p.source),
      )
    )
      return false;
    const a = span(cur.row.items),
      b = span(other.row.items);
    return a[1] - a[0] + 2 * gap + plus.width + b[1] - b[0] <= width;
  };
  const fanPair = (
    cur: Item,
    other: Item,
    direction: number,
  ): [Item, Line, Line] | undefined => {
    if (direction < 0 || cur.row !== other.row || !cur.tail || !other.tail)
      return;
    for (const point of [...items].reverse()) {
      if (!point.fan || point.row !== cur.row) continue;
      const a = point.fan.find((l) => descends(cur.line, l)),
        b = point.fan.find((l) => descends(other.line, l));
      if (!a || !b || a === b) continue;
      for (const [line, end] of [
        [a, cur],
        [b, other],
      ] as const) {
        const inc = incoming.get(end.key!);
        if (
          line.joined ||
          track(line).some((p) => p.fan) ||
          span(track(line))[1] > end.x + end.width + 1 ||
          !inc ||
          inc.kind !== "horizontal" ||
          inc.row !== end.row ||
          inc.direction < 0
        )
          return;
      }
      return [point, a, b];
    }
  };
  const uses = new Map<string, number>();
  for (const step of steps) {
    const key = step.from[0].id;
    uses.set(key, (uses.get(key) ?? 0) + 1);
  }
  for (const step of steps) {
    const main = step.from[0].id;
    let turn = step.turn,
      fan = false,
      cur = placed.get(main),
      line: Line;
    if (!cur) {
      line = new Line(newRow());
      cur = place(main, line, 0, step);
      line.high = cur.width;
      line.first = cur;
      fan = (uses.get(main) ?? 0) > 1 && !turn;
    } else {
      line = cur.line;
      if (!cur.tail) {
        if (turn)
          line = new Line(
            cur.row,
            line.direction,
            ...cur.snapshot,
            line.parent,
          );
        else if (cur.fan) fan = true;
        else {
          line = new Line(newRow());
          cur = place(main, line, 0, step, true);
          line.high = cur.width;
          line.first = cur;
        }
      } else if ((uses.get(main) ?? 0) > 1 && !turn) fan = true;
    }
    const pre: string[] = [],
      boxes: Item["boxes"] = [];
    let joinWith: Item | undefined,
      direction = line.direction,
      edge = direction > 0 ? cur.x + cur.width : cur.x;
    for (const co of step.from.slice(1)) {
      const m = molecules[co.id],
        other = placed.get(co.id);
      let show: string | undefined = co.show ?? step.others;
      if (show === undefined) {
        if (other)
          show =
            !turn &&
            !fan &&
            !joinWith &&
            (fanPair(cur, other, direction) ||
              canStack(cur, other, direction) ||
              canMirror(cur, other, direction))
              ? "join"
              : "reference";
        else if (!m.structure) show = "text";
        else
          show =
            line.first === cur && cur.tail && !turn && !fan && !joinWith
              ? "plus"
              : "box";
      }
      if (show === "plus") {
        const x = direction > 0 ? edge + gap : edge - gap - plus.width;
        addPlus(line, x, step);
        const p = place(
          co.id,
          line,
          direction > 0 ? x + plus.width + gap : x - gap - m.width,
          step,
        );
        p.tail = false;
        edge = direction > 0 ? p.x + p.width : p.x;
        line.low = Math.min(line.low, p.x);
        line.high = Math.max(line.high, p.x + p.width);
      } else if (show === "join") joinWith = other;
      else if (show === "text" || show === "reference") pre.push(...m.text);
      else if (show === "box") boxes.push({ key: co.id, measure: m });
    }
    pre.push(...step.above);
    const above = pre.length ? options.text(pre) : undefined,
      below = step.below.length ? options.text(step.below) : undefined,
      box = boxSize(boxes),
      textWidth = Math.max(above?.width ?? 0, below?.width ?? 0),
      length = Math.max(bond * 4.5, textWidth + bond * 1.4, box.width + bond);
    const continuation = step.to.find((o) => uses.has(o.id)) ?? step.to.at(-1)!;
    const outputs = [
      ...step.to.filter((o) => o !== continuation),
      continuation,
    ];
    const productWidth =
      outputs.reduce((n, o) => n + (o.measure ?? molecules[o.id]).width, 0) +
      (outputs.length - 1) * (2 * gap + plus.width);
    const overflows = (line: Line, edge: number, lead: number) => {
      const end = edge + line.direction * (lead + length + gap + productWidth);
      return Math.max(line.high, end) - Math.min(line.low, end) > width;
    };
    let joined: Item[] | undefined,
      jx = 0;
    if (joinWith) {
      const other = joinWith,
        pair = fanPair(cur, other, direction),
        A = cur.row,
        B = other.row;
      joined = [cur, other];
      let stack = false;
      if (!pair) {
        stack = canStack(cur, other, direction);
        if (stack && canMirror(cur, other, direction)) {
          const a = span(A.items),
            b = span(B.items),
            dx = cur.center - other.center,
            end = Math.max(a[1], b[1] + dx) + 2 * gap + length + productWidth;
          stack = end - Math.min(a[0], b[0] + dx) <= width;
        }
      }
      if (pair) {
        const [point, la, lb] = pair;
        jx = Math.max(cur.center, other.center);
        for (const [end, L] of [
          [cur, la],
          [other, lb],
        ] as const) {
          const delta = jx - end.center,
            inc = incoming.get(end.key!)!;
          if (delta > 0.5) {
            for (const p of track(L))
              if (p !== inc && horizontalRange(p)[0] >= inc.x + inc.length - 1)
                p.x += delta;
            inc.length += delta;
            inc.textCenter += delta / 2;
          }
          L.joined = true;
        }
        point.fan = [...point.fan!.filter((l) => l !== la && l !== lb), la, lb];
        line = new Line(A, direction, ...span(A.items));
        line.joins = pair;
        joins.push(line);
        addPlus(line, jx - plus.width / 2, step);
      } else if (stack) {
        const dx = cur.center - other.center,
          a = extent(A.items),
          b = extent(B.items);
        for (const p of A.items) p.dy += -a[1] - bond * 0.85;
        for (const p of B.items) {
          p.dy += -b[0] + bond * 0.85;
          p.x += dx;
          p.textCenter += dx;
          p.row = A;
          p.line.row = A;
        }
        A.items.push(...B.items);
        rows.splice(rows.indexOf(B), 1);
        jx = cur.center;
        line = new Line(A, direction, ...span(A.items));
        addPlus(line, jx - plus.width / 2, step);
      } else {
        const [, right] = span(B.items),
          start = cur.x + cur.width + 2 * gap + plus.width;
        for (const p of B.items) {
          if (p.kind === "horizontal") {
            p.x = start + right - p.x;
            p.direction = -1;
          } else p.x = start + right - p.x - p.width;
          p.textCenter = start + right - p.textCenter;
          p.dy += cur.dy - other.dy;
          p.row = A;
        }
        other.line.row = A;
        other.line.direction = -1;
        A.items.push(...B.items);
        rows.splice(rows.indexOf(B), 1);
        jx = cur.x + cur.width + gap + plus.width / 2;
        line = new Line(A, direction, ...span(A.items));
        addPlus(line, jx - plus.width / 2, step).dy = cur.dy;
        turn = "down";
      }
      other.tail = false;
      edge =
        direction > 0
          ? Math.max(edge, other.x + other.width)
          : Math.min(edge, other.x);
    }
    const stub = bond * 0.9;
    if (
      fan &&
      cur.fan &&
      overflows(new Line(cur.row, direction, ...cur.snapshot), edge, gap + stub)
    ) {
      fan = false;
      line = new Line(newRow());
      cur = place(main, line, 0, step, true);
      line.high = cur.width;
      line.first = cur;
      direction = 1;
      edge = cur.width;
    }
    if (fan && !cur.fan && overflows(line, edge, gap + stub)) fan = false;
    if (fan) {
      line = new Line(
        cur.row,
        direction,
        ...(cur.fan
          ? cur.snapshot
          : ([line.low, line.high] as [number, number])),
        line,
      );
      if (!cur.fan) {
        cur.fan = [];
        cur.row.fans++;
      }
      cur.fan.push(line);
    }
    const lead = fan ? gap + stub : gap;
    if (!turn && overflows(line, edge, lead))
      turn = joined || options.serpentine ? "down" : "wrap";
    cur.tail = false;
    let x: number, arrow: Item;
    if (!turn) {
      const ax = edge + direction * lead;
      let center = ax + (direction * length) / 2,
        arrowLength = length;
      const previous = incoming.get(cur.key!);
      if (previous?.kind === "vertical" && (previous.above || previous.below)) {
        const previousWidth =
            Math.max(previous.above?.width ?? 0, previous.below?.width ?? 0) +
            bond * 1.4,
          side = previous.step.side ?? "right",
          sw = Math.max(textWidth, box.width);
        if (
          direction > 0 &&
          side === "right" &&
          center - sw / 2 < previous.x + previousWidth
        ) {
          center = previous.x + previousWidth + sw / 2;
          arrowLength = Math.max(length, center + sw / 2 + bond * 0.5 - ax);
        } else if (
          direction < 0 &&
          side === "left" &&
          center + sw / 2 > previous.x - previousWidth
        ) {
          center = previous.x - previousWidth - sw / 2;
          arrowLength = Math.max(length, ax - (center - sw / 2 - bond * 0.5));
        }
      }
      x =
        direction > 0
          ? ax + arrowLength + gap
          : ax - arrowLength - gap - productWidth;
      arrow = new Item("horizontal", undefined, ax, blank, step);
      arrow.direction = direction;
      arrow.length = arrowLength;
      arrow.textCenter = center;
      arrow.source = cur;
      arrow.fanned = fan;
    } else if (turn === "wrap") {
      line.row = newRow(line.row);
      line.direction = direction = 1;
      x = length + gap;
      line.low = 0;
      line.high = x + productWidth;
      arrow = new Item("horizontal", undefined, 0, blank, step);
      arrow.direction = 1;
      arrow.length = length;
      arrow.textCenter = length / 2;
      if (incoming.get(cur.key!)?.sources) arrow.after = cur;
    } else if (turn === "down") {
      if (joined) {
        const low = line.low;
        x = Math.min(
          Math.max(jx - productWidth / 2, low),
          Math.max(low, low + Math.max(width, line.high - low) - productWidth),
        );
        line.row = newRow(line.row);
        line.direction = direction = 1;
        arrow = new Item("vertical", undefined, jx, blank, step);
        arrow.sources = joined;
      } else {
        line.row = newRow(line.row);
        line.direction = direction =
          step.reverse === false ? direction : -direction;
        x = cur.center - productWidth / 2;
        arrow = new Item("vertical", undefined, cur.center, blank, step);
        line.low = x;
      }
      arrow.source = cur;
      line.low = Math.min(line.low, x);
      line.high = x + productWidth;
    } else {
      line.row = newRow(line.row);
      line.direction = direction = -direction;
      const ax = cur.center;
      x = ax + direction * (length + gap) - (direction < 0 ? productWidth : 0);
      line.low = Math.min(ax, x);
      line.high = Math.max(ax, x + productWidth);
      arrow = new Item("elbow", undefined, ax, blank, step);
      arrow.direction = direction;
      arrow.length = length;
      arrow.source = cur;
      arrow.textCenter = ax + direction * (length / 2 + bond * 0.4);
    }
    arrow.above = above;
    arrow.below = below;
    arrow.boxes = boxes;
    add(arrow, line);
    line.first = undefined;
    const start = x;
    for (const [index, product] of outputs.entries()) {
      if (index) {
        addPlus(line, x + gap, step);
        x += 2 * gap + plus.width;
      }
      const p = place(
        product.id,
        line,
        x,
        step,
        false,
        product.measure ?? molecules[product.id],
      );
      incoming.set(product.id, arrow);
      x += p.width;
      arrow.target ??= p;
    }
    line.low = Math.min(line.low, start);
    line.high = Math.max(line.high, x);
    for (const product of outputs)
      placed.get(product.id)!.snapshot = [line.low, line.high];
  }
  for (const point of [...items]
    .reverse()
    .filter((p) => p.fan && p.fan.length > 1)) {
    const units: Item[][] = [],
      lower = new Set<Line>();
    for (const line of point.fan!) {
      if (lower.has(line)) continue;
      const join = joins.find((j) => j.joins![1] === line);
      if (!join) {
        units.push(point.row.items.filter((p) => descends(p.line, line)));
        continue;
      }
      const [, a, b] = join.joins!;
      lower.add(b);
      const ta = track(a),
        tb = track(b),
        ea = extent(ta),
        eb = extent(tb);
      for (const p of ta) p.dy += -ea[1] - bond * 0.85;
      for (const p of tb) p.dy += -eb[0] + bond * 0.85;
      units.push([
        ...ta,
        ...tb,
        ...point.row.items.filter((p) => descends(p.line, join)),
      ]);
    }
    const extents = units.map(extent);
    let y =
      point.dy -
      (extents.reduce((n, e) => n + e[1] - e[0], 0) +
        bond * (extents.length - 1)) /
        2;
    units.forEach((unit, index) => {
      for (const p of unit) p.dy += y - extents[index][0];
      y += extents[index][1] - extents[index][0] + bond;
    });
  }
  const bottom = (p: Item) => p.y + p.measure.bottom + padding;
  const obstacles: [number, number, number, number][] = [],
    centers: number[] = [];
  for (const [index, row] of rows.entries()) {
    const mine = items.filter((p) => p.row === row);
    let y = index ? centers[index - 1] + bond * 2 : 0;
    if (index) {
      for (const p of mine) {
        if (p.kind === "vertical") {
          const box = boxSize(p.boxes),
            textHeight = (p.above?.height ?? 0) + (p.below?.height ?? 0),
            contentHeight =
              textHeight + (box.height ? box.height + padding : 0),
            start = Math.max(...(p.sources ?? [p.source!]).map(bottom));
          y = Math.max(
            y,
            start +
              Math.max(bond * 2.6, contentHeight + bond) +
              p.target!.measure.top,
          );
          if (contentHeight) {
            const w = Math.max(
                p.above?.width ?? 0,
                p.below?.width ?? 0,
                box.width,
              ),
              offset = bond * 0.6;
            p.textCenter =
              p.x + (p.step.side === "left" ? -1 : 1) * (offset + w / 2);
            obstacles.push(
              p.step.side === "left"
                ? [
                    p.x - offset - w,
                    p.x - offset,
                    start,
                    start + contentHeight + bond * 0.6,
                  ]
                : [
                    p.x + offset,
                    p.x + offset + w,
                    start,
                    start + contentHeight + bond * 0.6,
                  ],
            );
          }
        } else if (p.kind === "elbow")
          y = Math.max(y, bottom(p.source!) + bond * 2.2);
        else if (p.after)
          y = Math.max(y, bottom(p.after) + bond * 0.8 - extent(mine)[0]);
      }
      for (const p of mine)
        for (const [x0, x1, y0] of rectangles(p))
          for (const [ox0, ox1, , oy1] of obstacles)
            if (x0 < ox1 + bond * 0.4 && ox0 < x1 + bond * 0.4)
              y = Math.max(y, oy1 + bond * 0.8 - y0 - p.dy);
    }
    centers.push(y);
    for (const p of mine) {
      p.y = y + p.dy;
      for (const [x0, x1, y0, y1] of rectangles(p))
        obstacles.push([x0, x1, p.y + y0, p.y + y1]);
    }
  }
  const top = Math.min(...obstacles.map((o) => o[2]));
  for (const p of items) p.y -= top;
  const connections: Point[][] = [],
    result: RouteLayoutItem[] = [];
  for (const p of items) {
    if (p.kind === "molecule" || p.kind === "reference" || p.kind === "plus")
      result.push({
        kind: p.kind,
        key: p.key,
        step: p.step.id,
        at: { x: p.x, y: p.y },
        width: p.width,
        top: p.measure.top,
        bottom: p.measure.bottom,
      });
    else {
      let points: Point[];
      if (p.kind === "vertical")
        points = [
          { x: p.x, y: Math.max(...(p.sources ?? [p.source!]).map(bottom)) },
          { x: p.x, y: p.target!.y - p.target!.measure.top - gap * 0.5 },
        ];
      else if (p.kind === "elbow")
        points = [
          { x: p.x, y: bottom(p.source!) },
          { x: p.x, y: p.y },
          { x: p.x + p.direction * p.length, y: p.y },
        ];
      else
        points = [
          { x: p.x, y: p.y },
          { x: p.x + p.direction * p.length, y: p.y },
        ];
      if (p.fanned) {
        const start = {
            x: p.source!.x + p.source!.width + gap * 0.5,
            y: p.source!.y,
          },
          stubX = p.x - p.direction * gap * 0.5;
        connections.push([
          start,
          { x: stubX, y: start.y },
          { x: stubX, y: p.y },
          { ...points[0] },
        ]);
      }
      const boxes: NonNullable<RouteLayoutItem["boxes"]> = [];
      let x = p.textCenter - boxSize(p.boxes).width / 2 + bond * 0.55;
      for (const box of p.boxes) {
        boxes.push({
          key: box.key,
          at: {
            x,
            y:
              p.kind === "vertical"
                ? points[0].y + padding + bond * 0.55 + box.measure.top
                : p.y -
                  padding -
                  (p.above?.height ?? 0) -
                  padding -
                  box.measure.bottom -
                  bond * 0.55,
          },
        });
        x += box.measure.width + bond * 1.1 + gap;
      }
      result.push({
        kind: "arrow",
        step: p.step.id,
        at: { x: p.textCenter, y: p.y },
        width:
          p.kind === "vertical"
            ? Math.max(p.above?.width ?? 0, p.below?.width ?? 0) + bond * 1.2
            : p.length,
        top: 0,
        bottom: 0,
        points,
        above: p.above?.lines,
        below: p.below?.lines,
        boxes,
      });
    }
  }
  const xs = result.flatMap((p) =>
      p.kind === "arrow"
        ? [
            ...(p.boxes ?? []).flatMap((box) => [
              box.at.x - bond * 0.55,
              box.at.x + molecules[box.key].width + bond * 0.55,
            ]),
            ...(p.points ?? []).map((q) => q.x),
            p.at.x -
              Math.max(
                p.above ? options.text(p.above).width : 0,
                p.below ? options.text(p.below).width : 0,
              ) /
                2,
            p.at.x +
              Math.max(
                p.above ? options.text(p.above).width : 0,
                p.below ? options.text(p.below).width : 0,
              ) /
                2,
          ]
        : [p.at.x, p.at.x + p.width],
    ),
    minX = Math.min(...xs);
  for (const p of result) {
    p.at.x -= minX;
    for (const point of p.points ?? []) point.x -= minX;
    for (const box of p.boxes ?? []) box.at.x -= minX;
  }
  for (const path of connections) for (const point of path) point.x -= minX;
  return {
    items: result,
    connections,
    width: Math.max(...xs) - minX,
    height: Math.max(...obstacles.map((o) => o[3])) - top,
  };
}
