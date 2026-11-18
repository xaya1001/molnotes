<script setup lang="ts">
import { computed, nextTick, shallowRef, ref, watch } from "vue";
import type {
  Diagnostic,
  FigureReference,
  LibrarySnapshot,
} from "../../../shared/chemical-library/types.ts";
import FigureCard from "../FigureCard.vue";
import UiFigure from "../UiFigure.vue";
import ImageViewer from "../ImageViewer.vue";
import StepDescriptions from "../StepDescriptions.vue";
import { figureDescriptions } from "./descriptions.ts";
import { snapshotSvg } from "./snapshot-svg.ts";
import { imageSvg } from "./image-svg.ts";
import { moleculeBondLength } from "../chemistry/drawing.ts";
import { useFigureWidths } from "../figure-width.ts";

const props = defineProps<{
  library: LibrarySnapshot;
  reference: FigureReference;
  contained?: boolean;
  scale?: number;
}>();
const emit = defineEmits<{ diagnostics: [value: Diagnostic[]] }>();
const entry = computed(() => props.library.entries[props.reference.ref]);
const viewing = ref(false);
const descriptions = computed(() =>
  entry.value
    ? figureDescriptions(
        props.library.entries,
        entry.value,
        props.reference.frame,
      )
    : [],
);
const host = ref<HTMLElement>();
const root = ref<HTMLElement>();
const error = ref("");
const widths = useFigureWidths(host);
const drawing = shallowRef<{
  svg: SVGSVGElement;
  width: number;
  height: number;
  minimumScale: number;
  diagnostics: Diagnostic[];
  original: Element[];
  plans: {
    width: number;
    height: number;
    natural: number;
    scale: number;
    rows: number;
    oversizedFrame: boolean;
    group: Element;
  }[];
}>();
const inlineImage = computed(
  () => entry.value?.kind === "image" && !entry.value.crop,
);
watch(
  [root, () => props.library, () => JSON.stringify(props.reference)],
  async (_, __, cleanup) => {
    let active = true;
    cleanup(() => {
      active = false;
    });
    if (!root.value) return;
    try {
      const result =
        entry.value?.kind === "image"
          ? { ...(await imageSvg(entry.value)), diagnostics: [] }
          : await snapshotSvg(props.library, props.reference);
      if (!active) return;
      const list = result.svg.querySelector("defs[data-card-plans]");
      const plans = [...(list?.children ?? [])].map((group) => ({
        width: Number(group.getAttribute("data-card-width")),
        height: Number(group.getAttribute("data-height")),
        natural: Number(group.getAttribute("data-width")),
        scale: Number(group.getAttribute("data-scale")),
        rows: Number(group.getAttribute("data-rows")),
        oversizedFrame: group.getAttribute("data-oversized-frame") === "yes",
        group,
      }));
      list?.remove();
      drawing.value = { ...result, plans, original: [...result.svg.children] };
      root.value.replaceChildren(result.svg);
      error.value = "";
      emit("diagnostics", result.diagnostics);
    } catch (reason) {
      if (active)
        error.value = reason instanceof Error ? reason.message : String(reason);
    }
  },
  { flush: "post" },
);
const choice = computed(() => {
  const result = drawing.value;
  const { reading, wide, desktop } = widths.value;
  if (!result || !result.plans.length) return;
  const pad = desktop ? 34 : 26;
  const phone = result.plans.at(-1)!;
  if (!desktop) return { plan: phone, wide: undefined };
  function fitting(width: number) {
    return (
      result!.plans
        .filter((plan) => plan.natural * plan.scale <= width - pad + 1)
        .sort(
          (a, b) => a.rows - b.rows || b.scale - a.scale || a.width - b.width,
        )[0] ?? phone
    );
  }
  const normal = fitting(reading);
  const expanded = props.contained ? normal : fitting(wide);
  return expanded.rows < normal.rows
    ? { plan: expanded, wide }
    : { plan: normal, wide: undefined };
});

watch(
  [root, drawing, widths, choice, () => props.scale],
  async () => {
    await nextTick();
    const result = drawing.value;
    if (!result || !root.value) return;
    const plan = choice.value?.plan;
    const width = plan?.natural ?? result.width;
    const height = plan?.height ?? result.height;
    const naturalScale =
      entry.value?.kind === "compound"
        ? moleculeBondLength / (entry.value.style?.bond ?? 32)
        : 1;
    const scale =
      plan?.scale ??
      props.scale ??
      Math.max(
        result.minimumScale,
        Math.min(naturalScale, root.value.clientWidth / width),
      );
    result.svg.replaceChildren(...(plan ? [plan.group] : result.original));
    result.svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    result.svg.style.width = `${width * scale}px`;
    result.svg.style.height = `${height * scale}px`;
  },
  { flush: "post" },
);
</script>

<template>
  <div ref="host" class="library-host">
    <UiFigure
      v-if="inlineImage && entry?.kind === 'image'"
      :src="`/library/assets/${entry.asset}`"
      :alt="reference.alt ?? entry.alt"
      :caption="reference.caption ?? ''"
    >
      <template v-if="$slots.caption" #caption
        ><slot name="caption"
      /></template>
    </UiFigure>
    <FigureCard
      v-else
      class="library-figure"
      :wide="choice?.wide"
      :caption="reference.caption"
      :data-frame-overflow="choice?.plan.oversizedFrame ? '' : undefined"
    >
      <button
        v-if="entry?.kind === 'image'"
        type="button"
        class="figure-image-open library-image"
        :aria-label="`放大查看：${reference.caption ?? entry.alt}`"
        @click="viewing = true"
      >
        <span ref="root" class="library-artwork" />
      </button>
      <div
        v-else
        class="library-canvas"
        tabindex="0"
        role="group"
        :aria-label="entry?.title"
      >
        <div ref="root" class="library-artwork" />
      </div>
      <p v-if="entry?.overview">{{ entry.overview }}</p>
      <StepDescriptions
        v-if="descriptions.length"
        :items="descriptions"
        :columns="true"
      />
      <ImageViewer
        v-if="entry?.kind === 'image'"
        v-model:open="viewing"
        :src="`/library/assets/${entry.asset}`"
        :alt="reference.alt ?? entry.alt"
        :title="reference.caption ?? entry.title"
      />
      <p v-if="error" role="alert">{{ error }}</p>
      <template v-if="$slots.caption" #caption
        ><slot name="caption"
      /></template>
    </FigureCard>
  </div>
</template>

<style scoped>
.library-host {
  display: flow-root;
  min-width: 0;
}
.library-canvas {
  overflow-x: auto;
  max-width: 100%;
}
.library-canvas :deep(svg) {
  display: block;
  margin-inline: auto;
  max-width: none;
}
.library-image :deep(svg) {
  display: block;
  max-width: 100%;
  max-height: var(--figure-card-image-height);
  width: auto !important;
  height: auto !important;
}
</style>
