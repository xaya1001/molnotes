<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, ref } from "vue";
import {
  type Panels,
  type PanelItem,
  panelReference,
  panelColumns,
  panelGroups,
} from "../../shared/panels.ts";
import type { LibrarySnapshot } from "../../shared/chemical-library/types.ts";
import { figureViewKey } from "../../shared/chemical-library/views.ts";
import { loadLibrary } from "./library/client.ts";
import LibraryFigure from "./library/LibraryFigure.vue";
import FlowFigure from "./diagrams/FlowFigure.vue";
import { defineFlow } from "./diagrams/flow.ts";
import StepDescriptions from "./StepDescriptions.vue";
const props = defineProps<{ panels: Panels; library?: LibrarySnapshot }>();
const root = ref<HTMLElement>();
const width = ref(0);
const em = ref(14);
const loaded = ref<LibrarySnapshot>();
const error = ref("");
const library = computed(() => props.library ?? loaded.value);
let observer: ResizeObserver | undefined;
let measureFrame = 0;
onMounted(async () => {
  em.value = parseFloat(getComputedStyle(root.value!).fontSize);
  observer = new ResizeObserver(([entry]) => {
    cancelAnimationFrame(measureFrame);
    measureFrame = requestAnimationFrame(() => {
      width.value = entry.contentRect.width;
    });
  });
  observer.observe(root.value!);
  if (!props.library && props.panels.items.some((item) => item.ref))
    try {
      loaded.value = await loadLibrary();
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e);
    }
});
onBeforeUnmount(() => {
  observer?.disconnect();
  cancelAnimationFrame(measureFrame);
});
const groups = computed(() =>
  panelGroups(props.panels).map((group) => {
    const item = group.item;
    const entry = item.ref ? library.value?.entries[item.ref] : undefined;
    const render = item.ref
      ? library.value?.renders?.[figureViewKey(item)]
      : undefined;
    const natural =
      entry?.kind === "image"
        ? (entry.crop?.width ?? entry.width)
        : (render?.width ?? 34 * em.value);
    const minimum =
      entry?.kind === "image"
        ? entry.mime === "image/svg+xml"
          ? natural * 0.75
          : Math.min(natural * 0.75, 280)
        : render
          ? render.width * render.minimumScale
          : 34 * em.value;
    return { ...group, natural, minimum };
  }),
);
function panelImageReference(item: PanelItem) {
  const reference = panelReference(item)!;
  const entry = library.value?.entries[reference.ref];
  return entry?.kind === "image" && !entry.crop
    ? { ...reference, presentation: "figure" as const }
    : reference;
}
const columns = computed(() =>
  props.panels.mode === "compare"
    ? panelColumns(
        groups.value.length,
        width.value,
        Math.max(...groups.value.map((g) => g.minimum)),
      )
    : 1,
);
</script>
<template>
  <figure ref="root" class="panels-figure" :aria-label="panels.caption">
    <div
      class="panels"
      :class="`panels--${panels.mode}`"
      :style="{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }"
    >
      <div
        v-for="(group, index) in groups"
        :key="index"
        class="panel"
        :class="{
          'panel--beside':
            panels.mode === 'steps' &&
            group.minimum <= width / 2 &&
            width > 390,
        }"
        :style="{
          '--panel-image-width': `${Math.min(group.natural, width * 0.45)}px`,
        }"
      >
        <FlowFigure
          v-if="group.item.flow"
          :flow="defineFlow(group.item.flow)"
        />
        <LibraryFigure
          v-else-if="library && group.item.ref"
          :library="library"
          contained
          :reference="panelImageReference(group.item)"
        />
        <StepDescriptions
          :numbered="panels.mode === 'steps'"
          :items="
            group.indices.map((i) => ({ ...panels.items[i], number: i + 1 }))
          "
        />
      </div>
    </div>
    <p v-if="error" role="alert">{{ error }}</p>
    <figcaption v-if="panels.caption">{{ panels.caption }}</figcaption>
  </figure>
</template>
<style scoped>
.panels-figure {
  margin: var(--space-5) 0;
  max-width: 100%;
  font-family: var(--font-sans);
  font-size: var(--text-sm);
}
.panels {
  display: grid;
  gap: var(--space-5) var(--space-4);
}
.panel {
  min-width: 0;
}
.panel :deep(.library-figure),
.panel :deep(.ui-figure) {
  margin: 0;
}
.panel--beside {
  display: grid;
  grid-template-columns: var(--panel-image-width) minmax(0, 1fr);
  gap: var(--space-4);
  align-items: start;
}
.panel--beside :deep(.step-descriptions) {
  margin-top: 0;
}
.panels--steps .panel + .panel {
  border-top: 1px solid var(--rule);
  padding-top: var(--space-5);
}
figcaption {
  margin-top: var(--space-3);
  font-size: var(--text-sm);
  line-height: 1.6;
  color: var(--ink-muted);
}
</style>
