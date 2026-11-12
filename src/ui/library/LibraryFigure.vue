<script setup lang="ts">
import { computed, ref, watch, onBeforeUnmount } from "vue";
import type {
  FigureReference,
  Library,
} from "../../../shared/chemical-library/types.ts";
import UiFigure from "../UiFigure.vue";
import ImageViewer from "../ImageViewer.vue";
import ProcessViewer from "../topic/ProcessViewer.vue";
import { figureDiagnostics } from "./diagnostics.ts";
import { renderFigure } from "./render.ts";
const props = defineProps<{
  library: Library;
  reference: FigureReference;
}>();
const emit = defineEmits<{
  diagnostics: [
    value: import("../../../shared/chemical-library/types.ts").Diagnostic[],
  ];
}>();
const entry = computed(() => props.library[props.reference.ref]);
const selectedFrame = ref("");
const viewing = ref(false);
const explanation = ref("");
const displayed = computed(() =>
  entry.value?.kind === "mechanism" && !props.reference.frame
    ? {
        ...props.reference,
        frame:
          entry.value.frames.find((f) => f.id === selectedFrame.value)?.id ??
          entry.value.frames[0].id,
      }
    : props.reference,
);
const frameExplanation = computed(() =>
  entry.value?.kind === "mechanism"
    ? entry.value.frames.find((frame) => frame.id === displayed.value.frame)
        ?.explanation
    : undefined,
);
const host = ref<HTMLElement>();
const root = ref<HTMLElement>();
const error = ref("");
let generation = 0;
let observer: ResizeObserver | undefined;
watch(
  [root, () => props.library, () => JSON.stringify(displayed.value)],
  async () => {
    const current = ++generation;
    observer?.disconnect();
    if (!root.value) return;
    try {
      const result = await renderFigure(props.library, displayed.value);
      if (current !== generation) return;
      root.value.replaceChildren(result.svg);
      error.value = "";
      explanation.value = "";
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
      for (const arrow of result.svg.querySelectorAll<SVGElement>(
        "[data-reaction-id]",
      )) {
        const show = () => {
          const reaction = props.library[arrow.dataset.reactionId!];
          if (reaction?.kind === "reaction")
            explanation.value = reaction.explanation;
        };
        arrow.addEventListener("click", show);
        arrow.addEventListener("keydown", (event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            show();
          }
        });
      }
      observer?.disconnect();
      const boundary = host.value?.closest("main");
      const resize = () => {
        if (
          host.value &&
          boundary &&
          (entry.value?.kind === "reaction" || entry.value?.kind === "route")
        ) {
          const parent = host.value.parentElement!;
          const padding = getComputedStyle(boundary);
          const maximum =
            boundary.clientWidth -
            parseFloat(padding.paddingLeft) -
            parseFloat(padding.paddingRight);
          const w = Math.max(
            parent.clientWidth,
            Math.min(result.width, maximum),
          );
          host.value.style.width = `${w}px`;
          host.value.style.maxWidth = "none";
          host.value.style.marginLeft = `${(parent.clientWidth - w) / 2}px`;
        }
        const available = root.value!.clientWidth;
        const scale = Math.max(
          result.minimumScale,
          Math.min(1, available / result.width),
        );
        result.svg.style.width = `${result.width * scale}px`;
        result.svg.style.height = `${result.height * scale}px`;
        emit("diagnostics", figureDiagnostics(result.svg));
      };
      observer = new ResizeObserver(resize);
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
});
</script>
<template>
  <template v-if="entry?.kind === 'process'">
    <ProcessViewer :key="entry.id" :data="entry" />
    <p v-if="reference.caption" class="figure-caption">
      {{ reference.caption }}
    </p>
  </template>
  <template
    v-else-if="entry?.kind === 'image' && reference.presentation && !entry.crop"
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
    <nav
      v-if="
        entry?.kind === 'mechanism' &&
        !reference.frame &&
        entry.frames.length > 1
      "
      aria-label="图示步骤"
      class="frames"
    >
      <button
        v-for="frame in entry.frames"
        :key="frame.id"
        class="button button--quiet"
        type="button"
        :aria-pressed="displayed.frame === frame.id"
        @click="selectedFrame = frame.id"
      >
        {{ frame.title }}
      </button>
    </nav>
    <div
      ref="root"
      class="library-canvas"
      tabindex="0"
      role="group"
      :aria-label="library[reference.ref]?.title"
    />
    <p v-if="entry?.overview">{{ entry.overview }}</p>
    <p v-if="frameExplanation">{{ frameExplanation }}</p>
    <p v-if="explanation">{{ explanation }}</p>
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
  overflow-x: auto;
  max-width: 100%;
  padding: var(--space-2) 0;
}
.library-canvas :deep(svg) {
  display: block;
  margin: auto;
  max-width: none;
}
figcaption,
.figure-caption {
  color: var(--ink-muted);
  font-size: var(--text-sm);
  margin-top: var(--space-2);
}
</style>

<style scoped>
.frames {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  margin-bottom: var(--space-3);
}
.frames button[aria-pressed="true"] {
  font-weight: 600;
  color: var(--chemical-focus);
}
.library-canvas :deep([data-reaction-id]) {
  cursor: pointer;
}
.library-canvas :deep([role="button"]:focus-visible) {
  outline: 2px solid var(--chemical-focus);
}
</style>
