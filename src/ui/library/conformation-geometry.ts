import type { Point } from "../../../shared/chemical-library/types.ts";
import type {
  ConformationSpec,
  SlotText,
} from "../../../shared/chemical-templates/conformation.ts";
import { conformations } from "../../../scripts/figure-template-data.ts";
import type { FigureScene } from "./scene-geometry.ts";
import { visibleSegments } from "./template-segments.ts";

type XY = [number, number];
type Box = [number, number, number, number];
const add = (a: XY, b: XY, k = 1): XY => [a[0] + b[0] * k, a[1] + b[1] * k];
const unit = (v: XY): XY => {
  const n = Math.hypot(...v) || 1;
  return [v[0] / n, v[1] / n];
};
const point = ([x, y]: XY): Point => ({ x, y });
const reversed: Record<string, string> = {
  CH3: "H3C",
  OH: "HO",
  NH2: "H2N",
  SH: "HS",
  CH2OH: "HOH2C",
  CO2H: "HO2C",
  CO2Me: "MeO2C",
  CO2Et: "EtO2C",
  NHBoc: "BocHN",
  NHAc: "AcHN",
  CF3: "F3C",
};
const sub = (value: SlotText) =>
  typeof value === "string" ? { t: value } : value;
const reface = (slot: string) =>
  slot.replace(/[ae]$/, (s) => (s === "a" ? "e" : "a"));
function touches(a: Box, b: Box, pad: number) {
  return (
    Math.abs(a[0] - b[0]) < a[2] + b[2] + pad &&
    Math.abs(a[1] - b[1]) < a[3] + b[3] + pad
  );
}
function hits(p: XY, q: XY, b: Box, pad: number) {
  let lo = 0,
    hi = 1;
  for (const i of [0, 1]) {
    const v = q[i] - p[i],
      low = b[i] - b[i + 2] - pad,
      high = b[i] + b[i + 2] + pad;
    if (Math.abs(v) < 1e-9) {
      if (p[i] < low || p[i] > high) return false;
    } else {
      const a = (low - p[i]) / v,
        c = (high - p[i]) / v;
      lo = Math.max(lo, Math.min(a, c));
      hi = Math.min(hi, Math.max(a, c));
      if (lo > hi) return false;
    }
  }
  return true;
}
/** The saved ring geometry and text-placement rules are shared by previews and publication. */
export function conformationGeometry(spec: ConformationSpec, ctx: FigureScene) {
  const B = ctx.token("--chemical-bond"),
    S = ctx.token("--chemical-line"),
    ink = ctx.value("--chemical-ink");
  const group = ctx.element("g", { "data-conformation": spec.template });
  let serial = 0;
  const measure = (t: string) => ctx.textWidth(t, "var(--chemical-font)");
  const glyph = (t: string): [number, number] => {
    const box = ctx.box(ctx.label({ x: 0, y: 0 }, t));
    return [box.width / 2, box.height / 2];
  };
  const line = (p: XY, q: XY, color = ink, width = 1, dash = false) => {
    const n = ctx.element("path", {
      d: `M${p} L${q}`,
      fill: "none",
      stroke: color,
      "stroke-width": S * width,
      "stroke-linecap": "round",
      ...(dash ? { "stroke-dasharray": `${S * 2.6} ${S * 2.4}` } : {}),
    });
    if (!spec.slots) ctx.setData(n, "bond", `conformation:line${serial++}`);
    ctx.append(group, n);
    return n;
  };
  const poly = (ps: XY[], color = ink) =>
    ctx.append(
      group,
      ctx.element("path", { d: `M${ps.join(" L")} Z`, fill: color }),
    );
  const put = (t: string, p: XY, color = ink) => {
    const n = ctx.label(point(p), t),
      box = ctx.box(n);
    ctx.set(n, "y", n.position.y + p[1] - (box.y + box.height / 2));
    ctx.setStyle(n, "fill", color);
    ctx.setData(n, "label", `conformation:text${serial++}`);
    ctx.append(group, n);
  };
  const clip = (p: XY, q: XY, t?: string): XY => {
    if (!t) return p;
    const [hw, hh] = glyph(t),
      d = unit(add(q, p, -1));
    return add(
      p,
      d,
      Math.min(
        Math.abs(d[0]) > 1e-6 ? hw / Math.abs(d[0]) : 1e9,
        Math.abs(d[1]) > 1e-6 ? hh / Math.abs(d[1]) : 1e9,
      ) +
        B * 0.1,
    );
  };
  const layout = (
    text: string,
    end: XY,
    d: XY,
    left = false,
    literal = false,
  ): { shown: string; box: Box } => {
    if (!text) return { shown: "", box: [...end, 0, 0] };
    let t = text;
    if (literal) {
      const [hw, hh] = glyph(t),
        k =
          Math.min(
            Math.abs(d[0]) > 1e-6 ? hw / Math.abs(d[0]) : 1e9,
            Math.abs(d[1]) > 1e-6 ? hh / Math.abs(d[1]) : 1e9,
          ) +
          B * 0.1;
      return { shown: t, box: [...add(end, d, k), hw, hh] };
    }
    left = d[0] < -0.15 || (left && Math.abs(d[0]) <= 0.15);
    if (left) t = reversed[t] ?? t.replace(/^O([A-Z][A-Za-z]*)$/, "$1O");
    const plain = t.replaceAll("*", ""),
      m = left
        ? /([A-Z][a-z]?)(\^?\d+)?(H\d*)?$/.exec(plain)
        : /^[A-Z][a-z]?/.exec(plain);
    let a = left ? (m?.index ?? plain.length - 1) : 0,
      e = m
        ? left
          ? m.index + m[1].length
          : m[0].length
        : left
          ? plain.length
          : 1;
    if (left && m?.[1] === "H" && !m[3] && m.index > 0 && plain.length <= 3) {
      a = m.index;
      e = a + 1;
    }
    const [ghw, ghh] = glyph(plain.slice(a, e)),
      before = a ? measure(plain.slice(0, a)) : 0,
      [hw, hh] = glyph(t);
    const k =
      Math.min(
        Math.abs(d[0]) > 1e-6 ? ghw / Math.abs(d[0]) : 1e9,
        Math.abs(d[1]) > 1e-6 ? ghh / Math.abs(d[1]) : 1e9,
      ) +
      B * 0.1;
    const at = add(end, d, k);
    return { shown: t, box: [at[0] - ghw - before + hw, at[1], hw, hh] };
  };
  const label = (value: SlotText, end: XY, d: XY) => {
    const { t, color } = sub(value);
    if (t) {
      const l = layout(t, end, d);
      put(l.shown, [l.box[0], l.box[1]], color);
    }
  };
  const three = (key: "front" | "back") =>
    spec.slots
      ? [1, 2, 3].map((i) => `${key[0]}${i}`)
      : (spec[key] ?? ["", "", ""]);
  if (spec.template === "newman") {
    const R = B * 0.62,
      rot = spec.rot ?? 0,
      dih = spec.dihedral ?? 60;
    const shown = Math.abs(dih) % 120 < 1 ? dih + (spec.slots ? 35 : 20) : dih,
      offset = (shown - dih) / 2;
    ctx.append(
      group,
      ctx.element("circle", {
        cx: 0,
        cy: 0,
        r: R,
        fill: "none",
        stroke: ink,
        "stroke-width": S,
      }),
    );
    for (const [key, base, r0] of [
      ["back", rot + shown - offset, R],
      ["front", rot - offset, 0],
    ] as const)
      three(key).forEach((value, i) => {
        const a = ((base + 120 * i) * Math.PI) / 180,
          d: XY = [Math.sin(a), -Math.cos(a)],
          end = add([0, 0], d, B * 1.25);
        line(add([0, 0], d, r0), end, sub(value).color);
        label(value, end, d);
      });
  } else if (spec.template === "sawhorse") {
    const f: XY = [0, 0],
      b: XY = [B * 1.5, -B * 0.85],
      back = [80, 170, 320],
      front = (spec.dihedral ?? 60) % 120 > 1 ? [140, 350, 250] : back;
    line(f, b);
    for (const [key, origin, angles] of [
      ["front", f, front],
      ["back", b, back],
    ] as const)
      three(key).forEach((value, i) => {
        const a = (angles[i] * Math.PI) / 180,
          d = unit([Math.cos(a), -Math.sin(a) * 0.9]),
          end = add(origin, d, B * 0.85);
        line(origin, end, sub(value).color);
        label(value, end, d);
      });
  } else if (spec.template === "fischer") {
    let rows = spec.rows ?? [["H", "OH"]];
    if (spec.slots) rows = rows.map((_, i) => [`${i + 1}l`, `${i + 1}r`]);
    const top: XY = [0, -B * 0.9],
      bottom: XY = [0, B * (rows.length - 1) + B * 0.9];
    line(top, bottom);
    label(spec.top ?? (spec.slots ? "top" : ""), top, [0, -1]);
    label(spec.bottom ?? (spec.slots ? "bottom" : ""), bottom, [0, 1]);
    rows.forEach(([l, r], i) => {
      line([-B * 0.85, B * i], [B * 0.85, B * i]);
      label(l, [-B * 0.85, B * i], [-1, 0]);
      label(r, [B * 0.85, B * i], [1, 0]);
    });
  } else {
    const data = conformations.get(spec.template);
    if (!data)
      throw new Error(`Unknown conformation template ${spec.template}`);
    const variant = data.variants[spec.flip ? "flipped" : "normal"],
      angle = ((spec.rot ?? 0) * Math.PI) / 180,
      sign = spec.mirror ? -1 : 1;
    const transform = ([x, y]: XY): XY => [
      sign * x * Math.cos(angle) - y * Math.sin(angle),
      sign * x * Math.sin(angle) + y * Math.cos(angle),
    ];
    const k =
      ((B * (spec.scale ?? data.scale)) / data.scale) * (spec.slots ? 1.5 : 1);
    const xy = Object.fromEntries(
      Object.entries(variant.points).map(([n, p]) => [
        n,
        transform([p[0] * k, p[1] * k]),
      ]),
    );
    const slots = Object.fromEntries(
      Object.entries(variant.slots).map(([s, v]) => [
        s,
        { atom: String(v.atom), direction: transform(v.direction) },
      ]),
    );
    const centre: XY = [0, 1].map(
      (i) =>
        Object.values(xy).reduce((n, p) => n + p[i], 0) /
        Object.keys(xy).length,
    ) as XY;
    const atoms = Object.fromEntries(
      Object.entries({ ...data.atoms, ...spec.atoms }).filter(
        ([, v]) => v && v !== "C",
      ),
    );
    for (const n of Object.keys(spec.atoms ?? {}))
      if (!xy[n]) throw new Error(`Unknown template atom ${n}`);
    for (const key of Object.keys(spec.bonds ?? {}))
      if (
        !data.bonds.some(
          (b) =>
            b.atoms.join("-") === key ||
            [...b.atoms].reverse().join("-") === key,
        )
      )
        throw new Error(`Unknown template bond ${key}`);
    let subs = Object.entries(spec.subs ?? {});
    if (spec.flip && data.reface) subs = subs.map(([s, v]) => [reface(s), v]);
    if (spec.slots)
      subs = Object.keys(slots)
        .filter((s) => (data.reface ? /[ae]$/.test(s) : /[ud]$/.test(s)))
        .map((s) => [s, s]);
    const length = B * (spec.sub_len ?? data.subLength),
      rays: [XY, XY][] = [];
    if (data.id === "cis-decalin")
      for (const [s] of subs) {
        const v = slots[s];
        if (v && ["9", "10"].includes(v.atom))
          rays.push([xy[v.atom], add(xy[v.atom], v.direction, length)]);
      }
    const edges = data.bonds.map(
      (b) => b.atoms.map(String) as [string, string],
    );
    for (const b of data.bonds) {
      let [a, z] = b.atoms.map(String),
        style =
          spec.bonds?.[`${a}-${z}`] ?? spec.bonds?.[`${z}-${a}`] ?? b.style;
      if (spec.bonds?.[`${z}-${a}`]) [a, z] = [z, a];
      if (style === "none") continue;
      const p = clip(xy[a], xy[z], atoms[a]),
        q = clip(xy[z], xy[a], atoms[z]),
        d = unit(add(q, p, -1));
      let normal: XY = [-d[1], d[0]];
      if (
        (centre[0] - (p[0] + q[0]) / 2) * normal[0] +
          (centre[1] - (p[1] + q[1]) / 2) * normal[1] <
        0
      )
        normal = [-normal[0], -normal[1]];
      if (style === "wedge") {
        poly([p, add(q, normal, S * 2.2), add(q, normal, -S * 2.2)]);
        continue;
      }
      for (const [p0, q0] of visibleSegments(p, q, rays, B * 0.13))
        line(p0, q0, ink, style === "bold" ? 4.4 : 1, style === "dashed");
      if (style === "double" || style === "partial")
        line(
          add(add(p, normal, B * 0.17), d, B * 0.16),
          add(add(q, normal, B * 0.17), d, -B * 0.16),
          ink,
          1,
          style === "partial",
        );
    }
    for (const [n, t] of Object.entries(atoms)) put(t, xy[n]);
    const fixed: Box[] = Object.entries(atoms).map(([n, t]) => [
        ...xy[n],
        ...glyph(t),
      ]),
      ring = edges.map(([a, b]) => [xy[a], xy[b]] as [XY, XY]);
    const outward = data.id === "chair" && spec.flip;
    type Choice = { start: XY; end: XY; shown: string; box: Box };
    const items = subs.map(([s, value]) => {
      const slot = slots[s];
      if (!slot) throw new Error(`No slot ${s} in ${spec.template}`);
      let { t, color } = sub(value);
      const { atom, direction: d } = slot;
      if (outward)
        t = Object.entries(reversed).find(([, v]) => v === t)?.[0] ?? t;
      const width = Math.max(
          ...Object.values(xy).map((p) => Math.abs(p[0] - centre[0])),
        ),
        left =
          xy[atom][0] <
          centre[0] - (outward && Math.abs(d[0]) <= 0.15 ? 0 : 0.7 * width),
        start = clip(xy[atom], add(xy[atom], d), atoms[atom]);
      const candidate = (ln: number, align = left): Choice => {
        const end = add(xy[atom], d, ln),
          l = layout(t, end, d, align, spec.slots);
        return { start, end, ...l };
      };
      return { s, color, d, candidate, nominal: candidate(length) };
    });
    const choices = new Map<number, Choice>(),
      placed: [XY, XY][] = [];
    const order = items
      .map((_, i) => i)
      .sort(
        (a, b) =>
          items[b].nominal.box[2] - items[a].nominal.box[2] ||
          items[a].s.localeCompare(items[b].s),
      );
    for (const i of order) {
      const item = items[i],
        occupied = [...fixed, ...[...choices.values()].map((v) => v.box)],
        reserved = items
          .filter((_, j) => j !== i && !choices.has(j))
          .map((v) => v.nominal.box);
      const score = (v: Choice): [number, number, number] => [
        occupied.filter((b) => touches(v.box, b, B * 0.12)).length,
        [...ring, ...placed].filter(([p, q]) => hits(p, q, v.box, B * 0.1))
          .length +
          occupied.filter((b) => hits(v.start, v.end, b, B * 0.1)).length,
        reserved.filter((b) => touches(v.box, b, B * 0.12)).length,
      ];
      const less = (a: number[], b: number[]) => {
        for (let j = 0; j < a.length; j++) {
          if (a[j] !== b[j]) return a[j] < b[j];
        }
        return false;
      };
      let best = item.nominal,
        sc = score(best);
      const alignments =
        outward && !spec.slots && Math.abs(item.d[0]) <= 0.15
          ? [undefined, true, false]
          : [undefined];
      for (let step = 0; step <= 30 && sc.some(Boolean); step++)
        for (const align of alignments) {
          const v = item.candidate(length + step * B * 0.16, align),
            s = score(v);
          if (less(s, sc)) {
            best = v;
            sc = s;
          }
        }
      choices.set(i, best);
      placed.push([best.start, best.end]);
    }
    items.forEach((item, i) => {
      const v = choices.get(i)!;
      line(v.start, v.end, item.color);
    });
    if (spec.slots)
      for (const v of choices.values())
        if (v.shown) {
          const [x, y, hw, hh] = v.box,
            pad = B * 0.08;
          ctx.append(
            group,
            ctx.element("path", {
              d: `M${x - hw - pad} ${y - hh - pad} h${2 * (hw + pad)} v${2 * (hh + pad)} h${-2 * (hw + pad)} Z`,
              fill: "#fff",
            }),
          );
        }
    items.forEach((item, i) => {
      const v = choices.get(i)!;
      if (v.shown) put(v.shown, [v.box[0], v.box[1]], item.color);
    });
    for (const [sa, sb] of spec.clash ?? []) {
      const get = (s: string) => {
        const i = items.findIndex(
          (v) => v.s === (spec.flip && data.reface ? reface(s) : s),
        );
        if (i < 0) throw new Error(`Unknown clash slot ${s}`);
        const v = choices.get(i)!,
          d = items[i].d;
        return add([v.box[0], v.box[1]], d, v.box[3] + B * 0.25);
      };
      const p = get(sa),
        q = get(sb),
        mid: XY = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2],
        out = unit(add(mid, centre, -1)),
        ctl = add(mid, out, Math.hypot(...add(q, p, -1)) * 0.3),
        red = ctx.value("--chemical-focus");
      ctx.append(
        group,
        ctx.element("path", {
          d: `M${p} Q${ctl} ${q}`,
          fill: "none",
          stroke: red,
          "stroke-width": S * 1.1,
        }),
      );
      for (const tip of [p, q]) {
        const d = unit(add(tip, ctl, -1)),
          base = add(tip, d, -B * 0.34),
          normal: XY = [-d[1], d[0]];
        poly(
          [tip, add(base, normal, B * 0.13), add(base, normal, -B * 0.13)],
          red,
        );
      }
    }
  }
  if (spec.bracket) {
    const b = ctx.box(group),
      x = b.x - B * 0.25,
      y = b.y - B * 0.2,
      w = b.width + B * 0.5,
      h = b.height + B * 0.4;
    for (const [edge, dx] of [
      [x, B * 0.2],
      [x + w, -B * 0.2],
    ])
      ctx.append(
        group,
        ctx.element("path", {
          d: `M${edge + dx} ${y} H${edge} V${y + h} H${edge + dx}`,
          fill: "none",
          stroke: ink,
          "stroke-width": S,
        }),
      );
    if (spec.bracket === "ts") put("‡", [x + w + B * 0.4, y]);
  }
  return group;
}
