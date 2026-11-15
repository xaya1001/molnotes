<script setup lang="ts">
import { computed, ref, watch, onBeforeUnmount } from "vue";
import type {
  FigureReference,
  LibrarySnapshot,
} from "../../../shared/chemical-library/types.ts";
import UiFigure from "../UiFigure.vue";
import ImageViewer from "../ImageViewer.vue";
import StepDescriptions from "../StepDescriptions.vue";
import { figureDescriptions } from "./descriptions.ts";
import { snapshotSvg } from "./snapshot-svg.ts";
import { imageSvg } from "./image-svg.ts";
const props = defineProps<{
  library: LibrarySnapshot;
  reference: FigureReference;
  contained?: boolean;
}>();
const emit = defineEmits<{
  diagnostics: [
    value: import("../../../shared/chemical-library/types.ts").Diagnostic[],
  ];
}>();
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
const markers = ref<{ x: number; y: number; number: number }[]>([]);
const host = ref<HTMLElement>();
const root = ref<HTMLElement>();
const canvas = ref<HTMLElement>();
const error = ref("");
let generation = 0;
let observer: ResizeObserver | undefined;
let resizeFrame = 0;
watch(
  [root, () => props.library, () => JSON.stringify(props.reference)],
  async () => {
    const current = ++generation;
    observer?.disconnect();
    cancelAnimationFrame(resizeFrame);
    if (!root.value) return;
    try {
      const result =
        entry.value?.kind === "image"
          ? { ...(await imageSvg(entry.value)), diagnostics: [] }
          : await snapshotSvg(props.library, props.reference);
      if (current !== generation) return;
      root.value.replaceChildren(result.svg);
      error.value = "";

      if (entry.value?.kind === "image") {
        result.svg.setAttribute("tabindex", "0");
        result.svg.setAttribute("role", "button");
        result.svg.setAttribute("aria-label", `放大查看：${entry.value.title}`);
        result.svg.addEventListener("click", () => {
          viewing.value = true;
        });
        result.svg.addEventListener("keydown", (event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            viewing.value = true;
          }
        });
      }
      observer?.disconnect();
      const boundary = host.value?.closest("main");
      const resize = () => {
        if (
          host.value &&
          boundary &&
          !props.contained &&
          (entry.value?.kind === "reaction" ||
            entry.value?.kind === "route" ||
            entry.value?.kind === "mechanism")
        ) {
          const parent = host.value.parentElement!;
          const padding = getComputedStyle(boundary);
          const parentPadding = getComputedStyle(parent);
          const parentWidth =
            parent.clientWidth -
            parseFloat(parentPadding.paddingLeft) -
            parseFloat(parentPadding.paddingRight);
          const maximum =
            boundary.clientWidth -
            parseFloat(padding.paddingLeft) -
            parseFloat(padding.paddingRight);
          const w = Math.max(parentWidth, Math.min(result.width, maximum));
          host.value.style.width = `${w}px`;
          host.value.style.maxWidth = "none";
          host.value.style.marginLeft = `${(parentWidth - w) / 2}px`;
        }
        const available = root.value!.clientWidth;
        const scale = Math.max(
          result.minimumScale,
          Math.min(1, available / result.width),
        );
        result.svg.style.width = `${result.width * scale}px`;
        result.svg.style.height = `${result.height * scale}px`;
        markers.value = [];
        if (entry.value?.kind === "route" && entry.value.steps.length > 1) {
          const origin = canvas.value!.getBoundingClientRect();
          const size =
            parseFloat(
              getComputedStyle(host.value!).getPropertyValue(
                "--figure-step-size",
              ),
            ) * parseFloat(getComputedStyle(document.documentElement).fontSize);
          markers.value = entry.value.steps.flatMap((step, index) => {
            const arrow = [
              ...result.svg.querySelectorAll<SVGGraphicsElement>(
                "[data-reaction-id]",
              ),
            ].find((node) => node.dataset.reactionId === step.reaction);
            const reaction = props.library.entries[step.reaction];
            if (!arrow || reaction?.kind !== "reaction") return [];
            const box = arrow.getBoundingClientRect();
            const direction = step.arrow ?? reaction.arrow;
            const vertical =
              Math.abs(direction.to.y - direction.from.y) >
              Math.abs(direction.to.x - direction.from.x);
            const x = vertical
              ? (box.left + box.right) / 2
              : direction.to.x > direction.from.x
                ? box.left
                : box.right;
            const y = vertical
              ? direction.to.y > direction.from.y
                ? box.top
                : box.bottom
              : (box.top + box.bottom) / 2;
            return [
              {
                x: x - origin.left + canvas.value!.scrollLeft - size / 2,
                y: y - origin.top - size / 2,
                number: index + 1,
              },
            ];
          });
        }
        emit("diagnostics", result.diagnostics);
      };
      observer = new ResizeObserver(() => {
        cancelAnimationFrame(resizeFrame);
        resizeFrame = requestAnimationFrame(resize);
      });
      observer.observe(root.value);
      if (boundary) observer.observe(boundary);
      resize();
    } catch (e) {
      if (current === generation)
        error.value = e instanceof Error ? e.message : String(e);
    }
  },
  { flush: "post" },
);
onBeforeUnmount(() => {
  generation++;
  observer?.disconnect();
  cancelAnimationFrame(resizeFrame);
});
</script>
<template>
  <template
    v-if="entry?.kind === 'image' && reference.presentation && !entry.crop"
  >
    <template v-if="reference.presentation === 'note'">
      <button
        type="button"
        class="note-image"
        :aria-label="`放大图片：${reference.caption ?? entry.alt}`"
        @click="viewing = true"
      >
        <img
          :src="`/library/assets/${entry.asset}`"
          :alt="reference.alt ?? entry.alt"
        />
      </button>
      <span v-if="reference.caption" class="note-caption">{{
        reference.caption
      }}</span>
      <ImageViewer
        v-model:open="viewing"
        :src="`/library/assets/${entry.asset}`"
        :alt="reference.alt ?? entry.alt"
        :title="reference.caption ?? entry.title"
      />
    </template>
    <UiFigure
      v-else
      :src="`/library/assets/${entry.asset}`"
      :alt="reference.alt ?? entry.alt"
      :caption="reference.caption ?? ''"
    />
  </template>
  <figure v-else ref="host" class="library-figure">
    <div
      ref="canvas"
      class="library-canvas"
      tabindex="0"
      role="group"
      :aria-label="library.entries[reference.ref]?.title"
    >
      <div ref="root" class="library-artwork" />
      <span
        v-for="marker in markers"
        :key="marker.number"
        class="route-step-number step-number"
        :style="{ left: `${marker.x}px`, top: `${marker.y}px` }"
        >{{ marker.number }}</span
      >
    </div>
    <p v-if="entry?.overview">{{ entry.overview }}</p>
    <StepDescriptions
      v-if="descriptions.length"
      :items="descriptions"
      :numbered="!reference.frame && descriptions.length > 1"
      :columns="true"
    />
    <ImageViewer
      v-if="entry?.kind === 'image'"
      v-model:open="viewing"
      :src="`/library/assets/${entry.asset}`"
      :alt="reference.alt ?? entry.alt"
      :title="entry.title"
    />
    <p v-if="error" role="alert">{{ error }}</p>
    <figcaption v-if="reference.caption">{{ reference.caption }}</figcaption>
  </figure>
</template>
<style scoped>
.library-figure {
  margin: var(--space-5) 0;
  max-width: 100%;
}
.library-canvas {
  position: relative;
  overflow-x: auto;
  max-width: 100%;
  padding: var(--space-2) 0;
}
.library-canvas :deep(svg) {
  display: block;
  margin: auto;
  max-width: none;
}
figcaption {
  color: var(--ink-muted);
  font-size: var(--text-sm);
  margin-top: var(--space-2);
}
.library-canvas :deep([role="button"]:focus-visible) {
  outline: 2px solid var(--chemical-focus);
}
.route-step-number {
  position: absolute;
  pointer-events: none;
}
</style>
