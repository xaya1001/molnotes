<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue";
defineProps<{ id: string; text: string; point?: boolean }>();
const element = ref<HTMLElement>();
const open = ref(false);
const overflow = ref(false);
let observer: ResizeObserver | undefined;
let width = 0;
function measure() {
  const target = element.value!;
  target.classList.remove("is-open");
  overflow.value = target.scrollHeight > target.clientHeight + 1;
  if (open.value) target.classList.add("is-open");
}
onMounted(async () => {
  await document.fonts.ready;
  measure();
  observer = new ResizeObserver(([entry]) => {
    if (entry.contentRect.width !== width) {
      width = entry.contentRect.width;
      measure();
    }
  });
  observer.observe(element.value!);
});
onBeforeUnmount(() => observer?.disconnect());
</script>
<template>
  <p
    :id="id"
    ref="element"
    class="request-text"
    :class="{ 'is-open': open, 'request-point': point }"
    data-clamp
  >
    {{ text }}
  </p>
  <button
    v-if="overflow || open"
    class="button button--quiet request-toggle"
    type="button"
    :aria-controls="id"
    :aria-expanded="open"
    @click="open = !open"
  >
    {{ open ? "收起" : "展开全文" }}
  </button>
</template>
