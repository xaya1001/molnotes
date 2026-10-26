<script setup lang="ts">
/**
 * A picture with marked points the reader can pick. `picked` is the chosen
 * point id; `answer` ids are highlighted when the result shows.
 */
defineProps<{
  image: { src: string; alt: string };
  points: { id: string; label: string; x: number; y: number }[];
  picked?: string;
  answer?: string[];
  disabled?: boolean;
}>();
const emit = defineEmits<{ pick: [id: string] }>();
</script>

<template>
  <figure class="figure image-points">
    <div class="frame">
      <img :src="image.src" :alt="image.alt" />
      <button
        v-for="point in points"
        :key="point.id"
        class="point"
        :class="{
          picked: point.id === picked,
          right: answer?.includes(point.id),
        }"
        type="button"
        :style="{ left: `${point.x}%`, top: `${point.y}%` }"
        :aria-pressed="point.id === picked"
        :aria-label="point.label"
        :disabled="disabled"
        @click="emit('pick', point.id)"
      >
        {{ point.label }}
      </button>
    </div>
  </figure>
</template>

<style scoped>
/* The picture fills the width so an SVG with only a viewBox still has a size. */
.frame {
  position: relative;
  display: block;
  width: 100%;
}
img {
  display: block;
  width: 100%;
  height: auto;
}
.point {
  position: absolute;
  transform: translate(-50%, -50%);
  padding: 0.1rem 0.5rem;
  border: 2px solid var(--accent);
  border-radius: 999px;
  background: var(--paper, white);
  font: inherit;
  font-family: var(--font-sans);
  font-size: 0.85rem;
  cursor: pointer;
}
.point.picked {
  background: var(--accent);
  color: white;
}
.point.right {
  border-color: var(--success, green);
  box-shadow: 0 0 0 3px var(--success, green);
}
.point:disabled {
  cursor: default;
}
</style>
