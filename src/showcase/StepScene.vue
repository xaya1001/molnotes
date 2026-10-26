<script setup lang="ts">
import { motion } from "motion-v";

const step = defineModel<number>({ required: true });
const captions = ["初始状态", "对象 A 接近对象 B", "对象 A 与对象 B 相邻"];

function next() {
  step.value = Math.min(step.value + 1, captions.length - 1);
}
function previous() {
  step.value = Math.max(step.value - 1, 0);
}
</script>

<template>
  <div class="scene">
    <svg viewBox="0 0 600 240" role="img" :aria-label="captions[step]">
      <rect
        x="0.5"
        y="0.5"
        width="599"
        height="239"
        rx="6"
        fill="#fffdf9"
        stroke="#e4ded2"
      />
      <motion.g
        :animate="{ x: step === 0 ? 0 : step === 1 ? 125 : 205 }"
        :transition="{ duration: 0.7 }"
      >
        <circle cx="110" cy="120" r="46" fill="#1d4d80" />
        <text x="110" y="127" text-anchor="middle" fill="white" font-size="20">
          A
        </text>
      </motion.g>
      <circle cx="405" cy="120" r="46" fill="#8a5412" />
      <text x="405" y="127" text-anchor="middle" fill="white" font-size="20">
        B
      </text>
    </svg>
    <p class="scene-caption" aria-live="polite">{{ captions[step] }}</p>
    <div class="scene-controls">
      <button
        class="button"
        type="button"
        :disabled="step === 0"
        @click="previous"
      >
        上一步
      </button>
      <span class="num">步骤 {{ step + 1 }} / {{ captions.length }}</span>
      <button
        class="button button--primary"
        type="button"
        :disabled="step === captions.length - 1"
        @click="next"
      >
        下一步
      </button>
    </div>
  </div>
</template>

<style scoped>
svg {
  width: 100%;
  height: auto;
}

.scene-caption {
  margin: var(--space-3) 0;
  text-align: center;
}

.scene-controls {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  font: var(--text-sm) / 1.5 var(--font-sans);
}
</style>
