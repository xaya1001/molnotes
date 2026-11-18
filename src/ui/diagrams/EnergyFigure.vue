<script setup lang="ts">
import ProseCaption from "../ProseCaption.vue";
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  shallowRef,
  watch,
} from "vue";
import DiagramText from "./DiagramText.vue";
import {
  energyNumber as minus,
  type Energy,
  type EnergyRef,
} from "./energy.ts";

const props = defineProps<{ energy: Energy; caption?: string }>();
const root = ref<HTMLElement>();
const width = ref(0);
const em = ref(14);
const labelEls = ref<HTMLElement[]>([]);
const markEls = ref<HTMLElement[]>([]);
const curveEls = ref<SVGPathElement[]>([]);
const yLabel = ref<HTMLElement>();
const xLabel = ref<HTMLElement>();
let observer: ResizeObserver | undefined;
const clamp = (v: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, v));
type Rect = { x: number; y: number; w: number; h: number };
const paths = computed(() => {
  const focus = props.energy.paths.findIndex((p) => p.focus);
  let dash = 0;
  return props.energy.paths.map((p, k) => ({
    ...p,
    k,
    cls:
      props.energy.paths.length === 1
        ? "single"
        : focus < 0
          ? `p${k}`
          : p.focus
            ? "focus"
            : "muted",
    dash:
      props.energy.paths.length === 1
        ? ""
        : focus < 0
          ? ["", "7 4", "2 3"][k]
          : p.focus
            ? ""
            : ["7 4", "2 3"][dash++],
  }));
});
const points = computed(() => {
  const result: {
    u: number;
    e: number;
    text: string;
    ts: boolean;
    paths: number[];
    rds: boolean;
  }[] = [];
  for (const p of paths.value)
    p.points.forEach((point, i) => {
      const u = i / (p.points.length - 1);
      let q = result.find(
        (q) => q.u === u && q.e === point.e && q.text === point.text,
      );
      if (!q) {
        q = { ...point, u, ts: i % 2 === 1, paths: [], rds: false };
        result.push(q);
      }
      q.paths.push(p.k);
      q.rds ||= p.rds === point.text;
    });
  return result;
});
const owner = (q: (typeof points.value)[number]) =>
  paths.value.length === 1 || q.paths.length > 1
    ? ""
    : paths.value[q.paths[0]].cls;
const pointAt = (r: EnergyRef) => {
  const p = paths.value[r.path],
    point = p.points[r.index];
  return points.value.find(
    (q) =>
      q.u === r.index / (p.points.length - 1) &&
      q.e === point.e &&
      q.text === point.text,
  )!;
};
const description = computed(
  () =>
    "反应坐标图。" +
    paths.value
      .map(
        (p) =>
          (p.name ? p.name + "：" : "") +
          p.points.map((q) => `${q.text}（${minus(q.e)}）`).join("，"),
      )
      .join("；") +
    `。括号内为相对能量，${props.energy.scale ? "单位 " + props.energy.unit : "仅表示高低"}。`,
);
const axisTitle = computed(
  () =>
    props.energy.axis + (props.energy.scale ? `（${props.energy.unit}）` : ""),
);
const drawing = shallowRef({
  height: 0,
  oy: 0,
  axisX: 0,
  axisY: 0,
  axisTop: 0,
  gridEnd: 0,
  curves: [] as { d: string; cls: string; dash?: string }[],
  ticks: [] as { value: number; y: number }[],
  arrows: [] as {
    x: number;
    y1: number;
    y2: number;
    heads: string;
    guides: { x1: number; x2: number; y: number }[];
  }[],
});
const placedLabels = shallowRef<Rect[]>([]);
const placedMarks = shallowRef<Rect[]>([]);
const ready = ref(false);

function niceStep(raw: number) {
  const power = 10 ** Math.floor(Math.log10(raw));
  return [1, 2, 2.5, 5, 10].find((m) => m * power >= raw)! * power;
}
const area = (r: Rect, o: Rect) =>
  Math.max(0, Math.min(r.x + r.w, o.x + o.w) - Math.max(r.x, o.x)) *
  Math.max(0, Math.min(r.y + r.h, o.y + o.h) - Math.max(r.y, o.y));
const pad = (r: Rect, p: number) => ({
  x: r.x - p,
  y: r.y - p,
  w: r.w + 2 * p,
  h: r.h + 2 * p,
});

async function reflow() {
  if (!width.value) return;
  ready.value = false;
  await nextTick();
  const W = width.value,
    E = em.value,
    ps = paths.value,
    pts = points.value;
  const sizes = labelEls.value.map((el) => ({
    w: el.offsetWidth,
    h: el.offsetHeight,
  }));
  const marks = props.energy.marks.map((mark, i) => ({
    A: pointAt(mark.from),
    B: pointAt(mark.to),
    w: markEls.value[i].offsetWidth,
    h: markEls.value[i].offsetHeight,
  }));
  let lo = Math.min(...pts.map((p) => p.e)),
    hi = Math.max(...pts.map((p) => p.e));
  const ticks: number[] = [];
  if (props.energy.scale) {
    const step = niceStep((hi - lo) / 4);
    lo = Math.floor(lo / step) * step;
    hi = Math.ceil(hi / step) * step;
    for (let t = lo; t <= hi + step / 100; t += step)
      ticks.push(+t.toPrecision(12));
  }
  const tickW = props.energy.scale
    ? Math.max(...ticks.map((t) => minus(t).length)) * 0.62 * 0.857 * E + 6
    : 0;
  const axisX = Math.ceil(tickW) + 1;
  const dx0 = (W - axisX) / (Math.max(...ps.map((p) => p.points.length)) - 1);
  const pw = clamp(0.18 * dx0, 0.45 * E, 1.5 * E),
    pe = Math.min(2 * pw, 0.3 * dx0),
    gap = 0.6 * E;
  const gR = Math.max(
    0,
    ...marks.filter((m) => !m.B.ts && m.B.u === 1).map((m) => gap + 4 + m.w),
  );
  const half = (q: (typeof pts)[number]) =>
    q.ts ? 0 : q.u === 0 || q.u === 1 ? pe : pw;
  const a = axisX + 0.8 * E + pe,
    b = W - gR - pe - (gR ? 0 : 0.3 * E);
  const X = (u: number) => a + u * (b - a);
  const plotH = W < 560 ? clamp(0.72 * W, 220, 280) : clamp(0.38 * W, 230, 290);
  const Y = (e: number) => ((hi - e) / (hi - lo)) * plotH;
  const pps = ps.map((p) =>
    p.points.map((_, index) => pointAt({ path: p.k, index })),
  );
  let cp = 0,
    cs = 0;
  const minN = Math.min(...pps.map((p) => p.length));
  if (ps.length > 1) {
    while (cp < minN && pps.every((p) => p[cp] === pps[0][cp])) cp++;
    while (
      cs < minN - cp &&
      pps.every((p) => p[p.length - 1 - cs] === pps[0][pps[0].length - 1 - cs])
    )
      cs++;
  }
  function piece(
    k: number,
    s: number,
    t: number,
    startFull: boolean,
    endFull: boolean,
  ) {
    const P = pps[k],
      y0 = Y(P[s].e),
      x0 = X(P[s].u);
    let cx = startFull ? x0 - half(P[s]) : x0 + half(P[s]);
    let d = `M${cx},${y0}`;
    if (startFull) {
      cx = x0 + half(P[s]);
      d += `H${cx}`;
    }
    for (let i = s; i < t; i++) {
      const B = P[i + 1],
        xb = X(B.u),
        yb = Y(B.e),
        ya = Y(P[i].e),
        ex = xb - half(B),
        control = (ex - cx) / 2;
      d += `C${cx + control},${ya} ${ex - control},${yb} ${ex},${yb}`;
      cx = ex;
      if (!B.ts && (i + 1 < t || endFull)) {
        cx = xb + half(B);
        d += `H${cx}`;
      }
    }
    return d;
  }
  const curves: typeof drawing.value.curves = [];
  if (ps.length === 1)
    curves.push({
      d: piece(0, 0, pps[0].length - 1, true, true),
      cls: "single",
    });
  else {
    const order = [...ps].sort(
      (p, q) => Number(q.cls === "muted") - Number(p.cls === "muted"),
    );
    for (const p of order)
      curves.push({
        d: piece(
          p.k,
          cp ? cp - 1 : 0,
          cs ? p.points.length - cs : p.points.length - 1,
          !cp,
          !cs,
        ),
        cls: p.cls,
        dash: p.dash,
      });
    if (cp) curves.push({ d: piece(0, 0, cp - 1, true, true), cls: "shared" });
    if (cs)
      curves.push({
        d: piece(0, pps[0].length - cs, pps[0].length - 1, true, true),
        cls: "shared",
      });
  }
  drawing.value = { ...drawing.value, curves };
  await nextTick();
  const obstacles: Rect[] = [];
  for (const curve of curveEls.value) {
    const length = curve.getTotalLength();
    for (let s = 0; s <= length; s += 3) {
      const p = curve.getPointAtLength(s);
      obstacles.push({ x: p.x - 2, y: p.y - 2, w: 4, h: 4 });
    }
  }
  const arrows = marks.map(({ A, B }) => {
    const x = B.ts ? X(B.u) : X(B.u) + half(B) + gap;
    const ya = Y(A.e),
      yb = Y(B.e),
      up = yb < ya ? 1 : -1;
    const y1 = ya - up * 1.5,
      y2 = yb + up * 2.5;
    const guides: { x1: number; x2: number; y: number }[] = [];
    const guide = (xs: number, y: number) => {
      if (Math.abs(x - xs) > 2)
        guides.push({ x1: xs, x2: x + (x > xs ? 4 : -4), y });
    };
    guide(x >= X(A.u) ? X(A.u) + half(A) : X(A.u) - half(A), ya);
    if (!B.ts) guide(X(B.u) + half(B), yb);
    obstacles.push({
      x: x - 3,
      y: Math.min(ya, yb),
      w: 6,
      h: Math.abs(ya - yb),
    });
    return {
      x,
      y1: y1 - up * 4,
      y2: y2 + up * 4,
      heads: `M${x},${y2} l-3.5,${up * 6} h7z M${x},${y1} l-3.5,${-up * 6} h7z`,
      guides,
    };
  });
  const placed: Rect[] = [];
  function choose(candidates: Rect[]) {
    let best = candidates[0],
      bestScore = Infinity;
    candidates.forEach((candidate, i) => {
      const score =
        i * 0.01 +
        obstacles.reduce((sum, o) => sum + area(pad(candidate, 2), o), 0) +
        placed.reduce((sum, o) => sum + 4 * area(pad(candidate, 3), o), 0);
      if (score < bestScore) {
        bestScore = score;
        best = candidate;
      }
    });
    placed.push(best);
    return best;
  }
  const focus = ps.findIndex((p) => p.focus);
  const order = pts
    .map((q, i) => ({ ...q, i }))
    .sort(
      (p, q) =>
        Number(q.paths.includes(focus)) - Number(p.paths.includes(focus)) ||
        (p.ts ? -p.e : p.e) - (q.ts ? -q.e : q.e),
    );
  const labels: Rect[] = [];
  for (const q of order) {
    const { w, h } = sizes[q.i],
      x = X(q.u),
      y = Y(q.e),
      hw = half(q),
      gp = 5;
    const up = y - gp - h,
      down = y + gp,
      side = y - h / 2;
    const center = x - w / 2,
      left = x + hw - w,
      right = x - hw;
    const above = [
        [center, up],
        [right, up],
        [left, up],
      ],
      below = [
        [center, down],
        [left, down],
        [right, down],
      ],
      sides = [
        [x + hw + gp, side],
        [x - hw - gp - w, side],
      ];
    const list = q.ts
      ? [...above, ...sides, ...below]
      : [...below, ...above, ...sides];
    labels[q.i] = choose(
      list.map(([cx, cy]) => ({
        x: clamp(cx, axisX + 3, W - (gR ? gR + 2 : 0) - w),
        y: cy,
        w,
        h,
      })),
    );
  }
  const markPositions = marks.map((m, i) => {
    const { w, h } = m,
      x = arrows[i].x,
      top = (Y(m.A.e) + Y(m.B.e)) / 2 - h / 2;
    const ys = [top, top - h * 0.75, top + h * 0.75];
    const candidates = ys.map((y) => ({ x: x + 5, y, w, h }));
    if (m.B.ts || m.B.u !== 1)
      for (const y of ys) candidates.push({ x: x - 5 - w, y, w, h });
    return choose(candidates);
  });
  const top = Math.min(0, ...placed.map((r) => r.y)) - 8;
  const bottom = Math.max(plotH, ...placed.map((r) => r.y + r.h)) + 8;
  const axisTop = yLabel.value!.offsetHeight + 4,
    oy = yLabel.value!.offsetHeight + 6 - top,
    axisY = bottom + oy;
  drawing.value = {
    height: axisY + 4 + xLabel.value!.offsetHeight,
    oy,
    axisX,
    axisY,
    axisTop,
    gridEnd: W - gR,
    curves,
    arrows,
    ticks: ticks.map((value) => ({ value, y: Y(value) + oy })),
  };
  placedLabels.value = labels;
  placedMarks.value = markPositions;
  ready.value = true;
}
const position = (r?: Rect) => ({
  left: `${r?.x ?? 0}px`,
  top: `${(r?.y ?? 0) + drawing.value.oy}px`,
});
onMounted(async () => {
  await document.fonts.ready;
  if (!root.value) return;
  em.value = parseFloat(getComputedStyle(root.value).fontSize);
  observer = new ResizeObserver(([entry]) => {
    width.value = entry.contentRect.width;
  });
  observer.observe(root.value);
});
onBeforeUnmount(() => observer?.disconnect());
watch([width, () => props.energy], reflow);
</script>

<template>
  <figure ref="root" class="energy">
    <div
      class="energy-canvas"
      :style="{
        height: `${drawing.height}px`,
        visibility: ready ? undefined : 'hidden',
      }"
    >
      <svg
        class="energy-lines"
        :width="width"
        :height="drawing.height"
        aria-hidden="true"
      >
        <g v-for="tick in drawing.ticks" :key="tick.value">
          <line
            class="energy-grid"
            :x1="drawing.axisX"
            :x2="drawing.gridEnd"
            :y1="tick.y"
            :y2="tick.y"
          />
          <line
            class="energy-axis"
            :x1="drawing.axisX - 4"
            :x2="drawing.axisX"
            :y1="tick.y"
            :y2="tick.y"
          />
          <text class="energy-tick" :x="drawing.axisX - 6" :y="tick.y">
            {{ minus(tick.value) }}
          </text>
        </g>
        <g :transform="`translate(0,${drawing.oy})`">
          <path
            v-for="(curve, i) in drawing.curves"
            :key="i"
            ref="curveEls"
            class="energy-curve"
            :class="`energy-curve--${curve.cls}`"
            :d="curve.d"
            :stroke-dasharray="curve.dash"
          />
          <g v-for="(arrow, i) in drawing.arrows" :key="i">
            <line
              v-for="(guide, j) in arrow.guides"
              :key="j"
              class="energy-guide"
              :x1="guide.x1"
              :x2="guide.x2"
              :y1="guide.y"
              :y2="guide.y"
            />
            <line
              class="energy-arrow"
              :x1="arrow.x"
              :x2="arrow.x"
              :y1="arrow.y1"
              :y2="arrow.y2"
            />
            <path class="energy-arrow-head" :d="arrow.heads" />
          </g>
        </g>
        <path
          class="energy-axis"
          :d="`M${drawing.axisX},${drawing.axisTop} V${drawing.axisY} H${width - 1}`"
        />
        <path
          class="energy-axis-head"
          :d="`M${drawing.axisX},${drawing.axisTop - 3} l-3.5,7 h7z M${width},${drawing.axisY} l-7,-3.5 v7z`"
        />
      </svg>
      <div
        v-for="(point, i) in points"
        :key="i"
        ref="labelEls"
        class="energy-label"
        :class="owner(point) ? `energy-label--${owner(point)}` : undefined"
        :style="{
          ...position(placedLabels[i]),
          maxWidth: `${(width < 560 ? 6.4 : 9) * em}px`,
        }"
      >
        <span v-if="point.rds" class="energy-rds">决速步</span>
        <DiagramText :text="point.text" />
        <span v-if="energy.scale" class="energy-value">{{
          minus(point.e)
        }}</span>
      </div>
      <div
        v-for="(mark, i) in energy.marks"
        :key="i"
        ref="markEls"
        class="energy-mark"
        :style="position(placedMarks[i])"
      >
        <DiagramText :text="mark.text" /><span
          v-if="energy.scale"
          class="energy-value"
          >{{ minus(pointAt(mark.to).e - pointAt(mark.from).e) }}</span
        >
      </div>
      <div ref="yLabel" class="energy-axis-label">{{ axisTitle }}</div>
      <div
        ref="xLabel"
        class="energy-axis-label"
        :style="{ right: '2px', left: 'auto', top: `${drawing.axisY + 4}px` }"
      >
        反应进程
      </div>
    </div>
    <p v-if="paths.length > 1" class="energy-legend">
      <span v-for="path in paths" :key="path.k"
        ><svg width="26" height="10" aria-hidden="true">
          <line
            x1="1"
            x2="25"
            y1="5"
            y2="5"
            class="energy-curve"
            :class="`energy-curve--${path.cls}`"
            :stroke-dasharray="path.dash"
          /></svg
        >{{ path.name }}</span
      >
    </p>
    <figcaption v-if="caption"><ProseCaption :text="caption" /></figcaption>
    <p class="visually-hidden">{{ description }}</p>
  </figure>
</template>

<style scoped>
.energy {
  margin: 0;
  font: var(--text-sm) / var(--leading-tight) var(--font-sans);
}
.energy-canvas {
  position: relative;
}
.energy-lines {
  position: absolute;
  inset: 0;
  overflow: visible;
}
.energy-axis {
  fill: none;
  stroke: var(--ink-muted);
  stroke-width: 1;
}
.energy-axis-head {
  fill: var(--ink-muted);
}
.energy-grid {
  stroke: var(--rule);
  stroke-width: 1;
}
.energy-tick {
  fill: var(--ink-muted);
  font: var(--text-xs) var(--font-mono);
  font-variant-numeric: tabular-nums;
  text-anchor: end;
  dominant-baseline: middle;
}
.energy-curve {
  fill: none;
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.energy-curve--single,
.energy-curve--p0,
.energy-curve--focus {
  stroke: var(--accent);
}
.energy-curve--p1 {
  stroke: var(--evidence);
}
.energy-curve--p2 {
  stroke: var(--ink-soft);
}
.energy-curve--focus {
  stroke-width: 2.5;
}
.energy-curve--muted {
  stroke: var(--ink-muted);
  stroke-width: 1.5;
}
.energy-curve--shared {
  stroke: var(--ink-soft);
}
.energy-guide {
  stroke: var(--rule-strong);
  stroke-width: 1;
  stroke-dasharray: 3 3;
}
.energy-arrow {
  stroke: var(--ink-soft);
  stroke-width: 1.25;
}
.energy-arrow-head {
  fill: var(--ink-soft);
}
.energy-label,
.energy-mark,
.energy-axis-label {
  position: absolute;
  left: 0;
  top: 0;
  width: max-content;
  line-break: strict;
  text-wrap: balance;
}
.energy-label {
  width: max-content;
  font-weight: 500;
  text-align: center;
  color: var(--ink);
}
.energy-label--p0,
.energy-label--focus {
  color: var(--accent);
}
.energy-label--p1 {
  color: var(--evidence);
}
.energy-label--muted {
  color: var(--ink-muted);
}
.energy-value {
  display: block;
  margin-top: 1px;
  color: var(--ink-muted);
  font: var(--text-xs) / 1.3 var(--font-mono);
  font-variant-numeric: tabular-nums;
}
.energy-rds {
  display: block;
  width: max-content;
  margin: 0 auto 3px;
  padding: 0 0.4em;
  border: 1px solid currentColor;
  border-radius: var(--radius-sm);
  font-size: var(--text-xs);
  font-weight: 500;
  line-height: 1.5;
}
.energy-mark {
  padding: 0 2px;
  background: var(--paper);
  color: var(--ink-soft);
  font-weight: 500;
  white-space: nowrap;
}
.energy-mark .energy-value {
  display: inline;
  margin: 0 0 0 0.3em;
}
.energy-axis-label {
  color: var(--ink-muted);
  font-size: var(--text-xs);
  font-weight: 500;
  white-space: nowrap;
}
.energy-legend {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1) var(--space-4);
  margin: var(--space-3) 0 0;
  color: var(--ink-soft);
  font-size: var(--text-sm);
  font-weight: 500;
  line-height: var(--leading-tight);
}
.energy-legend span {
  display: inline-flex;
  align-items: center;
  gap: 0.4em;
}
.energy-legend svg {
  flex: none;
  overflow: visible;
}
.energy figcaption {
  margin-top: var(--space-3);
  color: var(--ink-soft);
}
.energy-label--p2 {
  color: var(--ink-soft);
}
.energy-axis-label {
  top: 0;
}
</style>
