<script setup lang="ts">
import {
  computed,
  inject,
  ref,
  shallowRef,
  watch,
  watchEffect,
  type ComputedRef,
} from "vue";
import { tableStructureScales } from "./table-structure-scale.ts";
import UiDialog from "../UiDialog.vue";
import type { FigureReference } from "../../../shared/chemical-library/types.ts";
import LibraryReference from "../library/LibraryReference.vue";
import { loadLibrary } from "../library/client.ts";
import { snapshotSvg } from "../library/snapshot-svg.ts";
const props = defineProps<{ reference: FigureReference }>();
const viewing = ref(false);
const canvas = ref<HTMLElement>();
const error = ref("");
const tables = inject(tableStructureScales, undefined);
const dimensions = shallowRef<{
  width: number;
  height: number;
  minimumScale: number;
  available: number;
}>();
const artwork = shallowRef<SVGSVGElement>();
const sharedScale = shallowRef<ComputedRef<number>>();
const scale = computed(() => {
  if (sharedScale.value) return sharedScale.value.value;
  const drawing = dimensions.value;
  return drawing
    ? Math.max(
        drawing.minimumScale,
        Math.min(0.75, drawing.available / drawing.width),
      )
    : 0.75;
});
const size = computed(() =>
  dimensions.value
    ? { width: `${dimensions.value.width * scale.value}px` }
    : undefined,
);
watchEffect(() => {
  if (!artwork.value || !dimensions.value) return;
  artwork.value.style.width = `${dimensions.value.width * scale.value}px`;
  artwork.value.style.height = `${dimensions.value.height * scale.value}px`;
});
watch(
  [canvas, () => props.reference],
  async (_, __, cleanup) => {
    let active = true;
    let remove: (() => void) | undefined;
    cleanup(() => {
      active = false;
      remove?.();
    });
    if (!canvas.value) return;
    try {
      const library = await loadLibrary();
      const drawing = await snapshotSvg(library, props.reference);
      if (!active) return;
      canvas.value.replaceChildren(drawing.svg);
      // Measure against the preview column before applying the shared scale.
      const available = canvas.value.clientWidth;
      const box = drawing.svg.getBBox();
      const padding = parseFloat(
        getComputedStyle(canvas.value).getPropertyValue("--chemical-line"),
      );
      const width = box.width + 2 * padding;
      const height = box.height + 2 * padding;
      drawing.svg.setAttribute(
        "viewBox",
        `${box.x - padding} ${box.y - padding} ${width} ${height}`,
      );
      drawing.svg.setAttribute("width", String(width));
      drawing.svg.setAttribute("height", String(height));
      dimensions.value = {
        width,
        height,
        minimumScale: drawing.minimumScale,
        available,
      };
      artwork.value = drawing.svg;
      const table = canvas.value.closest("table");
      if (table && tables) {
        const registration = tables.register(table, {
          width,
          available,
          minimumScale: drawing.minimumScale,
        });
        sharedScale.value = registration.scale;
        remove = registration.remove;
      }
      error.value = "";
    } catch (e) {
      if (active) error.value = e instanceof Error ? e.message : String(e);
    }
  },
  { flush: "post" },
);
</script>
<template>
  <div class="table-structure" :style="size">
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
  margin-inline: auto;
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
