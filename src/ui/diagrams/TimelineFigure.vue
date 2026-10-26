<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
} from "vue";
import { longestLeader } from "./check";
import DiagramText from "./DiagramText.vue";
import TimelineMark from "./TimelineMark.vue";
import type { Timeline, TimelineEvent, TimelineSpan } from "./model";

const props = defineProps<{ timeline: Timeline; caption?: string }>();

// Below this width the figure reads as a vertical list instead of an axis.
const narrowBelow = 560;
const gap = 8;
const leader = 12;
// Packing uses the width of the text; the box is drawn a little wider, still
// centred on it, so rounding never pushes a line onto a second row.
const slack = 12;

const root = ref<HTMLElement>();
const width = ref(0);
let observer: ResizeObserver | undefined;
onMounted(() => {
  observer = new ResizeObserver(([entry]) => {
    width.value = entry.contentRect.width;
  });
  if (root.value) observer.observe(root.value);
});
onBeforeUnmount(() => observer?.disconnect());
const narrow = computed(() => width.value > 0 && width.value < narrowBelow);

type Label =
  | { kind: "event"; lane: number; at: number; item: TimelineEvent }
  | { kind: "span"; lane: number; at: number; item: TimelineSpan };
const labels = computed<Label[]>(() =>
  props.timeline.lanes.flatMap((lane, l) =>
    [
      ...lane.events.map((item): Label => ({
        kind: "event",
        lane: l,
        at: item.at,
        item,
      })),
      ...lane.spans.map((item): Label => ({
        kind: "span",
        lane: l,
        at: (item.from + item.to) / 2,
        item,
      })),
    ].sort((a, b) => a.at - b.at),
  ),
);
const markers = computed(() => props.timeline.markers);
// Markers with a line of text under the axis, by marker index.
const belowMarkers = computed(() =>
  markers.value.flatMap((m, i) => (m.below ? [i] : [])),
);
const ticked = computed(() => props.timeline.ticks.length > 0);
const brackets = computed(() => props.timeline.brackets);
const laned = computed(() => props.timeline.lanes.some((lane) => lane.label));
// A single unnamed lane alternates its events above and below the line.
const alternate = computed(
  () => !laned.value && props.timeline.lanes.length === 1,
);
// Evenly spaced, the line is inset by half a label at each end so the end
// labels centre on their dots: with n labels, w = 2 * spacing - gap and
// spacing = (W - w) / (n - 1). Dated spacing is uneven and keeps wide labels.
const labelWidth = computed(() => {
  const count = props.timeline.lanes[0].events.length;
  if (!props.timeline.even || count < 3 || !width.value) return 0;
  return (2 * width.value - gap * (count - 1)) / (count + 1);
});
const labelMax = computed(() =>
  labelWidth.value ? `${labelWidth.value}px` : undefined,
);

// Every label's box is measured once rendered; positions follow from the sizes.
const labelBoxes = ref<HTMLElement[]>([]);
const markerBoxes = ref<HTMLElement[]>([]);
const belowBoxes = ref<HTMLElement[]>([]);
const bracketBoxes = ref<HTMLElement[]>([]);
const laneBoxes = ref<HTMLElement[]>([]);
const sizes = ref<{
  labels: { w: number; h: number }[];
  markers: { w: number; h: number }[];
  below: { w: number; h: number }[];
  brackets: { w: number; h: number }[];
  gutter: number;
  /** The label font size, which sets how long a leader may run. */
  em: number;
} | null>(null);
async function measure() {
  if (narrow.value || !width.value) return;
  sizes.value = null;
  await nextTick();
  // A wrapped label's box keeps its maximum width; its lines are what a
  // leader must miss, so the width is that of the longest line.
  const size = (el: HTMLElement) => {
    // Text nodes only: the date is a block that spans the whole box.
    const lines: DOMRect[] = [];
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const range = document.createRange();
      range.selectNodeContents(walker.currentNode);
      lines.push(...range.getClientRects());
    }
    const w = lines.length
      ? // A phrase's closing space is a margin, not text: leave room for it.
        Math.ceil(
          Math.max(...lines.map((r) => r.right)) -
            Math.min(...lines.map((r) => r.left)),
        ) + 6
      : el.offsetWidth;
    return { w: Math.min(w, el.offsetWidth), h: el.offsetHeight };
  };
  sizes.value = {
    labels: labelBoxes.value.map(size),
    markers: markerBoxes.value.map(size),
    below: belowBoxes.value.map(size),
    brackets: bracketBoxes.value.map(size),
    gutter: Math.max(0, ...laneBoxes.value.map((el) => el.offsetWidth)),
    em: labelBoxes.value.length
      ? parseFloat(getComputedStyle(labelBoxes.value[0]).fontSize)
      : 16,
  };
}
// Label widths depend on the figure width, so a resize measures again.
// A packing that can only cross a leader, or stacks a label too far from its
// point, narrows the labels, which wrap into more lines and cover less of the
// line, and tries again; when no width is clean the least bad one stays.
const caps = [14, 12, 10, 8];
const cap = ref(caps[0]);
let tried: { cap: number; score: number }[] = [];
let settled = false;
watch([() => props.timeline, width], () => {
  cap.value = caps[0];
  tried = [];
  settled = false;
  measure();
});

// A label centres on its point, ends or starts at it, or as a last resort
// sits wholly before or after it, beside its leader.
const aligns = ["center", "end", "start", "before", "after"] as const;
const beside = (align: string) => align === "before" || align === "after";
// How far past its point a label that ends or starts there reaches.
const endInset = 10;
interface Placed {
  /** Where the leader meets the line. */
  x: number;
  left: number;
  top: number;
  above: boolean;
  align: (typeof aligns)[number];
}
/**
 * Packs boxes anchored at x into rows outward from a line, nearest row first.
 * An item with `xs` may anchor at any of them instead (a span along its bar).
 * No label may straddle a wall (a marker line) unless nothing else fits.
 */
function pack(
  items: {
    x: number;
    xs?: number[];
    w: number;
    h: number;
    prefer: "above" | "below";
  }[],
  min: number,
  max: number,
  walls: number[] = [],
) {
  // Items are placed in sequence, nearest free row first; the first placed
  // gets the best rows. When one can only cross a leader, it goes first and
  // the packing starts over.
  function attempt(sequence: number[]) {
    const rows: { above: boolean; spans: [number, number][]; h: number }[] = [];
    const placed: {
      above: boolean;
      depth: number;
      extent: [number, number];
      x: number;
    }[] = [];
    const order = (prefer: "above" | "below") => {
      const first = prefer === "above";
      const result: { above: boolean; depth: number }[] = [];
      for (let depth = 0; depth < items.length + 1; depth++)
        result.push({ above: first, depth }, { above: !first, depth });
      return result;
    };
    // An extent carries the pad either side: a leader keeps that clear of a label.
    const within = (x: number, [a, b]: [number, number]) => x > a && x < b;
    // A label's leader runs from the line through the rows nearer the line, so
    // it must not cross a label there, and no deeper leader may cross the label.
    const clear = (
      slot: { above: boolean; depth: number },
      x: number,
      extent: [number, number],
    ) =>
      placed.every(
        (p) =>
          p.above !== slot.above ||
          (p.depth < slot.depth
            ? !within(x, p.extent)
            : p.depth > slot.depth
              ? !within(p.x, extent)
              : true),
      );
    // Drawn boxes are wider than the packed text by the slack; keep them apart too.
    // Labels in one row keep a clear gap, so neighbouring dates never read as one.
    const pad = slack / 2 + gap;
    const chosen: {
      x: number;
      left: number;
      align: Placed["align"];
      row: (typeof rows)[number];
      crossed: boolean;
    }[] = [];
    for (const i of sequence) {
      const item = items[i];
      // A label centres on its point, or ends or starts at it to leave a
      // neighbour's point uncovered, so the neighbour's leader can pass.
      const options = (item.xs ?? [item.x]).flatMap((x) =>
        aligns.map((align) => {
          const ideal =
            align === "center"
              ? x - item.w / 2
              : align === "end"
                ? x - item.w + endInset
                : align === "start"
                  ? x - endInset
                  : align === "before"
                    ? x - 3 - slack / 2 - item.w
                    : x + 3 + slack / 2;
          const left = Math.min(Math.max(ideal, min), max - item.w);
          const extent: [number, number] = [left - pad, left + item.w + pad];
          const covers = items.filter(
            (other, j) => j !== i && other.x !== x && within(other.x, extent),
          ).length;
          // The drawn box, a little wider than the text, must clear a wall.
          const walled = walls.some(
            (wall) =>
              wall > left - slack / 2 - 2 &&
              wall < left + item.w + slack / 2 + 2,
          );
          return { x, align, left, extent, covers, walled };
        }),
      );
      // When every row on both sides would cross a leader, crossing is the lesser evil.
      place: for (const strict of [true, false])
        for (const slot of order(item.prefer)) {
          const row = rows.find(
            (r) => r.above === slot.above && rowDepth(r) === slot.depth,
          );
          const next =
            rows.filter((r) => r.above === slot.above).length === slot.depth;
          const fits = options.filter(
            ({ x, extent, walled }) =>
              (row
                ? row.spans.every(([a, b]) => extent[1] <= a || extent[0] >= b)
                : next) &&
              (!strict || (!walled && clear(slot, x, extent))),
          );
          if (!fits.length) continue;
          // A label beside its leader only when none can meet it.
          const rank = (o: (typeof fits)[number]) =>
            (beside(o.align) ? 100 : 0) + o.covers;
          const { x, align, left, extent } = fits.reduce((a, b) =>
            rank(b) < rank(a) ? b : a,
          );
          const target = row ?? { above: slot.above, spans: [], h: 0 };
          if (!row) rows.push(target);
          target.spans.push(extent);
          target.h = Math.max(target.h, item.h);
          placed.push({ ...slot, depth: rowDepth(target), extent, x });
          chosen[i] = { x, left, align, row: target, crossed: !strict };
          break place;
        }
    }
    function rowDepth(row: (typeof rows)[number]) {
      return rows.filter((r) => r.above === row.above).indexOf(row);
    }
    const offset = (row: (typeof rows)[number]) =>
      rows
        .filter((r) => r.above === row.above && rowDepth(r) < rowDepth(row))
        .reduce((sum, r) => sum + r.h + gap, leader);
    const extent = (above: boolean) =>
      rows
        .filter((r) => r.above === above && r.h)
        .reduce(
          (sum, r) => sum + r.h + gap,
          rows.some((r) => r.above === above && r.h) ? leader : 0,
        );
    return { chosen, offset, extent };
  }
  let sequence = items.map((_, i) => i);
  const first = attempt(sequence);
  let best = first;
  for (let tries = 0; tries < items.length; tries++) {
    const crossed = sequence.find((i) => best.chosen[i].crossed);
    if (crossed === undefined) break;
    sequence = [crossed, ...sequence.filter((i) => i !== crossed)];
    best = attempt(sequence);
  }
  const { chosen, offset, extent } = best.chosen.some((c) => c.crossed)
    ? first
    : best;
  return {
    up: extent(true),
    down: extent(false),
    crossed: chosen.some((c) => c.crossed),
    /** The longest leader, from the line to its label's near edge. */
    longest: Math.max(0, ...chosen.map(({ row }) => offset(row))),
    place: (i: number, lineY: number): Placed => {
      const { x, left, align, row } = chosen[i];
      const d = offset(row);
      return row.above
        ? { x, left, align, top: lineY - d - items[i].h, above: true }
        : { x, left, align, top: lineY + d, above: false };
    },
  };
}

const layout = computed(() => {
  const s = sizes.value;
  if (!s || narrow.value || !width.value) return null;
  const { from, to } = props.timeline;
  // Room for half a tick label at either end.
  const inset = Math.max(18, labelWidth.value / 2);
  const x0 = (laned.value ? s.gutter + 16 : 0) + inset;
  const x1 = width.value - inset;
  const x = (at: number) => x0 + ((at - from) / (to - from || 1)) * (x1 - x0);
  // Markers sit in their own row above every lane.
  const markerPack = pack(
    markers.value.map((m, i) => ({
      x: x(m.at),
      ...s.markers[i],
      prefer: "above",
    })),
    x0,
    x1,
  );
  let y = markerPack.up;
  const markerTop = y;
  const lanes = props.timeline.lanes.map((_, l) => {
    const indices = labels.value
      .map((label, i) => ({ label, i }))
      .filter(({ label }) => label.lane === l);
    let order = 0;
    const packed = pack(
      indices.map(({ label, i }) => ({
        x: x(label.at),
        // A span's label may hang from its middle or a quarter in from either end.
        xs:
          label.kind === "span"
            ? [0.5, 0.25, 0.75].map((f) =>
                x(label.item.from + f * (label.item.to - label.item.from)),
              )
            : undefined,
        ...s.labels[i],
        prefer:
          label.kind === "span"
            ? "below"
            : alternate.value && order++ % 2
              ? "below"
              : "above",
      })),
      // Labels may run past the line's ends into the inset.
      (laned.value ? s.gutter + 16 : 0) + slack / 2,
      width.value - slack / 2,
      markers.value.map((m) => x(m.at)),
    );
    const lineY = y + Math.max(packed.up, 18);
    y = lineY + Math.max(packed.down, 18) + gap;
    return { lineY, indices, packed };
  });
  const placed = new Map<number, Placed>();
  for (const lane of lanes)
    lane.indices.forEach(({ i }, k) =>
      placed.set(i, lane.packed.place(k, lane.lineY)),
    );
  const lanesBottom = y;
  const axisY = ticked.value ? lanesBottom + 4 : lanesBottom;
  y = axisY + (ticked.value ? 28 : 0);
  // A marker's second text sits under the axis, its line running down to it.
  const belowPack = pack(
    belowMarkers.value.map((m, k) => ({
      x: x(markers.value[m].at),
      ...s.below[k],
      prefer: "below",
    })),
    x0,
    x1,
  );
  const belowY = y;
  if (belowMarkers.value.length) y = belowY + belowPack.down + gap;
  const bracketPack = pack(
    brackets.value.map((b, i) => ({
      x: (x(b.from) + x(b.to)) / 2,
      ...s.brackets[i],
      prefer: "below",
    })),
    x0,
    x1,
  );
  const bracketY = y + 6;
  if (brackets.value.length) y = bracketY + bracketPack.down + gap;
  return {
    x,
    x0,
    x1,
    height: y,
    markerTop,
    markerPlace: (i: number) => markerPack.place(i, markerTop),
    lanes: lanes.map(({ lineY }) => lineY),
    crossed: lanes.some(({ packed }) => packed.crossed),
    longest: Math.max(...lanes.map(({ packed }) => packed.longest)),
    belowPlace: (k: number) => belowPack.place(k, belowY),
    lanesBottom,
    axisY,
    bracketY,
    bracketPlace: (i: number) => bracketPack.place(i, bracketY),
    place: (i: number) => placed.get(i)!,
  };
});

const boxStyle = (p: Placed, w: number) => ({
  left: `${p.left - slack / 2}px`,
  top: `${p.top}px`,
  width: `${w + slack}px`,
});
watch(layout, (current) => {
  if (!current || settled) return;
  const long = current.longest > longestLeader * sizes.value!.em;
  if (!current.crossed && !long) {
    settled = true;
    return;
  }
  // A crossed leader is worse than any long one.
  tried.push({
    cap: cap.value,
    score: (current.crossed ? 1e6 : 0) + current.longest,
  });
  const next = caps[caps.indexOf(cap.value) + 1];
  if (next === undefined) {
    settled = true;
    const best = tried.reduce((a, b) => (b.score < a.score ? b : a));
    if (best.cap === cap.value) return;
    cap.value = best.cap;
  } else cap.value = next;
  measure();
});
const markerStyle = (i: number) => {
  const p = layout.value?.markerPlace(i);
  return p ? boxStyle(p, sizes.value!.markers[i].w) : {};
};
const labelStyle = (i: number) => {
  const p = layout.value?.place(i);
  return p ? boxStyle(p, sizes.value!.labels[i].w) : {};
};
const belowStyle = (k: number) => {
  const p = layout.value?.belowPlace(k);
  return p ? boxStyle(p, sizes.value!.below[k].w) : {};
};
// The marker line ends at its text under the axis, or at the last lane.
const markerEnd = (i: number) => {
  const k = belowMarkers.value.indexOf(i);
  return k < 0 ? layout.value!.lanesBottom : layout.value!.belowPlace(k).top;
};
// A marker line passes behind labels: it breaks around any label it would cross.
const markerSegments = (i: number) => {
  const l = layout.value!;
  const s = sizes.value!;
  const x = l.x(markers.value[i].at);
  const gaps = labels.value
    .map((_, j) => ({ p: l.place(j), ...s.labels[j] }))
    .filter(({ p, w }) => x > p.left - slack / 2 && x < p.left + w + slack / 2)
    .map(({ p, h }) => [p.top - 4, p.top + h + 4])
    .sort((a, b) => a[0] - b[0]);
  const segments: [number, number][] = [];
  let from = l.markerTop - leader;
  for (const [a, b] of gaps) {
    if (a > from) segments.push([from, a]);
    from = Math.max(from, b);
  }
  const end = markerEnd(i);
  if (end > from) segments.push([from, end]);
  return segments;
};
const bracketStyle = (i: number) => {
  const p = layout.value?.bracketPlace(i);
  return p ? boxStyle(p, sizes.value!.brackets[i].w) : {};
};
const leaderEnd = (i: number) => {
  const p = layout.value!.place(i);
  const h = sizes.value!.labels[i].h;
  return p.above ? p.top + h : p.top;
};

// The vertical list keeps time gaps visible, within limits.
const rows = computed(() =>
  props.timeline.lanes.map((lane, l) => {
    const items = [
      ...labels.value.filter((label) => label.lane === l),
      ...markers.value.map((m) => ({
        kind: "marker" as const,
        at: m.at,
        item: m,
      })),
    ].sort((a, b) => a.at - b.at);
    const range = props.timeline.to - props.timeline.from || 1;
    return {
      label: lane.label,
      items: items.map((entry, i) => ({
        entry,
        gap:
          i === 0 || props.timeline.even
            ? 0
            : Math.min(
                2.5,
                Math.max(0.25, ((entry.at - items[i - 1].at) / range) * 12),
              ),
      })),
    };
  }),
);
</script>

<template>
  <figure ref="root" class="timeline" :class="{ 'timeline--narrow': narrow }">
    <div
      v-if="!narrow"
      class="timeline-canvas"
      :style="{
        height: layout ? `${layout.height}px` : undefined,
        '--label-max': labelMax,
        '--label-cap': `${cap}em`,
      }"
    >
      <svg
        v-if="layout"
        class="timeline-lines"
        :width="width"
        :height="layout.height"
        aria-hidden="true"
      >
        <g v-for="(m, i) in markers" :key="`m${i}`">
          <line
            v-for="([a, b], k) in markerSegments(i)"
            :key="k"
            class="timeline-marker"
            :class="{ 'timeline--accent': m.accent }"
            :x1="layout.x(m.at)"
            :x2="layout.x(m.at)"
            :y1="a"
            :y2="b"
          />
        </g>
        <line
          v-for="(lineY, l) in layout.lanes"
          :key="`l${l}`"
          class="timeline-lane"
          :x1="layout.x0"
          :x2="layout.x1"
          :y1="lineY"
          :y2="lineY"
        />
        <template v-for="(label, i) in labels" :key="`e${i}`">
          <rect
            v-if="label.kind === 'span'"
            class="timeline-span"
            :class="{ 'timeline--accent': label.item.accent }"
            :x="layout.x(label.item.from)"
            :y="layout.lanes[label.lane] - 4"
            :width="layout.x(label.item.to) - layout.x(label.item.from)"
            height="8"
            rx="2"
          />
          <line
            class="timeline-leader"
            :x1="layout.place(i).x"
            :x2="layout.place(i).x"
            :y1="layout.lanes[label.lane]"
            :y2="leaderEnd(i)"
          />
          <TimelineMark
            v-if="label.kind === 'event'"
            :mark="label.item.mark"
            :accent="label.item.accent"
            :undated="label.item.undated"
            :x="layout.x(label.at)"
            :y="layout.lanes[label.lane]"
          />
        </template>
        <template v-if="ticked">
          <line
            class="timeline-axis"
            :x1="layout.x0"
            :x2="layout.x1"
            :y1="layout.axisY"
            :y2="layout.axisY"
          />
          <g v-for="tick in timeline.ticks" :key="tick.at">
            <line
              class="timeline-axis"
              :x1="layout.x(tick.at)"
              :x2="layout.x(tick.at)"
              :y1="layout.axisY"
              :y2="layout.axisY + 5"
            />
            <text
              class="timeline-tick"
              :x="layout.x(tick.at)"
              :y="layout.axisY + 20"
            >
              {{ tick.text }}
            </text>
          </g>
        </template>
        <path
          v-for="(b, i) in brackets"
          :key="`b${i}`"
          class="timeline-bracket"
          :class="{ 'timeline--accent': b.accent }"
          :d="`M ${layout.x(b.from)} ${layout.bracketY - 6} V ${layout.bracketY} H ${layout.x(b.to)} V ${layout.bracketY - 6}`"
        />
      </svg>
      <div
        v-for="(lane, l) in timeline.lanes"
        v-show="lane.label"
        :key="`n${l}`"
        ref="laneBoxes"
        class="timeline-lane-label"
        :style="
          layout ? { top: `${layout.lanes[l]}px` } : { visibility: 'hidden' }
        "
      >
        {{ lane.label }}
      </div>
      <div
        v-for="(m, i) in markers"
        :key="`mt${i}`"
        ref="markerBoxes"
        class="timeline-label"
        :class="{ 'timeline--accent': m.accent }"
        :style="layout ? markerStyle(i) : { visibility: 'hidden' }"
      >
        <span class="timeline-date">{{ m.show }}</span
        ><DiagramText v-if="m.text" :text="m.text" />
      </div>
      <div
        v-for="(m, k) in belowMarkers"
        :key="`mb${m}`"
        ref="belowBoxes"
        class="timeline-label"
        :class="{ 'timeline--accent': markers[m].accent }"
        :style="layout ? belowStyle(k) : { visibility: 'hidden' }"
      >
        <DiagramText :text="markers[m].below" />
      </div>
      <div
        v-for="(label, i) in labels"
        :key="`t${i}`"
        ref="labelBoxes"
        class="timeline-label"
        :class="{
          'timeline--accent': label.item.accent,
          'timeline-label--above': layout?.place(i).above,
          [`timeline-label--${layout?.place(i).align}`]: layout,
        }"
        :style="layout ? labelStyle(i) : { visibility: 'hidden' }"
      >
        <span v-if="label.item.show" class="timeline-date">{{
          label.item.show
        }}</span
        ><span class="timeline-text"
          ><DiagramText :text="label.item.text"
        /></span>
      </div>
      <div
        v-for="(b, i) in brackets"
        :key="`bt${i}`"
        ref="bracketBoxes"
        class="timeline-label timeline-label--bracket"
        :class="{ 'timeline--accent': b.accent }"
        :style="layout ? bracketStyle(i) : { visibility: 'hidden' }"
      >
        <DiagramText :text="b.text" />
      </div>
    </div>
    <div v-else class="timeline-list">
      <section v-for="(lane, l) in rows" :key="l">
        <h4 v-if="lane.label">{{ lane.label }}</h4>
        <ol>
          <li
            v-for="({ entry, gap: space }, i) in lane.items"
            :key="i"
            :class="[
              `timeline-row--${entry.kind}`,
              entry.kind === 'event' && `timeline-row--${entry.item.mark}`,
              {
                'timeline--accent': entry.item.accent,
                'timeline-row--undated':
                  entry.kind === 'event' && entry.item.undated,
              },
            ]"
            :style="{ marginTop: `${space}rem` }"
          >
            <span v-if="entry.item.show" class="timeline-date">{{
              entry.item.show
            }}</span>
            <span v-if="entry.item.text" class="timeline-text"
              ><DiagramText :text="entry.item.text"
            /></span>
            <span
              v-if="entry.kind === 'marker' && entry.item.below"
              class="timeline-text"
              ><DiagramText :text="entry.item.below"
            /></span>
          </li>
        </ol>
      </section>
      <p v-for="(b, i) in brackets" :key="i" class="timeline-row--bracket">
        <span class="timeline-date">{{ b.show }}</span>
        <span :class="{ 'timeline--accent': b.accent }">{{ b.text }}</span>
      </p>
    </div>
    <p v-if="timeline.legend.length" class="timeline-legend">
      <span
        v-for="(item, i) in timeline.legend"
        :key="i"
        class="timeline-legend-item"
        ><svg
          :width="14 * item.marks.length"
          height="14"
          aria-hidden="true"
          class="timeline-legend-marks"
        >
          <TimelineMark
            v-for="(mark, j) in item.marks"
            :key="j"
            :mark="mark"
            :accent="item.accent"
            :x="7 + 14 * j"
            :y="7"
          /></svg
        >{{ item.text }}</span
      >
    </p>
    <figcaption v-if="caption">{{ caption }}</figcaption>
  </figure>
</template>

<style scoped>
.timeline {
  margin: 0;
  font-family: var(--font-sans);
}
.timeline-canvas {
  position: relative;
  min-height: 4rem;
}
.timeline-lines {
  position: absolute;
  inset: 0;
  overflow: visible;
}
.timeline-lane {
  stroke: var(--rule-strong);
  stroke-width: 1.5;
}
.timeline-axis {
  stroke: var(--ink-muted);
  stroke-width: 1;
}
.timeline-tick {
  fill: var(--ink-muted);
  font-size: var(--text-xs);
  font-variant-numeric: tabular-nums;
  text-anchor: middle;
}
.timeline-leader {
  stroke: var(--rule-strong);
  stroke-width: 1;
}
.timeline-marker {
  stroke: var(--ink-muted);
  stroke-width: 1;
  stroke-dasharray: 4 3;
}
.timeline-marker.timeline--accent {
  stroke: var(--evidence);
  stroke-width: 1.5;
  stroke-dasharray: none;
}
.timeline-span {
  fill: var(--accent-soft);
  stroke: var(--accent);
  stroke-width: 1;
}
.timeline-span.timeline--accent {
  fill: var(--evidence-soft);
  stroke: var(--evidence);
}
.timeline-bracket {
  fill: none;
  stroke: var(--ink-soft);
  stroke-width: 1.25;
}
.timeline-bracket.timeline--accent {
  stroke: var(--evidence);
}
.timeline-label,
.timeline-lane-label {
  position: absolute;
  left: 0;
  top: 0;
  max-width: min(max(7em, var(--label-max, 14em)), var(--label-cap), 40%);
  min-width: min-content;
  text-align: center;
  line-break: strict;
  text-wrap: balance;
  font-size: var(--text-base);
  line-height: var(--leading-tight);
  color: var(--ink);
}
/* Above the line the date comes last, so every date sits next to its dot. */
.timeline-label--above {
  display: flex;
  flex-direction: column-reverse;
  align-items: center;
}
/* A label that ends or starts at its point lines its text up with the leader. */
.timeline-label--end,
.timeline-label--before {
  text-align: right;
  align-items: flex-end;
}
.timeline-label--start,
.timeline-label--after {
  text-align: left;
  align-items: flex-start;
}
.timeline-lane-label {
  transform: translateY(-50%);
  text-align: left;
  font-weight: 500;
  color: var(--ink-soft);
}
.timeline-label--bracket {
  text-align: center;
  color: var(--ink-soft);
}
/* A date stays on one line; its label is never narrower than it. */
.timeline-date {
  display: block;
  white-space: nowrap;
  font-weight: 500;
  font-variant-numeric: tabular-nums;
  color: var(--ink-soft);
}
.timeline-label.timeline--accent,
.timeline-label.timeline--accent .timeline-date,
.timeline-list .timeline--accent,
.timeline-list .timeline--accent .timeline-date {
  color: var(--evidence);
}
.timeline-list h4 {
  margin: var(--space-4) 0 var(--space-2);
  font-size: var(--text-sm);
  font-weight: 500;
  color: var(--ink-soft);
}
/* The points straddle the list's line; the margin keeps them inside the figure. */
.timeline-list ol {
  list-style: none;
  margin: 0 0 0 6px;
  padding: 0 0 0 var(--space-4);
  border-left: 1.5px solid var(--rule-strong);
}
.timeline-list li,
.timeline-row--bracket {
  position: relative;
  font-size: var(--text-sm);
  line-height: var(--leading-tight);
}
.timeline-list li::before {
  content: "";
  position: absolute;
  left: calc(-1 * var(--space-4) - 5.75px);
  top: 0.3em;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--accent);
}
.timeline-list li.timeline--accent::before {
  background: var(--evidence);
}
.timeline-list li.timeline-row--square::before {
  border-radius: 1px;
  width: 9px;
  height: 9px;
}
.timeline-list li.timeline-row--diamond::before {
  border-radius: 0;
  width: 8px;
  height: 8px;
  margin-left: 0.5px;
  transform: rotate(45deg);
}
.timeline-list li.timeline-row--ring::before {
  background: var(--surface);
  border: 2px solid var(--accent);
  box-sizing: border-box;
}
.timeline-list li.timeline-row--ring.timeline--accent::before {
  background: var(--surface);
  border-color: var(--evidence);
}
.timeline-list li.timeline-row--undated::before {
  background: var(--surface);
  border: 1.5px dashed var(--ink-muted);
  box-sizing: border-box;
}
.timeline-list li.timeline-row--span::before {
  border-radius: 2px;
  height: 1.2em;
  width: 8px;
  left: calc(-1 * var(--space-4) - 4.75px);
  background: var(--accent-soft);
  border: 1px solid var(--accent);
  box-sizing: border-box;
}
.timeline-list li.timeline-row--marker::before {
  background: none;
  border: none;
}
.timeline-list li.timeline-row--marker {
  color: var(--ink-soft);
  display: flex;
  flex-wrap: wrap;
  column-gap: 0.5em;
  border-top: 1px dashed var(--ink-muted);
  padding-top: var(--space-1);
}
.timeline-list li.timeline-row--marker.timeline--accent {
  border-top: 1.5px solid var(--evidence);
}
.timeline-row--bracket {
  margin: var(--space-3) 0 0;
  color: var(--ink-soft);
}
.timeline-legend {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1) var(--space-4);
  margin: var(--space-2) 0 0;
  font-size: var(--text-sm);
  line-height: var(--leading-tight);
  color: var(--ink-soft);
}
.timeline-legend-item {
  display: inline-flex;
  align-items: center;
  gap: 0.35em;
}
.timeline-legend-marks {
  flex: none;
  overflow: visible;
}
figcaption {
  margin-top: var(--space-3);
  font-size: var(--text-sm);
  color: var(--ink-soft);
}
</style>
