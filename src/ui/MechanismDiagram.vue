<script setup lang="ts">
import { computed } from "vue";
import {
  transitionMarkup,
  type MechanismDrawing,
} from "./chemistry/mechanism-drawing.ts";
const props = withDefaults(
  defineProps<{
    drawing: MechanismDrawing;
    target?: MechanismDrawing;
    progress?: number;
    static?: boolean;
  }>(),
  { progress: 0 },
);
const fraction = computed(() =>
  props.static ? 0 : Math.max(0, (props.progress - 0.3) / 0.7),
);
const markup = computed(() =>
  props.target
    ? transitionMarkup(props.drawing, props.target, fraction.value)
    : props.drawing.markup,
);
const box = computed(() => {
  const a = props.drawing.box,
    b = props.target?.box ?? a;
  const x = Math.min(a.x, b.x),
    y = Math.min(a.y, b.y);
  return {
    x,
    y,
    width: Math.max(a.x + a.width, b.x + b.width) - x,
    height: Math.max(a.y + a.height, b.y + b.height) - y,
  };
});
</script>
<template>
  <svg
    class="mechanism-ink"
    role="img"
    :aria-label="drawing.frame.title || '机理帧'"
    :viewBox="`${box.x} ${box.y} ${box.width} ${box.height}`"
    :width="box.width"
    :height="box.height"
    :data-progress="fraction"
  >
    <g class="mechanism-structure" v-html="markup" />
    <g
      v-if="fraction === 0"
      class="electron-arrows"
      :opacity="static ? 1 : Math.min(1, progress / 0.2)"
    >
      <g
        v-for="(arrow, i) in drawing.arrows"
        :key="i"
        :data-electrons="arrow.electrons"
      >
        <path
          class="electron-arrow"
          :d="arrow.path"
          pathLength="1"
          :stroke-dasharray="static ? undefined : 1"
          :stroke-dashoffset="
            static ? undefined : 1 - Math.min(1, progress / 0.2)
          "
        />
        <path class="electron-head" :d="arrow.head" />
      </g>
    </g>
  </svg>
</template>
<style scoped>
.mechanism-ink {
  display: block;
  max-width: 100%;
  height: auto;
  margin-inline: auto;
  overflow: visible;
}
.electron-arrow,
.electron-head {
  fill: none;
  stroke: var(--accent);
  stroke-width: var(--mechanism-line);
  stroke-linecap: round;
  stroke-linejoin: round;
}
</style>
