<script setup lang="ts">
import { ref } from "vue";
import ImageViewer from "./ImageViewer.vue";

defineProps<{ src: string; alt: string; caption: string }>();
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
      <img :src="src" :alt="alt" loading="lazy" />
    </button>
    <figcaption>{{ caption }}</figcaption>
    <ImageViewer
      v-model:open="viewing"
      :src="src"
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
