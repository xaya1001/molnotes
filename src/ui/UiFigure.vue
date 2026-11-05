<script setup lang="ts">
import { ref } from "vue";
import { useLibraryImage } from "./library/client.ts";
import type { FigureReference } from "../../shared/chemical-library/types.ts";
import ImageViewer from "./ImageViewer.vue";

const props = defineProps<{
  src: string | FigureReference;
  alt: string;
  caption: string;
}>();
const { image, error } = useLibraryImage(() => props.src);
const viewing = ref(false);
</script>

<template>
  <figure class="ui-figure">
    <button
      class="ui-figure-open"
      type="button"
      :aria-label="`放大查看：${caption}`"
      @click="viewing = true"
    >
      <img v-if="image.src" :src="image.src" :alt="alt" loading="lazy" />
    </button>
    <p v-if="error" role="alert">{{ error }}</p>
    <figcaption>{{ caption }}</figcaption>
    <ImageViewer
      v-model:open="viewing"
      :src="image.src"
      :alt="alt"
      :title="caption"
    />
  </figure>
</template>

<style scoped>
.ui-figure-open {
  display: block;
  width: 100%;
  padding: var(--space-4);
  border: 1px solid var(--rule);
  border-radius: var(--radius);
  background: #fff;
  cursor: zoom-in;
}

.ui-figure-open:hover {
  border-color: var(--rule-strong);
}

img {
  margin-inline: auto;
}
</style>
