<script setup lang="ts">
import { ref, watch } from "vue";
import UiDialog from "../UiDialog.vue";
import type { FigureReference } from "../../../shared/chemical-library/types.ts";
import LibraryReference from "../library/LibraryReference.vue";
import { loadLibrary } from "../library/client.ts";
import { snapshotSvg } from "../library/snapshot-svg.ts";
const props = defineProps<{ reference: FigureReference }>();
const viewing = ref(false);
const canvas = ref<HTMLElement>();
const error = ref("");
watch(
  [canvas, () => props.reference],
  async (_, __, cleanup) => {
    let active = true;
    cleanup(() => {
      active = false;
    });
    if (!canvas.value) return;
    try {
      const library = await loadLibrary();
      const drawing = await snapshotSvg(library, props.reference);
      if (!active) return;
      canvas.value.replaceChildren(drawing.svg);
      // Table previews retain the published geometry and readable scale, cropping its outer whitespace.
      const box = drawing.svg.getBBox();
      const padding = parseFloat(
        getComputedStyle(canvas.value).getPropertyValue("--chemical-line"),
      );
      const width = box.width + 2 * padding;
      const height = box.height + 2 * padding;
      const scale = Math.max(
        drawing.minimumScale,
        Math.min(0.75, canvas.value.clientWidth / width),
      );
      drawing.svg.setAttribute(
        "viewBox",
        `${box.x - padding} ${box.y - padding} ${width} ${height}`,
      );
      drawing.svg.style.width = `${width * scale}px`;
      drawing.svg.style.height = `${height * scale}px`;
      canvas.value.parentElement!.style.width = `${Math.max(canvas.value.clientWidth, width * scale)}px`;
      error.value = "";
    } catch (e) {
      if (active) error.value = e instanceof Error ? e.message : String(e);
    }
  },
  { flush: "post" },
);
</script>
<template>
  <div class="table-structure">
    <div ref="canvas" class="structure-canvas" />
    <button
      type="button"
      class="structure-open"
      aria-label="放大结构"
      @click="viewing = true"
    />
    <p v-if="error" role="alert">{{ error }}</p>
  </div>
  <UiDialog v-model:open="viewing" title="化合物结构">
    <LibraryReference :reference="reference" />
  </UiDialog>
</template>
<style scoped>
.table-structure {
  position: relative;
  width: 14rem;
}
.structure-canvas {
  padding: var(--space-2) 0;
}
.structure-canvas :deep(svg) {
  display: block;
  margin: auto;
}
.structure-open {
  position: absolute;
  inset: 0;
  width: 100%;
  border: 0;
  background: transparent;
  cursor: zoom-in;
}
</style>
