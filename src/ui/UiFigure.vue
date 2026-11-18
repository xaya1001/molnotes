<script setup lang="ts">
import FigureCard from "./FigureCard.vue";
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
  <FigureCard class="ui-figure" :caption="caption">
    <button
      class="figure-image-open"
      type="button"
      :aria-label="`放大查看：${caption || alt}`"
      @click="viewing = true"
    >
      <img v-if="image.src" :src="image.src" :alt="alt" loading="lazy" />
    </button>
    <p v-if="error" role="alert">{{ error }}</p>
    <ImageViewer
      v-model:open="viewing"
      :src="image.src"
      :alt="alt"
      :title="caption || alt"
    />
    <template v-if="$slots.caption" #caption><slot name="caption" /></template>
  </FigureCard>
</template>
