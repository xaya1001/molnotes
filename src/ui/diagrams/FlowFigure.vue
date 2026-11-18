<script setup lang="ts">
import FigureCard from "../FigureCard.vue";
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
} from "vue";
import DiagramText from "./DiagramText.vue";
import StepDescriptions from "../StepDescriptions.vue";
import { readsWell } from "./check.ts";
import { phrases } from "./model.ts";
import {
  flowStepMarkers,
  flowEdgeSegment,
  chainOrder,
  normalizeFlowChain,
  restoreFlowDirections,
  analyzeFlow,
  flowReadingOrder,
  layoutBranches,
  type BranchLayout,
  layoutFlow,
  wrapFlow,
  wrapRoom,
  type Flow,
  type FlowDirection,
  type FlowLayout,
  type FlowSpacing,
  type Point,
} from "./flow.ts";

const props = defineProps<{ flow: Flow; caption?: string }>();
const chain = computed(() => normalizeFlowChain(props.flow));
const layoutInput = computed(() => chain.value?.flow ?? props.flow);

// Chain box widths in em: run right when the text reads well, otherwise
// use the direction with wider boxes or wrap into rows. Branches use the
// measured reading sizes in layoutBranches.
const widest = { right: 13, down: 15 };
const narrowest = 4.4;
// Below this the author's fixed direction gives way to the wider boxes.
const fixedFromEm = 34;
// Narrower boxes, only when the author fixes the direction, set smaller type.
const compactBelow = 6.5;
const arrow = 6;

const card = ref<InstanceType<typeof FigureCard>>();
const root = computed(() => card.value?.art);
const width = ref(0);
const em = ref(14);
let pen: CanvasRenderingContext2D | null = null;
let observer: ResizeObserver | undefined;
let measureFrame = 0;
onMounted(() => {
  if (!root.value) return;
  em.value = parseFloat(getComputedStyle(root.value).fontSize) || 14;
  pen = document.createElement("canvas").getContext("2d");
  if (pen) pen.font = getComputedStyle(root.value).font;
  observer = new ResizeObserver(([entry]) => {
    cancelAnimationFrame(measureFrame);
    measureFrame = requestAnimationFrame(() => {
      width.value = entry.contentRect.width;
    });
  });
  observer.observe(root.value);
});
onBeforeUnmount(() => {
  observer?.disconnect();
  cancelAnimationFrame(measureFrame);
});

const mostEdgeSteps = computed(() =>
  Math.max(
    1,
    ...props.flow.edges.map(
      (edge) =>
        (props.flow.steps ?? []).filter(
          (step) => step.at === `${edge.from} > ${edge.to}`,
        ).length,
    ),
  ),
);
const space = computed<FlowSpacing>(() => ({
  rank:
    (props.flow.steps?.length ? 5 + 2 * (mostEdgeSteps.value - 1) : 2) *
    em.value,
  cross: (props.flow.steps?.some((step) => step.block) ? 3 : 1.2) * em.value,
  side: (props.flow.steps?.length ? 4 : 1.6) * em.value,
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
    layoutFlow(layoutInput.value, direction, sizesAt(w), labels, space.value)
      .width;
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
const branched = computed(() => chainOrder(layoutInput.value) === null);
const analysis = computed(() => analyzeFlow(layoutInput.value));
const branchLayout = ref<BranchLayout>();
const readingOrder = computed(() =>
  flowReadingOrder(props.flow, analysis.value),
);
const mode = computed(() =>
  branched.value ? (branchLayout.value?.mode ?? "down") : direction.value,
);

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
  const room = wrapRoom(layoutInput.value, columns, labels, space.value);
  return Math.min(widest.right * em.value, (width.value - room) / columns);
}
/**
 * A chain too long to read well in one row wraps into rows of even length:
 * as few rows as keep every box readable. 0 when it does not wrap.
 */
const columns = computed(() => {
  const count = chainOrder(layoutInput.value)?.length ?? 0;
  if (!count || !width.value || fixed.value || direction.value === "right")
    return 0;
  if (chain.value && width.value < fixedFromEm * em.value) return 0;
  for (let rows = 2; Math.ceil(count / rows) >= 2; rows++) {
    const across = Math.ceil(count / rows);
    if (across === Math.ceil(count / (rows - 1))) continue;
    if (
      (!props.flow.steps?.length ||
        wrapWidth(across) >= narrowest * em.value) &&
      readable(wrapWidth(across))
    )
      return across;
  }
  return 0;
});
const boxWidth = computed(() => {
  if (!width.value) return widest.down * em.value;
  if (columns.value) return wrapWidth(columns.value);
  return fit(direction.value);
});
const compact = computed(
  () =>
    !branched.value &&
    direction.value === "right" &&
    boxWidth.value < compactBelow * em.value,
);
const layout = computed<FlowLayout>(() => {
  if (branched.value && branchLayout.value) return branchLayout.value;
  const labels = props.flow.edges.map((_, i) => labelSizes.value[i] ?? null);
  const sizes = sizesAt(boxWidth.value);
  const result = columns.value
    ? wrapFlow(
        layoutInput.value,
        columns.value,
        boxWidth.value,
        sizes,
        labels,
        space.value,
      )
    : layoutFlow(
        layoutInput.value,
        direction.value,
        sizes,
        labels,
        space.value,
      );
  return chain.value
    ? restoreFlowDirections(result, chain.value.reversed)
    : result;
});

async function measure() {
  await nextTick();
  if (branched.value) {
    await document.fonts.ready;
    measureBranches();
    return;
  }
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
  [() => props.flow, width, boxWidth, compact, direction, columns, em],
  measure,
  {
    immediate: true,
  },
);

// Measure candidate widths with the rendered font, then commit the selected layout.
function measureBranches() {
  if (!width.value || !root.value) return;
  const elements = props.flow.nodes.map((_, i) =>
    nodeEls.value.find((n) => n.dataset.node === String(i))!,
  );
  const labels = props.flow.edges.map((_, i) =>
    labelEls.value.find((n) => n.dataset.edge === String(i)),
  );
  if (elements.some((el) => !el)) return;
  let guess = width.value < fixedFromEm * em.value ? "outline" : "down";
  let result: BranchLayout;
  for (let pass = 0; pass < 2; pass++) {
    root.value
      .closest("figure")
      ?.classList.toggle("flow--outline", guess === "outline");
    const nodes = new Map<string, { h: number; tag: number }>();
    const text = new Map<string, { w: number; h: number }>();
    result = layoutBranches(
      props.flow,
      analysis.value,
      {
        node(i, w) {
          const key = `${i}|${w}`;
          if (!nodes.has(key)) {
            const el = elements[i];
            el.style.width = `${w}px`;
            el.classList.toggle(
              "flow-node--from-above",
              guess !== "outline" &&
                props.flow.edges.some((e) => {
                  if (e.to !== props.flow.nodes[i].id) return false;
                  if (guess === "down") return !e.side;
                  const source = props.flow.nodes.findIndex(
                    (n) => n.id === e.from,
                  );
                  return analysis.value.shape === "spine"
                    ? e.side
                    : analysis.value.all(source).length === 1;
                }),
            );
            nodes.set(key, {
              h: el.offsetHeight,
              tag: el.querySelector<HTMLElement>(".flow-box")!.offsetTop,
            });
          }
          return nodes.get(key)!;
        },
        label(i, mode, maxWidth) {
          const key = `${i}|${mode}|${maxWidth}`;
          if (!text.has(key)) {
            const el = labels[i]!;
            el.style.maxWidth =
              mode === "strip"
                ? `${maxWidth}px`
                : mode === "on"
                  ? "7em"
                  : "5em";
            text.set(key, { w: el.offsetWidth, h: el.offsetHeight });
          }
          return text.get(key)!;
        },
      },
      Math.floor(width.value),
      em.value,
    );
    if (result.mode === guess) break;
    guess = result.mode;
  }
  branchLayout.value = result!;
  // Candidate measurement changed widths directly; restore the selected widths
  // even when Vue's previous render has the same style value.
  result!.nodes.forEach((n, i) => {
    elements[i].style.width = `${n.w}px`;
    elements[i].classList.toggle(
      "flow-node--from-above",
      result!.mode !== "outline" &&
        props.flow.edges.some((edge, j) => {
          if (edge.to !== props.flow.nodes[i].id) return false;
          const points = result!.edges[j].points,
            a = points.at(-2)!,
            b = points.at(-1)!;
          return Math.abs(a[0] - b[0]) < 0.5 && b[1] > a[1];
        }),
    );
  });
  result!.edges.forEach((e, i) => {
    if (labels[i] && e.label)
      labels[i]!.style.maxWidth =
        result!.mode === "outline"
          ? `${e.label.w + 1}px`
          : e.label.on
            ? "7em"
            : "5em";
  });
}

const fromAbove = computed(() =>
  props.flow.nodes.map(
    (node) =>
      mode.value !== "outline" &&
      props.flow.edges.some((edge, i) => {
        if (edge.to !== node.id) return false;
        const points = layout.value.edges[i].points;
        const a = points.at(-2)!,
          b = points.at(-1)!;
        return Math.abs(a[0] - b[0]) < 0.5 && b[1] > a[1];
      }),
  ),
);
function shape(i: number) {
  const w = layout.value.nodes[i].w;
  const n = branchLayout.value?.nodes[i];
  const h = n
    ? n.h - n.tag
    : (heights.value[i]?.h ?? 42) - (heights.value[i]?.tag ?? 0);
  const slant = 0.75 * em.value;
  return {
    view: `0 0 ${w} ${h}`,
    points: `${slant},.75 ${w - slant},.75 ${w - 0.75},${h / 2} ${w - slant},${h - 0.75} ${slant},${h - 0.75} .75,${h / 2}`,
  };
}
function labelStyle(i: number) {
  const label = layout.value.edges[i].label;
  const measured = branchLayout.value?.edges[i].label;
  const edge = props.flow.edges[i];
  const hasStep = props.flow.steps?.some(
    (step) => step.at === `${edge.from} > ${edge.to}`,
  );
  const segment = flowEdgeSegment(layout.value, i);
  const horizontal =
    Math.abs(segment.b[0] - segment.a[0]) >
    Math.abs(segment.b[1] - segment.a[1]);
  const blocked = props.flow.steps?.some(
    (step) => step.at === `${edge.from} > ${edge.to}` && step.block,
  );
  const shift =
    hasStep && mode.value !== "outline" ? (horizontal && blocked ? 33 : 16) : 0;
  return {
    left: `${(label?.x ?? 0) + (!horizontal ? shift : 0)}px`,
    top: `${(label?.y ?? 0) - (horizontal ? shift : 0)}px`,
    maxWidth:
      branched.value && measured
        ? mode.value === "outline"
          ? `${measured.w + 1}px`
          : measured.on
            ? "7em"
            : "5em"
        : undefined,
  };
}
/** The line, stopping short of the arrow head, and the head. */
function draw(points: Point[], arrowhead = true) {
  const [px, py] = points.at(-2)!;
  const [tx, ty] = points.at(-1)!;
  const length = Math.hypot(tx - px, ty - py) || 1;
  const [dx, dy] = [(tx - px) / length, (ty - py) / length];
  const [bx, by] = [tx - dx * arrow, ty - dy * arrow];
  const line = (arrowhead ? [...points.slice(0, -1), [bx, by]] : points)
    .map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`)
    .join(" ");
  const head = `M${tx} ${ty} L${bx - dy * 3.5} ${by + dx * 3.5} L${bx + dy * 3.5} ${by - dx * 3.5} Z`;
  return { line, head: arrowhead ? head : "" };
}
const canvasHeight = computed(
  () =>
    layout.value.height +
    (props.flow.steps?.some((step) => step.block)
      ? 14 *
        (2 +
          Math.max(
            0,
            ...stepMarkers.value.map((marker) =>
              marker.block ? marker.sibling : 0,
            ),
          ))
      : 0),
);
const lines = computed(() =>
  layout.value.edges.map((e) => draw(e.points, e.arrow !== false)),
);

const stepMarkers = computed(() =>
  flowStepMarkers(
    props.flow,
    layout.value,
    props.flow.nodes.map(
      (_, index) =>
        branchLayout.value?.nodes[index]?.tag ?? heights.value[index]?.tag ?? 0,
    ),
    22,
    mode.value === "outline",
  ),
);
function blockLabelStyle(marker: {
  sibling?: number;
  x: number;
  y: number;
  vertical: boolean;
}) {
  const room = (width.value - layout.value.width) / 2;
  return marker.vertical
    ? {
        left: `${marker.x + 18}px`,
        top: `${marker.y - 7}px`,
        maxWidth: `${Math.max(50, layout.value.width + room - marker.x - 20)}px`,
      }
    : {
        left: `${marker.x}px`,
        top: `${marker.y + 18 + (marker.sibling ?? 0) * 18}px`,
        transform: "translateX(-50%)",
        maxWidth: `${Math.max(50, Math.min(marker.x + room, layout.value.width + room - marker.x) * 2 - 4)}px`,
      };
}
</script>

<template>
  <FigureCard
    ref="card"
    :caption="caption"
    class="flow"
    :class="[`flow--${mode}`, { 'flow--compact': compact }]"
  >
    <div class="flow-frame" :style="{ width: `${layout.width}px` }">
      <p v-if="flow.over" class="flow-over">
        <DiagramText :text="flow.over" />
      </p>
      <div class="flow-canvas" :style="{ height: `${canvasHeight}px` }">
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
        <template
          v-for="{ n: i, edges } in readingOrder"
          :key="flow.nodes[i].id"
        >
          <span
            v-for="edge in edges"
            :key="`label-${edge}`"
            ref="labelEls"
            class="flow-label"
            :data-edge="edge"
            :class="{
              'flow-label--on': branched && branchLayout?.edges[edge].label?.on,
            }"
            :style="labelStyle(edge)"
            ><DiagramText :text="flow.edges[edge].text"
          /></span>
          <div
            ref="nodeEls"
            :data-node="i"
            class="flow-node"
            :class="[
              `flow-node--${flow.nodes[i].kind}`,
              `flow-node--${flow.nodes[i].tone}`,
              {
                'flow-node--from-above': fromAbove[i],
                'flow-node--stepped': flow.steps?.some(
                  (step) => step.at === flow.nodes[i].id,
                ),
              },
            ]"
            :style="{
              left: `${layout.nodes[i].x}px`,
              top: `${layout.nodes[i].y}px`,
              width: `${layout.nodes[i].w}px`,
            }"
          >
            <span v-if="flow.nodes[i].tag" class="flow-tag"
              ><DiagramText :text="flow.nodes[i].tag"
            /></span>
            <div class="flow-box">
              <svg
                v-if="flow.nodes[i].kind === 'ask'"
                class="flow-shape"
                :viewBox="shape(i).view"
                preserveAspectRatio="none"
                aria-hidden="true"
              >
                <polygon
                  :points="shape(i).points"
                  vector-effect="non-scaling-stroke"
                />
              </svg>
              <span class="flow-text"
                ><DiagramText :text="flow.nodes[i].text"
              /></span>
            </div>
          </div>
        </template>
        <template v-for="marker in stepMarkers" :key="`step-${marker.index}`">
          <span
            v-if="marker.block"
            class="flow-block"
            :class="{ 'flow-block--vertical': marker.vertical }"
            :style="{ left: `${marker.x}px`, top: `${marker.y}px` }"
            aria-hidden="true"
          />
          <span
            class="flow-step-number step-number"
            :class="{ 'step-number--blocked': marker.block }"
            :data-step="marker.index"
            :data-node="marker.node"
            :style="{
              left: `${marker.x + (marker.block && marker.vertical ? -19 : 0)}px`,
              top: `${marker.y + (marker.block ? (marker.vertical ? 0 : -19) : 0)}px`,
            }"
            >{{ marker.index + 1 }}</span
          >
          <span
            v-if="marker.block"
            class="flow-block-label"
            :style="blockLabelStyle(marker)"
            >{{ marker.block }}</span
          >
        </template>
      </div>
    </div>
    <StepDescriptions
      v-if="flow.steps?.length"
      :items="flow.steps"
      numbered
      columns
    />
    <p v-if="flow.note" class="flow-note">
      <DiagramText :text="flow.note" />
    </p>
    <template v-if="$slots.caption" #caption><slot name="caption" /></template>
  </FigureCard>
</template>

<style scoped>
.flow {
  font-family: var(--font-sans);
  font-size: var(--text-sm);
  line-height: var(--leading-tight);
}
/* Candidate widths must take effect before their geometry is read. */
.flow * {
  transition-property: none;
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
  font-weight: 500;
  text-align: center;
  line-break: strict;
}
.flow-label--on {
  background: var(--paper);
  box-shadow:
    3px 0 var(--paper),
    -3px 0 var(--paper);
}
.flow--outline .flow-box {
  text-align: left;
}
.flow--outline .flow-tag {
  padding-left: calc(var(--text-sm) * 0.875 + 6px);
  text-align: left;
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
.flow-step-number {
  position: absolute;
  transform: translate(-50%, -50%);
}
.flow-block {
  position: absolute;
  width: var(--figure-block-line);
  height: var(--figure-block-length);
  background: var(--danger);
  transform: translate(-50%, -50%);
}
.flow-block--vertical {
  width: var(--figure-block-length);
  height: var(--figure-block-line);
}
.flow-block-label {
  position: absolute;
  width: max-content;
  color: var(--danger);
  font-size: var(--text-xs);
  font-weight: 500;
  line-height: 1.35;
}
.flow:has(.flow-step-number) .flow-frame {
  padding-top: var(--space-4);
  padding-bottom: var(--space-4);
}
.flow-node--stepped .flow-tag {
  padding-right: var(--figure-step-size);
  text-align: left;
}
</style>
