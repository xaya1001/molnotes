<script setup lang="ts">
import { ref } from "vue";

/** One original page image with an optional marked region and zoom; the default slot adds tools before the zoom. */
defineProps<{
  image: string;
  /** Page width and height in PDF points; `rect` uses the same units. */
  size: readonly number[];
  rect?: readonly number[] | null;
  alt: string;
}>();
const zoom = ref(100);
</script>
<template>
  <div class="page-viewer">
    <div class="page-tools">
      <slot />
      <button
        class="button button--quiet button--icon"
        type="button"
        aria-label="缩小原页"
        :disabled="zoom <= 50"
        @click="zoom -= 25"
      >
        −
      </button>
      <span>{{ zoom }}%</span>
      <button
        class="button button--quiet button--icon"
        type="button"
        aria-label="放大原页"
        :disabled="zoom >= 250"
        @click="zoom += 25"
      >
        ＋
      </button>
    </div>
    <div class="page-viewport">
      <div
        class="page-frame"
        :style="{ width: `calc(min(100%, 50rem) * ${zoom / 100})` }"
      >
        <img :src="image" :alt="alt" />
        <div
          v-if="rect"
          class="page-highlight"
          :style="{
            left: `${(rect[0] / size[0]) * 100}%`,
            top: `${(rect[1] / size[1]) * 100}%`,
            width: `${((rect[2] - rect[0]) / size[0]) * 100}%`,
            height: `${((rect[3] - rect[1]) / size[1]) * 100}%`,
          }"
        ></div>
      </div>
    </div>
  </div>
</template>
<style scoped>
.page-viewer {
  min-width: 0;
}
.page-tools {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: var(--space-2);
  margin-bottom: var(--space-2);
  font: 500 var(--text-sm) / 1 var(--font-sans);
  font-variant-numeric: tabular-nums;
}
.page-viewport {
  overflow: auto;
  background: var(--paper-deep);
}
.page-frame {
  position: relative;
  margin-inline: auto;
}
.page-frame img {
  display: block;
  width: 100%;
  max-width: none;
  background: #fff;
}
.page-highlight {
  position: absolute;
  border: var(--focus-ring);
  background: var(--page-highlight);
  pointer-events: none;
}
</style>
