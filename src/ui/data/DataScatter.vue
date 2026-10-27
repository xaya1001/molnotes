<script setup lang="ts">
import { computed } from "vue";
import {
  axisDomain,
  axisPosition,
  axisTicks,
  scatterPoints,
  type DataAlternates,
  type DataColumn,
  type DataRow,
  type Reading,
} from "./values.ts";

/**
 * One point per row with a drawable value in both chosen columns. A hollow
 * triangle is a value given only as a bound: pointing up for ">", down for
 * "<", drawn at the bound. A row whose plotted value another source prints
 * differently gets a dashed ring and a faint line to where the other reading
 * would put it. Rows without a value in either column are not drawn and are
 * counted below the plot; a missing cell is never plotted as zero.
 */
const props = defineProps<{
  rows: readonly DataRow[];
  x: DataColumn;
  y: DataColumn;
  /** Which reading of a cell with an alternate the points use. */
  use: Reading;
  alternates?: DataAlternates;
  noun: string;
  selected: string | null;
  /** Rows drawn at full strength; the others are dimmed. */
  highlight: readonly string[];
}>();
const emit = defineEmits<{ select: [id: string] }>();

const width = 560;
const height = 380;
const margin = { left: 64, right: 36, top: 16, bottom: 56 };
const innerW = width - margin.left - margin.right;
const innerH = height - margin.top - margin.bottom;

const dx = computed(() => axisDomain(props.rows, props.x, props.use));
const dy = computed(() => axisDomain(props.rows, props.y, props.use));
const xTicks = computed(() => axisTicks(dx.value));
const yTicks = computed(() => axisTicks(dy.value));
const left = (value: number) =>
  margin.left + axisPosition(value, dx.value) * innerW;
const top = (value: number) =>
  margin.top + innerH - axisPosition(value, dy.value) * innerH;

const points = computed(() => {
  const byId = new Map(props.rows.map((row) => [row.id, row]));
  return scatterPoints(props.rows, props.x, props.y, props.use).map((p) => ({
    ...p,
    cx: left(p.x),
    cy: top(p.y),
    bound: p.xOp !== "=" || p.yOp !== "=",
    down: p.xOp === "<" || p.yOp === "<",
    otherAt: p.other && { cx: left(p.other.x), cy: top(p.other.y) },
    label: `${byId.get(p.id)?.name}${
      p.flagged && props.alternates
        ? `（${props.alternates.source}写法不同）`
        : ""
    }：${props.x.label} ${p.xText}，${props.y.label} ${p.yText}`,
  }));
});
const missing = computed(() => props.rows.length - points.value.length);
function axisTitle(column: DataColumn) {
  const parts = [column.unit, column.scale === "log" ? "对数轴" : ""];
  const note = parts.filter(Boolean).join("，");
  return note ? `${column.label}（${note}）` : column.label;
}
function triangle(p: { cx: number; cy: number; down: boolean }) {
  return p.down
    ? `${p.cx},${p.cy + 7} ${p.cx - 6.5},${p.cy - 5} ${p.cx + 6.5},${p.cy - 5}`
    : `${p.cx},${p.cy - 7} ${p.cx - 6.5},${p.cy + 5} ${p.cx + 6.5},${p.cy + 5}`;
}
</script>
<template>
  <figure>
    <svg
      :viewBox="`0 0 ${width} ${height}`"
      role="group"
      :aria-label="`散点图：横轴 ${x.label}，纵轴 ${y.label}`"
    >
      <g class="grid">
        <template v-for="t in xTicks" :key="`x${t.v}`">
          <line
            :x1="left(t.v)"
            :x2="left(t.v)"
            :y1="margin.top"
            :y2="margin.top + innerH"
          />
          <text
            :x="left(t.v)"
            :y="margin.top + innerH + 18"
            text-anchor="middle"
          >
            {{ t.label }}
          </text>
        </template>
        <template v-for="t in yTicks" :key="`y${t.v}`">
          <line
            :x1="margin.left"
            :x2="margin.left + innerW"
            :y1="top(t.v)"
            :y2="top(t.v)"
          />
          <text :x="margin.left - 8" :y="top(t.v) + 4" text-anchor="end">
            {{ t.label }}
          </text>
        </template>
      </g>
      <text
        class="axis-title"
        :x="margin.left + innerW / 2"
        :y="height - 8"
        text-anchor="middle"
      >
        {{ axisTitle(x) }}
      </text>
      <text
        class="axis-title"
        :transform="`translate(14 ${margin.top + innerH / 2}) rotate(-90)`"
        text-anchor="middle"
      >
        {{ axisTitle(y) }}
      </text>
      <g v-for="p in points" :key="`alt${p.id}`" class="alt" aria-hidden="true">
        <template v-if="p.otherAt">
          <line :x1="p.cx" :y1="p.cy" :x2="p.otherAt.cx" :y2="p.otherAt.cy" />
          <circle :cx="p.otherAt.cx" :cy="p.otherAt.cy" r="3.5" />
        </template>
      </g>
      <g
        v-for="p in points"
        :key="p.id"
        role="button"
        tabindex="0"
        :aria-label="p.label"
        :aria-pressed="selected === p.id"
        :class="{
          dim: !highlight.includes(p.id),
          chosen: selected === p.id,
        }"
        @click="emit('select', p.id)"
        @keydown.enter.prevent="emit('select', p.id)"
        @keydown.space.prevent="emit('select', p.id)"
      >
        <circle v-if="p.flagged" class="ring" :cx="p.cx" :cy="p.cy" r="10" />
        <polygon v-if="p.bound" class="mark open" :points="triangle(p)" />
        <circle v-else class="mark" :cx="p.cx" :cy="p.cy" r="5.5" />
      </g>
    </svg>
    <figcaption class="caption">
      空心三角：这个值只给了界限（&gt; 是下限，&lt;
      是上限），画在界限的位置。圆点：确切值。<template
        v-if="alternates && points.some((p) => p.flagged)"
        >虚线圈：这个点用到的值，{{ alternates.listed }}和{{
          alternates.alternate
        }}写得不一样，细线通向另一种写法会落到的位置。</template
      >{{ missing }} 个{{ noun }}在这两列里缺值或没有画出。点击或按 Enter
      选择一个{{ noun }}。
    </figcaption>
  </figure>
</template>
<style scoped>
figure {
  margin-inline: 0;
}
svg {
  width: 100%;
  max-width: 40rem;
  font-family: var(--font-sans);
  font-size: var(--text-xs);
}
.grid line {
  stroke: var(--rule);
}
.grid text,
.axis-title {
  fill: var(--ink-muted);
}
g[role="button"] {
  cursor: pointer;
  outline: none;
}
.mark {
  fill: var(--accent);
  fill-opacity: 0.55;
  stroke: var(--accent-strong);
  stroke-width: 1;
}
.mark.open {
  fill: var(--surface);
  fill-opacity: 1;
  stroke-width: 1.6;
}
.dim {
  opacity: 0.18;
}
.chosen {
  opacity: 1;
}
.chosen .mark {
  fill: var(--evidence);
  stroke: var(--evidence);
  fill-opacity: 0.9;
}
.chosen .mark.open {
  fill: var(--evidence-soft);
}
.ring {
  fill: none;
  stroke: var(--evidence);
  stroke-width: 1.4;
  stroke-dasharray: 3 2.5;
}
.alt line {
  stroke: var(--ink-muted);
  stroke-width: 0.8;
  stroke-opacity: 0.6;
}
.alt circle {
  fill: none;
  stroke: var(--ink-muted);
  stroke-width: 1;
  stroke-dasharray: 2 2;
}
g[role="button"]:focus-visible .mark {
  stroke: var(--ink);
  stroke-width: 2.5;
}
</style>
