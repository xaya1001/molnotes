import { markushRepeatDrawing } from "../../../shared/patent-markush-chemistry.ts";
import type {
  FigureGeometry,
  FigureNode,
} from "../../../shared/chemical-library/geometry.ts";
import type {
  Compound,
  LibraryMarkush,
  Point,
} from "../../../shared/chemical-library/types.ts";
import type {
  MarkushAlternative,
  MarkushFigureData,
} from "../../../shared/chemical-library/markush.ts";
import {
  graphOf,
  openMolecule,
  prepareCompound,
  type Toolkit,
} from "../../../shared/chemical-library/chemistry.ts";
import { mappedDummies } from "../../../shared/reaction-chemistry.ts";
import {
  createFigureScene,
  type FigureGroup,
  type FigureStyle,
} from "./scene-geometry.ts";
import type { FigureFontResolver } from "./font-geometry.ts";
import { refreshGeometry } from "./geometry-tree.ts";

type Block = { node: FigureGroup; w: number; h: number };
type Drawing = Block & { anchors: Record<string, Point[]> };
const supers = "⁰¹²³⁴⁵⁶⁷⁸⁹ᵃᵇᶜᵈᵉᶠᵍʰⁱʲᵏ";
const rich = (text: string) =>
  text
    .replace(
      /[⁰¹²³⁴⁵⁶⁷⁸⁹ᵃᵇᶜᵈᵉᶠᵍʰⁱʲᵏ]+/gu,
      (s) =>
        `^{${[...s].map((c) => "0123456789abcdefghijk"[supers.indexOf(c)]).join("")}}`,
    )
    .replace(/(?<![A-Za-z])C(\d+)[–-](\d+)/g, "C_{$1–$2}");
const nativeLabel = (text: string) =>
  rich(text)
    .replace(/\^\{([^}]+)\}/g, "<sup>$1</sup>")
    .replace(/_\{([^}]+)\}/g, "<sub>$1</sub>");
const count = (n: number | (string | number)[] | undefined) =>
  Array.isArray(n) ? n.length : (n ?? 0);
const signature = (g: MarkushFigureData["groups"][string]) =>
  JSON.stringify({
    ...g,
    label: undefined,
    positions: undefined,
    count: undefined,
    alternatives: g.alternatives.map((a) => ({ ...a, id: undefined })),
  });

/** Prototype formula/table and two-column map, using the website's measured glyphs and molecules. */
export async function prepareMarkush(
  entry: LibraryMarkush,
  options: { toolkit: Toolkit; fonts: FigureFontResolver; style: FigureStyle },
  renderCompound: (compound: Compound) => Promise<FigureGeometry>,
): Promise<FigureGeometry> {
  const ctx = createFigureScene(options.style, options.fonts),
    B = ctx.token("--chemical-bond"),
    size = ctx.token("--chemical-caption-font"),
    ink = ctx.value("--chemical-ink");
  const root = ctx.element("g", {
    "data-figure": entry.id,
    role: "img",
    "aria-label": entry.title,
  });
  let serial = 0;
  const put = (parent: FigureGroup, block: Block, x: number, y: number) => {
    const group = ctx.element("g", { transform: `translate(${x} ${y})` });
    ctx.append(group, block.node);
    ctx.append(parent, group);
  };
  const line = (parent: FigureGroup, a: Point, b: Point, color = ink) => {
    const n = ctx.element("path", {
      d: `M${a.x} ${a.y}L${b.x} ${b.y}`,
      fill: "none",
      stroke: color,
    });
    ctx.setStyle(n, "strokeWidth", String(ctx.token("--chemical-line")));
    ctx.append(parent, n);
    return n;
  };
  const text = (
    value: string,
    max = Infinity,
    font = size,
    bold = false,
  ): Block => {
    const node = ctx.element("g"),
      lines: string[] = [];
    for (const paragraph of rich(value).split("\n")) {
      // Keep markup and words whole, while allowing CJK prose to wrap at glyph boundaries.
      const tokens =
        paragraph.match(
          /\^\{[^}]*\}|_\{[^}]*\}|\*\*|[A-Za-z0-9–\-.,()/=]+|./gu,
        ) ?? [];
      let current = "";
      for (const token of tokens) {
        if (
          current &&
          ctx.textWidth(
            bold ? `**${current + token}**` : current + token,
            String(font),
          ) > max
        ) {
          lines.push(current);
          current = token;
        } else current += token;
      }
      lines.push(current);
    }
    let y = 0,
      w = 0;
    for (const value of lines) {
      const n = ctx.label(
          { x: 0, y: 0 },
          bold ? `**${value}**` : value,
          String(font),
          "start",
        ),
        box = ctx.box(n);
      ctx.set(n, "x", -box.x);
      ctx.set(n, "y", y - box.y);
      ctx.setData(n, "label", `${entry.id}:text:${serial++}`);
      ctx.append(node, n);
      w = Math.max(w, box.width, n.advance);
      y += Math.max(box.height, font) + font * 0.3;
    }
    return { node, w, h: y - font * 0.3 };
  };
  const crop = (node: FigureGroup): Block => {
    const box = ctx.box(node),
      group = ctx.element("g", { transform: `translate(${-box.x} ${-box.y})` });
    ctx.append(group, node);
    const outer = ctx.element("g");
    ctx.append(outer, group);
    return { node: outer, w: box.width, h: box.height };
  };
  const draw = async (
    smiles: string,
    groups: MarkushFigureData["groups"] = {},
    rotation = 0,
    flip?: "h" | "v",
  ): Promise<Drawing> => {
    const rd = options.toolkit,
      mol = openMolecule(rd, smiles.split(" |", 1)[0]),
      prefix = `m${serial++}`;
    try {
      mol.set_new_coords();
      const graph = graphOf(mol),
        dummies = mappedDummies(mol);
      if (groups === entry.groups) {
        if (
          !dummies.length ||
          dummies.some((d) => !groups[String(d.map)] || d.map <= 0) ||
          new Set(dummies.map((d) => d.map)).size !== dummies.length
        )
          throw new Error(
            `${entry.id}: each core attachment needs a distinct R definition`,
          );
        for (const d of dummies) {
          const bonds = graph.bonds.filter((b) => b.atoms.includes(d.atom));
          if (bonds.length !== 1 || (bonds[0].bo ?? 1) !== 1)
            throw new Error(
              `${entry.id}: R attachments must be terminal single bonds`,
            );
        }
        for (const g of Object.values(groups))
          if (
            g.positions?.some(
              (i) => i >= graph.atoms.length || graph.atoms[i].z === 0,
            )
          )
            throw new Error(`${entry.id}: invalid variable position`);
      }
      const c = prepareCompound(rd, {
        id: "cmp_markush",
        title: entry.title,
        smiles: smiles.split(" |", 1)[0].replace(/:\d+(?=\])/g, ""),
        sources: entry.sources,
      });
      const repeated = openMolecule(rd, smiles);
      let substanceGroups: {
        properties: { TYPE: string; LABEL?: string };
        atoms: number[];
      }[];
      try {
        substanceGroups =
          JSON.parse(repeated.get_json()).molecules[0].substanceGroups ?? [];
      } finally {
        repeated.delete();
      }
      c.layout.repeatUnits = substanceGroups
        .filter((g) => g.properties.TYPE === "SRU")
        .map((g) => ({
          atoms: g.atoms.map((i) => c.atomIds[i]),
          label: g.properties.LABEL ?? "n",
        }));
      c.template = dummies.map((d) => ({
        atom: c.atomIds[d.atom],
        label: nativeLabel(groups[String(d.map)]?.label ?? ""),
        allowed: [],
        description: "R attachment",
      }));
      const floating = dummies.filter(
        (d) => (groups[String(d.map)]?.positions?.length ?? 0) > 1,
      );
      for (const d of floating)
        c.template!.find((t) => t.atom === c.atomIds[d.atom])!.label = "";
      const rings: number[][] =
        JSON.parse(mol.get_json()).molecules[0].extensions?.find(
          (e: { name: string }) => e.name === "rdkitRepresentation",
        )?.atomRings ?? [];
      const coords = c.layout.coords;
      // Geminal terminal groups splay around the ring's outward bisector.
      for (let i = 0; i < graph.atoms.length; i++) {
        const ns = graph.bonds
          .filter((b) => b.atoms.includes(i))
          .map((b) => b.atoms.find((a) => a !== i)!);
        const ends = ns.filter(
            (n) => graph.bonds.filter((b) => b.atoms.includes(n)).length === 1,
          ),
          ring = rings.find((r) => r.includes(i));
        const rn = ns.filter((n) => ring?.includes(n));
        if (ends.length !== 2 || rn.length !== 2 || ns.length !== 4) continue;
        const p = coords[c.atomIds[i]],
          a = coords[c.atomIds[rn[0]]],
          b = coords[c.atomIds[rn[1]]];
        const angle = Math.atan2(p.y - (a.y + b.y) / 2, p.x - (a.x + b.x) / 2);
        ends.sort(
          (a, b) =>
            Math.sin(
              Math.atan2(
                coords[c.atomIds[b]].y - p.y,
                coords[c.atomIds[b]].x - p.x,
              ) - angle,
            ) -
            Math.sin(
              Math.atan2(
                coords[c.atomIds[a]].y - p.y,
                coords[c.atomIds[a]].x - p.x,
              ) - angle,
            ),
        );
        ends.forEach((n, j) => {
          const q = coords[c.atomIds[n]],
            length = Math.hypot(q.x - p.x, q.y - p.y),
            t = angle + ((j ? -1 : 1) * 32 * Math.PI) / 180;
          coords[c.atomIds[n]] = {
            x: p.x + length * Math.cos(t),
            y: p.y + length * Math.sin(t),
          };
        });
      }
      for (const p of Object.values(coords)) {
        if (flip === "h") p.x *= -1;
        if (flip === "v") p.y *= -1;
        const a = (-rotation * Math.PI) / 180,
          x = p.x;
        p.x = x * Math.cos(a) - p.y * Math.sin(a);
        p.y = x * Math.sin(a) + p.y * Math.cos(a);
      }
      const geometry = await renderCompound(c),
        node = ctx.element("g");
      ctx.append(node, geometry.root);
      const positions = c.atomIds.map(
        (id) => geometry.atomPoints[`compound:${id}`],
      );
      const hidden = new Set(
        floating.flatMap((d) =>
          graph.bonds.flatMap((b, i) => (b.atoms.includes(d.atom) ? [i] : [])),
        ),
      );
      const prune = (n: FigureNode) => {
        for (const [k, v] of Object.entries(n.attributes))
          n.attributes[k] = v.replaceAll("compound:", prefix + ":");
        if (n.attributes["data-molecule"] === "compound")
          n.attributes["data-molecule"] = prefix;
        if (n.kind === "group") {
          n.children = n.children.filter(
            (child) =>
              !hidden.has(
                Number(
                  /:b(\d+)$/.exec(child.attributes["data-bond"] ?? "")?.[1] ??
                    -1,
                ),
              ),
          );
          n.children.forEach(prune);
        }
      };
      prune(node);
      for (const n of ctx.nodes(node)) {
        if (
          n.kind !== "text" ||
          !n.attributes["data-label"]?.includes(":repeat:")
        )
          continue;
        const bounds = ctx.inkBox(n, node),
          lower = ctx.box(node).bottom;
        ctx.set(n, "y", n.position.y + lower - bounds.top + B * 0.15);
      }
      for (const d of dummies.filter((d) => !groups[String(d.map)])) {
        const p = positions[d.atom],
          neighbor = graph.bonds
            .find((b) => b.atoms.includes(d.atom))
            ?.atoms.find((i) => i !== d.atom);
        if (neighbor === undefined)
          throw new Error(`${entry.id}: fragment attachment needs a bond`);
        const q = positions[neighbor],
          length = Math.hypot(p.x - q.x, p.y - q.y),
          ux = (p.x - q.x) / length,
          uy = (p.y - q.y) / length;
        const points = Array.from({ length: 37 }, (_, i) => {
          const t = i / 18 - 1;
          return {
            x:
              p.x -
              uy * t * 0.35 * B +
              ux * Math.sin(t * 3 * Math.PI) * 0.08 * B,
            y:
              p.y +
              ux * t * 0.35 * B +
              uy * Math.sin(t * 3 * Math.PI) * 0.08 * B,
          };
        });
        const wave = ctx.element("path", {
          d: points.map((p, i) => `${i ? "L" : "M"}${p.x} ${p.y}`).join(""),
          fill: "none",
          stroke: ink,
        });
        ctx.setStyle(wave, "strokeWidth", String(ctx.token("--chemical-line")));
        ctx.append(node, wave);
      }
      const anchors: Record<string, Point[]> = {};
      for (const d of dummies) {
        if (!groups[String(d.map)]) continue;
        if (!floating.includes(d)) anchors[String(d.map)] = [positions[d.atom]];
      }
      const used = new Set<string>();
      for (const d of floating) {
        const g = groups[String(d.map)],
          ring = [...rings].sort(
            (a, b) =>
              b.filter((i) => g.positions!.includes(i)).length -
              a.filter((i) => g.positions!.includes(i)).length,
          )[0];
        if (!ring || !ring.some((i) => g.positions!.includes(i)))
          throw new Error(`${entry.id}: variable positions need a ring`);
        const centre = {
          x: ring.reduce((s, i) => s + positions[i].x, 0) / ring.length,
          y: ring.reduce((s, i) => s + positions[i].y, 0) / ring.length,
        };
        const candidates = ring
          .map((a, i) => {
            const b = ring[(i + 1) % ring.length],
              p = positions[a],
              q = positions[b],
              mid = { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 },
              dist = Math.hypot(mid.x - centre.x, mid.y - centre.y),
              ux = (mid.x - centre.x) / dist,
              uy = (mid.y - centre.y) / dist;
            const key = [a, b].sort((a, b) => a - b).join(":"),
              free = [a, b].every(
                (n) =>
                  graph.bonds.filter((b) => b.atoms.includes(n)).length === 2,
              ),
              clear = Math.min(
                ...positions
                  .filter(
                    (_, j) =>
                      !ring.includes(j) && !dummies.some((d) => d.atom === j),
                  )
                  .map((p) =>
                    Math.hypot(
                      p.x - mid.x - ux * 1.6 * B,
                      p.y - mid.y - uy * 1.6 * B,
                    ),
                  ),
                3 * B,
              );
            return {
              key,
              mid,
              dist,
              ux,
              uy,
              score:
                (free ? 100 : 0) +
                [a, b].filter((n) => g.positions!.includes(n)).length * 10 +
                clear / B +
                ux -
                uy / 10,
            };
          })
          .filter((c) => !used.has(c.key))
          .sort((a, b) => b.score - a.score);
        if (!candidates.length)
          throw new Error(
            `${entry.id}: no separate ring bond for variable group`,
          );
        const p = candidates[0];
        used.add(p.key);
        const tip = {
          x: p.mid.x + p.ux * B * 0.85,
          y: p.mid.y + p.uy * B * 0.85,
        };
        const bond = line(
          node,
          {
            x: p.mid.x - p.ux * p.dist * 0.55,
            y: p.mid.y - p.uy * p.dist * 0.55,
          },
          tip,
        );
        ctx.setData(bond, "floating-bond", String(d.map));
        const lb = text(
          g.count ? `(${g.label})_{${g.count}}` : g.label,
          Infinity,
          ctx.token("--chemical-font"),
        );
        const x =
            tip.x +
            (Math.abs(p.ux) > 0.5
              ? p.ux > 0
                ? B * 0.25
                : -B * 0.25 - lb.w
              : -lb.w / 2),
          y =
            tip.y +
            (Math.abs(p.ux) > 0.5
              ? -lb.h / 2
              : p.uy < 0
                ? -lb.h - B * 0.15
                : B * 0.15);
        put(node, lb, x, y);
        anchors[String(d.map)] = [{ x: x + lb.w / 2, y: y + lb.h / 2 }];
      }
      const box = ctx.box(node),
        result = crop(node);
      for (const points of Object.values(anchors))
        for (const p of points) {
          p.x -= box.x;
          p.y -= box.y;
        }
      return { ...result, anchors };
    } finally {
      mol.delete();
    }
  };
  const core = await draw(entry.core, entry.groups, entry.rot, entry.flip);
  const merged = new Map<
    string,
    { keys: string[]; group: MarkushFigureData["groups"][string] }
  >();
  for (const [key, group] of Object.entries(entry.groups)) {
    const sig = signature(group),
      existing = merged.get(sig);
    if (existing) existing.keys.push(key);
    else merged.set(sig, { keys: [key], group });
  }
  const groups = [...merged.values()];
  let width = 0,
    height = 0;
  const chip = (
    label: string,
    states: (number | null)[],
    overlay: boolean,
  ): Block => {
    const px = size * 0.55,
      py = size * 0.24,
      sq = size * 0.72,
      lead = overlay ? states.length * (sq + 2) + size * 0.25 : 0;
    const title = text(label, B * 18 - lead, size),
      w = title.w + 2 * px + lead,
      h = title.h + 2 * py,
      node = ctx.element("g", {
        "data-alternative": label,
        "data-coverage": JSON.stringify(states),
      });
    const nobody = states.every((s) => s === null),
      filled = !overlay && !!states[0],
      color = nobody
        ? ctx.value("--chemical-focus")
        : filled
          ? ctx.value("--chemical-markush-example")
          : overlay
            ? ctx.value("--chemical-markush-rule")
            : ctx.value("--chemical-markush-claim");
    const r = Math.min(h / 2, size * 0.85),
      box = ctx.element("path", {
        d: `M${r} 0H${w - r}Q${w} 0 ${w} ${r}V${h - r}Q${w} ${h} ${w - r} ${h}H${r}Q0 ${h} 0 ${h - r}V${r}Q0 0 ${r} 0Z`,
        fill:
          nobody || overlay
            ? ctx.value("--chemical-markush-paper")
            : filled
              ? color
              : ctx.value("--chemical-markush-claim-fill"),
        stroke: color,
      });
    ctx.setStyle(box, "strokeWidth", "1.1");
    if (nobody) ctx.set(box, "stroke-dasharray", "4 3");
    ctx.append(node, box);
    if (overlay)
      states.forEach((s, i) => {
        const x = px + i * (sq + 2),
          y = (h - sq) / 2,
          c = ctx.value(
            `--chemical-markush-patent-${["one", "two", "three", "four"][i % 4]}`,
          );
        if (s === null)
          ctx.append(
            node,
            ctx.element("circle", {
              cx: x + sq / 2,
              cy: y + sq / 2,
              r: 1.2,
              fill: ctx.value("--chemical-markush-rule"),
            }),
          );
        else {
          const n = ctx.element("path", {
            d: `M${x} ${y}h${sq}v${sq}h${-sq}Z`,
            fill: s ? c : ctx.value("--chemical-markush-paper"),
            stroke: c,
          });
          ctx.setStyle(n, "strokeWidth", "1.2");
          ctx.append(node, n);
        }
      });
    for (const n of ctx.nodes(title.node))
      if (n.kind === "text")
        ctx.setStyle(
          n,
          "fill",
          filled
            ? ctx.value("--chemical-markush-paper")
            : nobody
              ? ctx.value("--chemical-focus")
              : ink,
        );
    put(node, title, px + lead, py);
    return { node, w, h };
  };
  const chips = (g: MarkushFigureData["groups"][string]) => {
    const patents = Object.keys(entry.patents ?? {}),
      overlay = entry.view === "overlay";
    return [
      ...g.alternatives.map((a) => ({
        label: a.label,
        states: overlay
          ? patents.map((p) =>
              a.by?.[p] === undefined ? null : count(a.by[p]),
            )
          : [count(a.examples)],
      })),
      ...(g.outside ?? []).map((a) => ({
        label: typeof a === "string" ? a : a.label,
        states: overlay
          ? patents.map((p) =>
              typeof a === "string" || a.by?.[p] === undefined
                ? null
                : count(a.by[p]),
            )
          : [null],
      })),
    ].map((a) =>
      chip(
        a.label + (!overlay && a.states[0] ? ` ×${a.states[0]}` : ""),
        a.states,
        overlay,
      ),
    );
  };
  const flow = (blocks: Block[], max: number, gap = size * 0.4): Block => {
    const node = ctx.element("g");
    let x = 0,
      y = 0,
      row = 0,
      w = 0;
    for (const block of blocks) {
      if (x && x + block.w > max) {
        x = 0;
        y += row + gap;
        row = 0;
      }
      put(node, block, x, y);
      w = Math.max(w, x + block.w);
      x += block.w + gap;
      row = Math.max(row, block.h);
    }
    return { node, w, h: y + row };
  };
  const alternative = async (a: MarkushAlternative): Promise<Block> => {
    if (a.type === "fragment") {
      const d = await draw(a.smiles);
      const caption = text(a.label, Math.max(d.w, B * 8), size * 0.92);
      const node = ctx.element("g"),
        w = Math.max(d.w, caption.w);
      put(node, d, (w - d.w) / 2, 0);
      put(node, caption, (w - caption.w) / 2, d.h + B * 0.15);
      return { node, w, h: d.h + B * 0.15 + caption.h };
    }
    if (a.type === "substituted") {
      const mol = openMolecule(options.toolkit, a.core);
      try {
        const rings: number[][] =
            JSON.parse(mol.get_json()).molecules[0].extensions?.find(
              (e: { name: string }) => e.name === "rdkitRepresentation",
            )?.atomRings ?? [],
          dummy = mappedDummies(mol)[0];
        if (rings.length && dummy) {
          const d = await draw(a.core, {
              [String(dummy.map)]: {
                label: entry.groups[a.group].label,
                count: `${a.min}–${a.max}`,
                positions: [...new Set(rings.flat())],
                alternatives: [],
              },
            }),
            cap = text(a.label, Math.max(d.w, B * 8), size * 0.92),
            node = ctx.element("g"),
            w = Math.max(d.w, cap.w);
          put(node, d, (w - d.w) / 2, 0);
          put(node, cap, (w - cap.w) / 2, d.h + B * 0.15);
          return { node, w, h: d.h + B * 0.15 + cap.h };
        }
      } finally {
        mol.delete();
      }
    }
    if (a.type === "repeat") {
      const d = await draw(markushRepeatDrawing(options.toolkit, a));
      const caption = text(
        `${a.label}\nn = ${a.min === a.max ? a.min : `${a.min}–${a.max}`}`,
        Math.max(d.w, B * 8.5),
        size * 0.92,
      );
      const node = ctx.element("g"),
        w = Math.max(d.w, caption.w);
      put(node, d, (w - d.w) / 2, 0);
      put(node, caption, (w - caption.w) / 2, d.h + B * 0.15);
      return { node, w, h: d.h + B * 0.15 + caption.h };
    }
    return text(a.label, B * 19);
  };
  if ((entry.view ?? "formula") === "formula") {
    const rows = [];
    for (const { keys, group } of groups) {
      const label = text(
        keys.map((k) => entry.groups[k].label).join(" / "),
        Infinity,
        size,
        true,
      );
      const cells = await Promise.all(group.alternatives.map(alternative));
      if (group.unmodeled)
        cells.push(text(`未建模：${group.unmodeled}`, B * 19, size * 0.9));
      rows.push({ label, body: flow(cells, B * 22, B * 0.65) });
    }
    if (entry.unmodeled)
      rows.push({
        label: text("整体", Infinity, size, true),
        body: text(`未建模：${entry.unmodeled}`, B * 22, size * 0.9),
      });
    const left = Math.max(B * 2, ...rows.map((r) => r.label.w)) + B,
      name = entry.name ? text(entry.name) : undefined;
    width = Math.max(
      core.w + (name ? name.w + B * 1.6 : 0),
      left + Math.max(0, ...rows.map((r) => r.body.w)) + B * 0.5,
    );
    put(root, core, (width - core.w) / 2, 0);
    if (name) put(root, name, width - name.w, core.h - name.h);
    height = core.h + B * 1.2;
    line(root, { x: 0, y: height }, { x: width, y: height });
    for (const r of rows) {
      const y = height + B * 0.5;
      put(root, r.label, B * 0.5, y);
      put(root, r.body, left, y);
      height = y + Math.max(r.label.h, r.body.h) + B * 0.5;
      line(
        root,
        { x: 0, y: height },
        { x: width, y: height },
        ctx.value("--chemical-markush-rule"),
      );
    }
    line(root, { x: 0, y: height }, { x: width, y: height });
  } else {
    const calls = groups.map(({ keys, group }) => {
      const title = text(
          keys.map((k) => entry.groups[k].label).join(" / "),
          Infinity,
          size + 1,
          true,
        ),
        body = flow(chips(group), B * 21),
        node = ctx.element("g"),
        w = Math.max(title.w, body.w);
      put(node, title, 0, 0);
      put(node, body, 0, title.h + size * 0.4);
      const points = keys.flatMap((k) => core.anchors[k] ?? []),
        anchor = points.length
          ? {
              x: points.reduce((s, p) => s + p.x, 0) / points.length,
              y: points.reduce((s, p) => s + p.y, 0) / points.length,
            }
          : undefined;
      return { keys, group, node, w, h: title.h + size * 0.4 + body.h, anchor };
    });
    const attached = calls
      .filter((c) => c.anchor)
      .sort(
        (a, b) =>
          ((Math.atan2(a.anchor!.x - core.w / 2, core.h / 2 - a.anchor!.y) +
            2 * Math.PI) %
            (2 * Math.PI)) -
          ((Math.atan2(b.anchor!.x - core.w / 2, core.h / 2 - b.anchor!.y) +
            2 * Math.PI) %
            (2 * Math.PI)),
      );
    let nr = attached.filter((c) => c.anchor!.x >= core.w / 2).length;
    if (Math.abs(2 * nr - attached.length) > 1)
      nr = Math.ceil(attached.length / 2);
    const right = attached.slice(0, nr),
      left = attached.slice(nr).reverse(),
      gap = B * 1.1,
      lead = B * 3.2,
      stack = (cs: typeof calls) =>
        cs.reduce((s, c) => s + c.h, 0) + gap * Math.max(0, cs.length - 1),
      wl = Math.max(0, ...left.map((c) => c.w)),
      wr = Math.max(0, ...right.map((c) => c.w));
    const x = wl ? wl + lead : 0;
    height = Math.max(core.h, stack(left), stack(right));
    const cy = (height - core.h) / 2;
    width = x + core.w + (wr ? lead + wr : 0);
    put(root, core, x, cy);
    for (const [side, cs, cx, cw] of [
      ["L", left, 0, wl],
      ["R", right, x + core.w + lead, wr],
    ] as const) {
      let y = (height - stack(cs)) / 2;
      for (const c of cs) {
        put(root, c, side === "L" ? cx + cw - c.w : cx, y);
        const sx = side === "L" ? cx + cw + B * 0.4 : cx - B * 0.4,
          sy = y + size / 2;
        for (const k of c.keys)
          for (const a of core.anchors[k] ?? []) {
            const ax = a.x + x,
              ay = a.y + cy,
              d = Math.hypot(ax - sx, ay - sy),
              ex = ax - ((ax - sx) / d) * B * 0.8,
              ey = ay - ((ay - sy) / d) * B * 0.8;
            line(
              root,
              { x: sx, y: sy },
              { x: ex, y: ey },
              ctx.value("--chemical-markush-rule"),
            );
            ctx.append(
              root,
              ctx.element("circle", {
                cx: ex,
                cy: ey,
                r: 1.7,
                fill: ctx.value("--chemical-markush-rule"),
              }),
            );
          }
        y += c.h + gap;
      }
    }
    for (const c of calls.filter((c) => !c.anchor)) {
      height += gap;
      put(root, c, 0, height);
      height += c.h;
    }
    const overlay = entry.view === "overlay",
      patents = Object.entries(entry.patents ?? {});
    const legend = overlay
      ? [
          ...patents.map(([key, label]) =>
            chip(
              label,
              patents.map(([k]) => (k === key ? 1 : null)),
              true,
            ),
          ),
          flow(
            [
              chip(
                "有实施例",
                patents.map(() => 1),
                true,
              ),
              chip(
                "定义内，无实施例",
                patents.map(() => 0),
                true,
              ),
              chip(
                "定义外",
                patents.map(() => null),
                true,
              ),
            ],
            width,
          ),
          chip(
            "都在定义外",
            patents.map(() => null),
            true,
          ),
        ]
      : [
          chip("定义内，有实施例（×个数）", [1], false),
          chip("定义内，无实施例", [0], false),
          chip("定义外", [null], false),
        ];
    const lb = flow(legend, width);
    height += B * 1.4;
    put(root, lb, 0, height);
    height += lb.h;
    width = Math.max(width, lb.w);
    if (entry.gaps?.length) {
      const title = text(
        entry.gaps_title ?? "未覆盖的组合（化学结构）",
        width,
        size + 1,
        true,
      );
      height += B;
      put(root, title, 0, height);
      height += title.h;
      for (const gap of entry.gaps) {
        const row = flow(
          gap.parts.map((p) =>
            chip(p, overlay ? patents.map(() => null) : [null], overlay),
          ),
          width,
        );
        height += B * 0.5;
        put(root, row, 0, height);
        height += row.h;
        if (gap.note) {
          const note = text(gap.note, width, size * 0.92);
          height += size * 0.3;
          put(root, note, 0, height);
          height += note.h;
        }
      }
    }
  }
  if (entry.footnote) {
    const foot = text(entry.footnote, width, size * 0.92);
    height += B * 0.8;
    put(root, foot, 0, height);
    height += foot.h;
    width = Math.max(width, foot.w);
  }
  const pad = B;
  const wrapper = ctx.element("g", { transform: `translate(${pad} ${pad})` });
  ctx.append(wrapper, ...root.children);
  ctx.append(root, wrapper);
  width += 2 * pad;
  height += 2 * pad;
  // Contents use the same geometry contract, so ordinary diagnostics cover labels and molecules.
  const minimumScale = Math.max(
    ctx.token("--chemical-min-bond") / B,
    ...ctx
      .nodes(root)
      .filter((n) => n.kind === "text")
      .map(
        (n) =>
          ctx.token("--chemical-min-text") /
          (n.kind === "text" ? n.fontSize : size),
      ),
  );
  refreshGeometry(root);
  return { format: 1, root, width, height, minimumScale, atomPoints: {} };
}
