<script setup lang="ts">
import { computed, ref, watch } from "vue";
import UiDialog from "./UiDialog.vue";

const props = defineProps<{ src: string; alt: string; title: string }>();
const open = defineModel<boolean>("open", { required: true });

const MIN_SCALE = 0.25;
const MAX_SCALE = 4;
const STEP = 1.25;

/** `null` fits the image to the window; a number is relative to natural size. */
const scale = ref<number | null>(null);
const failed = ref(false);
const image = ref<HTMLImageElement | null>(null);
const viewport = ref<HTMLElement | null>(null);

watch([open, () => props.src], () => {
  scale.value = null;
  failed.value = false;
});

function currentScale() {
  const element = image.value;
  if (scale.value !== null) return scale.value;
  if (!element?.naturalWidth) return 1;
  return element.clientWidth / element.naturalWidth;
}

function zoom(factor: number) {
  scale.value = Math.min(
    MAX_SCALE,
    Math.max(MIN_SCALE, currentScale() * factor),
  );
}

const imageStyle = computed(() => {
  const element = image.value;
  if (scale.value === null || !element?.naturalWidth) return undefined;
  return {
    width: `${Math.round(element.naturalWidth * scale.value)}px`,
    maxWidth: "none",
    maxHeight: "none",
  };
});

let drag: { x: number; y: number; left: number; top: number } | null = null;

function startDrag(event: PointerEvent) {
  const element = viewport.value;
  if (event.pointerType !== "mouse" || !element) return;
  drag = {
    x: event.clientX,
    y: event.clientY,
    left: element.scrollLeft,
    top: element.scrollTop,
  };
  element.setPointerCapture(event.pointerId);
}

function moveDrag(event: PointerEvent) {
  const element = viewport.value;
  if (!drag || !element) return;
  element.scrollLeft = drag.left - (event.clientX - drag.x);
  element.scrollTop = drag.top - (event.clientY - drag.y);
}

function endDrag() {
  drag = null;
}
</script>

<template>
  <UiDialog
    v-model:open="open"
    :title="title"
    size="full"
    close-label="关闭图片"
  >
    <template #toolbar>
      <button
        class="button button--quiet"
        type="button"
        :aria-pressed="scale === null"
        @click="scale = null"
      >
        适应窗口
      </button>
      <button
        class="button button--quiet"
        type="button"
        :aria-pressed="scale === 1"
        @click="scale = 1"
      >
        原始尺寸
      </button>
      <button
        class="button button--quiet button--icon"
        type="button"
        aria-label="缩小图片"
        @click="zoom(1 / STEP)"
      >
        −
      </button>
      <button
        class="button button--quiet button--icon"
        type="button"
        aria-label="放大图片"
        @click="zoom(STEP)"
      >
        +
      </button>
    </template>
    <div
      ref="viewport"
      class="image-viewport"
      :class="{ 'image-viewport--fit': scale === null }"
      @pointerdown="startDrag"
      @pointermove="moveDrag"
      @pointerup="endDrag"
      @pointercancel="endDrag"
    >
      <p v-if="failed" class="image-error" role="alert">
        图片无法加载，请稍后重试或核对素材路径。
      </p>
      <img
        v-else-if="open"
        ref="image"
        :src="src"
        :alt="alt"
        :style="imageStyle"
        draggable="false"
        @error="failed = true"
      />
    </div>
  </UiDialog>
</template>

<style scoped>
.image-viewport {
  display: flex;
  width: 100%;
  height: 100%;
  overflow: auto;
  padding: var(--space-4);
  background: var(--paper-deep);
  cursor: grab;
}

.image-viewport:active {
  cursor: grabbing;
}

.image-viewport--fit img {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
}

img {
  flex: none;
  margin: auto;
  background: #fff;
  user-select: none;
}

.image-error {
  color: var(--danger);
  font: var(--text-sm) / 1.6 var(--font-sans);
}
</style>
