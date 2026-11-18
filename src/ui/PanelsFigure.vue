<script setup lang="ts">
import ProseCaption from "./ProseCaption.vue";
import { computed, onMounted, ref } from "vue";
import {
  type Panels,
  panelReference,
  panelGroups,
} from "../../shared/panels.ts";
import type { LibrarySnapshot } from "../../shared/chemical-library/types.ts";
import { figureViewKey } from "../../shared/chemical-library/views.ts";
import { loadLibrary } from "./library/client.ts";
import LibraryFigure from "./library/LibraryFigure.vue";
import FlowFigure from "./diagrams/FlowFigure.vue";
import { defineFlow } from "./diagrams/flow.ts";
import StepDescriptions from "./StepDescriptions.vue";
import { useFigureWidths } from "./figure-width.ts";
import { useFigureGrid } from "./figure-grid.ts";
import { moleculeBondLength } from "./chemistry/drawing.ts";

const props = defineProps<{ panels: Panels; library?: LibrarySnapshot }>();
const root = ref<HTMLElement>();
const widths = useFigureWidths(root);
const loaded = ref<LibrarySnapshot>();
const error = ref("");
const library = computed(() => props.library ?? loaded.value);
const compare = computed(() => props.panels.mode === "compare");
onMounted(async () => {
  if (!props.library && props.panels.items.some((item) => item.ref))
    try {
      loaded.value = await loadLibrary();
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e);
    }
});
const groups = computed(() =>
  panelGroups(props.panels).map((group) => {
    const item = group.item;
    const render = item.ref
      ? library.value?.renders?.[figureViewKey(item)]
      : undefined;
    const chemical = !!render;
    return {
      ...group,
      reference: panelReference(item),
      chemical,
      natural: render ? render.width * (moleculeBondLength / 32) : 0,
      minimum: render ? render.width * render.minimumScale : 200,
    };
  }),
);
const grid = useFigureGrid(
  widths,
  () => groups.value.map((group) => group.natural),
  () =>
    groups.value.some((group) => group.chemical) ? 20 / moleculeBondLength : 0,
);
</script>

<template>
  <div ref="root" class="panels-figure">
    <div
      class="panels"
      :class="{ 'figure-card-grid': compare, 'panels--steps': !compare }"
      :style="compare ? grid.style : undefined"
    >
      <div
        v-for="(group, index) in groups"
        :key="index"
        class="panel"
        :class="{
          'panel--beside':
            !compare &&
            group.minimum <= widths.reading / 2 &&
            widths.reading > 390,
        }"
        :style="{
          '--panel-image-width': `${Math.min(Math.max(200, group.natural), widths.reading * 0.45)}px`,
        }"
      >
        <FlowFigure v-if="group.item.flow" :flow="defineFlow(group.item.flow)">
          <template v-if="compare" #caption>
            <StepDescriptions :items="[group.item]" />
          </template>
        </FlowFigure>
        <LibraryFigure
          v-else-if="library && group.reference"
          :library="library"
          contained
          :scale="
            compare && group.chemical
              ? (grid.scale * moleculeBondLength) / 32
              : undefined
          "
          :reference="group.reference"
        >
          <template v-if="compare" #caption>
            <StepDescriptions :items="[group.item]" />
          </template>
        </LibraryFigure>
        <StepDescriptions
          v-if="!compare"
          numbered
          :items="
            group.indices.map((i) => ({ ...panels.items[i], number: i + 1 }))
          "
        />
      </div>
    </div>
    <p v-if="error" role="alert">{{ error }}</p>
    <p v-if="panels.caption" class="figure-card-grid-caption">
      <ProseCaption :text="panels.caption" />
    </p>
  </div>
</template>
<style scoped>
.panels-figure {
  margin: var(--space-5) 0;
  min-width: 0;
  font-family: var(--font-sans);
  font-size: var(--text-sm);
}
.panel {
  min-width: 0;
}
.panel :deep(.figure-card) {
  margin: 0;
}
.panels--steps {
  display: grid;
  gap: var(--space-5);
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
.figure-card-grid > .panel {
  display: contents;
}
.figure-card-grid :deep(.library-host),
.figure-card-grid :deep(.library-host > .figure-card),
.figure-card-grid :deep(.panel > .figure-card) {
  display: grid;
  grid-row: span 2;
  grid-template-rows: subgrid;
  row-gap: 0;
}
.figure-card-grid :deep(.figure-card-art) {
  display: grid;
  align-content: end;
}
.figure-card-grid :deep(.step-descriptions) {
  margin-top: 0;
}
</style>
