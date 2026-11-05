<script setup lang="ts">
import { computed, useId } from "vue";
import type { CatalyticCycle } from "../../shared/mechanism.ts";
import { cycleLayout } from "../../shared/mechanism-geometry.ts";
import type { MechanismDrawing } from "./chemistry/mechanism-drawing.ts";

const props = defineProps<{
  cycle: CatalyticCycle;
  drawings: MechanismDrawing[];
  branches: MechanismDrawing[][];
  index: number;
}>();
defineEmits<{ select: [index: number] }>();
const marker = useId();
const layout = computed(() => cycleLayout(props.drawings.length, 138));
</script>
<template>
  <div class="catalytic-cycle">
    <svg class="cycle-arcs" viewBox="-300 -300 600 600" aria-label="催化循环">
      <defs>
        <marker
          :id="marker"
          markerWidth="8"
          markerHeight="6"
          refX="7"
          refY="3"
          orient="auto"
        >
          <path d="M 0 0 L 7 3 L 0 6" />
        </marker>
      </defs>
      <g v-for="(node, i) in layout" :key="i" :class="{ current: i === index }">
        <path
          class="cycle-arc"
          :id="`${marker}-arc-${i}`"
          :d="node.arc"
          :marker-end="`url(#${marker})`"
        />
        <path
          class="arc-target"
          :d="node.arc"
          role="button"
          tabindex="0"
          :aria-label="cycle.steps[i].title"
          :aria-pressed="i === index"
          @click="$emit('select', i)"
          @keydown.enter.prevent="$emit('select', i)"
          @keydown.space.prevent="$emit('select', i)"
        />
        <text :x="node.label.x" :y="node.label.y" dy="-10" text-anchor="middle">
          {{ cycle.steps[i].title }}
        </text>
      </g>
    </svg>
    <div
      v-for="(drawing, i) in drawings"
      :key="i"
      class="cycle-intermediate"
      :class="{ current: i === index }"
      :style="{
        left: `${50 + layout[i].x / 6}%`,
        top: `${50 + layout[i].y / 6}%`,
      }"
    >
      <svg
        class="mechanism-ink"
        :viewBox="`${drawing.box.x} ${drawing.box.y} ${drawing.box.width} ${drawing.box.height}`"
        :width="drawing.box.width"
        :height="drawing.box.height"
        role="img"
        :aria-label="drawing.frame.title"
        v-html="drawing.markup"
      />
    </div>
    <template v-for="(step, i) in cycle.steps" :key="`branch${i}`">
      <div
        v-if="step.branches?.length"
        class="cycle-branches"
        :style="{
          left: `${50 + layout[i].branch.x / 6}%`,
          top: `${50 + layout[i].branch.y / 6}%`,
        }"
      >
        <div
          v-for="(branch, j) in step.branches"
          :key="j"
          :data-direction="branch.direction"
        >
          <svg
            class="branch-arrow"
            viewBox="0 0 30 20"
            aria-hidden="true"
            :class="{ outgoing: branch.direction === 'out' }"
          >
            <path d="M 2 18 L 27 2 M 17 2 L 27 2 L 27 12" />
          </svg>
          <svg
            class="mechanism-ink"
            :viewBox="`${branches[i][j].box.x} ${branches[i][j].box.y} ${branches[i][j].box.width} ${branches[i][j].box.height}`"
            :width="branches[i][j].box.width"
            :height="branches[i][j].box.height"
            role="img"
            :aria-label="branches[i][j].frame.molecules[0].name"
            v-html="branches[i][j].markup"
          />
        </div>
      </div>
    </template>
  </div>
</template>
<style scoped>
.catalytic-cycle {
  position: relative;
  aspect-ratio: 1;
  width: 100%;
  max-width: var(--mechanism-cycle-width);
  margin: auto;
}
.cycle-arcs {
  width: 100%;
  height: 100%;
  overflow: visible;
}
.cycle-arc {
  fill: none;
  stroke: var(--rule-strong);
  stroke-width: var(--mechanism-line);
}
.current .cycle-arc {
  stroke: var(--accent);
}
.cycle-arcs marker path {
  fill: none;
  stroke: var(--accent);
  stroke-width: var(--mechanism-line);
}
.arc-target {
  fill: none;
  stroke: transparent;
  stroke-width: 20;
  cursor: pointer;
}
.arc-target:focus-visible {
  stroke: var(--accent-soft);
  outline: none;
}
.cycle-arcs text {
  font: 500 12px var(--font-sans);
  fill: var(--ink);
  pointer-events: none;
}
.cycle-intermediate {
  position: absolute;
  transform: translate(-50%, -50%);
  width: 32%;
  max-height: 32%;
  padding: var(--space-1);
  background: var(--surface);
  border: 1px solid transparent;
}
.cycle-intermediate.current {
  border-color: var(--accent);
  border-radius: var(--radius-sm);
}
.mechanism-ink {
  display: block;
  width: 100%;
  height: auto;
}
.cycle-branches {
  position: absolute;
  transform: translate(-50%, -50%);
  width: 26%;
  font: var(--text-xs) var(--font-sans);
}
.cycle-branches :deep(figcaption) {
  display: none;
}
.cycle-branches :deep(svg) {
  max-height: 4rem;
}
</style>

<style scoped>
.branch-arrow {
  display: block;
  width: var(--space-6);
  height: var(--space-5);
  overflow: visible;
}
.branch-arrow path {
  fill: none;
  stroke: var(--accent);
  stroke-width: var(--mechanism-line);
}
.branch-arrow:not(.outgoing) {
  transform: rotate(180deg);
}
</style>
