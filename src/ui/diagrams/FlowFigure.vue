<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
} from "vue";
import DiagramText from "./DiagramText.vue";
import { readsWell } from "./check.ts";
import { phrases } from "./model.ts";
import {
  chainOrder,
  foldFlow,
  foldRail,
  foldable,
  layoutFlow,
  wrapFlow,
  wrapRoom,
  type Flow,
  type FlowDirection,
  type FlowSpacing,
  type Point,
} from "./flow.ts";

const props = defineProps<{ flow: Flow; caption?: string }>();

// Box widths in em: the widest a box grows across or down the page. A flow
// runs right when its text reads well in boxes that wide (see readsWell),
// else in whichever direction gives the wider boxes; running down, nodes
// beside the main line fold under it when side by side they read badly.
const widest = { right: 13, down: 15 };
const narrowest = 4.4;
// Below this the author's fixed direction gives way to the wider boxes.
const fixedFromEm = 34;
// Narrower boxes, only when the author fixes the direction, set smaller type.
const compactBelow = 6.5;
const arrow = 6;

const root = ref<HTMLElement>();
const width = ref(0);
const em = ref(14);
let pen: CanvasRenderingContext2D | null = null;
let observer: ResizeObserver | undefined;
onMounted(() => {
  if (!root.value) return;
  em.value = parseFloat(getComputedStyle(root.value).fontSize) || 14;
  pen = document.createElement("canvas").getContext("2d");
  if (pen) pen.font = getComputedStyle(root.value).font;
  observer = new ResizeObserver(([entry]) => {
    width.value = entry.contentRect.width;
  });
  observer.observe(root.value);
});
onBeforeUnmount(() => observer?.disconnect());

const space = computed<FlowSpacing>(() => ({
  rank: 2 * em.value,
  cross: 1.2 * em.value,
  side: 1.6 * em.value,
  pad: 0.4 * em.value,
  thread: 0.8 * em.value,
}));

// Node heights and edge text sizes are read off the page once rendered;
// the layout follows from them.
const nodeEls = ref<HTMLElement[]>([]);
const labelEls = ref<HTMLElement[]>([]);
const heights = ref<{ h: number; tag: number; inset: number }[]>([]);
const labelSizes = ref<({ w: number; h: number } | null)[]>([]);

function sizesAt(w: number) {
  return props.flow.nodes.map((_, i) => ({
    w,
    h: heights.value[i]?.h ?? 3 * em.value,
    tag: heights.value[i]?.tag ?? 0,
  }));
}
/** The widest box (px) up to `widest` whose layout fits the figure's width. */
function fit(direction: FlowDirection) {
  const labels = props.flow.edges.map((_, i) => labelSizes.value[i] ?? null);
  const across = (w: number) =>
    layoutFlow(props.flow, direction, sizesAt(w), labels, space.value).width;
  let hi = widest[direction] * em.value;
  if (across(hi) <= width.value) return hi;
  let lo = 2 * em.value;
  for (let i = 0; i < 12; i++) {
    const mid = (lo + hi) / 2;
    if (across(mid) <= width.value) lo = mid;
    else hi = mid;
  }
  return lo;
}
/**
 * Whether every node's text reads well in boxes `w` wide: its phrases are
 * set line by line as the page sets them, a phrase wider than the box
 * taking whole lines of its own.
 */
function readable(w: number) {
  if (!pen) return true;
  const blank = pen.measureText(" ").width;
  return props.flow.nodes.every((node, i) => {
    // A little slack: the page's text measures a pixel or two wider.
    const room = w - (heights.value[i]?.inset ?? em.value) - 2;
    return readsWell(
      phrases(node.text).map((line) => {
        let lines = 1;
        let used = 0;
        let length = 0;
        for (const phrase of line) {
          const text = pen!.measureText(phrase.trimEnd()).width;
          length += text / em.value;
          const size = text + (phrase.endsWith(" ") ? blank : 0);
          if (size > room) {
            lines += (used ? 1 : 0) + Math.ceil(size / room) - 1;
            used = room;
          } else if (used + size > room + 0.5) {
            lines++;
            used = size;
          } else used += size;
        }
        return { lines, length };
      }),
    );
  });
}
const fixed = computed(
  () =>
    props.flow.direction !== "auto" && width.value / em.value >= fixedFromEm,
);
const direction = computed<FlowDirection>(() => {
  if (!width.value) return "down";
  if (fixed.value) return props.flow.direction as FlowDirection;
  const across = fit("right");
  if (across >= narrowest * em.value && readable(across)) return "right";
  return across > fit("down") ? "right" : "down";
});
/** The box width (px) of a chain wrapped `columns` to a row. */
function wrapWidth(columns: number) {
  const labels = props.flow.edges.map((_, i) => labelSizes.value[i] ?? null);
  const room = wrapRoom(props.flow, columns, labels, space.value);
  return Math.min(widest.right * em.value, (width.value - room) / columns);
}
/**
 * A chain too long to read well in one row wraps into rows of even length:
 * as few rows as keep every box readable. 0 when it does not wrap.
 */
const columns = computed(() => {
  const count = chainOrder(props.flow)?.length ?? 0;
  if (!count || !width.value || fixed.value || direction.value === "right")
    return 0;
  for (let rows = 2; Math.ceil(count / rows) >= 2; rows++) {
    const across = Math.ceil(count / rows);
    if (across === Math.ceil(count / (rows - 1))) continue;
    if (readable(wrapWidth(across))) return across;
  }
  return 0;
});
const folded = computed(
  () =>
    !columns.value &&
    direction.value === "down" &&
    !!width.value &&
    foldable(props.flow) &&
    !readable(fit("down")),
);
const boxWidth = computed(() => {
  if (!width.value) return widest.down * em.value;
  if (columns.value) return wrapWidth(columns.value);
  if (!folded.value) return fit(direction.value);
  const rail = foldRail(props.flow) ? space.value.cross : 0;
  return Math.min(widest.down * em.value, width.value - rail);
});
const compact = computed(
  () => direction.value === "right" && boxWidth.value < compactBelow * em.value,
);
const layout = computed(() => {
  const labels = props.flow.edges.map((_, i) => labelSizes.value[i] ?? null);
  const sizes = sizesAt(boxWidth.value);
  if (columns.value)
    return wrapFlow(
      props.flow,
      columns.value,
      boxWidth.value,
      sizes,
      labels,
      space.value,
    );
  return folded.value
    ? foldFlow(props.flow, boxWidth.value, sizes, labels, space.value)
    : layoutFlow(props.flow, direction.value, sizes, labels, space.value);
});

async function measure() {
  await nextTick();
  const nodes = props.flow.nodes.map((_, i) => {
    const el = nodeEls.value.find((n) => n.dataset.node === String(i));
    if (!el) return { h: 3 * em.value, tag: 0, inset: em.value };
    // The box's offset is the tag above it with its margin; its inset is
    // what its padding and border take from the text's width.
    const box = el.querySelector<HTMLElement>(".flow-box")!;
    const text = box.querySelector<HTMLElement>(".flow-text")!;
    return {
      h: el.offsetHeight,
      tag: box.offsetTop,
      inset: box.offsetWidth - text.offsetWidth,
    };
  });
  const labels = props.flow.edges.map((_, i) => {
    const el = labelEls.value.find((l) => l.dataset.edge === String(i));
    return el ? { w: el.offsetWidth, h: el.offsetHeight } : null;
  });
  const same = (a: unknown, b: unknown) =>
    JSON.stringify(a) === JSON.stringify(b);
  if (!same(nodes, heights.value)) heights.value = nodes;
  if (!same(labels, labelSizes.value)) labelSizes.value = labels;
}
watch(
  [() => props.flow, boxWidth, compact, direction, columns, folded, em],
  measure,
  {
    immediate: true,
  },
);

// A tag sits beside the arrow that comes into its box from above.
const fromAbove = computed(() =>
  props.flow.nodes.map((n) =>
    props.flow.edges.some(
      (e) =>
        e.to === n.id &&
        (direction.value === "right"
          ? e.side
          : !e.side && !folded.value && !columns.value),
    ),
  ),
);

/** The line, stopping short of the arrow head, and the head. */
function draw(points: Point[]) {
  const [px, py] = points.at(-2)!;
  const [tx, ty] = points.at(-1)!;
  const length = Math.hypot(tx - px, ty - py) || 1;
  const [dx, dy] = [(tx - px) / length, (ty - py) / length];
  const [bx, by] = [tx - dx * arrow, ty - dy * arrow];
  const line = [...points.slice(0, -1), [bx, by]]
    .map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`)
    .join(" ");
  const head = `M${tx} ${ty} L${bx - dy * 3.5} ${by + dx * 3.5} L${bx + dy * 3.5} ${by - dx * 3.5} Z`;
  return { line, head };
}
const lines = computed(() => layout.value.edges.map((e) => draw(e.points)));
</script>

<template>
  <figure
    ref="root"
    class="flow"
    :class="[`flow--${direction}`, { 'flow--compact': compact }]"
  >
    <div class="flow-frame" :style="{ width: `${layout.width}px` }">
      <p v-if="flow.over" class="flow-over">
        <DiagramText :text="flow.over" />
      </p>
      <div class="flow-canvas" :style="{ height: `${layout.height}px` }">
        <svg
          class="flow-lines"
          :width="layout.width"
          :height="layout.height"
          aria-hidden="true"
        >
          <g
            v-for="(line, i) in lines"
            :key="i"
            :class="{ 'flow-edge--dashed': flow.edges[i].dashed }"
          >
            <path class="flow-edge" :d="line.line" />
            <path class="flow-arrow" :d="line.head" />
          </g>
        </svg>
        <template v-for="(edge, i) in flow.edges" :key="i">
          <span
            v-if="edge.text"
            ref="labelEls"
            class="flow-label"
            :data-edge="i"
            :style="{
              left: `${layout.edges[i].label?.x ?? 0}px`,
              top: `${layout.edges[i].label?.y ?? 0}px`,
            }"
            ><DiagramText :text="edge.text"
          /></span>
        </template>
        <div
          v-for="(node, i) in flow.nodes"
          :key="node.id"
          ref="nodeEls"
          :data-node="i"
          class="flow-node"
          :class="[
            `flow-node--${node.kind}`,
            `flow-node--${node.tone}`,
            { 'flow-node--from-above': fromAbove[i] },
          ]"
          :style="{
            left: `${layout.nodes[i].x}px`,
            top: `${layout.nodes[i].y}px`,
            width: `${layout.nodes[i].w}px`,
          }"
        >
          <span v-if="node.tag" class="flow-tag"
            ><DiagramText :text="node.tag"
          /></span>
          <div class="flow-box">
            <svg
              v-if="node.kind === 'ask'"
              class="flow-shape"
              viewBox="0 0 100 100"
              preserveAspectRatio="none"
              aria-hidden="true"
            >
              <polygon
                points="7,1 93,1 99.5,50 93,99 7,99 0.5,50"
                vector-effect="non-scaling-stroke"
              />
            </svg>
            <span class="flow-text"><DiagramText :text="node.text" /></span>
          </div>
        </div>
      </div>
    </div>
    <p v-if="flow.note" class="flow-note">
      <DiagramText :text="flow.note" />
    </p>
    <figcaption v-if="caption">{{ caption }}</figcaption>
  </figure>
</template>

<style scoped>
.flow {
  margin: 0;
  font-family: var(--font-sans);
  font-size: var(--text-sm);
  line-height: var(--leading-tight);
}
.flow-frame {
  max-width: 100%;
  margin: 0 auto;
}
.flow-over {
  margin: 0 0 var(--space-3);
  text-align: center;
  color: var(--ink-soft);
}
.flow-over::after {
  content: "";
  display: block;
  height: 0.5rem;
  margin-top: var(--space-1);
  border: 1.25px solid var(--ink-soft);
  border-bottom: none;
}
.flow-canvas {
  position: relative;
}
.flow-lines {
  position: absolute;
  inset: 0;
  overflow: visible;
}
.flow-edge {
  fill: none;
  stroke: var(--ink-soft);
  stroke-width: 1.5;
}
.flow-edge--dashed .flow-edge {
  stroke-dasharray: 4 3;
}
.flow-arrow {
  fill: var(--ink-soft);
}
.flow-label {
  position: absolute;
  width: max-content;
  max-width: 5em;
  font-size: var(--text-xs);
  color: var(--ink-muted);
  text-align: center;
  line-break: strict;
}
.flow-node {
  position: absolute;
  display: flex;
  flex-direction: column;
}
.flow-tag {
  margin-bottom: var(--space-1);
  font-size: var(--text-xs);
  line-height: 1.2rem;
  color: var(--ink-muted);
  text-align: center;
}
.flow-node--from-above .flow-tag {
  padding-left: calc(50% + var(--space-2));
  text-align: left;
}
.flow-box {
  position: relative;
  display: flex;
  flex-direction: column;
  justify-content: center;
  min-height: 2.6em;
  padding: var(--space-2);
  border: 1.25px solid var(--accent);
  border-radius: var(--radius);
  background: var(--surface);
  color: var(--ink);
  text-align: center;
  line-break: strict;
}
.flow-text {
  position: relative;
}
.flow-node--end .flow-box {
  border-radius: 999px;
  padding-inline: var(--space-3);
}
.flow-node--ask .flow-box {
  border: none;
  background: none;
  padding-inline: 1.1em;
}
.flow-shape {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  overflow: visible;
}
.flow-shape polygon {
  fill: var(--accent-soft);
  stroke: var(--accent);
  stroke-width: 1.5;
}
.flow-node--note .flow-box {
  border-color: var(--rule-strong);
  border-style: dashed;
  color: var(--ink-soft);
}
.flow-node--accent .flow-box {
  border: 2px solid var(--evidence);
  color: var(--evidence);
}
.flow-node--accent .flow-shape polygon {
  fill: var(--evidence-soft);
  stroke: var(--evidence);
}
.flow-node--muted .flow-box {
  border-color: var(--rule-strong);
  color: var(--ink-muted);
}
.flow-node--muted .flow-shape polygon {
  fill: none;
  stroke: var(--rule-strong);
}
.flow--compact .flow-box {
  padding: var(--space-2) var(--space-1);
  font-size: var(--text-xs);
}
.flow--compact .flow-node--ask .flow-box {
  padding-inline: 0.8em;
}
.flow-note {
  margin: var(--space-4) 0 0;
  text-align: center;
  color: var(--ink-soft);
}
figcaption {
  margin-top: var(--space-3);
  color: var(--ink-soft);
}
</style>
