<script setup lang="ts">
import { ref } from "vue";
import type { SceneFrame } from "./blocks.ts";

/** A step-by-step picture: one frame at a time, each with its drawing, title and text. */
defineProps<{ label: string; title?: string; frames: SceneFrame[] }>();
const index = ref(0);
</script>

<template>
  <section :aria-label="label">
    <h3 v-if="title">{{ title }}</h3>
    <figure v-if="frames[index].image" class="figure">
      <img
        :src="frames[index].image!.src"
        :alt="frames[index].image!.alt"
        loading="lazy"
      />
    </figure>
    <div aria-live="polite">
      <h4>{{ index + 1 }} · {{ frames[index].title }}</h4>
      <p>{{ frames[index].text }}</p>
    </div>
    <div class="controls">
      <button class="button" :disabled="index === 0" @click="index--">
        上一帧</button
      ><span>{{ index + 1 }} / {{ frames.length }}</span
      ><button
        class="button"
        :disabled="index === frames.length - 1"
        @click="index++"
      >
        下一帧
      </button>
    </div>
  </section>
</template>

<style scoped>
img {
  display: block;
  max-width: 100%;
  margin-inline: auto;
}
.controls {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  font-family: var(--font-sans);
}
</style>
