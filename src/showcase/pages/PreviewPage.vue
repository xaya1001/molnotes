<script setup lang="ts">
import { nextTick, onMounted, ref } from "vue";
import MoleculeView from "../../ui/MoleculeView.vue";
import FlowFigure from "../../ui/diagrams/FlowFigure.vue";
import TimelineFigure from "../../ui/diagrams/TimelineFigure.vue";
import { figureWarnings } from "../../ui/diagrams/check.ts";
import { defineFlow, type Flow } from "../../ui/diagrams/flow.ts";
import { defineTimeline, type Timeline } from "../../ui/diagrams/model.ts";

// The content preview command injects the figures of one unit and reads the
// warnings back; the page is not linked from the showcase.
interface Injected {
  where: string;
  kind: "timeline" | "flow" | "molecule";
  value: unknown;
  caption: string;
}
type Shown =
  | { where: string; kind: "timeline"; timeline: Timeline; caption: string }
  | { where: string; kind: "flow"; flow: Flow; caption: string }
  | {
      where: string;
      kind: "molecule";
      molecules: { smiles: string; caption: string }[];
      caption: string;
    };
declare global {
  interface Window {
    __previewFigures?: Injected[];
    __previewResult?: { where: string; warnings: string[] }[];
  }
}

const shown: Shown[] = (window.__previewFigures ?? []).map((f) =>
  f.kind === "timeline"
    ? { ...f, kind: "timeline", timeline: defineTimeline(f.value) }
    : f.kind === "flow"
      ? { ...f, kind: "flow", flow: defineFlow(f.value) }
      : {
          ...f,
          kind: "molecule",
          molecules: f.value as { smiles: string; caption: string }[],
        },
);
const figures = ref<HTMLElement[]>([]);

const settle = () =>
  new Promise((done) =>
    requestAnimationFrame(() => requestAnimationFrame(done)),
  );
onMounted(async () => {
  await nextTick();
  // Structures draw once RDKit has loaded; timelines measure their labels first.
  const deadline = Date.now() + 30_000;
  while (
    Date.now() < deadline &&
    document.querySelector(".molecule [role='status']")
  )
    await new Promise((done) => setTimeout(done, 100));
  for (let i = 0; i < 3; i++) await settle();
  window.__previewResult = shown.map((figure, i) => {
    const root = figures.value[i]?.querySelector<HTMLElement>(
      "figure.timeline, figure.flow, figure.molecule",
    );
    return {
      where: figure.where,
      warnings: root
        ? [
            ...figureWarnings(root),
            ...[
              ...figures.value[i].querySelectorAll<HTMLElement>(
                "figure.molecule",
              ),
            ]
              .slice(1)
              .flatMap(figureWarnings),
          ]
        : ["没有渲染出图"],
    };
  });
});
</script>

<template>
  <article class="page-reading">
    <div class="prose">
      <section
        v-for="(figure, i) in shown"
        :key="i"
        ref="figures"
        :data-preview="i"
        class="preview-figure"
      >
        <TimelineFigure
          v-if="figure.kind === 'timeline'"
          :timeline="figure.timeline"
          :caption="figure.caption"
        />
        <FlowFigure
          v-else-if="figure.kind === 'flow'"
          :flow="figure.flow"
          :caption="figure.caption"
        />
        <div v-else class="preview-molecules">
          <MoleculeView
            v-for="(m, j) in figure.molecules"
            :key="j"
            :smiles="m.smiles"
            :name="m.caption"
          />
        </div>
      </section>
    </div>
  </article>
</template>

<style scoped>
.preview-figure {
  padding: var(--space-4) 0;
}
.preview-molecules {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-4);
}
.preview-molecules > :deep(figure) {
  flex: 1 1 14rem;
  min-width: 0;
}
</style>
