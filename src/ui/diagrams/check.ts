// Layout checks a reader would notice, read off a rendered figure. The
// preview command reports them to the author and the figure tests assert
// there are none; neither has to judge a screenshot by eye.

type Box = { left: number; top: number; right: number; bottom: number };
const rect = (el: Element): DOMRect => el.getBoundingClientRect();
const overlap = (a: Box, b: Box, slack = 1) =>
  a.left < b.right - slack &&
  b.left < a.right - slack &&
  a.top < b.bottom - slack &&
  b.top < a.bottom - slack;
const short = (el: Element) => {
  const text = (el.textContent ?? "").replace(/\s+/g, "");
  return text.length > 12 ? `${text.slice(0, 12)}…` : text;
};
// Below this size Chinese stops being comfortable to read on a page.
const smallestText = 11;
/**
 * A timeline label stacked further than this many of its ems from its point
 * (past about two rows of three-line labels) no longer reads as belonging to
 * it; the figure narrows its labels to avoid it.
 */
export const longestLeader = 11;

function textWarnings(root: HTMLElement): string[] {
  const warnings: string[] = [];
  const outer = rect(root);
  if (root.scrollWidth > root.clientWidth + 1)
    warnings.push(
      `图比版面宽 ${root.scrollWidth - root.clientWidth}px，手机上会出现横向滚动`,
    );
  const seen = new Set<number>();
  for (const el of root.querySelectorAll<HTMLElement>("*")) {
    if (
      ![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent?.trim())
    )
      continue;
    const size = parseFloat(getComputedStyle(el).fontSize);
    if (size < smallestText && !seen.has(size)) {
      seen.add(size);
      warnings.push(`「${short(el)}」字号 ${size}px，小于 ${smallestText}px`);
    }
    const box = rect(el);
    if (box.width && (box.left < outer.left - 1 || box.right > outer.right + 1))
      warnings.push(`「${short(el)}」超出图的左右边界`);
  }
  return warnings;
}

function timelineWarnings(root: HTMLElement): string[] {
  const warnings: string[] = [];
  const labels = [...root.querySelectorAll(".timeline-label")];
  const boxes = labels.map(rect);
  boxes.forEach((a, i) =>
    boxes.slice(i + 1).forEach((b, j) => {
      if (overlap(a, b))
        warnings.push(
          `标签「${short(labels[i])}」与「${short(labels[i + 1 + j])}」重叠`,
        );
    }),
  );
  // A leader runs from the line to its own label; crossing another reads as a strike-through.
  for (const line of root.querySelectorAll(".timeline-leader")) {
    const l = rect(line);
    labels.forEach((label, i) => {
      const b = boxes[i];
      const inside = l.left > b.left + 2 && l.left < b.right - 2;
      const spans = l.top < b.bottom - 2 && l.bottom > b.top + 2;
      const own =
        Math.abs(l.top - b.bottom) < 2 || Math.abs(l.bottom - b.top) < 2;
      if (inside && spans && !own)
        warnings.push(`引线穿过标签「${short(label)}」`);
    });
  }
  // A leader ends at its own label; a long one leaves the label far from its point.
  for (const line of root.querySelectorAll(".timeline-leader")) {
    const l = rect(line);
    const i = boxes.findIndex(
      (b) =>
        l.left > b.left - 4 &&
        l.left < b.right + 4 &&
        (Math.abs(l.top - b.bottom) < 2 || Math.abs(l.bottom - b.top) < 2),
    );
    if (i < 0) continue;
    const em = parseFloat(getComputedStyle(labels[i]).fontSize);
    if (l.height > longestLeader * em)
      warnings.push(
        `标签「${short(labels[i])}」离它的点 ${Math.round(l.height)}px，引线过长`,
      );
  }
  // A marker line runs behind labels; one straddling a label cuts through its text.
  const walls = new Map<number, { top: number; bottom: number }>();
  for (const line of root.querySelectorAll(".timeline-marker")) {
    const l = rect(line);
    const wall = walls.get(l.left) ?? { top: l.top, bottom: l.bottom };
    walls.set(l.left, {
      top: Math.min(wall.top, l.top),
      bottom: Math.max(wall.bottom, l.bottom),
    });
  }
  for (const [x, { top, bottom }] of walls)
    labels.forEach((label, i) => {
      const b = boxes[i];
      if (
        x > b.left + 2 &&
        x < b.right - 2 &&
        top < b.bottom - 2 &&
        bottom > b.top + 2
      )
        warnings.push(`竖线穿过标签「${short(label)}」`);
    });
  const legend = root.querySelector(".timeline-legend");
  if (legend) {
    const box = rect(legend);
    const drawn = [...labels, ...root.querySelectorAll(".timeline-tick")];
    const hit = drawn.find((el) => overlap(rect(el), box));
    if (hit) warnings.push(`图例与「${short(hit)}」重叠`);
  }
  return warnings;
}

/** Whether the segment a–b passes through the inside of a box. */
function crosses(
  [ax, ay]: [number, number],
  [bx, by]: [number, number],
  box: Box,
) {
  // Clip the segment to the box (Liang–Barsky); any part left is inside.
  let [t0, t1] = [0, 1];
  const [dx, dy] = [bx - ax, by - ay];
  for (const [p, q] of [
    [-dx, ax - box.left],
    [dx, box.right - ax],
    [-dy, ay - box.top],
    [dy, box.bottom - ay],
  ]) {
    if (p === 0) {
      if (q < 0) return false;
    } else if (p < 0) t0 = Math.max(t0, q / p);
    else t1 = Math.min(t1, q / p);
  }
  return t0 < t1;
}
const inset = (r: Box, by: number): Box => ({
  left: r.left + by,
  top: r.top + by,
  right: r.right - by,
  bottom: r.bottom - by,
});

// A box reads well with about five characters a line and six lines at most.
const fewestPerLine = 4.5;
const mostLines = 6;

/**
 * Whether a box reads well, given each line the author wrote as its
 * rendered lines and its length in em: Chinese characters, with Latin
 * letters, digits and spaces at their own width.
 */
export function readsWell(written: { lines: number; length: number }[]) {
  return (
    written.reduce((sum, l) => sum + l.lines, 0) <= mostLines &&
    written.every((l) => l.lines < 2 || l.length / l.lines >= fewestPerLine)
  );
}

/**
 * Each line the author wrote in a box (split by <br>): its rendered lines
 * and its length in em, measured unbroken as the figure predicts it.
 */
function writtenLines(box: Element) {
  const lines: { tops: Set<number>; length: number }[] = [
    { tops: new Set(), length: 0 },
  ];
  const pen = document.createElement("canvas").getContext("2d")!;
  const walker = document.createTreeWalker(
    box,
    NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT,
  );
  while (walker.nextNode()) {
    const node = walker.currentNode;
    if (node.nodeName === "BR") lines.push({ tops: new Set(), length: 0 });
    if (node.nodeType !== Node.TEXT_NODE) continue;
    const line = lines.at(-1)!;
    const range = document.createRange();
    range.selectNodeContents(node);
    for (const r of range.getClientRects())
      if (r.width) line.tops.add(Math.round(r.top / 4));
    const style = getComputedStyle(node.parentElement!);
    pen.font = style.font;
    line.length +=
      pen.measureText(node.textContent ?? "").width /
      parseFloat(style.fontSize);
  }
  return lines.map((l) => ({ lines: l.tops.size, length: l.length }));
}

function flowWarnings(root: HTMLElement): string[] {
  const warnings: string[] = [];
  const em = parseFloat(getComputedStyle(root).fontSize);
  const boxes = [...root.querySelectorAll<HTMLElement>(".flow-box")];
  for (const box of boxes) {
    if (box.scrollWidth > box.clientWidth + 1)
      warnings.push(`框「${short(box)}」里的文字溢出`);
    if (rect(box).width < 4.4 * em - 1)
      warnings.push(
        `框「${short(box)}」宽 ${Math.round(rect(box).width)}px，太窄`,
      );
    const written = writtenLines(box);
    if (!readsWell(written))
      warnings.push(
        `框「${short(box)}」太窄，文字断成 ${written.reduce((sum, l) => sum + l.lines, 0)} 行`,
      );
  }
  const nodes = [...root.querySelectorAll<HTMLElement>(".flow-node")];
  nodes.forEach((a, i) =>
    nodes.slice(i + 1).forEach((b) => {
      if (overlap(rect(a), rect(b)))
        warnings.push(`框「${short(a)}」与「${short(b)}」重叠`);
    }),
  );
  const labels = [...root.querySelectorAll<HTMLElement>(".flow-label")];
  labels.forEach((label, i) => {
    for (const node of nodes)
      if (overlap(rect(label), rect(node)))
        warnings.push(`连线文字「${short(label)}」与框「${short(node)}」重叠`);
    for (const other of labels.slice(i + 1))
      if (overlap(rect(label), rect(other)))
        warnings.push(`连线文字「${short(label)}」与「${short(other)}」重叠`);
  });
  // Edges are paths of straight segments in the figure's SVG.
  const svg = root.querySelector("svg.flow-lines");
  if (!svg) return warnings;
  const origin = rect(svg);
  for (const path of root.querySelectorAll(".flow-edge")) {
    const points = [
      ...(path.getAttribute("d") ?? "").matchAll(/(-?[\d.]+) (-?[\d.]+)/g),
    ].map(
      ([, x, y]) =>
        [origin.left + Number(x), origin.top + Number(y)] as [number, number],
    );
    const segments = points.slice(1).map((b, i) => [points[i], b] as const);
    // Lines start and end on box borders: only a pass through the inside counts.
    for (const box of boxes)
      if (segments.some(([a, b]) => crosses(a, b, inset(rect(box), 2))))
        warnings.push(`连线穿过框「${short(box)}」`);
    for (const label of labels)
      if (segments.some(([a, b]) => crosses(a, b, inset(rect(label), 1))))
        warnings.push(`连线穿过连线文字「${short(label)}」`);
    // A tag's box may reach past its words, over the arrow beside it.
    for (const tag of root.querySelectorAll(".flow-tag")) {
      const words = document.createRange();
      words.selectNodeContents(tag);
      if (
        segments.some(([a, b]) =>
          crosses(a, b, inset(words.getBoundingClientRect(), 1)),
        )
      )
        warnings.push(`连线穿过框上的小字「${short(tag)}」`);
    }
  }
  return warnings;
}

/** What a reader would trip over in a rendered timeline, flow or structure. */
export function figureWarnings(root: HTMLElement): string[] {
  const warnings = textWarnings(root);
  if (root.matches(".timeline")) warnings.push(...timelineWarnings(root));
  if (root.matches(".flow")) warnings.push(...flowWarnings(root));
  if (root.querySelector('[role="alert"]'))
    warnings.push(`渲染失败：${short(root.querySelector('[role="alert"]')!)}`);
  return [...new Set(warnings)];
}
