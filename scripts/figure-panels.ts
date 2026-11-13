import type { FigureInput, StructureInput } from "./figure-input.ts";
import type {
  Library,
  Mechanism,
  Point,
  Scene,
} from "../shared/chemical-library/types.ts";
import type { FigureBox } from "../shared/chemical-library/geometry.ts";
import { prepareFigure } from "../src/ui/library/prepare.ts";
import {
  createFigureScene,
  type FigureStyle,
} from "../src/ui/library/scene-geometry.ts";
import { walkGeometry } from "../src/ui/library/geometry-walk.ts";
import { transformBox, unionBoxes } from "../src/ui/library/geometry-math.ts";
import { figureLabelLines } from "../src/ui/library/text-runs.ts";
import { loadFigureFonts } from "./figure-fonts.ts";
import { moleculeToolkit } from "../shared/molecule-toolkit.ts";

export interface PanelCell {
  key: string;
  spec: StructureInput;
  scene: Scene;
}
const words = (value: string | number | undefined) =>
  value === undefined ? "" : String(value);
const emptyScene = (): Scene => ({
  width: 1,
  height: 1,
  molecules: [],
  captions: [],
  reactionArrows: [],
});

/** Port the prototype's grid and circular geometry into saved website scenes. */
export async function compilePanelScene(
  library: Library,
  entry: Mechanism,
  input: FigureInput,
  cells: PanelCell[],
  style: FigureStyle,
): Promise<Scene> {
  const fonts = await loadFigureFonts(),
    toolkit = await moleculeToolkit();
  const ctx = createFigureScene(style, fonts),
    B = ctx.token("--chemical-bond");
  const scene = emptyScene(),
    boxes: FigureBox[] = [];
  const font = "var(--chemical-caption-font)";
  const measuredText = (text: string) => {
    const node = ctx.label({ x: 0, y: 0 }, text, font);
    const b = ctx.box(node);
    return {
      x: b.x / B,
      y: b.y / B,
      width: Math.max(b.width, node.advance) / B,
      height: b.height / B,
    };
  };
  const textBlock = (text: string) => {
    let height = 0;
    const leading = (ctx.token("--chemical-caption-font") / B) * 1.25;
    const lines = text
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const box = measuredText(line);
        const lineHeight = Math.max(leading, box.height + 0.2);
        const offset = height + (lineHeight - box.height) / 2;
        height += lineHeight;
        return { text: line, box, offset };
      });
    return {
      lines,
      width: Math.max(0, ...lines.map((l) => l.box.width)),
      height,
    };
  };
  const putText = (text: string, cx: number, cy: number) => {
    const block = textBlock(text);
    block.lines.forEach((line) =>
      scene.captions!.push({
        text: line.text,
        at: {
          x: cx,
          y: cy - block.height / 2 + line.offset - line.box.y,
        },
      }),
    );
    const box = {
      x: cx - block.width / 2,
      y: cy - block.height / 2,
      width: block.width,
      height: block.height,
    };
    boxes.push(box);
    return box;
  };
  const measured = await Promise.all(
    cells.map(async (cell) => {
      const probe: Mechanism = {
        ...entry,
        footnote: undefined,
        frames: [
          {
            id: "measure",
            title: "Measure",
            explanation: "Measure",
            scene: cell.scene,
          },
        ],
      };
      const geometry = await prepareFigure(
        { ...library, [entry.id]: probe },
        { ref: entry.id },
        { toolkit, fonts, style },
      );
      const parts: FigureBox[] = [];
      walkGeometry(geometry.root, (node, matrix) => {
        if (node.kind === "group" && node.attributes["data-compound"])
          parts.push(transformBox(node.bounds, matrix)!);
      });
      const raw = unionBoxes(parts);
      const body = raw
        ? {
            x: raw.x / B,
            y: raw.y / B,
            width: raw.width / B,
            height: raw.height / B,
          }
        : { x: 0, y: 0, width: 0, height: 0 };
      const label =
        cell.spec.text !== undefined
          ? words(cell.spec.text)
          : [
              ...figureLabelLines(
                cell.spec.label === undefined
                  ? cell.key
                  : words(cell.spec.label),
                words(cell.spec.name),
              ),
              ...(cell.spec.yield ? [cell.spec.yield] : []),
              ...(cell.spec.note === undefined ? [] : [words(cell.spec.note)]),
            ].join("\n");
      const block = textBlock(label);
      return {
        ...cell,
        body,
        label,
        width: Math.max(body.width, block.width),
        height: body.height + (body.height && label ? 0.4 : 0) + block.height,
      };
    }),
  );
  const putCell = (
    cell: (typeof measured)[number],
    cx: number,
    cy: number,
    bodyHeight = cell.body.height,
  ) => {
    const dx = cx - cell.body.x - cell.body.width / 2;
    const dy =
      cy - cell.height / 2 + (bodyHeight - cell.body.height) / 2 - cell.body.y;
    for (const molecule of cell.scene.molecules)
      scene.molecules.push({
        ...molecule,
        at: { x: molecule.at.x + dx, y: molecule.at.y + dy },
      });
    (scene.arrows ??= []).push(...(cell.scene.arrows ?? []));
    (scene.labels ??= []).push(...(cell.scene.labels ?? []));
    (scene.enclose ??= []).push(...(cell.scene.enclose ?? []));
    if (cell.scene.focus) {
      const combined = (scene.focus ??= {});
      if (cell.scene.focus.primary) {
        const primary = (combined.primary ??= {});
        for (const key of ["atoms", "bonds", "arrows"] as const) {
          // Each collection retains the stable endpoints generated for its cell.
          if (key === "atoms")
            primary.atoms = [
              ...(primary.atoms ?? []),
              ...(cell.scene.focus.primary.atoms ?? []),
            ];
          if (key === "bonds")
            primary.bonds = [
              ...(primary.bonds ?? []),
              ...(cell.scene.focus.primary.bonds ?? []),
            ];
          if (key === "arrows")
            primary.arrows = [
              ...(primary.arrows ?? []),
              ...(cell.scene.focus.primary.arrows ?? []),
            ];
        }
      }
      combined.supporting = [
        ...(combined.supporting ?? []),
        ...(cell.scene.focus.supporting ?? []),
      ];
    }
    const top = cy - cell.height / 2;
    if (cell.label)
      putText(
        cell.label,
        cx,
        top +
          bodyHeight +
          (cell.body.height ? 0.4 : 0) +
          textBlock(cell.label).height / 2,
      );
    boxes.push({
      x: cx - cell.width / 2,
      y: top,
      width: cell.width,
      height: Math.max(cell.height, bodyHeight),
    });
  };
  if (input.kind === "cycle") {
    // Prototype radius is in reference pixels at a 17px bond length.
    const radius = (input.radius ?? 150) / 17,
      branch = radius * (input.branch ?? 0.3);
    const angles = measured.map(
      (_, i) => -Math.PI / 2 + (2 * Math.PI * i) / measured.length,
    );
    const gaps = measured.map(
      (cell, i) =>
        (Math.abs((cell.width / 2) * Math.sin(angles[i])) +
          Math.abs((cell.height / 2) * Math.cos(angles[i])) +
          0.7) /
        radius,
    );
    const point = (cx: number, cy: number, r: number, a: number): Point => ({
      x: cx + r * Math.cos(a),
      y: cy + r * Math.sin(a),
    });
    const arc = (
      id: string,
      cx: number,
      cy: number,
      r: number,
      a: number,
      b: number,
    ) => {
      const k = (4 / 3) * Math.tan((b - a) / 4),
        from = point(cx, cy, r, a),
        to = point(cx, cy, r, b);
      scene.reactionArrows!.push({
        id,
        from,
        to,
        controls: [
          { x: from.x - k * r * Math.sin(a), y: from.y + k * r * Math.cos(a) },
          { x: to.x + k * r * Math.sin(b), y: to.y - k * r * Math.cos(b) },
        ],
      });
      boxes.push({ x: cx - r, y: cy - r, width: 2 * r, height: 2 * r });
    };
    const beyond = (
      text: string,
      x: number,
      y: number,
      dx: number,
      dy: number,
      gap: number,
    ) => {
      const b = textBlock(text),
        k =
          gap +
          Math.min(
            Math.abs(dx) > 1e-6 ? b.width / 2 / Math.abs(dx) : Infinity,
            Math.abs(dy) > 1e-6 ? b.height / 2 / Math.abs(dy) : Infinity,
          );
      return { x: x + dx * k, y: y + dy * k };
    };
    measured.forEach((cell, i) =>
      putCell(cell, radius * Math.cos(angles[i]), radius * Math.sin(angles[i])),
    );
    const labels: { text: string; angle: number; distance: number }[] = [];
    measured.forEach((_, i) => {
      const step = input.cycleSteps?.[i] ?? {},
        j = (i + 1) % measured.length;
      const a = angles[i] + gaps[i],
        b = angles[i] + (2 * Math.PI) / measured.length - gaps[j];
      if (a >= b)
        throw new Error(
          `figure.nodes[${i}]: species exceed cycle spacing; increase radius`,
        );
      arc(`step-${i + 1}`, 0, 0, radius, a, b);
      const mid = (a + b) / 2,
        ux = Math.cos(mid),
        uy = Math.sin(mid),
        base = mid + Math.PI,
        phi = (62 * Math.PI) / 180;
      let distance = radius + 1;
      for (const [key, sign] of [
        ["in", 1],
        ["out", -1],
      ] as const) {
        const text = words(step[key]);
        if (!text) continue;
        const cx = (radius + branch) * ux,
          cy = (radius + branch) * uy,
          end = base + sign * phi;
        arc(
          `${key}-${i + 1}`,
          cx,
          cy,
          branch,
          key === "in" ? end : base,
          key === "in" ? base : end,
        );
        const p = point(cx, cy, branch, end),
          center = beyond(
            text,
            p.x,
            p.y,
            -sign * Math.sin(end),
            sign * Math.cos(end),
            0.5,
          );
        putText(text, center.x, center.y);
        distance = radius + branch * (1 - Math.cos(phi)) + 2.4;
      }
      if (step.label !== undefined)
        labels.push({
          text: words(step.label)
            .split("\n")
            .map((line) => `*${line}*`)
            .join("\n"),
          angle: mid,
          distance,
        });
    });
    // As in the prototype, step labels slide outward until clear of species and branches.
    for (const label of labels) {
      const ux = Math.cos(label.angle),
        uy = Math.sin(label.angle);
      let distance = label.distance;
      for (;;) {
        const p = beyond(label.text, distance * ux, distance * uy, ux, uy, 0),
          b = textBlock(label.text);
        const candidate = {
          x: p.x - b.width / 2 - 0.5,
          y: p.y - b.height / 2 - 0.3,
          width: b.width + 1,
          height: b.height + 0.6,
        };
        // Arc extents are canvas bounds, not label obstacles.
        const occupied = scene.captions!.map((c) => ({
          ...measuredText(c.text),
          x: c.at.x - measuredText(c.text).width / 2,
          y: c.at.y + measuredText(c.text).y,
        }));
        const species = measured.map((c, i) => ({
          x: radius * Math.cos(angles[i]) - c.width / 2,
          y: radius * Math.sin(angles[i]) - c.height / 2,
          width: c.width,
          height: c.height,
        }));
        if (
          ![...occupied, ...species].some(
            (o) =>
              candidate.x < o.x + o.width &&
              o.x < candidate.x + candidate.width &&
              candidate.y < o.y + o.height &&
              o.y < candidate.y + candidate.height,
          )
        ) {
          putText(label.text, p.x, p.y);
          break;
        }
        distance += 0.5;
      }
    }
  } else {
    let y = 0;
    const width = ctx.token("--chemical-route-width") / B;
    const groups: NonNullable<FigureInput["groups"]> =
      input.kind === "scope"
        ? input.groups!
        : [{ items: measured.map((c) => c.key) }];
    for (const group of groups) {
      if (group.title !== undefined) {
        const h = textBlock(words(group.title)).height;
        putText(`**${group.title}**`, width / 2, y + h / 2);
        y += h + 0.9;
      }
      if (group.subtitle !== undefined) {
        const text = `*${group.subtitle}*`,
          b = textBlock(text);
        putText(text, b.width / 2, y + b.height / 2);
        y += b.height + 0.5;
      }
      const rows: (typeof measured)[] = [];
      let row: typeof measured = [],
        used = 0;
      for (const key of group.items) {
        const cell = measured.find((c) => c.key === String(key))!;
        if (
          row.length &&
          (input.kind === "gallery"
            ? row.length >= (input.cols ?? 4)
            : used + 1.4 + cell.width > width)
        ) {
          rows.push(row);
          row = [];
          used = 0;
        }
        used += (row.length ? 1.4 : 0) + cell.width;
        row.push(cell);
      }
      if (row.length) rows.push(row);
      const cols = input.cols ?? 4;
      const colWidths = Array.from(
        { length: Math.min(cols, measured.length) },
        (_, i) =>
          Math.max(
            ...measured.filter((_, j) => j % cols === i).map((c) => c.width),
          ),
      );
      for (const row of rows) {
        const bodyHeight = Math.max(...row.map((c) => c.body.height)),
          height =
            bodyHeight + Math.max(...row.map((c) => c.height - c.body.height));
        const spacing = Math.min(
          Math.max(0, width - row.reduce((n, c) => n + c.width, 0)) /
            row.length,
          5,
        );
        let x = input.kind === "scope" ? spacing / 2 : 0;
        row.forEach((cell, i) => {
          const w = input.kind === "scope" ? cell.width : colWidths[i];
          // Shared body height aligns structures and all number/yield rows.
          putCell(
            { ...cell, height: height },
            x + w / 2,
            y + height / 2,
            bodyHeight,
          );
          x += w + (input.kind === "scope" ? spacing : 2.2);
        });
        y += height + 1.6;
      }
      y += 0.6;
    }
  }
  const bounds = unionBoxes(boxes)!;
  const dx = 1 - bounds.x,
    dy = 1 - bounds.y;
  for (const p of [
    ...scene.molecules.map((m) => m.at),
    ...scene.captions!.map((c) => c.at),
    ...scene.reactionArrows!.flatMap((a) => [
      a.from,
      a.to,
      ...(a.controls ?? []),
    ]),
  ]) {
    p.x += dx;
    p.y += dy;
  }
  scene.width = bounds.width + 2;
  scene.height = bounds.height + 2;
  return scene;
}
