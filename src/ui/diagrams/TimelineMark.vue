<script setup lang="ts">
import { computed } from "vue";
import type { TimelineMark } from "./model";

// One event's point, drawn inside an <svg>: the figure's line and its legend use the same shapes.
const props = defineProps<{
  mark: TimelineMark;
  x: number;
  y: number;
  accent?: boolean;
  undated?: boolean;
}>();
// A diamond is a turned square; a smaller side keeps it as tall as a dot.
const side = computed(() => (props.mark === "diamond" ? 8 : 9));
</script>

<template>
  <circle
    v-if="mark === 'dot' || mark === 'ring'"
    class="timeline-dot"
    :class="{
      'timeline--accent': accent,
      'timeline-dot--ring': mark === 'ring',
      'timeline-dot--undated': undated,
    }"
    :cx="x"
    :cy="y"
    :r="mark === 'ring' ? 4.5 : 5"
  />
  <rect
    v-else
    class="timeline-dot"
    :class="{
      'timeline--accent': accent,
      'timeline-dot--undated': undated,
    }"
    :x="x - side / 2"
    :y="y - side / 2"
    :width="side"
    :height="side"
    :transform="mark === 'diamond' ? `rotate(45 ${x} ${y})` : undefined"
  />
</template>

<style scoped>
.timeline-dot {
  fill: var(--accent);
  stroke: var(--surface);
  stroke-width: 2;
}
.timeline-dot.timeline--accent {
  fill: var(--evidence);
}
.timeline-dot--ring {
  fill: var(--surface);
  stroke: var(--accent);
}
.timeline-dot--ring.timeline--accent {
  fill: var(--surface);
  stroke: var(--evidence);
}
.timeline-dot--undated {
  fill: var(--surface);
  stroke: var(--ink-muted);
  stroke-width: 1.5;
  stroke-dasharray: 2 2;
}
</style>
