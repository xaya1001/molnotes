<script setup lang="ts">
import type { ReactionStep } from "../../shared/reaction-scheme.ts";
defineProps<{
  step: ReactionStep;
  retro?: boolean;
  equilibrium?: boolean;
  selected: boolean;
  controls: string;
}>();
defineEmits<{ select: [] }>();
</script>
<template>
  <button
    class="scheme-arrow"
    :class="{ selected }"
    :aria-label="step.title"
    :aria-pressed="selected"
    :aria-controls="controls"
    @click="$emit('select')"
  >
    <span class="reagents"
      ><span v-for="(line, i) in step.reagents" :key="i">{{ line }}</span></span
    >
    <svg
      class="arrow-line"
      :data-arrow-kind="
        equilibrium ? 'equilibrium' : retro ? 'retro' : 'forward'
      "
      :class="{ retro }"
      aria-hidden="true"
      width="1"
      height="18"
    >
      <template v-if="equilibrium">
        <line x1="0" y1="6" x2="100%" y2="6" />
        <svg x="100%" overflow="visible"><path d="M -8 2 L 0 6" /></svg>
        <line x1="0" y1="12" x2="100%" y2="12" />
        <path d="M 8 16 L 0 12" />
      </template>
      <template v-else-if="retro">
        <line x1="0" y1="6" x2="100%" y2="6" />
        <line x1="0" y1="12" x2="100%" y2="12" />
        <svg x="100%" overflow="visible">
          <path d="M -10 2 L 0 9 L -10 16 M -10 2 L -10 6 M -10 12 L -10 16" />
        </svg>
      </template>
      <template v-else>
        <line x1="0" y1="9" x2="100%" y2="9" />
        <svg x="100%" overflow="visible">
          <path class="solid-head" d="M -9 5 L 0 9 L -9 13 Z" />
        </svg>
      </template>
    </svg>
    <span class="conditions"
      ><span v-for="(line, i) in step.conditions" :key="i">{{ line }}</span
      ><span v-if="step.yield" class="yield">{{ step.yield }}</span></span
    >
  </button>
</template>
<style scoped>
.scheme-arrow {
  display: grid;
  grid-template-rows: 1fr auto 1fr;
  align-items: center;
  justify-items: stretch;
  gap: var(--space-1);
  width: max-content;
  min-width: var(--scheme-arrow-min);
  max-width: var(--scheme-arrow-max);
  padding: var(--space-2);
  margin-bottom: var(--scheme-caption-height);
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--ink);
  font: var(--text-sm)/var(--leading-tight) var(--font-sans);
  font-weight: 500;
  cursor: pointer;
}
.scheme-arrow.selected {
  background: var(--accent-soft);
}
.scheme-arrow:focus-visible {
  outline: var(--focus-ring);
}
.reagents {
  align-self: end;
}
.conditions {
  align-self: start;
}
.reagents span,
.conditions span {
  display: block;
  white-space: pre-line;
  overflow-wrap: anywhere;
}
.arrow-line {
  width: 100%;
  max-width: none;
  overflow: visible;
  fill: none;
  stroke: currentColor;
  stroke-width: var(--scheme-line);
}
.solid-head {
  fill: currentColor;
  stroke: none;
}
.retro line {
  transform: scaleX(0.94);
}
@media (max-width: 640px) {
  .scheme-arrow {
    grid-template-columns: minmax(0, 1fr) var(--space-5) minmax(0, 1fr);
    grid-template-rows: auto;
    width: 100%;
    min-width: 0;
    max-width: none;
    margin: 0;
    gap: var(--space-3);
    min-height: var(--scheme-arrow-min);
  }
  .reagents {
    align-self: center;
    text-align: right;
  }
  .conditions {
    align-self: center;
    text-align: left;
  }
  .arrow-line {
    width: var(--scheme-arrow-min);
    height: 18px;
    transform: translateX(calc((var(--space-5) - var(--scheme-arrow-min)) / 2))
      rotate(90deg);
  }
}
</style>
